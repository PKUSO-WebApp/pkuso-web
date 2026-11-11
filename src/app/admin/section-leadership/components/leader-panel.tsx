"use client";

import React from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { RoleBadge } from "@/components/ui/RoleBadge";
import { filterByName } from "@/lib/name-search";
import type { MutationResult } from "@/hooks/useSectionLeadership";
import {
  PRESIDENT_CAPABILITY_LABELS,
  type LeaderEntry,
  type LeadershipMember,
} from "@/app/admin/section-leadership/leadership";

export type LeaderPosition = "president" | "vice_president";

type Props = {
  position: LeaderPosition;
  entries: LeaderEntry[];
  candidates: LeadershipMember[];
  saving: boolean;
  onAssign: (userId: string) => Promise<MutationResult>;
  onRemove: (userId: string) => Promise<MutationResult>;
};

const COPY: Record<
  LeaderPosition,
  {
    title: string;
    assign: string;
    remove: string;
    radioName: string;
    ariaLabel: string;
    empty: string;
    noCandidates: string;
    description: string;
  }
> = {
  president: {
    title: "现任团长",
    assign: "任命团长",
    remove: "撤销团长",
    radioName: "president-member",
    ariaLabel: "选择团长",
    empty: "暂无团长",
    noCandidates: "暂无可任命的成员（团长不能是声部长）",
    description:
      "将授予排练管理、请假审批、入团审批、公告管理、修改考勤、考勤修改申请审批、考勤导出七项能力。团长不能同时是声部长。",
  },
  vice_president: {
    title: "现任副团长",
    assign: "任命副团长",
    remove: "撤销副团长",
    radioName: "vice-president-member",
    ariaLabel: "选择副团长",
    empty: "暂无副团长",
    noCandidates: "暂无可任命的成员（副团长不能是声部长）",
    description:
      "将授予排练管理、请假审批、入团审批、公告管理、修改考勤、考勤修改申请审批、考勤导出七项能力。副团长不能同时是声部长。",
  },
};

/**
 * 团级职位面板：团长 / 副团长各一名。
 * 已有职位时「任命」按钮禁用，必须先撤销；转职位不做特殊晋升。
 */
export function LeaderPanel({ position, entries, candidates, saving, onAssign, onRemove }: Props) {
  const copy = COPY[position];
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const busyRef = React.useRef(false);

  const filtered = React.useMemo(() => filterByName(candidates, search), [candidates, search]);
  // 搜索把已选成员过滤掉后，保存按钮必须一起失效；否则会提交一个屏幕上不可见的人。
  const selectedVisible =
    selectedId !== null && filtered.some((member) => member.id === selectedId);
  const canAssign = entries.length === 0 && candidates.length > 0;

  const openAssign = () => {
    if (!canAssign) return;
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

  const handleRemove = async (entry: LeaderEntry) => {
    if (busyRef.current) return;
    const name = entry.member?.full_name?.trim() || "该成员";
    if (
      !window.confirm(
        `确定撤销「${name}」的${copy.title.replace("现任", "")}职位并收回七项能力吗？`,
      )
    )
      return;
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
        <p className="text-sm font-medium text-text">{copy.title}</p>
        <Button
          type="button"
          disabled={saving || !canAssign}
          onClick={openAssign}
          title={entries.length > 0 ? "已有职位，撤销后可重新任命" : undefined}
        >
          {copy.assign}
        </Button>
      </div>

      {entries.length > 0 && (
        <p className="text-xs text-text-muted">
          已有{copy.title.replace("现任", "")}，撤销后才能任命新的人。
        </p>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}

      {entries.length === 0 ? (
        <p className="py-8 text-center text-xs text-text-muted">{copy.empty}</p>
      ) : (
        entries.map((entry) => (
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
                {copy.remove}
              </Button>
            </div>
          </div>
        ))
      )}

      <Modal
        open={assignOpen}
        onClose={closeAssign}
        title={copy.assign}
        position="bottom"
        closeOnOverlay={!saving}
      >
        <p className="mt-2 text-sm text-text-muted">{copy.description}</p>
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索姓名"
          className="input mt-3"
        />
        <div
          role="radiogroup"
          aria-label={copy.ariaLabel}
          className="mt-2 max-h-[45vh] space-y-1 overflow-y-auto"
        >
          {candidates.length === 0 ? (
            <p className="py-6 text-center text-xs text-text-muted">{copy.noCandidates}</p>
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
                  name={copy.radioName}
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
