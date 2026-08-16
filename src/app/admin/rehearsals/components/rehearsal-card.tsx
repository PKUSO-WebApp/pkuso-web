import { Card } from "@/components/ui/Card";
import { formatRehearsalRange } from "@/lib/date-utils";
import { getUpdateBadgeLabel } from "@/lib/rehearsal-sort";
import type { RehearsalRow } from "@/types/database";

type Props = {
  item: RehearsalRow;
  /** 点击卡片打开详情弹窗（Issue #173：卡片去按钮化，编辑/删除入口收敛到详情弹窗） */
  onClick: () => void;
};

export function AdminRehearsalCard({ item, onClick }: Props) {
  // 更新提示文案（Issue #171）：与用户端共用 getUpdateBadgeLabel，按 updated_fields 细分
  const updateLabel = getUpdateBadgeLabel(item);

  return (
    /* Card 传入 onClick 时渲染为 button 元素（type="button" + 可点击样式） */
    <Card onClick={onClick} className="w-full text-left">
      <div className="space-y-0.5 leading-tight">
        <p className="break-words text-sm text-text-muted">
          {item.repertoire}
          {item.type === "section" && item.target_section ? ` · ${item.target_section}` : null}
        </p>
        <h2 className="text-base font-semibold text-text">
          {item.start_time
            ? formatRehearsalRange(item.start_time, item.end_time ?? null)
            : "时间未设置"}
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
    </Card>
  );
}
