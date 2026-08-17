"use client";

import React from "react";
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
 * cancelOnSignIn 返回值（返工）：ok 为 false 时区分失败原因，供页面出不同提示文案——
 * - "already-processed"：SELECT 与 UPDATE 间隙管理员并发处理了申请（驳回/审批），
 *   申请已不归成员掌控，无需再取消；
 * - "network"：查询/更新本身失败（网络或数据库错误），需联系管理员处理。
 */
export type CancelOnSignInResult =
  { ok: true } | { ok: false; reason: "already-processed" | "network" };

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
   * 撤回已通过的申请（状态 → withdrawn，Issue #155）。
   * 撤回只改申请状态，考勤保持现状：审批时按 target_status 写入的考勤记录不再还原为缺勤
   * （移除 #149 的考勤联动逻辑）。成员如需调整考勤，可在撤回后的新申请中选择目标状态
   * 重新提交，待管理端审批通过后按新 target_status 记录。
   */
  const withdraw = React.useCallback(
    async (id: string) => {
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

  /**
   * 覆盖请假签到后撤销有效申请（Issue #155）：将本排练当前 pending/approved 的申请
   * 记为 canceled，已驳回维持不变（驳回是管理端结论，签到不覆盖）。
   * 与 cancelRequest 的区别：cancelRequest 仅限 pending 单行（成员主动取消），本方法
   * 按排练批量处理两种状态——签到覆盖是签到的配套动作，approved 申请同样失效。
   * 附件处理与 cancelRequest 同语义（best effort，失败仅遗留孤儿文件，不阻断撤销）。
   * 并发安全（返工）：UPDATE 精确到 SELECT 快照返回的 id 集合（不再按 rehearsal_id +
   * status 宽匹配），并以 UPDATE 返回的已更新 id 与快照取交集——间隙管理员并发驳回的
   * 行不在交集内，其附件（属审批结果一部分）不会被误删；全部被并发处理后 0 行更新，
   * 跳过附件清理并返回 { ok: false, reason: "already-processed" } 由页面提示无需取消。
   * 签到已成功写入考勤，本方法为配套动作：失败返回 { ok: false } 不阻断签到流程。
   */
  const cancelOnSignIn = React.useCallback(
    async (rehearsalId: number): Promise<CancelOnSignInResult> => {
      setSaving(true);
      try {
        // 先查待撤销的申请（含附件路径，用于清理私有桶附件）
        const { data: rows, error: qErr } = await client
          .from("leave_requests")
          .select("id, attachment_url")
          .eq("rehearsal_id", rehearsalId)
          .in("status", ["pending", "approved"]);
        if (qErr) {
          setError(qErr.message);
          return { ok: false, reason: "network" };
        }
        const active = (rows as Pick<LeaveRequestRow, "id" | "attachment_url">[] | null) ?? [];
        const activeIds = active.map((r) => r.id);
        if (activeIds.length > 0) {
          const { data: updated, error: dbError } = await client
            .from("leave_requests")
            .update({ status: "canceled" })
            .in("id", activeIds)
            .in("status", ["pending", "approved"])
            .select("id");
          if (dbError) {
            setError(dbError.message);
            return { ok: false, reason: "network" };
          }
          // 0 行更新检测：SELECT 与 UPDATE 间隙管理员并发处理了全部申请（如驳回），
          // update 匹配 0 行——申请已不归成员掌控，跳过附件清理（附件属审批结果一部分，
          // 误删会破坏已驳回申请的追溯），按 already-processed 返回由页面提示无需取消
          if (!updated || updated.length === 0) {
            setError("申请已被处理，请刷新后重试");
            return { ok: false, reason: "already-processed" };
          }
          // 附件清理只针对「实际被撤销行 ∩ SELECT 快照」：UPDATE 精确到 id 集合后，
          // 返回的 updated 即真正置 canceled 的行；并发中被管理员改状态（如驳回）的
          // 行不在 updated 内，其附件保留。删除失败不阻断撤销（同 cancelRequest 容错语义）
          const updatedIds = new Set((updated as { id: string }[]).map((r) => r.id));
          for (const r of active) {
            if (r.attachment_url && updatedIds.has(r.id)) {
              const { error: removeError } = await client.storage
                .from("leave-attachments")
                .remove([extractAttachmentPath(r.attachment_url)]);
              if (removeError) {
                // 忽略：存储删除失败不阻断撤销（仅遗留孤儿文件）
              }
            }
          }
        }
        await fetchMine();
        setError(null);
        return { ok: true };
      } finally {
        setSaving(false);
      }
    },
    [client, fetchMine],
  );

  /** 上传附件到私有桶（路径沿用 usePosts.uploadImage 的 <user_id>/<时间戳>-<文件名> 模式），返回 storage 路径 */
  const uploadAttachment = React.useCallback(
    async (file: File, userId: string) => {
      // 文件名消毒：与 usePosts.uploadImage 同规则（含中文/空格的文件名作 storage key
      // 会被 Supabase Storage 拒绝，400 InvalidKey）；保留 [A-Za-z0-9._-]，其余替换为 "-"
      const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "-") || "image";
      const path = `${userId}/${Date.now()}-${safeName}`;
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
    cancelOnSignIn,
    uploadAttachment,
    getSignedUrl,
  };
}
