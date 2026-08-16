import { Card } from "@/components/ui/Card";
import { formatRehearsalRange, isRehearsalExpired } from "@/lib/date-utils";
import { getUpdateBadgeLabel } from "@/lib/rehearsal-sort";
import type { RehearsalRow } from "@/types/database";

type Props = {
  item: RehearsalRow;
  onEdit?: () => void;
  onDelete?: () => void;
  onViewAttendance?: () => void;
};

export function AdminRehearsalCard({ item, onEdit, onDelete, onViewAttendance }: Props) {
  const expired = isRehearsalExpired(item.start_time!, item.end_time ?? null);
  // 更新提示文案（Issue #171）：与用户端共用 getUpdateBadgeLabel，按 updated_fields 细分
  const updateLabel = getUpdateBadgeLabel(item);

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
          {/* 更新提示 chip（与用户端同一语义 token 与文案，Issue #171） */}
          {updateLabel && (
            <span className="inline-block rounded bg-warning-bg/80 px-1.5 py-0.5 text-xs text-warning">
              {updateLabel}
            </span>
          )}
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
              /* hover 语义色（与社区页编辑按钮一致，替代硬编码 blue，审计清理） */
              <button type="button" onClick={onEdit} className="text-text-muted hover:text-text">
                编辑
              </button>
            )}
            {onDelete && (
              /* hover 危险语义色（替代硬编码 red，审计清理） */
              <button
                type="button"
                onClick={onDelete}
                className="text-text-subtle hover:text-danger"
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
