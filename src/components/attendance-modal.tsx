"use client";

import React from "react";
import { Modal } from "@/components/ui/Modal";
import { STATUS_LABEL } from "@/lib/attendance-status";
import type { AttendanceRowWithUser, AttendanceStatus } from "@/types/database";

type Props = {
  open: boolean;
  /** 当前编辑的排练 id（null = 未打开）。本地覆盖按它重置，见下方注释 */
  rehearsalId: number | null;
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
  exempt: "🚫",
};

const STATUS_OPTIONS: AttendanceStatus[] = ["present", "late", "absent", "excused", "exempt"];

export function AttendanceModal({
  open,
  rehearsalId,
  title,
  loading,
  list,
  editable = false,
  onStatusChange,
  onSave,
  saving = false,
  onClose,
}: Props) {
  const [localOverrides, setLocalOverrides] = React.useState<Map<string, AttendanceStatus>>(
    new Map(),
  );

  // 本地覆盖的生命周期必须绑定「哪一场」，而不是「弹窗开没开」：Modal 常驻挂载、关闭不卸载
  // 组件，若不关弹窗直接切场，按 user_id 存放的覆盖会串到新一场的同名成员上，而待保存集合
  // 已在换场时清空——界面就会显示一个既不在库里、也不在待保存集合里的值，点保存毫无反应
  // （Issue #188 守则的对抗返工）。绑定排练 id 同时覆盖「关闭」：关闭时 id 变为 null。
  // 渲染期重置是 React 官方「props 变化时调整 state」模式（effect 内 setState 会被 lint 拦）
  const [prevRehearsalId, setPrevRehearsalId] = React.useState(rehearsalId);
  if (prevRehearsalId !== rehearsalId) {
    setPrevRehearsalId(rehearsalId);
    setLocalOverrides(new Map());
  }

  const handleLocalChange = (userId: string, status: AttendanceStatus) => {
    setLocalOverrides((prev) => new Map(prev).set(userId, status));
    onStatusChange?.(userId, status);
  };

  const displayList = React.useMemo(
    () =>
      list.map((r) => {
        const override = localOverrides.get(r.user_id);
        return override !== undefined ? { ...r, status: override } : r;
      }),
    [list, localOverrides],
  );

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
                      disabled={saving || loading}
                      onChange={(e) =>
                        handleLocalChange(row.user_id, e.target.value as AttendanceStatus)
                      }
                      className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-text focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
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
            className="rounded-full bg-success px-4 py-1.5 text-label font-medium text-success-foreground shadow-sm hover:opacity-90 disabled:opacity-60"
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
