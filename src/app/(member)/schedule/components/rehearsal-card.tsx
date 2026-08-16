import { Card } from "@/components/ui/Card";
import { formatRehearsalRange } from "@/lib/date-utils";
import { getSignBlockReason, hasSignedIn } from "@/lib/attendance-utils";
import { getUpdateBadgeLabel } from "@/lib/rehearsal-sort";
import type { RehearsalRow } from "@/types/database";

/** 右栏签到按钮基础样式（Issue #164）：等高 h-8、w-full、文字居中 */
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
  /** 考勤数据加载中：不渲染签到按钮，防首屏 map 未就绪时闪错（Issue #141 对抗返工） */
  attendanceLoading?: boolean;
  onSignIn?: () => void;
  /** 点击整卡打开详情弹窗（Issue #173：卡片去按钮化，请假等操作入口收敛到详情弹窗） */
  onClick: () => void;
  /** 该排练当前有效（未撤回）的请假申请；无则 null（Issue #142，供覆盖请假按钮判定） */
  leaveRequest?: { status: string } | null;
  /** 编辑过（updated_at > created_at），在标题下方展示「更新」提示 */
  isUpdated?: boolean;
};

export function RehearsalCard({
  item,
  attendance,
  attendanceLoading,
  onSignIn,
  onClick,
  leaveRequest,
  isUpdated,
}: Props) {
  // 签到窗口判定（Issue #173）：未开始/已结束不渲染任何按钮/chip，仅签到窗口开启时外显签到按钮
  const blockReason = getSignBlockReason(item.start_time, item.end_time ?? null, new Date());

  // 签到锁定（Issue #141）：sign_in_time 非空即已签到，出勤状态固定，不可再签到/修改
  const signedIn = hasSignedIn(attendance?.sign_in_time);
  // 管理员显式设置的非默认状态（出席/迟到/请假，或签到后被改状态）：状态已确定；
  // 其中「请假未签到且无有效申请」仍可签到覆盖（见 canSignOverrideExcused，Issue #159 返工）
  const explicitStatus = attendance && attendance.status !== "absent" ? attendance.status : null;

  // 进行中申请（待审批/已通过）：拦截普通签到，需黄色「覆盖请假」按钮；已驳回/已撤回/已取消视同无申请
  const leaveStatus = leaveRequest?.status ?? null;
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

  // 普通签到：无显式状态（缺席默认/无记录）、未签到、签到窗口内，状态未确定可正常签到
  const canSign = !signedIn && blockReason === null && explicitStatus === null;

  // 签到按钮外显条件（Issue #173）：仅签到窗口开启且未签到、状态可签
  // （无显式状态，或 excused 走覆盖路径）时显示；未开始/已结束/已签到不渲染任何按钮
  const showSignButton =
    !attendanceLoading && (canSign || canOverrideLeave || canSignOverrideExcused);

  // 更新提示文案（Issue #171）：按 updated_fields 细分（存量数据兜底全量文案）；
  // 显示条件沿用 isUpdated prop（编辑过且未结束，由父级计算），函数返回 null 时不渲染
  const updateLabel = isUpdated ? getUpdateBadgeLabel(item) : null;

  return (
    <Card>
      {/* 整卡可点击（Issue #173）：外层用 div + role="button" 承载 onClick 与键盘激活，
          避免与右栏签到按钮形成非法嵌套 button（HTML 规范禁止交互元素嵌套） */}
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        className="flex gap-3 text-left"
      >
        {/* 左栏：排练信息（曲目缩略/时间/地点/更新提示 chip） */}
        <div className="min-w-0 flex-1 space-y-0.5 leading-tight">
          <p className="line-clamp-1 break-words text-sm text-text-muted">
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

        {/* 右栏（Issue #173）：仅签到窗口开启时外显签到按钮；未开始/已结束/已签到
            不渲染任何按钮/chip（出勤状态与申请状态均收敛到详情弹窗展示） */}
        {attendanceLoading ? (
          <div className="flex w-32 flex-shrink-0 flex-col gap-2 border-l border-border pl-3">
            {/* 考勤加载中：占位符示意（防首屏 map 未就绪时闪错，Issue #141） */}
            <span
              aria-hidden="true"
              className="inline-flex h-8 w-full items-center justify-center rounded-full bg-muted px-3 text-center text-label text-text-subtle"
            >
              …
            </span>
          </div>
        ) : showSignButton && onSignIn ? (
          <div className="flex w-32 flex-shrink-0 flex-col gap-2 border-l border-border pl-3">
            <button
              type="button"
              onClick={(e) => {
                // 阻断冒泡：点击签到不触发整卡点击（详情弹窗）
                e.stopPropagation();
                onSignIn();
              }}
              onKeyDown={(e) => {
                // 阻断冒泡（Issue #173 对抗返工）：键盘 Enter/Space 激活按钮的 keydown
                // 若不拦截会冒泡到整卡 onKeyDown 被 preventDefault——取消按钮默认激活
                // （签到不触发）且误开详情弹窗；与上方 onClick 的 stopPropagation 对称
                e.stopPropagation();
              }}
              className={`${BUTTON_BASE_CLASS} ${
                canOverrideLeave
                  ? "bg-warning-bg text-warning"
                  : "border border-border bg-surface text-text"
              }`}
            >
              {canOverrideLeave ? "覆盖请假" : "签到"}
            </button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
