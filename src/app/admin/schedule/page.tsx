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
import { Modal } from "@/components/ui/Modal";
import { getLocalDateString, parseLocalISO, formatDisplayDate } from "@/lib/date-utils";

// 根据年份、月份、周数和星期几获取目标日期
// 返回 { date: Date | null, maxWeek: number, lastDayOfMaxWeek: Date }
// maxWeek 表示该月最大有效周数，lastDayOfMaxWeek 表示最后一周的最后一天
const getDateOfWeekInMonth = (
  year: number,
  month: number,
  weekNumber: number,
  dayOfWeek: number,
): { date: Date | null; maxWeek: number; lastDayOfMaxWeek: Date } => {
  const firstDay = new Date(year, month - 1, 1).getDay();
  // 计算该月第一个目标星期几的日期
  // firstDay: 月份第一天的星期（0=周日）
  // dayOfWeek: 目标星期（0=周日，1=周一，...，6=周六）
  const firstTargetOffset = (dayOfWeek - firstDay + 7) % 7;
  const firstTargetDate = new Date(year, month - 1, 1 + firstTargetOffset);

  // 如果第一个目标日期超出本月，则需要从下周开始
  if (firstTargetDate.getMonth() !== month - 1) {
    firstTargetDate.setDate(firstTargetDate.getDate() + 7);
  }

  // 计算该月最大有效周数
  let maxWeek = 1;
  const testDate = new Date(firstTargetDate);
  while (testDate.getMonth() === month - 1) {
    maxWeek++;
    testDate.setDate(testDate.getDate() + 7);
  }
  maxWeek--;

  // 计算最后一周最后一天的日期（周六）
  const lastDayOfMaxWeek = new Date(firstTargetDate);
  lastDayOfMaxWeek.setDate(
    firstTargetDate.getDate() + (maxWeek - 1) * 7 + ((6 - dayOfWeek + 7) % 7),
  );

  // 计算第N周的目标日期
  const targetDate = new Date(firstTargetDate);
  targetDate.setDate(firstTargetDate.getDate() + (weekNumber - 1) * 7);

  // 验证结果是否在本月内
  if (targetDate.getMonth() !== month - 1) {
    return { date: null, maxWeek, lastDayOfMaxWeek };
  }

  return { date: targetDate, maxWeek, lastDayOfMaxWeek };
};

function generateWeeklyDates(
  startYear: number,
  startMonth: number,
  startWeek: number,
  endYear: number,
  endMonth: number,
  endWeek: number,
  dayOfWeek: number,
): { dates: Date[]; error: string | null } {
  const dates: Date[] = [];

  const WEEK_DAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const dayLabel = WEEK_DAYS[dayOfWeek];

  // 计算开始日期
  const startResult = getDateOfWeekInMonth(startYear, startMonth, startWeek, dayOfWeek);
  if (!startResult.date) {
    const { maxWeek, lastDayOfMaxWeek } = startResult;
    // 计算下个月第一个有效周的目标日期
    const nextMonth = startMonth === 12 ? 1 : startMonth + 1;
    const nextYear = startMonth === 12 ? startYear + 1 : startYear;
    const nextMonthFirstWeekResult = getDateOfWeekInMonth(nextYear, nextMonth, 1, dayOfWeek);
    const nextMonthTargetDate = nextMonthFirstWeekResult.date;

    let errorMsg = `${startYear}年${startMonth}月第${startWeek}周不存在`;
    if (maxWeek > 0) {
      const lastDayName = WEEK_DAYS[lastDayOfMaxWeek.getDay()];
      errorMsg += `，该月第${maxWeek}周只到${lastDayName}`;
    }
    if (nextMonthTargetDate) {
      errorMsg += `，你可能想选${nextYear}年${nextMonth}月第1周${dayLabel}？`;
    }
    return { dates: [], error: errorMsg };
  }

  // 计算结束日期
  const endResult = getDateOfWeekInMonth(endYear, endMonth, endWeek, dayOfWeek);
  if (!endResult.date) {
    const { maxWeek, lastDayOfMaxWeek } = endResult;
    // 计算下个月第一个有效周的目标日期
    const nextMonth = endMonth === 12 ? 1 : endMonth + 1;
    const nextYear = endMonth === 12 ? endYear + 1 : endYear;
    const nextMonthFirstWeekResult = getDateOfWeekInMonth(nextYear, nextMonth, 1, dayOfWeek);
    const nextMonthTargetDate = nextMonthFirstWeekResult.date;

    let errorMsg = `${endYear}年${endMonth}月第${endWeek}周不存在`;
    if (maxWeek > 0) {
      const lastDayName = WEEK_DAYS[lastDayOfMaxWeek.getDay()];
      errorMsg += `，该月第${maxWeek}周只到${lastDayName}`;
    }
    if (nextMonthTargetDate) {
      errorMsg += `，你可能想选${nextYear}年${nextMonth}月第1周${dayLabel}？`;
    }
    return { dates: [], error: errorMsg };
  }

  if (startResult.date > endResult.date) {
    return { dates: [], error: "日期范围无效，请调整开始和结束周" };
  }

  const currentDate = new Date(startResult.date);
  while (currentDate <= endResult.date) {
    dates.push(new Date(currentDate));
    currentDate.setDate(currentDate.getDate() + 7);
  }

  return { dates, error: null };
}

