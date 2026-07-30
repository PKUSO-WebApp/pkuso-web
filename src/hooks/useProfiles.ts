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

export function useProfiles(filter?: ProfileFilter, client: typeof defaultClient = defaultClient) {
  const [data, setData] = React.useState<ProfileRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const savingRef = React.useRef<Map<string, boolean>>(new Map());
  const fetchSeqRef = React.useRef(0);

  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- filter reference stable, use optional chain deps to avoid excessive re-creation
  const fetch = React.useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    setLoading(true);
    setError(null);

    let query = client.from("profiles").select("*");

    if (filter?.status) query = query.eq("status", filter.status);
    if (filter?.ids && filter.ids.length > 0) query = query.in("id", filter.ids);
    if (filter?.userId) query = query.eq("id", filter.userId);

    const { data: rows, error: dbError } = await query;

    // 只有最新请求的结果才更新 state，避免竞态导致旧数据覆盖新数据
    if (seq !== fetchSeqRef.current) return;
    setLoading(false);
    if (dbError) {
      setError(dbError.message);
      setData([]);
      return;
    }

    if (filter?.userId) {
      setData(Array.isArray(rows) ? (rows as ProfileRow[]) : rows ? [rows as ProfileRow] : []);
    } else {
      setData((rows as ProfileRow[]) ?? []);
    }
  }, [client, filter?.status, filter?.ids, filter?.userId]);

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

  return { data, loading, error, saving, fetch, approve, reject, insert, approveAll, rejectAll };
}
