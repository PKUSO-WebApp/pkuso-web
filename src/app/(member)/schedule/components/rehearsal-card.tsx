import { Card } from "@/components/ui/Card";
import { formatRehearsalRange } from "@/lib/date-utils";
import { canSignIn, hasSignedIn } from "@/lib/attendance-utils";
import { parseLocalISO } from "@/lib/date-utils";
import { getUpdateBadgeLabel } from "@/lib/rehearsal-sort";
import type { LeaveStatus, RehearsalRow } from "@/types/database";

/** 出勤状态文案（与考勤名单/请假面板一致） */
const STATUS_LABEL: Record<string, string> = {
  present: "出席",
  late: "迟到",
  absent: "缺勤",
  excused: "请假",
};

/** 出勤状态图标（与考勤名单一致） */
const STATUS_ICON: Record<string, string> = {
  present: "✅",
  late: "➖",
  absent: "❌",
  excused: "⭕",
};

/** 出勤状态 chip 语义色：出席/迟到成功系、缺勤危险系、请假警告系 */
const STATUS_CHIP_CLASS: Record<string, string> = {
  present: "bg-success-bg text-success",
  late: "bg-success-bg text-success",
  absent: "bg-danger-bg text-danger",
  excused: "bg-warning-bg text-warning",
};

/** 请假申请状态文案（与请假面板一致，Issue #142） */
const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  pending: "待审批",
  approved: "已通过",
  rejected: "已驳回",
  withdrawn: "已撤回",
  canceled: "已取消",
};

/** 请假申请状态 chip 语义色（与请假面板一致） */
const LEAVE_STATUS_CHIP: Record<LeaveStatus, string> = {
  pending: "bg-warning-bg text-warning",
  approved: "bg-success-bg text-success",
  rejected: "bg-danger-bg text-danger",
  withdrawn: "bg-muted text-text-subtle",
  canceled: "bg-muted text-text-subtle",
};

/** 右栏 chip 统一基础样式（Issue #164）：w-full 不随内容撑宽、h-8 与按钮等高、文字居中。
    保持 span（纯展示非交互，语义正确）；inline-flex 使 emoji+文字整体垂直居中，与按钮对齐 */
const CHIP_BASE_CLASS =
  "inline-flex h-8 w-full items-center justify-center rounded-full px-3 text-center text-label";

/** 右栏按钮统一基础样式（Issue #164）：与 chip 等高 h-8、w-full、文字居中 */
const BUTTON_BASE_CLASS =
  "inline-flex h-8 w-full items-center justify-center rounded-full px-3 text-center text-xs font-medium shadow-sm";

type AttendanceInfo = {
  status: string;
  sign_in_time: string | null;
};

type Props = {
  item: RehearsalRow;
  /** 当前用户对该排练的出勤记录（未查询到时为 null） */
  attendance?: AttendanceInfo | null;
  /** 考勤数据加载中：不渲染状态 chip 与签到按钮，防首屏 map 未就绪时闪错（Issue #141 对抗返工） */
  attendanceLoading?: boolean;
  onSignIn?: () => void;
  /** 编辑过（updated_at > created_at），在标题下方展示「更新」提示 */
  isUpdated?: boolean;
  /** 点击请假/补请假/编辑申请/重新申请按钮（打开请假面板） */
  onLeaveRequest?: () => void;
  /** 该排练当前有效（未撤回）的请假申请；无则 null（Issue #142） */
  leaveRequest?: { status: string } | null;
};

