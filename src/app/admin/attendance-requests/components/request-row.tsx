"use client";

import {
  ATTENDANCE_CHANGE_STATUS_CHIP,
  ATTENDANCE_CHANGE_STATUS_LABEL,
  memberLabel,
  rehearsalLabel,
  statusChangeLabel,
} from "@/lib/attendance-change-request";
import type { AttendanceChangeRequestWithDetails } from "@/types/database";

type RequestRowProps = {
  request: AttendanceChangeRequestWithDetails;
  selected: boolean;
  onToggle: (id: string) => void;
  pending: boolean;
};

/** 一条出勤修改申请；待审批可勾选，已处理显示审批结果。 */
export function RequestRow({ request, selected, onToggle, pending }: RequestRowProps) {
  const target = memberLabel(request.target);
  return (
    <div
      className={`flex items-start gap-2 rounded-xl border bg-card px-3 py-2 ${
        selected ? "border-primary" : "border-border"
      }`}
    >
      {pending && (
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(request.id)}
          aria-label={`选择 ${target}`}
          className="mt-1 accent-primary"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-sm font-semibold text-text">{target}</p>
          <span
            className={`rounded-full px-2 py-0.5 text-label ${
              ATTENDANCE_CHANGE_STATUS_CHIP[request.status]
            }`}
          >
            {ATTENDANCE_CHANGE_STATUS_LABEL[request.status]}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-text-muted">{rehearsalLabel(request.rehearsals)}</p>
        <p className="mt-0.5 text-xs text-text">
          {statusChangeLabel(request.from_status, request.to_status)}
        </p>
        <p className="mt-0.5 text-xs text-text-subtle">
          申请人：{memberLabel(request.requester)}
          {" · "}
          {new Date(request.created_at).toLocaleString("zh-CN", { hour12: false })}
        </p>
        {request.reason && <p className="mt-0.5 text-xs text-text-muted">理由：{request.reason}</p>}
        {request.status === "rejected" && request.reject_reason && (
          <p className="mt-0.5 text-xs text-danger">驳回原因：{request.reject_reason}</p>
        )}
        {request.status !== "pending" && (
          <p className="mt-0.5 text-xs text-text-subtle">
            审批人：{request.decider?.full_name?.trim() || "—"}
            {request.decided_at
              ? ` · ${new Date(request.decided_at).toLocaleString("zh-CN", { hour12: false })}`
              : ""}
          </p>
        )}
      </div>
    </div>
  );
}
