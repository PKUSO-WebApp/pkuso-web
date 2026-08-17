"use client";

import React from "react";
import { Modal } from "@/components/ui/Modal";
import { useUser } from "@/context/user-context";
import { useLeaveRequests } from "@/hooks/useLeaveRequests";
import { formatDateTimeInChina } from "@/lib/date-utils";
import { formatRehearsalRange } from "@/lib/date-utils";
import type { LeaveRequestRow, LeaveStatus, RehearsalRow } from "@/types/database";

/**
 * 成员端请假/补请假弹窗（Issue #142）。
 *
 * 状态机规则（集中注释，前后端一致）：
 * - 无申请 / 已撤回 / 已取消：表单模式，可提交新申请（target_status 固定 excused）；
 * - pending：只读展示（状态 chip 在标题栏右侧），底部「编辑申请」进入编辑模式
 *   改内容（改内容不改状态），或编辑模式底部「取消请假」（状态 → canceled，
 *   取消后视同无申请，可重新提交）；
 * - approved：只读展示（状态 chip 在标题栏右侧），无底部操作行、无撤回
 *   （Issue #182 移除撤回；撤回能力已下线，历史 withdrawn 数据仅列表过滤兼容）；
 * - rejected：只读展示（状态 chip 在标题栏右侧）+ 驳回原因，底部「重新申请」
 *   （内容预填，保存后状态回 pending 并清空驳回原因）。
 * - 底部操作行（Issue #173/#175/#182）：表单模式「取消」（pending 编辑模式为
 *   「取消请假」，无底色）+ 右侧提交有底色；只读视图状态 chip 在标题栏右侧
 *   （非交互 span，替代原「已提交」与独立状态区——状态只保留这一处），底部
 *   仅按状态分流单个主操作且右对齐：pending → 编辑申请、rejected → 重新申请；
 *   approved 无底部操作行。
 *
 * 附件：私有桶，保存 storage 路径；查看时经 getSignedUrl 换 60s 临时链接。
 * 编辑模式展示当前附件（签名 URL 预览），可「更换图片」（替换后保存时由 hook 删除旧附件）。
 * 防重复提交：同步 ref + state 双重 guard；提交/取消中禁关闭。
 */

type Props = {
  open: boolean;
  rehearsal: RehearsalRow | null;
  onClose: () => void;
  /** 保存成功后通知父级刷新卡片上的申请状态 */
  onSaved: () => void;
};

type Mode = "form" | "view";

const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  pending: "待审批",
  approved: "已通过",
  rejected: "已驳回",
  withdrawn: "已撤回",
  canceled: "已取消",
};

const LEAVE_STATUS_CHIP: Record<LeaveStatus, string> = {
  pending: "bg-warning-bg text-warning",
  approved: "bg-success-bg text-success",
  rejected: "bg-danger-bg text-danger",
  withdrawn: "bg-muted text-text-subtle",
  canceled: "bg-muted text-text-subtle",
};

