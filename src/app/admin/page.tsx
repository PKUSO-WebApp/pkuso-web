"use client";

import React from "react";
import { Modal } from "@/components/ui/Modal";
import { useProfiles } from "@/hooks/useProfiles";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import { AnnouncementListModal } from "./components/announcement-list-modal";
import { LeaveManagement } from "./components/leave-management";
import { formatDateTimeInChina } from "@/lib/date-utils";

export default function AdminPage() {
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

  // 公告
  const [body, setBody] = React.useState("");
  const {
    publish,
    publishing,
    allData,
    loadingAll,
    fetchAll,
    deletingId,
    updatingId,
    remove,
    update,
  } = useAnnouncements();

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = body.trim();
    if (!text) return alert("请输入公告内容");
    const ok = await publish(text);
    if (!ok) alert("发布失败");
    else {
      setBody("");
      alert("公告已发布");
    }
  };

  // 公告管理 Modal
  const [showAnnouncementModal, setShowAnnouncementModal] = React.useState(false);

  const handleOpenAnnouncementModal = () => {
    setShowAnnouncementModal(true);
    void fetchAll();
  };

  // 控制台功能 tab（Issue #150）：入团审批 / 请假审批 / 公告
  const [activeTab, setActiveTab] = React.useState<"approval" | "leave" | "announcement">(
    "approval",
  );
  // 请假待审批数由 LeaveManagement 内部实时上报（与列表同源，审批后自动递减）
  const [pendingLeaveCount, setPendingLeaveCount] = React.useState(0);

  // tab 定义：badgeCount > 0 时在标签右上角显示红点徽章（公告无待处理概念，恒为 0）
  const tabs = [
    { key: "approval", label: "入团审批", badgeCount: pendingRows.length },
    { key: "leave", label: "请假审批", badgeCount: pendingLeaveCount },
    { key: "announcement", label: "公告", badgeCount: 0 },
  ] as const;

  const anySinglePending = approvingId !== null || rejectingId !== null;
  const batchDisabled =
    pendingLoading || pendingSaving || anySinglePending || pendingRows.length === 0;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-text">管理员控制台</h1>

      {/* 功能 tab 栏（视觉与 Toggle 一致；自绘以便嵌入右上角红点徽章） */}
      <div
        className="flex rounded-full bg-muted p-1 text-xs"
        role="tablist"
        aria-label="控制台功能切换"
      >
        {tabs.map((t) => {
          const active = activeTab === t.key;
          // 待处理数红点：>0 才显示；超过 99 截断为 "99+"，避免徽章过宽
          const badge =
            t.badgeCount > 0 ? (t.badgeCount > 99 ? "99+" : String(t.badgeCount)) : null;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(t.key)}
              className={`relative flex-1 rounded-full px-3 py-1 text-center transition-colors ${
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-text-muted hover:text-text"
              }`}
            >
              {t.label}
              {badge && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-caption font-medium text-danger-foreground">
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 入团审批 */}
      <section
        className={`rounded-2xl border border-border bg-card p-4 ${
          activeTab === "approval" ? "" : "hidden"
        }`}
      >
        {pendingError && (
          <div className="mb-3 rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger">
            {pendingError}
          </div>
        )}
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">
            入团审批 · 待处理（{pendingRows.length}）
          </h2>
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
          <div className="max-h-[200px] space-y-2 overflow-y-auto">
            {pendingRows.map((r) => (
              <div
                key={r.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-border bg-surface px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-text">{r.full_name || "未填写"}</p>
                  <p className="mt-0.5 text-xs text-text-muted">{r.instrument || "未选声部"}</p>
                  <p className="mt-0.5 text-xs text-text-muted">{r.email || "—"}</p>
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
      </section>

      {/* 请假审批（Issue #142）；全部渲染 + hidden 切换以保留内部状态（hook 数据不随卸载重取） */}
      <div className={activeTab === "leave" ? "" : "hidden"}>
        <LeaveManagement onPendingCountChange={setPendingLeaveCount} />
      </div>

      {/* 发布公告 */}
      <section
        className={`rounded-2xl border border-border bg-card p-4 ${
          activeTab === "announcement" ? "" : "hidden"
        }`}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">发布全团公告</h2>
          <button
            type="button"
            onClick={handleOpenAnnouncementModal}
            className="rounded-full px-3 py-1 text-label text-text-muted hover:bg-border"
          >
            管理公告
          </button>
        </div>
        <form onSubmit={handlePublish} className="space-y-3">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            className="input resize-none max-h-[200px] overflow-y-auto leading-[1.5] p-3"
            placeholder="输入公告内容…"
            style={{ minHeight: "120px" }}
          />
          <button
            type="submit"
            disabled={publishing}
            className="w-full rounded-xl bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {publishing ? "发布中…" : "发布"}
          </button>
        </form>
      </section>

      {/* 公告管理 Modal */}
      <AnnouncementListModal
        open={showAnnouncementModal}
        onClose={() => setShowAnnouncementModal(false)}
        announcements={allData}
        loading={loadingAll}
        deletingId={deletingId}
        updatingId={updatingId}
        onDelete={remove}
        onUpdate={update}
      />

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