export function RehearsalCard({
  item,
  attendance,
  attendanceLoading,
  onSignIn,
  isUpdated,
  onLeaveRequest,
  leaveRequest,
}: Props) {
  // 签到窗口判断：提前超过 30 分钟未开始、或排练已结束，均不可签到
  let blockReason: "not-started" | "ended" | null = null;
  if (item.start_time) {
    const now = new Date();
    const start = parseLocalISO(item.start_time);
    if (!Number.isNaN(start.getTime())) {
      const end = item.end_time
        ? parseLocalISO(item.end_time)
        : new Date(start.getTime() + 3 * 60 * 60 * 1000);
      if (now.getTime() > end.getTime()) {
        blockReason = "ended";
      } else if (!canSignIn(now, start, end)) {
        blockReason = "not-started";
      }
    }
  }

  // 未开始（Issue #171）：chip1 位置留空不渲染「未开始」文字；签到触发时机不变——
  // 未开始仍在签到窗口外不可签（blockReason 判定逻辑保持不变），仅不显示提示文字
  const isNotStarted = blockReason === "not-started";

  // 签到锁定（Issue #141）：sign_in_time 非空即已签到，出勤状态固定，不可再签到/修改
  const signedIn = hasSignedIn(attendance?.sign_in_time);
  // 管理员显式设置的非默认状态（出席/迟到/请假，或签到后被改状态）：状态已确定；
  // 其中「请假未签到且无有效申请」仍可签到覆盖（见 canSignOverrideExcused，Issue #159 返工）
  const explicitStatus = attendance && attendance.status !== "absent" ? attendance.status : null;

  // 状态 chip 展示条件：已签到锁定、排练已结束（无论是否签到）、或管理员显式设定了状态
  const statusChip = signedIn
    ? (attendance?.status ?? "absent")
    : blockReason === "ended"
      ? (attendance?.status ?? "absent")
      : explicitStatus;

  // 有效申请（待审批/已通过/已驳回）：卡片显示申请状态 chip；已撤回/已取消视同无申请
  const leaveStatus = leaveRequest?.status ?? null;
  const hasLeaveRequest =
    leaveStatus === "pending" || leaveStatus === "approved" || leaveStatus === "rejected";
  // 进行中申请（待审批/已通过）：拦截普通签到，需黄色「覆盖请假」按钮；已驳回/已撤回/已取消视同无申请
  const hasActiveLeaveRequest = leaveStatus === "pending" || leaveStatus === "approved";

  // 覆盖请假（Issue #155）：签到窗口内（可签状态）且存在 pending/approved 申请时，
  // 签到按钮变黄色「覆盖请假」——请假后仍可签到，签到会覆盖请假状态
  const canOverrideLeave = !signedIn && blockReason === null && hasActiveLeaveRequest;

  // 覆盖签到（Issue #159 返工，方案 B）：出勤为请假（excused）但未签到、且无进行中申请时，
  // 签到窗口内仍显示正常「签到」按钮——到场可签覆盖请假状态。修复死局：撤回已通过申请后
  // （考勤 excused、sign_in_time 空、无有效申请），此前 canOverrideLeave 需 pending/approved
  // 无法签到、请假入口又被 excused 抑制无法重新申请；管理员手动设 excused 且无申请的场景
  // 与此同构，语义一致（成员到场可覆盖）
  const canSignOverrideExcused =
    explicitStatus === "excused" && !signedIn && !hasActiveLeaveRequest && blockReason === null;

  // 操作按钮状态机（Issue #155）：
  // - 已签到锁定（sign_in_time 非空）统一不显示任何请假入口（返工）：签到后再请假/编辑/重新申请，
  //   审批通过会覆盖考勤为 excused，造成「已签到但请假」不可恢复矛盾（signedIn 锁定不能重签、
  //   approved 无按钮不能撤回）——此前 !signedIn 只拦了无申请分支，pending/rejected 分支遗漏
  //   （已签到 + 已驳回仍显示「重新申请」），返工上提到最前统一拦截；
  // - 有有效申请 → 编辑申请（待审批）/ 重新申请（已驳回）/ 无（已通过不显示操作按钮）；
  // - 无申请 → 请假（仅排练结束前）/ 补请假（仅排练结束后且出勤为缺席，未签到默认缺席）；
  //   与「补请假仅缺席」同思路
  let leaveActionLabel: string | null = null;
  if (!signedIn) {
    if (leaveStatus === "pending") {
      leaveActionLabel = "编辑申请";
    } else if (leaveStatus === "rejected") {
      leaveActionLabel = "重新申请";
    } else if (
      !hasLeaveRequest &&
      !attendanceLoading &&
      onLeaveRequest &&
      attendance?.status !== "excused"
    ) {
      if (blockReason !== "ended") {
        leaveActionLabel = "请假";
      } else if (attendance == null || attendance.status === "absent") {
        leaveActionLabel = "补请假";
      }
    }
  }

  // 更新提示文案（Issue #171）：按 updated_fields 细分（存量数据兜底全量文案）；
  // 显示条件沿用 isUpdated prop（编辑过且未结束，由父级计算），函数返回 null 时不渲染
  const updateLabel = isUpdated ? getUpdateBadgeLabel(item) : null;

  const renderStatusChip = (status: string) => {
    const chipClass = `${CHIP_BASE_CLASS} ${
      STATUS_CHIP_CLASS[status] ?? "bg-muted text-text-subtle"
    }`;
    const content = `${STATUS_ICON[status] ?? ""} ${STATUS_LABEL[status] ?? status}`;
    return <span className={chipClass}>{content}</span>;
  };

  return (
    <Card>
      <div className="flex gap-3">
        {/* 左栏：排练信息（曲目/时间/地点/更新提示 chip） */}
        <div className="min-w-0 flex-1 space-y-0.5 leading-tight">
          <p className="break-words text-sm text-text-muted">
            {item.repertoire}
            {item.type === "section" && item.target_section ? ` · ${item.target_section}` : null}
          </p>
          <h2 className="text-base font-semibold text-text">
            {item.start_time
              ? formatRehearsalRange(item.start_time, item.end_time ?? null)
              : "时间未设置"}
          </h2>
          {updateLabel && (
            <span className="inline-block rounded bg-warning-bg/80 px-1.5 py-0.5 text-xs text-warning">
              {updateLabel}
            </span>
          )}
          <p className="text-xs text-text-muted">
            地点：{item.location}
            {item.type === "section" && item.target_section
              ? ` · 针对：${item.target_section}`
              : null}
          </p>
        </div>

        {/* 右栏（Issue #155 分栏）：固定宽 flex-shrink-0 不挤爆左栏；
            从上到下依次为 签到/出勤状态 → 申请状态 chip → 操作按钮 */}
        <div className="flex w-32 flex-shrink-0 flex-col gap-2 border-l border-border pl-3">
          {/* 1. 签到/出勤状态 */}
          {attendanceLoading ? (
            // 考勤加载中：map 未就绪时既不渲染状态 chip 也不渲染签到按钮，以占位符示意（防首屏闪错）
            <span aria-hidden="true" className={`${CHIP_BASE_CLASS} bg-muted text-text-subtle`}>
              …
            </span>
          ) : statusChip ? (
            // 覆盖请假（Issue #155 返工）：审批通过会把考勤写成 excused（statusChip 命中），
            // 但已批准请假的成员在排练进行中仍应可签到——canOverrideLeave 成立时以黄色
            // 「覆盖请假」按钮替代请假 chip（申请状态 chip 仍在下方展示「已通过」），
            // 视觉上按钮优先级高于 chip：签到的可操作性比「已请假」结论更突出
            canOverrideLeave && onSignIn ? (
              <button
                type="button"
                onClick={onSignIn}
                className={`${BUTTON_BASE_CLASS} bg-warning-bg text-warning`}
              >
                覆盖请假
              </button>
            ) : canSignOverrideExcused && onSignIn ? (
              // 请假未签到 + 无进行中申请（Issue #159 返工，方案 B）：签到窗口内显示正常
              // 「签到」按钮，到场可签覆盖请假；窗口外（未开始/已结束）仍为纯 chip
              <button
                type="button"
                onClick={onSignIn}
                className={`${BUTTON_BASE_CLASS} border border-border bg-surface text-text`}
              >
                签到
              </button>
            ) : (
              renderStatusChip(statusChip)
            )
          ) : isNotStarted ? null : (
            onSignIn && (
              <button
                type="button"
                onClick={onSignIn}
                className={`${BUTTON_BASE_CLASS} ${
                  canOverrideLeave
                    ? "bg-warning-bg text-warning"
                    : "border border-border bg-surface text-text"
                }`}
              >
                {canOverrideLeave ? "覆盖请假" : "签到"}
              </button>
            )
          )}

          {/* 2. 申请状态 chip（待审批/已通过/已驳回，有有效申请时显示） */}
          {hasLeaveRequest && (
            <span
              className={`${CHIP_BASE_CLASS} ${
                LEAVE_STATUS_CHIP[leaveStatus as LeaveStatus] ?? "bg-muted text-text-subtle"
              }`}
            >
              {LEAVE_STATUS_LABEL[leaveStatus as LeaveStatus] ?? leaveStatus}
            </span>
          )}

          {/* 3. 操作按钮（请假/补请假/编辑申请/重新申请；已通过不显示操作按钮） */}
          {leaveActionLabel && (
            <button
              type="button"
              onClick={onLeaveRequest}
              className={`${BUTTON_BASE_CLASS} border border-border bg-surface text-text`}
            >
              {leaveActionLabel}
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}
