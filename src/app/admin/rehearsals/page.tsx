"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useRehearsals } from "@/hooks/useRehearsals";
import { Toggle } from "@/components/ui/Toggle";
import { AdminRehearsalCard } from "./components/rehearsal-card";
import {
  sortRehearsalsForMember,
  sortEndedFullRehearsals,
  isRehearsalTodayOrFuture,
} from "@/lib/rehearsal-sort";
import { useAdminPageHeader } from "@/context/admin-page-header-context";

type RehearsalType = "合排" | "分排" | "历史合排";

export default function AdminRehearsalsPage() {
  const router = useRouter();
  const { setTitle, setHeaderRight } = useAdminPageHeader();
  const { data: schedules, loading } = useRehearsals();
  const [currentType, setCurrentType] = React.useState<RehearsalType>("合排");

  // 页顶标题与操作按钮（随 tab 切换联动）
  React.useEffect(() => {
    setTitle(currentType === "历史合排" ? "历史合排" : "排练管理");
    setHeaderRight(
      currentType !== "历史合排" ? (
        <button
          type="button"
          onClick={() => router.push("/admin/rehearsals/new")}
          className="rounded-full bg-primary px-3 py-1 text-label font-medium text-primary-foreground shadow-sm hover:opacity-90"
        >
          发布新日程
        </button>
      ) : null,
    );
  }, [setTitle, setHeaderRight, currentType, router]);

  // 分钟级时钟 tick：跨排练结束时刻停留页面时，定时刷新「进行中/已结束」分组与排序
  const [nowTick, setNowTick] = React.useState(() => Date.now());

  React.useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  const list = React.useMemo(() => {
    const now = new Date(nowTick);
    if (currentType === "历史合排") {
      return sortEndedFullRehearsals(schedules ?? [], now);
    }
    const filtered = (schedules ?? []).filter((r) => {
      if (r.type === "full") {
        if (currentType !== "合排") return false;
      } else if (r.type === "section") {
        if (currentType !== "分排") return false;
      } else {
        return false;
      }
      // 仅今天起（start_time 日期 >= 今天 00:00）的排练，不含过去
      return isRehearsalTodayOrFuture(r, now);
    });
    return sortRehearsalsForMember(filtered, now);
  }, [schedules, currentType, nowTick]);

  return (
    /* 根容器 flex 化：头部固定，列表整体独立滚动（与社区页一致） */
    <div className="flex h-full min-h-0 flex-col space-y-4">
      <div className="flex-1 min-h-0 space-y-4 overflow-y-auto">
        <Toggle
          options={["合排", "分排", "历史合排"] as const}
          value={currentType}
          onChange={setCurrentType}
        />

        <section
          className={`${currentType === "历史合排" ? "max-h-[520px]" : "max-h-[520px]"} space-y-3 overflow-y-auto`}
        >
          {loading && <p className="py-6 text-center text-xs text-text-subtle">加载中…</p>}
          {!loading &&
            list.map((item) => (
              <AdminRehearsalCard
                key={item.id}
                item={item}
                onClick={() => router.push(`/admin/rehearsals/${item.id}`)}
              />
            ))}
          {!loading && list.length === 0 && (
            <p className="py-8 text-center text-xs text-text-muted">暂无安排</p>
          )}
        </section>
      </div>
    </div>
  );
}
