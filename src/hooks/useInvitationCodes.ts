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
  const createSingle = React.useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const code = generateRandomCode();
      const userId = await getCurrentUserId();
      const insertData: Record<string, unknown> = { code };
      if (userId) {
        insertData.created_by = userId;
      }
      const { data: newCode, error: dbError } = await client
        .from("invitation_codes")
        .insert(insertData)
        .select()
        .single();
      if (dbError) {
        setError(dbError.message);
        return null;
      }
      setData((prev) => [newCode as InvitationCodeRow, ...prev]);
      return newCode as InvitationCodeRow;
    } finally {
      setCreating(false);
    }
  }, [client, getCurrentUserId]);

  /**
   * 批量生成邀请码
   */
  const createBatch = React.useCallback(
    async (count: number) => {
      setCreating(true);
      setError(null);
      try {
        const userId = await getCurrentUserId();
        const codes = Array.from({ length: count }, () => {
          const item: Record<string, unknown> = { code: generateRandomCode() };
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
