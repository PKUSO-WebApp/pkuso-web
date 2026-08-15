"use client";

import React from "react";
import { Modal } from "@/components/ui/Modal";
import { useUser } from "@/context/user-context";
import { useLeaveRequests } from "@/hooks/useLeaveRequests";
import { formatDateTimeInChina } from "@/lib/date-utils";
import { formatRehearsalRange } from "@/lib/date-utils";
import type {
  AttendanceStatus,
  LeaveRequestRow,
  LeaveStatus,
  RehearsalRow,
} from "@/types/database";

/**
 * 成员端请假/补请假弹窗（Issue #142）。
 *
 * 状态机规则（集中注释，前后端一致）：
 * - 无申请 / 已撤回：表单模式，可提交新申请（target_status 固定 excused）；
 * - pending：只读展示 + 「待审批」chip，可「修改」内容（改内容不改状态）；
 * - approved：只读展示 + 「已通过」chip，可「撤回」；撤回后进入新申请模式，
 *   target_status 单选「正常出勤 / 缺勤」（用于调整已生效的考勤记录）；
 * - rejected：只读展示 + 「已驳回」chip + 驳回原因，可「重新申请」（内容预填，
 *   保存后状态回 pending 并清空驳回原因）。
 *
 * 附件：私有桶，保存 storage 路径；查看时经 getSignedUrl 换 60s 临时链接。
 * 防重复提交：同步 ref + state 双重 guard；提交/撤回中禁关闭。
 */

type Props = {
  open: boolean;
  rehearsal: RehearsalRow | null;
  onClose: () => void;
  /** 保存/撤回成功后通知父级刷新卡片上的申请状态 */
  onSaved: () => void;
};

type Mode = "form" | "view";

const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  pending: "待审批",
  approved: "已通过",
  rejected: "已驳回",
  withdrawn: "已撤回",
};

const LEAVE_STATUS_CHIP: Record<LeaveStatus, string> = {
  pending: "bg-warning-bg text-warning",
  approved: "bg-success-bg text-success",
  rejected: "bg-danger-bg text-danger",
  withdrawn: "bg-muted text-text-subtle",
};

const TARGET_STATUS_OPTIONS: { value: AttendanceStatus; label: string }[] = [
  { value: "present", label: "正常出勤" },
  { value: "absent", label: "缺勤" },
];

