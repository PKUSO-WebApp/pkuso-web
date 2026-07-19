"use client";

import React from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { Modal } from "@/components/ui/Modal";
import { Toggle } from "@/components/ui/Toggle";

type DbRehearsalType = "full" | "section";

export type CreateFormState = {
  type: DbRehearsalType;
  targetSection: string;
  startTime: Date | null;
  endTime: Date | null;
  location: string;
  repertoire: string;
  signInCode: string;
};

type Props = {
  open: boolean;
  editing: boolean;
  form: CreateFormState;
  submitting: boolean;
  notifyByEmail: boolean;
  onNotifyByEmailChange: (v: boolean) => void;
  onChange: (field: keyof CreateFormState, value: string | DbRehearsalType | Date | null) => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
};

export function CreateRehearsalModal({
  open,
  editing,
  form,
  submitting,
  notifyByEmail,
  onNotifyByEmailChange,
  onChange,
  onClose,
  onSubmit,
}: Props) {
  const isSection = form.type === "section";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "编辑排练日程" : "发布排练日程"}
      closeOnOverlay={!submitting}
    >
      <form onSubmit={onSubmit}>
        <div className="space-y-3 text-xs">
          <div className="space-y-1">
            <label className="block text-label font-medium text-text-muted">排练类型</label>
            <Toggle
              options={["full", "section"] as const}
              value={form.type}
              onChange={(v) => onChange("type", v)}
              getLabel={(k) => ({ full: "合排", section: "分排" })[k]}
            />
          </div>

          {isSection && (
            <div className="space-y-1">
              <label className="block text-label font-medium text-text-muted">针对声部</label>
              <input
                type="text"
                value={form.targetSection}
                onChange={(e) => onChange("targetSection", e.target.value)}
                className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
                placeholder="如：第一小提琴 / 木管分排"
              />
            </div>
          )}

          <div className="space-y-1">
            <label className="block text-label font-medium text-text-muted">开始时间</label>
            <DatePicker
              selected={form.startTime}
              onChange={(date: Date | null) => onChange("startTime", date)}
              showTimeSelect
              timeIntervals={15}
              dateFormat="yyyy-MM-dd HH:mm"
              placeholderText="选择开始时间"
              className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
              popperClassName="react-datepicker-popper-orchestra"
              calendarClassName="react-datepicker-orchestra"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-label font-medium text-text-muted">结束时间</label>
            <DatePicker
              selected={form.endTime}
              onChange={(date: Date | null) => onChange("endTime", date)}
              showTimeSelect
              timeIntervals={15}
              dateFormat="yyyy-MM-dd HH:mm"
              placeholderText="选择结束时间（可选）"
              className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
              popperClassName="react-datepicker-popper-orchestra"
              calendarClassName="react-datepicker-orchestra"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-label font-medium text-text-muted">排练地点</label>
            <input
              type="text"
              value={form.location}
              onChange={(e) => onChange("location", e.target.value)}
              className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
              placeholder="如：新太阳b108"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-label font-medium text-text-muted">排练曲目</label>
            <textarea
              value={form.repertoire}
              onChange={(e) => onChange("repertoire", e.target.value)}
              className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
              rows={2}
              placeholder="如：柴四第四乐章"
            />
          </div>

          {form.type === "full" && (
            <div className="space-y-1">
              <label className="block text-label font-medium text-text-muted">
                签到密码（4 位数字）
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                value={form.signInCode}
                onChange={(e) => onChange("signInCode", e.target.value)}
                className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
                placeholder="如：8848"
              />
            </div>
          )}

          <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-text">
            <input
              type="checkbox"
              checked={notifyByEmail}
              onChange={(e) => onNotifyByEmailChange(e.target.checked)}
              disabled={submitting}
              className="h-4 w-4 rounded border-border text-primary focus:ring-text-muted"
            />
            同时发送邮件通知全团
          </label>
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
            {submitting ? (editing ? "保存中…" : "发布中…") : editing ? "保存" : "发布"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
