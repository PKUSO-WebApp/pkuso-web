"use client";

import React from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { RoleBadge } from "@/components/ui/RoleBadge";
import { filterByName } from "@/lib/name-search";
import type { MutationResult } from "@/hooks/useSectionLeadership";
import {
  PRESIDENT_CAPABILITY_LABELS,
  type LeadershipMember,
} from "@/app/admin/section-leadership/leadership";

export type PresidentEntry = {
  userId: string;
  member: LeadershipMember | null;
  capabilities: string[];
  isPrincipal: boolean;
};

type PresidentPanelProps = {
  presidents: PresidentEntry[];
  candidates: LeadershipMember[];
  saving: boolean;
  onAssign: (userId: string) => Promise<MutationResult>;
  onRemove: (userId: string) => Promise<MutationResult>;
};

/** P0c 团长 tab：现任团长 + 一次性任命六项能力；团长不能是声部长。 */
export function PresidentPanel({
  presidents,
  candidates,
  saving,
  onAssign,
  onRemove,
}: PresidentPanelProps) {
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const busyRef = React.useRef(false);

  const filtered = React.useMemo(() => filterByName(candidates, search), [candidates, search]);
  // 搜索把已选成员过滤掉后，保存按钮必须一起失效；否则会提交一个屏幕上不可见的人。
  const selectedVisible =
    selectedId !== null && filtered.some((member) => member.id === selectedId);

  const openAssign = () => {
    setSelectedId(null);
    setSearch("");
    setError(null);
    setAssignOpen(true);
  };

  const closeAssign = () => {
    if (busyRef.current) return;
    setAssignOpen(false);
    setSelectedId(null);
    setSearch("");
    setError(null);
  };

  const handleAssign = async () => {
    if (!selectedId || busyRef.current) return;
    if (!filtered.some((member) => member.id === selectedId)) {
      setError("请先选择一个成员");
      return;
    }
    busyRef.current = true;
    setError(null);
    try {
      const result = await onAssign(selectedId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setAssignOpen(false);
      setSelectedId(null);
      setSearch("");
    } finally {
      busyRef.current = false;
    }
  };

  const handleRemove = async (entry: PresidentEntry) => {
    if (busyRef.current) return;
    const name = entry.member?.full_name?.trim() || "该成员";
    if (!window.confirm(`确定撤销「${name}」的团长能力吗？`)) return;
    busyRef.current = true;
    setError(null);
    try {
      const result = await onRemove(entry.userId);
      if (!result.ok) setError(result.message);
    } finally {
      busyRef.current = false;
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-text">现任团长</p>
        <Button type="button" disabled={saving || candidates.length === 0} onClick={openAssign}>
          任命团长
        </Button>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      {presidents.length === 0 ? (
        <p className="py-8 text-center text-xs text-text-muted">暂无团长</p>
      ) : (
        presidents.map((entry) => (
          <div key={entry.userId} className="rounded-xl border border-border bg-card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text">
                  {entry.member?.full_name?.trim() || "未知成员"}
                </p>
                <p className="mt-0.5 text-xs text-text-muted">
                  {entry.member?.instrument?.trim() || "—"}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {entry.isPrincipal && <RoleBadge role="principal" />}
                  {entry.capabilities.map((capability) => (
                    <span
                      key={capability}
                      className="rounded-full bg-muted px-2 py-0.5 text-label text-text-muted"
                    >
                      {PRESIDENT_CAPABILITY_LABELS[capability] ?? capability}
                    </span>
                  ))}
                </div>
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={saving}
                onClick={() => void handleRemove(entry)}
              >
                撤销团长
              </Button>
            </div>
          </div>
        ))
      )}

      <Modal
        open={assignOpen}
        onClose={closeAssign}
        title="任命团长"
        position="bottom"
        closeOnOverlay={!saving}
      >
        <p className="mt-2 text-sm text-text-muted">
          将授予排练管理、请假审批、入团审批、修改考勤、考勤修改申请审批、考勤导出六项能力。
          团长不能同时是声部长。
        </p>
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索姓名"
          className="input mt-3"
        />
        <div
          role="radiogroup"
          aria-label="选择团长"
          className="mt-2 max-h-[45vh] space-y-1 overflow-y-auto"
        >
          {candidates.length === 0 ? (
            <p className="py-6 text-center text-xs text-text-muted">
              暂无可任命的成员（团长不能是声部长）
            </p>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-xs text-text-muted">没有匹配的成员</p>
          ) : (
            filtered.map((member) => (
              <label
                key={member.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 hover:bg-muted"
              >
                <input
                  type="radio"
                  name="president-member"
                  checked={selectedId === member.id}
                  onChange={() => {
                    setSelectedId(member.id);
                    setError(null);
                  }}
                  className="h-4 w-4 accent-primary"
                />
                <span className="text-sm text-text">
                  {member.full_name?.trim() || "未填写姓名"}
                </span>
                <span className="text-xs text-text-muted">{member.instrument}</span>
              </label>
            ))
          )}
        </div>
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={saving} onClick={closeAssign}>
            取消
          </Button>
          <Button
            type="button"
            disabled={saving || !selectedVisible}
            onClick={() => void handleAssign()}
          >
            {saving ? "保存中…" : "确认任命"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
