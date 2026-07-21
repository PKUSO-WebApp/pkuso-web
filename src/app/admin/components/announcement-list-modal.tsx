"use client";

import React from "react";
import { Modal } from "@/components/ui/Modal";
import type { AnnouncementRow } from "@/types/database";

type AnnouncementListModalProps = {
  open: boolean;
  onClose: () => void;
  announcements: AnnouncementRow[];
  loading: boolean;
  deletingId: string | null;
  onDelete: (id: string) => Promise<boolean>;
};

function formatTime(s: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function truncateContent(content: string | null, maxLength: number = 50) {
  if (!content) return "无内容";
  if (content.length <= maxLength) return content;
  return content.substring(0, maxLength) + "...";
}

export function AnnouncementListModal({
  open,
  onClose,
  announcements,
  loading,
  deletingId,
  onDelete,
}: AnnouncementListModalProps) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);

  const selectedAnnouncement = announcements.find((a) => a.id === selectedId);

  const handleDelete = async (id: string) => {
    const ok = await onDelete(id);
    if (ok) {
      setConfirmDeleteId(null);
      // 如果删除的是当前选中的，取消选中
      if (selectedId === id) {
        setSelectedId(null);
      }
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        onClose();
        setSelectedId(null);
        setConfirmDeleteId(null);
      }}
      title="管理发布的公告"
      position="bottom"
    >
      {/* 删除确认对话框 */}
      {confirmDeleteId && (
        <div className="mb-4 rounded-xl border border-danger/30 bg-danger/5 p-4">
          <p className="mb-3 text-sm text-danger">确认删除这条公告？</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmDeleteId(null)}
              className="flex-1 rounded-lg bg-border px-3 py-2 text-sm text-text-muted hover:bg-muted"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => handleDelete(confirmDeleteId)}
              disabled={deletingId === confirmDeleteId}
              className="flex-1 rounded-lg bg-danger px-3 py-2 text-sm text-danger-foreground hover:bg-danger/90 disabled:opacity-60"
            >
              {deletingId === confirmDeleteId ? "删除中…" : "确认删除"}
            </button>
          </div>
        </div>
      )}

      {selectedAnnouncement ? (
        // 详情视图
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="rounded-full bg-muted px-3 py-1 text-label text-text-muted hover:bg-border"
            >
              返回列表
            </button>
            <button
              type="button"
              onClick={() => setConfirmDeleteId(selectedAnnouncement.id)}
              disabled={deletingId === selectedAnnouncement.id}
              className="rounded-full bg-danger/10 px-3 py-1 text-label text-danger hover:bg-danger/20 disabled:opacity-60"
            >
              删除公告
            </button>
          </div>
          <p className="text-xs text-text-muted">
            发布时间：{formatTime(selectedAnnouncement.created_at)}
          </p>
          <div className="max-h-[40vh] overflow-y-auto rounded-xl border border-border bg-surface p-4">
            <p className="text-sm text-text leading-relaxed whitespace-pre-wrap">
              {selectedAnnouncement.content || "无内容"}
            </p>
          </div>
        </div>
      ) : (
        // 列表视图
        <div className="max-h-[60vh] overflow-y-auto">
          {loading ? (
            <p className="py-8 text-center text-sm text-text-muted">加载中…</p>
          ) : announcements.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-muted">暂无公告</p>
          ) : (
            <div className="space-y-2">
              {announcements.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-3 rounded-xl border border-border bg-surface p-3 hover:border-primary/50 cursor-pointer"
                  onClick={() => setSelectedId(item.id)}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-text-muted mb-1">{formatTime(item.created_at)}</p>
                    <p className="text-sm text-text line-clamp-3">
                      {truncateContent(item.content, 100)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDeleteId(item.id);
                    }}
                    disabled={deletingId === item.id}
                    className="shrink-0 rounded-full bg-danger/10 p-2 text-danger hover:bg-danger/20 disabled:opacity-60"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 6h18" />
                      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
