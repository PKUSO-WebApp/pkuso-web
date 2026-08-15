"use client";

import React from "react";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import { useRehearsals } from "@/hooks/useRehearsals";
import { useAttendance } from "@/hooks/useAttendance";
import { useUser } from "@/context/user-context";
import { Toggle } from "@/components/ui/Toggle";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { RehearsalCard } from "./schedule/components/rehearsal-card";
import { CodeVerifyModal } from "./schedule/components/code-verify-modal";
import type { RehearsalRow } from "@/types/database";
import { parseLocalISO, formatLocalISO, formatDateTimeInChina } from "@/lib/date-utils";
import { judgeAttendanceStatus, canSignIn } from "@/lib/attendance-utils";
import { isRehearsalWithinNextWeek } from "@/lib/rehearsal-utils";
import {
  isRehearsalUpdated,
  isRehearsalEnded,
  sortRehearsalsForMember,
} from "@/lib/rehearsal-sort";

/** 已签到状态：出席或迟到算作已签到 */
function hasSignedStatus(status?: string): boolean {
  return status === "present" || status === "late";
}

export default function Home() {
  const { data: announcement, loading: announcementLoading } = useAnnouncements();
  const { data: rehearsals, loading: rehearsalsLoading, error: rehearsalsError } = useRehearsals();
  const { user } = useUser();
  const { map: attendanceMap, fetchMyAttendances, upsert } = useAttendance();
  const [scheduleTab, setScheduleTab] = React.useState<"full" | "section">("full");
  const [showAnnouncementDetail, setShowAnnouncementDetail] = React.useState(false);
  // 分钟级时钟 tick：跨天停留页面时，定时刷新"今天"边界，驱动列表过滤与签到按钮状态更新
  const [nowTick, setNowTick] = React.useState(() => Date.now());

  // 欢迎语：显示 5 秒后淡出（500ms transition），淡出完成后不再渲染
  const [welcomeVisible, setWelcomeVisible] = React.useState(true);
  const [welcomeMounted, setWelcomeMounted] = React.useState(true);

  React.useEffect(() => {
    if (!user) return;
    const fadeTimer = window.setTimeout(() => setWelcomeVisible(false), 5000);
    const unmountTimer = window.setTimeout(() => setWelcomeMounted(false), 5500);
    // 组件卸载时清理定时器，避免内存泄漏与卸载后 setState
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(unmountTimer);
    };
  }, [user]);

  // 每分钟更新一次 nowTick；依赖数组为空，interval 只在挂载时创建一次
  React.useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

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
    // 显式传入 nowTick 时刻，避免过滤/排序函数内部取 new Date() 导致跨天后列表不刷新
    const now = new Date(nowTick);
    const filtered = rehearsals.filter(
      (r) =>
        (r.type === "full" ? "full" : "section") === scheduleTab &&
        // 仅显示未来一周内（含今天）的排练，已过去或超过一周的隐藏
        isRehearsalWithinNextWeek(r.start_time, now),
    );
    // 过滤后按用户端规则排序（Issue #140）：进行中/未开始近 → 远（进行中最前）、
    // 已结束组在底部（最近结束在前）、更新过的排在最近一次日程之后（是最近一次则保持首位）。
    // useRehearsals 返回降序（admin 端共用该 hook，不能改），这里仅对首页展示重新排序
    return sortRehearsalsForMember(filtered, now);
  }, [rehearsals, scheduleTab, nowTick]);

  const handleSignIn = async (rehearsal: RehearsalRow) => {
    if (!user || !rehearsals) return;
    if (hasSignedStatus(attendanceMap[rehearsal.id]?.status)) return;
    if (!rehearsal.start_time) {
      alert("该排练未设置时间，无法签到");
      return;
    }

    const now = new Date();
    const start = parseLocalISO(rehearsal.start_time);
    const end = rehearsal.end_time
      ? parseLocalISO(rehearsal.end_time)
      : new Date(start.getTime() + 3 * 60 * 60 * 1000);

    // 签到窗口检查：排练已结束或提前超过 30 分钟不允许签到
    if (now.getTime() > end.getTime()) {
      alert("排练已结束，无法签到");
      return;
    }
    if (!canSignIn(now, start, end)) {
      alert("排练尚未开始，暂不能签到");
      return;
    }

    const status = judgeAttendanceStatus(now, start, end);

    if (rehearsal.type === "section") {
      const err = await upsert([
        {
          rehearsal_id: rehearsal.id,
          user_id: user.id,
          status,
          sign_in_time: formatLocalISO(now),
        },
      ]);
      if (!err) {
        alert(
          status === "late"
            ? "签到成功，已记录迟到"
            : status === "absent"
              ? "签到成功（排练已结束，记为缺勤）"
              : "签到成功",
        );
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

    const now = new Date();
    const start = parseLocalISO(codeRehearsal.start_time!);
    const end = codeRehearsal.end_time
      ? parseLocalISO(codeRehearsal.end_time)
      : new Date(start.getTime() + 3 * 60 * 60 * 1000);

    // 签到窗口检查：排练已结束或提前超过 30 分钟不允许签到
    if (now.getTime() > end.getTime()) {
      alert("排练已结束，无法签到");
      return;
    }
    if (!canSignIn(now, start, end)) {
      alert("排练尚未开始，暂不能签到");
      return;
    }
    const status = judgeAttendanceStatus(now, start, end);

    setCodeSubmitting(true);
    const err = await upsert([
      {
        rehearsal_id: codeRehearsal.id,
        user_id: user.id,
        status,
        sign_in_time: formatLocalISO(now),
      },
    ]);
    setCodeSubmitting(false);
    if (!err) {
      alert(
        status === "late"
          ? "签到成功，已记录迟到"
          : status === "absent"
            ? "签到成功（排练已结束，记为缺勤）"
            : "签到成功",
      );
      setCodeRehearsal(null);
      void fetchMyAttendances(
        user.id,
        rehearsals.map((r) => r.id),
      );
    } else setCodeError("签到失败");
  };

  return (
    <div className="min-h-screen pb-safe">
      {/* 欢迎语（5 秒后淡出消失） */}
      {user && welcomeMounted && (
        <div
          className={`mb-4 transition-opacity duration-500 ${
            welcomeVisible ? "opacity-100" : "opacity-0"
          }`}
        >
          <p className="text-sm text-text-muted">
            欢迎{user.name?.trim() ? `，${user.name}` : ""}！
          </p>
        </div>
      )}

      {/* 公告（点击查看详情） */}
      {!announcementLoading && announcement?.content && (
        <button
          type="button"
          onClick={() => setShowAnnouncementDetail(true)}
          className="mb-4 block w-full text-left"
        >
          <Card className="border-warning-bg bg-warning-bg/80">
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-warning">📢</span>
              <p className="min-w-0 break-words line-clamp-3 text-xs text-warning">
                {announcement.content}
              </p>
            </div>
          </Card>
        </button>
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
              hasSigned={hasSignedStatus(attendanceMap[r.id]?.status)}
              // 更新标识持续到排练结束：已结束后不再显示（Issue #140）
              isUpdated={isRehearsalUpdated(r) && !isRehearsalEnded(r, new Date(nowTick))}
              onSignIn={() => handleSignIn(r)}
            />
          ))
        )}
      </section>

      {/* 公告详情 */}
      <Modal
        open={showAnnouncementDetail}
        onClose={() => setShowAnnouncementDetail(false)}
        title="公告详情"
        position="bottom"
      >
        <div className="space-y-3">
          <p className="text-label text-text-muted">
            发布时间：{formatDateTimeInChina(announcement?.created_at ?? null)}
          </p>
          <p className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-text">
            {announcement?.content}
          </p>
        </div>
      </Modal>

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
