"use client";

import React from "react";
import { Modal } from "@/components/ui/Modal";
import { useProfiles } from "@/hooks/useProfiles";
import { formatDateTimeInChina } from "@/lib/date-utils";
import { isSyntheticEmail } from "@/lib/email-utils";
import { useAdminPageHeader } from "@/context/admin-page-header-context";

export default function ApprovalPage() {
  const { setTitle } = useAdminPageHeader();
  const {
    data: pendingRows,
    loading: pendingLoading,
    saving: pendingSaving,
    error: pendingError,
    approve,
    reject,
    approveAll,
    rejectAll,
    fetch: refetchPending,
  } = useProfiles({ status: "pending" });
  const [approvingId, setApprovingId] = React.useState<string | null>(null);
  const [rejectingId, setRejectingId] = React.useState<string | null>(null);

  // 单个拒绝确认弹窗
  const [rejectingSingleId, setRejectingSingleId] = React.useState<string | null>(null);

  // 批量操作确认弹窗
  const [batchAction, setBatchAction] = React.useState<"approve" | "reject" | null>(null);
  const [isBatchSubmitting, setIsBatchSubmitting] = React.useState(false);

  React.useEffect(() => {
    setTitle("入团审批");
  }, [setTitle]);

  const handleApprove = async (id: string) => {
    if (approvingId === id) return;
    setApprovingId(id);
    const ok = await approve(id);
    setApprovingId(null);
    if (!ok) alert("审批失败");
    else alert("已批准");
  };

  const handleReject = (id: string) => {
    if (rejectingId === id || approvingId === id) return;
    setRejectingSingleId(id);
  };

  const handleConfirmReject = async () => {
    if (!rejectingSingleId) return;
    const id = rejectingSingleId;
    setRejectingId(id);
    const ok = await reject(id);
    setRejectingId(null);
    setRejectingSingleId(null);
    if (!ok) alert("拒绝失败");
    else alert("已拒绝");
  };

  const handleBatchApprove = () => {
    if (pendingRows.length === 0) return;
    setBatchAction("approve");
  };

  const handleBatchReject = () => {
    if (pendingRows.length === 0) return;
    setBatchAction("reject");
  };

  const handleConfirmBatchAction = async () => {
    if (isBatchSubmitting || !batchAction) return;
    setIsBatchSubmitting(true);

    try {
      let ok = false;
      if (batchAction === "approve") {
        ok = await approveAll();
      } else {
        ok = await rejectAll();
      }
      if (ok) {
        setBatchAction(null);
      }
    } finally {
      setIsBatchSubmitting(false);
    }
  };

  const anySinglePending = approvingId !== null || rejectingId !== null;
  const batchDisabled =
    pendingLoading || pendingSaving || anySinglePending || pendingRows.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col space-y-4">
      <div className="flex-1 min-h-0 space-y-4 overflow-y-auto">
        {pendingError && (
          <div className="mb-3 rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger">
            {pendingError}
          </div>
        )}
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">待处理（{pendingRows.length}）</h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleBatchApprove}
              disabled={batchDisabled || isBatchSubmitting}
              className="rounded-full bg-success-bg px-2 py-1 text-label font-medium text-success hover:opacity-90 disabled:opacity-60"
            >
              全部批准
            </button>
            <button
              type="button"
              onClick={handleBatchReject}
              disabled={batchDisabled || isBatchSubmitting}
              className="rounded-full bg-danger-bg px-2 py-1 text-label font-medium text-danger hover:opacity-90 disabled:opacity-60"
            >
              全部拒绝
            </button>
            <button
              type="button"
              onClick={() => refetchPending()}
              disabled={pendingLoading}
              className="rounded-full px-2 py-1 text-label text-text-muted hover:bg-border disabled:opacity-60"
            >
              刷新
            </button>
          </div>
        </div>

        {pendingLoading ? (
          <p className="py-4 text-center text-xs text-text-subtle">加载中…</p>
        ) : pendingRows.length === 0 ? (
          <p className="py-4 text-center text-xs text-text-muted">暂无待审批用户</p>
        ) : (
          <div className="max-h-[500px] space-y-2 overflow-y-auto">
            {pendingRows.map((r) => (
              <div
                key={r.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-border bg-surface px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-text">{r.full_name || "未填写"}</p>
                  <p className="mt-0.5 text-xs text-text-muted">{r.instrument || "未选声部"}</p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {isSyntheticEmail(r.email) ? "—" : r.email || "—"}
                  </p>
                  <p className="mt-0.5 text-caption text-text-subtle">
                    注册：{formatDateTimeInChina(r.created_at)}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => handleApprove(r.id)}
                    disabled={
                      approvingId === r.id ||
                      rejectingId === r.id ||
                      isBatchSubmitting ||
                      batchAction !== null
                    }
                    className="shrink-0 rounded-full bg-success px-3 py-1.5 text-label font-medium text-success-foreground hover:opacity-90 disabled:opacity-60"
                  >
                    {approvingId === r.id ? "处理中…" : "✅ 批准"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReject(r.id)}
                    disabled={
                      rejectingId === r.id ||
                      approvingId === r.id ||
                      isBatchSubmitting ||
                      batchAction !== null
                    }
                    className="shrink-0 rounded-full bg-danger px-3 py-1.5 text-label font-medium text-danger-foreground hover:opacity-90 disabled:opacity-60"
                  >
                    {rejectingId === r.id ? "处理中…" : "❌ 拒绝"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 单个拒绝确认弹窗 */}
      <Modal
        open={!!rejectingSingleId}
        onClose={() => {
          if (rejectingId === null) setRejectingSingleId(null);
        }}
        position="bottom"
        closeOnOverlay={rejectingId === null}
      >
        <h3 className="text-base font-semibold text-text">确认拒绝</h3>
        <p className="mt-2 text-sm text-text-muted">
          确定要拒绝该用户的入团申请吗？此操作不可撤销。
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={rejectingId !== null}
            onClick={() => setRejectingSingleId(null)}
            className="rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium text-text-muted hover:bg-muted disabled:opacity-60"
          >
            取消
          </button>
          <button
            type="button"
            disabled={rejectingId !== null}
            onClick={handleConfirmReject}
            className="rounded-full bg-danger px-4 py-2 text-xs font-medium text-danger-foreground hover:opacity-90 disabled:opacity-60"
          >
            {rejectingId !== null ? "处理中…" : "确认拒绝"}
          </button>
        </div>
      </Modal>

      {/* 批量操作确认弹窗 */}
      <Modal
        open={!!batchAction}
        onClose={() => {
          if (!isBatchSubmitting) setBatchAction(null);
        }}
        position="bottom"
        closeOnOverlay={!isBatchSubmitting}
      >
        <h3 className="text-base font-semibold text-text">
          {batchAction === "approve" ? "确认全部批准" : "确认全部拒绝"}
        </h3>
        <p className="mt-2 text-sm text-text-muted">
          {batchAction === "approve"
            ? `确定要批准全部 ${pendingRows.length} 位待审批用户吗？`
            : `确定要拒绝全部 ${pendingRows.length} 位待审批用户吗？此操作不可撤销。`}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={isBatchSubmitting}
            onClick={() => setBatchAction(null)}
            className="rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium text-text-muted hover:bg-muted disabled:opacity-60"
          >
            取消
          </button>
          <button
            type="button"
            disabled={isBatchSubmitting}
            onClick={handleConfirmBatchAction}
            className={`rounded-full px-4 py-2 text-xs font-medium hover:opacity-90 disabled:opacity-60 ${
              batchAction === "approve"
                ? "bg-success text-success-foreground"
                : "bg-danger text-danger-foreground"
            }`}
          >
            {isBatchSubmitting ? "处理中…" : "确认"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
