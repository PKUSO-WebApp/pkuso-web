import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

/**
 * Bearer token 鉴权 + admin 角色校验（提取自 /api/notify 与 /api/admin/settings 的验证模式）。
 * 成功返回 service role 客户端（绕过 RLS，仅用于 API route 中的管理员操作），失败返回结构化错误响应。
 */
export async function verifyAdmin(
  request: Request,
): Promise<
  | { ok: true; supabaseServer: ReturnType<typeof createServerSupabase> }
  | { ok: false; response: NextResponse }
> {
  const supabaseServer = createServerSupabase();
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "") ?? "";
  if (!token)
    return { ok: false, response: NextResponse.json({ error: "未授权" }, { status: 401 }) };

  const {
    data: { user },
    error: authError,
  } = await supabaseServer.auth.getUser(token);
  if (authError || !user)
    return { ok: false, response: NextResponse.json({ error: "未授权" }, { status: 401 }) };

  // maybeSingle：profiles 行可能不存在（注册中断等场景），0 行返回 data: null 而非 406 错误
  const { data: profile } = await supabaseServer
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin")
    return { ok: false, response: NextResponse.json({ error: "权限不足" }, { status: 403 }) };

  return { ok: true, supabaseServer };
}
