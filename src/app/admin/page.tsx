"use client";

import React from "react";
import { useProfiles } from "@/hooks/useProfiles";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import { AnnouncementListModal } from "./components/announcement-list-modal";
import { formatDateTime } from "@/lib/date-utils";

export default function AdminPage() {
  const {
    data: pendingRows,
    loading: pendingLoading,
    approve,
    reject,
    fetch: refetchPending,
  } = useProfiles({ status: "pending" });
  const [approvingId, setApprovingId] = React.useState<string | null>(null);
  const [rejectingId, setRejectingId] = React.useState<string | null>(null);

  const handleApprove = async (id: string) => {
    if (approvingId === id) return;
    setApprovingId(id);
    const ok = await approve(id);
    setApprovingId(null);
    if (!ok) alert("审批失败");
    else alert("已批准");
  };

  const handleReject = async (id: string) => {
    if (rejectingId === id || approvingId === id) return;
    setRejectingId(id);
    if (!confirm("确认拒绝该用户的入团申请？")) {
      setRejectingId(null);
      return;
    }
    const ok = await reject(id);
    setRejectingId(null);
    if (!ok) alert("拒绝失败");
    else alert("已拒绝");
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

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-text">管理员控制台</h1>

      {/* 入团审批 */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">
            入团审批 · 待处理（{pendingRows.length}）
          </h2>
          <button
            type="button"
            onClick={() => refetchPending()}
            disabled={pendingLoading}
            className="rounded-full px-2 py-1 text-label text-text-muted hover:bg-border disabled:opacity-60"
          >
            刷新
          </button>
        </div>

        {pendingLoading ? (
          <p className="py-4 text-center text-xs text-text-subtle">加载中…</p>
        ) : pendingRows.length === 0 ? (
          <p className="py-4 text-center text-xs text-text-muted">暂无待审批用户</p>
        ) : (
          <div className="h-[200px] space-y-2 overflow-y-auto">
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
                    注册：{formatDateTime(r.created_at)}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => handleApprove(r.id)}
                    disabled={approvingId === r.id || rejectingId === r.id}
                    className="shrink-0 rounded-full bg-success px-3 py-1.5 text-label font-medium text-success-foreground hover:bg-success/90 disabled:opacity-60"
                  >
                    {approvingId === r.id ? "处理中…" : "✅ 批准"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReject(r.id)}
                    disabled={rejectingId === r.id || approvingId === r.id}
                    className="shrink-0 rounded-full bg-danger px-3 py-1.5 text-label font-medium text-danger-foreground hover:bg-danger/90 disabled:opacity-60"
                  >
                    {rejectingId === r.id ? "处理中…" : "❌ 拒绝"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 发布公告 */}
      <section className="rounded-2xl border border-border bg-card p-4">
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
    </div>
  );
}
