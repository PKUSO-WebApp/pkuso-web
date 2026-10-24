"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";
import { useRehearsals } from "@/hooks/useRehearsals";
import { useSchedule } from "@/hooks/useSchedule";
import { useSheetMusicOptions, type SheetMusicOption } from "@/hooks/useSheetMusicOptions";
import { supabase } from "@/lib/supabase";
import { Modal } from "@/components/ui/Modal";
import {
  CreateRehearsalForm,
  MAX_CHECKIN_RADIUS_M,
  MIN_CHECKIN_RADIUS_M,
  type CreateFormState,
  type RepertoirePiece,
} from "@/components/create-rehearsal-form";
import { formatLocalISO, parseLocalISO, getLocalDateString } from "@/lib/date-utils";
import { sectionsToDisplayString } from "@/constants/instruments";
import type { RehearsalRepertoireRow, RehearsalRow } from "@/types/database";
import { useAdminPageHeader } from "@/context/admin-page-header-context";

function buildInitialForm(item: RehearsalRow, pieces: RepertoirePiece[]): CreateFormState {
  const hasCoords = item.checkin_lat != null && item.checkin_lng != null;
  const hasRadius = item.checkin_radius_m != null;
  return {
    type: (item.type ?? "full") as "full" | "section",
    targetSections: (item.target_section ?? []) as string[],
    startTime: item.start_time ? parseLocalISO(item.start_time) : null,
    endTime: item.end_time ? parseLocalISO(item.end_time) : null,
    location: item.location ?? "",
    pieces,
    // 三字段齐全视为已启用围栏；全空视为未启用；残缺态也按启用处理以强制补全
    geofenceEnabled: hasCoords || hasRadius,
    checkinLat: item.checkin_lat ?? null,
    checkinLng: item.checkin_lng ?? null,
    checkinRadiusM: item.checkin_radius_m != null ? String(item.checkin_radius_m) : "",
  };
}

export default function AdminEditRehearsalPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { setTitle, setOnBack } = useAdminPageHeader();
  const id = Number(params.id);
  const { data: schedules, loading } = useRehearsals();

  React.useEffect(() => {
    setTitle("编辑排练日程");
    setOnBack(router.back);
  }, [setTitle, setOnBack, router]);

  const item = React.useMemo(() => schedules?.find((r) => r.id === id) ?? null, [schedules, id]);

  const sheetMusicOptions = useSheetMusicOptions();
  const [initialPieces, setInitialPieces] = React.useState<RepertoirePiece[] | null>(null);
  const itemId = item?.id;
  // 曲目文本只在没有 join 行时作为兜底（存量排练）
  const repertoireFallback = item?.repertoire ?? "";

  React.useEffect(() => {
    if (itemId == null) return;
    let cancelled = false;
    void supabase
      .from("rehearsal_repertoire")
      .select("id, sheet_music_id, title, sort_order")
      .eq("rehearsal_id", itemId)
      .order("sort_order")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("[edit rehearsal] 曲目加载失败", error.message);
          setInitialPieces(
            repertoireFallback ? [{ sheetMusicId: null, title: repertoireFallback }] : [],
          );
          return;
        }
        const rows = (data ?? []) as Pick<
          RehearsalRepertoireRow,
          "id" | "sheet_music_id" | "title"
        >[];
        setInitialPieces(
          rows.length > 0
            ? rows.map((r) => ({
                id: r.id,
                sheetMusicId: r.sheet_music_id,
                title: r.title,
              }))
            : repertoireFallback
              ? [{ sheetMusicId: null, title: repertoireFallback }]
              : [],
        );
      });
    return () => {
      cancelled = true;
    };
  }, [itemId, repertoireFallback]);

  if (loading) {
    return (
      <div className="flex h-full min-h-0 flex-col pb-safe">
        <p className="py-12 text-center text-xs text-text-muted">加载中…</p>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="flex h-full min-h-0 flex-col pb-safe">
        <p className="py-12 text-center text-xs text-text-muted">未找到该排练</p>
      </div>
    );
  }

  if (!initialPieces) {
    return (
      <div className="flex h-full min-h-0 flex-col pb-safe">
        <p className="py-12 text-center text-xs text-text-muted">加载中…</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col pb-safe">
      <section className="flex-1 min-h-0 overflow-y-auto">
        {/* key=id：进入即按当前排练预填表单（懒初始化，避免 setState-in-effect） */}
        <EditForm
          key={id}
          item={item}
          initialPieces={initialPieces}
          sheetMusicOptions={sheetMusicOptions}
        />
      </section>
    </div>
  );
}

