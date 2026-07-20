"use client";

import React from "react";
import { useProfiles } from "@/hooks/useProfiles";
import { Card } from "@/components/ui/Card";
import { Toggle } from "@/components/ui/Toggle";
import { INSTRUMENT_ORDER, OTHER_INSTRUMENT_GROUP } from "@/constants/instruments";
import type { ProfileRow } from "@/types/database";

function instrumentGroupKey(instrument: string | null): string {
  if (!instrument) return OTHER_INSTRUMENT_GROUP;
  const trimmed = instrument.trim();
  if (INSTRUMENT_ORDER.includes(trimmed as (typeof INSTRUMENT_ORDER)[number])) return trimmed;
  return OTHER_INSTRUMENT_GROUP;
}

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

  const grouped = React.useMemo(() => {
    const map = new Map<string, ProfileRow[]>();
    for (const row of rosterRows) {
      const g = instrumentGroupKey(row.instrument);
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(row);
    }
    for (const [, arr] of map)
      arr.sort((a, b) =>
        String(a.full_name ?? "").localeCompare(String(b.full_name ?? ""), "zh-CN"),
      );
    const ordered: { group: string; users: ProfileRow[] }[] = [];
    for (const key of INSTRUMENT_ORDER) {
      const u = map.get(key);
      if (u?.length) ordered.push({ group: key, users: u });
    }
    const other = map.get(OTHER_INSTRUMENT_GROUP);
    if (other?.length) ordered.push({ group: OTHER_INSTRUMENT_GROUP, users: other });
    return ordered;
  }, [rosterRows]);

  const [currentTab, setCurrentTab] = React.useState<"all" | "section">("all");

  return (
    <div className="space-y-4 pb-safe">
      <header className="mt-1">
        <h1 className="text-lg font-semibold text-text">全团成员</h1>
        <p className="mt-1 text-xs text-text-muted">查看乐团最新花名册</p>
      </header>

      <Toggle
        options={["all", "section"] as const}
        value={currentTab}
        onChange={setCurrentTab}
        getLabel={(opt) => (opt === "all" ? "全团成员" : "声部查看")}
      />

      <div className="max-h-[300px] overflow-y-auto">
        {rosterLoading ? (
          <p className="py-8 text-center text-xs text-text-subtle">加载中…</p>
        ) : rosterError ? (
          <Card className="border-danger-bg bg-danger-bg/80">
            <p className="px-3 py-2 text-sm text-danger">{rosterError}</p>
          </Card>
        ) : rosterRows.length === 0 ? (
          <p className="py-8 text-center text-xs text-text-muted">暂无已通过成员</p>
        ) : currentTab === "all" ? (
          <div className="space-y-2">
            {rosterRows.map((u) => (
              <li key={u.id} className="rounded-xl border border-border bg-card px-3 py-2 text-xs">
                <p className="font-medium text-text">
                  {(u.instrument ?? "—") + " - " + (u.full_name ?? "—")}
                </p>
                <p className="mt-0.5 text-text-muted">学院：{u.college?.trim() || "—"}</p>
                <p className="mt-0.5 text-text-muted">邮箱：{u.email ?? "—"}</p>
                <p className="mt-0.5 text-text-subtle">入团时间：{u.join_date?.trim() || "—"}</p>
              </li>
            ))}
          </div>
        ) : (
          <div className="space-y-5">
            {grouped.map(({ group, users }) => (
              <div key={group}>
                <p className="mb-2 text-label font-medium uppercase tracking-wide text-text-muted">
                  {group}
                </p>
                <ul className="space-y-2">
                  {users.map((u) => (
                    <li
                      key={u.id}
                      className="rounded-xl border border-border bg-card px-3 py-2 text-xs"
                    >
                      <p className="font-medium text-text">
                        {(u.instrument ?? "—") + " - " + (u.full_name ?? "—")}
                      </p>
                      <p className="mt-0.5 text-text-muted">学院：{u.college?.trim() || "—"}</p>
                      <p className="mt-0.5 text-text-muted">邮箱：{u.email ?? "—"}</p>
                      <p className="mt-0.5 text-text-subtle">
                        入团时间：{u.join_date?.trim() || "—"}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