function generateMonthlyDates(
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number,
  dayOfMonth: number,
): { dates: Date[]; error: string | null; skippedMonths: string[] } {
  const dates: Date[] = [];
  const skippedMonths: string[] = [];

  // 支持跨年生成日期
  for (let year = startYear; year <= endYear; year++) {
    const monthStart = year === startYear ? startMonth : 1;
    const monthEnd = year === endYear ? endMonth : 12;

    for (let month = monthStart; month <= monthEnd; month++) {
      const date = new Date(year, month - 1, dayOfMonth);
      if (date.getMonth() === month - 1) {
        dates.push(date);
      } else {
        skippedMonths.push(`${year}年${month}月`);
      }
    }
  }

  if (skippedMonths.length > 0 && dates.length === 0) {
    return {
      dates: [],
      error: `${skippedMonths.join("、")}没有${dayOfMonth}日，请选择其他日期`,
      skippedMonths,
    };
  }

  if (skippedMonths.length > 0) {
    return {
      dates,
      error: `${skippedMonths.join("、")}没有${dayOfMonth}日，已跳过这些月份`,
      skippedMonths,
    };
  }

  return { dates, error: null, skippedMonths: [] };
}

// 待提交数据类型定义
type PendingSubmitData = {
  dates: Date[];
  groupId: string | null;
  dateError: string | null;
};

