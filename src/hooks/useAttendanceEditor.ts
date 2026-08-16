"use client";

import React from "react";
import { useAttendance } from "@/hooks/useAttendance";
import type { AttendanceRowWithUser, AttendanceStatus, RehearsalRow } from "@/types/database";

/**
 * admin 考勤查看/编辑弹窗的共享状态逻辑
 * （admin/rehearsals 与 admin/members 两页共用，避免逻辑漂移）
 *
 * 用法：调用方渲染
 * <AttendanceModal open={!!attendanceRehearsal} ... editable onStatusChange={...} onSave={...} />
 */
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
      const errMsg = await updateStatus(rehearsal.id, userId, status as AttendanceStatus);
      if (errMsg) hasError = true;
    }
    setSaving(false);
    savingRef.current = false;
    if (hasError) alert("部分出勤更新失败，请刷新后重试");
    // 刷新列表
    const rows = await fetchByRehearsal(rehearsal.id);
    setList(rows);
    pendingChanges.current.clear();
  }, [rehearsal, saving, fetchByRehearsal, updateStatus]);

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