export function LeaveRequestModal({ open, rehearsal, onClose, onSaved }: Props) {
  const { user } = useUser();
  const {
    fetchMine,
    create,
    updateReason,
    reapply,
    cancelRequest,
    uploadAttachment,
    getSignedUrl,
    saving,
  } = useLeaveRequests();

  // ---- 视图状态 ----
  const [mode, setMode] = React.useState<Mode>("view");
  /** 当前有效（未撤回）申请；编辑中的申请也记录在此 */
  const [current, setCurrent] = React.useState<LeaveRequestRow | null>(null);
  /** 正在编辑的申请（pending 修改 / rejected 重新申请）；null = 新申请 */
  const [editing, setEditing] = React.useState<LeaveRequestRow | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // ---- 表单状态 ----
  const [reason, setReason] = React.useState("");
  const [attachmentFile, setAttachmentFile] = React.useState<File | null>(null);
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = React.useState<string | null>(null);
  /** 编辑模式下未换新图时沿用原附件 */
  const [keepOldAttachment, setKeepOldAttachment] = React.useState(false);
  /** 查看模式的附件签名 URL（当前申请） */
  const [viewAttachmentUrl, setViewAttachmentUrl] = React.useState<string | null>(null);
  /** 编辑模式未换图时展示的旧附件签名 URL */
  const [editAttachmentUrl, setEditAttachmentUrl] = React.useState<string | null>(null);
  const [attachmentLoading, setAttachmentLoading] = React.useState(false);

  // ---- 操作状态 ----
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const submittingRef = React.useRef(false);
  /** 取消请假（pending 编辑模式）：确认内联块 + 防重复提交 guard */
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const [isCanceling, setIsCanceling] = React.useState(false);
  const cancelingRef = React.useRef(false);
  const [zoomImageUrl, setZoomImageUrl] = React.useState<string | null>(null);

  // 打开时加载该排练我的申请（fetchMine 按 created_at 倒序，首个命中即最近一条）
  React.useEffect(() => {
    if (!open || !rehearsal) return;
    let cancelled = false;
    // 打开即进入加载态（异步结果到达后由回调关闭 loading，项目既有模式）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    void (async () => {
      const rows = await fetchMine();
      if (cancelled) return;
      // 有效申请：未撤回且未取消（已取消视同无申请，表单模式可重新提交，Issue #149；
      // withdrawn 为历史数据过滤，撤回功能已下线 Issue #182）
      const found =
        (rows ?? []).find(
          (r) =>
            r.rehearsal_id === rehearsal.id && r.status !== "withdrawn" && r.status !== "canceled",
        ) ?? null;
      if (!cancelled) {
        setCurrent(found);
        setMode(found ? "view" : "form");
        setEditing(null);
        setReason("");
        setAttachmentFile(null);
        setAttachmentPreviewUrl(null);
        setKeepOldAttachment(false);
        setViewAttachmentUrl(null);
        setEditAttachmentUrl(null);
        setConfirmCancel(false);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, rehearsal, fetchMine]);

  // 查看模式的附件签名 URL（60s 临时链接，关闭/切换时丢弃）
  React.useEffect(() => {
    if (!open || mode !== "view" || !current?.attachment_url) {
      // 切换模式/申请时清空签名 URL（避免展示上一份附件）
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setViewAttachmentUrl(null);
      return;
    }
    let cancelled = false;
    setAttachmentLoading(true);
    void (async () => {
      const res = await getSignedUrl(current.attachment_url!);
      if (cancelled) return;
      setViewAttachmentUrl(res.url ?? null);
      setAttachmentLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, mode, current?.id, current?.attachment_url, getSignedUrl]);

  // 编辑模式未换图时：为旧附件生成 60s 签名 URL 预览（切换编辑/换图时丢弃）
  React.useEffect(() => {
    if (!open || mode !== "form" || !editing?.attachment_url || !keepOldAttachment) {
      // 退出编辑/更换图片时清空旧附件签名 URL（避免展示上一份附件）
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEditAttachmentUrl(null);
      return;
    }
    let cancelled = false;
    setAttachmentLoading(true);
    void (async () => {
      const res = await getSignedUrl(editing.attachment_url!);
      if (cancelled) return;
      setEditAttachmentUrl(res.url ?? null);
      setAttachmentLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, mode, editing?.id, editing?.attachment_url, keepOldAttachment, getSignedUrl]);

  const handleClose = () => {
    // 提交/取消中禁关闭（防重复操作与数据中途丢失）
    if (isSubmitting || isCanceling) return;
    if (attachmentPreviewUrl) URL.revokeObjectURL(attachmentPreviewUrl);
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setError(null);
    if (attachmentPreviewUrl) URL.revokeObjectURL(attachmentPreviewUrl);
    if (!file) {
      setAttachmentFile(null);
      setAttachmentPreviewUrl(null);
      return;
    }
    setAttachmentFile(file);
    setAttachmentPreviewUrl(URL.createObjectURL(file));
    setKeepOldAttachment(false);
  };

  const handleClearAttachment = () => {
    if (attachmentPreviewUrl) URL.revokeObjectURL(attachmentPreviewUrl);
    setAttachmentFile(null);
    setAttachmentPreviewUrl(null);
    setKeepOldAttachment(false);
  };

  /** 进入编辑模式（pending「修改」/ rejected「重新申请」共用，提交时按状态分流） */
  const handleEdit = () => {
    if (!current) return;
    setEditing(current);
    setReason(current.reason);
    setKeepOldAttachment(!!current.attachment_url);
    setAttachmentFile(null);
    setAttachmentPreviewUrl(null);
    setEditAttachmentUrl(null);
    setConfirmCancel(false);
    setError(null);
    setMode("form");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // 双重防重复提交：同步 ref 阻断连点，state 异步兜底（禁用按钮）
    if (submittingRef.current || isSubmitting) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("请填写请假原因");
      return;
    }
    if (!user?.id) {
      setError("登录状态失效，请重新登录");
      return;
    }
    if (!rehearsal) return;

    submittingRef.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      // 附件：新选文件先上传私有桶；编辑模式下未换图沿用原附件路径
      let attachmentUrl: string | null = keepOldAttachment
        ? (current?.attachment_url ?? null)
        : null;
      if (attachmentFile) {
        const up = await uploadAttachment(attachmentFile, user.id);
        if (up.error) {
          setError(`附件上传失败：${up.error}`);
          return;
        }
        attachmentUrl = up.url ?? null;
      }

      let ok: boolean;
      if (editing) {
        // 编辑已有申请：rejected → 重新申请（状态回 pending 并清驳回原因）；pending → 改内容。
        // 换图时携带旧附件路径，由 hook 在保存成功后删除旧附件（Issue #149）
        const editPayload = {
          reason: trimmed,
          attachment_url: attachmentUrl,
          old_attachment_url: current?.attachment_url ?? null,
        };
        ok =
          editing.status === "rejected"
            ? await reapply(editing.id, editPayload)
            : await updateReason(editing.id, editPayload);
      } else {
        // 新申请：固定请假（excused）目标状态（撤回后重新选择目标状态的流程已下线，Issue #182）
        ok = await create({
          rehearsal_id: rehearsal.id,
          user_id: user.id,
          reason: trimmed,
          attachment_url: attachmentUrl,
          target_status: "excused",
        });
      }
      if (!ok) return; // hook 已写入 error

      // 保存成功后重新定位最新申请（管理端可能已审批，直接展示最新状态；
      // 已撤回/已取消视同无申请，与打开时过滤一致，Issue #149）
      const rows = await fetchMine();
      const found =
        (rows ?? []).find(
          (r) =>
            r.rehearsal_id === rehearsal.id && r.status !== "withdrawn" && r.status !== "canceled",
        ) ?? null;
      if (attachmentPreviewUrl) URL.revokeObjectURL(attachmentPreviewUrl);
      setCurrent(found);
      setMode(found ? "view" : "form");
      setEditing(null);
      setReason("");
      setAttachmentFile(null);
      setAttachmentPreviewUrl(null);
      setKeepOldAttachment(false);
      setViewAttachmentUrl(null);
      setEditAttachmentUrl(null);
      setConfirmCancel(false);
      setError(null);
      onSaved();
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  /** 取消请假（仅 pending 编辑模式）：状态 → canceled 后关闭弹窗，父级刷新卡片 */
  const handleCancelRequest = async () => {
    // 双重防重复提交：同步 ref 阻断连点，state 异步兜底（禁用按钮）
    if (cancelingRef.current || isCanceling || !editing) return;
    cancelingRef.current = true;
    setIsCanceling(true);
    setError(null);
    try {
      // 传入被取消的申请行：hook 顺带删除附件（失败不影响取消）
      const ok = await cancelRequest(editing.id, editing);
      if (!ok) return;
      // 取消成功：视同无申请，关闭弹窗并通知父级刷新卡片（可重新提交申请）
      if (attachmentPreviewUrl) URL.revokeObjectURL(attachmentPreviewUrl);
      setConfirmCancel(false);
      onClose();
      onSaved();
    } finally {
      cancelingRef.current = false;
      setIsCanceling(false);
    }
  };

  const busy = isSubmitting || isCanceling || saving;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="请假申请"
      position="bottom"
      closeOnOverlay={!busy}
      headerExtra={
        /* 状态 chip（非交互 span，Issue #175/#182）：只读视图时位于标题栏右侧 */
        mode === "view" && current ? (
          <span
            className={`rounded-full px-3 py-1 text-label ${
              LEAVE_STATUS_CHIP[current.status as LeaveStatus] ?? "bg-muted text-text-subtle"
            }`}
          >
            {LEAVE_STATUS_LABEL[current.status as LeaveStatus] ?? current.status}
          </span>
        ) : null
      }
    >
      {loading ? (
        <p className="py-8 text-center text-xs text-text-muted">加载中…</p>
      ) : mode === "view" && current ? (
        /* ---------------- 只读视图 ---------------- */
        <div className="space-y-3">
          {/* 申请时间（右对齐；状态 chip 在标题栏右侧，状态只保留一处，Issue #175/#182） */}
          <div className="flex justify-end">
            <span className="text-label text-text-subtle">
              申请于 {formatDateTimeInChina(current.created_at)}
            </span>
          </div>

          <div className="rounded-xl border border-border bg-surface p-3">
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-text">
              {current.reason}
            </p>
          </div>

          {/* 附件（签名 URL，点击放大） */}
          {current.attachment_url && (
            <div>
              <p className="mb-1 text-label text-text-muted">附件图片</p>
              {attachmentLoading ? (
                <p className="text-xs text-text-subtle">加载中…</p>
              ) : viewAttachmentUrl ? (
                <button
                  type="button"
                  onClick={() => setZoomImageUrl(viewAttachmentUrl)}
                  className="block overflow-hidden rounded-xl border border-border"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={viewAttachmentUrl}
                    alt="请假附件"
                    className="max-h-48 w-full object-contain"
                  />
                </button>
              ) : (
                <p className="text-xs text-danger">附件加载失败</p>
              )}
            </div>
          )}

          {/* 驳回原因 */}
          {current.status === "rejected" && current.reject_reason && (
            <div className="rounded-xl border border-danger/30 bg-danger/5 p-3">
              <p className="text-sm font-medium text-danger">驳回原因</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-danger">
                {current.reject_reason}
              </p>
            </div>
          )}

          {/* 底部操作行（Issue #173/#175/#182）：仅 pending/rejected 有单个主操作
              （右对齐）；approved 无底部操作行（撤回能力已下线） */}
          {(current.status === "pending" || current.status === "rejected") && (
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={busy}
                onClick={handleEdit}
                className="rounded-full bg-primary px-4 py-1.5 text-label font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
              >
                {current.status === "pending" ? "编辑申请" : "重新申请"}
              </button>
            </div>
          )}
        </div>
      ) : (
        /* ---------------- 表单模式 ---------------- */
        <form onSubmit={handleSubmit} className="space-y-3">
          {/* 日程信息（只读） */}
          <div className="rounded-xl border border-border bg-surface p-3">
            <p className="text-sm font-medium text-text">
              {rehearsal?.start_time
                ? formatRehearsalRange(rehearsal.start_time, rehearsal.end_time ?? null)
                : "时间未设置"}
            </p>
            <p className="mt-0.5 text-xs text-text-muted">
              {rehearsal?.repertoire} · 地点：{rehearsal?.location ?? "未设置"}
            </p>
          </div>

          <div>
            <label className="mb-1 block text-label text-text-muted" htmlFor="leave-reason">
              请假原因<span className="text-danger">*</span>
            </label>
            {/* 弃用 .input（固定高度覆盖 rows）+ 去掉 resize-none，恢复可拖拽拉长（审计清理） */}
            <textarea
              id="leave-reason"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError(null);
              }}
              rows={8}
              className="w-full rounded-xl border border-border bg-muted px-3 py-3 text-xs text-text outline-none focus:border-text-muted leading-[1.5]"
              placeholder="请说明请假/补请假原因…"
              maxLength={500}
            />
          </div>

          {/* 附件（选填，仅图片） */}
          <div>
            <p className="mb-1 text-label text-text-muted">附件图片（选填）</p>
            {attachmentPreviewUrl ? (
              <div className="space-y-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={attachmentPreviewUrl}
                  alt="附件预览"
                  className="max-h-40 rounded-xl border border-border object-contain"
                />
                <button
                  type="button"
                  onClick={handleClearAttachment}
                  className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-text-muted hover:bg-muted"
                >
                  移除附件
                </button>
              </div>
            ) : keepOldAttachment ? (
              /* 编辑模式未换图：展示旧附件签名 URL 预览，可更换图片（替换）或移除 */
              <div className="space-y-2">
                {attachmentLoading ? (
                  <p className="text-xs text-text-subtle">加载中…</p>
                ) : editAttachmentUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={editAttachmentUrl}
                    alt="当前附件"
                    className="max-h-40 rounded-xl border border-border object-contain"
                  />
                ) : (
                  <p className="text-xs text-danger">附件加载失败</p>
                )}
                <div className="flex gap-2">
                  <label className="flex flex-1 cursor-pointer items-center justify-center rounded-xl border border-dashed border-border bg-surface px-3 py-2 text-sm text-text-muted hover:bg-muted">
                    更换图片
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleClearAttachment}
                    className="flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text-muted hover:bg-muted"
                  >
                    移除附件
                  </button>
                </div>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-border bg-surface px-3 py-4 text-sm text-text-muted hover:bg-muted">
                点击选择图片
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            )}
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          {/* 取消请假内联确认（仅 pending 编辑模式，Issue #149/#175/#182）：入口在底部
              操作行左侧，确认块位于操作行上方（先确认、后操作） */}
          {editing?.status === "pending" && confirmCancel && (
            <div className="rounded-xl border border-danger/30 bg-danger/5 p-3">
              <p className="mb-3 text-sm text-danger">
                确认取消该请假申请？取消后视为无申请，可重新提交申请。
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmCancel(false)}
                  className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-muted hover:bg-muted disabled:opacity-60"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleCancelRequest}
                  className="flex-1 rounded-lg bg-danger px-3 py-2 text-sm text-danger-foreground hover:opacity-90 disabled:opacity-60"
                >
                  {isCanceling ? "取消中…" : "确认取消"}
                </button>
              </div>
            </div>
          )}

          {/* 底部操作（Issue #173/#175/#182）：左侧「取消」/「取消请假」+ 右侧提交
              （无底色小按钮，对齐 community 编辑弹窗的取消/保存样式）；pending 编辑
              模式左侧为「取消请假」（原独立整行入口并入此位，状态 → canceled），
              其余场景「取消」关闭弹窗（含编辑模式，原「返回」按钮随之移除——
              编辑内容未保存直接关闭） */}
          <div className="flex items-center justify-end gap-2 pt-1">
            {editing?.status === "pending" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmCancel(true)}
                className="rounded-full px-4 py-1.5 text-label text-danger disabled:opacity-60"
              >
                取消请假
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={handleClose}
                className="rounded-full px-4 py-1.5 text-label text-text-muted disabled:opacity-60"
              >
                取消
              </button>
            )}
            <button
              type="submit"
              disabled={busy}
              className="rounded-full bg-primary px-4 py-1.5 text-label font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {isSubmitting
                ? "提交中…"
                : editing?.status === "rejected"
                  ? "重新提交"
                  : editing
                    ? "保存修改"
                    : "提交申请"}
            </button>
          </div>
        </form>
      )}

      {/* 图片放大查看浮层 */}
      {zoomImageUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setZoomImageUrl(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomImageUrl}
            alt="附件放大查看"
            className="max-h-[90vh] max-w-full rounded-2xl object-contain"
          />
        </div>
      )}
    </Modal>
  );
}
