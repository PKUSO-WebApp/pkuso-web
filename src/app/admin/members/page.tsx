"use client";

import React from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { useRehearsals } from "@/hooks/useRehearsals";
import { useProfiles } from "@/hooks/useProfiles";
import { Toggle } from "@/components/ui/Toggle";
import { INSTRUMENT_ORDER, OTHER_INSTRUMENT_GROUP } from "@/constants/instruments";
import { parseLocalISO } from "@/lib/date-utils";
import type { ProfileRow, RehearsalRow } from "@/types/database";
import * as XLSX from "xlsx";

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

  // 考勤查看
  const { data: allRehearsals } = useRehearsals();
  const [attendanceStartDate, setAttendanceStartDate] = React.useState<Date | null>(null);
  const [attendanceEndDate, setAttendanceEndDate] = React.useState<Date | null>(null);
  const [exportingId, setExportingId] = React.useState<number | null>(null);
  const [exportingAll, setExportingAll] = React.useState(false);

  // 按日期区间筛选排练（默认显示全部）
  const filteredRehearsals = React.useMemo(() => {
    return allRehearsals
      .filter((r) => {
        if (!r.start_time) return false;
        const d = parseLocalISO(r.start_time);
        if (attendanceStartDate && d < attendanceStartDate) return false;
        if (attendanceEndDate) {
          const endOfDay = new Date(attendanceEndDate);
          endOfDay.setHours(23, 59, 59, 999);
          if (d > endOfDay) return false;
        }
        return true;
      })
      .sort((a, b) => (a.start_time! < b.start_time! ? 1 : -1));
  }, [allRehearsals, attendanceStartDate, attendanceEndDate]);

  const STATUS_LABEL: Record<string, string> = {
    present: "出席",
    late: "迟到",
    absent: "缺席",
    excused: "请假",
  };

  // 导出单场排练出勤记录
  const exportSingleRehearsal = async (rehearsal: RehearsalRow) => {
    setExportingId(rehearsal.id);
    try {
      const { supabase } = await import("@/lib/supabase");
      const { data } = await supabase
        .from("attendances")
        .select("*, profiles!inner(full_name, instrument, email)")
        .eq("rehearsal_id", rehearsal.id);
      if (!data || data.length === 0) {
        alert("该排练暂无出勤记录");
        return;
      }
      const rows = (data as Array<Record<string, unknown>>).map((r) => [
        (r.profiles as { full_name?: string } | null)?.full_name ?? "—",
        (r.profiles as { email?: string } | null)?.email ?? "—",
        STATUS_LABEL[String(r.status ?? "")] ?? String(r.status ?? "—"),
        (r.sign_in_time as string) ?? "—",
      ]);
      const sheetData = [["姓名", "邮箱", "出勤情况", "签到时间"], ...rows];
      const ws = XLSX.utils.aoa_to_sheet(sheetData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "考勤记录");
      const dateStr = rehearsal.start_time
        ? parseLocalISO(rehearsal.start_time).toISOString().slice(0, 10)
        : "";
      XLSX.writeFile(wb, `考勤记录_${rehearsal.repertoire ?? "排练"}_${dateStr}.xlsx`);
    } finally {
      setExportingId(null);
    }
  };

  // 导出区间内全部排练出勤记录（每个排练一个 sheet）
  const exportAllRehearsals = async () => {
    if (filteredRehearsals.length === 0) return;
    setExportingAll(true);
    try {
      const { supabase } = await import("@/lib/supabase");
      const wb = XLSX.utils.book_new();

      for (const rehearsal of filteredRehearsals) {
        const { data } = await supabase
          .from("attendances")
          .select("*, profiles!inner(full_name, instrument, email)")
          .eq("rehearsal_id", rehearsal.id);
        const rows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => [
          (r.profiles as { full_name?: string } | null)?.full_name ?? "—",
          (r.profiles as { email?: string } | null)?.email ?? "—",
          STATUS_LABEL[String(r.status ?? "")] ?? String(r.status ?? "—"),
          (r.sign_in_time as string) ?? "—",
        ]);
        const sheetData = [["姓名", "邮箱", "出勤情况", "签到时间"], ...rows];
        const ws = XLSX.utils.aoa_to_sheet(sheetData);
        const dateStr = rehearsal.start_time
          ? parseLocalISO(rehearsal.start_time).toISOString().slice(0, 10)
          : "";
        const sheetName = `${rehearsal.repertoire ?? "排练"}_${dateStr}`.slice(0, 31);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      }

      const startStr = attendanceStartDate
        ? attendanceStartDate.toISOString().slice(0, 10)
        : "全部";
      const endStr = attendanceEndDate ? attendanceEndDate.toISOString().slice(0, 10) : "全部";
      XLSX.writeFile(wb, `考勤记录_${startStr}_${endStr}.xlsx`);
    } finally {
      setExportingAll(false);
    }
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
          <div className="mb-3 flex items-center gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-text-muted">开始时间</label>
              <DatePicker
                selected={attendanceStartDate}
                onChange={(date: Date | null) => setAttendanceStartDate(date)}
                dateFormat="yyyy-MM-dd"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholderText="选择日期"
                isClearable
              />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-text-muted">结束时间</label>
              <DatePicker
                selected={attendanceEndDate}
                onChange={(date: Date | null) => setAttendanceEndDate(date)}
                dateFormat="yyyy-MM-dd"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholderText="选择日期"
                isClearable
              />
            </div>
          </div>

          {filteredRehearsals.length > 0 && (
            <button
              type="button"
              onClick={exportAllRehearsals}
              disabled={exportingAll}
              className="mb-3 w-full rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-md hover:opacity-90 disabled:opacity-50"
            >
              {exportingAll
                ? "导出中…"
                : `📥 导出区间全部考勤（${filteredRehearsals.length} 场排练）`}
            </button>
          )}

          <div className="max-h-[400px] space-y-2 overflow-y-auto">
            {filteredRehearsals.length === 0 ? (
              <p className="py-8 text-center text-xs text-text-muted">
                {allRehearsals.length === 0 ? "暂无排练日程" : "该区间暂无排练"}
              </p>
            ) : (
              filteredRehearsals.map((rehearsal) => {
                const startDate = parseLocalISO(rehearsal.start_time!);
                const endDate = rehearsal.end_time ? parseLocalISO(rehearsal.end_time) : null;
                const dateStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}-${String(startDate.getDate()).padStart(2, "0")}`;
                const timeStr = `${String(startDate.getHours()).padStart(2, "0")}:${String(startDate.getMinutes()).padStart(2, "0")} - ${endDate ? `${String(endDate.getHours()).padStart(2, "0")}:${String(endDate.getMinutes()).padStart(2, "0")}` : "—"}`;

                return (
                  <div
                    key={rehearsal.id}
                    className="flex items-center justify-between rounded-2xl border border-border bg-card px-3 py-2.5 text-xs"
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="truncate font-medium text-text">
                        {rehearsal.repertoire ?? "未命名排练"}
                      </p>
                      <p className="text-text-muted">
                        {dateStr} · {timeStr}
                      </p>
                      <p className="text-text-muted">📍 {rehearsal.location ?? "—"}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => exportSingleRehearsal(rehearsal)}
                      disabled={exportingId === rehearsal.id}
                      className="ml-2 flex-shrink-0 rounded-full bg-primary px-3 py-1.5 text-label font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      {exportingId === rehearsal.id ? "导出中…" : "📥 导出"}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </section>
      )}

      {currentView === "roster" && (
        <div className="max-h-[480px] space-y-5 overflow-y-auto">
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
