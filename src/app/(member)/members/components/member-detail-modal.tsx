"use client";

import React from "react";
import { Modal } from "@/components/ui/Modal";
import type { ProfileRow } from "@/types/database";

type MemberDetailModalProps = {
  open: boolean;
  /** 当前查看的成员，null 时不展示内容 */
  user: ProfileRow | null;
  onClose: () => void;
};

/** 展示字段：标签 + 值，值为空时显示 — */
function DetailField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-xs text-text-muted">{label}</span>
      <span className="min-w-0 break-words text-right text-sm text-text">
        {value?.trim() || "—"}
      </span>
    </div>
  );
}

/** 用户侧成员详情弹窗：只读展示花名册成员信息 */
export function MemberDetailModal({ open, user, onClose }: MemberDetailModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="成员详情" position="bottom">
      {user && (
        <div className="mt-2 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-semibold text-text">{user.full_name ?? "—"}</p>
            {user.is_section_leader && (
              <span className="rounded-full bg-warning-bg px-2 py-0.5 text-caption text-warning">
                🏅 声部长
              </span>
            )}
          </div>
          <DetailField label="乐器" value={user.instrument} />
          <DetailField label="学院" value={user.college} />
          <DetailField label="邮箱" value={user.email} />
          <DetailField label="联系方式" value={user.phone_number} />
          <DetailField label="入团时间" value={user.join_date} />
        </div>
      )}
    </Modal>
  );
}
