"use client";

import React from "react";
import { hasSignedIn } from "@/lib/attendance-utils";
import { supabase as defaultClient } from "@/lib/supabase";
import type { AttendanceStatus, LeaveRequestRow, LeaveRequestWithDetails } from "@/types/database";

/** 新申请载荷（target_status 缺省时由数据库默认 excused，前端默认传 excused） */
export type LeaveRequestPayload = {
  rehearsal_id: number;
  user_id: string;
  reason: string;
  attachment_url?: string | null;
  target_status?: AttendanceStatus;
};

/**
 * 成员端请假/补请假 hook（Issue #142）。
 * - 数据受 RLS 约束：仅本人可见/操作自己的申请；
 * - 附件上传到私有桶 leave-attachments（路径 <user_id>/<时间戳>-<文件名>），
 *   私有桶无公开 URL，保存的是 storage 路径，查看时经 getSignedUrl 换 60s 临时链接；
 * - 提交策略：写操作成功后统一 refetch（放弃乐观更新）——申请列表常与
 *   管理端审批联动（状态会变），refetch 保证成员端展示与管理端一致。
 */
export function useLeaveRequests(client: typeof defaultClient = defaultClient) {
  const [data, setData] = React.useState<LeaveRequestWithDetails[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  /** 查当前用户全部申请（含排练信息 join），按 created_at 倒序 */
  const fetchMine = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: rows, error: dbError } = await client
      .from("leave_requests")
      .select("*, rehearsals(repertoire, title, start_time, end_time, location)")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (dbError) {
      setError(dbError.message);
      setData([]);
      return null;
    }
    const list = (rows as LeaveRequestWithDetails[]) ?? [];
    setData(list);
    return list;
  }, [client]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchMine();
  }, [fetchMine]);

  /** 新建申请（RLS 校验 user_id 必须是本人） */
  const create = React.useCallback(
    async (payload: LeaveRequestPayload) => {
      setSaving(true);
      const { error: dbError } = await client.from("leave_requests").insert({
        rehearsal_id: payload.rehearsal_id,
        user_id: payload.user_id,
        reason: payload.reason,
        attachment_url: payload.attachment_url ?? null,
        target_status: payload.target_status ?? "excused",
      } as never);
      setSaving(false);
      if (dbError) {
        setError(dbError.message);
        return false;
      }
      await fetchMine();
      setError(null);
      return true;
    },
    [client, fetchMine],
  );

  /** 修改申请内容（仅限 pending 行：待审批中可改内容，不可改状态） */
  const updateReason = React.useCallback(
    async (id: string, payload: { reason: string; attachment_url?: string | null }) => {
      setSaving(true);
      const { error: dbError } = await client
        .from("leave_requests")
        .update({ reason: payload.reason, attachment_url: payload.attachment_url ?? null })
        .eq("id", id)
        .eq("status", "pending");
      setSaving(false);
      if (dbError) {
        setError(dbError.message);
        return false;
      }
      await fetchMine();
      setError(null);
      return true;
    },
    [client, fetchMine],
  );

  /** 被驳回后重新申请：更新内容，状态打回 pending、清空驳回原因（仅限 rejected 行） */
  const reapply = React.useCallback(
    async (id: string, payload: { reason: string; attachment_url?: string | null }) => {
      setSaving(true);
      const { error: dbError } = await client
        .from("leave_requests")
        .update({
          reason: payload.reason,
          attachment_url: payload.attachment_url ?? null,
          status: "pending",
          reject_reason: null,
        })
        .eq("id", id)
        .eq("status", "rejected");
      setSaving(false);
      if (dbError) {
        setError(dbError.message);
        return false;
      }
      await fetchMine();
      setError(null);
      return true;
    },
    [client, fetchMine],
  );

  /**
   * 撤回已通过的申请（状态 → withdrawn）。
   * 撤回后联动还原考勤（与 #141 前端锁定语义一致）：若该排练的考勤行未签到
   * （sign_in_time 为空）且当前状态与申请 target_status 一致（说明由审批改写），
   * 还原为 absent——避免「撤回后不再重新提交 → 永久 excused 且无有效申请」；
   * 已签到（sign_in_time 非空，锁定）则考勤不动。
   *
   * 选择「hook 内直连 supabase 改 attendance」而非回调注入：考勤联动是撤回操作
   * 领域逻辑的一部分（与管理端审批联动考勤对应），集中在 hook 一处，调用方
   * 无需（也不可能遗忘）自己补还原步骤——本次返工的漏洞正是调用方不负责联动所致。
   * 成员端 RLS 允许本人更新自己的考勤行（签到 upsert 同款通路），无需走服务端 API。
   * @param request - 被撤回的申请行（含 rehearsal_id/user_id/target_status），
   * 由调用方传入当前展示的申请；缺省时仅撤回申请不动考勤。
   */
  const withdraw = React.useCallback(
    async (
      id: string,
      request?: Pick<LeaveRequestRow, "rehearsal_id" | "user_id" | "target_status"> | null,
    ) => {
      setSaving(true);
      const { error: dbError } = await client
        .from("leave_requests")
        .update({ status: "withdrawn" })
        .eq("id", id)
        .eq("status", "approved");
      setSaving(false);
      if (dbError) {
        setError(dbError.message);
        return false;
      }
      // 考勤联动：未签到（sign_in_time 空）且状态与 target_status 一致（审批改写）→
      // 还原为 absent；已签到锁定 / 管理员另行改写（状态不一致）→ 不动。
      if (request) {
        const { data: att, error: attErr } = await client
          .from("attendances")
          .select("sign_in_time, status")
          .eq("rehearsal_id", request.rehearsal_id)
          .eq("user_id", request.user_id)
          .maybeSingle();
        if (
          !attErr &&
          att &&
          !hasSignedIn(att.sign_in_time) &&
          att.status === request.target_status
        ) {
          const { error: restoreErr } = await client
            .from("attendances")
            .update({ status: "absent" })
            .eq("rehearsal_id", request.rehearsal_id)
            .eq("user_id", request.user_id);
          if (restoreErr) {
            // 撤回本身已成功；还原失败按整体失败返回，调用方可留在原视图重试
            setError(`撤回成功，但考勤还原失败：${restoreErr.message}`);
            return false;
          }
        }
      }
      await fetchMine();
      setError(null);
      return true;
    },
    [client, fetchMine],
  );

  /** 上传附件到私有桶（路径沿用 usePosts.uploadImage 的 <user_id>/<时间戳>-<文件名> 模式），返回 storage 路径 */
  const uploadAttachment = React.useCallback(
    async (file: File, userId: string) => {
      const path = `${userId}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await client.storage
        .from("leave-attachments")
        .upload(path, file, { upsert: false });
      if (uploadError) return { error: uploadError.message };
      // 私有桶无公开 URL，返回路径由 getSignedUrl 换临时链接
      return { url: path };
    },
    [client],
  );

  /** 客户端为私有桶附件生成 60s 签名 URL（本人可读自己的附件，RLS 放行） */
  const getSignedUrl = React.useCallback(
    async (path: string) => {
      const { data, error: urlError } = await client.storage
        .from("leave-attachments")
        .createSignedUrl(path, 60);
      if (urlError) return { error: urlError.message };
      return { url: data.signedUrl };
    },
    [client],
  );

  return {
    data,
    loading,
    error,
    saving,
    fetchMine,
    create,
    updateReason,
    reapply,
    withdraw,
    uploadAttachment,
    getSignedUrl,
  };
}
