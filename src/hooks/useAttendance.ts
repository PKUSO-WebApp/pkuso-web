"use client";

import React from "react";
import { supabase as defaultClient } from "@/lib/supabase";
import type { AttendanceRowWithUser, AttendanceStatus } from "@/types/database";

export type AttendanceEntry = {
  rehearsal_id: number;
  user_id: string;
  status: "present" | "late" | "absent" | "excused";
  sign_in_time?: string | null;
};

export function useAttendance(client: typeof defaultClient = defaultClient) {
  const [map, setMap] = React.useState<Record<number, { status: string }>>({});
  const [list, setList] = React.useState<AttendanceRowWithUser[]>([]);
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

  /** 管理员: 查看某场排练的考勤名单（含 profiles） */
  const fetchByRehearsal = React.useCallback(
    async (rehearsalId: number) => {
      setLoading(true);
      const { data, error } = await client
        .from("attendances")
        .select("*, profiles!inner(full_name, instrument)")
        .eq("rehearsal_id", rehearsalId);
      setLoading(false);
      if (error) {
        setList([]);
        return [];
      }
      const rows = (data ?? []) as AttendanceRowWithUser[];
      setList(rows);
      return rows;
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

  /** 管理员: 更新单条出勤状态 */
  const updateStatus = React.useCallback(
    async (rehearsalId: number, userId: string, status: AttendanceStatus) => {
      const { error } = await client
        .from("attendances")
        .update({ status })
        .eq("rehearsal_id", rehearsalId)
        .eq("user_id", userId);
      if (error) return error.message;
      return null;
    },
    [client],
  );

  /** 管理员: 批量插入出勤记录（创建排练时自动生成） */
  const batchInsert = React.useCallback(
    async (rows: AttendanceEntry[]) => {
      if (rows.length === 0) return null;
      const { error } = await client.from("attendances").insert(rows as never);
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

  return {
    map,
    list,
    loading,
    fetchMyAttendances,
    fetchByRehearsal,
    upsert,
    updateStatus,
    batchInsert,
    fetchStats,
  };
}
