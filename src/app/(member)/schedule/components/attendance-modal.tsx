"use client";

import React from "react";
import { Modal } from "@/components/ui/Modal";
import type { AttendanceRowWithUser, AttendanceStatus } from "@/types/database";

type Props = {
  open: boolean;
  title: string;
  loading: boolean;
  list: AttendanceRowWithUser[];
  editable?: boolean;
  onStatusChange?: (userId: string, status: AttendanceStatus) => void;
  onSave?: () => void;
  saving?: boolean;
  onClose: () => void;
};

const STATUS_ICON: Record<AttendanceStatus, string> = {
  present: "✅",
  late: "➖",
  absent: "❌",
  excused: "⭕",
};

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: "出席",
  late: "迟到",
  absent: "缺勤",
  excused: "请假",
};

const STATUS_OPTIONS: AttendanceStatus[] = ["present", "late", "absent", "excused"];

export function AttendanceModal({
  open,
  title,
  loading,
  list,
  editable = false,
  onStatusChange,
  onSave,
  saving = false,
  onClose,
}: Props) {
  // 本地编辑缓存：打开时从 list 初始化，关闭时清空
  const [localList, setLocalList] = React.useState<AttendanceRowWithUser[]>([]);

  React.useEffect(() => {
    if (open && !loading) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocalList(list.map((r) => ({ ...r })));
    }
  }, [open, loading, list]);

  const handleLocalChange = (userId: string, status: AttendanceStatus) => {
    setLocalList((prev) => prev.map((r) => (r.user_id === userId ? { ...r, status } : r)));
    onStatusChange?.(userId, status);
  };

  const displayList = localList.length > 0 ? localList : list;

  return (
    <Modal open={open} onClose={onClose} title="出勤名单" closeOnOverlay={!loading && !saving}>
      <p className="mb-3 text-label text-text-muted">排练：{title}</p>
      <div className="max-h-64 space-y-2 overflow-y-auto pt-1">
        {loading ? (
          <p className="py-6 text-center text-label text-text-subtle">正在加载...</p>
        ) : displayList.length === 0 ? (
          <p className="py-6 text-center text-label text-text-subtle">共 0 人</p>
        ) : (
          displayList.map((row, index) => {
            const profileInfo = row.profiles;
            const name = profileInfo?.full_name ?? "未命名成员";
            const section = profileInfo?.instrument ?? "声部未登记";
            const status = (row.status ?? "absent") as AttendanceStatus;

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
                <div className="flex items-center gap-1">
                  {editable ? (
                    <select
                      value={status}
                      onChange={(e) =>
                        handleLocalChange(row.user_id, e.target.value as AttendanceStatus)
                      }
                      className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-text focus:outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_ICON[s]} {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-lg" title={STATUS_LABEL[status]}>
                      {STATUS_ICON[status]}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="mt-4 flex items-center justify-end gap-2">
        {editable && onSave && (
          <button
            type="button"
            onClick={onSave}
            disabled={loading || saving}
            className="rounded-full bg-success px-4 py-1.5 text-label font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-60"
          >
            {saving ? "保存中…" : "保存修改"}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          disabled={loading || saving}
          className="rounded-full bg-primary px-4 py-1.5 text-label font-medium text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-60"
        >
          关闭
        </button>
      </div>
    </Modal>
  );
}
