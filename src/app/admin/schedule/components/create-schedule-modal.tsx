"use client";

import React from "react";
import { Modal } from "@/components/ui/Modal";
import { getLocalDateString } from "@/lib/date-utils";

export type CreateScheduleFormState = {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  repeatMode: "single" | "weekly" | "monthly";
  // 周重复（新模式：使用开始/结束日期）
  weeklyStartDate: string;
  weeklyEndDate: string;
  // 月重复（保持不变）
  monthlyDay: number;
  monthlyStartYear: number;
  monthlyStartMonth: number;
  monthlyEndYear: number;
  monthlyEndMonth: number;
};

type Props = {
  open: boolean;
  form: CreateScheduleFormState;
  submitting: boolean;
  error: string | null;
  onChange: <K extends keyof CreateScheduleFormState>(
    field: K,
    value: CreateScheduleFormState[K],
  ) => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
};

const generateTimeOptions = () => {
  const options: string[] = [];
  for (let hour = 0; hour < 24; hour++) {
    for (let minute = 0; minute < 60; minute += 30) {
      const h = String(hour).padStart(2, "0");
      const m = String(minute).padStart(2, "0");
      options.push(`${h}:${m}`);
    }
  }
  return options;
};

const TIME_OPTIONS = generateTimeOptions();

const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: i + 1,
  label: `${i + 1}月`,
}));

// 生成日期选项（用于月重复设置，显示1-31日）
// 提交时由 generateMonthlyDates 验证每个月是否有该日期
const generateMaxDayOptions = () => {
  return Array.from({ length: 31 }, (_, i) => ({
    value: i + 1,
    label: `${i + 1}日`,
  }));
};

// 生成年份选项（当前年份到当前年份+5）
const generateYearOptions = () => {
  const currentYear = new Date().getFullYear();
  return Array.from({ length: 6 }, (_, i) => ({
    value: currentYear + i,
    label: `${currentYear + i}年`,
  }));
};

const YEAR_OPTIONS = generateYearOptions();

