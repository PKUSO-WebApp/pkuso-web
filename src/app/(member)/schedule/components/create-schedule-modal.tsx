"use client";

import React from "react";
import { Modal } from "@/components/ui/Modal";

export type CreateScheduleFormState = {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
};

type Props = {
  open: boolean;
  form: CreateScheduleFormState;
  submitting: boolean;
  error: string | null;
  onChange: (field: keyof CreateScheduleFormState, value: string) => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
};

// 生成半小时间隔的时间选项
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

export function CreateScheduleModal({
  open,
  form,
  submitting,
  error,
  onChange,
  onClose,
  onSubmit,
}: Props) {
  // 日期范围（使用 useMemo 缓存，避免每次渲染重新计算）
  const dateRange = React.useMemo(() => {
    const today = new Date();
    // 使用本地日期方法，避免 toISOString() 的时区转换
    const formatDate = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };
    const minDate = formatDate(today);
    const maxDate = formatDate(new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000));
    return { min: minDate, max: maxDate };
  }, []);

  return (
    <Modal open={open} onClose={onClose} title="添加预约" closeOnOverlay={!submitting}>
      <form onSubmit={onSubmit}>
        <div className="space-y-3 text-xs">
          {/* 预约标题 */}
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

          {/* 预约日期 */}
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
            />
          </div>

          {/* 开始时间 */}
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

          {/* 结束时间 */}
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

          {/* 错误提示 */}
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
