import { createServerSupabase } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

/**
 * 公告管理 API 路由
 * 使用 service role key 绕过 RLS，仅允许管理员调用
 */

/**
 * 验证调用者是否为管理员
 */
async function verifyAdmin(request: Request): Promise<string | null> {
  const supabase = createServerSupabase();
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "") ?? "";

  if (!token) {
    return "未授权";
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return "未授权";
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return "权限不足";
  }

  return null;
}

// 获取所有公告
export async function GET(request: Request) {
  try {
    // 验证管理员权限
    const authError = await verifyAdmin(request);
    if (authError) {
      return NextResponse.json(
        { error: authError },
        { status: authError === "未授权" ? 401 : 403 },
      );
    }

    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from("announcements")
      .select("id, content, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[Admin Announcement] 获取公告失败:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    console.error("[Admin Announcement] 服务器错误:", err);
    return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
  }
}

// 更新公告
export async function PUT(request: Request) {
  try {
    // 验证管理员权限
    const authError = await verifyAdmin(request);
    if (authError) {
      return NextResponse.json(
        { error: authError },
        { status: authError === "未授权" ? 401 : 403 },
      );
    }

    const supabase = createServerSupabase();

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
    }

    const { id, content } = body;
    if (!id) {
      return NextResponse.json({ error: "缺少公告 ID" }, { status: 400 });
    }
    if (content === undefined || content === null || content.trim() === "") {
      return NextResponse.json({ error: "缺少公告内容" }, { status: 400 });
    }

    const { error } = await supabase.from("announcements").update({ content }).eq("id", id);

    if (error) {
      console.error("[Admin Announcement] 更新公告失败:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Admin Announcement] 服务器错误:", err);
    return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
  }
}

// 删除公告
export async function DELETE(request: Request) {
  try {
    // 验证管理员权限
    const authError = await verifyAdmin(request);
    if (authError) {
      return NextResponse.json(
        { error: authError },
        { status: authError === "未授权" ? 401 : 403 },
      );
    }

    const supabase = createServerSupabase();

    // 同时支持从 JSON body 和 URL 参数获取 id
    let id: string | undefined;
    try {
      const body = await request.json();
      id = body.id;
    } catch {
      // 忽略 JSON 解析错误，尝试从 URL 参数获取
    }

    const url = new URL(request.url);
    const idFromUrl = url.searchParams.get("id");
    const targetId = id || idFromUrl;

    if (!targetId) {
      return NextResponse.json({ error: "缺少公告 ID" }, { status: 400 });
    }

    const { error } = await supabase.from("announcements").delete().eq("id", targetId);

    if (error) {
      console.error("[Admin Announcement] 删除公告失败:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Admin Announcement] 服务器错误:", err);
    return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
  }
}
