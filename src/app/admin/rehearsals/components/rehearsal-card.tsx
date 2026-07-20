import { Card } from "@/components/ui/Card";
import { formatRehearsalRange, isRehearsalExpired } from "@/app/(member)/schedule/components/utils";
import type { RehearsalRow } from "@/types/database";

type Props = {
  item: RehearsalRow;
  onEdit?: () => void;
  onDelete?: () => void;
  onViewAttendance?: () => void;
};

export function AdminRehearsalCard({ item, onEdit, onDelete, onViewAttendance }: Props) {
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

        <div className="flex flex-col items-end gap-1 text-label">
          {expired && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-caption text-text-muted">
              已结束
            </span>
          )}
          {item.type === "full" && item.sign_in_code ? (
            <span className="text-caption text-text-muted">密码: {item.sign_in_code}</span>
          ) : null}
          <div className="flex items-center gap-2">
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="text-text-muted hover:text-blue-500"
              >
                编辑
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="text-text-subtle hover:text-red-500"
              >
                删除
              </button>
            )}
          </div>
          {onViewAttendance && (
            <button
              type="button"
              onClick={onViewAttendance}
              className="text-text-muted hover:text-text"
            >
              📊 查看出勤
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}
