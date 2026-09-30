import { createServerSupabase } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

/**
 * 拒绝用户入团申请的 API 路由
 * 使用 service role key 绕过 RLS，仅允许管理员调用
 */
export async function POST(request: Request) {
  const supabase = createServerSupabase();

  try {
    // 1. 认证 + 授权: 验证调用者为 admin
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "") ?? "";
    if (!token) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "权限不足" }, { status: 403 });
    }

    // 2. 解析请求
    const { id } = await request.json();

    if (!id) {
      return NextResponse.json({ error: "缺少用户 ID" }, { status: 400 });
    }

    // 3. 执行拒绝
    // 链 .select("id") 做 0 行检测：命中 0 行时无 error（RLS 静默拒绝 / 目标已被并发处理），
    // 若按成功处理，审批界面会显示「已驳回」而库里没变（Issue #368）
    const { data: rejected, error } = await supabase
      .from("profiles")
      .update({ status: "rejected" })
      .eq("id", id)
      .select("id");

    if (error) {
      console.error("[Admin Reject] 拒绝失败:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!rejected || rejected.length === 0) {
      console.error("[Admin Reject] 没有匹配的记录，id =", id);
      return NextResponse.json({ error: "没有匹配的记录，申请不存在或已被处理" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Admin Reject] 服务器错误:", err);
    return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
  }
}
