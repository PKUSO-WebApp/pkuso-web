"use client";

import React from "react";
import { useAttendance } from "@/hooks/useAttendance";
import { supabase } from "@/lib/supabase";
import type { AttendanceRowWithUser, AttendanceStatus, RehearsalRow } from "@/types/database";

/** 考勤状态中文名（通知文案用，与 admin/members 的 STATUS_LABEL / attendance-modal 保持一致） */
const ATTENDANCE_STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: "出席",
  late: "迟到",
  absent: "缺席",
  excused: "请假",
};

/**
 * admin 考勤查看/编辑弹窗的共享状态逻辑
 * （admin/rehearsals 与 admin/members 两页共用，避免逻辑漂移）
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
 * <AttendanceModal open={!!attendanceRehearsal} ... editable onStatusChange={...} onSave={...} />
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

  // 打开某排练考勤：每次打开清空待保存变更并拉取名单
  React.useEffect(() => {
    if (!rehearsal) return;
    pendingChanges.current.clear();
    void fetchByRehearsal(rehearsal.id).then((rows) => setList(rows));
  }, [rehearsal, fetchByRehearsal]);

  /** 记录单条考勤状态修改（仅缓存，保存时才写库） */
  const onStatusChange = React.useCallback((userId: string, status: AttendanceStatus) => {
    pendingChanges.current.set(userId, status);
  }, []);

  /** 保存全部待保存修改（同步 ref + 异步 state 双 guard 防重复提交） */
  const save = React.useCallback(async () => {
    if (!rehearsal || savingRef.current || saving) return;
    const changes = pendingChanges.current;
    if (changes.size === 0) return;
    savingRef.current = true;
    setSaving(true);
    let hasError = false;
    for (const [userId, status] of changes) {
      // 最终值 = 打开弹窗时的行原值：无实际变更，跳过 update 与通知（对抗返工）
      const originalStatus = list.find((r) => r.user_id === userId)?.status;
      if (originalStatus === status) continue;
      const errMsg = await updateStatus(rehearsal.id, userId, status as AttendanceStatus);
      if (errMsg) {
        hasError = true;
      } else {
        // 考勤更新成功 → 向该成员插通知（best-effort，失败不阻断保存）
        await insertAttendanceNotification(rehearsal, userId, status as AttendanceStatus);
      }
    }
    setSaving(false);
    savingRef.current = false;
    if (hasError) alert("部分出勤更新失败，请刷新后重试");
    // 刷新列表
    const rows = await fetchByRehearsal(rehearsal.id);
    setList(rows);
    pendingChanges.current.clear();
  }, [rehearsal, saving, list, fetchByRehearsal, updateStatus]);

  /** 关闭弹窗（保存中不允许关闭） */
  const close = React.useCallback(() => {
    if (savingRef.current || saving) return;
    pendingChanges.current.clear();
    setRehearsal(null);
  }, [saving]);

  return {
    attendanceRehearsal: rehearsal,
    attendanceLoading: loading,
    attendanceList: list,
    attendanceSaving: saving,
    /** 打开某排练的考勤弹窗 */
    openAttendance: setRehearsal,
    /** 关闭考勤弹窗 */
    closeAttendance: close,
    /** 记录考勤状态修改 */
    onAttendanceStatusChange: onStatusChange,
    /** 保存考勤修改 */
    saveAttendance: save,
  };
}
