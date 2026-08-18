import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/verify-admin";
import { createServerSupabase } from "@/lib/supabase-server";

export const runtime = "nodejs";

/**
 * 请假/补请假管理端 API（Issue #142）。
 *
 * - GET：service role 查全部申请（join 成员与排练信息），按 created_at 倒序；
 * - POST { action: "approve", ids }：逐条通过。联动考勤（返工守卫）：先查考勤行，
 *   sign_in_time 非空（成员已实际签到）时不写考勤、申请照常置 approved，并在返回的
 *   warnings 中标注让管理员知晓（避免「已签到但请假」的不可恢复矛盾）；否则只改 status、
 *   不动 sign_in_time（保持签到锁定语义，Issue #141），无考勤行时补插一行（只写状态）；
 *   通过成功后向申请人插「attendance」通知（best-effort，失败不阻断主操作，Issue #188）；
 * - POST { action: "reject", ids, reject_reason }：驳回，原因必填，同一原因应用到全部勾选；
 *   驳回成功后向申请人插「attendance」通知（content 附驳回原因，同样 best-effort）；
 * - POST { action: "signed-url", path }：私有桶附件签名 URL（60s），供 admin 查看成员附件。
 *
 * 成员端无需调用本路由（RLS 仅限本人读写自己的申请，附件走客户端 createSignedUrl）。
 */

/** approve 时成员已实际签到（sign_in_time 非空）：考勤保持签到记录，仅通过申请 */
const SIGNED_IN_WARNING = "成员已签到，考勤保持签到记录（请假申请已通过）";

/**
 * 向申请人插请假处理通知（best-effort，Issue #188）：
 * 插入失败仅 console 记录，绝不阻断 approve/reject 主操作。
 */
