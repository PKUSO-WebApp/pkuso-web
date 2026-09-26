"use client";

import React from "react";
import { useAttendance } from "@/hooks/useAttendance";
import { supabase } from "@/lib/supabase";
import type { AttendanceRowWithUser, AttendanceStatus, RehearsalRow } from "@/types/database";

/** 考勤状态中文名（通知文案用，与 lib/attendance-status 的 STATUS_LABEL / attendance-modal 保持一致） */
const ATTENDANCE_STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: "出席",
  late: "迟到",
  absent: "缺勤",
  excused: "请假",
  exempt: "无需出勤",
};

/**
 * admin 考勤查看/编辑弹窗的共享状态逻辑
 * （admin/attendance 与 admin/members 两页共用，避免逻辑漂移）
 *
 * 通知规则（Issue #188，对抗返工）：
 * - 仅「最终值 ≠ 打开弹窗时的行原值」的改动才执行 update + 插通知——
 *   改回原值（present→late→present）无实际变更，不发「已更新」假通知；
 * - updateStatus 成功（无错误）即向该成员插「attendance」通知（category=attendance），
 *   文案含排练名与状态中文名；updateStatus 带 .select("id") 0 行检测——
 *   考勤行被级联删除/RLS 静默失败时返回错误语义，视为失败不插通知；
 * - 通知插入为 best-effort——失败仅 console 记录，不阻断保存主流程。
 *
 * 用法：调用方渲染
 * <AttendanceModal open={!!attendanceRehearsal} rehearsalId={attendanceRehearsal?.id ?? null}
 *   ... editable onStatusChange={...} onSave={...} />
 */