export default function AdminSchedulePage() {
  const { data: schedules, loading, fetch, checkConflict, remove } = useSchedule();
  const { user } = useUser();
  const [selectedDate, setSelectedDate] = React.useState<string>(getLocalDateString());
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = React.useState(false);
  const [confirmMessage, setConfirmMessage] = React.useState("");
  // 保存待提交的数据，用于确认后提交，避免重复生成
  const [pendingData, setPendingData] = React.useState<PendingSubmitData | null>(null);

  const currentYear = new Date().getFullYear();
  const [form, setForm] = React.useState<CreateScheduleFormState>({
    title: "",
    date: getLocalDateString(),
    startTime: "",
    endTime: "",
    repeatMode: "single",
    weeklyDay: 1,
    weeklyStartYear: currentYear,
    weeklyStartMonth: new Date().getMonth() + 1,
    weeklyStartWeek: 1,
    weeklyEndYear: currentYear,
    weeklyEndMonth: new Date().getMonth() + 1,
    weeklyEndWeek: 1,
    monthlyDay: 1,
    monthlyStartYear: currentYear,
    monthlyStartMonth: new Date().getMonth() + 1,
    monthlyEndYear: currentYear,
    monthlyEndMonth: new Date().getMonth() + 1,
  });

  React.useEffect(() => {
    void fetch(selectedDate);
  }, [selectedDate, fetch]);

  const filteredSchedules = schedules.filter((schedule) => {
    const date = parseLocalISO(schedule.start_time);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      if (!form.title.trim()) {
        setFormError("请填写预约标题");
        return;
      }

      if (!form.startTime || !form.endTime) {
        setFormError("请填写开始时间和结束时间");
        return;
      }

      if (form.endTime <= form.startTime) {
        setFormError("结束时间必须晚于开始时间");
        return;
      }

      const groupId = form.repeatMode !== "single" ? crypto.randomUUID() : null;
      let dates: Date[] = [];
      let dateError: string | null = null;
      let skippedMonths: string[] = [];

      switch (form.repeatMode) {
        case "single":
          dates = [parseLocalISO(form.date + "T00:00:00")];
          break;
        case "weekly": {
          const result = generateWeeklyDates(
            form.weeklyStartYear,
            form.weeklyStartMonth,
            form.weeklyStartWeek,
            form.weeklyEndYear,
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
            form.monthlyStartYear,
            form.monthlyStartMonth,
            form.monthlyEndYear,
            form.monthlyEndMonth,
            form.monthlyDay,
          );
          dates = result.dates;
          dateError = result.error;
          skippedMonths = result.skippedMonths;
          break;
        }
      }

      if (dates.length === 0) {
        setFormError(dateError || "未生成任何预约日期");
        return;
      }

      // 保存待提交的数据到状态中，用于确认后提交
      const newPendingData = { dates, groupId, dateError };
      setPendingData(newPendingData);

      // 月重复有跳过月份时，弹出确认窗口
      if (skippedMonths.length > 0) {
        setConfirmMessage(
          `${skippedMonths.join("、")}没有${form.monthlyDay}日，将跳过这些月份继续创建预约。是否继续？`,
        );
        setIsConfirmModalOpen(true);
        setIsSubmitting(false);
        return;
      }

      // 直接提交
      await executeSubmit(newPendingData);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 执行预约创建的实际逻辑
  const executeSubmit = async (pendingData: {
    dates: Date[];
    groupId: string | null;
    dateError: string | null;
  }) => {
    const { dates, groupId, dateError } = pendingData;
    const today = new Date();
    const todayStr = getLocalDateString(today);

    for (const date of dates) {
      const dateStr = getLocalDateString(date);
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

    // 创建重复预约时先插入 schedule_groups 表
    if (groupId) {
      const groupData: Record<string, unknown> = {
        id: groupId,
        title: form.title,
        author_id: user?.id ?? null,
        repeat_mode: form.repeatMode,
      };

      if (form.repeatMode === "weekly") {
        Object.assign(groupData, {
          weekly_start_year: form.weeklyStartYear,
          weekly_start_month: form.weeklyStartMonth,
          weekly_start_week: form.weeklyStartWeek,
          weekly_end_year: form.weeklyEndYear,
          weekly_end_month: form.weeklyEndMonth,
          weekly_end_week: form.weeklyEndWeek,
          weekly_day: form.weeklyDay,
        });
      } else if (form.repeatMode === "monthly") {
        Object.assign(groupData, {
          monthly_start_year: form.monthlyStartYear,
          monthly_start_month: form.monthlyStartMonth,
          monthly_end_year: form.monthlyEndYear,
          monthly_end_month: form.monthlyEndMonth,
          monthly_day: form.monthlyDay,
        });
      }

      const { error: groupError } = await supabase.from("schedule_groups").insert([groupData]);
      if (groupError) {
        setFormError("创建预约组失败，请重试");
        return;
      }
    }

    const payloads = dates.map((date) => {
      const dateStr = getLocalDateString(date);
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
      // 回滚：删除已创建的 group
      if (groupId) {
        await supabase.from("schedule_groups").delete().eq("id", groupId);
      }
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
        weeklyStartYear: currentYear,
        weeklyStartMonth: new Date().getMonth() + 1,
        weeklyStartWeek: 1,
        weeklyEndYear: currentYear,
        weeklyEndMonth: new Date().getMonth() + 1,
        weeklyEndWeek: 1,
        monthlyDay: 1,
        monthlyStartYear: currentYear,
        monthlyStartMonth: new Date().getMonth() + 1,
        monthlyEndYear: currentYear,
        monthlyEndMonth: new Date().getMonth() + 1,
      });
      setFormError(null);
    }
  };

  // 确认跳过月份后继续提交
  const handleConfirmSkip = async () => {
    setIsConfirmModalOpen(false);
    setIsSubmitting(true);
    try {
      // 直接使用保存的待提交数据，避免重复生成
      if (!pendingData) return;
      await executeSubmit(pendingData);
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
      weeklyStartYear: currentYear,
      weeklyStartMonth: new Date().getMonth() + 1,
      weeklyStartWeek: 1,
      weeklyEndYear: currentYear,
      weeklyEndMonth: new Date().getMonth() + 1,
      weeklyEndWeek: 1,
      monthlyDay: 1,
      monthlyStartYear: currentYear,
      monthlyStartMonth: new Date().getMonth() + 1,
      monthlyEndYear: currentYear,
      monthlyEndMonth: new Date().getMonth() + 1,
    });
    setFormError(null);
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

      <Modal
        open={isConfirmModalOpen}
        onClose={() => setIsConfirmModalOpen(false)}
        title="确认创建"
      >
        <div className="space-y-3 text-xs">
          <div className="text-text">{confirmMessage}</div>
          <div className="flex gap-2">
            <button
              onClick={() => setIsConfirmModalOpen(false)}
              className="flex-1 py-2 text-sm font-medium text-text-muted bg-muted rounded-lg hover:bg-border transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleConfirmSkip}
              disabled={isSubmitting}
              className="flex-1 py-2 text-sm font-medium text-danger bg-danger/20 rounded-lg hover:bg-danger/30 transition-colors disabled:opacity-50"
            >
              {isSubmitting ? "创建中..." : "确认创建"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
