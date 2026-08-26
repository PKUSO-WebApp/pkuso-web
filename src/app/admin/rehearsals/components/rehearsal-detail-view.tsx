"use client";

import { formatRehearsalRange } from "@/lib/date-utils";
import type { RehearsalRow } from "@/types/database";

/**
 * 排练详情只读视图（参照小程序 rehearsal-detail/index.tsx 转写）
 *
 * 不再用单卡片包裹，改为：大标题（时间）+ 副标题（类型/声部）+ 分隔线 +
 * 标签/值明细行。管理员端不展示签到按钮（签到仅面向成员）。
 */
export function RehearsalDetailView({ item }: { item: RehearsalRow }) {
  const timeText = item.start_time
    ? formatRehearsalRange(item.start_time, item.end_time ?? null)
    : "时间未设置";
  const typeText =
    item.type === "section"
      ? item.target_section
        ? `分排 · ${item.target_section}`
        : "分排"
      : "合排";

  const checkinText =
    item.checkin_lat != null && item.checkin_lng != null
      ? `${item.checkin_lat.toFixed(6)}, ${item.checkin_lng.toFixed(6)}${
          item.checkin_radius_m != null ? ` · 允许半径 ${item.checkin_radius_m} 米` : " · 不限半径"
        }`
      : "不限位置";

  return (
    <div className="px-4 pb-2">
      <h2 className="text-2xl font-semibold leading-snug text-text">{timeText}</h2>
      <p className="mt-1 text-sm text-text-muted">{typeText}</p>
      <div className="my-4 h-px w-full bg-border" />
      <DetailRow label="地点" value={item.location || "—"} />
      <DetailRow label="曲目" value={item.repertoire || "—"} />
      <DetailRow label="签到点" value={checkinText} />
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-3">
      <p className="text-sm font-medium text-text">{label}</p>
      <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-text-muted">{value}</p>
    </div>
  );
}
