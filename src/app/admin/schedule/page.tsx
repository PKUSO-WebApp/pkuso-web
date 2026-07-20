"use client";

import React from "react";
import { supabase } from "@/lib/supabase";
import { useSchedule } from "@/hooks/useSchedule";
import { useUser } from "@/context/user-context";
import { AdminScheduleGantt } from "./components/admin-schedule-gantt";
import { DateSelector } from "./components/date-selector";
import {
  CreateScheduleModal,
  type CreateScheduleFormState,
} from "./components/create-schedule-modal";

function getLocalDateString(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function generateWeeklyDates(
  year: number,
  startMonth: number,
  startWeek: number,
  endMonth: number,
  endWeek: number,
  dayOfWeek: number,
): { dates: Date[]; error: string | null } {
  const dates: Date[] = [];

  const startDate = new Date(year, startMonth - 1, 1);
  const firstDayOfWeek = startDate.getDay();
  const offset = (dayOfWeek - firstDayOfWeek + 7) % 7;
  const currentDate = new Date(startDate);
  currentDate.setDate(1 + offset + (startWeek - 1) * 7);

  const endDate = new Date(year, endMonth, 0);
  const lastDayOfWeek = endDate.getDay();
  const lastOffset = (dayOfWeek - lastDayOfWeek + 7) % 7;
  const lastTargetDate = new Date(endDate);
  if (lastOffset > 0) lastTargetDate.setDate(endDate.getDate() - lastOffset);
  if (endWeek < 5) {
    lastTargetDate.setDate(lastTargetDate.getDate() - (5 - endWeek) * 7);
  }

  if (currentDate > lastTargetDate) {
    return { dates: [], error: "日期范围无效，请调整开始和结束周" };
  }

  while (currentDate <= lastTargetDate) {
    dates.push(new Date(currentDate));
    currentDate.setDate(currentDate.getDate() + 7);
  }

  return { dates, error: null };
}

function generateMonthlyDates(
  year: number,
  startMonth: number,
  endMonth: number,
  dayOfMonth: number,
): { dates: Date[]; error: string | null } {
  const dates: Date[] = [];
  const skippedMonths: number[] = [];

  for (let month = startMonth; month <= endMonth; month++) {
    const date = new Date(year, month - 1, dayOfMonth);
    if (date.getMonth() === month - 1) {
      dates.push(date);
    } else {
      skippedMonths.push(month);
    }
  }

  if (skippedMonths.length > 0 && dates.length === 0) {
    return {
      dates: [],
      error: `${skippedMonths.join("月、")}月没有${dayOfMonth}日，请选择其他日期`,
    };
  }

  if (skippedMonths.length > 0) {
    return { dates, error: `${skippedMonths.join("月、")}月没有${dayOfMonth}日，已跳过这些月份` };
  }

  return { dates, error: null };
}

export default function AdminSchedulePage() {
  const { data: schedules, loading, fetch, checkConflict, remove } = useSchedule();
  const { user } = useUser();
  const [selectedDate, setSelectedDate] = React.useState<string>(getLocalDateString());
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const [form, setForm] = React.useState<CreateScheduleFormState>({
    title: "",
    date: getLocalDateString(),
    startTime: "",
    endTime: "",
    repeatMode: "single",
    weeklyDay: 1,
    weeklyStartMonth: new Date().getMonth() + 1,
    weeklyStartWeek: 1,
    weeklyEndMonth: new Date().getMonth() + 1,
    weeklyEndWeek: 1,
    monthlyDay: 1,
    monthlyStartMonth: new Date().getMonth() + 1,
    monthlyEndMonth: new Date().getMonth() + 1,
  });

  React.useEffect(() => {
    void fetch(selectedDate);
  }, [selectedDate, fetch]);

  const filteredSchedules = schedules.filter((schedule) => {
    const date = new Date(schedule.start_time);
    const scheduleDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return scheduleDate === selectedDate;
  });

  const handleFormChange = <K extends keyof CreateScheduleFormState>(
    field: K,
    value: CreateScheduleFormState[K],
  ) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFormError(null);
  };

  const handleRemoveGroup = async (groupId: string, date?: string): Promise<boolean> => {
    const { error } = await supabase.from("schedules").delete().eq("group_id", groupId);
    if (error) {
      return false;
    }
    if (date) {
      await fetch(date);
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      if (!form.startTime || !form.endTime) {
        setFormError("请填写开始时间和结束时间");
        return;
      }

      if (form.endTime <= form.startTime) {
        setFormError("结束时间必须晚于开始时间");
        return;
      }

      const groupId = form.repeatMode !== "single" ? crypto.randomUUID() : null;
      const year = new Date().getFullYear();
      let dates: Date[] = [];
      let dateError: string | null = null;

      switch (form.repeatMode) {
        case "single":
          dates = [new Date(form.date)];
          break;
        case "weekly": {
          const result = generateWeeklyDates(
            year,
            form.weeklyStartMonth,
            form.weeklyStartWeek,
            form.weeklyEndMonth,
            form.weeklyEndWeek,
            form.weeklyDay,
          );
          dates = result.dates;
          dateError = result.error;
          break;
        }
        case "monthly": {
          const result = generateMonthlyDates(
            year,
            form.monthlyStartMonth,
            form.monthlyEndMonth,
            form.monthlyDay,
          );
          dates = result.dates;
          dateError = result.error;
          break;
        }
      }

      if (dates.length === 0) {
        setFormError(dateError || "未生成任何预约日期");
        return;
      }

      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

      for (const date of dates) {
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        if (dateStr < todayStr) {
          setFormError("不能创建过去日期的预约");
          return;
        }

        const conflictError = await checkConflict(dateStr, form.startTime, form.endTime);
        if (conflictError) {
          setFormError(`${dateStr}: ${conflictError}`);
          return;
        }
      }

      const payloads = dates.map((date) => {
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        return {
          title: form.title,
          start_time: `${dateStr}T${form.startTime}:00`,
          end_time: `${dateStr}T${form.endTime}:00`,
          author_id: user?.id ?? null,
          group_id: groupId,
        };
      });

      const { error: insertError } = await supabase.from("schedules").insert(payloads);
      if (insertError) {
        setFormError("添加预约失败，请重试");
        return;
      }

      await fetch(selectedDate);

      if (dateError) {
        setFormError(dateError);
      } else {
        setIsModalOpen(false);
        setForm({
          title: "",
          date: getLocalDateString(),
          startTime: "",
          endTime: "",
          repeatMode: "single",
          weeklyDay: 1,
          weeklyStartMonth: new Date().getMonth() + 1,
          weeklyStartWeek: 1,
          weeklyEndMonth: new Date().getMonth() + 1,
          weeklyEndWeek: 1,
          monthlyDay: 1,
          monthlyStartMonth: new Date().getMonth() + 1,
          monthlyEndMonth: new Date().getMonth() + 1,
        });
        setFormError(null);
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
      repeatMode: "single",
      weeklyDay: 1,
      weeklyStartMonth: new Date().getMonth() + 1,
      weeklyStartWeek: 1,
      weeklyEndMonth: new Date().getMonth() + 1,
      weeklyEndWeek: 1,
      monthlyDay: 1,
      monthlyStartMonth: new Date().getMonth() + 1,
      monthlyEndMonth: new Date().getMonth() + 1,
    });
    setFormError(null);
  };

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
      <div className="mt-4 mb-4">
        <h1 className="text-lg font-semibold text-text">日程管理</h1>
        <p className="text-sm text-text-muted">管理排练房预约（管理员）</p>
      </div>

      <div className="mb-4">
        <DateSelector selectedDate={selectedDate} onDateChange={setSelectedDate} />
      </div>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-medium text-text">{formatDisplayDate(selectedDate)}</h2>
        <button
          onClick={() => setIsModalOpen(true)}
          className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90"
        >
          添加预约
        </button>
      </div>

      <div className="flex-1 min-h-0 mb-4 overflow-y-auto rounded-xl border border-border bg-card">
        {loading ? (
          <div className="flex h-80 items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : (
          <AdminScheduleGantt
            schedules={filteredSchedules}
            user={user}
            remove={remove}
            removeGroup={handleRemoveGroup}
            selectedDate={selectedDate}
          />
        )}
      </div>

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
