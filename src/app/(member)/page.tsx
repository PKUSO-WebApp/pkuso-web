"use client";

import React from "react";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import { useRehearsals } from "@/hooks/useRehearsals";
import { useAttendance } from "@/hooks/useAttendance";
import { useLeaveRequests } from "@/hooks/useLeaveRequests";
import { useUser } from "@/context/user-context";
import { Toggle } from "@/components/ui/Toggle";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { RehearsalCard } from "./schedule/components/rehearsal-card";
import { RehearsalDetailModal } from "./schedule/components/rehearsal-detail-modal";
import { CodeVerifyModal } from "./schedule/components/code-verify-modal";
import { LeaveRequestModal } from "./schedule/components/leave-request-modal";
import type { LeaveRequestRow, RehearsalRow } from "@/types/database";
import { parseLocalISO, formatLocalISO, formatDateTimeInChina } from "@/lib/date-utils";
import { judgeAttendanceStatus, canSignIn, hasSignedIn } from "@/lib/attendance-utils";
import { isRehearsalWithinNextWeek } from "@/lib/rehearsal-utils";
import {
  isRehearsalUpdated,
  isRehearsalEnded,
  sortRehearsalsForMember,
  sortEndedFullRehearsals,
} from "@/lib/rehearsal-sort";

