"use client";

import React from "react";
import { Modal } from "@/components/ui/Modal";
import {
  formatDisplayDateTime,
  getLocalDateString,
  formatLocalISO,
  formatTime,
} from "@/lib/date-utils";
import type { AnnouncementRow } from "@/types/database";

type AnnouncementListModalProps = {
  open: boolean;
  onClose: () => void;
  announcements: AnnouncementRow[];
  loading: boolean;
  deletingId: string | null;
  updatingId: string | null;
  onDelete: (id: string) => Promise<boolean>;
  onUpdate: (id: string, title: string, content: string, end_time: string) => Promise<boolean>;
};

export function AnnouncementListModal({
  open,
  onClose,
  announcements,
  loading,
  deletingId,
  updatingId,
  onDelete,
  onUpdate,
}: AnnouncementListModalProps) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editTitle, setEditTitle] = React.useState("");
  const [editEndDate, setEditEndDate] = React.useState("");
  const [editEndTime, setEditEndTime] = React.useState("23:59");
  const [editContent, setEditContent] = React.useState("");

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

  const handleStartEdit = () => {
    if (selectedAnnouncement) {
      setEditTitle(selectedAnnouncement.title || "");
      setEditEndDate(getLocalDateString(new Date(selectedAnnouncement.end_time)));
      setEditEndTime(formatTime(selectedAnnouncement.end_time));
      setEditContent(selectedAnnouncement.content || "");
      setEditingId(selectedAnnouncement.id);
      // 编辑模式不保留删除确认（防返回查看模式时确认块突兀重现误删，对抗返工）
      setConfirmDeleteId(null);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    const end_time = formatLocalISO(new Date(`${editEndDate}T${editEndTime || "23:59"}:00`));
    const ok = await onUpdate(editingId, editTitle.trim(), editContent, end_time);
    if (ok) {
      setEditingId(null);
      setEditTitle("");
      setEditEndDate("");
      setEditEndTime("23:59");
      setEditContent("");
      setConfirmDeleteId(null);
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setConfirmDeleteId(null);
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        onClose();
        setSelectedId(null);
        setConfirmDeleteId(null);
        setEditingId(null);
        setEditContent("");
      }}
      title="管理发布的公告"
      position="bottom"
    >
      {selectedAnnouncement ? (
        // 详情视图
        <div className="space-y-3">
          {editingId === selectedAnnouncement.id ? (
            // 编辑模式
            <div className="space-y-3">
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="rounded-full bg-muted px-3 py-1 text-label text-text-muted hover:bg-border"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={updatingId === selectedAnnouncement.id}
                  className="rounded-full bg-primary px-3 py-1 text-label text-primary-foreground hover:opacity-90 disabled:opacity-60"
                >
                  {updatingId === selectedAnnouncement.id ? "保存中…" : "保存"}
                </button>
              </div>
              <div className="space-y-1">
                <label className="block text-label font-medium text-text-muted">标题</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-label font-medium text-text-muted">结束时间</label>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={editEndDate}
                    onChange={(e) => setEditEndDate(e.target.value)}
                    className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
                  />
                  <input
                    type="time"
                    value={editEndTime}
                    onChange={(e) => setEditEndTime(e.target.value)}
                    className="w-28 rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="block text-label font-medium text-text-muted">内容</label>
                <div className="rounded-xl border border-border bg-surface p-4">
                  {/* 去掉 resize-none，恢复可拖拽拉长（审计清理） */}
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={8}
                    className="w-full rounded-lg bg-transparent text-sm text-text leading-relaxed outline-none"
                    placeholder="输入公告内容…"
                  />
                </div>
              </div>
            </div>
          ) : (
            // 查看模式（Issue #182 重排：发布时间 → 内容框 → 删除确认(若有) → 按钮行）
            <>
              <p className="text-base text-primary break-words">
                {selectedAnnouncement.title || "无标题"}
              </p>
              <p className="mt-1 text-sm text-text-muted">
                结束时间：{formatDisplayDateTime(selectedAnnouncement.end_time)}
              </p>
              <div className="mt-2 max-h-[40vh] overflow-y-auto rounded-xl border border-border bg-surface p-4">
                <p className="text-sm text-text-muted leading-relaxed whitespace-pre-wrap break-words">
                  {selectedAnnouncement.content || "无内容"}
                </p>
              </div>
              {/* 删除确认块（保持全宽平分样式；位于内容框之后、按钮行之前）。
                  渲染条件绑定当前选中项：确认块永远只属于当前详情中的公告，
                  切换选中（含返回列表）不残留上一条的确认块（对抗返工） */}
              {confirmDeleteId === selectedAnnouncement.id && (
                <div className="rounded-xl border border-danger/30 bg-danger/5 p-4">
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
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(null);
                    // 返回列表同步清除删除确认，避免下一条选中的详情误显示确认块（对抗返工）
                    setConfirmDeleteId(null);
                  }}
                  className="rounded-full bg-muted px-3 py-1 text-label text-text-muted hover:bg-border"
                >
                  返回列表
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleStartEdit}
                    className="rounded-full bg-primary/10 px-3 py-1 text-label text-primary hover:bg-primary/20"
                  >
                    修改公告
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
              </div>
            </>
          )}
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
                    <p className="text-base text-primary mb-1 break-words">
                      {item.title || "无标题"}
                    </p>
                    <p className="text-sm text-text-muted mb-1">
                      结束时间：{formatDisplayDateTime(item.end_time)}
                    </p>
                    <p className="text-sm text-text-muted break-words line-clamp-3">
                      {item.content || "无内容"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
