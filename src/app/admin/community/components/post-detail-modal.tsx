"use client";

import React from "react";
import { Modal } from "@/components/ui/Modal";
import { Card } from "@/components/ui/Card";
import { formatDateTimeInChina } from "@/lib/date-utils";
import type { PostType, PostRowWithAuthor } from "@/types/database";

const TYPE_LABEL: Record<PostType, string> = {
  ensemble: "重奏",
  gathering: "团建",
};

type Props = {
  /** 详情帖子（已 normalize，含创建者 profiles） */
  post: PostRowWithAuthor;
  /** 锁定操作进行中（按钮显示「处理中…」并禁用） */
  busyLock: boolean;
  /** 删除操作进行中（按钮显示「删除中…」并禁用） */
  busyDelete: boolean;
  /** 点击「锁定/解锁」：切换 is_locked */
  onToggleLock: () => void;
  /** 点击「删除」（confirm 在页面层处理） */
  onDelete: () => void;
  /** 关闭弹窗 */
  onClose: () => void;
};

/**
 * 公告详情弹窗（管理员只读视图）。
 * 卡片去按钮化（Issue #179）后，「锁定/解锁」「删除」入口收敛到这里，
 * 列表卡片只保留帖子信息、整卡点击打开详情。
 */
export function PostDetailModal({
  post,
  busyLock,
  busyDelete,
  onToggleLock,
  onDelete,
  onClose,
}: Props) {
  const busy = busyLock || busyDelete;

  // busy 期间禁止关闭弹窗（遮罩关闭禁用 + 关闭按钮守卫）：
  // 防止操作 pending 时弹窗被关，随后对另一帖子的操作被页面全局 guard 静默吞掉
  const handleClose = () => {
    if (busy) return;
    onClose();
  };

  return (
    <Modal open onClose={handleClose} closeOnOverlay={!busy} title={post.title}>
      <div className="max-h-[90vh] space-y-3 overflow-y-auto text-xs">
        {/* 类型徽章与已锁定徽章 */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-muted px-2 py-0.5 text-caption text-text-muted">
            {TYPE_LABEL[post.type as PostType]}
          </span>
          {post.is_locked && (
            <span className="rounded-full bg-danger/10 px-2 py-0.5 text-caption font-medium text-danger">
              🔒 已锁定
            </span>
          )}
        </div>

        {/* 创建者（未知兜底）与发布时间 */}
        <p className="text-text-muted">创建者：{post.profiles?.full_name ?? "未知"}</p>
        <p className="text-text-muted">时间：{formatDateTimeInChina(post.created_at)}</p>

        {/* 内容（保留换行） */}
        {post.content != null && post.content.trim() !== "" && (
          <p className="whitespace-pre-line leading-relaxed text-text">{post.content}</p>
        )}

        {/* 图片（只读展示，无放大浮层，max-h 控制高度） */}
        {post.image_url && (
          <div className="space-y-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={post.image_url}
              alt="公告图片"
              className="max-h-64 w-full rounded-2xl border border-border object-contain"
            />
          </div>
        )}

        {/* 联系方式 */}
        {post.contact_info && (
          <Card className="space-y-1">
            <p className="text-label font-medium text-text-muted">联系方式</p>
            <p className="text-text">{post.contact_info}</p>
          </Card>
        )}

        {/* 底部操作行：锁定/解锁 + 删除（busy 期间互相禁用） */}
        <div className="flex items-center gap-4 pt-1 text-label">
          <button
            type="button"
            onClick={onToggleLock}
            disabled={busy}
            className="text-text-muted hover:text-warning disabled:opacity-50"
          >
            {busyLock ? "处理中…" : post.is_locked ? "解锁" : "锁定"}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="text-text-subtle hover:text-danger disabled:opacity-50"
          >
            {busyDelete ? "删除中…" : "删除"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