export default function Home() {
  const { data: announcement, loading: announcementLoading } = useAnnouncements();
  const { data: rehearsals, loading: rehearsalsLoading, error: rehearsalsError } = useRehearsals();
  const { user } = useUser();
  const {
    map: attendanceMap,
    loading: attendanceLoading,
    fetchMyAttendances,
    upsert,
  } = useAttendance();
  const [scheduleTab, setScheduleTab] = React.useState<"full" | "section" | "history">("full");
  const [showAnnouncementDetail, setShowAnnouncementDetail] = React.useState(false);
  // 请假/补请假（Issue #142）：打开面板的排练 + 我的申请列表
  const { data: leaveRequests, fetchMine: fetchLeaveMine, cancelOnSignIn } = useLeaveRequests();
  const [leaveRehearsal, setLeaveRehearsal] = React.useState<RehearsalRow | null>(null);
  // 详情弹窗当前展示的排练（Issue #173：卡片去按钮化后，出勤状态/请假入口集中于此）
  const [detailRehearsal, setDetailRehearsal] = React.useState<RehearsalRow | null>(null);
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
  // 签到防重复提交（CLAUDE.md 防重复提交范式）：同步 ref 阻断连点/连按 Enter 的第二次提交
  const signingInRef = React.useRef(false); // 分排直签路径（异步 upsert）
  const codeSubmittingRef = React.useRef(false); // 签到码弹窗路径（异步 upsert）

  // 加载我的考勤
  React.useEffect(() => {
    if (!user?.id || !rehearsals) return;
    const ids = rehearsals.map((r) => r.id);
    void fetchMyAttendances(user.id, ids);
  }, [user?.id, rehearsals, fetchMyAttendances]);

  // 加载我的请假申请（RLS 限本人，无需 user_id 过滤）
  React.useEffect(() => {
    if (!user?.id) return;
    void fetchLeaveMine();
  }, [user?.id, fetchLeaveMine]);

  // 每场排练最近的「有效」（未撤回/未取消）申请（fetchMine 已按 created_at 倒序，首个命中即最新；
  // 已取消视同无申请，卡片显示「请假」可重新提交，Issue #149）
  const leaveRequestMap = React.useMemo(() => {
    const m: Record<number, LeaveRequestRow> = {};
    for (const r of leaveRequests as LeaveRequestRow[]) {
      if (r.status === "withdrawn" || r.status === "canceled") continue;
      if (!(r.rehearsal_id in m)) m[r.rehearsal_id] = r;
    }
    return m;
  }, [leaveRequests]);

  // 覆盖请假提醒（Issue #155）：该排练存在 pending/approved 申请时，
  // 签到码弹窗提示「签到会覆盖请假状态」；已驳回维持不变（不提示）
  const codeOverrideHint = React.useMemo(() => {
    if (!codeRehearsal) return null;
    const req = leaveRequestMap[codeRehearsal.id];
    if (req && (req.status === "pending" || req.status === "approved")) {
      return "请假后签到会覆盖请假状态，并记录实际出勤";
    }
    return null;
  }, [codeRehearsal, leaveRequestMap]);

  const list = React.useMemo(() => {
    if (!rehearsals) return [];
    // 显式传入 nowTick 时刻，避免过滤/排序函数内部取 new Date() 导致跨天后列表不刷新
    const now = new Date(nowTick);
    // 历史合排（Issue #154）：全部已结束的合排，按结束时刻近 → 远，不限一周窗口
    if (scheduleTab === "history") {
      return sortEndedFullRehearsals(rehearsals, now);
    }
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
    // 防双击：分排直签为异步提交，同步 ref 阻断连点触发的第二次 upsert
    if (signingInRef.current) return;
    if (!user || !rehearsals) return;
    // 签到锁定（Issue #141）：sign_in_time 非空即已签到，不可再签到/修改
    if (hasSignedIn(attendanceMap[rehearsal.id]?.sign_in_time)) return;
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
      // 分排直签：异步提交期间保持 ref 置位（含考勤刷新），阻断重复提交
      signingInRef.current = true;
      try {
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
          // 覆盖请假（Issue #155）：签到成功后撤销该排练 pending/approved 申请
          // （已驳回维持不变；hook 批量处理并刷新申请列表，best-effort 失败不阻断已成功的签到）
          const cancelResult = await cancelOnSignIn(rehearsal.id);
          // 撤销失败按原因区分提示（返工）：申请已被管理员并发处理（驳回/审批）时无需取消，
          // 仅中性告知；网络/DB 失败时指引联系管理员（approved 申请成员端无手动处理入口）
          if (!cancelResult.ok) {
            alert(
              cancelResult.reason === "already-processed"
                ? "签到成功，请假申请已被管理员处理，无需取消"
                : "签到成功，但请假申请取消失败，请联系管理员处理",
            );
          }
          // await 保持 ref 置位至考勤 map 刷新完成，避免刷新间隙的重复签到
          await fetchMyAttendances(
            user.id,
            rehearsals.map((r) => r.id),
          );
        }
      } finally {
        signingInRef.current = false;
      }
    } else if (rehearsal.sign_in_code) {
      // 合排路径仅同步打开签到弹窗（无异步提交，双击只会重新打开同一弹窗，无副作用），
      // 不需 guard；真正的异步提交在 handleCodeConfirm 中已有独立防重复 guard
      setCodeRehearsal(rehearsal);
      setCodeInput("");
      setCodeError(null);
    } else {
      alert("未配置签到码");
    }
  };

  const handleCodeConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    // 双重防重复提交：同步 ref 阻断输入框内连按 Enter 的第二次 submit，state 异步兜底（禁用按钮）
    if (codeSubmittingRef.current || codeSubmitting) return;
    if (!codeRehearsal || !user || !rehearsals) return;
    // 签到锁定（Issue #141）：弹窗期间若已签到（如另一台设备），提交前拦截并关闭弹窗
    if (hasSignedIn(attendanceMap[codeRehearsal.id]?.sign_in_time)) {
      setCodeRehearsal(null);
      return;
    }
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

    codeSubmittingRef.current = true;
    setCodeSubmitting(true);
    try {
      const err = await upsert([
        {
          rehearsal_id: codeRehearsal.id,
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
        setCodeRehearsal(null);
        // 覆盖请假（Issue #155）：签到成功后撤销该排练 pending/approved 申请
        // （已驳回维持不变；hook 批量处理并刷新申请列表，best-effort 失败不阻断已成功的签到）
        const cancelResult = await cancelOnSignIn(codeRehearsal.id);
        // 撤销失败按原因区分提示（返工）：申请已被管理员并发处理（驳回/审批）时无需取消，
        // 仅中性告知；网络/DB 失败时指引联系管理员（approved 申请成员端无手动处理入口）
        if (!cancelResult.ok) {
          alert(
            cancelResult.reason === "already-processed"
              ? "签到成功，请假申请已被管理员处理，无需取消"
              : "签到成功，但请假申请取消失败，请联系管理员处理",
          );
        }
        // await 保持 ref 置位至考勤 map 刷新完成，避免刷新间隙的重复提交
        await fetchMyAttendances(
          user.id,
          rehearsals.map((r) => r.id),
        );
      } else setCodeError("签到失败");
    } finally {
      codeSubmittingRef.current = false;
      setCodeSubmitting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col pb-safe">
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
            <h1 className="text-lg font-semibold text-text">
              {scheduleTab === "history" ? "历史合排" : "本周排练日程"}
            </h1>
            <p className="mt-1 text-xs text-text-muted">
              {scheduleTab === "history" ? "查看已结束的合排排练" : "查看乐团合排与分排安排"}
            </p>
          </div>
        </div>
        <div className="mt-2">
          <Toggle
            options={["full", "section", "history"] as const}
            value={scheduleTab}
            onChange={setScheduleTab}
            getLabel={(k) => ({ full: "合排", section: "分排", history: "历史合排" })[k]}
          />
        </div>
      </header>

      <section className="flex-1 min-h-0 space-y-3 overflow-y-auto">
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
              // 出勤记录（含 sign_in_time）：签到按钮显示与详情弹窗出勤状态依据（Issue #141）
              attendance={attendanceMap[r.id] ?? null}
              // 考勤加载中：卡片不渲染签到按钮，防首屏 map 未就绪时闪错
              attendanceLoading={attendanceLoading}
              // 更新标识持续到排练结束：已结束后不再显示（Issue #140）
              isUpdated={isRehearsalUpdated(r) && !isRehearsalEnded(r, new Date(nowTick))}
              onSignIn={() => handleSignIn(r)}
              // 覆盖请假按钮判定（Issue #155）
              leaveRequest={leaveRequestMap[r.id] ?? null}
              // 整卡点击打开详情弹窗（Issue #173）
              onClick={() => setDetailRehearsal(r)}
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
        hint={codeOverrideHint}
      />

      {/* 排练详情弹窗（Issue #173/#175）：出勤状态展示 + 「我要请假/我要补请假 ＞」入口
          （红点提示未查看的已通过/已驳回申请；已结束排练显示「我要补请假 ＞」）；
          点击入口打开下方请假/补请假面板（详情弹窗保持打开，关闭面板即返回） */}
      <RehearsalDetailModal
        item={detailRehearsal}
        attendance={detailRehearsal ? (attendanceMap[detailRehearsal.id] ?? null) : null}
        attendanceLoading={attendanceLoading}
        leaveRequest={detailRehearsal ? (leaveRequestMap[detailRehearsal.id] ?? null) : null}
        onClose={() => setDetailRehearsal(null)}
        onLeaveRequest={() => setLeaveRehearsal(detailRehearsal)}
      />

      {/* 请假/补请假面板（Issue #142）：保存成功后刷新卡片状态 */}
      <LeaveRequestModal
        open={!!leaveRehearsal}
        rehearsal={leaveRehearsal}
        onClose={() => setLeaveRehearsal(null)}
        onSaved={() => {
          void fetchLeaveMine();
          // 保存/撤回/取消后同步刷新考勤（撤回不动考勤，刷新仅保证 chip 与数据库一致，Issue #155）
          if (user?.id && rehearsals) {
            void fetchMyAttendances(
              user.id,
              rehearsals.map((r) => r.id),
            );
          }
        }}
      />
    </div>
  );
}
