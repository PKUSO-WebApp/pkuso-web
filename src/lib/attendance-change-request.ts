import { STATUS_LABEL } from "@/lib/attendance-status";
import { formatDisplayDateTime } from "@/lib/date-utils";
import type {
  AttendanceChangeRequestStatus,
  AttendanceChangeRequestWithDetails,
} from "@/types/database";

/** API `POST /api/admin/attendance-requests` 的单条结果 */
export type DecisionResult =
  | { id: string; ok: true; status: "approved" | "rejected" }
  | { id: string; ok: false; code: string; currentStatus?: string; message?: string };

export type DecisionFailure = Extract<DecisionResult, { ok: false }>;

export type DecisionResponse = {
  ok: boolean;
  results: DecisionResult[];
  error?: string;
};

export const ATTENDANCE_CHANGE_STATUS_LABEL: Record<AttendanceChangeRequestStatus, string> = {
  pending: "待审批",
  approved: "已通过",
  rejected: "已驳回",
  canceled: "已取消",
};

export const ATTENDANCE_CHANGE_STATUS_CHIP: Record<AttendanceChangeRequestStatus, string> = {
  pending: "bg-warning-bg text-warning",
  approved: "bg-success-bg text-success",
  rejected: "bg-danger-bg text-danger",
  canceled: "bg-muted text-text-subtle",
};

/** 成员展示：姓名（乐器）；乐器为空时只显示姓名 */
export function memberLabel(
  person: { full_name?: string | null; instrument?: string | null } | null | undefined,
): string {
  const name = person?.full_name?.trim() || "未知成员";
  const instrument = person?.instrument?.trim();
  return instrument ? `${name}（${instrument}）` : name;
}

/** 排练展示：X月X日 周X HH:mm 合排/分排《曲目》 */
export function rehearsalLabel(
  rehearsal: AttendanceChangeRequestWithDetails["rehearsals"],
): string {
  const name = rehearsal?.repertoire?.trim() || rehearsal?.title?.trim() || "排练";
  const type = rehearsal?.type === "full" ? "合排" : rehearsal?.type === "section" ? "分排" : "";
  const when = rehearsal?.start_time ? formatDisplayDateTime(rehearsal.start_time) : "";
  const typeAndName = type ? `${type}《${name}》` : `《${name}》`;
  return [when, typeAndName].filter(Boolean).join(" ");
}

/** 考勤状态变化：缺勤 → 出席 */
export function statusChangeLabel(from: string, to: string): string {
  return `${STATUS_LABEL[from] ?? from} → ${STATUS_LABEL[to] ?? to}`;
}

/** 审批失败码 → 管理员可读文案 */
export function decisionMessage(code: string, currentStatus?: string): string {
  if (code === "stale") {
    const current = currentStatus
      ? `（当前：${STATUS_LABEL[currentStatus] ?? currentStatus}）`
      : "";
    return `考勤已变化${current}，需要确认强制通过`;
  }
  if (code === "not_pending") return "申请已被处理";
  if (code === "not_found") return "申请不存在";
  if (code === "attendance_missing") return "考勤记录不存在，无法通过";
  if (code === "reject_reason_required") return "请填写驳回原因";
  if (code === "rpc_error") return "处理失败，请重试";
  return "处理失败，请重试";
}

export function partitionAttendanceChangeRequests(requests: AttendanceChangeRequestWithDetails[]): {
  pending: AttendanceChangeRequestWithDetails[];
  processed: AttendanceChangeRequestWithDetails[];
} {
  return {
    pending: requests.filter((request) => request.status === "pending"),
    processed: requests.filter(
      (request) => request.status === "approved" || request.status === "rejected",
    ),
  };
}
