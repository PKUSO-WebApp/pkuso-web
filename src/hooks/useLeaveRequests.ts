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

/** 编辑保存载荷（updateReason / reapply 共用）：old_attachment_url 为更换前的旧附件路径 */
type EditLeaveRequestPayload = {
  reason: string;
  attachment_url?: string | null;
  old_attachment_url?: string | null;
};

/**
 * 从 attachment_url 提取 storage 文件路径（参考 usePosts.remove 的提取方式）。
 * 兼容两种存储格式：纯路径（本 hook uploadAttachment 保存的格式）与
 * 完整 URL（含 leave-attachments/ 前缀的编码路径）；文件名含未编码 % 等
 * 字符导致 decodeURIComponent 抛错时原样返回（raw path 本就无需解码）。
 */
function extractAttachmentPath(attachmentUrl: string): string {
  const marker = "leave-attachments/";
  const idx = attachmentUrl.indexOf(marker);
  const encodedPath = idx !== -1 ? attachmentUrl.slice(idx + marker.length) : attachmentUrl;
  try {
    return decodeURIComponent(encodedPath);
  } catch {
    return encodedPath;
  }
}

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

  /**
   * 编辑保存后删除被替换的旧附件（仅当换图：旧附件非空、新附件非空且两者不同）。
   * 删除失败静默容忍——DB 更新已成功，旧文件仅是孤儿存储，不应让保存报错。
   * 注意：supabase storage.remove 不抛异常，失败经返回的 error 对象表达，需显式检查。
   */
  const removeOldAttachment = React.useCallback(
    async (payload: EditLeaveRequestPayload) => {
      const oldUrl = payload.old_attachment_url;
      const newUrl = payload.attachment_url;
      if (!oldUrl || !newUrl || oldUrl === newUrl) return;
      const { error: removeError } = await client.storage
        .from("leave-attachments")
        .remove([extractAttachmentPath(oldUrl)]);
      if (removeError) {
        // 忽略：旧附件删除失败（如已被并发操作删除）不阻断编辑保存
      }
    },
    [client],
  );

  /** 修改申请内容（仅限 pending 行：待审批中可改内容，不可改状态）。
   * 编辑换图（old_attachment_url 非空且与新附件不同）时，更新成功后删除旧附件；
   * 旧附件删除失败不影响保存本身（新附件已上传成功，仅遗留孤儿文件）。
   * 0 行更新检测：管理员并发审批通过后 status 已非 pending，update 匹配 0 行——
   * 此时申请已不归成员掌控，不得删除旧附件（附件随审批结果保留），直接报错返回。 */
  const updateReason = React.useCallback(
    async (id: string, payload: EditLeaveRequestPayload) => {
      setSaving(true);
      const { data, error: dbError } = await client
        .from("leave_requests")
        .update({ reason: payload.reason, attachment_url: payload.attachment_url ?? null })
        .eq("id", id)
        .eq("status", "pending")
        .select("id");
      setSaving(false);
      if (dbError) {
        setError(dbError.message);
        return false;
      }
      if (!data || data.length === 0) {
        setError("申请已被处理，请刷新后重试");
        return false;
      }
      await removeOldAttachment(payload);
      await fetchMine();
      setError(null);
      return true;
    },
    [client, fetchMine, removeOldAttachment],
  );

  /** 被驳回后重新申请：更新内容，状态打回 pending、清空驳回原因（仅限 rejected 行）；
   * 换图时同样删除旧附件（与 updateReason 同语义，见 Issue #149）。
   * 0 行更新检测：管理员并发处理（重新驳回/审批）后 status 已非 rejected，
   * update 匹配 0 行时不得删除旧附件，直接报错返回。 */
  const reapply = React.useCallback(
    async (id: string, payload: EditLeaveRequestPayload) => {
      setSaving(true);
      const { data, error: dbError } = await client
        .from("leave_requests")
        .update({
          reason: payload.reason,
          attachment_url: payload.attachment_url ?? null,
          status: "pending",
          reject_reason: null,
        })
        .eq("id", id)
        .eq("status", "rejected")
        .select("id");
      setSaving(false);
      if (dbError) {
        setError(dbError.message);
        return false;
      }
      if (!data || data.length === 0) {
        setError("申请已被处理，请刷新后重试");
        return false;
      }
      await removeOldAttachment(payload);
      await fetchMine();
      setError(null);
      return true;
    },
    [client, fetchMine, removeOldAttachment],
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

  /**
   * 取消待审批的申请（状态 → canceled，Issue #149）。
   * 与 withdraw 不同：pending 申请尚未生效（考勤未改写），取消无需考勤联动；
   * 取消后卡片视同无申请，成员可重新提交。
   * 附件处理：若申请带附件，顺带删除私有桶中的附件——删除失败不影响状态取消
   * （已取消的申请仍可追溯，仅遗留孤儿文件）。
   * 0 行更新检测：管理员并发审批通过后 status 已非 pending，update 匹配 0 行——
   * 此时不得删除附件（申请已通过，附件属审批结果一部分），直接报错返回。
   * @param request - 被取消的申请行（含 attachment_url），由调用方传入当前展示的申请。
   */
  const cancelRequest = React.useCallback(
    async (id: string, request?: Pick<LeaveRequestRow, "attachment_url"> | null) => {
      setSaving(true);
      const { data, error: dbError } = await client
        .from("leave_requests")
        .update({ status: "canceled" })
        .eq("id", id)
        .eq("status", "pending")
        .select("id");
      setSaving(false);
      if (dbError) {
        setError(dbError.message);
        return false;
      }
      if (!data || data.length === 0) {
        setError("申请已被处理，请刷新后重试");
        return false;
      }
      // 附件删除失败不影响状态取消（参考 usePosts.remove 的容错语义）
      if (request?.attachment_url) {
        const { error: removeError } = await client.storage
          .from("leave-attachments")
          .remove([extractAttachmentPath(request.attachment_url)]);
        if (removeError) {
          // 忽略：存储删除失败不阻断取消（已取消的申请仍可追溯，仅遗留孤儿文件）
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
    cancelRequest,
    uploadAttachment,
    getSignedUrl,
  };
}
