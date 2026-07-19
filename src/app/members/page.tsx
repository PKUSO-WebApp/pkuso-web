"use client";

import React from "react";
import { supabase } from "@/lib/supabase";
import { INSTRUMENT_ORDER, OTHER_INSTRUMENT_GROUP } from "@/constants/instruments";
import type { ProfileRow, RehearsalRow } from "@/types/database";

function instrumentGroupKey(instrument: string | null): string {
  if (!instrument) return OTHER_INSTRUMENT_GROUP;
  const trimmed = instrument.trim();
  if (INSTRUMENT_ORDER.includes(trimmed as (typeof INSTRUMENT_ORDER)[number])) {
    return trimmed;
  }
  return OTHER_INSTRUMENT_GROUP;
}

export default function MembersPage() {
  const [attendanceOpen, setAttendanceOpen] = React.useState(false);
  const [rosterOpen, setRosterOpen] = React.useState(false);
  const [rosterLoading, setRosterLoading] = React.useState(false);
  const [rosterRows, setRosterRows] = React.useState<ProfileRow[]>([]);
  const [rosterError, setRosterError] = React.useState<string | null>(null);

  // 考勤：合排日程 + 区间 + 统计
  const [rehearsalsLoading, setRehearsalsLoading] = React.useState(false);
  const [rehearsalList, setRehearsalList] = React.useState<RehearsalRow[]>([]);
  /** 在 rehearsalList 中的下标，避免 id 类型与 DB 不一致 */
  const [startRehearsalIndex, setStartRehearsalIndex] = React.useState(0);
  const [endRehearsalIndex, setEndRehearsalIndex] = React.useState(0);
  const [statsLoading, setStatsLoading] = React.useState(false);
  const [statsRows, setStatsRows] = React.useState<
    { userId: string; label: string; count: number }[]
  >([]);
  const [statsError, setStatsError] = React.useState<string | null>(null);

  const fetchRoster = React.useCallback(async () => {
    setRosterLoading(true);
    setRosterError(null);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, email, instrument, status, role, college, join_date, created_at")
      .eq("status", "approved");
    setRosterLoading(false);
    if (error) {
      setRosterError(error.message);
      setRosterRows([]);
      return;
    }
    const rows = (data as ProfileRow[]) ?? [];
    // 彻底过滤管理员，不出现在花名册
    setRosterRows(rows.filter((r) => (r.role ?? "") !== "admin"));
  }, []);

  React.useEffect(() => {
    if (rosterOpen) void fetchRoster();
  }, [rosterOpen, fetchRoster]);

  const grouped = React.useMemo(() => {
    const map = new Map<string, ProfileRow[]>();
    for (const row of rosterRows) {
      const g = instrumentGroupKey(row.instrument);
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(row);
    }
    for (const [, arr] of map) {
      arr.sort((a, b) =>
        String(a.full_name ?? "").localeCompare(String(b.full_name ?? ""), "zh-CN"),
      );
    }
    const ordered: { group: string; users: ProfileRow[] }[] = [];
    for (const key of INSTRUMENT_ORDER) {
      const users = map.get(key);
      if (users && users.length > 0) {
        ordered.push({ group: key, users });
      }
    }
    const otherUsers = map.get(OTHER_INSTRUMENT_GROUP);
    if (otherUsers && otherUsers.length > 0) {
      ordered.push({ group: OTHER_INSTRUMENT_GROUP, users: otherUsers });
    }
    return ordered;
  }, [rosterRows]);

  // 合排日程：title 含「合排」或「全团」，按日期排序
  const fetchRehearsalsForAttendance = React.useCallback(async () => {
    setRehearsalsLoading(true);
    const { data, error } = await supabase
      .from("rehearsals")
      .select("id, title, date, time")
      .order("date", { ascending: true })
      .order("time", { ascending: true });
    setRehearsalsLoading(false);
    if (error || !data) {
      setRehearsalList([]);
      return;
    }
    const list = (data as RehearsalRow[]).filter((r) => {
      const t = (r.title ?? "").trim();
      return t.includes("合排") || t.includes("全团");
    });
    setRehearsalList(list);
    if (list.length > 0) {
      setStartRehearsalIndex(0);
      setEndRehearsalIndex(list.length - 1);
    } else {
      setStartRehearsalIndex(0);
      setEndRehearsalIndex(0);
    }
  }, []);

  React.useEffect(() => {
    if (attendanceOpen) void fetchRehearsalsForAttendance();
  }, [attendanceOpen, fetchRehearsalsForAttendance]);

  // 区间内 rehearsal id 列表（含起止），id 类型与 DB 一致
  const rehearsalIdsInRange = React.useMemo(() => {
    if (rehearsalList.length === 0) return [];
    const startIdx = Math.max(0, Math.min(startRehearsalIndex, rehearsalList.length - 1));
    const endIdx = Math.max(0, Math.min(endRehearsalIndex, rehearsalList.length - 1));
    const lo = Math.min(startIdx, endIdx);
    const hi = Math.max(startIdx, endIdx);
    return rehearsalList.slice(lo, hi + 1).map((r) => r.id);
  }, [rehearsalList, startRehearsalIndex, endRehearsalIndex]);

  const loadAttendanceStats = React.useCallback(async () => {
    if (rehearsalIdsInRange.length === 0) {
      setStatsRows([]);
      setStatsError(null);
      return;
    }
    setStatsLoading(true);
    setStatsError(null);
    const { data, error } = await supabase
      .from("attendances")
      .select("user_id, status")
      .in("rehearsal_id", rehearsalIdsInRange);
    setStatsLoading(false);
    if (error) {
      setStatsError(error.message);
      setStatsRows([]);
      return;
    }
    const rows = (data as { user_id: string; status: string }[]) ?? [];
    // 出勤次数：计 present（或全计，视业务；这里按 present 计次）
    const countMap = new Map<string, number>();
    for (const row of rows) {
      if (row.status !== "present") continue;
      const uid = row.user_id;
      countMap.set(uid, (countMap.get(uid) ?? 0) + 1);
    }
    const userIds = [...countMap.keys()];
    if (userIds.length === 0) {
      setStatsRows([]);
      return;
    }
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, instrument")
      .in("id", userIds);
    const profList =
      (profiles as { id: string; full_name: string | null; instrument: string | null }[]) ?? [];
    const idToProfile = new Map(profList.map((p) => [p.id, p]));
    const result: { userId: string; label: string; count: number }[] = [];
    for (const [userId, count] of countMap) {
      const p = idToProfile.get(userId);
      const name = p?.full_name ?? "—";
      const inst = p?.instrument ?? "—";
      result.push({
        userId,
        label: `${inst} - ${name}`,
        count,
      });
    }
    result.sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
    setStatsRows(result);
  }, [rehearsalIdsInRange]);

  React.useEffect(() => {
    if (!attendanceOpen) return;
    void loadAttendanceStats();
  }, [attendanceOpen, loadAttendanceStats]);

  const handleExportCsv = () => {
    const header = "声部 - 姓名,出勤次数";
    const lines = statsRows.map((r) => `"${String(r.label).replace(/"/g, '""')}",${r.count}`);
    const csv = "\uFEFF" + [header, ...lines].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "乐团合排考勤统计.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 pb-2">
      <header className="mt-1">
        <h1 className="text-lg font-semibold text-zinc-900">成员</h1>
        <p className="mt-1 text-xs text-zinc-500">排练考勤与乐团花名册</p>
      </header>

      {/* 卡片 A：排练考勤 */}
      <button
        type="button"
        onClick={() => setAttendanceOpen(true)}
        className="w-full rounded-2xl border border-zinc-100 bg-white p-4 text-left shadow-[0_1px_4px_rgba(15,23,42,0.06)] transition hover:border-zinc-200"
      >
        <p className="text-sm font-semibold text-zinc-900">排练考勤</p>
        <p className="mt-1 text-xs text-zinc-500">按合排日程区间统计出勤并导出</p>
      </button>

      {/* 卡片 B：全团成员信息统计 */}
      <button
        type="button"
        onClick={() => setRosterOpen(true)}
        className="w-full rounded-2xl border border-zinc-100 bg-white p-4 text-left shadow-[0_1px_4px_rgba(15,23,42,0.06)] transition hover:border-zinc-200"
      >
        <p className="text-sm font-semibold text-zinc-900">全团成员信息</p>
        <p className="mt-1 text-xs text-zinc-500">点击查看乐团最新花名册</p>
      </button>

      {/* Modal A：排练考勤 */}
      {attendanceOpen && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 px-4 pb-safe"
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            aria-label="关闭"
            className="absolute inset-0"
            onClick={() => setAttendanceOpen(false)}
          />
          <div className="relative flex max-h-[85vh] w-full max-w-md flex-col rounded-t-3xl border border-zinc-100 bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-zinc-900">总排练考勤统计</h2>
              <button
                type="button"
                onClick={() => setAttendanceOpen(false)}
                className="rounded-full bg-zinc-100 px-3 py-1 text-[11px] text-zinc-600 hover:bg-zinc-200"
              >
                关闭
              </button>
            </div>

            <p className="mb-2 text-[11px] text-zinc-500">
              仅统计标题含「合排」或「全团」的排练；请选择起止排练
            </p>
            {rehearsalsLoading ? (
              <p className="mb-3 text-xs text-zinc-400">加载合排日程…</p>
            ) : rehearsalList.length === 0 ? (
              <p className="mb-3 text-xs text-amber-600">暂无合排/全团日程，请先在日程中发布</p>
            ) : (
              <div className="mb-3 space-y-2">
                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-zinc-600">起始排练</label>
                  <select
                    value={startRehearsalIndex}
                    onChange={(e) => setStartRehearsalIndex(Number(e.target.value))}
                    className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900"
                  >
                    {rehearsalList.map((r, idx) => (
                      <option key={r.id} value={idx}>
                        {(r.date ?? "—") + " " + (r.time ?? "")} {r.title ?? ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-zinc-600">结束排练</label>
                  <select
                    value={endRehearsalIndex}
                    onChange={(e) => setEndRehearsalIndex(Number(e.target.value))}
                    className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900"
                  >
                    {rehearsalList.map((r, idx) => (
                      <option key={r.id} value={idx}>
                        {(r.date ?? "—") + " " + (r.time ?? "")} {r.title ?? ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={handleExportCsv}
              disabled={statsRows.length === 0}
              className="mb-3 w-full rounded-2xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white shadow-md hover:bg-zinc-800 disabled:opacity-50"
            >
              导出为 Excel (CSV)
            </button>

            <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-zinc-100">
              {statsLoading ? (
                <p className="p-4 text-center text-xs text-zinc-400">统计中…</p>
              ) : statsError ? (
                <p className="p-3 text-sm text-red-600">{statsError}</p>
              ) : statsRows.length === 0 ? (
                <p className="p-4 text-center text-xs text-zinc-500">该区间内暂无出勤记录</p>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-zinc-100 bg-zinc-50">
                      <th className="px-3 py-2 font-medium text-zinc-700">声部 - 姓名</th>
                      <th className="px-3 py-2 font-medium text-zinc-700">出勤次数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statsRows.map((r) => (
                      <tr key={r.userId} className="border-b border-zinc-50 last:border-0">
                        <td className="px-3 py-2 text-zinc-900">{r.label}</td>
                        <td className="px-3 py-2 text-zinc-700">{r.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal B：花名册 */}
      {rosterOpen && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 px-4 pb-safe"
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            aria-label="关闭"
            className="absolute inset-0"
            onClick={() => setRosterOpen(false)}
          />
          <div className="relative flex max-h-[85vh] w-full max-w-md flex-col rounded-t-3xl border border-zinc-100 bg-white shadow-xl transition-all duration-300 ease-out">
            <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-4 py-3">
              <h2 className="text-base font-semibold text-zinc-900">全团成员信息统计</h2>
              <button
                type="button"
                onClick={() => setRosterOpen(false)}
                className="rounded-full bg-zinc-100 px-3 py-1 text-[11px] text-zinc-600 hover:bg-zinc-200"
              >
                关闭
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {rosterLoading ? (
                <p className="py-8 text-center text-xs text-zinc-400">加载中…</p>
              ) : rosterError ? (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{rosterError}</p>
              ) : grouped.length === 0 ? (
                <p className="py-8 text-center text-xs text-zinc-500">暂无已通过成员</p>
              ) : (
                <div className="space-y-5">
                  {grouped.map(({ group, users }) => (
                    <div key={group}>
                      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                        {group}
                      </p>
                      <ul className="space-y-2">
                        {users.map((u) => (
                          <li
                            key={u.id}
                            className="rounded-xl border border-zinc-100 bg-zinc-50/80 px-3 py-2 text-xs"
                          >
                            <p className="font-medium text-zinc-900">
                              {(u.instrument ?? "—") + " - " + (u.full_name ?? "—")}
                            </p>
                            <p className="mt-0.5 text-zinc-500">学院：{u.college?.trim() || "—"}</p>
                            <p className="mt-0.5 text-zinc-500">邮箱：{u.email ?? "—"}</p>
                            <p className="mt-0.5 text-zinc-400">
                              入团时间：{u.join_date?.trim() || "—"}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
