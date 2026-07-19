"use client";

import React from "react";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import { useRehearsals } from "@/hooks/useRehearsals";
import { Toggle } from "@/components/ui/Toggle";
import { Card } from "@/components/ui/Card";

export default function Home() {
  const { data: announcement, loading: announcementLoading } = useAnnouncements();
  const { data: rehearsals, loading: rehearsalsLoading } = useRehearsals();
  const [scheduleTab, setScheduleTab] = React.useState<"full" | "section">("full");

  const list = React.useMemo(() => {
    return rehearsals.filter((r) => {
      const t = (r.title ?? "").trim();
      if (scheduleTab === "full") return t.includes("合排") && !t.includes("分排");
      return t.includes("分排");
    });
  }, [rehearsals, scheduleTab]);

  return (
    <div className="min-h-screen pb-6">
      <header className="mb-1">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold text-text">本周排练日程</h1>
            <p className="mt-1 text-xs text-text-muted">查看乐团合排与分排安排</p>
          </div>
        </div>
        <div className="mt-2">
          <Toggle
            options={["full", "section"] as const}
            value={scheduleTab}
            onChange={setScheduleTab}
            getLabel={(k) => ({ full: "合排", section: "分排" })[k]}
          />
        </div>
      </header>

      {!announcementLoading && announcement?.content && (
        <Card className="mt-2 mb-4 border-warning-bg bg-warning-bg/80">
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-warning">📢</span>
            <p className="min-w-0 truncate text-xs text-warning">{announcement.content}</p>
          </div>
        </Card>
      )}

      <section className="space-y-5">
        {rehearsalsLoading ? (
          <p className="py-12 text-center text-xs text-text-muted">加载中…</p>
        ) : list.length === 0 ? (
          <p className="py-12 text-center text-xs text-text-muted">暂无安排</p>
        ) : (
          list.map((r) => (
            <Card key={String(r.id)}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold text-text">
                    {(r.date ?? "").length >= 10
                      ? `${r.date!.split("-")[1]}-${r.date!.split("-")[2]}`
                      : "—"}
                  </h2>
                  <p className="mt-0.5 text-label text-text-muted">
                    排练曲目：{r.repertoire || "—"}
                  </p>
                  <p className="mt-1 text-label text-text-subtle">📍 {r.location ?? "—"}</p>
                </div>
              </div>
            </Card>
          ))
        )}
      </section>
    </div>
  );
}
