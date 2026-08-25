import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/verify-admin";

export const runtime = "nodejs";

/**
 * 发布系统通知 API（Issue #227）。
 * - 鉴权：verifyAdmin（Bearer token + admin 角色）。
 * - 流程：① 写入 system_notifications（历史存档）→ ② 拉取全体 approved 成员
 *   → ③ 向 notifications 批量插入 category='system' 行（实际投递，service role 绕过 RLS）。
 * - 接收范围：全体已批准成员（status='approved'）；仅站内通知，不发送邮件。
 * - 0 行检测：成员列表为空时历史仍记录、投递数记 0，返回成功。
 */
export async function POST(request: Request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.ok) return auth.response;

    let body: { title?: string; content?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
    }

    const title = (body.title ?? "").trim();
    const content = (body.content ?? "").trim();
    if (!title || !content) {
      return NextResponse.json({ error: "标题与内容均不能为空" }, { status: 400 });
    }
    if (title.length > 100 || content.length > 2000) {
      return NextResponse.json({ error: "标题不超过 100 字、内容不超过 2000 字" }, { status: 400 });
    }

    const supabaseServer = auth.supabaseServer;

    // 取当前 admin id 作为发布人（verifyAdmin 已鉴权，此处复用其 token 解析）
    const token = request.headers.get("authorization")?.replace("Bearer ", "") ?? "";
    const {
      data: { user },
    } = await supabaseServer.auth.getUser(token);

    // ① 写入历史（publisher_id 取当前 admin；service role 绕过 RLS 插入）
    const { data: broadcast, error: insertErr } = await supabaseServer
      .from("system_notifications")
      .insert({ title, content, publisher_id: user?.id ?? null })
      .select("id, created_at")
      .single();
    if (insertErr || !broadcast) {
      console.error("[Notify System] 写入历史失败:", insertErr?.message);
      return NextResponse.json({ error: insertErr?.message ?? "发布失败" }, { status: 500 });
    }

    // ② 拉取全体已批准成员
    const { data: members, error: memberErr } = await supabaseServer
      .from("profiles")
      .select("id")
      .eq("status", "approved");
    if (memberErr) {
      console.error("[Notify System] 拉取成员失败:", memberErr.message);
      return NextResponse.json({ error: memberErr.message }, { status: 500 });
    }

    const memberIds = (members ?? []).map((m) => m.id);
    if (memberIds.length === 0) {
      return NextResponse.json({ success: true, count: 0 });
    }

    // ③ 批量投递（同一 created_at，保证历史与信箱时间一致）
    const rows = memberIds.map((userId) => ({
      user_id: userId,
      category: "system" as const,
      title,
      content,
      created_at: broadcast.created_at,
    }));
    const { error: notifyErr } = await supabaseServer.from("notifications").insert(rows);
    if (notifyErr) {
      console.error("[Notify System] 投递通知失败:", notifyErr.message);
      return NextResponse.json({ error: notifyErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, count: rows.length });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Notify System] 服务器错误:", msg);
    return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
  }
}
