import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/verify-admin";

export const runtime = "nodejs";

/**
 * 请假/补请假管理端 API（Issue #142）。
 *
 * - GET：service role 查全部申请（join 成员与排练信息），按 created_at 倒序；
 * - POST { action: "approve", ids }：逐条通过。联动考勤：只改 status、不动
 *   sign_in_time（保持签到锁定语义，Issue #141）；无考勤行时补插一行（只写状态）；
 * - POST { action: "reject", ids, reject_reason }：驳回，原因必填，同一原因应用到全部勾选；
 * - POST { action: "signed-url", path }：私有桶附件签名 URL（60s），供 admin 查看成员附件。
 *
 * 成员端无需调用本路由（RLS 仅限本人读写自己的申请，附件走客户端 createSignedUrl）。
 */

/** 非法 JSON / 缺参的统一 400 处理（非法 JSON 返回结构化错误而非 500） */
async function parseJsonBody(
  request: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "请求体不是有效的 JSON" }, { status: 400 }),
    };
  }
}

export async function GET(request: Request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.ok) return auth.response;

    const { data, error } = await auth.supabaseServer
      .from("leave_requests")
      .select(
        "*, profiles(full_name, instrument), rehearsals(repertoire, title, start_time, end_time, location)",
      )
      .order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ requests: data ?? [] });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Leave Admin Error]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return parsed.response;
    // JSON 字面量 null 也视为缺参
    if (parsed.body === null) return NextResponse.json({ error: "缺少参数" }, { status: 400 });

    const { action } = parsed.body as { action?: unknown };

    // ---- 附件签名 URL（admin 查看成员附件用） ----
    if (action === "signed-url") {
      const { path } = parsed.body as { path?: unknown };
      if (typeof path !== "string" || path.trim() === "") {
        return NextResponse.json({ error: "缺少参数" }, { status: 400 });
      }
      const { data, error } = await auth.supabaseServer.storage
        .from("leave-attachments")
        .createSignedUrl(path, 60);
      if (error || !data) {
        return NextResponse.json({ error: error?.message ?? "签名失败" }, { status: 500 });
      }
      return NextResponse.json({ url: data.signedUrl });
    }

    // ---- 批量通过 / 驳回 ----
    if (action !== "approve" && action !== "reject") {
      return NextResponse.json({ error: "缺少参数" }, { status: 400 });
    }
    const { ids, reject_reason } = parsed.body as { ids?: unknown; reject_reason?: unknown };
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((i) => typeof i === "string")) {
      return NextResponse.json({ error: "缺少参数" }, { status: 400 });
    }
    if (action === "reject") {
      // 驳回原因必填（trim 后非空），同一原因应用到全部勾选
      if (typeof reject_reason !== "string" || reject_reason.trim() === "") {
        return NextResponse.json({ error: "缺少驳回原因" }, { status: 400 });
      }
    }

    // 批量逐条处理，汇总成功/失败明细（单条失败不阻断其余）
    const processed: string[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const id of ids as string[]) {
      try {
        if (action === "approve") {
          // 拉取申请（仅 pending，防并发重复处理已完成的申请）
          const { data: reqs, error: fetchErr } = await auth.supabaseServer
            .from("leave_requests")
            .select("id, rehearsal_id, user_id, target_status")
            .eq("id", id)
            .eq("status", "pending");
          if (fetchErr) throw new Error(fetchErr.message);
          const req = Array.isArray(reqs) && reqs.length > 0 ? reqs[0] : null;
          if (!req) {
            failed.push({ id, error: "申请不存在或已处理" });
            continue;
          }

          // 联动考勤：只改 status 不动 sign_in_time（保持签到锁定语义，Issue #141）
          const { data: updatedRows, error: attErr } = await auth.supabaseServer
            .from("attendances")
            .update({ status: req.target_status })
            .eq("rehearsal_id", req.rehearsal_id)
            .eq("user_id", req.user_id)
            .select("id");
          if (attErr) throw new Error(attErr.message);
          if (!updatedRows || updatedRows.length === 0) {
            // 无考勤行（该排练创建后新加入的团员等）：补插一行，只写状态不写签到时间
            const { error: insErr } = await auth.supabaseServer.from("attendances").insert({
              rehearsal_id: req.rehearsal_id,
              user_id: req.user_id,
              status: req.target_status,
            });
            if (insErr) throw new Error(insErr.message);
          }

          // 标记申请为已通过（仍带 pending 守卫，双人并发审批时后到者落空）
          const { data: statusRows, error: stErr } = await auth.supabaseServer
            .from("leave_requests")
            .update({ status: "approved" })
            .eq("id", id)
            .eq("status", "pending")
            .select("id");
          if (stErr) throw new Error(stErr.message);
          if (!statusRows || statusRows.length === 0) {
            failed.push({ id, error: "申请不存在或已处理" });
            continue;
          }
          processed.push(id);
        } else {
          const { data: statusRows, error: stErr } = await auth.supabaseServer
            .from("leave_requests")
            .update({ status: "rejected", reject_reason: (reject_reason as string).trim() })
            .eq("id", id)
            .eq("status", "pending")
            .select("id");
          if (stErr) throw new Error(stErr.message);
          if (!statusRows || statusRows.length === 0) {
            failed.push({ id, error: "申请不存在或已处理" });
            continue;
          }
          processed.push(id);
        }
      } catch (err) {
        failed.push({ id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return NextResponse.json({ success: true, processed, failed });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Leave Admin Error]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
