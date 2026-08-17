"use client";

import React from "react";
import { Modal } from "@/components/ui/Modal";
import { formatRehearsalRange } from "@/lib/date-utils";
import type { RehearsalRow } from "@/types/database";

type Props = {
  /** 当前查看的排练；null 时弹窗关闭 */
  item: RehearsalRow | null;
  onClose: () => void;
  /** 打开编辑（页面负责关闭详情并复用 CreateRehearsalModal 编辑模式） */
  onEdit: () => void;
  /** 删除（页面负责调用 remove 并提示失败）；本组件在 window.confirm 确认后调用 */
  onDelete: () => void;
};

/**
 * 排练只读详情弹窗（Issue #173）
 *
 * 卡片去按钮化后，删除/编辑入口集中于此：
 * - 「删除」→ window.confirm 二级确认 → 确认后调 onDelete 并关闭弹窗
 * - 「编辑」→ 关闭详情并打开现有编辑弹窗（由页面 onEdit 接线）
 */
export function RehearsalDetailModal({ item, onClose, onEdit, onDelete }: Props) {
  if (!item) return null;

  const handleDelete = () => {
    if (!window.confirm("确认删除？")) return;
    onDelete();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="排练详情">
      <div className="space-y-2 text-xs">
        <div className="flex items-start justify-between gap-3">
          <span className="shrink-0 text-text-muted">排练类型</span>
          <span className="text-right text-text">
            {item.type === "section" ? "分排" : "合排"}
            {item.type === "section" && item.target_section ? ` · ${item.target_section}` : ""}
          </span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <span className="shrink-0 text-text-muted">时间</span>
          <span className="text-right text-text">
            {item.start_time
              ? formatRehearsalRange(item.start_time, item.end_time ?? null)
              : "时间未设置"}
          </span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <span className="shrink-0 text-text-muted">地点</span>
          <span className="text-right text-text">{item.location ?? "—"}</span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <span className="shrink-0 text-text-muted">曲目</span>
          <span className="break-words text-right text-text">{item.repertoire ?? "—"}</span>
        </div>
        {/* 签到码仅合排存在（分排不签到，不展示此行） */}
        {item.type === "full" && item.sign_in_code ? (
          <div className="flex items-start justify-between gap-3">
            <span className="shrink-0 text-text-muted">签到码</span>
            <span className="font-mono text-right text-text">{item.sign_in_code}</span>
          </div>
        ) : null}
      </div>

      {/* 底部操作（Issue #182）：删除在前、编辑在后，并列右下角 */}
      <div className="mt-4 flex items-center justify-end gap-2 text-xs">
        <button
          type="button"
          onClick={handleDelete}
          className="rounded-full border border-border bg-surface px-4 py-1.5 text-label font-medium text-danger hover:bg-danger-bg"
        >
          删除
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="rounded-full bg-primary px-4 py-1.5 text-label font-medium text-primary-foreground shadow-sm hover:opacity-90"
        >
          编辑
        </button>
      </div>
    </Modal>
  );
}
