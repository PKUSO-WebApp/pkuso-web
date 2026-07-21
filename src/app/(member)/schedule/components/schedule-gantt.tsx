"use client";

import React from "react";
import { supabase } from "@/lib/supabase";
import { Modal } from "@/components/ui/Modal";
import { parseLocalISO, formatTime } from "@/lib/date-utils";
import type { ProfileRow, ScheduleRow } from "@/types/database";

type Props = {
  schedules: ScheduleRow[];
  user: { id: string } | null | undefined;
  remove: (id: number, date?: string) => Promise<boolean>;
  selectedDate: string;
};

// 7个颜色token，根据id哈希分配
function getScheduleColor(id: number): string {
  const colors = [
    "--color-schedule-1",
    "--color-schedule-2",
    "--color-schedule-3",
    "--color-schedule-4",
    "--color-schedule-5",
    "--color-schedule-6",
    "--color-schedule-7",
  ];
  return colors[Math.abs(id) % colors.length];
}

// 解析时间字符串为小时数（0-24）
function parseTimeToHours(timeStr: string | null): number {
  if (!timeStr) return 0;
  const date = parseLocalISO(timeStr);
  if (isNaN(date.getTime())) return 0;
  return date.getHours() + date.getMinutes() / 60;
}

export function ScheduleGantt({ schedules, user, remove, selectedDate }: Props) {
  const [selectedSchedule, setSelectedSchedule] = React.useState<ScheduleRow | null>(null);
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const [authorName, setAuthorName] = React.useState<string | null>(null);
  const [loadingAuthor, setLoadingAuthor] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // 追踪当前查询的schedule id，用于竞态条件判断
  const queryingScheduleId = React.useRef<number | null>(null);

  // 处理删除预约
  const handleDelete = async () => {
    if (!selectedSchedule) return;

    // 添加删除确认对话框
    const confirmed = window.confirm(
      `确定要删除预约「${selectedSchedule.title || "未命名预约"}」吗？`,
    );
    if (!confirmed) return;

    setDeleting(true);
    setError(null);
    const success = await remove(selectedSchedule.id, selectedDate);
    if (success) {
      handleCloseModal();
    } else {
      setError("删除失败，请稍后重试");
    }
    setDeleting(false);
  };

  // 判断当前用户是否为预约创建者
  const isAuthor = selectedSchedule?.author_id === user?.id;

  // 计算每个预约的位置和高度
  const scheduleItems = schedules.map((schedule) => {
    const startHour = parseTimeToHours(schedule.start_time);
    const endHour = parseTimeToHours(schedule.end_time);
    const duration = endHour - startHour || 1; // 默认1小时

    return {
      ...schedule,
      startHour,
      duration,
      top: startHour * (100 / 24), // 百分比位置
      height: Math.max(duration * (100 / 24), 2), // 最小高度2%
    };
  });

  // 点击预约块时查询预约人姓名并打开弹窗
  const handleScheduleClick = async (schedule: ScheduleRow) => {
    setSelectedSchedule(schedule);
    setIsModalOpen(true);
    setLoadingAuthor(true);
    setAuthorName(null);
    setError(null);

    // 使用 ref 记录当前查询的 schedule id，防止竞态条件
    queryingScheduleId.current = schedule.id;

    if (schedule.author_id) {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", schedule.author_id)
        .single();

      // 使用 ref 检查当前查询的结果是否仍为用户选中的预约，避免竞态条件
      if (!error && (profile as ProfileRow | null) && queryingScheduleId.current === schedule.id) {
        setAuthorName((profile as ProfileRow).full_name || null);
        // 只有当前查询的结果有效时才更新 loadingAuthor 状态
        setLoadingAuthor(false);
      }
    } else {
      // 如果没有 author_id，显示为 admin（排练自动生成的预约）
      if (queryingScheduleId.current === schedule.id) {
        setAuthorName("admin");
        setLoadingAuthor(false);
      }
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedSchedule(null);
    setAuthorName(null);
    setError(null);
  };

  // 用户注销或登录状态切换时自动关闭弹窗，避免中间态问题
  React.useEffect(() => {
    if (user === null && isModalOpen) {
      handleCloseModal();
    }
  }, [user, isModalOpen]);

  return (
    <>
      <div className="relative flex w-full" style={{ height: "480px" }}>
        {/* 左侧时间轴 */}
        <div
          className="flex-shrink-0 w-12 border-r border-border"
          style={{ backgroundColor: "var(--color-gantt-sidebar)" }}
        >
          {Array.from({ length: 24 }).map((_, hour) => (
            <div
              key={hour}
              className={`relative h-[calc(100%/24)] flex items-start justify-center pt-1 text-text-muted ${
                hour % 4 === 0 ? "font-medium" : ""
              }`}
              style={{
                fontSize: "var(--text-caption)",
                borderTop:
                  hour % 4 === 0 && hour !== 0
                    ? "2px solid var(--color-text)"
                    : hour !== 24
                      ? "1px solid var(--color-border)"
                      : "none",
              }}
            >
              {hour !== 24 && `${hour.toString().padStart(2, "0")}:00`}
            </div>
          ))}
        </div>

        {/* 右侧甘特图区域 */}
        <div className="relative flex-1">
          {/* 小时分隔线 */}
          <div className="absolute inset-0 pointer-events-none">
            {Array.from({ length: 24 }).map((_, hour) => (
              <div
                key={hour}
                className="absolute left-0 right-0"
                style={{
                  top: `${(hour / 24) * 100}%`,
                  borderBottom:
                    hour % 4 === 0 && hour !== 0
                      ? "2px solid var(--color-text)"
                      : "1px solid var(--color-border)",
                }}
              />
            ))}
          </div>

          {/* 预约块 */}
          {scheduleItems.map((schedule) => (
            <div
              key={schedule.id}
              className="absolute left-2 right-2 rounded-lg cursor-pointer transition-all duration-200 hover:opacity-80"
              style={{
                top: `${schedule.top}%`,
                height: `${schedule.height}%`,
                backgroundColor: `var(${getScheduleColor(schedule.id)})`,
              }}
              onClick={() => handleScheduleClick(schedule)}
            >
              <div className="flex h-full flex-col justify-center px-2 py-1">
                <div
                  className="font-medium text-xs truncate"
                  style={{ color: "var(--color-schedule-text)" }}
                >
                  {schedule.title || "未命名预约"}
                </div>
                <div
                  style={{
                    fontSize: "var(--text-caption)",
                    color: "var(--color-schedule-text-muted)",
                  }}
                >
                  {formatTime(schedule.start_time)} - {formatTime(schedule.end_time)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 预约详情弹窗 */}
      <Modal open={isModalOpen} onClose={handleCloseModal} title="预约详情">
        {selectedSchedule && (
          <div className="space-y-3 text-xs">
            <div>
              <div className="text-text-muted mb-1">标题</div>
              <div className="font-medium text-text">{selectedSchedule.title || "未命名预约"}</div>
            </div>
            <div>
              <div className="text-text-muted mb-1">时间</div>
              <div className="text-text">
                {formatTime(selectedSchedule.start_time)} - {formatTime(selectedSchedule.end_time)}
              </div>
            </div>
            <div>
              <div className="text-text-muted mb-1">预约人</div>
              <div className="text-text">{loadingAuthor ? "加载中..." : authorName || "未知"}</div>
            </div>
            {isAuthor && (
              <div className="pt-2 border-t border-border">
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="w-full py-2 text-sm font-medium text-danger bg-danger/10 rounded-lg hover:bg-danger/20 transition-colors disabled:opacity-50"
                >
                  {deleting ? "删除中..." : "删除预约"}
                </button>
                {error && <div className="mt-2 text-sm text-danger text-center">{error}</div>}
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
