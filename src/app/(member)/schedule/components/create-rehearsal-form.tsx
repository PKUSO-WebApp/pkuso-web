"use client";

import React from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { Toggle } from "@/components/ui/Toggle";
import { MapPicker } from "@/app/admin/rehearsals/components/map-picker";

export type DbRehearsalType = "full" | "section";

/** 允许半径下限（米） */
export const MIN_CHECKIN_RADIUS_M = 10;
/** 允许半径上限（米）＝ 地球半径 */
export const MAX_CHECKIN_RADIUS_M = 6_371_000;

export type CreateFormState = {
  type: DbRehearsalType;
  targetSection: string;
  startTime: Date | null;
  endTime: Date | null;
  location: string;
  repertoire: string;
  /** 是否启用地理围栏；关闭时三字段一律以 NULL 提交（不限位置） */
  geofenceEnabled: boolean;
  /** 签到点纬度（GCJ-02）；null = 未设置 */
  checkinLat: number | null;
  /** 签到点经度（GCJ-02）；null = 未设置 */
  checkinLng: number | null;
  /** 允许半径（米），字符串承载输入框原始值 */
  checkinRadiusM: string;
};

type Props = {
  form: CreateFormState;
  submitting: boolean;
  editing?: boolean;
  notifyByEmail: boolean;
  onNotifyByEmailChange: (v: boolean) => void;
  onChange: (
    field: keyof CreateFormState,
    value: string | number | boolean | DbRehearsalType | Date | null,
  ) => void;
  onCheckinPick: (lat: number | null, lng: number | null) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
};

/**
 * 发布/编辑排练日程表单（Modal→页面改造）
 *
 * 仅渲染表单本身（不含 Modal 外壳），供创建弹窗与管理端「发布新日程」页面复用。
 */
export function CreateRehearsalForm({
  form,
  submitting,
  editing = false,
  notifyByEmail,
  onNotifyByEmailChange,
  onChange,
  onCheckinPick,
  onSubmit,
  onCancel,
}: Props) {
  const isSection = form.type === "section";

  return (
    <form onSubmit={onSubmit} noValidate>
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
            placeholderText="选择结束时间"
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

        <label className="flex cursor-pointer items-center gap-2 text-xs text-text">
          <input
            type="checkbox"
            checked={form.geofenceEnabled}
            onChange={(e) => onChange("geofenceEnabled", e.target.checked)}
            disabled={submitting}
            className="h-4 w-4 rounded border-border text-primary focus:ring-text-muted"
          />
          开启地理围栏（成员签到时需位于签到点允许半径内）
        </label>

        {form.geofenceEnabled && (
          <>
            <div className="space-y-1">
              <label className="block text-label font-medium text-text-muted">
                签到点（搜索或点击地图选点）
              </label>
              <MapPicker
                lat={form.checkinLat}
                lng={form.checkinLng}
                disabled={submitting}
                onPick={onCheckinPick}
              />
            </div>

            <div className="space-y-1">
              <label className="block text-label font-medium text-text-muted">
                允许半径（米，最大不超过地球半径）
              </label>
              <input
                type="number"
                step="any"
                min={MIN_CHECKIN_RADIUS_M}
                max={MAX_CHECKIN_RADIUS_M}
                value={form.checkinRadiusM}
                disabled={submitting}
                onChange={(e) => onChange("checkinRadiusM", e.target.value)}
                placeholder="如：200"
                className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
              />
            </div>
          </>
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
          onClick={onCancel}
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
  );
}
