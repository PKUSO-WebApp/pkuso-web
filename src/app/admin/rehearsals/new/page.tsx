"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useRehearsals } from "@/hooks/useRehearsals";
import { useAttendance, type AttendanceEntry } from "@/hooks/useAttendance";
import { useSchedule } from "@/hooks/useSchedule";
import { useProfiles } from "@/hooks/useProfiles";
import { Modal } from "@/components/ui/Modal";
import {
  CreateRehearsalForm,
  MAX_CHECKIN_RADIUS_M,
  MIN_CHECKIN_RADIUS_M,
  type CreateFormState,
} from "../../../(member)/schedule/components/create-rehearsal-form";
import type { ProfileRow } from "@/types/database";
import { formatLocalISO, getLocalDateString } from "@/lib/date-utils";

// 启用地理围栏时的默认签到点：北京大学新太阳学生中心（GCJ-02 坐标系）
const DEFAULT_GEOFENCE_CENTER = { lat: 39.988842, lng: 116.311144 } as const;

const EMPTY_FORM: CreateFormState = {
  type: "full",
  targetSection: "",
  startTime: null,
  endTime: null,
  location: "",
  repertoire: "",
  geofenceEnabled: true,
  checkinLat: DEFAULT_GEOFENCE_CENTER.lat,
  checkinLng: DEFAULT_GEOFENCE_CENTER.lng,
  checkinRadiusM: "200",
};

export default function AdminCreateRehearsalPage() {
  const router = useRouter();
  const { create } = useRehearsals();
  const { batchInsert } = useAttendance();
  const { checkConflict } = useSchedule();
  const { data: allProfiles } = useProfiles({ status: "approved" });

  const [form, setForm] = React.useState<CreateFormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = React.useState(false);
  const submittingRef = React.useRef(false);
  const [notifyByEmail, setNotifyByEmail] = React.useState(false);
  const [conflictModalOpen, setConflictModalOpen] = React.useState(false);

  const handleChange = (
    field: keyof CreateFormState,
    value: string | number | boolean | Date | null,
  ) => {
    if (field === "startTime" && value instanceof Date) {
      const endTime = new Date(value.getTime() + 3 * 60 * 60 * 1000);
      setForm((p) => ({ ...p, startTime: value, endTime }));
    } else {
      setForm((p) => ({ ...p, [field]: value }));
    }
  };

  const handleCheckinPick = (lat: number | null, lng: number | null) => {
    setForm((p) => ({ ...p, checkinLat: lat, checkinLng: lng }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      submittingRef.current ||
      submitting ||
      !form.startTime ||
      !form.endTime ||
      !form.location ||
      !form.repertoire
    )
      return;
    if (form.endTime <= form.startTime) {
      alert("结束时间必须晚于开始时间");
      return;
    }
    let geoFields: Record<string, unknown> = {
      checkin_lat: null,
      checkin_lng: null,
      checkin_radius_m: null,
    };
    if (form.geofenceEnabled) {
      const radius = Number(form.checkinRadiusM);
      if (
        !Number.isFinite(radius) ||
        radius < MIN_CHECKIN_RADIUS_M ||
        radius > MAX_CHECKIN_RADIUS_M
      ) {
        alert(`允许半径需为 ${MIN_CHECKIN_RADIUS_M} ~ ${MAX_CHECKIN_RADIUS_M} 米`);
        return;
      }
      if (
        form.checkinLat == null ||
        form.checkinLng == null ||
        !Number.isFinite(form.checkinLat) ||
        !Number.isFinite(form.checkinLng)
      ) {
        alert("请在地图上选择签到点（或手填有效经纬度）");
        return;
      }
      geoFields = {
        checkin_lat: form.checkinLat,
        checkin_lng: form.checkinLng,
        checkin_radius_m: Math.round(radius),
      };
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const date = getLocalDateString(form.startTime);
      const startTimeStr = `${String(form.startTime.getHours()).padStart(2, "0")}:${String(form.startTime.getMinutes()).padStart(2, "0")}`;
      const endTimeStr = `${String(form.endTime.getHours()).padStart(2, "0")}:${String(form.endTime.getMinutes()).padStart(2, "0")}`;
      const conflictResult = await checkConflict(date, startTimeStr, endTimeStr, undefined);
      if (conflictResult) {
        setConflictModalOpen(true);
        return;
      }

      const payload: Record<string, unknown> = {
        type: form.type,
        target_section: form.type === "section" ? form.targetSection || null : null,
        start_time: formatLocalISO(form.startTime),
        end_time: formatLocalISO(form.endTime),
        location: form.location,
        repertoire: form.repertoire,
        sign_in_code: null,
        ...geoFields,
      };

      const rehearsalId = await create(payload);
      if (!rehearsalId) {
        alert("发布失败");
        return;
      }

      // 新建排练时自动为所有已批准团员生成出勤记录（默认缺席）
      const members = (allProfiles as ProfileRow[]).filter((r) => (r.role ?? "") !== "admin");
      if (members.length > 0) {
        const rows: AttendanceEntry[] = members.map((m) => ({
          rehearsal_id: rehearsalId,
          user_id: m.id,
          status: "absent",
        }));
        const errMsg = await batchInsert(rows);
        if (errMsg) console.error("批量创建出勤记录失败:", errMsg);
      }

      if (notifyByEmail) {
        const dateStr = `${form.startTime.getFullYear()}-${String(form.startTime.getMonth() + 1).padStart(2, "0")}-${String(form.startTime.getDate()).padStart(2, "0")}`;
        try {
          const { supabase } = await import("@/lib/supabase");
          const {
            data: { session },
          } = await supabase.auth.getSession();
          const res = await fetch("/api/notify", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
            },
            body: JSON.stringify({ title: form.repertoire, dateStr, location: form.location }),
          });
          alert(res.ok ? "✅ 排练已发布,邮件已发送" : "❌ 邮件发送失败");
        } catch {
          alert("❌ 邮件发送失败");
        }
      } else {
        alert("发布成功");
      }
      router.push("/admin/rehearsals");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col pb-safe">
      <header className="mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-full px-2 py-1 text-lg text-text-muted hover:bg-muted"
          aria-label="返回"
        >
          ‹
        </button>
        <div>
          <h1 className="text-lg font-semibold text-text">发布排练日程</h1>
          <p className="mt-1 text-xs text-text-muted">发布、编辑、查看排练详情</p>
        </div>
      </header>

      <section className="flex-1 min-h-0 overflow-y-auto">
        <CreateRehearsalForm
          form={form}
          submitting={submitting}
          notifyByEmail={notifyByEmail}
          onNotifyByEmailChange={setNotifyByEmail}
          onChange={handleChange}
          onCheckinPick={handleCheckinPick}
          onSubmit={handleSubmit}
          onCancel={() => router.back()}
        />
      </section>

      <Modal
        open={conflictModalOpen}
        onClose={() => setConflictModalOpen(false)}
        title="时间冲突"
        position="bottom"
      >
        <p className="text-sm text-text-muted">
          有存在的预约与即将添加的排练时间冲突，是否前往schedule页面管理预约？
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setConflictModalOpen(false)}
            className="rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium text-text-muted hover:bg-muted"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => router.push("/admin/schedule")}
            className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            前往管理
          </button>
        </div>
      </Modal>
    </div>
  );
}
