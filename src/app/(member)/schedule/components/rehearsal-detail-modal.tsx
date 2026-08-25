"use client";

import { Modal } from "@/components/ui/Modal";
import { RehearsalDetailContent, type AttendanceInfo } from "./rehearsal-detail-content";
import type { RehearsalRow } from "@/types/database";

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
  return (
    <Modal open={!!item} onClose={onClose} title="排练详情">
      <RehearsalDetailContent
        item={item}
        attendance={attendance}
        attendanceLoading={attendanceLoading}
        leaveRequest={leaveRequest}
        onLeaveRequest={onLeaveRequest}
      />
    </Modal>
  );
}