/** 插入考勤状态更新通知（best-effort）：失败仅 console 记录，不阻断保存 */
async function insertAttendanceNotification(
  rehearsal: RehearsalRow,
  userId: string,
  status: AttendanceStatus,
) {
  try {
    const rehearsalName = rehearsal.repertoire ?? rehearsal.title ?? "排练";
    const { error } = await supabase.from("notifications").insert({
      user_id: userId,
      category: "attendance",
      title: "考勤状态已更新",
      content: `《${rehearsalName}》排练的考勤状态已更新为「${ATTENDANCE_STATUS_LABEL[status] ?? status}」`,
    });
    if (error) console.error("[AttendanceEditor] 通知插入失败", error.message);
  } catch (err) {
    console.error("[AttendanceEditor] 通知插入失败", err);
  }
}
export function useAttendanceEditor() {
  const { loading, fetchByRehearsal, updateStatus } = useAttendance();

  const [rehearsal, setRehearsal] = React.useState<RehearsalRow | null>(null);
  const [list, setList] = React.useState<AttendanceRowWithUser[]>([]);
  const [saving, setSaving] = React.useState(false);
  const savingRef = React.useRef(false); // 同步 guard，与 saving state 组成双防重复提交
  const pendingChanges = React.useRef<Map<string, string>>(new Map<string, string>());
  // 当前排练 id 的同步镜像（跟随 openAttendance/close 写入，不经过渲染）。保存收尾时用它
  // 判断「这一场还是不是当前场」——否则保存中切场的收尾请求序号最大，会把上一场的名单
  // 盖到当前场头上（对抗返工 F1）
  const currentRehearsalIdRef = React.useRef<number | null>(null);

  const rehearsalId = rehearsal?.id ?? null;

  // 换排练即清空名单，且必须在渲染期完成：effect 内 setState 会被
  // react-hooks/set-state-in-effect 拦下，而挪到拉取回调里更晚——切换后的首次渲染
  // 会先拿上一场的名单配新排练标题。
  // 键用**排练 id**而非对象身份：与 AttendanceModal 的 localOverrides 重置同键，两边必须
  // 同步重置，否则同一 id 换新对象时会分叉成「界面显示一个存不进去的值」（对抗返工）。
  const [prevRehearsalId, setPrevRehearsalId] = React.useState<number | null>(rehearsalId);
  if (prevRehearsalId !== rehearsalId) {
    setPrevRehearsalId(rehearsalId);
    setList([]);
  }

  // 打开某排练考勤：拉取名单（换场时清空待保存集合在 openAttendance 内完成，见下）
  React.useEffect(() => {
    if (rehearsalId == null) return;
    // rows 为 null = 过期响应（已被更新的一轮取代），忽略
    void fetchByRehearsal(rehearsalId).then((rows) => {
      if (rows) setList(rows);
    });
  }, [rehearsalId, fetchByRehearsal]);

  /** 记录单条考勤状态修改（仅缓存，保存时才写库） */
  const onStatusChange = React.useCallback((userId: string, status: AttendanceStatus) => {
    pendingChanges.current.set(userId, status);
  }, []);

  /** 保存全部待保存修改（同步 ref + 异步 state 双 guard 防重复提交） */
  const save = React.useCallback(async () => {
    if (!rehearsal || rehearsalId == null || savingRef.current || saving) return;
    // 快照：本次保存的是「点下保存那一刻的意图」。若迭代活 Map，循环期间新写入的条目会被
    // 一边遍历一边写入（新 key 被静默保存且发通知），末尾的清理又会把同 key 的新改动抹掉
    const changes = new Map(pendingChanges.current);
    if (changes.size === 0) return;
    savingRef.current = true;
    setSaving(true);
    let hasError = false;
    // 本次真正处理掉的 key（成功落库，或与库值相同无需落库）。失败的 key 不删——
    // 那是「再点一次保存」重试的唯一依据
    const settled = new Set<string>();
    for (const [userId, status] of changes) {
      // 最终值 = 打开弹窗时的行原值：无实际变更，跳过 update 与通知（对抗返工）
      const originalStatus = list.find((r) => r.user_id === userId)?.status;
      if (originalStatus === status) {
        settled.add(userId);
        continue;
      }
      const errMsg = await updateStatus(rehearsalId, userId, status as AttendanceStatus);
      if (errMsg) {
        hasError = true;
      } else {
        settled.add(userId);
        // 考勤更新成功 → 向该成员插通知（best-effort，失败不阻断保存）
        await insertAttendanceNotification(rehearsal, userId, status as AttendanceStatus);
      }
    }
    setSaving(false);
    savingRef.current = false;
    for (const userId of settled) pendingChanges.current.delete(userId);
    // 失败的改动刻意保留（见 settled），故提示「再点一次」而不是「刷新」——刷新页面会丢掉它们。
    // 同时点明关闭即放弃：成功行与失败行在界面上同形，用户看不出哪几行还没落库
    if (hasError) alert("部分出勤更新失败：可再点一次「保存修改」重试，关闭弹窗会丢弃这些改动");
    // 保存期间切了场：本场已不是当前场，此处刷新会以最大序号把旧名单盖到当前场头上（F1）
    if (currentRehearsalIdRef.current !== rehearsalId) return;
    // 刷新列表（rows 为 null = 过期响应，保留现有名单不动）
    const rows = await fetchByRehearsal(rehearsalId);
    if (rows) setList(rows);
  }, [rehearsal, rehearsalId, saving, list, fetchByRehearsal, updateStatus]);

  /**
   * 打开某排练的考勤弹窗。当前 id 镜像与待保存集合在同一事件内同键更新：
   * 若把清空留给 effect，渲染期清 list 与 effect 清 pending 之间会有一个先后差窗口
   * （对抗返工）；id 相同（同一场换新对象引用）时不清，保住未保存的改动。
   */
  const openAttendance = React.useCallback((r: RehearsalRow | null) => {
    const nextId = r?.id ?? null;
    if (currentRehearsalIdRef.current !== nextId) pendingChanges.current.clear();
    currentRehearsalIdRef.current = nextId;
    setRehearsal(r);
  }, []);

  /** 关闭弹窗（保存中不允许关闭） */
  const close = React.useCallback(() => {
    if (savingRef.current || saving) return;
    pendingChanges.current.clear();
    currentRehearsalIdRef.current = null;
    setRehearsal(null);
  }, [saving]);

  return {
    attendanceRehearsal: rehearsal,
    attendanceLoading: loading,
    attendanceList: list,
    attendanceSaving: saving,
    /** 打开某排练的考勤弹窗 */
    openAttendance,
    /** 关闭考勤弹窗 */
    closeAttendance: close,
    /** 记录考勤状态修改 */
    onAttendanceStatusChange: onStatusChange,
    /** 保存考勤修改 */
    saveAttendance: save,
  };
}
