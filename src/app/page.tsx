"use client";

import React from "react";
import { useUser } from "@/context/UserContext";
import { supabase } from "@/lib/supabase";

/** 与花名册一致的声部顺序，用于分组 */
const INSTRUMENT_ORDER = [
  "第一小提琴",
  "第二小提琴",
  "中提琴",
  "大提琴",
  "低音提琴",
  "长笛",
  "双簧管",
  "单簧管",
  "大管",
  "圆号",
  "小号",
  "长号",
  "大号",
  "打击乐",
  "键盘",
  "竖琴",
] as const;
const OTHER_GROUP = "其他";

type AnnouncementRow = {
  id: string;
  content: string | null;
  created_at: string | null;
};

type RehearsalRow = {
  id: string | number;
  title: string | null;
  date: string | null;
  /** @deprecated 使用 start_time / end_time */
  time?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  location: string | null;
  repertoire: string | null;
  created_at: string | null;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  instrument: string | null;
  status: string | null;
};

type AttendanceStatus = "present" | "leave" | "absent";

function instrumentGroupKey(instrument: string | null): string {
  if (!instrument) return OTHER_GROUP;
  const trimmed = instrument.trim();
  if (INSTRUMENT_ORDER.includes(trimmed as (typeof INSTRUMENT_ORDER)[number])) {
    return trimmed;
  }
  return OTHER_GROUP;
}

function ridKey(id: string | number): string {
  return String(id);
}

/** 用 title 判断排练类型，与发布时写入的 title 一致 */
const REHEARSAL_TYPE_FULL = "全团合排";
const REHEARSAL_TYPE_SECTION = "声部分排";

function isFullRehearsal(r: RehearsalRow): boolean {
  const t = (r.title ?? "").trim();
  if (t === REHEARSAL_TYPE_FULL || t.includes("合排")) return true;
  if (isSectionRehearsal(r)) return false;
  return true;
}

function isSectionRehearsal(r: RehearsalRow): boolean {
  const t = (r.title ?? "").trim();
  return t === REHEARSAL_TYPE_SECTION || t.includes("分排");
}

/** date 为 yyyy-mm-dd 时格式化为 MM-DD */
function formatDateMMDD(date: string | null): string {
  if (!date || date.length < 10) return "—";
  const parts = date.split("-");
  if (parts.length >= 3) return `${parts[1]}-${parts[2]}`;
  return date;
}

const WEEKDAY = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 格式化为 "3月10日 周二 19:30" */
function formatDateLong(date: string | null, time: string | null): string {
  if (!date || date.length < 10) return "—";
  const [y, m, d] = date.split("-").map(Number);
  if (Number.isNaN(m) || Number.isNaN(d)) return "—";
  const day = new Date(y, m - 1, d).getDay();
  const timeStr = (time ?? "").trim() || "—";
  return `${m}月${d}日 ${WEEKDAY[day]} ${timeStr}`;
}

/** 日程卡片标题：月-日 时间（与社区卡片对齐） */
function formatDateTitle(date: string | null, timeRange: string): string {
  if (!date || date.length < 10) return "—";
  const [y, m, d] = date.split("-").map(Number);
  if (Number.isNaN(m) || Number.isNaN(d)) return "—";
  const timeStr = (timeRange ?? "").trim() || "—";
  return `${m}-${d} ${timeStr}`;
}

/** 是否已结束：优先用 endTime，否则用 startTime + 30 分钟 */
function isRehearsalEnded(
  date: string | null,
  endTime: string | null,
  startTimeFallback?: string | null,
): boolean {
  if (!date || date.length < 10) return true;
  const [y, m, d] = date.split("-").map(Number);
  const timeStr = (endTime ?? "").trim() || (startTimeFallback ?? "").trim();
  if (!timeStr) return false;
  const [hh = 0, mm = 0] = timeStr.split(":").map(Number);
  const end = endTime ? new Date(y, m - 1, d, hh, mm, 0) : new Date(y, m - 1, d, hh, mm + 30, 0);
  return Date.now() > end.getTime();
}

