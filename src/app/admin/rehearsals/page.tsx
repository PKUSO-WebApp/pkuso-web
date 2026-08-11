"use client";

import React from "react";
import { useRouter } from "next/navigation";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { useRehearsals } from "@/hooks/useRehearsals";
import { useAttendance, type AttendanceEntry } from "@/hooks/useAttendance";
import { useSchedule } from "@/hooks/useSchedule";
import { useProfiles } from "@/hooks/useProfiles";
import type { ProfileRow } from "@/types/database";
import { Toggle } from "@/components/ui/Toggle";
import { Modal } from "@/components/ui/Modal";
import { AdminRehearsalCard } from "./components/rehearsal-card";
import {
  CreateRehearsalModal,
  type CreateFormState,
} from "@/app/(member)/schedule/components/create-rehearsal-modal";
import { AttendanceModal } from "@/app/(member)/schedule/components/attendance-modal";
import type { RehearsalRow, AttendanceRowWithUser, AttendanceStatus } from "@/types/database";
import { formatLocalISO, parseLocalISO, getLocalDateString } from "@/lib/date-utils";

type RehearsalType = "合排" | "分排";

const EMPTY_FORM: CreateFormState = {
  type: "full",
  targetSection: "",
  startTime: null,
  endTime: null,
  location: "",
  repertoire: "",
  signInCode: "",
};

