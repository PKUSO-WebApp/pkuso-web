"use client";

import React from "react";
import { useRehearsals } from "@/hooks/useRehearsals";
import { useAttendance } from "@/hooks/useAttendance";
import { Toggle } from "@/components/ui/Toggle";
import { AdminRehearsalCard } from "./components/rehearsal-card";
import {
  CreateRehearsalModal,
  type CreateFormState,
} from "@/app/(member)/schedule/components/create-rehearsal-modal";
import { AttendanceModal } from "@/app/(member)/schedule/components/attendance-modal";
import type { RehearsalRow, AttendanceRowWithUser } from "@/types/database";
import { formatLocalISO, parseLocalISO } from "@/lib/date-utils";

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
  const { data: schedules, loading, create, update, remove } = useRehearsals();
  const { loading: attendanceLoading, fetchByRehearsal } = useAttendance();

  const [currentType, setCurrentType] = React.useState<RehearsalType>("合排");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [notifyByEmail, setNotifyByEmail] = React.useState(false);
  const [form, setForm] = React.useState<CreateFormState>(EMPTY_FORM);

  const [attendanceRehearsal, setAttendanceRehearsal] = React.useState<RehearsalRow | null>(null);
  const [attendanceList, setAttendanceList] = React.useState<AttendanceRowWithUser[]>([]);

  // 管理员查看考勤
  React.useEffect(() => {
    if (!attendanceRehearsal) return;
    void fetchByRehearsal(attendanceRehearsal.id).then((rows) =>
      setAttendanceList(rows as AttendanceRowWithUser[]),
    );
  }, [attendanceRehearsal, fetchByRehearsal]);

  const list = React.useMemo(
    () =>
      schedules.filter((r) => {
        if (r.type === "full") return currentType === "合排";
        if (r.type === "section") return currentType === "分排";
        return false;
      }),
    [schedules, currentType],
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
    if (submitting || !form.startTime || !form.location || !form.repertoire) return;

    if (form.type === "full" && (!form.signInCode || !/^\d{4}$/.test(form.signInCode))) {
      alert("合排需要设置4位数字签到密码");
      return;
    }

    setSubmitting(true);
    const payload: Record<string, unknown> = {
      type: form.type,
      target_section: form.type === "section" ? form.targetSection || null : null,
      start_time: formatLocalISO(form.startTime),
      end_time: form.endTime ? formatLocalISO(form.endTime) : null,
      location: form.location,
      repertoire: form.repertoire,
      sign_in_code: form.type === "full" ? form.signInCode : null,
    };

    const ok = editingId ? await update(editingId, payload) : await create(payload);
    setSubmitting(false);
    if (!ok) {
      alert(editingId ? "更新失败" : "发布失败");
      return;
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

      <section className="max-h-[300px] space-y-3 overflow-y-auto">
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
        onChange={(f, v) => setForm((p) => ({ ...p, [f]: v }))}
        onClose={closeCreate}
        onSubmit={handleSubmit}
      />

      <AttendanceModal
        open={!!attendanceRehearsal}
        title={attendanceRehearsal?.repertoire ?? ""}
        loading={attendanceLoading}
        list={attendanceList}
        onClose={() => setAttendanceRehearsal(null)}
      />
    </div>
  );
}