export function LeaveRequestModal({ open, rehearsal, onClose, onSaved }: Props) {
  const { user } = useUser();
  const {
    fetchMine,
    create,
    updateReason,
    reapply,
    withdraw,
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
  /** 撤回已通过申请后进入的新申请模式：需选择目标出勤状态 */
  const [afterWithdraw, setAfterWithdraw] = React.useState(false);
  const [targetStatus, setTargetStatus] = React.useState<AttendanceStatus | "">("excused");
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
  const [attachmentLoading, setAttachmentLoading] = React.useState(false);

  // ---- 操作状态 ----
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const submittingRef = React.useRef(false);
  const [isWithdrawing, setIsWithdrawing] = React.useState(false);
  const withdrawingRef = React.useRef(false);
  const [confirmWithdraw, setConfirmWithdraw] = React.useState(false);
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
      const found =
        (rows ?? []).find((r) => r.rehearsal_id === rehearsal.id && r.status !== "withdrawn") ??
        null;
      if (!cancelled) {
        setCurrent(found);
        setMode(found ? "view" : "form");
        setEditing(null);
        setAfterWithdraw(false);
        setTargetStatus("excused");
        setReason("");
        setAttachmentFile(null);
        setAttachmentPreviewUrl(null);
        setKeepOldAttachment(false);
        setViewAttachmentUrl(null);
        setConfirmWithdraw(false);
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

  const handleClose = () => {
    // 提交/撤回中禁关闭（防重复操作与数据中途丢失）
    if (isSubmitting || isWithdrawing) return;
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
    if (afterWithdraw && !targetStatus) {
      setError("请选择目标出勤状态");
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
        // 编辑已有申请：rejected → 重新申请（状态回 pending 并清驳回原因）；pending → 改内容
        ok =
          editing.status === "rejected"
            ? await reapply(editing.id, { reason: trimmed, attachment_url: attachmentUrl })
            : await updateReason(editing.id, {
                reason: trimmed,
                attachment_url: attachmentUrl,
              });
      } else {
        // 新申请：撤回已通过申请后需显式选择目标状态，否则固定请假（excused）
        ok = await create({
          rehearsal_id: rehearsal.id,
          user_id: user.id,
          reason: trimmed,
          attachment_url: attachmentUrl,
          target_status: afterWithdraw ? (targetStatus as AttendanceStatus) : "excused",
        });
      }
      if (!ok) return; // hook 已写入 error

      // 保存成功后重新定位最新申请（管理端可能已审批，直接展示最新状态）
      const rows = await fetchMine();
      const found =
        (rows ?? []).find((r) => r.rehearsal_id === rehearsal.id && r.status !== "withdrawn") ??
        null;
      if (attachmentPreviewUrl) URL.revokeObjectURL(attachmentPreviewUrl);
      setCurrent(found);
      setMode(found ? "view" : "form");
      setEditing(null);
      setAfterWithdraw(false);
      setTargetStatus("excused");
      setReason("");
      setAttachmentFile(null);
      setAttachmentPreviewUrl(null);
      setKeepOldAttachment(false);
      setViewAttachmentUrl(null);
      setError(null);
      onSaved();
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleWithdraw = async () => {
    // 双重防重复提交
    if (withdrawingRef.current || isWithdrawing || !current) return;
    withdrawingRef.current = true;
    setIsWithdrawing(true);
    setError(null);
    try {
      // 传入被撤回的申请行：hook 据此联动还原考勤（未签到时恢复缺勤，已签到锁定不动）
      const ok = await withdraw(current.id, current);
      if (!ok) return;
      // 撤回后进入新申请模式：选择目标出勤状态（正常出勤/缺勤）重新提交
      setConfirmWithdraw(false);
      setCurrent(null);
      setEditing(null);
      setMode("form");
      setAfterWithdraw(true);
      setTargetStatus("");
      setReason("");
      setAttachmentFile(null);
      setAttachmentPreviewUrl(null);
      setKeepOldAttachment(false);
      setViewAttachmentUrl(null);
      setError(null);
      onSaved();
    } finally {
      withdrawingRef.current = false;
      setIsWithdrawing(false);
    }
  };

  const busy = isSubmitting || isWithdrawing || saving;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="请假申请"
      position="bottom"
      closeOnOverlay={!busy}
    >
      {loading ? (
        <p className="py-8 text-center text-xs text-text-muted">加载中…</p>
      ) : mode === "view" && current ? (
        /* ---------------- 只读视图 ---------------- */
        <div className="space-y-3">
          {/* 状态 chip 左上角 */}
          <div className="flex items-center justify-between">
            <span
              className={`rounded-full px-3 py-1 text-label ${
                LEAVE_STATUS_CHIP[current.status as LeaveStatus] ?? "bg-muted text-text-subtle"
              }`}
            >
              {LEAVE_STATUS_LABEL[current.status as LeaveStatus] ?? current.status}
            </span>
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

          {/* 撤回确认（内联，不叠加 Modal） */}
          {confirmWithdraw && (
            <div className="rounded-xl border border-warning/30 bg-warning/5 p-3">
              <p className="mb-3 text-sm text-warning">
                确认撤回该请假申请？撤回后考勤恢复为缺勤（未签到时），已签到状态不受影响，可重新提交申请。
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmWithdraw(false)}
                  className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-muted hover:bg-muted disabled:opacity-60"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleWithdraw}
                  className="flex-1 rounded-lg bg-danger px-3 py-2 text-sm text-danger-foreground hover:opacity-90 disabled:opacity-60"
                >
                  {isWithdrawing ? "撤回中…" : "确认撤回"}
                </button>
              </div>
            </div>
          )}

          {/* 状态对应操作 */}
          {current.status === "pending" && (
            <button
              type="button"
              disabled={busy}
              onClick={handleEdit}
              className="w-full rounded-xl bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              修改申请
            </button>
          )}
          {current.status === "approved" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmWithdraw(true)}
              className="w-full rounded-xl border border-border bg-surface py-2.5 text-sm font-medium text-danger hover:bg-muted disabled:opacity-60"
            >
              撤回申请
            </button>
          )}
          {current.status === "rejected" && (
            <button
              type="button"
              disabled={busy}
              onClick={handleEdit}
              className="w-full rounded-xl bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              重新申请
            </button>
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

          {/* 撤回已通过申请后的目标状态选择 */}
          {afterWithdraw && (
            <div className="rounded-xl border border-border bg-surface p-3">
              <p className="mb-2 text-sm font-medium text-text">
                目标出勤状态（已撤回原请假，考勤记录需调整）
              </p>
              <div className="flex gap-2">
                {TARGET_STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      setTargetStatus(opt.value);
                      setError(null);
                    }}
                    className={`flex-1 rounded-full px-3 py-2 text-sm font-medium transition-colors ${
                      targetStatus === opt.value
                        ? "bg-primary text-primary-foreground"
                        : "border border-border bg-surface text-text-muted"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-label text-text-muted" htmlFor="leave-reason">
              请假原因<span className="text-danger">*</span>
            </label>
            <textarea
              id="leave-reason"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError(null);
              }}
              rows={8}
              className="input w-full resize-none p-3 leading-[1.5]"
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
              <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3 py-2">
                <p className="min-w-0 truncate text-xs text-text-muted">已上传附件（未更换）</p>
                <button
                  type="button"
                  onClick={handleClearAttachment}
                  className="shrink-0 rounded-full border border-border bg-surface px-3 py-1 text-xs text-text-muted hover:bg-muted"
                >
                  移除
                </button>
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

          <div className="flex gap-2 pt-1">
            {editing && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (attachmentPreviewUrl) URL.revokeObjectURL(attachmentPreviewUrl);
                  setMode("view");
                  setEditing(null);
                  setError(null);
                }}
                className="flex-1 rounded-xl border border-border bg-surface py-2.5 text-sm font-medium text-text-muted hover:bg-muted disabled:opacity-60"
              >
                返回
              </button>
            )}
            <button
              type="submit"
              disabled={busy}
              className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
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
