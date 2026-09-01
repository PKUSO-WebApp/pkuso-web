"use client";

import React from "react";
import { supabase as defaultClient } from "@/lib/supabase";
import type { AnnouncementRow } from "@/types/database";

export function useAnnouncements(client: typeof defaultClient = defaultClient) {
  const [data, setData] = React.useState<AnnouncementRow | null>(null);
  const [allData, setAllData] = React.useState<AnnouncementRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadingAll, setLoadingAll] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [publishing, setPublishing] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [updatingId, setUpdatingId] = React.useState<string | null>(null);
  const deletingIdRef = React.useRef<string | null>(null);
  const updatingIdRef = React.useRef<string | null>(null);

  // 获取最新一条公告（供成员端展示）
  const fetch = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: rows, error: dbError } = await client
      .from("announcements")
      .select("id, content, created_at, title, end_time")
      .order("created_at", { ascending: false })
      .limit(1);
    setLoading(false);
    if (dbError) {
      setError(dbError.message);
      setData(null);
      return;
    }
    const row = Array.isArray(rows) && rows.length > 0 ? (rows[0] as AnnouncementRow) : null;
    setData(row);
  }, [client]);

  // 获取所有公告（供管理员管理）
  const fetchAll = React.useCallback(async () => {
    setLoadingAll(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await client.auth.getSession();
      const response = await window.fetch("/api/admin/announcement", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error || "获取公告失败");
        setAllData([]);
        return;
      }
      setAllData((result.data as AnnouncementRow[]) || []);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_err: unknown) {
      setError("网络错误");
      setAllData([]);
    } finally {
      setLoadingAll(false);
    }
  }, [client]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetch();
  }, [fetch]);

  // 获取当前仍有效的公告（结束时间晚于现在，用于「同时仅允许一条公告」的覆盖判断）
  const getActive = React.useCallback(async (): Promise<AnnouncementRow | null> => {
    const { data: rows, error: dbError } = await client
      .from("announcements")
      .select("id, title, content, created_at, end_time")
      .gt("end_time", new Date().toISOString())
      .order("end_time", { ascending: false })
      .limit(1);
    if (dbError || !Array.isArray(rows) || rows.length === 0) return null;
    return rows[0] as AnnouncementRow;
  }, [client]);

  const publish = React.useCallback(
    async (title: string, content: string, end_time: string) => {
      setPublishing(true);
      const { error: dbError } = await client
        .from("announcements")
        .insert({ title, content, end_time });
      setPublishing(false);
      if (dbError) {
        setError(dbError.message);
        return false;
      }
      return true;
    },
    [client],
  );

  // 删除公告
  const remove = React.useCallback(
    async (id: string) => {
      if (deletingIdRef.current === id) return false;
      deletingIdRef.current = id;
      setDeletingId(id);
      try {
        const {
          data: { session },
        } = await client.auth.getSession();
        const response = await window.fetch("/api/admin/announcement", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({ id }),
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
          setError(result.error || "删除失败");
          return false;
        }
        setAllData((prev) => prev.filter((item) => item.id !== id));
        return true;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_err: unknown) {
        setError("网络错误");
        return false;
      } finally {
        deletingIdRef.current = null;
        setDeletingId(null);
      }
    },
    [client],
  );

  // 更新公告
  const update = React.useCallback(
    async (id: string, title: string, content: string | null, end_time: string) => {
      if (updatingIdRef.current === id) return false;
      updatingIdRef.current = id;
      setUpdatingId(id);
      try {
        const {
          data: { session },
        } = await client.auth.getSession();
        const response = await window.fetch("/api/admin/announcement", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({ id, title, content, end_time }),
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
          setError(result.error || "更新失败");
          return false;
        }
        setAllData((prev) =>
          prev.map((item) => (item.id === id ? { ...item, title, content, end_time } : item)),
        );
        return true;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_err: unknown) {
        setError("网络错误");
        return false;
      } finally {
        updatingIdRef.current = null;
        setUpdatingId(null);
      }
    },
    [client],
  );

  return {
    data,
    allData,
    loading,
    loadingAll,
    error,
    publishing,
    deletingId,
    updatingId,
    fetch,
    fetchAll,
    getActive,
    publish,
    remove,
    update,
  };
}
