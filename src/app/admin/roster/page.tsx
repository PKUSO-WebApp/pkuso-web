"use client";

import React from "react";
import { useProfiles } from "@/hooks/useProfiles";
import { groupProfilesByInstrument } from "@/lib/roster-utils";
import { filterByName } from "@/lib/name-search";
import { isSyntheticEmail } from "@/lib/email-utils";
import { matchInstrumentSection } from "@/lib/instrument-search";
import { AdminMemberDetailModal } from "@/app/admin/members/components/member-detail-modal";
import type { ProfileRow } from "@/types/database";
import { useAdminPageHeader } from "@/context/admin-page-header-context";

export default function RosterPage() {
  const { setTitle } = useAdminPageHeader();
  const {
    data: allProfiles,
    loading: rosterLoading,
    error: rosterError,
    update: updateProfile,
  } = useProfiles({ status: "approved" });
  const rosterRows = React.useMemo(
    () => allProfiles.filter((r) => (r.role ?? "") !== "admin") as ProfileRow[],
    [allProfiles],
  );

  const [searchQuery, setSearchQuery] = React.useState("");
  const sectionMatch = React.useMemo(() => matchInstrumentSection(searchQuery), [searchQuery]);
  const filteredRows = React.useMemo(() => {
    if (sectionMatch) {
      return rosterRows.filter((r) => sectionMatch.includes(r.instrument ?? ""));
    }
    return filterByName(rosterRows, searchQuery);
  }, [rosterRows, searchQuery, sectionMatch]);

  const grouped = React.useMemo(() => groupProfilesByInstrument(filteredRows), [filteredRows]);

  const [selectedUser, setSelectedUser] = React.useState<ProfileRow | null>(null);

  React.useEffect(() => {
    setTitle("成员花名册");
  }, [setTitle]);

  return (
    <div className="flex h-full min-h-0 flex-col space-y-4 pb-2">
      <div className="flex-1 min-h-0 space-y-4">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索姓名，声部"
          className="input"
        />
        <div className="max-h-[500px] space-y-5 overflow-y-auto">
          {rosterLoading ? (
            <p className="py-8 text-center text-xs text-text-subtle">加载中…</p>
          ) : rosterError ? (
            <p className="rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger">{rosterError}</p>
          ) : rosterRows.length === 0 ? (
            <p className="py-8 text-center text-xs text-text-muted">暂无已通过成员</p>
          ) : grouped.length === 0 ? (
            <p className="py-8 text-center text-xs text-text-muted">未找到匹配的成员</p>
          ) : (
            grouped.map(({ group, users }) => (
              <div key={group}>
                <p className="mb-2 text-label font-medium uppercase tracking-wide text-text-muted">
                  {group}
                </p>
                <ul className="space-y-2">
                  {users.map((u) => (
                    <li key={u.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedUser(u)}
                        className="w-full rounded-xl border border-border bg-card px-3 py-2 text-left text-xs hover:bg-muted"
                      >
                        <p className="flex flex-wrap items-center gap-1.5 font-medium text-text">
                          <span>{(u.instrument ?? "—") + " - " + (u.full_name ?? "—")}</span>
                          {u.is_section_leader && (
                            <span className="rounded-full bg-warning-bg px-1.5 py-0.5 text-caption text-warning">
                              🏅 声部长
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 text-text-muted">学院：{u.college?.trim() || "—"}</p>
                        <p className="mt-0.5 text-text-muted">
                          邮箱：{isSyntheticEmail(u.email) ? "—" : (u.email ?? "—")}
                        </p>
                        <p className="mt-0.5 text-text-subtle">
                          入团时间：{u.join_date?.trim() || "—"}
                          {u.is_in_orchestra === true && " 团员"}
                          {u.is_in_orchestra === false && " 团友"}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>

      <AdminMemberDetailModal
        open={!!selectedUser}
        user={selectedUser}
        onClose={() => setSelectedUser(null)}
        onSave={updateProfile}
      />
    </div>
  );
}
