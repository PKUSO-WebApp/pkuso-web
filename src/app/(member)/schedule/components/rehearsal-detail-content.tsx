"use client";

import React from "react";
import { formatRehearsalRange } from "@/lib/date-utils";
import { getSignBlockReason, hasSignedIn } from "@/lib/attendance-utils";
import { STATUS_LABEL, STATUS_TEXT_COLOR } from "@/lib/attendance-status";
import type { RehearsalRow } from "@/types/database";

/** 红点已查看记录的 localStorage 键前缀（键 = leaveSeen_<申请id>，值为 "1"） */
const LEAVE_SEEN_PREFIX = "leaveSeen_";

export type AttendanceInfo = {
  status: string;
  sign_in_time: string | null;
};

type Props = {
  /** 当前查看的排练；null 时不渲染（由外层弹窗/页面控制显隐） */
  item: RehearsalRow | null;
  /** 当前用户对该排练的出勤记录（未查询到时为 null） */
  attendance?: AttendanceInfo | null;
  /** 考勤加载中：出勤状态行显示占位符（防未签到误判） */
  attendanceLoading?: boolean;
  /** 该排练当前有效（未撤回）的请假申请；无则 null（供「我要请假/我要补请假 ＞」红点判定，Issue #173） */
  leaveRequest?: { id?: string; status: string } | null;
  /** 点击「我要请假/我要补请假 ＞」：标记该申请已查看（红点消失）并打开请假面板（页面接线） */
  onLeaveRequest: () => void;
};

/**
 * 排练只读详情内容（Issue #173 / Modal→页面改造）
 *
 * 卡片去按钮化后，出勤状态展示与请假入口集中于此：
 * - 左上第一行大字出勤状态（未签到/出席/迟到/缺勤/请假），复用 STATUS_LABEL 映射；
 * - 排练信息只读（类型/时间/地点/曲目）；
 * - 右下角蓝色小字「我要请假 ＞」（语义 token text-info），点击打开现有请假面板；
 *   排练已结束（判定与出勤状态同源）时文案为「我要补请假 ＞」；
 * - 红点：存在已通过/已驳回申请且用户未查看时显示；打开面板查看后消失
 *   （localStorage 本地记录 leaveSeen_<申请id>，不跨设备同步）。
 *
 * 该组件仅渲染内容本身，不含 Modal 外壳，供详情弹窗与管理端/成员端详情页复用。
 */
export function RehearsalDetailContent({
  item,
  attendance,
  attendanceLoading,
  leaveRequest,
  onLeaveRequest,
}: Props) {
  // 本次打开会话内已点击查看的申请 id（点击后即时生效驱动红点消失；
  // 持久化记录在 localStorage，跨会话/重开弹窗由渲染期读取兜底）
  const [justViewedId, setJustViewedId] = React.useState<string | null>(null);

  const leaveId = leaveRequest?.id ?? null;
  const leaveStatus = leaveRequest?.status ?? null;
  // 持久化已查看记录：渲染期只读 localStorage（无副作用）。
  const persistedSeen =
    item != null &&
    leaveId != null &&
    typeof window !== "undefined" &&
    window.localStorage.getItem(`${LEAVE_SEEN_PREFIX}${leaveId}`) === "1";

  // 红点条件（Issue #173）：申请为已通过/已驳回 且 未查看（持久记录或本会话已点击）
  const showLeaveDot =
    leaveId != null &&
    (leaveStatus === "approved" || leaveStatus === "rejected") &&
    !persistedSeen &&
    justViewedId !== leaveId;

  const handleLeaveClick = () => {
    // 查看该申请：已通过/已驳回时写入已查看记录（红点消失；pending 无需标记，
    // 若之后被审批再打开面板时才标记，避免"从未看过审批结果"却无红点）
    if (leaveId != null && (leaveStatus === "approved" || leaveStatus === "rejected")) {
      window.localStorage.setItem(`${LEAVE_SEEN_PREFIX}${leaveId}`, "1");
      setJustViewedId(leaveId);
    }
    onLeaveRequest();
  };

  // 时间区块判定（Issue #175）：排练是否已结束，请假入口文案（我要请假/我要补请假）
  // 与出勤状态判定共用，保持同源。
  const blockReason =
    item != null ? getSignBlockReason(item.start_time, item.end_time ?? null, new Date()) : null;

  // 出勤状态（Issue #173 五行映射），每次渲染重算（与卡片行为一致，跨结束时刻自动刷新）。
  let attendanceLabel = "";
  let attendanceColor = "";
  if (item) {
    if (attendanceLoading) {
      attendanceLabel = "…";
    } else if (attendance?.status === "excused") {
      attendanceLabel = STATUS_LABEL.excused;
      attendanceColor = STATUS_TEXT_COLOR.excused;
    } else if (attendance?.status === "present" || attendance?.status === "late") {
      attendanceLabel = STATUS_LABEL[attendance.status];
      attendanceColor = STATUS_TEXT_COLOR[attendance.status];
    } else if (hasSignedIn(attendance?.sign_in_time)) {
      attendanceLabel = STATUS_LABEL[attendance?.status ?? ""] ?? STATUS_LABEL.absent;
      attendanceColor = STATUS_TEXT_COLOR[attendance?.status ?? ""] ?? STATUS_TEXT_COLOR.absent;
    } else {
      attendanceLabel = blockReason === "ended" ? STATUS_LABEL.absent : "未签到";
      attendanceColor = blockReason === "ended" ? STATUS_TEXT_COLOR.absent : "";
    }
  }

  if (!item) return null;

  return (
    <div className="space-y-3">
      {/* 出勤状态（左上第一行，较大字体，Issue #173；状态色 Issue #191） */}
      <p className={`text-lg font-semibold ${attendanceColor || "text-text"}`}>{attendanceLabel}</p>

      {/* 排练信息（只读） */}
      <div className="space-y-2 text-xs">
        <div className="flex items-start justify-between gap-3">
          <span className="shrink-0 text-text-muted">排练类型</span>
          <span className="text-right text-text">
            {item.type === "section" ? "分排" : "合排"}
            {item.type === "section" && item.target_section ? ` · ${item.target_section}` : ""}
          </span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <span className="shrink-0 text-text-muted">时间</span>
          <span className="text-right text-text">
            {item.start_time
              ? formatRehearsalRange(item.start_time, item.end_time ?? null)
              : "时间未设置"}
          </span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <span className="shrink-0 text-text-muted">地点</span>
          <span className="text-right text-text">{item.location ?? "—"}</span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <span className="shrink-0 text-text-muted">曲目</span>
          <span className="break-words text-right text-text">{item.repertoire ?? "—"}</span>
        </div>
      </div>

      {/* 右下角：我要请假/我要补请假（蓝色小字，全角 ＞；语义 token text-info，红点 = 未查看的已通过/已驳回申请） */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleLeaveClick}
          className="flex items-center gap-1 text-xs text-info"
        >
          {showLeaveDot && (
            <span
              aria-hidden="true"
              data-testid="leave-dot"
              className="inline-block h-1.5 w-1.5 rounded-full bg-danger"
            />
          )}
          {blockReason === "ended" ? "我要补请假 ＞" : "我要请假 ＞"}
        </button>
      </div>
    </div>
  );
}