export default function AdminRehearsalsPage() {
  const router = useRouter();
  const { data: schedules, loading, create, update, remove } = useRehearsals();
  const {
    loading: attendanceLoading,
    fetchByRehearsal,
    updateStatus,
    batchInsert,
  } = useAttendance();
  const { checkConflict } = useSchedule();
  const { data: allProfiles } = useProfiles({ status: "approved" });

  const [currentType, setCurrentType] = React.useState<RehearsalType>("合排");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const submittingRef = React.useRef(false);
  const [notifyByEmail, setNotifyByEmail] = React.useState(false);
  const [form, setForm] = React.useState<CreateFormState>(EMPTY_FORM);
  const [conflictModalOpen, setConflictModalOpen] = React.useState(false);
  const [startDateFilter, setStartDateFilter] = React.useState<Date | null>(null);
  const [endDateFilter, setEndDateFilter] = React.useState<Date | null>(null);

  const [attendanceRehearsal, setAttendanceRehearsal] = React.useState<RehearsalRow | null>(null);
  const [attendanceList, setAttendanceList] = React.useState<AttendanceRowWithUser[]>([]);
  const [attendanceSaving, setAttendanceSaving] = React.useState(false);
  const pendingAttendanceChanges = React.useRef<Map<string, string>>(new Map<string, string>());

  // 管理员查看考勤
  React.useEffect(() => {
    if (!attendanceRehearsal) return;
    pendingAttendanceChanges.current.clear();
    void fetchByRehearsal(attendanceRehearsal.id).then((rows) => setAttendanceList(rows));
  }, [attendanceRehearsal, fetchByRehearsal]);

  const handleSaveAttendance = async () => {
    if (!attendanceRehearsal) return;
    const changes = pendingAttendanceChanges.current;
    if (changes.size === 0) {
      return;
    }
    setAttendanceSaving(true);
    let hasError = false;
    for (const [userId, status] of changes) {
      const errMsg = await updateStatus(attendanceRehearsal.id, userId, status as AttendanceStatus);
      if (errMsg) hasError = true;
    }
    setAttendanceSaving(false);
    if (hasError) alert("部分出勤更新失败，请刷新后重试");
    // 刷新列表
    const rows = await fetchByRehearsal(attendanceRehearsal.id);
    setAttendanceList(rows);
    pendingAttendanceChanges.current.clear();
  };

  const list = React.useMemo(
    () =>
      schedules.filter((r) => {
        // 类型筛选
        if (r.type === "full") {
          if (currentType !== "合排") return false;
        } else if (r.type === "section") {
          if (currentType !== "分排") return false;
        } else {
          return false;
        }

        // 日期筛选
        if (!r.start_time) return false;
        const rehearsalDate = parseLocalISO(r.start_time);

        if (startDateFilter && rehearsalDate < startDateFilter) {
          return false;
        }

        if (endDateFilter) {
          const endOfDay = new Date(endDateFilter);
          endOfDay.setHours(23, 59, 59, 999);
          if (rehearsalDate > endOfDay) return false;
        }

        return true;
      }),
    [schedules, currentType, startDateFilter, endDateFilter],
  );

  const resetForm = () => {
    setEditingId(null);
    setNotifyByEmail(false);
    setForm(EMPTY_FORM);
  };

  const openCreate = () => {
    resetForm();
    setCreateOpen(true);
  };

  const openEdit = (item: RehearsalRow) => {
    setEditingId(item.id);
    setForm({
      type: (item.type ?? "full") as "full" | "section",
      targetSection: item.target_section ?? "",
      startTime: item.start_time ? parseLocalISO(item.start_time) : null,
      endTime: item.end_time ? parseLocalISO(item.end_time) : null,
      location: item.location ?? "",
      repertoire: item.repertoire ?? "",
      signInCode: item.sign_in_code ?? "",
    });
    setCreateOpen(true);
  };

  const closeCreate = () => {
    if (!submitting) {
      setCreateOpen(false);
      resetForm();
    }
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

    if (form.type === "full" && (!form.signInCode || !/^\d{4}$/.test(form.signInCode))) {
      alert("合排需要设置4位数字签到密码");
      return;
    }

    // 同步 + 异步双重防重复提交
    submittingRef.current = true;
    setSubmitting(true);

    try {
      // 检查时间冲突
      const date = getLocalDateString(form.startTime);
      const startTimeStr = `${String(form.startTime.getHours()).padStart(2, "0")}:${String(form.startTime.getMinutes()).padStart(2, "0")}`;
      const endTimeStr = `${String(form.endTime.getHours()).padStart(2, "0")}:${String(form.endTime.getMinutes()).padStart(2, "0")}`;
      const conflictResult = await checkConflict(
        date,
        startTimeStr,
        endTimeStr,
        editingId ?? undefined,
      );
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
        sign_in_code: form.type === "full" ? form.signInCode : null,
      };

      const rehearsalId = editingId
        ? (await update(editingId, payload), editingId)
        : await create(payload);

      if (!rehearsalId) {
        alert(editingId ? "更新失败" : "发布失败");
        return;
      }

      // 新建排练时自动为所有已批准团员生成出勤记录（默认缺席）
      if (!editingId) {
        const members = (allProfiles as ProfileRow[]).filter((r) => (r.role ?? "") !== "admin");
        if (members.length > 0) {
          const rows: AttendanceEntry[] = members.map((m) => ({
            rehearsal_id: rehearsalId,
            user_id: m.id,
            status: "absent",
          }));
          const errMsg = await batchInsert(rows);
          if (errMsg) {
            console.error("批量创建出勤记录失败:", errMsg);
          }
        }
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
        alert(editingId ? "已保存" : "发布成功");
      }
      closeCreate();
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("确定删除?")) return;
    const ok = await remove(id);
    if (!ok) alert("删除失败");
  };

  return (
    <div className="space-y-4">
      <header className="mb-2 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-text">排练管理</h1>
          <p className="mt-1 text-xs text-text-muted">发布、编辑、查看排练与出勤</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="rounded-full bg-primary px-3 py-1 text-label font-medium text-primary-foreground shadow-sm hover:opacity-90"
        >
          ➕ 发布新日程
        </button>
      </header>

      <Toggle options={["合排", "分排"] as const} value={currentType} onChange={setCurrentType} />

      <div className="flex items-center gap-2">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-text-muted">开始时间</label>
          <DatePicker
            selected={startDateFilter}
            onChange={(date: Date | null) => setStartDateFilter(date)}
            dateFormat="yyyy-MM-dd"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholderText="选择日期"
          />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-text-muted">结束时间</label>
          <DatePicker
            selected={endDateFilter}
            onChange={(date: Date | null) => setEndDateFilter(date)}
            dateFormat="yyyy-MM-dd"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholderText="选择日期"
          />
        </div>
      </div>

      <section className="max-h-[400px] space-y-3 overflow-y-auto">
        {loading && <p className="py-6 text-center text-xs text-text-subtle">加载中…</p>}
        {!loading &&
          list.map((item) => (
            <AdminRehearsalCard
              key={item.id}
              item={item}
              onEdit={() => openEdit(item)}
              onDelete={() => handleDelete(item.id)}
              onViewAttendance={() => setAttendanceRehearsal(item)}
            />
          ))}
        {!loading && list.length === 0 && (
          <p className="py-8 text-center text-xs text-text-muted">暂无安排</p>
        )}
      </section>

      <CreateRehearsalModal
        open={createOpen}
        editing={editingId !== null}
        form={form}
        submitting={submitting}
        notifyByEmail={notifyByEmail}
        onNotifyByEmailChange={setNotifyByEmail}
        onChange={(f, v) => {
          if (f === "startTime" && v instanceof Date) {
            const endTime = new Date(v.getTime() + 3 * 60 * 60 * 1000);
            setForm((p) => ({ ...p, startTime: v, endTime }));
          } else {
            setForm((p) => ({ ...p, [f]: v }));
          }
        }}
        onClose={closeCreate}
        onSubmit={handleSubmit}
      />

      <AttendanceModal
        open={!!attendanceRehearsal}
        title={attendanceRehearsal?.repertoire ?? ""}
        loading={attendanceLoading}
        list={attendanceList}
        editable
        onStatusChange={(userId, status) => {
          pendingAttendanceChanges.current.set(userId, status);
        }}
        onSave={handleSaveAttendance}
        saving={attendanceSaving}
        onClose={() => {
          if (!attendanceSaving) {
            pendingAttendanceChanges.current.clear();
            setAttendanceRehearsal(null);
          }
        }}
      />

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