export function CreateScheduleModal({
  open,
  form,
  submitting,
  error,
  onChange,
  onClose,
  onSubmit,
}: Props) {
  // 处理表单字段联动，当年份或月份变化时自动重置相关字段
  const handleChange = <K extends keyof CreateScheduleFormState>(
    field: K,
    value: CreateScheduleFormState[K],
  ) => {
    onChange(field, value);

    // 月重复设置联动
    if (field === "monthlyStartYear" || field === "monthlyStartMonth") {
      onChange("monthlyDay", 1);
    }
  };

  const today = new Date();
  const dateRange = {
    min: getLocalDateString(today),
    max: getLocalDateString(new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000)),
  };

  const renderRepeatSettings = () => {
    switch (form.repeatMode) {
      case "weekly":
        return (
          <div className="space-y-3">
            <div className="text-xs text-text-muted mb-2">周重复设置（每隔7天）</div>
            <div className="space-y-2">
              <div className="space-y-1">
                <label className="block text-label font-medium text-text-muted">开始日期</label>
                <input
                  type="date"
                  value={form.weeklyStartDate}
                  onChange={(e) => handleChange("weeklyStartDate", e.target.value)}
                  className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
                  min={dateRange.min}
                  max={dateRange.max}
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="block text-label font-medium text-text-muted">结束日期</label>
                <input
                  type="date"
                  value={form.weeklyEndDate}
                  onChange={(e) => handleChange("weeklyEndDate", e.target.value)}
                  className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
                  min={form.weeklyStartDate || dateRange.min}
                  max={dateRange.max}
                  required
                />
              </div>
              {form.weeklyStartDate && (
                <div className="text-xs text-text-muted">
                  系统将从开始日期开始，每隔7天生成一个预约，直到结束日期
                </div>
              )}
            </div>
          </div>
        );
      case "monthly":
        return (
          <div className="space-y-3">
            <div className="text-xs text-text-muted mb-2">月重复设置</div>
            <div className="space-y-2">
              <div className="space-y-1">
                <label className="block text-label font-medium text-text-muted">每月几号</label>
                <select
                  value={form.monthlyDay}
                  onChange={(e) => handleChange("monthlyDay", Number(e.target.value))}
                  className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
                  required
                >
                  <option value="">请选择</option>
                  {generateMaxDayOptions().map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="block text-label font-medium text-text-muted">开始年份</label>
                  <select
                    value={form.monthlyStartYear}
                    onChange={(e) => handleChange("monthlyStartYear", Number(e.target.value))}
                    className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
                    required
                  >
                    {YEAR_OPTIONS.map((y) => (
                      <option key={y.value} value={y.value}>
                        {y.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="block text-label font-medium text-text-muted">开始月份</label>
                  <select
                    value={form.monthlyStartMonth}
                    onChange={(e) => handleChange("monthlyStartMonth", Number(e.target.value))}
                    className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
                    required
                  >
                    {MONTHS.filter((m) => {
                      const currentYear = today.getFullYear();
                      if (form.monthlyStartYear > currentYear) return true;
                      return m.value >= today.getMonth() + 1;
                    }).map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="block text-label font-medium text-text-muted">结束年份</label>
                  <select
                    value={form.monthlyEndYear}
                    onChange={(e) => handleChange("monthlyEndYear", Number(e.target.value))}
                    className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
                    required
                  >
                    {YEAR_OPTIONS.filter((y) => {
                      if (y.value > form.monthlyStartYear) return true;
                      if (y.value < form.monthlyStartYear) return false;
                      return y.value >= form.monthlyStartYear;
                    }).map((y) => (
                      <option key={y.value} value={y.value}>
                        {y.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="block text-label font-medium text-text-muted">结束月份</label>
                  <select
                    value={form.monthlyEndMonth}
                    onChange={(e) => handleChange("monthlyEndMonth", Number(e.target.value))}
                    className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
                    required
                  >
                    {MONTHS.filter((m) => {
                      if (form.monthlyEndYear > form.monthlyStartYear) return true;
                      if (form.monthlyEndYear < form.monthlyStartYear) return false;
                      return m.value >= form.monthlyStartMonth;
                    }).map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="添加预约" closeOnOverlay={!submitting}>
      <form onSubmit={onSubmit}>
        <div className="space-y-3 text-xs">
          <div className="space-y-1">
            <label className="block text-label font-medium text-text-muted">预约标题</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => handleChange("title", e.target.value)}
              className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
              placeholder="如：排练房A预约"
              required
            />
          </div>

          <div className="space-y-1">
            <label className="block text-label font-medium text-text-muted">重复模式</label>
            <div className="flex gap-2">
              {(
                [
                  { value: "single", label: "单次" },
                  { value: "weekly", label: "周重复" },
                  { value: "monthly", label: "月重复" },
                ] as const
              ).map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  onClick={() => handleChange("repeatMode", mode.value)}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                    form.repeatMode === mode.value
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-text-muted hover:text-text"
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          {form.repeatMode === "single" && (
            <div className="space-y-1">
              <label className="block text-label font-medium text-text-muted">预约日期</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => handleChange("date", e.target.value)}
                className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
                min={dateRange.min}
                max={dateRange.max}
                required
              />
            </div>
          )}

          {renderRepeatSettings()}

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="block text-label font-medium text-text-muted">开始时间</label>
              <select
                value={form.startTime}
                onChange={(e) => handleChange("startTime", e.target.value)}
                className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
                required
              >
                <option value="">请选择开始时间</option>
                {TIME_OPTIONS.map((time) => (
                  <option key={time} value={time}>
                    {time}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="block text-label font-medium text-text-muted">结束时间</label>
              <select
                value={form.endTime}
                onChange={(e) => handleChange("endTime", e.target.value)}
                className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
                required
              >
                <option value="">请选择结束时间</option>
                {TIME_OPTIONS.map((time) => (
                  <option key={time} value={time}>
                    {time}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error && (
            <div
              className="rounded-lg bg-danger-bg px-3 py-2 text-danger"
              style={{ fontSize: "var(--text-caption)" }}
            >
              {error}
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2 text-xs">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-full px-4 py-1.5 text-label text-text-muted hover:bg-muted"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-full bg-primary px-4 py-1.5 text-label font-medium text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-60"
          >
            {submitting ? "添加中…" : "确定"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
