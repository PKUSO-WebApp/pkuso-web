"use client";

import React from "react";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import { useRehearsals } from "@/hooks/useRehearsals";
import { useAttendance } from "@/hooks/useAttendance";
import { useUser } from "@/context/user-context";
import { Toggle } from "@/components/ui/Toggle";
import { Card } from "@/components/ui/Card";
import { RehearsalCard } from "./schedule/components/rehearsal-card";
import { CodeVerifyModal } from "./schedule/components/code-verify-modal";
import type { RehearsalRow } from "@/types/database";

export default function Home() {
  const { data: announcement, loading: announcementLoading } = useAnnouncements();
  const { data: rehearsals, loading: rehearsalsLoading, error: rehearsalsError } = useRehearsals();
  const { user } = useUser();
  const { map: attendanceMap, fetchMyAttendances, upsert } = useAttendance();
  const [scheduleTab, setScheduleTab] = React.useState<"full" | "section">("full");

  // 签到码
  const [codeRehearsal, setCodeRehearsal] = React.useState<RehearsalRow | null>(null);
  const [codeInput, setCodeInput] = React.useState("");
  const [codeSubmitting, setCodeSubmitting] = React.useState(false);
  const [codeError, setCodeError] = React.useState<string | null>(null);

  // 加载我的考勤
  React.useEffect(() => {
    if (!user?.id || !rehearsals) return;
    const ids = rehearsals.map((r) => r.id);
    void fetchMyAttendances(user.id, ids);
  }, [user?.id, rehearsals, fetchMyAttendances]);

  const list = React.useMemo(() => {
    if (!rehearsals) return [];
    return rehearsals.filter((r) => (r.type === "full" ? "full" : "section") === scheduleTab);
  }, [rehearsals, scheduleTab]);

  const handleSignIn = async (rehearsal: RehearsalRow) => {
    if (!user || !rehearsals) return;
    if (attendanceMap[rehearsal.id]) return;

    if (rehearsal.type === "section") {
      const err = await upsert([
        { rehearsal_id: rehearsal.id, user_id: user.id, status: "present" },
      ]);
      if (!err) {
        alert("签到成功");
        void fetchMyAttendances(
          user.id,
          rehearsals.map((r) => r.id),
        );
      }
    } else if (rehearsal.sign_in_code) {
      setCodeRehearsal(rehearsal);
      setCodeInput("");
      setCodeError(null);
    } else {
      alert("未配置签到码");
    }
  };

  const handleCodeConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!codeRehearsal || !user || !rehearsals) return;
    if (!/^\d{4}$/.test(codeInput)) {
      setCodeError("请输4位数字");
      return;
    }
    if (codeInput !== codeRehearsal.sign_in_code) {
      setCodeError("签到码错误");
      return;
    }
    setCodeSubmitting(true);
    const err = await upsert([
      { rehearsal_id: codeRehearsal.id, user_id: user.id, status: "present" },
    ]);
    setCodeSubmitting(false);
    if (!err) {
      alert("签到成功");
      setCodeRehearsal(null);
      void fetchMyAttendances(
        user.id,
        rehearsals.map((r) => r.id),
      );
    } else setCodeError("签到失败");
  };

  return (
    <div className="min-h-screen pb-safe">
      {/* 欢迎语 */}
      {user && (
        <div className="mb-4">
          <p className="text-sm text-text-muted">
            欢迎{user.name?.trim() ? `，${user.name}` : ""}！
          </p>
        </div>
      )}

      {/* 公告 */}
      {!announcementLoading && announcement?.content && (
        <Card className="mb-4 border-warning-bg bg-warning-bg/80">
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-warning">📢</span>
            <p className="min-w-0 truncate text-xs text-warning">{announcement.content}</p>
          </div>
        </Card>
      )}

      {/* 排练日程 */}
      <header className="mb-1">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold text-text">本周排练日程</h1>
            <p className="mt-1 text-xs text-text-muted">查看乐团合排与分排安排</p>
          </div>
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

      <section className="space-y-3">
        {rehearsalsLoading ? (
          <p className="py-12 text-center text-xs text-text-muted">加载中…</p>
        ) : rehearsalsError ? (
          <Card className="border-danger-bg bg-danger-bg/80">
            <p className="px-3 py-2 text-sm text-danger">加载失败：{rehearsalsError}</p>
          </Card>
        ) : list.length === 0 ? (
          <p className="py-12 text-center text-xs text-text-muted">暂无安排</p>
        ) : (
          list.map((r) => (
            <RehearsalCard
              key={String(r.id)}
              item={r}
              hasSigned={!!attendanceMap[r.id]}
              onSignIn={() => handleSignIn(r)}
            />
          ))
        )}
      </section>

      <CodeVerifyModal
        open={!!codeRehearsal}
        title={codeRehearsal?.repertoire ?? ""}
        submitting={codeSubmitting}
        codeInput={codeInput}
        codeError={codeError}
        onCodeChange={(v) => {
          setCodeError(null);
          setCodeInput(v);
        }}
        onConfirm={handleCodeConfirm}
        onClose={() => {
          if (!codeSubmitting) setCodeRehearsal(null);
        }}
      />
    </div>
  );
}
