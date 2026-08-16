"use client";

import React from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { useRehearsals } from "@/hooks/useRehearsals";
import { useProfiles } from "@/hooks/useProfiles";
import { useAttendanceEditor } from "@/hooks/useAttendanceEditor";
import { AttendanceModal } from "@/app/(member)/schedule/components/attendance-modal";
import { Toggle } from "@/components/ui/Toggle";
import { parseLocalISO, getLocalDateString } from "@/lib/date-utils";
import { groupProfilesByInstrument } from "@/lib/roster-utils";
import { filterByName } from "@/lib/name-search";
import { buildUniqueSheetNames } from "@/lib/sheet-utils";
import type { ProfileRow, RehearsalRow } from "@/types/database";
import * as XLSX from "xlsx";
import { AdminMemberDetailModal } from "./components/member-detail-modal";

type ViewMode = "attendance" | "roster";

export default function MembersPage() {
  const [currentView, setCurrentView] = React.useState<ViewMode>("attendance");

  // 花名册
  const {
    data: allProfiles,
    loading: rosterLoading,
    error: rosterError,
    update: updateProfile,
  } = useProfiles({ status: "approved" });
  const rosterRows = React.useMemo(
    () => allProfiles.filter((r) => (r.role ?? "") !== "admin") as ProfileRow[],
    [allProfiles],
  );

  // 拼音/首字母搜索：输入为空时显示全部
  const [searchQuery, setSearchQuery] = React.useState("");
  const filteredRows = React.useMemo(
    () => filterByName(rosterRows, searchQuery),
    [rosterRows, searchQuery],
  );

  const grouped = React.useMemo(() => groupProfilesByInstrument(filteredRows), [filteredRows]);

  // 成员详情弹窗：点击花名册成员打开（可编辑）
  const [selectedUser, setSelectedUser] = React.useState<ProfileRow | null>(null);

  // 考勤查看
  const { data: allRehearsals } = useRehearsals();
  const [attendanceStartDate, setAttendanceStartDate] = React.useState<Date | null>(null);
  const [attendanceEndDate, setAttendanceEndDate] = React.useState<Date | null>(null);
  const [exportingId, setExportingId] = React.useState<number | null>(null);
  const [exportingAll, setExportingAll] = React.useState(false);

  // 考勤查看/编辑弹窗（点击排练行打开，与 admin/rehearsals 共享同一套状态逻辑）
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
      const { data, error } = await supabase
        .from("attendances")
        .select("*, profiles!inner(full_name, instrument, email)")
        .eq("rehearsal_id", rehearsal.id);
      if (error) throw error;
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
        ? getLocalDateString(parseLocalISO(rehearsal.start_time))
        : "";
      XLSX.writeFile(wb, `考勤记录_${rehearsal.repertoire ?? "排练"}_${dateStr}.xlsx`);
    } catch (error) {
      // 与导出全部对称：微信 XWeb 对 unhandled rejection 完全静默，必须显式 alert
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
      const { supabase } = await import("@/lib/supabase");
      // Issue #169：一次 .in 查询拉取区间内全部排练的出勤记录，代替逐场 N 次查询——
      // 总耗时降为单次往返，避免微信浏览器「用户手势后 blob 下载」宽容窗口内
      // 耗时过长导致 a.click() 被静默拦截。
      const { data, error } = await supabase
        .from("attendances")
        .select("*, profiles!inner(full_name, instrument, email)")
        .in(
          "rehearsal_id",
          filteredRehearsals.map((r) => r.id),
        );
      if (error) throw error;
      if (!data || data.length === 0) {
        alert("该区间暂无出勤记录");
        return;
      }

      // 前端按 rehearsal_id 分组，逐场构建 sheet
      const grouped = new Map<number, Array<Record<string, unknown>>>();
      for (const row of data as Array<Record<string, unknown>>) {
        const rehearsalId = row.rehearsal_id as number;
        if (!grouped.has(rehearsalId)) grouped.set(rehearsalId, []);
        grouped.get(rehearsalId)!.push(row);
      }

      // sheet 名清洗 + 重名去重（曲目_日期 可能含非法字符或重名，XLSX 会抛错）
      const sheetNames = buildUniqueSheetNames(
        filteredRehearsals.map((r) => {
          const dateStr = r.start_time ? getLocalDateString(parseLocalISO(r.start_time)) : "";
          return `${r.repertoire ?? "排练"}_${dateStr}`;
        }),
      );

      const wb = XLSX.utils.book_new();
      filteredRehearsals.forEach((rehearsal, index) => {
        const rows = (grouped.get(rehearsal.id) ?? []).map((r) => [
          (r.profiles as { full_name?: string } | null)?.full_name ?? "—",
          (r.profiles as { email?: string } | null)?.email ?? "—",
          STATUS_LABEL[String(r.status ?? "")] ?? String(r.status ?? "—"),
          (r.sign_in_time as string) ?? "—",
        ]);
        const sheetData = [["姓名", "邮箱", "出勤情况", "签到时间"], ...rows];
        const ws = XLSX.utils.aoa_to_sheet(sheetData);
        XLSX.utils.book_append_sheet(wb, ws, sheetNames[index]);
      });

      const startStr = attendanceStartDate ? getLocalDateString(attendanceStartDate) : "全部";
      const endStr = attendanceEndDate ? getLocalDateString(attendanceEndDate) : "全部";
      XLSX.writeFile(wb, `考勤记录_${startStr}_${endStr}.xlsx`);
    } catch (error) {
      // 微信 XWeb 对 unhandled rejection 完全静默，必须显式 alert 错误信息
      alert(`导出失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setExportingAll(false);
    }
  };

  return (
    /* 根容器 flex 化（矮屏布局，审计批次 3）：头部固定；
       Issue #171：外层不再 overflow-y-auto（消除嵌套滚动），滚动下沉到内层列表（max-h） */
    <div className="flex h-full min-h-0 flex-col space-y-4 pb-2">
      <header className="mt-1">
        <h1 className="text-lg font-semibold text-text">成员</h1>
        <p className="mt-1 text-xs text-text-muted">排练考勤与乐团花名册</p>
      </header>

      <div className="flex-1 min-h-0 space-y-4">
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

            {/* 按钮常驻：区间为空时点击给出 alert 提示（Issue #169 空数据提示） */}
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
                    // 方案 A：可点击区（role="button"）只含文本信息，导出按钮为行外兄弟节点。
                    // 嵌套交互元素（button 嵌在 role="button" 内）违反 ARIA 规则、读屏混乱，
                    // 事件也无法靠 stopPropagation 拦截键盘冒泡，故改为兄弟结构。
                    <div key={rehearsal.id} className="flex items-center gap-2">
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          // 双保险：若未来在行内嵌入真实按钮，不拦截其点击。
                          // 注意不能用 e.target !== e.currentTarget —— 点击文本时 target 是
                          // 文本元素而非容器自身，会拦截核心交互（点击文本打开弹窗）。
                          if ((e.target as HTMLElement).closest("button")) return;
                          openAttendance(rehearsal);
                        }}
                        onKeyDown={(e) => {
                          // 目标守卫：只响应行容器自身的键盘事件，
                          // 子元素的键盘事件（如未来行内新增的可聚焦元素）不被行处理器劫持
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
        )}

        {currentView === "roster" && (
          <div className="space-y-3">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索姓名（支持中文/拼音/首字母）"
              className="input"
            />
            <div className="max-h-[440px] space-y-5 overflow-y-auto">
              {rosterLoading ? (
                <p className="py-8 text-center text-xs text-text-subtle">加载中…</p>
              ) : rosterError ? (
                <p className="rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger">
                  {rosterError}
                </p>
              ) : rosterRows.length === 0 ? (
                <p className="py-8 text-center text-xs text-text-muted">暂无已通过成员</p>
              ) : grouped.length === 0 ? (
                <p className="py-8 text-center text-xs text-text-muted">未找到匹配的成员</p>
              ) : (
                grouped.map(({ group, users }) => (
                  <div key={group}>
                    <p className="mb-2 text-label font-medium uppercase tracking-wide text-text-muted">
                      {group}
                    </p>
                    <ul className="space-y-2">
                      {users.map((u) => (
                        <li key={u.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedUser(u)}
                            className="w-full rounded-xl border border-border bg-card px-3 py-2 text-left text-xs hover:bg-muted"
                          >
                            <p className="flex flex-wrap items-center gap-1.5 font-medium text-text">
                              <span>{(u.instrument ?? "—") + " - " + (u.full_name ?? "—")}</span>
                              {u.is_section_leader && (
                                <span className="rounded-full bg-warning-bg px-1.5 py-0.5 text-caption text-warning">
                                  🏅 声部长
                                </span>
                              )}
                            </p>
                            <p className="mt-0.5 text-text-muted">
                              学院：{u.college?.trim() || "—"}
                            </p>
                            <p className="mt-0.5 text-text-muted">邮箱：{u.email ?? "—"}</p>
                            <p className="mt-0.5 text-text-subtle">
                              入团时间：{u.join_date?.trim() || "—"}
                            </p>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      <AdminMemberDetailModal
        open={!!selectedUser}
        user={selectedUser}
        onClose={() => setSelectedUser(null)}
        onSave={updateProfile}
      />

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
