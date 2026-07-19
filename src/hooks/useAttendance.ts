"use client";

import React from "react";
import { supabase as defaultClient } from "@/lib/supabase";

export type AttendanceEntry = {
  rehearsal_id: number;
  user_id: string;
  status: "present" | "late" | "absent" | "excused";
};

export function useAttendance(client: typeof defaultClient = defaultClient) {
  const [map, setMap] = React.useState<Record<number, { status: string }>>({});
  const [list, setList] = React.useState<unknown[]>([]);
  const [loading, setLoading] = React.useState(false);

  /** 团员: 加载自己在当前排练池中的考勤 */
  const fetchMyAttendances = React.useCallback(
    async (userId: string, rehearsalIds: number[]) => {
      if (rehearsalIds.length === 0) {
        setMap({});
        return;
      }
      setLoading(true);
      const { data, error } = await client
        .from("attendances")
        .select("*")
        .eq("user_id", userId)
        .in("rehearsal_id", rehearsalIds);
      setLoading(false);
      if (error || !data) {
        setMap({});
        return;
      }
      const m: Record<number, { status: string }> = {};
      for (const r of data as { rehearsal_id: number; status: string }[]) {
        m[r.rehearsal_id] = { status: r.status };
      }
      setMap(m);
    },
    [client],
  );

  /** 管理员: 查看某场排练的考勤名单 */
  const fetchByRehearsal = React.useCallback(
    async (rehearsalId: number) => {
      setLoading(true);
      const { data, error } = await client
        .from("attendances")
        .select("*")
        .eq("rehearsal_id", rehearsalId);
      setLoading(false);
      if (error) {
        setList([]);
        return [];
      }
      setList(data ?? []);
      return (data ?? []) as unknown[];
    },
    [client],
  );

  /** 团员签到 + 管理员批量 upsert */
  const upsert = React.useCallback(
    async (rows: AttendanceEntry[]) => {
      const { error } = await client
        .from("attendances")
        .upsert(rows as never, { onConflict: "rehearsal_id,user_id" } as never);
      if (error) return error.message;
      return null;
    },
    [client],
  );

  /** 查询区间出勤统计 */
  const fetchStats = React.useCallback(
    async (rehearsalIds: (string | number)[]) => {
      if (rehearsalIds.length === 0) return [];
      setLoading(true);
      const { data, error } = await client
        .from("attendances")
        .select("user_id, status")
        .in("rehearsal_id", rehearsalIds);
      setLoading(false);
      if (error) return [];
      return (data as { user_id: string; status: string }[]) ?? [];
    },
    [client],
  );

  return { map, list, loading, fetchMyAttendances, fetchByRehearsal, upsert, fetchStats };
}
