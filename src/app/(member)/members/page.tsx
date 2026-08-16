"use client";

import React from "react";
import { useProfiles } from "@/hooks/useProfiles";
import { Card } from "@/components/ui/Card";
import { groupProfilesByInstrument } from "@/lib/roster-utils";
import { filterByName } from "@/lib/name-search";
import type { ProfileRow } from "@/types/database";
import { MemberDetailModal } from "./components/member-detail-modal";

export default function MembersPage() {
  const {
    data: allProfiles,
    loading: rosterLoading,
    error: rosterError,
  } = useProfiles({
    status: "approved",
  });

  const rosterRows = React.useMemo(
    () => (allProfiles ?? []).filter((r) => (r.role ?? "") !== "admin") as ProfileRow[],
    [allProfiles],
  );

  // 拼音/首字母搜索：输入为空时显示全部
  const [searchQuery, setSearchQuery] = React.useState("");
  const filteredRows = React.useMemo(
    () => filterByName(rosterRows, searchQuery),
    [rosterRows, searchQuery],
  );

  const grouped = React.useMemo(() => groupProfilesByInstrument(filteredRows), [filteredRows]);

  // 详情弹窗：点击花名册成员打开（只读）
  const [selectedUser, setSelectedUser] = React.useState<ProfileRow | null>(null);

  return (
    /* 根容器 flex 化（矮屏布局，审计批次 3）：头部固定，搜索框 + 列表整体独立滚动 */
    <div className="flex h-full min-h-0 flex-col space-y-4 pb-safe">
      <header className="mt-1">
        <h1 className="text-lg font-semibold text-text">全团成员</h1>
        <p className="mt-1 text-xs text-text-muted">查看乐团最新花名册</p>
      </header>

      <div className="flex-1 min-h-0 space-y-4 overflow-y-auto">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索姓名（支持中文/拼音/首字母）"
          className="input"
        />

        <div className="max-h-[480px] overflow-y-auto">
          {rosterLoading ? (
            <p className="py-8 text-center text-xs text-text-subtle">加载中…</p>
          ) : rosterError ? (
            <Card className="border-danger-bg bg-danger-bg/80">
              <p className="px-3 py-2 text-sm text-danger">{rosterError}</p>
            </Card>
          ) : rosterRows.length === 0 ? (
            <p className="py-8 text-center text-xs text-text-muted">暂无已通过成员</p>
          ) : grouped.length === 0 ? (
            <p className="py-8 text-center text-xs text-text-muted">未找到匹配的成员</p>
          ) : (
            <div className="space-y-5">
              {grouped.map(({ group, users }) => (
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
                          <p className="mt-0.5 text-text-muted">邮箱：{u.email ?? "—"}</p>
                          <p className="mt-0.5 text-text-subtle">
                            入团时间：{u.join_date?.trim() || "—"}
                          </p>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <MemberDetailModal
        open={!!selectedUser}
        user={selectedUser}
        onClose={() => setSelectedUser(null)}
      />
    </div>
  );
}
