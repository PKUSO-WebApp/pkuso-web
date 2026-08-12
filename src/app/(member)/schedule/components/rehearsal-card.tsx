import { Card } from "@/components/ui/Card";
import { formatRehearsalRange } from "./utils";
import { canSignIn } from "@/lib/attendance-utils";
import { parseLocalISO } from "@/lib/date-utils";
import type { RehearsalRow } from "@/types/database";

type Props = {
  item: RehearsalRow;
  hasSigned: boolean;
  onSignIn?: () => void;
};

export function RehearsalCard({ item, hasSigned, onSignIn }: Props) {
  // 签到窗口判断：提前超过 30 分钟未开始、或排练已结束，均不可签到
  let blockReason: "not-started" | "ended" | null = null;
  if (item.start_time) {
    const now = new Date();
    const start = parseLocalISO(item.start_time);
    if (!Number.isNaN(start.getTime())) {
      const end = item.end_time
        ? parseLocalISO(item.end_time)
        : new Date(start.getTime() + 3 * 60 * 60 * 1000);
      if (now.getTime() > end.getTime()) {
        blockReason = "ended";
      } else if (!canSignIn(now, start, end)) {
        blockReason = "not-started";
      }
    }
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5 leading-tight">
          <p className="text-sm text-text-muted">
            {item.repertoire}
            {item.type === "section" && item.target_section ? ` · ${item.target_section}` : null}
          </p>
          <h2 className="text-base font-semibold text-text">
            {item.start_time
              ? formatRehearsalRange(item.start_time, item.end_time ?? null)
              : "时间未设置"}
          </h2>
          <p className="text-xs text-text-muted">
            地点：{item.location}
            {item.type === "section" && item.target_section
              ? ` · 针对：${item.target_section}`
              : null}
          </p>
        </div>

        <div className="flex items-center">
          {hasSigned ? (
            <span className="rounded-full bg-success-bg px-3 py-1 text-label text-success">
              ✅ 已签到
            </span>
          ) : blockReason ? (
            <span className="rounded-full bg-muted px-3 py-1 text-label text-text-subtle">
              {blockReason === "ended" ? "已结束" : "未开始"}
            </span>
          ) : (
            onSignIn && (
              <button
                type="button"
                onClick={onSignIn}
                className="inline-flex items-center justify-center rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-text shadow-sm"
              >
                签到
              </button>
            )
          )}
        </div>
      </div>
    </Card>
  );
}
