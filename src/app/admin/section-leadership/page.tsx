"use client";

import React from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Toggle } from "@/components/ui/Toggle";
import { useAdminPageHeader } from "@/context/admin-page-header-context";
import { useSectionLeadership } from "@/hooks/useSectionLeadership";
import { filterByName } from "@/lib/name-search";
import type { SectionRow } from "@/types/database";
import {
  buildLeaderEntries,
  buildLeaderScopes,
  buildPrincipalScopes,
  personLabel,
  toLeadershipMembers,
  type LeaderEntry,
  type LeadershipMember,
} from "./leadership";
import { LeaderPanel } from "./components/leader-panel";

type Tab = "leaders" | "principals" | "presidents" | "vice-presidents";
type AssignmentKind = "leader" | "principal";

type ScopeItem = {
  section: SectionRow;
  members: LeadershipMember[];
  currentId: string | null;
  conflict: boolean;
  kind: AssignmentKind;
};

type PickerState = ScopeItem;

/** 角色任命页（P0c）：声部长 / 首席 / 团长 / 副团长四个 tab。 */
export default function SectionLeadershipPage() {
  const { setTitle } = useAdminPageHeader();
  React.useEffect(() => {
    setTitle("角色任命");
  }, [setTitle]);

  const {
    sections,
    groupMembers,
    leaders,
    principals,
    presidents,
    positions,
    roster,
    loading,
    error,
    saving,
    fetch,
    assignLeader,
    removeLeader,
    assignPrincipal,
    removePrincipal,
    assignPresident,
    removePresident,
    assignVicePresident,
    removeVicePresident,
  } = useSectionLeadership();

  const [tab, setTab] = React.useState<Tab>("leaders");
  const [picker, setPicker] = React.useState<PickerState | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [pickerError, setPickerError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const savingRef = React.useRef(false);

  const members = React.useMemo(() => toLeadershipMembers(roster), [roster]);
  // 任何团级能力持有者都不能当声部长（后端 guard 判的是能力，不是职位）
  const capabilityUserIds = React.useMemo(
    () => new Set(presidents.map((row) => row.user_id)),
    [presidents],
  );
  const positionUserIds = React.useMemo(
    () => new Set(positions.map((row) => row.user_id)),
    [positions],
  );
  const leaderMembers = React.useMemo(
    () => members.filter((member) => !capabilityUserIds.has(member.id)),
    [members, capabilityUserIds],
  );
  const leaderScopes = React.useMemo(
    () => buildLeaderScopes(sections, groupMembers, leaders, leaderMembers),
    [sections, groupMembers, leaders, leaderMembers],
  );
  const principalScopes = React.useMemo(
    () => buildPrincipalScopes(sections, principals, members),
    [sections, principals, members],
  );

  const presidentEntries: LeaderEntry[] = React.useMemo(
    () => buildLeaderEntries(positions, presidents, members, principals, roster, "president"),
    [positions, presidents, members, principals, roster],
  );
  const vicePresidentEntries: LeaderEntry[] = React.useMemo(
    () => buildLeaderEntries(positions, presidents, members, principals, roster, "vice_president"),
    [positions, presidents, members, principals, roster],
  );

  const sectionLeaderIds = React.useMemo(
    () => new Set(leaders.map((row) => row.leader_id)),
    [leaders],
  );
  // 团长/副团长候选人：不能是声部长，也不能已有任何团级职位。
  // 历史「仅有部分能力、没有职位」的用户允许被选中——任命时会清空并授予完整七项。
  const leaderCandidates = React.useMemo(
    () =>
      members.filter(
        (member) => !sectionLeaderIds.has(member.id) && !positionUserIds.has(member.id),
      ),
    [members, sectionLeaderIds, positionUserIds],
  );

  const list: ScopeItem[] =
    tab === "leaders"
      ? leaderScopes.map((scope) => ({
          section: scope.section,
          members: scope.members,
          currentId: scope.currentLeaderId,
          conflict: scope.conflict,
          kind: "leader",
        }))
      : tab === "principals"
        ? principalScopes.map((scope) => ({
            section: scope.section,
            members: scope.members,
            currentId: scope.currentPrincipalId,
            conflict: false,
            kind: "principal",
          }))
        : [];

  const pickerMembers = React.useMemo(
    () => (picker ? filterByName(picker.members, search) : []),
    [picker, search],
  );
  // 搜索把已选成员过滤掉后，保存按钮必须一起失效；否则会提交一个屏幕上不可见的人。
  const selectedVisible =
    selectedId !== null && pickerMembers.some((member) => member.id === selectedId);

  const openPicker = (item: ScopeItem) => {
    setPicker(item);
    setSelectedId(
      item.currentId && item.members.some((member) => member.id === item.currentId)
        ? item.currentId
        : null,
    );
    setSearch("");
    setPickerError(null);
    setActionError(null);
  };

  const closePicker = () => {
    if (savingRef.current) return;
    setPicker(null);
    setSelectedId(null);
    setPickerError(null);
    setSearch("");
  };

  const handleAssign = async () => {
    if (!picker || !selectedId || savingRef.current) return;
    if (!pickerMembers.some((member) => member.id === selectedId)) {
      setPickerError("请先选择一个成员");
      return;
    }
    savingRef.current = true;
    setPickerError(null);
    setActionError(null);
    const result =
      picker.kind === "leader"
        ? await assignLeader(picker.section.name, selectedId)
        : await assignPrincipal(picker.section.name, selectedId);
    savingRef.current = false;
    if (!result.ok) {
      setPickerError(result.message);
      return;
    }
    setPicker(null);
    setSelectedId(null);
    setSearch("");
  };

  const handleRemove = async (item: ScopeItem) => {
    if (savingRef.current || !item.currentId) return;
    const roleLabel = item.kind === "leader" ? "声部长" : "首席";
    if (!window.confirm(`确定撤销「${item.section.name}」的${roleLabel}任命吗？`)) return;
    savingRef.current = true;
    setActionError(null);
    try {
      // 带上「我看到的当前负责人」：数据库里若已被另一个管理员换人，
      // 后端拒绝删除，避免按 section 把新人撤掉。
      const result =
        item.kind === "leader"
          ? await removeLeader(item.section.name, item.currentId)
          : await removePrincipal(item.section.name, item.currentId);
      if (!result.ok) setActionError(result.message);
    } finally {
      savingRef.current = false;
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Toggle
          options={["leaders", "principals", "presidents", "vice-presidents"] as const}
          value={tab}
          disabled={saving}
          onChange={(value) => {
            setTab(value);
            setActionError(null);
          }}
          getLabel={(value) =>
            value === "leaders"
              ? "声部长"
              : value === "principals"
                ? "首席"
                : value === "presidents"
                  ? "团长"
                  : "副团长"
          }
        />
        <span className="text-xs text-text-muted">
          {tab === "presidents"
            ? `${presidentEntries.length} 位团长`
            : tab === "vice-presidents"
              ? `${vicePresidentEntries.length} 位副团长`
              : `${list.length} 个作用域`}
        </span>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-danger-bg px-3 py-2 text-xs text-danger">
          <span>{error}</span>
          <button type="button" onClick={() => void fetch()} className="shrink-0 underline">
            重试
          </button>
        </div>
      )}
      {actionError && <p className="text-xs text-danger">{actionError}</p>}

      <div className="flex-1 min-h-0 space-y-2 overflow-y-auto">
        {loading ? (
          <p className="py-8 text-center text-xs text-text-subtle">加载中…</p>
        ) : tab === "presidents" ? (
          <LeaderPanel
            position="president"
            entries={presidentEntries}
            candidates={leaderCandidates}
            saving={saving}
            onAssign={assignPresident}
            onRemove={removePresident}
          />
        ) : tab === "vice-presidents" ? (
          <LeaderPanel
            position="vice_president"
            entries={vicePresidentEntries}
            candidates={leaderCandidates}
            saving={saving}
            onAssign={assignVicePresident}
            onRemove={removeVicePresident}
          />
        ) : list.length === 0 ? (
          <p className="py-8 text-center text-xs text-text-muted">暂无可任命的作用域</p>
        ) : (
          list.map((item) => {
            const roleLabel = item.kind === "leader" ? "声部长" : "首席";
            return (
              <div key={item.section.name} className="rounded-xl border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text">{item.section.name}</p>
                    <p className="mt-0.5 text-xs text-text-muted">
                      现任：
                      {personLabel(roster, item.currentId, item.section.kind === "group")}
                    </p>
                    {item.conflict && (
                      <p className="mt-1 text-xs text-warning">
                        与已有组/乐器任命冲突，请先撤销冲突项
                      </p>
                    )}
                    {item.members.length === 0 && (
                      <p className="mt-1 text-xs text-text-subtle">
                        该声部暂无可任命的在册团员（团长不能兼任声部长）
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {item.currentId && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleRemove(item)}
                        className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-muted disabled:opacity-60"
                      >
                        撤销
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={saving || item.members.length === 0 || item.conflict}
                      onClick={() => openPicker(item)}
                      className="rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
                    >
                      {item.currentId ? "更换" : `任命${roleLabel}`}
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <Modal
        open={picker !== null}
        onClose={closePicker}
        title={
          picker
            ? `${picker.currentId ? "更换" : "任命"}${picker.kind === "leader" ? "声部长" : "首席"} · ${picker.section.name}`
            : "任命"
        }
        position="bottom"
        closeOnOverlay={!saving}
      >
        {picker && (
          <div className="mt-2 space-y-3">
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索姓名"
              className="input"
            />
            <div
              role="radiogroup"
              aria-label="选择成员"
              className="max-h-[45vh] space-y-1 overflow-y-auto"
            >
              {pickerMembers.length === 0 ? (
                <p className="py-6 text-center text-xs text-text-muted">没有匹配的成员</p>
              ) : (
                pickerMembers.map((member) => (
                  <label
                    key={member.id}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 hover:bg-muted"
                  >
                    <input
                      type="radio"
                      name="leadership-member"
                      checked={selectedId === member.id}
                      onChange={() => {
                        setSelectedId(member.id);
                        setPickerError(null);
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
            {pickerError && <p className="text-xs text-danger">{pickerError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" disabled={saving} onClick={closePicker}>
                取消
              </Button>
              <Button
                type="button"
                disabled={saving || !selectedVisible}
                onClick={() => void handleAssign()}
              >
                {saving ? "保存中…" : "保存"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
