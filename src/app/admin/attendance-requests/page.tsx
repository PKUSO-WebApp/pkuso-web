"use client";

import React from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Toggle } from "@/components/ui/Toggle";
import { useAdminPageHeader } from "@/context/admin-page-header-context";
import { useAttendanceChangeRequests } from "@/hooks/useAttendanceChangeRequests";
import { STATUS_LABEL } from "@/lib/attendance-status";
import {
  decisionMessage,
  memberLabel,
  partitionAttendanceChangeRequests,
  type DecisionFailure,
  type DecisionResult,
} from "@/lib/attendance-change-request";
import type { AttendanceChangeRequestWithDetails } from "@/types/database";
import { RequestRow } from "./components/request-row";

type Tab = "pending" | "processed";
type Notice = { kind: "success" | "error"; text: string } | null;

function memberName(requests: AttendanceChangeRequestWithDetails[], id: string): string {
  return memberLabel(requests.find((request) => request.id === id)?.target);
}

/** P4'：管理员审批声部长/首席提交的出勤修改申请。 */
export default function AttendanceRequestsPage() {
  const { setTitle } = useAdminPageHeader();
  React.useEffect(() => {
    setTitle("考勤修改申请");
  }, [setTitle]);

  const { requests, loading, error, processing, fetch, approve, reject } =
    useAttendanceChangeRequests();
  const [tab, setTab] = React.useState<Tab>("pending");
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [confirmApproveOpen, setConfirmApproveOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [rejectReason, setRejectReason] = React.useState("");
  const [rejectError, setRejectError] = React.useState<string | null>(null);
  const [staleOpen, setStaleOpen] = React.useState(false);
  const [staleResults, setStaleResults] = React.useState<DecisionFailure[]>([]);
  const [notice, setNotice] = React.useState<Notice>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const busyRef = React.useRef(false);

  const { pending, processed } = partitionAttendanceChangeRequests(requests);
  const list = tab === "pending" ? pending : processed;
  const pendingIds = new Set(pending.map((request) => request.id));
  const selectedPending = selectedIds.filter((id) => pendingIds.has(id));
  const allSelected =
    pending.length > 0 && pending.every((request) => selectedPending.includes(request.id));

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const toggleAll = () => {
    setSelectedIds(allSelected ? [] : pending.map((request) => request.id));
  };

  const showDecisionResult = (results: DecisionResult[], successVerb: "通过" | "驳回") => {
    const failed = results.filter((result) => !result.ok);
    const stale = failed.filter((result) => result.code === "stale");
    const otherFailed = failed.filter((result) => result.code !== "stale");
    if (stale.length > 0) {
      setStaleResults(stale);
      setStaleOpen(true);
    }
    if (otherFailed.length > 0) {
      setNotice({
        kind: "error",
        text: `已${successVerb} ${results.length - failed.length} 条；失败：${otherFailed
          .map(
            (result) =>
              `${memberName(requests, result.id)}：${decisionMessage(result.code, result.currentStatus)}`,
          )
          .join("；")}`,
      });
    } else if (stale.length === 0) {
      setNotice({ kind: "success", text: `已${successVerb} ${results.length} 条` });
    }
  };

  const handleApprove = async (ids: string[], force = false) => {
    if (ids.length === 0 || busyRef.current) return;
    busyRef.current = true;
    setActionError(null);
    try {
      const response = await approve(ids, force);
      if (!response.ok) {
        setActionError(response.error || "处理失败，请重试");
        return;
      }
      setSelectedIds([]);
      showDecisionResult(response.results, "通过");
    } finally {
      busyRef.current = false;
      setConfirmApproveOpen(false);
    }
  };

  const handleReject = async () => {
    const reason = rejectReason.trim();
    if (reason === "") {
      setRejectError("请填写驳回原因");
      return;
    }
    if (selectedPending.length === 0 || busyRef.current) return;
    busyRef.current = true;
    setActionError(null);
    try {
      const response = await reject(selectedPending, reason);
      if (!response.ok) {
        setRejectError(response.error || "处理失败，请重试");
        return;
      }
      setSelectedIds([]);
      setRejectOpen(false);
      setRejectReason("");
      setRejectError(null);
      showDecisionResult(response.results, "驳回");
    } finally {
      busyRef.current = false;
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Toggle
          options={["pending", "processed"] as const}
          value={tab}
          onChange={(value) => {
            setTab(value);
            setSelectedIds([]);
            setNotice(null);
            setActionError(null);
          }}
          getLabel={(value) =>
            value === "pending" ? `待审批 (${pending.length})` : `已处理 (${processed.length})`
          }
        />
        {tab === "pending" && pending.length > 0 && (
          <button
            type="button"
            onClick={toggleAll}
            className="text-xs text-text-muted underline-offset-2 hover:underline"
          >
            {allSelected ? "取消全选" : "全选"}
          </button>
        )}
      </div>

      {notice && (
        <p
          className={`rounded-xl px-3 py-2 text-xs ${
            notice.kind === "success" ? "bg-success-bg text-success" : "bg-danger-bg text-danger"
          }`}
        >
          {notice.text}
        </p>
      )}
      {actionError && <p className="text-xs text-danger">{actionError}</p>}
      {error && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-danger-bg px-3 py-2 text-xs text-danger">
          <span>{error}</span>
          <button type="button" onClick={() => void fetch()} className="shrink-0 underline">
            重试
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 space-y-2 overflow-y-auto">
        {loading && requests.length === 0 ? (
          <p className="py-8 text-center text-xs text-text-subtle">加载中…</p>
        ) : list.length === 0 ? (
          <p className="py-8 text-center text-xs text-text-muted">
            {tab === "pending" ? "暂无待审批的考勤修改申请" : "暂无已处理的申请"}
          </p>
        ) : (
          list.map((request) => (
            <RequestRow
              key={request.id}
              request={request}
              selected={selectedPending.includes(request.id)}
              onToggle={toggleSelection}
              pending={tab === "pending"}
            />
          ))
        )}
      </div>

      {tab === "pending" && selectedPending.length > 0 && (
        <div className="flex items-center gap-2 border-t border-border pt-3">
          <Button
            type="button"
            variant="success"
            className="flex-1"
            disabled={processing}
            onClick={() => setConfirmApproveOpen(true)}
          >
            批量通过
          </Button>
          <Button
            type="button"
            variant="danger"
            className="flex-1"
            disabled={processing}
            onClick={() => {
              setRejectError(null);
              setRejectOpen(true);
            }}
          >
            批量驳回
          </Button>
          <button
            type="button"
            disabled={processing}
            onClick={() => setSelectedIds([])}
            className="px-2 py-1.5 text-xs text-text-muted hover:bg-border disabled:opacity-60"
          >
            取消选择
          </button>
        </div>
      )}

      <Modal
        open={confirmApproveOpen}
        onClose={() => {
          if (!processing) setConfirmApproveOpen(false);
        }}
        title="确认批量通过"
        position="bottom"
        closeOnOverlay={!processing}
      >
        <p className="mt-2 text-sm text-text-muted">
          确定通过选中的 {selectedPending.length} 条考勤修改申请吗？通过后将更新对应考勤记录。
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={processing}
            onClick={() => setConfirmApproveOpen(false)}
          >
            取消
          </Button>
          <Button
            type="button"
            variant="success"
            disabled={processing}
            onClick={() => void handleApprove(selectedPending)}
          >
            {processing ? "处理中…" : "确认通过"}
          </Button>
        </div>
      </Modal>

      <Modal
        open={rejectOpen}
        onClose={() => {
          if (!processing) setRejectOpen(false);
        }}
        title="批量驳回"
        position="bottom"
        closeOnOverlay={!processing}
      >
        <p className="mt-2 text-sm text-text-muted">
          将驳回选中的 {selectedPending.length} 条申请，以下原因会应用到全部。
        </p>
        <textarea
          value={rejectReason}
          onChange={(event) => {
            setRejectReason(event.target.value);
            setRejectError(null);
          }}
          className="input mt-2 min-h-24"
          placeholder="请填写驳回原因"
        />
        {rejectError && <p className="mt-1 text-xs text-danger">{rejectError}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={processing}
            onClick={() => setRejectOpen(false)}
          >
            取消
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={processing}
            onClick={() => void handleReject()}
          >
            {processing ? "处理中…" : "确认驳回"}
          </Button>
        </div>
      </Modal>

      <Modal
        open={staleOpen}
        onClose={() => {
          if (!processing) setStaleOpen(false);
        }}
        title="考勤已变化"
        position="bottom"
        closeOnOverlay={!processing}
      >
        <p className="mt-2 text-sm text-text-muted">
          以下申请的考勤在提交后被改过。强制通过会用申请的目标状态覆盖当前考勤：
        </p>
        <ul className="mt-2 max-h-[40vh] space-y-1 overflow-y-auto">
          {staleResults.map((result) => (
            <li key={result.id} className="text-xs text-text">
              {memberName(requests, result.id)}：当前{" "}
              {STATUS_LABEL[result.currentStatus ?? ""] ?? result.currentStatus ?? "未知"}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={processing}
            onClick={() => setStaleOpen(false)}
          >
            取消
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={processing}
            onClick={() => {
              const ids = staleResults.map((result) => result.id);
              setStaleOpen(false);
              void handleApprove(ids, true);
            }}
          >
            {processing ? "处理中…" : `强制通过 ${staleResults.length} 条`}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
