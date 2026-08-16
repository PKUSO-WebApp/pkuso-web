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
import { RehearsalDetailModal } from "./components/rehearsal-detail-modal";
import {
  CreateRehearsalModal,
  type CreateFormState,
} from "@/app/(member)/schedule/components/create-rehearsal-modal";
import type { RehearsalRow } from "@/types/database";
import { formatLocalISO, parseLocalISO, getLocalDateString } from "@/lib/date-utils";
import {
  sortRehearsalsForMember,
  sortEndedFullRehearsals,
  isRehearsalTodayOrFuture,
} from "@/lib/rehearsal-sort";

type RehearsalType = "合排" | "分排" | "历史合排";

/** 日期区间筛选（三个 tab 共用；历史合排同样受区间约束，与其余 tab 口径一致） */
function filterByDateRange(
  r: RehearsalRow,
  startDateFilter: Date | null,
  endDateFilter: Date | null,
): boolean {
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
}

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
  const { batchInsert } = useAttendance();
  const { checkConflict } = useSchedule();
  const { data: allProfiles } = useProfiles({ status: "approved" });

  const [currentType, setCurrentType] = React.useState<RehearsalType>("合排");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<number | null>(null);
  // 详情弹窗当前展示的排练（Issue #173：卡片去按钮后，查看/编辑/删除入口集中于此）
  const [detailItem, setDetailItem] = React.useState<RehearsalRow | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const submittingRef = React.useRef(false);
  const [notifyByEmail, setNotifyByEmail] = React.useState(false);
  const [form, setForm] = React.useState<CreateFormState>(EMPTY_FORM);
  const [conflictModalOpen, setConflictModalOpen] = React.useState(false);
  const [startDateFilter, setStartDateFilter] = React.useState<Date | null>(null);
  const [endDateFilter, setEndDateFilter] = React.useState<Date | null>(null);

  // 分钟级时钟 tick：跨排练结束时刻停留页面时，定时刷新「进行中/已结束」分组与排序
  // （与用户端首页同模式，Issue #171）
  const [nowTick, setNowTick] = React.useState(() => Date.now());

  React.useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  const list = React.useMemo(() => {
    // 显式传入 nowTick 时刻，排序/已结束判定与真实运行时刻无关（可测试、跨时刻停留自动刷新）
    const now = new Date(nowTick);
    const byDate = (r: RehearsalRow) => filterByDateRange(r, startDateFilter, endDateFilter);

    // 历史合排（Issue #171）：仅已结束的合排，按结束时刻近 → 远，不限一周窗口
    if (currentType === "历史合排") {
      return sortEndedFullRehearsals(schedules.filter(byDate), now);
    }

    const filtered = schedules.filter((r) => {
      // 类型筛选
      if (r.type === "full") {
        if (currentType !== "合排") return false;
      } else if (r.type === "section") {
        if (currentType !== "分排") return false;
      } else {
        return false;
      }
      // 区间筛选仅对有时间可判的排练生效；无 start_time 的排练无法判断日期，保守保留
      // （与 isRehearsalTodayOrFuture 的保守语义一致，Issue #173）
      if (r.start_time && !byDate(r)) return false;
      // 窗口过滤（Issue #173）：仅今天起（start_time 日期 >= 今天 00:00）的排练，不含过去
      return isRehearsalTodayOrFuture(r, now);
    });

    // 排序与用户端一致（Issue #171）：进行中/未开始近 → 远、已结束组底部近 → 远、
    // 更新过的排练置顶（最近一次排练之后）、无时间排最后。admin 不过滤一周窗口，仅排序规则复用。
    return sortRehearsalsForMember(filtered, now);
  }, [schedules, currentType, startDateFilter, endDateFilter, nowTick]);

  const resetForm = () => {
    setEditingId(null);
    setNotifyByEmail(false);
    setForm(EMPTY_FORM);
  };

  const openCreate = () => {
    resetForm();
    // 创建类型跟随当前 toggle（历史合排 tab 已隐藏发布按钮，此处兜底按「合排」处理）
    setForm((prev) => ({ ...prev, type: currentType === "分排" ? "section" : "full" }));
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

  // 二级确认已收敛到详情弹窗（Issue #173：window.confirm「确认删除？」在
  // rehearsal-detail-modal 内完成），此处仅保留删除调用与失败提示
  const handleDelete = async (id: number) => {
    const ok = await remove(id);
    if (!ok) alert("删除失败");
  };

  return (
    /* 根容器 flex 化（矮屏布局，审计批次 3）：头部固定，筛选控件 + 列表整体独立滚动 */
    <div className="flex h-full min-h-0 flex-col space-y-4">
      <header className="mb-2 flex items-center justify-between gap-2">
        <div>
          {/* 标题联动（Issue #171）：历史合排 tab 切换标题与副标题 */}
          <h1 className="text-lg font-semibold text-text">
            {currentType === "历史合排" ? "历史合排" : "排练管理"}
          </h1>
          <p className="mt-1 text-xs text-text-muted">
            {currentType === "历史合排" ? "查看已结束的合排排练" : "发布、编辑、查看排练详情"}
          </p>
        </div>
        {/* 历史合排 tab 不提供发布入口（创建类型跟随 toggle 在历史视图无意义） */}
        {currentType !== "历史合排" && (
          <button
            type="button"
            onClick={openCreate}
            className="rounded-full bg-primary px-3 py-1 text-label font-medium text-primary-foreground shadow-sm hover:opacity-90"
          >
            ➕ 发布新日程
          </button>
        )}
      </header>

      <div className="flex-1 min-h-0 space-y-4 overflow-y-auto">
        <Toggle
          options={["合排", "分排", "历史合排"] as const}
          value={currentType}
          onChange={setCurrentType}
        />

        {/* 日期区间筛选（Issue #173 隐藏）：列表窗口改为「今天起全部未来」（isRehearsalTodayOrFuture），
            区间筛选已无实际用途，通过 false && 隐藏；恢复时删掉 false && 条件即可——
            startDateFilter/endDateFilter 状态与 filterByDateRange 过滤链路均已保留 */}
        {false && (
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
        )}

        <section className="max-h-[400px] space-y-3 overflow-y-auto">
          {loading && <p className="py-6 text-center text-xs text-text-subtle">加载中…</p>}
          {!loading &&
            list.map((item) => (
              <AdminRehearsalCard key={item.id} item={item} onClick={() => setDetailItem(item)} />
            ))}
          {!loading && list.length === 0 && (
            <p className="py-8 text-center text-xs text-text-muted">暂无安排</p>
          )}
        </section>
      </div>

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

      {/* 只读详情（Issue #173）：删除/编辑入口在弹窗内；编辑复用 CreateRehearsalModal 编辑模式 */}
      <RehearsalDetailModal
        item={detailItem}
        onClose={() => setDetailItem(null)}
        onEdit={() => {
          if (!detailItem) return;
          setDetailItem(null);
          openEdit(detailItem);
        }}
        onDelete={() => {
          if (detailItem) handleDelete(detailItem.id);
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
