"use client";

import React from "react";
import { useSchedule } from "@/hooks/useSchedule";
import { useUser } from "@/context/user-context";
import { ScheduleGantt } from "./components/schedule-gantt";
import { DateSelector } from "./components/date-selector";
import {
  CreateScheduleModal,
  type CreateScheduleFormState,
} from "./components/create-schedule-modal";

// 获取本地日期字符串，避免 toISOString() 的时区转换
function getLocalDateString(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function MemberSchedulePage() {
  const { data: schedules, loading, fetch, create, checkConflict, remove } = useSchedule();
  const { user } = useUser();
  const [selectedDate, setSelectedDate] = React.useState<string>(getLocalDateString);
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const [form, setForm] = React.useState<CreateScheduleFormState>({
    title: "",
    date: getLocalDateString(),
    startTime: "",
    endTime: "",
  });

  // 日期变化时重新获取数据
  React.useEffect(() => {
    void fetch(selectedDate);
  }, [selectedDate, fetch]);

  // 过滤当前日期的预约（后端已筛选，这里做二次过滤确保准确性）
  const filteredSchedules = schedules.filter((schedule) => {
    const date = new Date(schedule.start_time);
    // 使用本地日期比较，避免时区问题
    const scheduleDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return scheduleDate === selectedDate;
  });

  const handleFormChange = (field: keyof CreateScheduleFormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFormError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // 防止重复提交
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      // 验证开始时间和结束时间不能为空
      if (!form.startTime || !form.endTime) {
        setFormError("请填写开始时间和结束时间");
        return;
      }

      // 验证结束时间必须晚于开始时间（不能等于）
      if (form.endTime <= form.startTime) {
        setFormError("结束时间必须晚于开始时间");
        return;
      }

      // 检查时间冲突
      const conflictError = await checkConflict(form.date, form.startTime, form.endTime);
      if (conflictError) {
        setFormError(conflictError);
        return;
      }

      // 构造开始时间和结束时间 ISO 字符串（不支持跨天预约）
      const startDateTime = `${form.date}T${form.startTime}:00`;
      const endDateTime = `${form.date}T${form.endTime}:00`;

      const result = await create(
        {
          title: form.title,
          start_time: startDateTime,
          end_time: endDateTime,
          author_id: user?.id ?? null,
        },
        form.date,
      );

      if (result) {
        setIsModalOpen(false);
        setForm({
          title: "",
          date: getLocalDateString(),
          startTime: "",
          endTime: "",
        });
        setFormError(null);
      } else {
        setFormError("添加预约失败，请重试");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setForm({
      title: "",
      date: getLocalDateString(),
      startTime: "",
      endTime: "",
    });
    setFormError(null);
  };

  // 格式化显示日期
  const formatDisplayDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const weekDays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    const dayOfWeek = weekDays[date.getDay()];
    return `${month}月${day}日 ${dayOfWeek}`;
  };

  return (
    <div className="flex flex-col h-full max-w-md mx-auto w-full pb-safe overflow-hidden">
      {/* 头部 */}
      <div className="mt-4 mb-4">
        <h1 className="text-lg font-semibold text-text">日程预约</h1>
        <p className="text-sm text-text-muted">管理排练房预约</p>
      </div>

      {/* 日期选择器 */}
      <div className="mb-4">
        <DateSelector selectedDate={selectedDate} onDateChange={setSelectedDate} />
      </div>

      {/* 当前日期显示 */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-medium text-text">{formatDisplayDate(selectedDate)}</h2>
        <button
          onClick={() => setIsModalOpen(true)}
          className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90"
        >
          添加预约
        </button>
      </div>

      {/* 甘特图 — flex-1 占满剩余空间，内部 overflow-y-auto 独立滚动 */}
      <div className="flex-1 min-h-0 mb-4 overflow-y-auto rounded-xl border border-border bg-card">
        {loading ? (
          <div className="flex h-80 items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : (
          <ScheduleGantt
            schedules={filteredSchedules}
            user={user}
            remove={remove}
            selectedDate={selectedDate}
          />
        )}
      </div>

      {/* 添加预约弹窗 */}
      <CreateScheduleModal
        open={isModalOpen}
        form={form}
        submitting={isSubmitting}
        error={formError}
        onChange={handleFormChange}
        onClose={handleCloseModal}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
