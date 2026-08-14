"use client";

import { supabase as defaultClient } from "@/lib/supabase";

/**
 * 获取当前会话的有效 access_token（必要时先刷新）。
 * 裸 fetch 调用 API route 前使用——getSession() 返回存储态 token，
 * 可能已过期；refreshSession() 用 refresh token 换新 token 并更新存储。
 * 语义：返回有效 token 或 null，失败不抛异常（由调用方提示重新登录）。
 */
export async function getFreshAccessToken(
  client: typeof defaultClient = defaultClient,
): Promise<string | null> {
  const {
    data: { session },
  } = await client.auth.getSession();

  if (!session) {
    // 无存储会话时尝试用 refresh token 恢复（可能只是存储未同步）
    const refreshed = await client.auth.refreshSession();
    if (refreshed.error) return null;
    return refreshed.data.session?.access_token ?? null;
  }

  // 访问令牌已过期或 60 秒内将过期时先刷新（expires_at 为秒级时间戳）
  const expiresAt = (session.expires_at ?? 0) * 1000;
  if (Date.now() >= expiresAt - 60_000) {
    const refreshed = await client.auth.refreshSession();
    if (!refreshed.error) return refreshed.data.session?.access_token ?? null;
    // 刷新失败（如 refresh token 已失效）时返回 null，由调用方提示重新登录
    return null;
  }

  return session.access_token;
}
