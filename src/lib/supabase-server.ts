import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Server-only Supabase client using the service role key.
 * Bypasses RLS — use only in API routes for admin operations (e.g. reading all users' emails).
 *
 * 必须关闭 session 持久化（persistSession: false）：
 * 服务端客户端若读取浏览器 localStorage（jsdom 测试或未来同构场景），
 * 会把测试登录留下的 user JWT 附加到 PostgREST 请求的 Authorization 头，
 * 而 Authorization 优先级高于 apikey，导致 service role key 被忽略、
 * 查询以普通用户身份执行（敏感列 42501 / RLS 拒绝）。
 */
export function createServerSupabase() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "[Supabase Server] 缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY。",
    );
  }
  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
