"use client";

import React from "react";
import { useUser } from "@/context/UserContext";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import { useRehearsals } from "@/hooks/useRehearsals";
import { useProfiles } from "@/hooks/useProfiles";
import { Toggle } from "@/components/ui/Toggle";
import { Modal } from "@/components/ui/Modal";
import { Card } from "@/components/ui/Card";
import { INSTRUMENT_ORDER, OTHER_INSTRUMENT_GROUP } from "@/constants/instruments";
import type { ProfileRow, RehearsalRow } from "@/types/database";

type AttendanceStatus = "present" | "leave" | "absent";

function instrumentGroupKey(instrument: string | null): string {
  if (!instrument) return OTHER_INSTRUMENT_GROUP;
  const trimmed = instrument.trim();
  if (INSTRUMENT_ORDER.includes(trimmed as (typeof INSTRUMENT_ORDER)[number])) return trimmed;
  return OTHER_INSTRUMENT_GROUP;
}

function formatDateMMDD(date: string | null): string {
  if (!date || date.length < 10) return "—";
  const [_, m, d] = date.split("-");
  return `${m}-${d}`;
}

export default function Home() {
  const { user } = useUser();
  const isAdmin = user?.role === "admin";

  const { data: announcement, loading: announcementLoading } = useAnnouncements();
  const { data: rehearsals, loading: rehearsalsLoading } = useRehearsals();
  const { data: approvedProfiles } = useProfiles(isAdmin ? { status: "approved" } : undefined);

  const [scheduleTab, setScheduleTab] = React.useState<"full" | "section">("full");
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  const [attendanceRehearsal, setAttendanceRehearsal] = React.useState<RehearsalRow | null>(null);
  const [attendanceLoading, setAttendanceLoading] = React.useState(false);
  const [attendanceMembers, setAttendanceMembers] = React.useState<ProfileRow[]>([]);
  const [statusByUserId, setStatusByUserId] = React.useState<Record<string, AttendanceStatus>>({});
  const [attendanceSaving, setAttendanceSaving] = React.useState(false);

  const displayedRehearsals = React.useMemo(() => {
    return rehearsals.filter((r) => {
      const t = (r.title ?? "").trim();
      if (scheduleTab === "full") return t.includes("合排") && !t.includes("分排");
      return t.includes("分排");
    });
  }, [rehearsals, scheduleTab]);

  // 管理员打开考勤面板
  React.useEffect(() => {
    if (!attendanceRehearsal || !isAdmin) return;
    setAttendanceLoading(true);
    import("@/lib/supabase").then(({ supabase }) => {
      Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, instrument, status")
          .eq("status", "approved"),
        supabase
          .from("attendances")
          .select("user_id, status")
          .eq("rehearsal_id", attendanceRehearsal.id),
      ]).then(([profilesRes, attendRes]) => {
        setAttendanceLoading(false);
        if (!profilesRes.error && profilesRes.data)
          setAttendanceMembers(profilesRes.data as ProfileRow[]);
        if (!attendRes.error && attendRes.data) {
          const m: Record<string, AttendanceStatus> = {};
          for (const r of attendRes.data as { user_id: string; status: string }[]) {
            if (r.status === "present" || r.status === "leave" || r.status === "absent")
              m[r.user_id] = r.status;
          }
          const initial: Record<string, AttendanceStatus> = {};
          for (const p of (profilesRes.data as ProfileRow[]) ?? []) {
            initial[p.id] = m[p.id] ?? "absent";
          }
          setStatusByUserId(initial);
        }
      });
    });
  }, [attendanceRehearsal, isAdmin]);

  const groupedMembers = React.useMemo(() => {
    const map = new Map<string, ProfileRow[]>();
    for (const row of attendanceMembers) {
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
  }, [attendanceMembers]);

  const handleSaveAttendance = async () => {
    if (!attendanceRehearsal || attendanceSaving) return;
    const rows = attendanceMembers.map((m) => ({
      user_id: m.id,
      rehearsal_id: attendanceRehearsal.id,
      status: statusByUserId[m.id] ?? "absent",
    }));
    setAttendanceSaving(true);
    const { supabase } = await import("@/lib/supabase");
    const { error } = await supabase
      .from("attendances")
      .upsert(rows, { onConflict: "rehearsal_id,user_id" } as never);
    setAttendanceSaving(false);
    if (error) alert(error.message);
    else {
      alert("已保存");
      setAttendanceRehearsal(null);
    }
  };

  return (
    <div className="min-h-screen pb-6">
      <header className="mb-1">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold text-text">本周排练日程</h1>
            <p className="mt-1 text-xs text-text-muted">查看乐团合排与分排安排</p>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setPublishOpen(true)}
              className="rounded-full bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground shadow-sm hover:opacity-90"
            >
              ➕ 发布新日程
            </button>
          )}
        </div>
        <div className="mt-2">
          <Toggle
            options={["full", "section"] as const}
            value={scheduleTab}
            onChange={setScheduleTab}
            getLabel={(k) => ({ full: "合排", section: "分排" })[k]}
          />
        </div>
      </header>

      {!announcementLoading && announcement?.content && (
        <Card className="mt-2 mb-4 border-amber-200/60 bg-amber-50/80">
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-amber-600">📢</span>
            <p className="min-w-0 truncate text-xs text-amber-900">{announcement.content}</p>
          </div>
        </Card>
      )}

      <section className="space-y-5">
        {rehearsalsLoading ? (
          <p className="py-12 text-center text-xs text-text-muted">加载中…</p>
        ) : displayedRehearsals.length === 0 ? (
          <p className="py-12 text-center text-xs text-text-muted">暂无安排</p>
        ) : (
          displayedRehearsals.map((r) => {
            const ended = r.end_time ? new Date(r.end_time) < new Date() : false;
            return (
              <Card key={String(r.id)}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold text-text">{formatDateMMDD(r.date)}</h2>
                    <p className="mt-0.5 text-[11px] text-text-muted">
                      排练曲目：{r.repertoire || "—"}
                    </p>
                    <p className="mt-1 text-[11px] text-text-subtle">📍 {r.location ?? "—"}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${ended ? "bg-muted text-text-muted" : "bg-info-bg text-info"}`}
                    >
                      {ended ? "已结束" : "即将开始"}
                    </span>
                    {isAdmin ? (
                      <button
                        type="button"
                        onClick={() => setAttendanceRehearsal(r)}
                        className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-text hover:bg-border"
                      >
                        查看出勤
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => alert("请在排练现场扫码签到")}
                        className="rounded border border-border bg-surface px-2 py-0.5 text-[10px] font-medium text-text"
                      >
                        签到
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </section>

      {isAdmin && publishOpen && (
        <Modal open onClose={() => setPublishOpen(false)} title="发布新日程">
          <PublishForm
            publishing={publishing}
            onPublish={async (payload) => {
              setPublishing(true);
              const { supabase } = await import("@/lib/supabase");
              const { error } = await supabase.from("rehearsals").insert([payload]);
              setPublishing(false);
              if (error) {
                alert(error.message);
                return;
              }
              setPublishOpen(false);
            }}
          />
        </Modal>
      )}

      {attendanceRehearsal && (
        <Modal
          open
          onClose={() => !attendanceSaving && setAttendanceRehearsal(null)}
          title={`${formatDateMMDD(attendanceRehearsal.date)} · ${attendanceRehearsal.repertoire || "常规排练"} - 考勤修正`}
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            {attendanceLoading ? (
              <p className="py-8 text-center text-sm text-text-subtle">加载中…</p>
            ) : (
              <div className="space-y-3">
                {groupedMembers.map(({ group, users }) => (
                  <div key={group}>
                    <p className="mb-1 text-sm font-medium text-text-muted">{group}</p>
                    <ul className="space-y-1">
                      {users.map((m) => (
                        <li
                          key={m.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-2 py-1.5"
                        >
                          <span className="truncate text-sm text-text">{m.full_name ?? "—"}</span>
                          <div className="flex shrink-0 gap-0.5">
                            {(["present", "leave", "absent"] as const).map((s) => (
                              <button
                                key={s}
                                type="button"
                                title={s}
                                onClick={() => setStatusByUserId((p) => ({ ...p, [m.id]: s }))}
                                className={
                                  (statusByUserId[m.id] ?? "absent") === s
                                    ? "rounded bg-primary p-1 text-primary-foreground"
                                    : "rounded border border-border bg-surface p-1 text-text-muted hover:bg-muted"
                                }
                              >
                                {s === "present" ? "✅" : s === "leave" ? "⏸️" : "❌"}
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
          <div className="shrink-0 border-t border-border bg-surface px-3 py-2">
            <button
              type="button"
              disabled={attendanceLoading || attendanceSaving}
              onClick={() => handleSaveAttendance()}
              className="w-full rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {attendanceSaving ? "保存中…" : "保存考勤"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// 内联发布表单(短期——用户确定设计后迁入 CreateRehearsalModal)
function PublishForm({
  publishing,
  onPublish,
}: {
  publishing: boolean;
  onPublish: (p: Record<string, unknown>) => Promise<void>;
}) {
  const [type, setType] = React.useState("全团合排");
  const [date, setDate] = React.useState("");
  const [time, setTime] = React.useState("");
  const [endTime, setEndTime] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [repertoire, setRepertoire] = React.useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !time || !endTime || !location || !repertoire) {
      alert("请填写完整");
      return;
    }
    onPublish({ title: type, date, start_time: time, end_time: endTime, location, repertoire });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <Toggle options={["全团合排", "声部分排"] as const} value={type} onChange={setType} />
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none"
      />
      <div className="flex gap-2">
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none"
        />
        <span className="text-[11px] text-text-muted self-center">至</span>
        <input
          type="time"
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
          className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none"
        />
      </div>
      <input
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        placeholder="地点"
        className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none"
      />
      <textarea
        value={repertoire}
        onChange={(e) => setRepertoire(e.target.value)}
        rows={3}
        placeholder="排练曲目"
        className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none"
      />
      <button
        type="submit"
        disabled={publishing}
        className="w-full rounded-full bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        {publishing ? "发布中…" : "确认发布"}
      </button>
    </form>
  );
}
