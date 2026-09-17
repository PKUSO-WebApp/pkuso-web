"use client";

import React from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { useRehearsals } from "@/hooks/useRehearsals";
import { useAttendanceEditor } from "@/hooks/useAttendanceEditor";
import { AttendanceModal } from "@/components/attendance-modal";
import { parseLocalISO, getLocalDateString } from "@/lib/date-utils";
import type { RehearsalRow } from "@/types/database";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { useAdminPageHeader } from "@/context/admin-page-header-context";

async function fetchRosterProfiles(
  userIds: string[],
): Promise<
  Map<string, { full_name: string | null; email: string | null; is_in_orchestra: boolean | null }>
> {
  if (userIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("profiles_roster")
    .select("id, full_name, email, is_in_orchestra")
    .in("id", userIds);
  if (error) return new Map();
  return new Map(
    (data ?? []).map((r) => [
      String(r.id),
      {
        full_name: r.full_name,
        email: r.email,
        is_in_orchestra: r.is_in_orchestra as boolean | null,
      },
    ]),
  );
}

const inOrchestraLabel = (v: boolean | null | undefined): string =>
  v === true ? "在团" : v === false ? "不在团" : "—";

const STATUS_LABEL: Record<string, string> = {
  present: "出席",
  late: "迟到",
  absent: "缺席",
  excused: "请假",
};

export default function AttendancePage() {
  const { setTitle } = useAdminPageHeader();
  const { data: allRehearsals } = useRehearsals();
  const [attendanceStartDate, setAttendanceStartDate] = React.useState<Date | null>(null);
  const [attendanceEndDate, setAttendanceEndDate] = React.useState<Date | null>(null);
  const [exportingId, setExportingId] = React.useState<number | null>(null);
  const [exportingAll, setExportingAll] = React.useState(false);

  const {
    attendanceRehearsal,
    attendanceLoading,
    attendanceList,
    attendanceSaving,
    openAttendance,
    closeAttendance,
    onAttendanceStatusChange,
    saveAttendance,
  } = useAttendanceEditor();

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

  // 导出单场排练出勤记录
  const exportSingleRehearsal = async (rehearsal: RehearsalRow) => {
    setExportingId(rehearsal.id);
    try {
      const { data, error } = await supabase
        .from("attendances")
        .select("*")
        .eq("rehearsal_id", rehearsal.id);
      if (error) throw error;
      if (!data || data.length === 0) {
        alert("该排练暂无出勤记录");
        return;
      }
      const rows = data as Array<Record<string, unknown>>;
      const roster = await fetchRosterProfiles(rows.map((r) => String(r.user_id)));
      const sheetData = [
        ["姓名", "邮箱", "出勤情况", "在团情况", "签到时间"],
        ...rows.map((r) => [
          roster.get(String(r.user_id))?.full_name ?? "—",
          roster.get(String(r.user_id))?.email ?? "—",
          STATUS_LABEL[String(r.status ?? "")] ?? String(r.status ?? "—"),
          inOrchestraLabel(roster.get(String(r.user_id))?.is_in_orchestra),
          (r.sign_in_time as string) ?? "—",
        ]),
      ];
      const ws = XLSX.utils.aoa_to_sheet(sheetData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "考勤记录");
      const dateStr = rehearsal.start_time
        ? getLocalDateString(parseLocalISO(rehearsal.start_time))
        : "";
      XLSX.writeFile(wb, `考勤记录_${rehearsal.repertoire ?? "排练"}_${dateStr}.xlsx`);
    } catch (error) {
      alert(`导出失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setExportingId(null);
    }
  };

  // 导出区间内全部排练出勤记录（每个排练一个 sheet）
  const exportAllRehearsals = async () => {
    if (filteredRehearsals.length === 0) {
      alert("当前区间暂无排练可导出");
      return;
    }
    setExportingAll(true);
    try {
      const { data, error } = await supabase
        .from("attendances")
        .select("*")
        .in(
          "rehearsal_id",
          filteredRehearsals.map((r) => r.id),
        );
      if (error) throw error;
      if (!data || data.length === 0) {
        alert("该区间暂无出勤记录");
        return;
      }

      const rows = data as Array<Record<string, unknown>>;
      const roster = await fetchRosterProfiles(rows.map((r) => String(r.user_id)));

      const grouped = new Map<number, Array<Record<string, unknown>>>();
      for (const row of rows) {
        const rehearsalId = row.rehearsal_id as number;
        if (!grouped.has(rehearsalId)) grouped.set(rehearsalId, []);
        grouped.get(rehearsalId)!.push(row);
      }

      const { buildUniqueSheetNames } = await import("@/lib/sheet-utils");
      const sheetNames = buildUniqueSheetNames(
        filteredRehearsals.map((r) => {
          const dateStr = r.start_time ? getLocalDateString(parseLocalISO(r.start_time)) : "";
          return `${r.repertoire ?? "排练"}_${dateStr}`;
        }),
      );

      const wb = XLSX.utils.book_new();
      filteredRehearsals.forEach((rehearsal, index) => {
        const sheetRows = (grouped.get(rehearsal.id) ?? []).map((r) => [
          roster.get(String(r.user_id))?.full_name ?? "—",
          roster.get(String(r.user_id))?.email ?? "—",
          STATUS_LABEL[String(r.status ?? "")] ?? String(r.status ?? "—"),
          inOrchestraLabel(roster.get(String(r.user_id))?.is_in_orchestra),
          (r.sign_in_time as string) ?? "—",
        ]);
        const sheetData = [["姓名", "邮箱", "出勤情况", "在团情况", "签到时间"], ...sheetRows];
        const ws = XLSX.utils.aoa_to_sheet(sheetData);
        XLSX.utils.book_append_sheet(wb, ws, sheetNames[index]);
      });

      const startStr = attendanceStartDate ? getLocalDateString(attendanceStartDate) : "全部";
      const endStr = attendanceEndDate ? getLocalDateString(attendanceEndDate) : "全部";
      XLSX.writeFile(wb, `考勤记录_${startStr}_${endStr}.xlsx`);
    } catch (error) {
      alert(`导出失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setExportingAll(false);
    }
  };

  React.useEffect(() => {
    setTitle("考勤管理");
  }, [setTitle]);

  return (
    <div className="flex h-full min-h-0 flex-col space-y-4 pb-2">
      <div className="flex-1 min-h-0 space-y-4">
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

          <div className="max-h-[500px] space-y-2 overflow-y-auto">
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
                  <div key={rehearsal.id} className="flex items-center gap-2">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("button")) return;
                        openAttendance(rehearsal);
                      }}
                      onKeyDown={(e) => {
                        if (e.target !== e.currentTarget) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openAttendance(rehearsal);
                        }
                      }}
                      className="min-w-0 flex-1 cursor-pointer rounded-2xl border border-border bg-card px-3 py-2.5 text-xs transition-colors hover:bg-muted"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <p className="truncate font-medium text-text">
                          {rehearsal.repertoire ?? "未命名排练"}
                        </p>
                        <p className="text-text-muted">
                          {dateStr} · {timeStr}
                        </p>
                        <p className="text-text-muted">📍 {rehearsal.location ?? "—"}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => exportSingleRehearsal(rehearsal)}
                      disabled={exportingId === rehearsal.id}
                      className="flex-shrink-0 cursor-pointer rounded-full bg-primary px-3 py-1.5 text-label font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      {exportingId === rehearsal.id ? "导出中…" : "📥 导出"}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      <AttendanceModal
        open={!!attendanceRehearsal}
        title={attendanceRehearsal?.repertoire ?? ""}
        loading={attendanceLoading}
        list={attendanceList}
        editable
        onStatusChange={onAttendanceStatusChange}
        onSave={saveAttendance}
        saving={attendanceSaving}
        onClose={closeAttendance}
      />
    </div>
  );
}