export default function Home() {
  const { user } = useUser();
  const role = user?.role;
  const isAdmin = role === "admin";

  const [announcement, setAnnouncement] = React.useState<AnnouncementRow | null>(null);
  const [announcementLoading, setAnnouncementLoading] = React.useState(false);

  const [rehearsals, setRehearsals] = React.useState<RehearsalRow[]>([]);
  const [rehearsalsLoading, setRehearsalsLoading] = React.useState(false);

  /** 顶部 Tab：全团合排 | 声部分排（全员可见） */
  const [scheduleTab, setScheduleTab] = React.useState<"full" | "section">("full");

  const [publishOpen, setPublishOpen] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  const [form, setForm] = React.useState({
    rehearsalType: "全团合排" as "全团合排" | "声部分排",
    date: "",
    time: "",
    endTime: "",
    location: "",
    repertoire: "",
  });

  /** 团员端：当前用户在各排练上的考勤状态 rehearsal_id -> status */
  const [myAttendanceByRehearsal, setMyAttendanceByRehearsal] = React.useState<
    Record<string, AttendanceStatus | string>
  >({});
  const [myAttendanceLoading, setMyAttendanceLoading] = React.useState(false);

  // 管理员考勤校验 Modal
  const [attendanceModalRehearsal, setAttendanceModalRehearsal] =
    React.useState<RehearsalRow | null>(null);
  const [attendanceLoading, setAttendanceLoading] = React.useState(false);
  const [attendanceMembers, setAttendanceMembers] = React.useState<ProfileRow[]>([]);
  /** user_id -> 当前选择的状态（无记录时默认 absent） */
  const [statusByUserId, setStatusByUserId] = React.useState<Record<string, AttendanceStatus>>({});
  const [attendanceSaving, setAttendanceSaving] = React.useState(false);

  const fetchLatestAnnouncement = React.useCallback(async () => {
    setAnnouncementLoading(true);
    const { data, error } = await supabase
      .from("announcements")
      .select("id, content, created_at")
      .order("created_at", { ascending: false })
      .limit(1);
    setAnnouncementLoading(false);
    if (error) {
      console.warn("[Home] 加载公告失败：", error.message);
      setAnnouncement(null);
      return;
    }
    const row = Array.isArray(data) && data.length > 0 ? (data[0] as AnnouncementRow) : null;
    setAnnouncement(row);
  }, []);

  const fetchRehearsals = React.useCallback(async () => {
    setRehearsalsLoading(true);
    const { data, error } = await supabase
      .from("rehearsals")
      .select("id, title, date, start_time, end_time, location, repertoire, created_at")
      .order("date", { ascending: true })
      .order("start_time", { ascending: true });
    setRehearsalsLoading(false);

    if (error) {
      console.warn("[Home] 加载排练日程失败：", error.message);
      setRehearsals([]);
      return;
    }

    setRehearsals(data as any[] as RehearsalRow[]);
  }, []);

  /** 团员端：加载当前用户在所有排练上的打卡记录 */
  const fetchMyAttendances = React.useCallback(async () => {
    if (!user?.id || isAdmin) {
      setMyAttendanceByRehearsal({});
      return;
    }
    setMyAttendanceLoading(true);
    const { data, error } = await supabase
      .from("attendances")
      .select("rehearsal_id, status")
      .eq("user_id", user.id);
    setMyAttendanceLoading(false);

    if (error) {
      console.warn("[Home] 加载我的考勤失败：", error.message);
      setMyAttendanceByRehearsal({});
      return;
    }

    const map: Record<string, string> = {};
    for (const row of (data ?? []) as {
      rehearsal_id: string | number;
      status: string;
    }[]) {
      map[ridKey(row.rehearsal_id)] = row.status;
    }
    setMyAttendanceByRehearsal(map);
  }, [user?.id, isAdmin]);

  React.useEffect(() => {
    void fetchLatestAnnouncement();
    void fetchRehearsals();
  }, [fetchLatestAnnouncement, fetchRehearsals]);

  React.useEffect(() => {
    void fetchMyAttendances();
  }, [fetchMyAttendances]);

  // 打开管理员面板时：正式团员 + 该场 attendances；无记录默认 absent
  React.useEffect(() => {
    if (!attendanceModalRehearsal || !isAdmin) return;
    const rid = attendanceModalRehearsal.id;

    const load = async () => {
      setAttendanceLoading(true);
      const [profilesRes, attendRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, instrument, status")
          .eq("status", "approved"),
        supabase.from("attendances").select("user_id, status").eq("rehearsal_id", rid),
      ]);

      setAttendanceLoading(false);

      if (profilesRes.error) {
        console.warn("[Home] 加载团员失败：", profilesRes.error.message);
        setAttendanceMembers([]);
        setStatusByUserId({});
        return;
      }

      const members = (profilesRes.data as ProfileRow[]) ?? [];
      setAttendanceMembers(members);

      const existing: Record<string, AttendanceStatus> = {};
      if (!attendRes.error && attendRes.data) {
        for (const row of attendRes.data as {
          user_id: string;
          status: string;
        }[]) {
          const s = row.status;
          if (s === "present" || s === "leave" || s === "absent") {
            existing[row.user_id] = s;
          }
        }
      }
      const initial: Record<string, AttendanceStatus> = {};
      for (const m of members) {
        // 无记录视为未自助签到 → 默认缺席，由管理员补录
        initial[m.id] = existing[m.id] ?? "absent";
      }
      setStatusByUserId(initial);
    };

    void load();
  }, [attendanceModalRehearsal, isAdmin]);

  /** 按 Tab 过滤：全团合排 / 声部分排（宽松匹配，避免全角/空格导致不显示） */
  const displayedRehearsals = React.useMemo(() => {
    return rehearsals.filter((r) => {
      const dbTitle = (r.title || "")
        .toString()
        .replace(/\u3000/g, " ")
        .trim();
      const target = scheduleTab === "full" ? "全团合排" : "声部分排";
      if (dbTitle === target) return true;
      if (scheduleTab === "full") return dbTitle.includes("合排") && !dbTitle.includes("分排");
      return dbTitle.includes("分排");
    });
  }, [rehearsals, scheduleTab]);

  const groupedMembers = React.useMemo(() => {
    const map = new Map<string, ProfileRow[]>();
    for (const row of attendanceMembers) {
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
      if (users && users.length > 0) ordered.push({ group: key, users });
    }
    const other = map.get(OTHER_GROUP);
    if (other && other.length > 0) ordered.push({ group: OTHER_GROUP, users: other });
    return ordered;
  }, [attendanceMembers]);

  /** 团员自助签到：upsert present */
  const handleMemberSignIn = async (r: RehearsalRow) => {
    if (!user?.id || isAdmin) return;
    const { error } = await supabase.from("attendances").upsert(
      {
        rehearsal_id: r.id,
        user_id: user.id,
        status: "present",
      },
      { onConflict: "rehearsal_id,user_id" },
    );
    if (error) {
      alert(error.message || "签到失败，请稍后重试。");
      return;
    }
    setMyAttendanceByRehearsal((prev) => ({
      ...prev,
      [ridKey(r.id)]: "present",
    }));
    alert("签到成功");
  };

  /** 管理员保存：仅批量 upsert，不做删除 fallback */
  const handleSaveAttendance = async () => {
    if (!attendanceModalRehearsal || attendanceSaving) return;
    const rid = attendanceModalRehearsal.id;
    const rows = attendanceMembers.map((m) => ({
      user_id: m.id,
      rehearsal_id: rid,
      status: statusByUserId[m.id] ?? "absent",
    }));

    if (rows.length === 0) {
      alert("没有可保存的团员数据");
      return;
    }

    setAttendanceSaving(true);
    const { error } = await supabase
      .from("attendances")
      .upsert(rows, { onConflict: "rehearsal_id,user_id" });
    setAttendanceSaving(false);

    if (error) {
      alert(error.message || "保存失败，请稍后重试。");
      return;
    }

    alert("考勤已保存");
    setAttendanceModalRehearsal(null);
    setAttendanceMembers([]);
    setStatusByUserId({});
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || publishing) return;

    const startTime = (form.time ?? "").trim();
    const endTime = (form.endTime ?? "").trim();

    if (!form.date || !startTime || !endTime || !form.location.trim() || !form.repertoire.trim()) {
      alert("请填写完整的排练信息。");
      return;
    }

    const dateOnly = String(form.date).trim().slice(0, 10);
    const payload = {
      title: form.rehearsalType,
      date: dateOnly,
      start_time: startTime,
      end_time: endTime,
      location: form.location.trim(),
      repertoire: form.repertoire.trim(),
    };

    setPublishing(true);
    const { error } = await supabase.from("rehearsals").insert([payload]);
    setPublishing(false);

    if (error) {
      console.error("[Home] 发布排练失败：", error);
      alert(`发布失败：${error.message}`);
      return;
    }

    setForm({
      rehearsalType: "全团合排",
      date: "",
      time: "",
      endTime: "",
      location: "",
      repertoire: "",
    });
    setPublishOpen(false);
    void fetchRehearsals();
  };

  /** 团员卡片：考勤状态按钮。compact 时与社区卡片右侧小方框一致 */
  const renderMemberAttendanceButton = (r: RehearsalRow, compact?: boolean) => {
    if (!user?.id || isAdmin) return null;
    const key = ridKey(r.id);
    const status = myAttendanceByRehearsal[key];
    const compactClass =
      "inline-block rounded border border-zinc-200 bg-white px-2 py-0.5 text-[10px] font-medium text-zinc-700";

    if (status === "present") {
      return (
        <button
          type="button"
          disabled
          className={
            compact
              ? compactClass + " cursor-not-allowed text-zinc-500"
              : "w-full cursor-not-allowed rounded-full border border-zinc-200 bg-zinc-100 py-2 text-sm font-medium text-zinc-500"
          }
        >
          ✅ 已签到
        </button>
      );
    }
    if (status === "leave") {
      return (
        <button
          type="button"
          disabled
          className={
            compact
              ? compactClass + " cursor-not-allowed text-zinc-500"
              : "w-full cursor-not-allowed rounded-full border border-zinc-200 bg-zinc-100 py-2 text-sm font-medium text-zinc-500"
          }
        >
          ⏸️ 已请假
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => void handleMemberSignIn(r)}
        className={
          compact
            ? compactClass + " hover:bg-zinc-50"
            : "w-full rounded-full bg-zinc-900 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800"
        }
      >
        📍 点击签到
      </button>
    );
  };

  return (
    <div className="min-h-screen pb-6">
      {/* 顶部区域：与社区【公告板】一一对齐 */}
      <header className="mb-1">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900">本周排练日程</h1>
            <p className="mt-1 text-xs text-zinc-500">查看乐团合排与分排安排</p>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setPublishOpen(true)}
              className="rounded-full bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-white shadow-sm hover:bg-zinc-800"
            >
              ➕ 发布新日程
            </button>
          )}
        </div>
        <div className="mt-2 flex justify-start">
          <div
            role="tablist"
            aria-label="排练类型"
            className="inline-flex rounded-full bg-zinc-100 p-1 text-xs"
          >
            <button
              type="button"
              role="tab"
              aria-selected={scheduleTab === "full"}
              onClick={() => setScheduleTab("full")}
              className={`min-w-[64px] rounded-full px-3 py-1 text-center transition-colors ${
                scheduleTab === "full"
                  ? "bg-zinc-900 text-white shadow-sm"
                  : "text-zinc-600 hover:text-zinc-900"
              }`}
            >
              合排
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={scheduleTab === "section"}
              onClick={() => setScheduleTab("section")}
              className={`min-w-[64px] rounded-full px-3 py-1 text-center transition-colors ${
                scheduleTab === "section"
                  ? "bg-zinc-900 text-white shadow-sm"
                  : "text-zinc-600 hover:text-zinc-900"
              }`}
            >
              分排
            </button>
          </div>
        </div>
      </header>

      {/* 置顶公告：与【合排/分排】间距同副标题与 Tab，左右全宽、上下收窄 */}
      {!announcementLoading && announcement?.content && (
        <section className="mt-2 mb-4">
          <div className="flex items-center gap-2 rounded-lg border border-amber-200/60 bg-amber-50/80 py-1.5 px-3">
            <span className="shrink-0 text-amber-600" aria-hidden>
              📢
            </span>
            <p className="min-w-0 truncate text-xs text-amber-900">{announcement.content}</p>
          </div>
        </section>
      )}

      {/* 发布新日程 Modal（管理员） */}
      {isAdmin && publishOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="publish-modal-title"
        >
          <button
            type="button"
            aria-label="关闭"
            className="absolute inset-0"
            onClick={() => {
              if (publishing) return;
              setPublishOpen(false);
            }}
          />
          <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-xl max-h-[85vh] overflow-y-auto p-4 pb-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 id="publish-modal-title" className="text-sm font-semibold text-zinc-900">
                发布新日程
              </h2>
              <button
                type="button"
                disabled={publishing}
                onClick={() => setPublishOpen(false)}
                className="rounded-full bg-zinc-100 px-3 py-1 text-[11px] text-zinc-600 hover:bg-zinc-200 disabled:opacity-50"
              >
                关闭
              </button>
            </div>
            <form onSubmit={handlePublish} className="mt-2 space-y-3">
              <div className="flex gap-3">
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-800">
                  <input
                    type="radio"
                    name="rehearsalType"
                    checked={form.rehearsalType === "全团合排"}
                    onChange={() => setForm((p) => ({ ...p, rehearsalType: "全团合排" }))}
                    className="h-3.5 w-3.5 border-zinc-300 text-zinc-900 focus:ring-zinc-500"
                  />
                  全团合排
                </label>
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-800">
                  <input
                    type="radio"
                    name="rehearsalType"
                    checked={form.rehearsalType === "声部分排"}
                    onChange={() => setForm((p) => ({ ...p, rehearsalType: "声部分排" }))}
                    className="h-3.5 w-3.5 border-zinc-300 text-zinc-900 focus:ring-zinc-500"
                  />
                  声部分排
                </label>
              </div>
              {/* 日期 */}
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-400"
              />
              {/* 开始时间 - 结束时间 */}
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={form.time}
                  onChange={(e) => setForm((p) => ({ ...p, time: e.target.value }))}
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-400"
                />
                <span className="text-[11px] text-zinc-500">至</span>
                <input
                  type="time"
                  value={form.endTime}
                  onChange={(e) => setForm((p) => ({ ...p, endTime: e.target.value }))}
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-400"
                />
              </div>
              <input
                value={form.location}
                onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))}
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-400"
                placeholder="地点（如：新太阳b108）"
              />
              <textarea
                value={form.repertoire}
                onChange={(e) => setForm((p) => ({ ...p, repertoire: e.target.value }))}
                rows={3}
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-400"
                placeholder="排练曲目（如：柴四）"
              />
              <button
                type="submit"
                disabled={publishing}
                className="w-full rounded-full bg-zinc-900 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
              >
                {publishing ? "发布中…" : "确认发布"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 排练卡片列表 */}
      <section>
        {rehearsalsLoading ? (
          <p className="py-12 text-center text-xs text-zinc-500">加载中…</p>
        ) : displayedRehearsals.length === 0 ? (
          <p className="py-12 text-center text-xs text-zinc-500">
            {scheduleTab === "full" ? "暂无合排安排" : "暂无分排安排"}
          </p>
        ) : (
          <div className="space-y-5 transition-opacity duration-200">
            {displayedRehearsals.map((r) => {
              const displayTime =
                r?.start_time && r?.end_time
                  ? `${r.start_time} - ${r.end_time}`
                  : (r?.time ?? r?.start_time ?? "");
              const ended = isRehearsalEnded(
                r?.date ?? null,
                r?.end_time ?? null,
                r?.start_time ?? r?.time ?? null,
              );
              const repertoireLabel = (r?.repertoire ?? "").trim() || "常规排练";
              const dateTitle = formatDateTitle(r?.date ?? null, displayTime);
              return (
                <article
                  key={String(r?.id)}
                  className="rounded-2xl border border-zinc-100 bg-zinc-50/70 p-2.5 shadow-[0_1px_4px_rgba(15,23,42,0.06)]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-lg font-semibold text-zinc-900">{dateTitle}</h2>
                      <p className="mt-0.5 text-[11px] text-zinc-500">
                        排练曲目：{repertoireLabel}
                      </p>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <p className="text-[11px] text-zinc-400">📍 {r?.location ?? "—"}</p>
                        {isAdmin && (
                          <div className="ml-auto flex shrink-0 gap-2 text-[11px]">
                            <button
                              type="button"
                              onClick={() => alert("待开发")}
                              className="text-zinc-500 hover:text-zinc-800"
                            >
                              编辑
                            </button>
                            <button
                              type="button"
                              onClick={() => alert("待开发")}
                              className="text-zinc-400 hover:text-red-500"
                            >
                              删除
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          ended ? "bg-zinc-100 text-zinc-500" : "bg-blue-100 text-blue-700"
                        }`}
                      >
                        {ended ? "已结束" : "即将开始"}
                      </span>
                      {!isAdmin ? (
                        renderMemberAttendanceButton(r, true)
                      ) : (
                        <button
                          type="button"
                          onClick={() => setAttendanceModalRehearsal(r)}
                          className="inline-flex rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-bold text-zinc-700 hover:bg-zinc-200 whitespace-nowrap"
                        >
                          查看出勤
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* 管理员考勤校验 Modal */}
      {attendanceModalRehearsal && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="attendance-modal-title"
        >
          <button
            type="button"
            aria-label="关闭"
            className="absolute inset-0"
            onClick={() => {
              if (attendanceSaving) return;
              setAttendanceModalRehearsal(null);
            }}
          />
          <div className="relative m-auto flex h-[70vh] w-full max-w-md flex-col rounded-t-2xl border border-zinc-200 bg-white shadow-xl sm:rounded-2xl">
            <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-3 py-2">
              <h2 id="attendance-modal-title" className="pr-2 text-sm font-semibold text-zinc-900">
                {formatDateMMDD(attendanceModalRehearsal.date)} ·{" "}
                {(attendanceModalRehearsal.repertoire ?? "").trim() || "常规排练"} - 考勤修正
              </h2>
              <button
                type="button"
                disabled={attendanceSaving}
                onClick={() => setAttendanceModalRehearsal(null)}
                className="rounded-full bg-zinc-100 px-2 py-1 text-[11px] text-zinc-600 hover:bg-zinc-200 disabled:opacity-50"
              >
                关闭
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
              {attendanceLoading ? (
                <p className="py-8 text-center text-sm text-zinc-400">加载团员与考勤…</p>
              ) : groupedMembers.length === 0 ? (
                <p className="py-8 text-center text-sm text-zinc-500">暂无已通过审核的团员</p>
              ) : (
                <div className="space-y-3">
                  {groupedMembers.map(({ group, users }) => (
                    <div key={group}>
                      <p className="mb-1 text-sm font-medium text-zinc-500">{group}</p>
                      <ul className="space-y-1">
                        {users.map((m) => (
                          <li
                            key={m.id}
                            className="flex items-center justify-between gap-2 rounded-lg border border-zinc-100 bg-zinc-50/80 px-2 py-1.5"
                          >
                            <span className="min-w-0 truncate text-sm text-zinc-900">
                              {m.full_name ?? "—"}
                            </span>
                            <div className="flex shrink-0 gap-0.5">
                              {(
                                [
                                  { key: "present" as const, icon: "✅" },
                                  { key: "leave" as const, icon: "⏸️" },
                                  { key: "absent" as const, icon: "❌" },
                                ] as const
                              ).map(({ key, icon }) => (
                                <button
                                  key={key}
                                  type="button"
                                  title={
                                    key === "present" ? "出勤" : key === "leave" ? "请假" : "缺席"
                                  }
                                  onClick={() =>
                                    setStatusByUserId((prev) => ({
                                      ...prev,
                                      [m.id]: key,
                                    }))
                                  }
                                  className={
                                    (statusByUserId[m.id] ?? "absent") === key
                                      ? "rounded bg-zinc-900 p-1 text-white"
                                      : "rounded border border-zinc-200 bg-white p-1 text-zinc-500 hover:bg-zinc-100"
                                  }
                                >
                                  {icon}
                                </button>
                              ))}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-zinc-100 bg-white px-3 py-2">
              <button
                type="button"
                disabled={attendanceLoading || attendanceSaving || attendanceMembers.length === 0}
                onClick={() => void handleSaveAttendance()}
                className="w-full rounded-xl bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {attendanceSaving ? "保存中…" : "保存考勤"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
