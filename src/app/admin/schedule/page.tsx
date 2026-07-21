"use client";

import React from "react";
import { Expand, Minimize2 } from "lucide-react";
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

function generateWeeklyDates(
  startDate: string,
  endDate: string,
): { dates: Date[]; error: string | null } {
  // 验证输入
  if (!startDate || !endDate) {
    return { dates: [], error: "请选择开始日期和结束日期" };
  }

  const dates: Date[] = [];
  const start = parseLocalISO(startDate + "T00:00:00");
  const end = parseLocalISO(endDate + "T00:00:00");

  // 验证日期有效性
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return { dates: [], error: "日期格式无效" };
  }

  // 验证日期范围
  if (start > end) {
    return { dates: [], error: "开始日期必须早于或等于结束日期" };
  }

  // 每隔7天生成一个日期
  const current = new Date(start);
  while (current <= end) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 7);
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
  // 甘特图放大状态
  const [isGanttExpanded, setIsGanttExpanded] = React.useState(false);

  const currentYear = new Date().getFullYear();
  const [form, setForm] = React.useState<CreateScheduleFormState>({
    title: "",
    date: getLocalDateString(),
    startTime: "",
    endTime: "",
    repeatMode: "single",
    weeklyStartDate: "",
    weeklyEndDate: "",
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
          const result = generateWeeklyDates(form.weeklyStartDate, form.weeklyEndDate);
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
        // 计算星期几（getDay(): 0=周日，1=周一...）
        const startDate = parseLocalISO(form.weeklyStartDate + "T00:00:00");
        Object.assign(groupData, {
          weekly_start_date: form.weeklyStartDate,
          weekly_end_date: form.weeklyEndDate,
          weekly_day: startDate.getDay(),
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
        weeklyStartDate: "",
        weeklyEndDate: "",
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
      weeklyStartDate: "",
      weeklyEndDate: "",
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
      {/* 正常模式：显示标题、日期选择器、添加预约按钮 */}
      {!isGanttExpanded && (
        <>
          <div className="mt-4 mb-4">
            <h1 className="text-lg font-semibold text-text">日程管理</h1>
            <p className="text-sm text-text-muted">管理排练房预约（管理员）</p>
          </div>

          <div className="mb-4">
            <DateSelector selectedDate={selectedDate} onDateChange={setSelectedDate} />
          </div>
        </>
      )}

      {/* 甘特图标题栏：放大/缩小按钮 */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-medium text-text">
          {isGanttExpanded
            ? formatDisplayDate(selectedDate) + " 预约"
            : formatDisplayDate(selectedDate)}
        </h2>
        <div className="flex gap-2">
          <button
            onClick={() => setIsGanttExpanded(!isGanttExpanded)}
            className="rounded-full bg-muted px-3 py-2 text-sm font-medium text-text-muted hover:bg-border transition-colors"
            title={isGanttExpanded ? "缩小" : "放大"}
          >
            {isGanttExpanded ? <Minimize2 className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
          </button>
          {!isGanttExpanded && (
            <button
              onClick={() => setIsModalOpen(true)}
              className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90"
            >
              添加预约
            </button>
          )}
        </div>
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