function EditForm({
  item,
  initialPieces,
  sheetMusicOptions,
}: {
  item: RehearsalRow;
  initialPieces: RepertoirePiece[];
  sheetMusicOptions: SheetMusicOption[];
}) {
  const router = useRouter();
  const { update, getLastError } = useRehearsals();
  const { checkConflict } = useSchedule();
  const id = item.id;

  const [form, setForm] = React.useState<CreateFormState>(() =>
    buildInitialForm(item, initialPieces),
  );
  const [submitting, setSubmitting] = React.useState(false);
  const submittingRef = React.useRef(false);
  const [conflictModalOpen, setConflictModalOpen] = React.useState(false);
  const [notifyByEmail, setNotifyByEmail] = React.useState(false);

  const handleChange = (
    field: keyof CreateFormState,
    value: string | number | boolean | Date | null | string[] | RepertoirePiece[],
  ) => {
    if (field === "startTime" && value instanceof Date) {
      // +3h 默认时长，但不允许跨天：最晚 capped 到当天 23:59
      const endMs = value.getTime() + 3 * 60 * 60 * 1000;
      const end = new Date(endMs);
      const dayEnd = new Date(value);
      dayEnd.setHours(23, 59, 0, 0);
      const endTime = end > dayEnd ? dayEnd : end;
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
    if (submittingRef.current || submitting) return;
    if (!form.startTime || !form.endTime || !form.location) return;
    if (form.pieces.length === 0) {
      alert("请至少添加一首曲目");
      return;
    }
    if (form.endTime <= form.startTime) {
      alert("结束时间必须晚于开始时间");
      return;
    }
    // 不允许跨天：结束日期必须与开始日期相同
    if (form.endTime.toDateString() !== form.startTime.toDateString()) {
      alert("排练不能跨天，结束时间不得晚于当天 23:59");
      return;
    }
    // 分排必须选声部：DB 触发器 `rehearsals_validate_target_section` 会兜底，
    // 这里先拦是为了让用户看到一句能照着做的话，而不是提交后的 23514。
    if (form.type === "section" && form.targetSections.length === 0) {
      alert("分排必须至少选择一个声部");
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
      const conflictResult = await checkConflict(date, startTimeStr, endTimeStr, id);
      if (conflictResult) {
        setConflictModalOpen(true);
        return;
      }

      const repertoireText = form.pieces
        .map((p) => p.title.trim())
        .filter(Boolean)
        .join("、");

      const payload: Record<string, unknown> = {
        type: form.type,
        target_section: form.type === "section" ? form.targetSections : [],
        start_time: formatLocalISO(form.startTime),
        end_time: formatLocalISO(form.endTime),
        location: form.location,
        repertoire: repertoireText,
        sign_in_code: null,
        ...geoFields,
      };

      const ok = await update(id, payload);
      if (!ok) {
        // 同排练详情页的删除：`getLastError()` 是同步出口，`error` state 在这里读是旧值
        alert(getLastError() ?? "更新失败");
        return;
      }

      // 曲目替换单独提交（不重算已有考勤，用户批准的「只影响新行」）
      const { error: piecesError } = await supabase.rpc("save_rehearsal_repertoire", {
        p_rehearsal_id: id,
        p_pieces: form.pieces.map((p, i) => ({
          sheet_music_id: p.sheetMusicId,
          title: p.title.trim(),
          sort_order: i,
        })) as never,
      });
      if (piecesError) {
        alert(`排练信息已保存，但曲目保存失败：${piecesError.message}。请重试保存。`);
        return;
      }

      if (notifyByEmail) {
        const startH = String(form.startTime.getHours()).padStart(2, "0");
        const startM = String(form.startTime.getMinutes()).padStart(2, "0");
        const endH = String(form.endTime.getHours()).padStart(2, "0");
        const endM = String(form.endTime.getMinutes()).padStart(2, "0");
        const dateStr = `${form.startTime.getFullYear()}-${String(form.startTime.getMonth() + 1).padStart(2, "0")}-${String(form.startTime.getDate()).padStart(2, "0")} ${startH}:${startM} - ${endH}:${endM}`;
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
            body: JSON.stringify({
              title: repertoireText,
              dateStr,
              location: form.location,
              type: form.type,
              targetSection:
                form.type === "section" ? sectionsToDisplayString(form.targetSections) : undefined,
            }),
          });
          alert(res.ok ? "✅ 已保存并发送邮件通知" : "✅ 已保存，但邮件发送失败");
        } catch {
          alert("✅ 已保存，但邮件发送失败");
        }
      } else {
        alert("已保存");
      }
      router.push(`/admin/rehearsals/${id}`);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <>
      <CreateRehearsalForm
        form={form}
        submitting={submitting}
        editing
        sheetMusicOptions={sheetMusicOptions}
        notifyByEmail={notifyByEmail}
        onNotifyByEmailChange={setNotifyByEmail}
        onChange={handleChange}
        onCheckinPick={handleCheckinPick}
        onSubmit={handleSubmit}
        onCancel={() => router.back()}
      />

      <Modal
        open={conflictModalOpen}
        onClose={() => setConflictModalOpen(false)}
        title="时间冲突"
        position="bottom"
      >
        <p className="text-sm text-text-muted">
          有存在的预约与即将修改的排练时间冲突，是否前往schedule页面管理预约？
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
    </>
  );
}
