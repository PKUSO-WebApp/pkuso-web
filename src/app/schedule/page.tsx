"use client";

import React from "react";
import { useUser } from "@/context/user-context";
import { useRehearsals } from "@/hooks/useRehearsals";
import { useAttendance } from "@/hooks/useAttendance";
import { Toggle } from "@/components/ui/Toggle";
import { RehearsalCard } from "@/app/schedule/components/rehearsal-card";
import {
  CreateRehearsalModal,
  type CreateFormState,
} from "@/app/schedule/components/create-rehearsal-modal";
import { CodeVerifyModal } from "@/app/schedule/components/code-verify-modal";
import { AttendanceModal } from "@/app/schedule/components/attendance-modal";
import type { RehearsalRow, AttendanceRowWithUser } from "@/types/database";

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

export default function SchedulePage() {
  const { user } = useUser();
  const isAdmin = user?.role === "admin";
  const { data: schedules, loading, create, update, remove } = useRehearsals();
  const {
    map: attendanceMap,
    list: attendanceList,
    loading: attendanceLoading,
    fetchMyAttendances,
    fetchByRehearsal,
    upsert,
  } = useAttendance();

  const [currentType, setCurrentType] = React.useState<RehearsalType>("合排");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [notifyByEmail, setNotifyByEmail] = React.useState(false);
  const [form, setForm] = React.useState<CreateFormState>(EMPTY_FORM);

  // 签到码
  const [codeRehearsal, setCodeRehearsal] = React.useState<RehearsalRow | null>(null);
  const [codeInput, setCodeInput] = React.useState("");
  const [codeSubmitting, setCodeSubmitting] = React.useState(false);
  const [codeError, setCodeError] = React.useState<string | null>(null);

  // 考勤弹窗
  const [attendanceRehearsal, setAttendanceRehearsal] = React.useState<RehearsalRow | null>(null);
  const [attendanceData, setAttendanceData] = React.useState<AttendanceRowWithUser[]>([]);

  // 团员考勤加载
  React.useEffect(() => {
    if (!user?.id || isAdmin) return;
    const ids = schedules.map((r) => r.id);
    void fetchMyAttendances(user.id, ids);
  }, [user?.id, isAdmin, schedules, fetchMyAttendances]);

  // 管理员查看考勤
  React.useEffect(() => {
    if (!attendanceRehearsal) return;
    void fetchByRehearsal(attendanceRehearsal.id).then((rows) =>
      setAttendanceData(rows as AttendanceRowWithUser[]),
    );
  }, [attendanceRehearsal, fetchByRehearsal]);

  const list = React.useMemo(
    () => schedules.filter((r) => (r.type === "full" ? "合排" : "分排") === currentType),
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
      startTime: item.start_time ? new Date(item.start_time) : null,
      endTime: item.end_time ? new Date(item.end_time) : null,
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
      start_time: form.startTime.toISOString(),
      end_time: form.endTime?.toISOString() ?? null,
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
      const dateStr = `${form.startTime.toLocaleDateString("zh-CN")}`;
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

  const handleMemberSign = async (rehearsal: RehearsalRow) => {
    if (!user) return;
    if (attendanceMap[rehearsal.id]) return;

    if (rehearsal.type === "section") {
      const err = await upsert([
        { rehearsal_id: rehearsal.id, user_id: user.id, status: "present" },
      ]);
      if (!err) alert("签到成功");
    } else if (rehearsal.sign_in_code) {
      setCodeRehearsal(rehearsal);
      setCodeInput("");
      setCodeError(null);
    } else {
      alert("未配置签到码");
    }
  };

  const handleCodeConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!codeRehearsal || !user) return;
    if (!/^\d{4}$/.test(codeInput)) {
      setCodeError("请输4位数字");
      return;
    }
    if (codeInput !== codeRehearsal.sign_in_code) {
      setCodeError("签到码错误");
      return;
    }
    setCodeSubmitting(true);
    const err = await upsert([
      { rehearsal_id: codeRehearsal.id, user_id: user.id, status: "present" },
    ]);
    setCodeSubmitting(false);
    if (!err) {
      alert("签到成功");
      setCodeRehearsal(null);
    } else setCodeError("签到失败");
  };

  return (
    <div className="space-y-4">
      <header className="mb-2 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-text">本周排练日程</h1>
          <p className="mt-1 text-xs text-text-muted">查看乐团合排与分排安排</p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={openCreate}
            className="rounded-full bg-primary px-3 py-1 text-label font-medium text-primary-foreground shadow-sm hover:opacity-90"
          >
            ➕ 发布新日程
          </button>
        )}
      </header>

      <Toggle options={["合排", "分排"] as const} value={currentType} onChange={setCurrentType} />

      <section className="space-y-3">
        {loading && <p className="py-6 text-center text-xs text-text-subtle">加载中…</p>}
        {!loading &&
          list.map((item) => (
            <RehearsalCard
              key={item.id}
              item={item}
              isAdmin={!!isAdmin}
              hasSigned={!!attendanceMap[item.id]}
              onEdit={isAdmin ? () => openEdit(item) : undefined}
              onDelete={isAdmin ? () => handleDelete(item.id) : undefined}
              onSignIn={!isAdmin ? () => handleMemberSign(item) : undefined}
              onViewAttendance={isAdmin ? () => setAttendanceRehearsal(item) : undefined}
            />
          ))}
        {!loading && list.length === 0 && (
          <p className="py-8 text-center text-xs text-text-muted">暂无安排</p>
        )}
      </section>

      {isAdmin && (
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
      )}

      <AttendanceModal
        open={!!attendanceRehearsal}
        title={attendanceRehearsal?.repertoire ?? ""}
        loading={attendanceLoading}
        list={attendanceData}
        onClose={() => setAttendanceRehearsal(null)}
      />

      <CodeVerifyModal
        open={!!codeRehearsal}
        title={codeRehearsal?.repertoire ?? ""}
        submitting={codeSubmitting}
        codeInput={codeInput}
        codeError={codeError}
        onCodeChange={(v) => {
          setCodeError(null);
          setCodeInput(v);
        }}
        onConfirm={handleCodeConfirm}
        onClose={() => {
          if (!codeSubmitting) setCodeRehearsal(null);
        }}
      />
    </div>
  );
}
