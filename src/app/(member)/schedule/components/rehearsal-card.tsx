import { Card } from "@/components/ui/Card";
import { formatRehearsalRange } from "./utils";
import { canSignIn, hasSignedIn } from "@/lib/attendance-utils";
import { parseLocalISO } from "@/lib/date-utils";
import type { RehearsalRow } from "@/types/database";

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
};

export function RehearsalCard({ item, attendance, attendanceLoading, onSignIn, isUpdated }: Props) {
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

  // 签到锁定（Issue #141）：sign_in_time 非空即已签到，出勤状态固定，不可再签到/修改
  const signedIn = hasSignedIn(attendance?.sign_in_time);
  // 管理员显式设置的非默认状态（出席/迟到/请假，或签到后被改状态）：状态已确定，不提供签到按钮
  const explicitStatus = attendance && attendance.status !== "absent" ? attendance.status : null;

  // 状态 chip 展示条件：已签到锁定、排练已结束（无论是否签到）、或管理员显式设定了状态
  const statusChip = signedIn
    ? (attendance?.status ?? "absent")
    : blockReason === "ended"
      ? (attendance?.status ?? "absent")
      : explicitStatus;

  // 已结束灰标签：与状态 chip 并存，标注时间窗已关闭
  const endedLabel =
    blockReason === "ended" && statusChip ? (
      <span className="rounded-full bg-muted px-3 py-1 text-label text-text-subtle">已结束</span>
    ) : null;

  const renderStatusChip = (status: string) => (
    <span
      className={`rounded-full px-3 py-1 text-label ${
        STATUS_CHIP_CLASS[status] ?? "bg-muted text-text-subtle"
      }`}
    >
      {STATUS_ICON[status] ?? ""} {STATUS_LABEL[status] ?? status}
    </span>
  );

  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5 leading-tight">
          <p className="text-sm text-text-muted">
            {item.repertoire}
            {item.type === "section" && item.target_section ? ` · ${item.target_section}` : null}
          </p>
          <h2 className="text-base font-semibold text-text">
            {item.start_time
              ? formatRehearsalRange(item.start_time, item.end_time ?? null)
              : "时间未设置"}
          </h2>
          {isUpdated && (
            <span className="inline-block rounded bg-warning-bg/80 px-1.5 py-0.5 text-xs text-warning">
              更新排练时间/地点/曲目
            </span>
          )}
          <p className="text-xs text-text-muted">
            地点：{item.location}
            {item.type === "section" && item.target_section
              ? ` · 针对：${item.target_section}`
              : null}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          {attendanceLoading ? (
            // 考勤加载中：map 未就绪时既不渲染状态 chip 也不渲染签到按钮，以占位符示意（防首屏闪错）
            <span
              aria-hidden="true"
              className="rounded-full bg-muted px-3 py-1 text-label text-text-subtle"
            >
              …
            </span>
          ) : statusChip ? (
            <>
              {endedLabel}
              {renderStatusChip(statusChip)}
            </>
          ) : blockReason ? (
            <span className="rounded-full bg-muted px-3 py-1 text-label text-text-subtle">
              {blockReason === "ended" ? "已结束" : "未开始"}
            </span>
          ) : (
            onSignIn && (
              <button
                type="button"
                onClick={onSignIn}
                className="inline-flex items-center justify-center rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-text shadow-sm"
              >
                签到
              </button>
            )
          )}
        </div>
      </div>
    </Card>
  );
}
