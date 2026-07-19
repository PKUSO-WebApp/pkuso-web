"use client";

import { Modal } from "@/components/ui/Modal";
import type { AttendanceRowWithUser } from "@/types/database";

type Props = {
  open: boolean;
  title: string;
  loading: boolean;
  list: AttendanceRowWithUser[];
  onClose: () => void;
};

export function AttendanceModal({ open, title, loading, list, onClose }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="出勤名单" closeOnOverlay={!loading}>
      <p className="mb-3 text-label text-text-muted">排练：{title}</p>
      <div className="max-h-64 space-y-2 overflow-y-auto pt-1">
        {loading ? (
          <p className="py-6 text-center text-label text-text-subtle">正在加载...</p>
        ) : list.length === 0 ? (
          <p className="py-6 text-center text-label text-text-subtle">暂无签到记录</p>
        ) : (
          list.map((row, index) => {
            const userInfo = row.users;
            const name = userInfo?.name ?? "未命名成员";
            const section = userInfo?.section ?? "声部未登记";
            return (
              <div
                key={`${row.id ?? index}`}
                className="flex items-center justify-between rounded-2xl border border-border bg-card px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-label font-medium text-primary-foreground">
                    {name.slice(0, 2)}
                  </div>
                  <div>
                    <p className="text-label font-medium text-text">{name}</p>
                    <p className="text-caption text-text-muted">{section}</p>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="mt-4 flex items-center justify-end">
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          className="rounded-full bg-primary px-4 py-1.5 text-label font-medium text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-60"
        >
          关闭
        </button>
      </div>
    </Modal>
  );
}
