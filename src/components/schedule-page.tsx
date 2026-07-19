"use client";

import React from "react";
import { useUser } from "@/context/UserContext";
import { supabase } from "@/lib/supabase";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";

import type { RehearsalRow, AttendanceRow, AttendanceRowWithUser } from "@/types/database";

type RehearsalType = "合排" | "分排";

type DbRehearsalType = "full" | "section";

type CreateFormState = {
  type: DbRehearsalType;
  targetSection: string;
  startTime: Date | null;
  endTime: Date | null;
  location: string;
  repertoire: string;
  signInCode: string;
};

export function SchedulePage() {
  const [currentType, setCurrentType] = React.useState<RehearsalType>("合排");
  const [schedules, setSchedules] = React.useState<RehearsalRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [notifyByEmail, setNotifyByEmail] = React.useState(false);
  const [form, setForm] = React.useState<CreateFormState>({
    type: "full",
    targetSection: "",
    startTime: null,
    endTime: null,
    location: "",
    repertoire: "",
    signInCode: "",
  });

  const { user } = useUser();
  const isAdmin = user?.role === "admin";

  const fetchSchedules = React.useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("rehearsals")
      .select("*")
      .order("start_time", { ascending: false });

    if (error) {
      console.warn("[Schedule] 加载日程失败：", error.message);
      setSchedules([]);
    } else {
      setSchedules((data as RehearsalRow[]) ?? []);
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void fetchSchedules();
  }, [fetchSchedules]);

  const list = React.useMemo(() => {
    const targetType: DbRehearsalType = currentType === "合排" ? "full" : "section";
    return schedules.filter((item) => item.type === targetType);
  }, [currentType, schedules]);

  const handleOpenCreate = () => {
    if (!isAdmin) return;
    setEditingId(null);
    setNotifyByEmail(false);
    setForm({
      type: "full",
      targetSection: "",
      startTime: null,
      endTime: null,
      location: "",
      repertoire: "",
      signInCode: "",
    });
    setIsCreateModalOpen(true);
  };

  const handleOpenEdit = (item: RehearsalRow) => {
    if (!isAdmin) return;
    setEditingId(item.id);
    const startDate = new Date(item.start_time!);
    const endDate = item.end_time ? new Date(item.end_time) : null;
    setForm({
      type: item.type as DbRehearsalType,
      targetSection: item.target_section ?? "",
      startTime: Number.isNaN(startDate.getTime()) ? null : startDate,
      endTime: endDate && !Number.isNaN(endDate.getTime()) ? endDate : null,
      location: item.location!,
      repertoire: item.repertoire!,
      signInCode: item.sign_in_code ?? "",
    });
    setIsCreateModalOpen(true);
  };

  const handleCloseCreate = () => {
    if (submitting) return;
    setIsCreateModalOpen(false);
    setEditingId(null);
    setNotifyByEmail(false);
    setForm({
      type: "full",
      targetSection: "",
      startTime: null,
      endTime: null,
      location: "",
      repertoire: "",
      signInCode: "",
    });
  };

  const handleChange = (
    field: keyof CreateFormState,
    value: string | DbRehearsalType | Date | null,
  ) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    if (!form.startTime || !form.location || !form.repertoire) {
      alert("请填写完整的时间、地点和曲目信息。");
      return;
    }

    if (form.type === "full") {
      if (!form.signInCode) {
        alert("合排需要设置签到密码。");
        return;
      }
      if (!/^\d{4}$/.test(form.signInCode)) {
        alert("签到密码需要是 4 位数字，例如 8848。");
        return;
      }
    }

    setSubmitting(true);
    const payload = {
      type: form.type,
      target_section: form.type === "section" ? form.targetSection || null : null,
      start_time: form.startTime.toISOString(),
      end_time: form.endTime ? form.endTime.toISOString() : null,
      location: form.location,
      repertoire: form.repertoire,
      sign_in_code: form.type === "full" ? form.signInCode : null,
    };

    if (editingId === null) {
      const { error } = await supabase.from("rehearsals").insert([payload]);
      if (error) {
        setSubmitting(false);
        console.warn("[Schedule] 发布新日程失败：", error.message);
        alert("发布失败，请稍后重试。");
        return;
      }
    } else {
      const { error } = await supabase.from("rehearsals").update(payload).eq("id", editingId);
      if (error) {
        setSubmitting(false);
        console.warn("[Schedule] 更新日程失败：", error.message);
        alert("更新失败，请稍后重试。");
        return;
      }
    }

    if (notifyByEmail) {
      const dateStr = formatRehearsalRange(
        form.startTime.toISOString(),
        form.endTime ? form.endTime.toISOString() : null,
      );
      let ok = false;
      try {
        const res = await fetch("/api/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: form.repertoire,
            dateStr,
            location: form.location,
          }),
        });
        ok = res.ok;
      } catch {
        ok = false;
      }
      alert(ok ? "✅ 排练已发布！邮件通知已成功发送至全团！" : "❌ 邮件发送失败，请检查控制台。");
    } else {
      alert(editingId === null ? "发布成功！" : "已保存。");
    }

    setSubmitting(false);
    handleCloseCreate();
    void fetchSchedules();
  };

  const handleDelete = async (id: number) => {
    const ok = window.confirm("确定要删除此排练日程吗？");
    if (!ok) return;

    const { error: attendError } = await supabase
      .from("attendances")
      .delete()
      .eq("rehearsal_id", id);

    if (attendError) {
      console.warn("[Schedule] 删除出勤记录失败：", attendError.message);
      alert("删除失败，请稍后重试。");
      return;
    }

    const { error: rehearsalError } = await supabase.from("rehearsals").delete().eq("id", id);

    if (rehearsalError) {
      console.warn("[Schedule] 删除日程失败：", rehearsalError.message);
      alert("删除失败，请稍后重试。");
      return;
    }

    alert("已删除该排练日程。");
    void fetchSchedules();
  };

  const [attendanceMap, setAttendanceMap] = React.useState<Record<number, { status: string }>>({});
  const [codeModalRehearsal, setCodeModalRehearsal] = React.useState<RehearsalRow | null>(null);
  const [codeInput, setCodeInput] = React.useState("");
  const [codeSubmitting, setCodeSubmitting] = React.useState(false);
  const [codeError, setCodeError] = React.useState<string | null>(null);
  const [attendanceModalRehearsal, setAttendanceModalRehearsal] =
    React.useState<RehearsalRow | null>(null);
  const [attendanceList, setAttendanceList] = React.useState<AttendanceRow[]>([]);
  const [attendanceLoading, setAttendanceLoading] = React.useState(false);

  React.useEffect(() => {
    if (!user || user.role !== "member") return;
    if (!list.length) return;
    const ids = list.map((r) => r.id);
    const fetchAttendances = async () => {
      const { data, error } = await supabase
        .from("attendances")
        .select("*")
        .eq("user_id", user.id)
        .in("rehearsal_id", ids);

      if (error || !data) {
        console.warn("[Schedule] 加载签到记录失败：", error?.message);
        setAttendanceMap({});
        return;
      }

      const map: Record<number, { status: string }> = {};
      for (const row of data as { rehearsal_id: number; status: string }[]) {
        map[row.rehearsal_id] = { status: row.status };
      }
      setAttendanceMap(map);
    };

    void fetchAttendances();
  }, [user, list]);

  const handleMemberSign = async (rehearsal: RehearsalRow) => {
    if (!user || user.role !== "member") return;
    if (attendanceMap[rehearsal.id]) return;
    if (isRehearsalExpired(rehearsal.start_time!, rehearsal.end_time ?? null)) return;

    if (rehearsal.type === "section") {
      const { data, error } = await supabase
        .from("attendances")
        .insert({
          user_id: user.id,
          rehearsal_id: rehearsal.id,
          status: "present",
        })
        .select()
        .single();

      if (error || !data) {
        console.warn("[Schedule] 分排签到失败：", error?.message);
        alert("签到失败，请稍后重试。");
        return;
      }

      setAttendanceMap((prev) => ({
        ...prev,
        [rehearsal.id]: { status: "present" },
      }));
      alert("签到成功！");
      return;
    }

    if (!rehearsal.sign_in_code) {
      alert("本次合排未配置签到码，请联系管理员。");
      return;
    }

    setCodeModalRehearsal(rehearsal);
    setCodeInput("");
    setCodeError(null);
  };

  const handleCodeConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || user.role !== "member") return;
    if (!codeModalRehearsal) return;
    if (codeSubmitting) return;

    if (!/^\d{4}$/.test(codeInput)) {
      setCodeError("请输入 4 位数字签到码");
      return;
    }

    if (codeInput !== codeModalRehearsal.sign_in_code) {
      setCodeError("签到码错误，请重新输入");
      return;
    }

    setCodeSubmitting(true);
    const { data, error } = await supabase
      .from("attendances")
      .insert({
        user_id: user.id,
        rehearsal_id: codeModalRehearsal.id,
        status: "present",
      })
      .select()
      .single();
    setCodeSubmitting(false);

    if (error || !data) {
      console.warn("[Schedule] 合排签到失败：", error?.message);
      setCodeError("签到失败，请稍后重试");
      return;
    }

    setAttendanceMap((prev) => ({
      ...prev,
      [codeModalRehearsal.id]: { status: "present" },
    }));
    alert("签到成功！");
    setCodeModalRehearsal(null);
    setCodeInput("");
    setCodeError(null);
  };

  const handleCloseCodeModal = () => {
    if (codeSubmitting) return;
    setCodeModalRehearsal(null);
    setCodeInput("");
    setCodeError(null);
  };

  const handleOpenAttendance = (rehearsal: RehearsalRow) => {
    setAttendanceModalRehearsal(rehearsal);
    setAttendanceList([]);
    setAttendanceLoading(true);
  };

  React.useEffect(() => {
    if (!attendanceModalRehearsal) return;
    const rehearsalId = attendanceModalRehearsal.id;

    const fetchAttendance = async () => {
      setAttendanceLoading(true);
      const { data, error } = await supabase
        .from("attendances")
        .select("*, users(name, section)")
        .eq("rehearsal_id", rehearsalId);

      if (error) {
        console.warn("[Schedule] 加载出勤名单失败：", error.message);
        setAttendanceList([]);
      } else {
        setAttendanceList(data ?? []);
      }
      setAttendanceLoading(false);
    };

    void fetchAttendance();
  }, [attendanceModalRehearsal]);

  const handleCloseAttendanceModal = () => {
    if (attendanceLoading) return;
    setAttendanceModalRehearsal(null);
    setAttendanceList([]);
  };

  return (
    <div className="space-y-4">
      <header className="mb-2 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">本周排练日程</h1>
          <p className="mt-1 text-xs text-zinc-500">查看乐团合排与分排安排</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {isAdmin && (
            <button
              type="button"
              onClick={handleOpenCreate}
              className="inline-flex items-center justify-center rounded-full bg-zinc-900 px-3 py-1 text-[11px] font-medium text-white shadow-sm hover:bg-zinc-800"
            >
              ➕ 发布新日程
            </button>
          )}
          <div className="rounded-full bg-zinc-100 px-2 py-1 text-[11px] text-zinc-500">
            乐团管理助手
          </div>
        </div>
      </header>

      <Toggle currentType={currentType} onChange={setCurrentType} />

      <section className="space-y-3">
        {loading && schedules.length === 0 && (
          <p className="py-6 text-center text-xs text-zinc-400">正在加载日程…</p>
        )}

        {!loading &&
          list.map((item) => {
            const isExpired = isRehearsalExpired(item.start_time!, item.end_time ?? null);
            const hasSigned = !!attendanceMap[item.id];
            return (
              <article
                key={item.id}
                className="rounded-2xl border border-zinc-100 bg-zinc-50/70 p-3 shadow-[0_1px_4px_rgba(15,23,42,0.06)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5 leading-tight">
                    <p className="text-sm text-zinc-500">
                      {item.repertoire}
                      {item.type === "section" && item.target_section
                        ? ` · ${item.target_section}`
                        : null}
                    </p>
                    <h2 className="text-base font-semibold text-zinc-900">
                      {formatRehearsalRange(item.start_time!, item.end_time ?? null)}
                    </h2>
                    <p className="text-xs text-zinc-500">
                      地点：{item.location}
                      {item.type === "section" && item.target_section
                        ? ` · 针对：${item.target_section}`
                        : null}
                    </p>
                  </div>
                  {isAdmin ? (
                    <div className="flex flex-col items-end gap-1 text-[11px]">
                      {isExpired && (
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-500">
                          已结束
                        </span>
                      )}
                      {item.type === "full" && item.sign_in_code ? (
                        <span className="text-[10px] text-zinc-500">密码: {item.sign_in_code}</span>
                      ) : null}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(item)}
                          className="text-zinc-500 hover:text-blue-500"
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(item.id)}
                          className="text-zinc-400 hover:text-red-500"
                        >
                          删除
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleOpenAttendance(item)}
                        className="text-zinc-600 hover:text-zinc-900"
                      >
                        📊 查看出勤
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center">
                      {hasSigned ? (
                        <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] text-emerald-600">
                          ✅ 已签到
                        </span>
                      ) : isExpired ? (
                        <span className="rounded-full bg-zinc-100 px-3 py-1 text-[11px] text-zinc-400">
                          已结束
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleMemberSign(item)}
                          className="inline-flex items-center justify-center rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700 shadow-sm"
                        >
                          签到
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}

        {!loading && list.length === 0 && (
          <p className="py-8 text-center text-xs text-zinc-500">暂无「{currentType}」安排。</p>
        )}
      </section>

      {isAdmin && isCreateModalOpen && (
        <CreateRehearsalModal
          form={form}
          submitting={submitting}
          editingId={editingId}
          notifyByEmail={notifyByEmail}
          onNotifyByEmailChange={setNotifyByEmail}
          onChange={handleChange}
          onClose={handleCloseCreate}
          onSubmit={handleSubmit}
        />
      )}

      {attendanceModalRehearsal && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 px-4 pb-safe">
          <button
            aria-label="关闭出勤名单弹窗"
            className="absolute inset-0 h-full w-full"
            onClick={handleCloseAttendanceModal}
            disabled={attendanceLoading}
          />
          <div className="relative w-full max-w-md rounded-3xl bg-white p-4 shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-base font-semibold text-zinc-900">出勤名单</h2>
              <button
                type="button"
                onClick={handleCloseAttendanceModal}
                disabled={attendanceLoading}
                className="rounded-full bg-zinc-100 px-3 py-1 text-[11px] text-zinc-600 hover:bg-zinc-200"
              >
                关闭
              </button>
            </div>
            <p className="mb-3 text-[11px] text-zinc-500">
              排练：{attendanceModalRehearsal.repertoire}
            </p>

            <div className="max-h-64 space-y-2 overflow-y-auto pt-1">
              {attendanceLoading ? (
                <p className="py-6 text-center text-[11px] text-zinc-400">正在加载...</p>
              ) : attendanceList.length === 0 ? (
                <p className="py-6 text-center text-[11px] text-zinc-400">暂无签到记录</p>
              ) : (
                attendanceList.map((row, index) => {
                  const userInfo = (row as AttendanceRowWithUser).users;
                  const name = userInfo?.name ?? "未命名成员";
                  const section = userInfo?.section ?? "声部未登记";
                  const initials = name.slice(0, 2);
                  return (
                    <div
                      key={`${row.id ?? index}`}
                      className="flex items-center justify-between rounded-2xl border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 text-[11px] font-medium text-white">
                          {initials}
                        </div>
                        <div>
                          <p className="text-[11px] font-medium text-zinc-900">{name}</p>
                          <p className="text-[10px] text-zinc-500">{section}</p>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="mt-4 flex items-center justify-end">
              <button
                type="button"
                onClick={handleCloseAttendanceModal}
                disabled={attendanceLoading}
                className="rounded-full bg-zinc-900 px-4 py-1.5 text-[11px] font-medium text-white shadow-sm hover:bg-zinc-800 disabled:opacity-60"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {codeModalRehearsal && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 px-4 pb-safe">
          <button
            aria-label="关闭签到弹窗"
            className="absolute inset-0 h-full w-full"
            onClick={handleCloseCodeModal}
            disabled={codeSubmitting}
          />
          <form
            onSubmit={handleCodeConfirm}
            className="relative w-full max-w-md rounded-3xl bg-white p-4 shadow-xl"
          >
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-base font-semibold text-zinc-900">输入签到码</h2>
              <button
                type="button"
                onClick={handleCloseCodeModal}
                disabled={codeSubmitting}
                className="rounded-full bg-zinc-100 px-3 py-1 text-[11px] text-zinc-600 hover:bg-zinc-200"
              >
                取消
              </button>
            </div>
            <p className="mb-3 text-[11px] text-zinc-500">
              本次排练：{codeModalRehearsal.repertoire}
            </p>
            <div className="space-y-1 text-xs">
              <label className="block text-[11px] font-medium text-zinc-600">四位数字签到码</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                value={codeInput}
                onChange={(e) => {
                  setCodeError(null);
                  setCodeInput(e.target.value);
                }}
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-400"
                placeholder="如：8848"
              />
              {codeError && <p className="text-[11px] text-red-500">{codeError}</p>}
            </div>
            <div className="mt-4 flex items-center justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={handleCloseCodeModal}
                disabled={codeSubmitting}
                className="rounded-full px-4 py-1.5 text-[11px] text-zinc-500 hover:bg-zinc-100"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={codeSubmitting}
                className="rounded-full bg-zinc-900 px-4 py-1.5 text-[11px] font-medium text-white shadow-sm hover:bg-zinc-800 disabled:opacity-60"
              >
                {codeSubmitting ? "确认中…" : "确认签到"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

type ToggleProps = {
  currentType: RehearsalType;
  onChange: (type: RehearsalType) => void;
};

function Toggle({ currentType, onChange }: ToggleProps) {
  return (
    <div className="inline-flex rounded-full bg-zinc-100 p-1 text-xs">
      {(["合排", "分排"] as RehearsalType[]).map((type) => {
        const active = currentType === type;
        return (
          <button
            key={type}
            type="button"
            onClick={() => onChange(type)}
            className={`min-w-[64px] rounded-full px-3 py-1 text-center transition-colors ${
              active ? "bg-zinc-900 text-white shadow-sm" : "text-zinc-600 hover:text-zinc-900"
            }`}
          >
            {type}
          </button>
        );
      })}
    </div>
  );
}

function formatRehearsalRange(startValue: string, endValue: string | null) {
  const start = new Date(startValue);
  if (Number.isNaN(start.getTime())) return startValue;
  const end = endValue ? new Date(endValue) : null;

  const weekdayFormatter = new Intl.DateTimeFormat("zh-CN", {
    weekday: "short",
  });
  const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const weekday = weekdayFormatter.format(start);
  const month = start.getMonth() + 1;
  const day = start.getDate();
  const startTime = timeFormatter.format(start);
  const datePart = `${month}月${day}日 ${weekday}`;

  if (!end || Number.isNaN(end.getTime())) {
    return `${datePart} ${startTime}`;
  }

  const endTime = timeFormatter.format(end);
  return `${datePart} ${startTime} - ${endTime}`;
}

function isRehearsalExpired(startTime: string, endTime: string | null) {
  const base = endTime ? new Date(endTime) : new Date(startTime);
  if (Number.isNaN(base.getTime())) return false;
  const twelveHoursMs = 12 * 60 * 60 * 1000;
  return Date.now() > base.getTime() + twelveHoursMs;
}

type CreateRehearsalModalProps = {
  form: CreateFormState;
  submitting: boolean;
  editingId: number | null;
  notifyByEmail: boolean;
  onNotifyByEmailChange: (v: boolean) => void;
  onChange: (field: keyof CreateFormState, value: string | DbRehearsalType | Date | null) => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
};

function CreateRehearsalModal({
  form,
  submitting,
  editingId,
  notifyByEmail,
  onNotifyByEmailChange,
  onChange,
  onClose,
  onSubmit,
}: CreateRehearsalModalProps) {
  const isSection = form.type === "section";

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 px-4 pb-safe">
      <button
        aria-label="关闭发布日程弹窗"
        className="absolute inset-0 h-full w-full"
        onClick={onClose}
        disabled={submitting}
      />
      <form
        onSubmit={onSubmit}
        className="relative w-full max-w-md rounded-3xl bg-white p-4 shadow-xl"
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-900">
            {editingId !== null ? "编辑排练日程" : "发布排练日程"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-full bg-zinc-100 px-3 py-1 text-[11px] text-zinc-600 hover:bg-zinc-200"
          >
            取消
          </button>
        </div>

        <div className="space-y-3 text-xs">
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-zinc-600">排练类型</label>
            <div className="inline-flex rounded-full bg-zinc-100 p-1 text-[11px]">
              <button
                type="button"
                onClick={() => onChange("type", "full")}
                className={`min-w-[72px] rounded-full px-3 py-1 ${
                  form.type === "full" ? "bg-zinc-900 text-white" : "text-zinc-600"
                }`}
              >
                合排
              </button>
              <button
                type="button"
                onClick={() => onChange("type", "section")}
                className={`min-w-[72px] rounded-full px-3 py-1 ${
                  form.type === "section" ? "bg-zinc-900 text-white" : "text-zinc-600"
                }`}
              >
                分排
              </button>
            </div>
          </div>

          {isSection && (
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-zinc-600">针对声部</label>
              <input
                type="text"
                value={form.targetSection}
                onChange={(e) => onChange("targetSection", e.target.value)}
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-400"
                placeholder="如：第一小提琴 / 木管分排"
              />
            </div>
          )}

          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-zinc-600">开始时间</label>
            <DatePicker
              selected={form.startTime}
              onChange={(date: Date | null) => onChange("startTime", date)}
              showTimeSelect
              timeIntervals={15}
              dateFormat="yyyy-MM-dd HH:mm"
              placeholderText="选择开始时间"
              className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-400"
              popperClassName="react-datepicker-popper-orchestra"
              calendarClassName="react-datepicker-orchestra"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-zinc-600">结束时间</label>
            <DatePicker
              selected={form.endTime}
              onChange={(date: Date | null) => onChange("endTime", date)}
              showTimeSelect
              timeIntervals={15}
              dateFormat="yyyy-MM-dd HH:mm"
              placeholderText="选择结束时间（可选）"
              className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-400"
              popperClassName="react-datepicker-popper-orchestra"
              calendarClassName="react-datepicker-orchestra"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-zinc-600">排练地点</label>
            <input
              type="text"
              value={form.location}
              onChange={(e) => onChange("location", e.target.value)}
              className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-400"
              placeholder="如：新太阳b108"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-zinc-600">排练曲目</label>
            <textarea
              value={form.repertoire}
              onChange={(e) => onChange("repertoire", e.target.value)}
              className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-400"
              rows={2}
              placeholder="如：柴四第四乐章"
            />
          </div>

          {form.type === "full" && (
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-zinc-600">
                签到密码（4 位数字）
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                value={form.signInCode}
                onChange={(e) => onChange("signInCode", e.target.value)}
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-400"
                placeholder="如：8848"
              />
            </div>
          )}

          <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-zinc-700">
            <input
              type="checkbox"
              checked={notifyByEmail}
              onChange={(e) => onNotifyByEmailChange(e.target.checked)}
              disabled={submitting}
              className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-400"
            />
            同时发送邮件通知全团
          </label>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2 text-xs">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-full px-4 py-1.5 text-[11px] text-zinc-500 hover:bg-zinc-100"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-full bg-zinc-900 px-4 py-1.5 text-[11px] font-medium text-white shadow-sm hover:bg-zinc-800 disabled:opacity-60"
          >
            {submitting
              ? editingId !== null
                ? "保存中…"
                : "发布中…"
              : editingId !== null
                ? "保存"
                : "发布"}
          </button>
        </div>
      </form>
    </div>
  );
}
