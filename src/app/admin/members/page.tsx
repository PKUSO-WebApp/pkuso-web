"use client";

import React from "react";
import { useRehearsals } from "@/hooks/useRehearsals";
import { useProfiles } from "@/hooks/useProfiles";
import { Toggle } from "@/components/ui/Toggle";
import { INSTRUMENT_ORDER, OTHER_INSTRUMENT_GROUP } from "@/constants/instruments";
import type { ProfileRow } from "@/types/database";

function instrumentGroupKey(instrument: string | null): string {
  if (!instrument) return OTHER_INSTRUMENT_GROUP;
  const trimmed = instrument.trim();
  if (INSTRUMENT_ORDER.includes(trimmed as (typeof INSTRUMENT_ORDER)[number])) return trimmed;
  return OTHER_INSTRUMENT_GROUP;
}

type ViewMode = "attendance" | "roster";

export default function MembersPage() {
  const [currentView, setCurrentView] = React.useState<ViewMode>("attendance");

  // 花名册
  const {
    data: allProfiles,
    loading: rosterLoading,
    error: rosterError,
  } = useProfiles({ status: "approved" });
  const rosterRows = React.useMemo(
    () => allProfiles.filter((r) => (r.role ?? "") !== "admin") as ProfileRow[],
    [allProfiles],
  );

  const grouped = React.useMemo(() => {
    const map = new Map<string, ProfileRow[]>();
    for (const row of rosterRows) {
      const g = instrumentGroupKey(row.instrument);
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(row);
    }
    for (const [, arr] of map)
      arr.sort((a, b) =>
        String(a.full_name ?? "").localeCompare(String(b.full_name ?? ""), "zh-CN"),
      );
    const ordered: { group: string; users: ProfileRow[] }[] = [];
    for (const key of INSTRUMENT_ORDER) {
      const u = map.get(key);
      if (u?.length) ordered.push({ group: key, users: u });
    }
    const other = map.get(OTHER_INSTRUMENT_GROUP);
    if (other?.length) ordered.push({ group: OTHER_INSTRUMENT_GROUP, users: other });
    return ordered;
  }, [rosterRows]);

  // 考勤统计
  const { data: allRehearsals } = useRehearsals();
  const rehearsalList = React.useMemo(
    () =>
      allRehearsals.filter(
        (r) => (r.title ?? "").includes("合排") || (r.title ?? "").includes("全团"),
      ),
    [allRehearsals],
  );
  const [startIdx, setStartIdx] = React.useState(0);
  const [endIdx, setEndIdx] = React.useState(rehearsalList.length - 1);
  const [statsLoading, setStatsLoading] = React.useState(false);
  const [statsRows, setStatsRows] = React.useState<
    { userId: string; label: string; count: number }[]
  >([]);
  const [statsError, setStatsError] = React.useState<string | null>(null);

  const loadStats = React.useCallback(async () => {
    const lo = Math.min(startIdx, endIdx);
    const hi = Math.max(startIdx, endIdx);
    const ids = rehearsalList.slice(lo, hi + 1).map((r) => r.id);
    if (ids.length === 0) return;
    setStatsLoading(true);
    const { supabase } = await import("@/lib/supabase");
    const { data: rows, error } = await supabase
      .from("attendances")
      .select("user_id, status")
      .in("rehearsal_id", ids);
    setStatsLoading(false);
    if (error) {
      setStatsError(error.message);
      return;
    }
    const countMap = new Map<string, number>();
    for (const r of (rows as { user_id: string; status: string }[]) ?? []) {
      if (r.status === "present") countMap.set(r.user_id, (countMap.get(r.user_id) ?? 0) + 1);
    }
    const uids = [...countMap.keys()];
    if (uids.length === 0) {
      setStatsRows([]);
      return;
    }
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, instrument")
      .in("id", uids);
    const idMap = new Map(
      (
        profiles as { id: string; full_name: string | null; instrument: string | null }[] | null
      )?.map((p) => [p.id, p]) ?? [],
    );
    const result = [...countMap]
      .map(([uid, c]) => {
        const p = idMap.get(uid);
        return { userId: uid, label: `${p?.instrument ?? "—"} - ${p?.full_name ?? "—"}`, count: c };
      })
      .sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
    setStatsRows(result);
  }, [rehearsalList, startIdx, endIdx]);

  React.useEffect(() => {
    if (currentView === "attendance" && rehearsalList.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEndIdx(rehearsalList.length - 1);
      void loadStats();
    }
  }, [currentView, rehearsalList, loadStats]);

  const exportCsv = () => {
    const csv =
      "﻿" +
      ["声部 - 姓名,出勤次数", ...statsRows.map((r) => `"${r.label}",${r.count}`)].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "乐团合排考勤统计.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4 pb-2">
      <header className="mt-1">
        <h1 className="text-lg font-semibold text-text">成员</h1>
        <p className="mt-1 text-xs text-text-muted">排练考勤与乐团花名册</p>
      </header>

      <Toggle
        options={["排练考勤", "全团成员"] as const}
        value={currentView === "attendance" ? "排练考勤" : "全团成员"}
        onChange={(v) => setCurrentView(v === "排练考勤" ? "attendance" : "roster")}
      />

      {currentView === "attendance" && (
        <section>
          <p className="mb-2 text-label text-text-muted">仅统计标题含「合排」或「全团」的排练</p>
          {rehearsalList.length === 0 ? (
            <p className="text-xs text-warning">暂无合排日程</p>
          ) : (
            <div className="mb-3 space-y-2">
              <div>
                <label className="block text-label font-medium text-text-muted">起始</label>
                <select
                  value={startIdx}
                  onChange={(e) => setStartIdx(Number(e.target.value))}
                  className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-sm text-text"
                >
                  {rehearsalList.map((r, i) => (
                    <option key={r.id} value={i}>
                      {r.date ?? "—"} {r.title ?? ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-label font-medium text-text-muted">结束</label>
                <select
                  value={endIdx}
                  onChange={(e) => setEndIdx(Number(e.target.value))}
                  className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-sm text-text"
                >
                  {rehearsalList.map((r, i) => (
                    <option key={r.id} value={i}>
                      {r.date ?? "—"} {r.title ?? ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={exportCsv}
            disabled={statsRows.length === 0}
            className="mb-3 w-full rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-md hover:opacity-90 disabled:opacity-50"
          >
            导出为 Excel (CSV)
          </button>
          <div className="rounded-xl border border-border min-h-0 flex-1 overflow-auto">
            {statsLoading ? (
              <p className="p-4 text-center text-xs text-text-subtle">统计中…</p>
            ) : statsError ? (
              <p className="p-3 text-sm text-danger">{statsError}</p>
            ) : statsRows.length === 0 ? (
              <p className="p-4 text-center text-xs text-text-muted">该区间暂无出勤记录</p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border bg-card">
                    <th className="px-3 py-2 font-medium text-text">声部 - 姓名</th>
                    <th className="px-3 py-2 font-medium text-text">出勤次数</th>
                  </tr>
                </thead>
                <tbody>
                  {statsRows.map((r) => (
                    <tr key={r.userId} className="border-b border-border-light last:border-0">
                      <td className="px-3 py-2 text-text">{r.label}</td>
                      <td className="px-3 py-2 text-text">{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      {currentView === "roster" && (
        <div className="max-h-[300px] space-y-5 overflow-y-auto">
          {rosterLoading ? (
            <p className="py-8 text-center text-xs text-text-subtle">加载中…</p>
          ) : rosterError ? (
            <p className="rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger">{rosterError}</p>
          ) : grouped.length === 0 ? (
            <p className="py-8 text-center text-xs text-text-muted">暂无已通过成员</p>
          ) : (
            grouped.map(({ group, users }) => (
              <div key={group}>
                <p className="mb-2 text-label font-medium uppercase tracking-wide text-text-muted">
                  {group}
                </p>
                <ul className="space-y-2">
                  {users.map((u) => (
                    <li
                      key={u.id}
                      className="rounded-xl border border-border bg-card px-3 py-2 text-xs"
                    >
                      <p className="font-medium text-text">
                        {(u.instrument ?? "—") + " - " + (u.full_name ?? "—")}
                      </p>
                      <p className="mt-0.5 text-text-muted">学院：{u.college?.trim() || "—"}</p>
                      <p className="mt-0.5 text-text-muted">邮箱：{u.email ?? "—"}</p>
                      <p className="mt-0.5 text-text-subtle">
                        入团时间：{u.join_date?.trim() || "—"}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
