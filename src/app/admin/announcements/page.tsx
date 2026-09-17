"use client";

import React from "react";
import { Modal } from "@/components/ui/Modal";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import type { AnnouncementRow } from "@/types/database";
import { AnnouncementListModal } from "@/app/admin/components/announcement-list-modal";
import { formatLocalISO } from "@/lib/date-utils";
import { useAdminPageHeader } from "@/context/admin-page-header-context";

export default function AnnouncementsPage() {
  const { setTitle } = useAdminPageHeader();
  const [title, setTitleState] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [endTime, setEndTime] = React.useState("23:59");
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
    getActive,
  } = useAnnouncements();
  const publishingRef = React.useRef(false);

  // 提前结束被覆盖公告的确认弹窗
  const [confirmEndOpen, setConfirmEndOpen] = React.useState(false);
  const [overwriteTarget, setOverwriteTarget] = React.useState<AnnouncementRow | null>(null);
  const [pendingPublish, setPendingPublish] = React.useState<{
    title: string;
    content: string;
    end_time: string;
  } | null>(null);
  const confirmingRef = React.useRef(false);

  const resetConfirm = () => {
    setConfirmEndOpen(false);
    setOverwriteTarget(null);
    setPendingPublish(null);
    confirmingRef.current = false;
  };

  const doPublish = async (titleText: string, contentText: string, end_time: string) => {
    const ok = await publish(titleText, contentText, end_time);
    if (!ok) {
      alert("发布失败");
      return false;
    }
    setTitleState("");
    setEndDate("");
    setEndTime("23:59");
    setBody("");
    alert("公告已发布");
    void fetchAll();
    return true;
  };

  // 确认提前结束被覆盖公告：先把它结束时间改为现在，再发布新公告
  const handleConfirmEnd = async () => {
    if (confirmingRef.current || !overwriteTarget || !pendingPublish) return;
    confirmingRef.current = true;
    try {
      const nowISO = formatLocalISO(new Date());
      const okEnd = await update(
        overwriteTarget.id,
        overwriteTarget.title,
        overwriteTarget.content,
        nowISO,
      );
      if (!okEnd) {
        alert("提前结束原公告失败");
        resetConfirm();
        return;
      }
      await doPublish(pendingPublish.title, pendingPublish.content, pendingPublish.end_time);
      resetConfirm();
    } finally {
      confirmingRef.current = false;
    }
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (publishingRef.current || publishing) return;
    const titleText = title.trim();
    const contentText = body.trim();
    if (!titleText) return alert("请输入公告标题");
    if (!contentText) return alert("请输入公告内容");
    if (!endDate) return alert("请选择结束日期");

    publishingRef.current = true;
    try {
      const end_time = formatLocalISO(new Date(`${endDate}T${endTime || "23:59"}:00`));

      // 同时仅允许一条有效公告：若已有未结束的公告，需先确认提前结束它
      const active = await getActive();
      if (active) {
        setOverwriteTarget(active);
        setPendingPublish({ title: titleText, content: contentText, end_time });
        setConfirmEndOpen(true);
        return;
      }

      await doPublish(titleText, contentText, end_time);
    } finally {
      publishingRef.current = false;
    }
  };

  // 公告管理 Modal
  const [showAnnouncementModal, setShowAnnouncementModal] = React.useState(false);

  const handleOpenAnnouncementModal = () => {
    setShowAnnouncementModal(true);
    void fetchAll();
  };

  React.useEffect(() => {
    setTitle("公告管理");
  }, [setTitle]);

  return (
    <div className="flex h-full min-h-0 flex-col space-y-4">
      <div className="flex-1 min-h-0 space-y-4 overflow-y-auto">
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
            <div className="space-y-1">
              <label className="block text-label font-medium text-text-muted">标题</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitleState(e.target.value)}
                className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
                placeholder="如：新学期排练安排"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-label font-medium text-text-muted">结束时间</label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
                />
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-28 rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-label font-medium text-text-muted">内容</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                className="input max-h-[400px] overflow-y-auto leading-[1.5] p-3"
                placeholder="输入公告内容…"
                style={{ minHeight: "120px" }}
              />
            </div>

            <button
              type="submit"
              disabled={publishing}
              className="w-full rounded-xl bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {publishing ? "发布中…" : "发布"}
            </button>
          </form>
        </section>
      </div>

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

      {/* 提前结束被覆盖公告确认弹窗 */}
      <Modal open={confirmEndOpen} onClose={resetConfirm} position="bottom" closeOnOverlay>
        <h3 className="text-base font-semibold text-text">提前结束公告</h3>
        <p className="mt-2 text-sm text-text-muted">
          是否要提前结束公告「{overwriteTarget?.title}」？
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={resetConfirm}
            className="rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium text-text-muted hover:bg-muted"
          >
            取消
          </button>
          <button
            type="button"
            disabled={publishing}
            onClick={handleConfirmEnd}
            className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            确认
          </button>
        </div>
      </Modal>
    </div>
  );
}