async function insertLeaveNotification(
  supabaseServer: ReturnType<typeof createServerSupabase>,
  req: {
    user_id: string;
    rehearsals?: { repertoire?: string | null; title?: string | null } | null;
  },
  kind: "approved" | "rejected",
  reason?: string,
) {
  try {
    // 排练名优先曲目（repertoire），缺失时回退标题，再兜底「排练」
    const rehearsalName = req.rehearsals?.repertoire || req.rehearsals?.title || "排练";
    const { error } = await supabaseServer.from("notifications").insert({
      user_id: req.user_id,
      category: "attendance",
      title: kind === "approved" ? "请假申请已通过" : "请假申请被驳回",
      content:
        kind === "approved"
          ? `《${rehearsalName}》排练的请假申请已通过`
          : `《${rehearsalName}》排练的请假申请已被驳回，原因：${reason ?? ""}`,
    });
    if (error) console.error("[Leave Admin] 通知插入失败", error.message);
  } catch (err) {
    console.error("[Leave Admin] 通知插入失败", err);
  }
}

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

    // 批量逐条处理，汇总成功/失败明细（单条失败不阻断其余）；
    // warnings：申请已通过但考勤未联动（成员已实际签到）的条目，供 admin 知晓
    const processed: string[] = [];
    const failed: { id: string; error: string }[] = [];
    const warnings: { id: string; message: string }[] = [];
    // 各条通知插入任务（best-effort：insertLeaveNotification 自带 catch 不会 reject，
    // 循环内仅收集 promise 不串行 await，循环后统一并行完成，避免批量时拖慢整批响应）
    const notificationTasks: Promise<void>[] = [];
    for (const id of ids as string[]) {
      try {
        if (action === "approve") {
          // 拉取申请（仅 pending，防并发重复处理已完成的申请）；join 排练信息供通过通知文案使用
          const { data: reqs, error: fetchErr } = await auth.supabaseServer
            .from("leave_requests")
            .select("id, rehearsal_id, user_id, target_status, rehearsals(repertoire, title)")
            .eq("id", id)
            .eq("status", "pending");
          if (fetchErr) throw new Error(fetchErr.message);
          const req = Array.isArray(reqs) && reqs.length > 0 ? reqs[0] : null;
          if (!req) {
            failed.push({ id, error: "申请不存在或已处理" });
            continue;
          }

          // 联动考勤（返工守卫）：先查该行考勤。sign_in_time 非空说明成员已实际签到——
          // 此时若再覆盖 status 会出现「已签到但请假」的不可恢复矛盾（Issue #141 签到锁定
          // 语义），因此不写考勤（保持签到记录），申请照常置 approved，并返回 warning
          const { data: attendanceRow, error: attQueryErr } = await auth.supabaseServer
            .from("attendances")
            .select("sign_in_time")
            .eq("rehearsal_id", req.rehearsal_id)
            .eq("user_id", req.user_id)
            .maybeSingle();
          if (attQueryErr) throw new Error(attQueryErr.message);
          const memberSignedIn = !!attendanceRow?.sign_in_time;
          if (memberSignedIn) {
            warnings.push({ id, message: SIGNED_IN_WARNING });
          } else {
            // 只改 status 不动 sign_in_time（保持签到锁定语义，Issue #141）；更新条件限定
            // sign_in_time IS NULL 才命中——关闭「查考勤 → 更新」间隙内成员并发签到的竞态窗口
            const { data: updatedRows, error: attErr } = await auth.supabaseServer
              .from("attendances")
              .update({ status: req.target_status })
              .eq("rehearsal_id", req.rehearsal_id)
              .eq("user_id", req.user_id)
              .is("sign_in_time", null)
              .select("id");
            if (attErr) throw new Error(attErr.message);
            if (!updatedRows || updatedRows.length === 0) {
              // 0 行两种可能：无考勤行（补插），或间隙内成员并发签到（保持签到记录，跳过）
              const { data: recheckRow, error: recheckErr } = await auth.supabaseServer
                .from("attendances")
                .select("id")
                .eq("rehearsal_id", req.rehearsal_id)
                .eq("user_id", req.user_id)
                .maybeSingle();
              if (recheckErr) throw new Error(recheckErr.message);
              if (recheckRow) {
                warnings.push({ id, message: SIGNED_IN_WARNING });
              } else {
                // 无考勤行（该排练创建后新加入的团员等）：补插一行，只写状态不写签到时间
                const { error: insErr } = await auth.supabaseServer.from("attendances").insert({
                  rehearsal_id: req.rehearsal_id,
                  user_id: req.user_id,
                  status: req.target_status,
                });
                if (insErr) throw new Error(insErr.message);
              }
            }
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
          // 通过通知（best-effort，不阻断主操作；promise 收集后并行完成）
          notificationTasks.push(insertLeaveNotification(auth.supabaseServer, req, "approved"));
        } else {
          // 驳回：先拉取申请（仅 pending）——通知需要成员与排练信息，且与更新共用同一 pending 守卫
          const { data: reqs, error: fetchErr } = await auth.supabaseServer
            .from("leave_requests")
            .select("id, rehearsal_id, user_id, target_status, rehearsals(repertoire, title)")
            .eq("id", id)
            .eq("status", "pending");
          if (fetchErr) throw new Error(fetchErr.message);
          const req = Array.isArray(reqs) && reqs.length > 0 ? reqs[0] : null;
          if (!req) {
            failed.push({ id, error: "申请不存在或已处理" });
            continue;
          }

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
          // 驳回通知（best-effort，content 附驳回原因；promise 收集后并行完成）
          notificationTasks.push(
            insertLeaveNotification(
              auth.supabaseServer,
              req,
              "rejected",
              (reject_reason as string).trim(),
            ),
          );
        }
      } catch (err) {
        failed.push({ id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    // 并行等待全部通知插入完成（best-effort，失败仅 console 记录，不阻断响应）
    await Promise.all(notificationTasks);

    return NextResponse.json({ success: true, processed, failed, warnings });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Leave Admin Error]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
