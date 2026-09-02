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

    // 4. 尝试从 member_info 预填 profile（仅填充空字段）
    try {
      // 获取用户姓名
      const { data: targetProfile } = (await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", id)
        .single()) as { data: { full_name: string | null } | null };

      if (targetProfile?.full_name) {
        // 用姓名查询 member_info
        const { data: memberInfo } = await supabase
          .from("member_info")
          .select("*")
          .eq("full_name", targetProfile.full_name)
          .single();

        if (memberInfo) {
          // 构建需要更新的字段（仅填充空字段）
          const updates: Record<string, unknown> = {};

          // 从 profiles 获取其他字段的当前值
          const { data: fullProfile } = await supabase
            .from("profiles")
            .select("email, instrument, college")
            .eq("id", id)
            .single();

          if (fullProfile) {
            if (!fullProfile.email && memberInfo.email) {
              updates.email = memberInfo.email;
            }
            if (!fullProfile.instrument && memberInfo.instrument_name) {
              updates.instrument = memberInfo.instrument_name;
            }
            if (!fullProfile.college && memberInfo.college) {
              updates.college = memberInfo.college;
            }
          }

          // 如果有需要更新的字段
          if (Object.keys(updates).length > 0) {
            await supabase.from("profiles").update(updates).eq("id", id);
            console.log("[Admin Approve] 已从 member_info 预填 profile:", updates);
          }
        }
      }
    } catch (prefillErr) {
      // 预填失败不影响批准流程
      console.error("[Admin Approve] 预填 profile 失败（不影响批准）:", prefillErr);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Admin Approve] 服务器错误:", err);
    return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
  }
}
