import { createServerSupabase } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

/**
 * 批准用户入团申请的 API 路由
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

    // 3. 执行批准
    const { error } = await supabase.from("profiles").update({ status: "approved" }).eq("id", id);

    if (error) {
      console.error("[Admin Approve] 批准失败:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Admin Approve] 服务器错误:", err);
    return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
  }
}
