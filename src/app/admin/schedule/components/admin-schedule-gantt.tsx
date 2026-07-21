"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Modal } from "@/components/ui/Modal";
import { parseLocalISO } from "@/lib/date-utils";
import type { ProfileRow, ScheduleRow } from "@/types/database";

type Props = {
  schedules: ScheduleRow[];
  user: { id: string } | null | undefined;
  remove: (id: number, date?: string) => Promise<boolean>;
  removeGroup: (groupId: string, date?: string) => Promise<boolean>;
  selectedDate: string;
};

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

function parseTimeToHours(timeStr: string | null): number {
  if (!timeStr) return 0;
  const date = parseLocalISO(timeStr);
  if (isNaN(date.getTime())) return 0;
  return date.getHours() + date.getMinutes() / 60;
}

function formatTime(timeStr: string | null): string {
  if (!timeStr) return "--:--";
  const date = parseLocalISO(timeStr);
  if (isNaN(date.getTime())) return "--:--";
  return date.toTimeString().slice(0, 5);
}

export function AdminScheduleGantt({ schedules, remove, removeGroup, selectedDate }: Props) {
  const router = useRouter();
  const [selectedSchedule, setSelectedSchedule] = React.useState<ScheduleRow | null>(null);
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const [authorName, setAuthorName] = React.useState<string | null>(null);
  const [loadingAuthor, setLoadingAuthor] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [deleteMode, setDeleteMode] = React.useState<"single" | "group" | null>(null);

  const queryingScheduleId = React.useRef<number | null>(null);

  const isRehearsalSchedule =
    selectedSchedule?.author_id === null || selectedSchedule?.rehearsal_id !== null;

  const handleDelete = async () => {
    if (!selectedSchedule) return;

    setDeleting(true);
    setError(null);
    let success = false;

    if (deleteMode === "group" && selectedSchedule.group_id) {
      success = await removeGroup(selectedSchedule.group_id, selectedDate);
    } else {
      success = await remove(selectedSchedule.id, selectedDate);
    }

    if (success) {
      handleCloseModal();
    } else {
      setError("删除失败，请稍后重试");
    }
    setDeleting(false);
    setDeleteMode(null);
  };

  const handleScheduleClick = async (schedule: ScheduleRow) => {
    setSelectedSchedule(schedule);
    setIsModalOpen(true);
    setLoadingAuthor(true);
    setAuthorName(null);
    setError(null);
    setDeleteMode(null);

    queryingScheduleId.current = schedule.id;

    if (schedule.author_id) {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", schedule.author_id)
        .single();

      if (!error && (profile as ProfileRow | null) && queryingScheduleId.current === schedule.id) {
        setAuthorName((profile as ProfileRow).full_name || null);
        setLoadingAuthor(false);
      }
    } else {
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
    setDeleteMode(null);
  };

  const scheduleItems = schedules.map((schedule) => {
    const startHour = parseTimeToHours(schedule.start_time);
    const endHour = parseTimeToHours(schedule.end_time);
    const duration = endHour - startHour || 1;

    return {
      ...schedule,
      startHour,
      duration,
      top: startHour * (100 / 24),
      height: Math.max(duration * (100 / 24), 2),
    };
  });

  return (
    <>
      <div className="relative flex w-full" style={{ height: "480px" }}>
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

        <div className="relative flex-1">
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
            {selectedSchedule.group_id && (
              <div>
                <div className="text-text-muted mb-1">预约组</div>
                <div className="text-text text-warning">属于重复预约组</div>
              </div>
            )}
            <div className="pt-2 border-t border-border">
              {isRehearsalSchedule && !deleteMode ? (
                <div className="space-y-2">
                  <button
                    onClick={() => router.push("/admin/rehearsals")}
                    className="w-full py-2 text-sm font-medium text-primary bg-primary/10 rounded-lg hover:bg-primary/20 transition-colors"
                  >
                    前往排练页面查看
                  </button>
                  <p className="text-xs text-text-muted text-center">
                    此预约由排练自动创建，请在排练页面进行管理
                  </p>
                </div>
              ) : !deleteMode ? (
                <div className="space-y-2">
                  <button
                    onClick={() => setDeleteMode("single")}
                    disabled={deleting}
                    className="w-full py-2 text-sm font-medium text-danger bg-danger/10 rounded-lg hover:bg-danger/20 transition-colors disabled:opacity-50"
                  >
                    删除此预约
                  </button>
                  {selectedSchedule.group_id && (
                    <button
                      onClick={() => setDeleteMode("group")}
                      disabled={deleting}
                      className="w-full py-2 text-sm font-medium text-warning bg-warning/10 rounded-lg hover:bg-warning/20 transition-colors disabled:opacity-50"
                    >
                      删除所有重复预约
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-text-muted text-center">
                    {deleteMode === "group"
                      ? "确定要删除所有重复预约吗？"
                      : `确定要删除预约「${selectedSchedule.title || "未命名预约"}」吗？`}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setDeleteMode(null)}
                      className="flex-1 py-2 text-sm font-medium text-text-muted bg-muted rounded-lg hover:bg-border transition-colors"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleDelete}
                      disabled={deleting}
                      className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${
                        deleteMode === "group"
                          ? "text-warning bg-warning/20 hover:bg-warning/30"
                          : "text-danger bg-danger/20 hover:bg-danger/30"
                      }`}
                    >
                      {deleting ? "删除中..." : "确认删除"}
                    </button>
                  </div>
                </div>
              )}
              {error && <div className="mt-2 text-sm text-danger text-center">{error}</div>}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
