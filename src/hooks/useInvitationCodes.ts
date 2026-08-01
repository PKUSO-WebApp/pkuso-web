"use client";

import React from "react";
import { supabase as defaultClient } from "@/lib/supabase";
import type { InvitationCodeRow } from "@/types/database";

/**
 * 生成随机邀请码
 * 格式：8位大写字母和数字组合，排除易混淆字符（0/O/1/I）
 */
function generateRandomCode(length = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 单个生成邀请码的可选参数
 */
export type CreateSingleOptions = {
  /** 自定义邀请码内容，留空则自动生成 */
  customCode?: string;
  /** 最大使用次数，默认为 1 */
  maxUses?: number;
  /** 有效期（天数），默认为 7 天，范围 1-30 天 */
  expiresInDays?: number;
};

/**
 * createSingle 的返回值
 * - data：新建的邀请码行；失败时为 null
 * - error：失败原因（与 hook 的 error 状态一致）；成功时为 null
 *
 * 之所以同时返回 error 而非仅依赖 hook 的 error 状态：
 * React 18 automatic batching 下，连续两次相同 23505 冲突会让 setError(null)→setError(msg)
 * 被 batch 成最终与上一次相同的值，Object.is 判等触发 React bailout，useEffect 不会重新执行，
 * 调用方拿不到最新错误。改为把 error 直接随返回值带出，调用方可在 handleGenerate 同步设置 UI 文案。
 */
export type CreateSingleResult = {
  data: InvitationCodeRow | null;
  error: string | null;
};

export function useInvitationCodes(client: typeof defaultClient = defaultClient) {
  const [data, setData] = React.useState<InvitationCodeRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const deletingRef = React.useRef<Set<string>>(new Set());
  const fetchSeqRef = React.useRef(0);

  /**
   * 检查指定邀请码是否正在删除中
   */
  const isDeleting = React.useCallback((id: string) => deletingRef.current.has(id), []);

  const fetch = React.useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    setLoading(true);
    setError(null);
    const { data: rows, error: dbError } = await client
      .from("invitation_codes")
      .select("*")
      .order("created_at", { ascending: false });
    // 只有最新请求的结果才更新 state，避免竞态导致旧数据覆盖新数据
    if (seq !== fetchSeqRef.current) return;
    setLoading(false);
    if (dbError) {
      setError(dbError.message);
      setData([]);
      return;
    }
    setData((rows as InvitationCodeRow[]) ?? []);
  }, [client]);

  /**
   * 获取当前登录用户 ID
   */
  const getCurrentUserId = React.useCallback(async (): Promise<string | null> => {
    try {
      const { data } = await client.auth.getUser();
      return data.user?.id ?? null;
    } catch {
      return null;
    }
  }, [client]);

  /**
   * 生成单个邀请码
   */
  const createSingle = React.useCallback(
    async (options?: CreateSingleOptions): Promise<CreateSingleResult> => {
      setCreating(true);
      setError(null);
      try {
        // ---- 参数校验：customCode ----
        const CODE_MAX_LEN = 20;
        const custom = options?.customCode?.trim();
        if (custom) {
          if (custom.length > CODE_MAX_LEN) {
            const msg = `邀请码最多 ${CODE_MAX_LEN} 字符`;
            setError(msg);
            return { data: null, error: msg };
          }
          if (!/^[A-Za-z0-9_-]+$/.test(custom)) {
            const msg = "仅支持字母、数字、- 和 _";
            setError(msg);
            return { data: null, error: msg };
          }
        }

        // ---- 参数校验：maxUses ----
        const MAX_USES_HARD_CAP = 9999;
        let maxUses: number | undefined;
        if (options?.maxUses != null) {
          const m = Math.floor(options.maxUses);
          if (!Number.isFinite(m) || m < 1 || m > MAX_USES_HARD_CAP) {
            const msg = `最大使用次数必须为 1-${MAX_USES_HARD_CAP} 的整数`;
            setError(msg);
            return { data: null, error: msg };
          }
          maxUses = m;
        }

        // ---- 参数校验：expiresInDays ----
        const expiresInDays = options?.expiresInDays ?? 7; // 默认 7 天
        if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 30) {
          const msg = "有效期必须为 1-30 天的整数";
          setError(msg);
          return { data: null, error: msg };
        }

        const code = custom || generateRandomCode();
        const userId = await getCurrentUserId();

        // 计算 expires_at（当前时间 + N 天），使用中国时区确保时间一致
        const now = new Date();
        // 使用 toLocaleString 获取中国时区的日期，避免服务器时区变化影响
        const chinaTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
        chinaTime.setDate(chinaTime.getDate() + expiresInDays);
        chinaTime.setHours(23, 59, 59, 999); // 设置为当天的 23:59:59
        const expiresAt = chinaTime;

        const insertData: Record<string, unknown> = {
          code,
          max_uses: maxUses ?? 1,
          expires_at: expiresAt.toISOString(),
        };
        if (userId) {
          insertData.created_by = userId;
        }
        const { data: newCode, error: dbError } = await client
          .from("invitation_codes")
          .insert(insertData)
          .select()
          .single();
        if (dbError) {
          // 23505 = unique_violation：自定义邀请码已存在，给出明确提示
          // dbError 可能为 undefined/null，访问 code 前做空值防护
          if (dbError?.code === "23505") {
            const msg = "邀请码已存在，请更换";
            setError(msg);
            return { data: null, error: msg };
          }
          const msg = dbError?.message ?? "邀请码生成失败";
          setError(msg);
          return { data: null, error: msg };
        }
        setData((prev) => [newCode as InvitationCodeRow, ...prev]);
        return { data: newCode as InvitationCodeRow, error: null };
      } finally {
        setCreating(false);
      }
    },
    [client, getCurrentUserId],
  );

  /**
   * 批量生成邀请码
   * 使用次数固定为 1，有效期固定为 7 天
   */
  const createBatch = React.useCallback(
    async (count: number) => {
      setCreating(true);
      setError(null);
      try {
        const userId = await getCurrentUserId();

        // 批量生成固定一周有效期，使用中国时区确保时间一致
        const now = new Date();
        // 使用 toLocaleString 获取中国时区的日期，避免服务器时区变化影响
        const chinaTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
        chinaTime.setDate(chinaTime.getDate() + 7);
        chinaTime.setHours(23, 59, 59, 999); // 设置为当天的 23:59:59
        const expiresAt = chinaTime;

        const codes = Array.from({ length: count }, () => {
          const item: Record<string, unknown> = {
            code: generateRandomCode(),
            max_uses: 1, // 批量生成固定使用次数为 1
            expires_at: expiresAt.toISOString(), // 固定一周有效期
          };
          if (userId) {
            item.created_by = userId;
          }
          return item;
        });
        const { data: newCodes, error: dbError } = await client
          .from("invitation_codes")
          .insert(codes)
          .select();
        if (dbError) {
          setError(dbError.message);
          return [];
        }
        const result = (newCodes as InvitationCodeRow[]) ?? [];
        setData((prev) => [...result, ...prev]);
        return result;
      } finally {
        setCreating(false);
      }
    },
    [client, getCurrentUserId],
  );

  /**
   * 删除邀请码
   */
  const remove = React.useCallback(
    async (id: string) => {
      if (deletingRef.current.has(id)) return false;
      deletingRef.current.add(id);
      setDeleting(true);
      setError(null);
      try {
        const { error: dbError } = await client.from("invitation_codes").delete().eq("id", id);
        if (dbError) {
          setError(dbError.message);
          return false;
        }
        setData((prev) => prev.filter((c) => c.id !== id));
        return true;
      } finally {
        deletingRef.current.delete(id);
        setDeleting(deletingRef.current.size > 0);
      }
    },
    [client],
  );

  return {
    data,
    loading,
    error,
    creating,
    deleting,
    isDeleting,
    fetch,
    createSingle,
    createBatch,
    remove,
  };
}
