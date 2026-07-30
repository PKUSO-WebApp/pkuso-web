import { createServerSupabase } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

/**
 * 批量批准用户入团申请的 API 路由
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

    // 2. 执行全部批准：将所有 pending 状态用户改为 approved
    const { data, error } = await supabase
      .from("profiles")
      .update({ status: "approved" })
      .eq("status", "pending")
      .select("id");

    if (error) {
      console.error("[Admin ApproveAll] 批量批准失败:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, count: data?.length ?? 0 });
  } catch (err) {
    console.error("[Admin ApproveAll] 服务器错误:", err);
    return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
  }
}
