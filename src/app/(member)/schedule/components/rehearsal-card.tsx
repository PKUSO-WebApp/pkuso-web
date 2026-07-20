import { Card } from "@/components/ui/Card";
import { formatRehearsalRange, isRehearsalExpired } from "./utils";
import type { RehearsalRow } from "@/types/database";

type Props = {
  item: RehearsalRow;
  hasSigned: boolean;
  onSignIn?: () => void;
};

export function RehearsalCard({ item, hasSigned, onSignIn }: Props) {
  const expired = isRehearsalExpired(item.start_time!, item.end_time ?? null);

  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5 leading-tight">
          <p className="text-sm text-text-muted">
            {item.repertoire}
            {item.type === "section" && item.target_section ? ` · ${item.target_section}` : null}
          </p>
          <h2 className="text-base font-semibold text-text">
            {formatRehearsalRange(item.start_time!, item.end_time ?? null)}
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
          ) : expired ? (
            <span className="rounded-full bg-muted px-3 py-1 text-label text-text-subtle">
              已结束
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
