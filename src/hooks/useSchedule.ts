"use client";

import React from "react";
import { supabase as defaultClient } from "@/lib/supabase";
import type { RehearsalRow, ScheduleRow } from "@/types/database";

export function useSchedule(client: typeof defaultClient = defaultClient) {
  const [data, setData] = React.useState<ScheduleRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  /**
   * 最近一次 error 的**同步可读**副本，经 `getLastError()` 出给调用方。
   *
   * 为什么光有 `error` state 不够（这正是「置一个**可见**的 error」落不了地的原因）：
   * 调用方是在 `await remove(...)` / `await update(...)` 返回后的**同一个闭包**里决定
   * 文案的（如甘特图失败时那句提示），而 `setError` 要到下一次渲染才进那个闭包
   * ⇒ 那里读 `error` 拿到的是**上一次**的值（首次失败时是 `null`），
   * 于是「没有匹配的记录，…」永远显示不出来、只剩通用文案。
   */
  const lastErrorRef = React.useRef<string | null>(null);
  const reportError = React.useCallback((message: string | null) => {
    lastErrorRef.current = message;
    setError(message);
  }, []);
  const getLastError = React.useCallback(() => lastErrorRef.current, []);

  const fetch = React.useCallback(
    async (date?: string) => {
      setLoading(true);
      let query = client.from("schedules").select("*").order("start_time", { ascending: true });

      if (date) {
        // 按本地日期筛选，避免时区问题
        const [year, month, day] = date.split("-").map(Number);
        // 手动构造本地时间的 ISO 字符串，避免 toISOString() 的时区转换
        const startOfDay = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00`;
        const endOfDay = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T23:59:59`;

        query = query.gte("start_time", startOfDay).lte("start_time", endOfDay);
      }

      const { data: rows, error: dbError } = await query;
      setLoading(false);
      if (dbError) {
        reportError(dbError.message);
        setData([]);
        return;
      }
      setData((rows as ScheduleRow[]) ?? []);
    },
    [client, reportError],
  );

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetch();
  }, [fetch]);

  const create = React.useCallback(
    async (payload: Record<string, unknown>, date?: string) => {
      setSaving(true);
      const { error: dbError } = await client.from("schedules").insert([payload] as never);
      setSaving(false);
      if (dbError) {
        reportError(dbError.message);
        return false;
      }
      reportError(null);
      await fetch(date);
      return true;
    },
    [client, fetch, reportError],
  );

  const update = React.useCallback(
    async (id: number, payload: Record<string, unknown>, date?: string) => {
      setSaving(true);
      // 链 .select("id") 做 0 行检测：命中 0 行时无 error（RLS 静默拒绝 / 记录已被并发删除），
      // 若按成功处理会重取列表后显示「没变」而宣称成功（Issue #368）
      const { data: updated, error: dbError } = await client
        .from("schedules")
        .update(payload as never)
        .eq("id", id)
        .select("id");
      setSaving(false);
      if (dbError) {
        reportError(dbError.message);
        return false;
      }
      if (!updated || updated.length === 0) {
        reportError("没有匹配的记录，预约可能已被删除");
        return false;
      }
      reportError(null);
      await fetch(date);
      return true;
    },
    [client, fetch, reportError],
  );

  const remove = React.useCallback(
    async (id: number, date?: string) => {
      setSaving(true);
      // 同 update：0 行时不能报成功（Issue #368）
      const { data: deleted, error: dbError } = await client
        .from("schedules")
        .delete()
        .eq("id", id)
        .select("id");
      setSaving(false);
      if (dbError) {
        reportError(dbError.message);
        return false;
      }
      if (!deleted || deleted.length === 0) {
        reportError("没有匹配的记录，预约可能已被删除");
        return false;
      }
      reportError(null);
      await fetch(date);
      return true;
    },
    [client, fetch, reportError],
  );

  // 检查时间冲突（不支持跨天预约）
  const checkConflict = React.useCallback(
    async (
      date: string,
      startTime: string,
      endTime: string,
      excludeRehearsalId?: number,
    ): Promise<string | null> => {
      const [year, month, day] = date.split("-").map(Number);
      const startOfDay = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00`;
      const endOfDay = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T23:59:59`;

      const startDateTime = `${date}T${startTime}:00`;
      const endDateTime = `${date}T${endTime}:00`;

      // 只查人工预约：rehearsal_id 非空的行是排练触发器生成的影子行，
      // 由下方排练分支统一检查（编辑排练时 neq 排除自身，避免自己和自己冲突；
      // 若此处混入影子行，编辑排练会误报「该时间段已有其他预约」，且文案不准确）
      const { data: existingSchedules, error: scheduleError } = await client
        .from("schedules")
        .select("*")
        .gte("start_time", startOfDay)
        .lte("start_time", endOfDay)
        .is("rehearsal_id", null);

      if (scheduleError) {
        return "查询预约失败";
      }

      // 查询当天的排练（排除正在编辑的排练）
      const { data: rehearsals, error: rehearsalError } = await client
        .from("rehearsals")
        .select("*")
        .gte("start_time", startOfDay)
        .lte("start_time", endOfDay)
        .neq("id", excludeRehearsalId ?? -1);

      if (rehearsalError) {
        return "查询排练安排失败";
      }

      // 检查与已有预约的冲突
      const scheduleConflict = (existingSchedules as ScheduleRow[])?.find((s) => {
        // 时间重叠条件：新预约开始 < 已有结束，且新预约结束 > 已有开始
        return startDateTime < (s.end_time || s.start_time) && endDateTime > s.start_time;
      });

      if (scheduleConflict) {
        return "该时间段已有其他预约";
      }

      // 检查与排练的冲突
      const rehearsalConflict = (rehearsals as RehearsalRow[])?.find((r) => {
        const rehearsalStart = r.start_time;
        const rehearsalEnd = r.end_time || r.start_time;
        if (!rehearsalStart || !rehearsalEnd) return false;
        return startDateTime < rehearsalEnd && endDateTime > rehearsalStart;
      });

      if (rehearsalConflict) {
        return "该时间段已有排练安排";
      }

      return null;
    },
    [client],
  );

  return {
    data,
    loading,
    error,
    saving,
    fetch,
    create,
    update,
    remove,
    checkConflict,
    getLastError,
  };
}
