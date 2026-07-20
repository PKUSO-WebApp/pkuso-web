"use client";

import React from "react";
import { Modal } from "@/components/ui/Modal";

export type CreateScheduleFormState = {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  repeatMode: "single" | "weekly" | "monthly";
  weeklyDay: number;
  weeklyStartMonth: number;
  weeklyStartWeek: number;
  weeklyEndMonth: number;
  weeklyEndWeek: number;
  monthlyDay: number;
  monthlyStartMonth: number;
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

const WEEK_DAYS = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 0, label: "周日" },
];

const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: i + 1,
  label: `${i + 1}月`,
}));

const WEEKS = Array.from({ length: 5 }, (_, i) => ({
  value: i + 1,
  label: `第${i + 1}周`,
}));

const DAYS_IN_MONTH = Array.from({ length: 31 }, (_, i) => ({
  value: i + 1,
  label: `${i + 1}日`,
}));

export function CreateScheduleModal({
  open,
  form,
  submitting,
  error,
  onChange,
  onClose,
  onSubmit,
}: Props) {
  const formatDate = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const today = new Date();
  const dateRange = {
    min: formatDate(today),
    max: formatDate(new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000)),
  };

  const renderRepeatSettings = () => {
    switch (form.repeatMode) {
      case "weekly":
        return (
          <div className="space-y-3">
            <div className="text-xs text-text-muted mb-2">周重复设置</div>
            <div className="space-y-2">
              <div className="space-y-1">
                <label className="block text-label font-medium text-text-muted">星期几</label>
                <select
                  value={form.weeklyDay}
                  onChange={(e) => onChange("weeklyDay", Number(e.target.value))}
                  className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
                  required
                >
                  <option value="">请选择</option>
                  {WEEK_DAYS.map((day) => (
                    <option key={day.value} value={day.value}>
                      {day.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="block text-label font-medium text-text-muted">开始月份</label>
                  <select
                    value={form.weeklyStartMonth}
                    onChange={(e) => onChange("weeklyStartMonth", Number(e.target.value))}
                    className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
                    required
                  >
                    {MONTHS.filter((m) => m.value >= today.getMonth() + 1).map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="block text-label font-medium text-text-muted">开始周</label>
                  <select
                    value={form.weeklyStartWeek}
                    onChange={(e) => onChange("weeklyStartWeek", Number(e.target.value))}
                    className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
                    required
                  >
                    {WEEKS.map((w) => (
                      <option key={w.value} value={w.value}>
                        {w.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="block text-label font-medium text-text-muted">结束月份</label>
                  <select
                    value={form.weeklyEndMonth}
                    onChange={(e) => onChange("weeklyEndMonth", Number(e.target.value))}
                    className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
                    required
                  >
                    {MONTHS.filter((m) => m.value >= form.weeklyStartMonth).map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="block text-label font-medium text-text-muted">结束周</label>
                  <select
                    value={form.weeklyEndWeek}
                    onChange={(e) => onChange("weeklyEndWeek", Number(e.target.value))}
                    className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
                    required
                  >
                    {WEEKS.map((w) => (
                      <option key={w.value} value={w.value}>
                        {w.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
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
                  onChange={(e) => onChange("monthlyDay", Number(e.target.value))}
                  className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
                  required
                >
                  <option value="">请选择</option>
                  {DAYS_IN_MONTH.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="block text-label font-medium text-text-muted">开始月份</label>
                  <select
                    value={form.monthlyStartMonth}
                    onChange={(e) => onChange("monthlyStartMonth", Number(e.target.value))}
                    className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
                    required
                  >
                    {MONTHS.filter((m) => m.value >= today.getMonth() + 1).map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="block text-label font-medium text-text-muted">结束月份</label>
                  <select
                    value={form.monthlyEndMonth}
                    onChange={(e) => onChange("monthlyEndMonth", Number(e.target.value))}
                    className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
                    required
                  >
                    {MONTHS.filter((m) => m.value >= form.monthlyStartMonth).map((m) => (
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
              onChange={(e) => onChange("title", e.target.value)}
              className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
              placeholder="如：排练房A预约"
              required
            />
          </div>

          <div className="space-y-1">
            <label className="block text-label font-medium text-text-muted">预约日期</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => onChange("date", e.target.value)}
              className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
              min={dateRange.min}
              max={dateRange.max}
              required
              disabled={form.repeatMode !== "single"}
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
                  onClick={() => onChange("repeatMode", mode.value)}
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

          {renderRepeatSettings()}

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="block text-label font-medium text-text-muted">开始时间</label>
              <select
                value={form.startTime}
                onChange={(e) => onChange("startTime", e.target.value)}
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
                onChange={(e) => onChange("endTime", e.target.value)}
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
