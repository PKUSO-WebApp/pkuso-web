"use client";

import React from "react";
import { supabase as defaultClient } from "@/lib/supabase";
import type { LeaveRequestWithDetails } from "@/types/database";

/**
 * 管理端请假审批 hook（Issue #142）。
 * 走 /api/admin/leave（service role 绕过 RLS），返回列表/审批结果。
 * 审批/驳回成功后静默重拉列表（Issue #190）：行保留（切到已处理 tab 可见），
 * 状态/驳回原因等字段以服务端为准；附件签名 URL 单独按需换取。
 * 竞态加固（Issue #190 对抗）：fetch 带递增序号守卫丢弃过期响应；
 * 审批后重拉失败保留旧列表（仅提示错误，不误伤已处理结果）。
 */

/**
 * 组装审批/驳回响应提示（Issue #190 对抗）：
 * warnings 数组透传 + failed（申请不存在/已处理/异常）并入文案，供 UI alert 逐条展示。
 * failed 项从最新列表反查成员名（查不到退化为 id，避免闭包过期）。
 */
function buildWarnings(
  result: {
    warnings?: { id: string; message: string }[];
    failed?: { id: string; error: string }[];
  },
  requestsRef: React.MutableRefObject<LeaveRequestWithDetails[]>,
): string[] {
  const warnings: string[] = Array.isArray(result.warnings)
    ? result.warnings.map((w) => w.message)
    : [];
  const failed: { id: string; error: string }[] = Array.isArray(result.failed)
    ? (result.failed as { id: string; error: string }[])
    : [];
  if (failed.length > 0) {
    const names = failed.map((f) => {
      const fullName = requestsRef.current.find((r) => r.id === f.id)?.profiles?.full_name;
      return fullName ? `${fullName}（${f.error}）` : `${f.id}（${f.error}）`;
    });
    warnings.push(`有 ${failed.length} 条申请未被处理：${names.join("、")}`);
  }
  return warnings;
}

export function useLeaveAdmin(client: typeof defaultClient = defaultClient) {
  const [requests, setRequests] = React.useState<LeaveRequestWithDetails[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [processing, setProcessing] = React.useState(false);
  // 同步 guard：防连点批量操作（setState 异步有竞态窗口，CLAUDE.md 防重复提交范式）
  const processingRef = React.useRef(false);
  // 递增序号守卫（CLAUDE.md 竞态守卫范式）：快速连续刷新/审批并发时丢弃过期 GET 响应
  const fetchSeqRef = React.useRef(0);
  // 最新列表引用：buildWarnings 反查 failed 项成员名用（避免 useCallback 闭包过期）
  const requestsRef = React.useRef<LeaveRequestWithDetails[]>([]);

  const authHeaders = React.useCallback(async () => {
    const {
      data: { session },
    } = await client.auth.getSession();
    return {
      "Content-Type": "application/json",
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    };
  }, [client]);

  /**
   * 拉取全部申请（按 created_at 倒序）。
   * keepOnError: true 时失败仅 setError、保留旧列表（审批/驳回后的静默重拉用，
   * 避免重拉失败把已处理结果与旧列表一并清空）；false（默认）时失败清空列表（首次加载/手动刷新）。
   */
  const fetch = React.useCallback(
    async (opts?: { keepOnError?: boolean }) => {
      const seq = ++fetchSeqRef.current;
      setLoading(true);
      setError(null);
      try {
        const response = await window.fetch("/api/admin/leave", {
          method: "GET",
          headers: await authHeaders(),
        });
        if (seq !== fetchSeqRef.current) return [];
        const result = await response.json();
        if (seq !== fetchSeqRef.current) return [];
        if (!response.ok) {
          setError(result.error || "获取请假申请失败");
          if (!opts?.keepOnError) {
            setRequests([]);
            requestsRef.current = [];
          }
          return [];
        }
        const list = (result.requests as LeaveRequestWithDetails[]) ?? [];
        if (seq !== fetchSeqRef.current) return [];
        setRequests(list);
        requestsRef.current = list;
        return list;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_err: unknown) {
        if (seq !== fetchSeqRef.current) return [];
        setError("网络错误");
        if (!opts?.keepOnError) {
          setRequests([]);
          requestsRef.current = [];
        }
        return [];
      } finally {
        if (seq === fetchSeqRef.current) setLoading(false);
      }
    },
    [authHeaders],
  );

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
        // 审批成功后静默重拉列表（Issue #190）：行保留（已处理 tab 可见），
        // 状态/驳回原因等字段以服务端为准；部分失败时服务端未处理的行重拉后仍为 pending。
        // keepOnError：重拉失败仅提示错误、保留旧列表（不误伤已处理结果）。
        await fetch({ keepOnError: true });
        // warnings 透传 + failed（已被处理/不存在的行）并入提示文案
        const warnings = buildWarnings(result, requestsRef);
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
    [authHeaders, fetch],
  );

  /**
   * 批量驳回（原因必填，同一原因应用到全部勾选）。
   * 返回 { ok, warnings }（与 approve 同构，Issue #190 对抗）：warnings 含 failed
   * （申请不存在/已处理/异常）提示，供 UI 逐条展示。
   */
  const reject = React.useCallback(
    async (ids: string[], reason: string): Promise<{ ok: boolean; warnings: string[] }> => {
      if (processingRef.current) return { ok: false, warnings: [] };
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
          return { ok: false, warnings: [] };
        }
        // 驳回成功后静默重拉列表（Issue #190）：行保留，驳回原因以服务端为准；
        // keepOnError：重拉失败仅提示错误、保留旧列表。
        await fetch({ keepOnError: true });
        const warnings = buildWarnings(result, requestsRef);
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
    [authHeaders, fetch],
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
