"use client";

import React from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { Toggle } from "@/components/ui/Toggle";
import { MapPicker } from "@/app/admin/rehearsals/components/map-picker";
import type { SheetMusicOption } from "@/hooks/useSheetMusicOptions";
import { SectionSelect } from "./section-select";

export type DbRehearsalType = "full" | "section";

export const MIN_CHECKIN_RADIUS_M = 10;
export const MAX_CHECKIN_RADIUS_M = 6_371_000;

/** 排练曲目：有谱（sheetMusicId 非空）或无谱自由文本 */
export type RepertoirePiece = {
  /** 编辑已有行时带上，创建时为空 */
  id?: string;
  sheetMusicId: string | null;
  title: string;
};

export type CreateFormState = {
  type: DbRehearsalType;
  targetSections: string[];
  startTime: Date | null;
  endTime: Date | null;
  location: string;
  pieces: RepertoirePiece[];
  geofenceEnabled: boolean;
  checkinLat: number | null;
  checkinLng: number | null;
  checkinRadiusM: string;
};

type Props = {
  form: CreateFormState;
  submitting: boolean;
  editing?: boolean;
  sheetMusicOptions: SheetMusicOption[];
  notifyByEmail: boolean;
  onNotifyByEmailChange: (v: boolean) => void;
  onChange: (
    field: keyof CreateFormState,
    value: string | number | boolean | DbRehearsalType | Date | null | string[] | RepertoirePiece[],
  ) => void;
  onCheckinPick: (lat: number | null, lng: number | null) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
};

export function CreateRehearsalForm({
  form,
  submitting,
  editing = false,
  sheetMusicOptions,
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

        {isSection && (
          <div className="space-y-1">
            <label className="block text-label font-medium text-text-muted">针对声部</label>
            <SectionSelect
              value={form.targetSections}
              onChange={(v) => onChange("targetSections", v)}
              placeholder="输入声部名或声部组名"
              disabled={submitting}
            />
          </div>
        )}

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
          <RepertoireEditor
            pieces={form.pieces}
            options={sheetMusicOptions}
            disabled={submitting}
            onChange={(pieces) => onChange("pieces", pieces)}
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
          {editing ? "重新发送邮件通知" : "向在团成员发送邮件通知"}
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

function RepertoireEditor({
  pieces,
  options,
  disabled,
  onChange,
}: {
  pieces: RepertoirePiece[];
  options: SheetMusicOption[];
  disabled: boolean;
  onChange: (pieces: RepertoirePiece[]) => void;
}) {
  const [selectedScoreId, setSelectedScoreId] = React.useState("");
  const [freeTitle, setFreeTitle] = React.useState("");

  const addScore = () => {
    const option = options.find((o) => o.id === selectedScoreId);
    if (!option) return;
    if (pieces.some((p) => p.sheetMusicId === option.id)) {
      setSelectedScoreId("");
      return;
    }
    if (pieces.some((p) => p.title === option.title)) {
      alert("同一场排练已有同名曲目");
      return;
    }
    onChange([...pieces, { sheetMusicId: option.id, title: option.title }]);
    setSelectedScoreId("");
  };

  const addFree = () => {
    const title = freeTitle.trim();
    if (!title) return;
    if (pieces.some((p) => p.title === title)) {
      alert("同一场排练已有同名曲目");
      return;
    }
    onChange([...pieces, { sheetMusicId: null, title }]);
    setFreeTitle("");
  };

  return (
    <div className="space-y-2">
      {pieces.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-3 py-3 text-center text-caption text-text-muted">
          尚未添加曲目
        </p>
      ) : (
        <ul className="space-y-1">
          {pieces.map((piece, index) => (
            <li
              key={`${piece.id ?? "new"}-${piece.sheetMusicId ?? "free"}-${index}`}
              className="flex items-center gap-2 rounded-xl border border-border bg-muted px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-xs text-text">{piece.title}</span>
              <span className="shrink-0 rounded-full bg-surface px-1.5 py-0.5 text-caption text-text-muted">
                {piece.sheetMusicId ? "有谱" : "无谱"}
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(pieces.filter((_, i) => i !== index))}
                className="shrink-0 rounded-full px-2 py-0.5 text-caption text-danger hover:bg-danger-bg disabled:opacity-50"
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <select
          value={selectedScoreId}
          onChange={(e) => setSelectedScoreId(e.target.value)}
          disabled={disabled || options.length === 0}
          className="min-w-0 flex-1 rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted disabled:opacity-60"
        >
          <option value="">{options.length === 0 ? "谱务库暂无曲目" : "从谱务库选择曲目"}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={disabled || !selectedScoreId}
          onClick={addScore}
          className="shrink-0 rounded-full border border-border bg-surface px-3 py-1.5 text-caption text-text hover:bg-muted disabled:opacity-50"
        >
          添加
        </button>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={freeTitle}
          onChange={(e) => setFreeTitle(e.target.value)}
          disabled={disabled}
          placeholder="无谱曲目（自由文本）"
          className="min-w-0 flex-1 rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
        />
        <button
          type="button"
          disabled={disabled || !freeTitle.trim()}
          onClick={addFree}
          className="shrink-0 rounded-full border border-border bg-surface px-3 py-1.5 text-caption text-text hover:bg-muted disabled:opacity-50"
        >
          添加
        </button>
      </div>

      <p className="text-caption text-text-muted">
        有谱曲目按分谱自动分配考勤；无谱曲目按全员 required。
      </p>
    </div>
  );
}
