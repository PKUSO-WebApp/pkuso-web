"use client";

import React from "react";
import { supabase as defaultClient } from "@/lib/supabase";
import type { ProfileRow } from "@/types/database";

type ProfileFilter = {
  status?: string;
  ids?: string[];
  userId?: string;
};

type ProfileInsert = {
  id: string;
  email: string;
  full_name: string;
  instrument: string;
  college?: string;
  join_date?: string;
};

/** 可被编辑的个人资料字段（成员详情弹窗 / 用户编辑个人信息共用） */
export type ProfileUpdatePayload = Partial<
  Pick<
    ProfileRow,
    | "full_name"
    | "instrument"
    | "college"
    | "email"
    | "phone_number"
    | "join_date"
    | "is_section_leader"
  >
>;

export function useProfiles(filter?: ProfileFilter, client: typeof defaultClient = defaultClient) {
  const [data, setData] = React.useState<ProfileRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const savingRef = React.useRef<Map<string, boolean>>(new Map());
  const fetchSeqRef = React.useRef(0);

  // 解构出原始值作为 fetch 依赖，避免 filter 对象引用（每次渲染新建）导致 fetch 频繁重建
  const status = filter?.status;
  const ids = filter?.ids;
  const userId = filter?.userId;
  // 区分"没传 userId 字段"（如 admin 审批页全量查询）与"传了 undefined"
  // （如 profile 页 user 未就绪，跳过请求，避免退化为全表 select）
  const hasExplicitUndefinedUserId = filter != null && "userId" in filter && userId === undefined;

  const fetch = React.useCallback(async () => {
    const seq = ++fetchSeqRef.current;

    // 调用方明确传了 userId: undefined（如 profile 页 user 未就绪）：不发请求，返回空列表
    if (hasExplicitUndefinedUserId) {
      setLoading(false);
      setData([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    let query = client.from("profiles").select("*");

    if (status) query = query.eq("status", status);
    if (ids && ids.length > 0) query = query.in("id", ids);
    if (userId) query = query.eq("id", userId);

    const { data: rows, error: dbError } = await query;

    // 只有最新请求的结果才更新 state，避免竞态导致旧数据覆盖新数据
    if (seq !== fetchSeqRef.current) return;
    setLoading(false);
    if (dbError) {
      setError(dbError.message);
      setData([]);
      return;
    }

    if (userId) {
      setData(Array.isArray(rows) ? (rows as ProfileRow[]) : rows ? [rows as ProfileRow] : []);
    } else {
      setData((rows as ProfileRow[]) ?? []);
    }
  }, [client, status, ids, userId, hasExplicitUndefinedUserId]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetch();
  }, [fetch]);

  const approve = React.useCallback(
    async (id: string) => {
      if (savingRef.current.has(id)) return false;
      savingRef.current.set(id, true);
      setSaving(true);
      try {
        const {
          data: { session },
        } = await client.auth.getSession();
        const response = await window.fetch("/api/admin/approve", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({ id }),
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
          setError(result.error || "批准失败");
          return false;
        }
        setData((prev) => prev.filter((r) => r.id !== id));
        setError(null);
        return true;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_err: unknown) {
        setError("网络错误");
        return false;
      } finally {
        savingRef.current.delete(id);
        // 只有当没有任何用户正在保存时才设置 saving 为 false
        setSaving(savingRef.current.size > 0);
      }
    },
    [client],
  );

  const reject = React.useCallback(
    async (id: string) => {
      if (savingRef.current.has(id)) return false;
      savingRef.current.set(id, true);
      setSaving(true);
      try {
        const {
          data: { session },
        } = await client.auth.getSession();
        const response = await window.fetch("/api/admin/reject", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({ id }),
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
          setError(result.error || "拒绝失败");
          return false;
        }
        setData((prev) => prev.filter((r) => r.id !== id));
        setError(null);
        return true;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_err: unknown) {
        setError("网络错误");
        return false;
      } finally {
        savingRef.current.delete(id);
        // 只有当没有任何用户正在保存时才设置 saving 为 false
        setSaving(savingRef.current.size > 0);
      }
    },
    [client],
  );

  const insert = React.useCallback(
    async (profile: ProfileInsert) => {
      setSaving(true);
      const { error: dbError } = await client.from("profiles").insert(profile as never);
      setSaving(false);
      if (dbError) {
        setError(dbError.message);
        return false;
      }
      return true;
    },
    [client],
  );

  /**
   * 全部批准：将所有 pending 状态用户改为 approved
   */
  const approveAll = React.useCallback(async () => {
    const batchKey = "__batch__";
    if (savingRef.current.has(batchKey)) return false;
    savingRef.current.set(batchKey, true);
    setSaving(true);
    try {
      const {
        data: { session },
      } = await client.auth.getSession();
      const response = await window.fetch("/api/admin/approve-all", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        setError(result.error || "批量批准失败");
        return false;
      }
      // 清空当前列表
      setData([]);
      setError(null);
      return true;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_err: unknown) {
      setError("网络错误");
      return false;
    } finally {
      savingRef.current.delete(batchKey);
      setSaving(savingRef.current.size > 0);
    }
  }, [client]);

  /**
   * 全部拒绝：将所有 pending 状态用户改为 rejected
   */
  const rejectAll = React.useCallback(async () => {
    const batchKey = "__batch__";
    if (savingRef.current.has(batchKey)) return false;
    savingRef.current.set(batchKey, true);
    setSaving(true);
    try {
      const {
        data: { session },
      } = await client.auth.getSession();
      const response = await window.fetch("/api/admin/reject-all", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        setError(result.error || "批量拒绝失败");
        return false;
      }
      // 清空当前列表
      setData([]);
      setError(null);
      return true;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_err: unknown) {
      setError("网络错误");
      return false;
    } finally {
      savingRef.current.delete(batchKey);
      setSaving(savingRef.current.size > 0);
    }
  }, [client]);

  /**
   * 更新个人资料（admin 用 admin UPDATE 策略，用户用自我 UPDATE 策略）。
   * 成功后直接更新本地 data，避免整页刷新。
   * 通过 .select("id") 检测实际更新行数：RLS 拒绝时 PostgREST 返回 200 + 空数据
   * （静默失败），0 行更新视为失败，避免 UI 声称成功但数据未写入。
   */
  const update = React.useCallback(
    async (id: string, payload: ProfileUpdatePayload) => {
      const { data: rows, error: dbError } = await client
        .from("profiles")
        .update(payload as never)
        .eq("id", id)
        .select("id");
      if (dbError) {
        setError(dbError.message);
        return false;
      }
      if (!rows || rows.length === 0) {
        setError("无权限或记录不存在");
        return false;
      }
      setData((prev) => prev.map((r) => (r.id === id ? { ...r, ...payload } : r)));
      setError(null);
      return true;
    },
    [client],
  );

  return {
    data,
    loading,
    error,
    saving,
    fetch,
    approve,
    reject,
    insert,
    approveAll,
    rejectAll,
    update,
  };
}
