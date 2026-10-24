"use client";

import React from "react";
import { supabase as defaultClient } from "@/lib/supabase";
import type { DecisionResponse, DecisionResult } from "@/lib/attendance-change-request";
import type { AttendanceChangeRequestWithDetails } from "@/types/database";

/**
 * P4'：出勤修改申请的读取与审批数据层。
 *
 * 读列表走 service role API（需要 join 成员/排练）；审批走同一个 API，
 * 由 backend RPC 保证考勤状态、申请状态和通知在同一事务里完成。
 */
export function useAttendanceChangeRequests(client: typeof defaultClient = defaultClient) {
  const [requests, setRequests] = React.useState<AttendanceChangeRequestWithDetails[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [processing, setProcessing] = React.useState(false);
  const processingRef = React.useRef(false);
  const fetchSeqRef = React.useRef(0);

  const authHeaders = React.useCallback(async () => {
    const {
      data: { session },
    } = await client.auth.getSession();
    return {
      "Content-Type": "application/json",
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    };
  }, [client]);

  const fetch = React.useCallback(
    async (opts?: { keepOnError?: boolean }) => {
      const seq = ++fetchSeqRef.current;
      setLoading(true);
      setError(null);
      try {
        const response = await window.fetch("/api/admin/attendance-requests", {
          method: "GET",
          headers: await authHeaders(),
        });
        if (seq !== fetchSeqRef.current) return [];
        const result = (await response.json().catch(() => ({}))) as {
          requests?: AttendanceChangeRequestWithDetails[];
          error?: string;
        };
        if (seq !== fetchSeqRef.current) return [];
        if (!response.ok || !Array.isArray(result.requests)) {
          setError(result.error || "获取考勤修改申请失败");
          if (!opts?.keepOnError) setRequests([]);
          return [];
        }
        const list = result.requests;
        setRequests(list);
        return list;
      } catch {
        if (seq !== fetchSeqRef.current) return [];
        setError("网络错误");
        if (!opts?.keepOnError) setRequests([]);
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

  const decide = React.useCallback(
    async (body: {
      action: "approve" | "reject";
      ids: string[];
      force?: boolean;
      rejectReason?: string;
    }): Promise<DecisionResponse> => {
      if (processingRef.current) {
        return { ok: false, results: [], error: "操作进行中，请稍候" };
      }
      processingRef.current = true;
      setProcessing(true);
      setError(null);
      try {
        const response = await window.fetch("/api/admin/attendance-requests", {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify(body),
        });
        const result = (await response.json().catch(() => ({}))) as {
          results?: DecisionResult[];
          error?: string;
        };
        if (!response.ok || !Array.isArray(result.results)) {
          const message = result.error || "处理失败，请重试";
          // 非 2xx 时服务端可能已处理了部分条目；重拉一次对账，避免 UI 仍显示 pending。
          await fetch({ keepOnError: true });
          return { ok: false, results: [], error: message };
        }
        const results = result.results;
        const resultIds = new Set(results.map((item) => item.id));
        const complete =
          results.length === body.ids.length && body.ids.every((id) => resultIds.has(id));
        await fetch({ keepOnError: true });
        if (!complete) {
          return {
            ok: false,
            results: [],
            error: "审批结果不完整，请刷新后确认",
          };
        }
        return { ok: true, results };
      } catch {
        return { ok: false, results: [], error: "网络错误" };
      } finally {
        processingRef.current = false;
        setProcessing(false);
      }
    },
    [authHeaders, fetch],
  );

  const approve = React.useCallback(
    (ids: string[], force = false) => decide({ action: "approve", ids, force }),
    [decide],
  );

  const reject = React.useCallback(
    (ids: string[], rejectReason: string) => decide({ action: "reject", ids, rejectReason }),
    [decide],
  );

  return { requests, loading, error, processing, fetch, approve, reject };
}
