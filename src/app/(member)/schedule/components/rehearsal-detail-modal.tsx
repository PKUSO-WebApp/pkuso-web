"use client";

import React from "react";
import { Modal } from "@/components/ui/Modal";
import { formatRehearsalRange } from "@/lib/date-utils";
import { getSignBlockReason, hasSignedIn } from "@/lib/attendance-utils";
import { STATUS_LABEL, STATUS_TEXT_COLOR } from "@/lib/attendance-status";
import type { RehearsalRow } from "@/types/database";

/** 红点已查看记录的 localStorage 键前缀（键 = leaveSeen_<申请id>，值为 "1"） */
const LEAVE_SEEN_PREFIX = "leaveSeen_";

type AttendanceInfo = {
  status: string;
  sign_in_time: string | null;
};

type Props = {
  /** 当前查看的排练；null 时弹窗关闭 */
  item: RehearsalRow | null;
  /** 当前用户对该排练的出勤记录（未查询到时为 null） */
  attendance?: AttendanceInfo | null;
  /** 考勤加载中：出勤状态行显示占位符（防未签到误判） */
  attendanceLoading?: boolean;
  /** 该排练当前有效（未撤回）的请假申请；无则 null（供「我要请假/我要补请假 ＞」红点判定，Issue #173） */
  leaveRequest?: { id?: string; status: string } | null;
  onClose: () => void;
  /** 点击「我要请假/我要补请假 ＞」：标记该申请已查看（红点消失）并打开请假面板（页面接线） */
  onLeaveRequest: () => void;
};

/**
 * 排练只读详情弹窗（Issue #173）
 *
 * 卡片去按钮化后，出勤状态展示与请假入口集中于此：
 * - 左上第一行大字出勤状态（未签到/出席/迟到/缺勤/请假），复用 STATUS_LABEL 映射；
 * - 排练信息只读（类型/时间/地点/曲目）；
 * - 右下角蓝色小字「我要请假 ＞」（语义 token text-info），点击打开现有请假面板；
 *   排练已结束（判定与出勤状态同源）时文案为「我要补请假 ＞」；
 * - 红点：存在已通过/已驳回申请且用户未查看时显示；打开面板查看后消失
 *   （localStorage 本地记录 leaveSeen_<申请id>，不跨设备同步）。
 */
export function RehearsalDetailModal({
  item,
  attendance,
  attendanceLoading,
  leaveRequest,
  onClose,
  onLeaveRequest,
}: Props) {
  // 本次打开会话内已点击查看的申请 id（点击后即时生效驱动红点消失；
  // 持久化记录在 localStorage，跨会话/重开弹窗由渲染期读取兜底）
  const [justViewedId, setJustViewedId] = React.useState<string | null>(null);

  const leaveId = leaveRequest?.id ?? null;
  const leaveStatus = leaveRequest?.status ?? null;
  // 持久化已查看记录：渲染期只读 localStorage（无副作用）。
  // SSR 安全：item 初始恒为 null（客户端 state），短路后不触碰 window；
  // 弹窗内容只在浏览器端渲染（item 非 null 时必为客户端渲染）
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
  // 与出勤状态判定共用，保持同源。刻意不用 useMemo：getSignBlockReason 内部取
  // new Date()，nowTick 重渲染（排练跨过结束时刻，父级定时器触发）时需重新判定，
  // 理由与下方出勤状态注释一致——每渲染重算成本极低，故直接计算。
  const blockReason =
    item != null ? getSignBlockReason(item.start_time, item.end_time ?? null, new Date()) : null;

  // 出勤状态（Issue #173 五行映射）：
  // - 请假（excused）→ 「请假」（无论是否签到，状态已定）
  // - 管理员显式设置的出席/迟到（sign_in_time 为空）→ 按 STATUS_LABEL 展示
  //   （present/late 不可能是默认值，只能是管理员手动改的；直接展示避免与数据库矛盾）
  // - 已签到 → 出勤状态（出席/迟到；签到后被管理员改状态的按 STATUS_LABEL 展示）
  // - 未签到 + 已结束 → 「缺勤」
  // - 未签到 + 未开始/进行中 → 「未签到」
  // 刻意不用 useMemo：getSignBlockReason 内部取 new Date()，nowTick 重渲染（排练跨过
  // 结束时刻，父级定时器触发）时 item/attendance/attendanceLoading 依赖不变，memo 不会
  // 重算，「未签到」停留不更新为「缺勤」，与卡片（每渲染重算）行为不一致。
  // 每次渲染重算成本极低，故直接计算。
  // attendanceColor 与文案同源（同一分支赋值），保证颜色跟随状态；
  // 未签到等非状态文案留空，渲染时回退默认 text-text（Issue #191）
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

  return (
    <Modal open={!!item} onClose={onClose} title="排练详情">
      <div className="space-y-3">
        {/* 出勤状态（左上第一行，较大字体，Issue #173；状态色 Issue #191：
            出席 text-success / 迟到 text-warning / 缺勤 text-danger / 请假 text-info，
            未签到等非状态文案保持默认 text-text。同一元素只保留一个 text-* 类，
            避免 Tailwind 输出顺序导致颜色冲突） */}
        <p className={`text-lg font-semibold ${attendanceColor || "text-text"}`}>
          {attendanceLabel}
        </p>

        {/* 排练信息（只读） */}
        <div className="space-y-2 text-xs">
          <div className="flex items-start justify-between gap-3">
            <span className="shrink-0 text-text-muted">排练类型</span>
            <span className="text-right text-text">
              {item?.type === "section" ? "分排" : "合排"}
              {item?.type === "section" && item?.target_section ? ` · ${item.target_section}` : ""}
            </span>
          </div>
          <div className="flex items-start justify-between gap-3">
            <span className="shrink-0 text-text-muted">时间</span>
            <span className="text-right text-text">
              {item?.start_time
                ? formatRehearsalRange(item.start_time, item.end_time ?? null)
                : "时间未设置"}
            </span>
          </div>
          <div className="flex items-start justify-between gap-3">
            <span className="shrink-0 text-text-muted">地点</span>
            <span className="text-right text-text">{item?.location ?? "—"}</span>
          </div>
          <div className="flex items-start justify-between gap-3">
            <span className="shrink-0 text-text-muted">曲目</span>
            <span className="break-words text-right text-text">{item?.repertoire ?? "—"}</span>
          </div>
        </div>

        {/* 右下角：我要请假/我要补请假（蓝色小字，全角 ＞；语义 token text-info 亮/暗双模式可用，
            红点 = 有未查看的已通过/已驳回申请；已结束排练显示「我要补请假 ＞」，Issue #175） */}
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
    </Modal>
  );
}
