"use client";

import React from "react";
import { supabase as defaultClient } from "@/lib/supabase";
import type { RehearsalRow, ScheduleRow } from "@/types/database";

export function useSchedule(client: typeof defaultClient = defaultClient) {
  const [data, setData] = React.useState<ScheduleRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

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
        setError(dbError.message);
        setData([]);
        return;
      }
      setData((rows as ScheduleRow[]) ?? []);
    },
    [client],
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
        setError(dbError.message);
        return false;
      }
      setError(null);
      await fetch(date);
      return true;
    },
    [client, fetch],
  );

  const update = React.useCallback(
    async (id: number, payload: Record<string, unknown>, date?: string) => {
      setSaving(true);
      const { error: dbError } = await client
        .from("schedules")
        .update(payload as never)
        .eq("id", id);
      setSaving(false);
      if (dbError) {
        setError(dbError.message);
        return false;
      }
      setError(null);
      await fetch(date);
      return true;
    },
    [client, fetch],
  );

  const remove = React.useCallback(
    async (id: number, date?: string) => {
      setSaving(true);
      const { error: dbError } = await client.from("schedules").delete().eq("id", id);
      setSaving(false);
      if (dbError) {
        setError(dbError.message);
        return false;
      }
      setError(null);
      await fetch(date);
      return true;
    },
    [client, fetch],
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

      // 查询当天的预约
      const { data: existingSchedules, error: scheduleError } = await client
        .from("schedules")
        .select("*")
        .gte("start_time", startOfDay)
        .lte("start_time", endOfDay);

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

  return { data, loading, error, saving, fetch, create, update, remove, checkConflict };
}
