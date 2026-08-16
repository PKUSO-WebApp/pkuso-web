"use client";

import React from "react";
import { supabase as defaultClient } from "@/lib/supabase";
import type { LeaveRequestWithDetails } from "@/types/database";

/**
 * 管理端请假审批 hook（Issue #142）。
 * 走 /api/admin/leave（service role 绕过 RLS），返回列表/审批结果。
 * 审批成功后本地移除已处理行（避免整页刷新），附件签名 URL 单独按需换取。
 */
export function useLeaveAdmin(client: typeof defaultClient = defaultClient) {
  const [requests, setRequests] = React.useState<LeaveRequestWithDetails[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [processing, setProcessing] = React.useState(false);
  // 同步 guard：防连点批量操作（setState 异步有竞态窗口，CLAUDE.md 防重复提交范式）
  const processingRef = React.useRef(false);

  const authHeaders = React.useCallback(async () => {
    const {
      data: { session },
    } = await client.auth.getSession();
    return {
      "Content-Type": "application/json",
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    };
  }, [client]);

  /** 拉取全部申请（按 created_at 倒序） */
  const fetch = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await window.fetch("/api/admin/leave", {
        method: "GET",
        headers: await authHeaders(),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error || "获取请假申请失败");
        setRequests([]);
        return [];
      }
      const list = (result.requests as LeaveRequestWithDetails[]) ?? [];
      setRequests(list);
      return list;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_err: unknown) {
      setError("网络错误");
      setRequests([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetch();
  }, [fetch]);

  /**
   * 批量通过（逐条联动考勤，由服务端处理）。
   * 返回 { ok, warnings }：warnings 透传 API 响应的提示消息数组
   * （如成员已实际签到、考勤未联动），供管理端 UI 逐条展示（Issue #159 返工）。
   */
  const approve = React.useCallback(
    async (ids: string[]): Promise<{ ok: boolean; warnings: string[] }> => {
      if (processingRef.current) return { ok: false, warnings: [] };
      processingRef.current = true;
      setProcessing(true);
      try {
        const response = await window.fetch("/api/admin/leave", {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify({ action: "approve", ids }),
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
          setError(result.error || "批量通过失败");
          return { ok: false, warnings: [] };
        }
        // 本地移除已处理行（部分失败时只移除成功项）
        const processedIds = (result.processed as string[]) ?? [];
        setRequests((prev) => prev.filter((r) => !processedIds.includes(r.id)));
        setError(null);
        // warnings 消息数组透传（未提供时为空数组）
        const warnings: string[] = Array.isArray(result.warnings)
          ? (result.warnings as { message: string }[]).map((w) => w.message)
          : [];
        return { ok: true, warnings };
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_err: unknown) {
        setError("网络错误");
        return { ok: false, warnings: [] };
      } finally {
        processingRef.current = false;
        setProcessing(false);
      }
    },
    [authHeaders],
  );

  /** 批量驳回（原因必填，同一原因应用到全部勾选） */
  const reject = React.useCallback(
    async (ids: string[], reason: string) => {
      if (processingRef.current) return false;
      processingRef.current = true;
      setProcessing(true);
      try {
        const response = await window.fetch("/api/admin/leave", {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify({ action: "reject", ids, reject_reason: reason }),
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
          setError(result.error || "批量驳回失败");
          return false;
        }
        const processedIds = (result.processed as string[]) ?? [];
        setRequests((prev) => prev.filter((r) => !processedIds.includes(r.id)));
        setError(null);
        return true;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_err: unknown) {
        setError("网络错误");
        return false;
      } finally {
        processingRef.current = false;
        setProcessing(false);
      }
    },
    [authHeaders],
  );

  /** 为私有桶附件换取 60s 签名 URL（admin 查看成员附件用） */
  const getSignedUrl = React.useCallback(
    async (path: string) => {
      try {
        const response = await window.fetch("/api/admin/leave", {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify({ action: "signed-url", path }),
        });
        const result = await response.json();
        if (!response.ok || typeof result.url !== "string") return null;
        return result.url as string;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_err: unknown) {
        return null;
      }
    },
    [authHeaders],
  );

  return { requests, loading, error, processing, fetch, approve, reject, getSignedUrl };
}
