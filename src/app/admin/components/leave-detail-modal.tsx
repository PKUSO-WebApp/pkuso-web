"use client";

import React from "react";
import { Modal } from "@/components/ui/Modal";
import { formatDateTimeInChina } from "@/lib/date-utils";
import { formatRehearsalRange } from "@/lib/date-utils";
import type { LeaveRequestWithDetails } from "@/types/database";

/**
 * 请假申请详情弹窗（管理端，Issue #142）。
 * - 完整表单内容 + 附件图片（私有桶签名 URL，点击放大）+ 状态 chip；
 * - pending 时底部固定「通过」「驳回」按钮，驳回需填写原因（必填）；
 *   点「驳回」展开输入块时隐藏底部通过/驳回行（Issue #182 布局统一）；
 * - 审批成功后父级从列表移除本行，弹窗随之自动关闭（open 由 request 是否存在控制）。
 * 防重复提交：同步 ref + state 双重 guard，操作中禁关闭。
 */

type Props = {
  request: LeaveRequestWithDetails | null;
  onClose: () => void;
  /** 通过回调返回 { ok, warnings }（warnings 如成员已实际签到、考勤未联动，Issue #159 返工） */
  onApprove: (id: string) => Promise<{ ok: boolean; warnings: string[] }>;
  onReject: (id: string, reason: string) => Promise<boolean>;
  getSignedUrl: (path: string) => Promise<string | null>;
  /** 父级批量操作进行中：禁用本弹窗操作 */
  processing?: boolean;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "待审批",
  approved: "已通过",
  rejected: "已驳回",
  withdrawn: "已撤回",
  canceled: "已取消",
};

const STATUS_CHIP: Record<string, string> = {
  pending: "bg-warning-bg text-warning",
  approved: "bg-success-bg text-success",
  rejected: "bg-danger-bg text-danger",
  withdrawn: "bg-muted text-text-subtle",
  canceled: "bg-muted text-text-subtle",
};

export function LeaveDetailModal({
  request,
  onClose,
  onApprove,
  onReject,
  getSignedUrl,
  processing,
}: Props) {
  // 驳回原因内联输入
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [rejectReason, setRejectReason] = React.useState("");
  const [rejectError, setRejectError] = React.useState<string | null>(null);
  // 审批操作状态（同步 ref + state 双重 guard）
  const [acting, setActing] = React.useState(false);
  const actingRef = React.useRef(false);
  // 附件签名 URL
  const [attachmentUrl, setAttachmentUrl] = React.useState<string | null>(null);
  const [attachmentLoading, setAttachmentLoading] = React.useState(false);
  const [zoomImageUrl, setZoomImageUrl] = React.useState<string | null>(null);

  // 切换申请时重置驳回输入与附件（项目既有模式：effect 内同步 setState 加行内豁免）
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRejectOpen(false);
    setRejectReason("");
    setRejectError(null);
    setZoomImageUrl(null);
    if (!request?.attachment_url) {
      setAttachmentUrl(null);
      return;
    }
    let cancelled = false;
    setAttachmentLoading(true);
    void (async () => {
      const url = await getSignedUrl(request.attachment_url!);
      if (cancelled) return;
      setAttachmentUrl(url);
      setAttachmentLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [request?.id, request?.attachment_url, getSignedUrl]);

  const handleClose = () => {
    // 审批中禁关闭
    if (acting) return;
    onClose();
  };

  const handleApprove = async () => {
    if (!request || actingRef.current) return;
    actingRef.current = true;
    setActing(true);
    setRejectError(null);
    try {
      const result = await onApprove(request.id);
      // 有 warnings（如成员已实际签到、考勤未联动）时逐条提示管理员（Issue #159 返工）；
      // 成功时父级移除该行，request 变 null 自动关闭；失败由父级提示
      if (result.ok && result.warnings.length > 0) {
        alert(result.warnings.join("\n"));
      }
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  };

  const handleReject = async () => {
    if (!request || actingRef.current) return;
    const trimmed = rejectReason.trim();
    if (!trimmed) {
      setRejectError("请填写驳回原因");
      return;
    }
    actingRef.current = true;
    setActing(true);
    setRejectError(null);
    try {
      await onReject(request.id, trimmed);
      setRejectOpen(false);
      setRejectReason("");
      // 成功时父级移除该行，request 变 null 自动关闭
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  };

  const busy = acting || processing;

  return (
    <Modal
      open={!!request}
      onClose={handleClose}
      title="请假详情"
      position="bottom"
      closeOnOverlay={!busy}
    >
      {request && (
        <div className="space-y-3">
          {/* 状态 chip + 申请时间 */}
          <div className="flex items-center justify-between">
            <span
              className={`rounded-full px-3 py-1 text-label ${
                STATUS_CHIP[request.status] ?? "bg-muted text-text-subtle"
              }`}
            >
              {STATUS_LABEL[request.status] ?? request.status}
            </span>
            <span className="text-label text-text-subtle">
              申请于 {formatDateTimeInChina(request.created_at)}
            </span>
          </div>

          {/* 成员信息 */}
          <div className="rounded-xl border border-border bg-surface p-3">
            <p className="text-sm font-semibold text-text">
              {request.profiles?.full_name ?? "未知成员"}
              <span className="ml-2 text-xs font-normal text-text-muted">
                {request.profiles?.instrument ?? "未选声部"}
              </span>
            </p>
          </div>

          {/* 排练信息 */}
          <div className="rounded-xl border border-border bg-surface p-3">
            <p className="text-sm font-medium text-text">
              {request.rehearsals?.repertoire ?? request.rehearsals?.title ?? "排练"}
            </p>
            <p className="mt-0.5 text-xs text-text-muted">
              {request.rehearsals?.start_time
                ? formatRehearsalRange(
                    request.rehearsals.start_time,
                    request.rehearsals.end_time ?? null,
                  )
                : "时间未设置"}
              {request.rehearsals?.location ? ` · ${request.rehearsals.location}` : ""}
            </p>
          </div>

          {/* 请假原因 */}
          <div className="rounded-xl border border-border bg-surface p-3">
            <p className="mb-1 text-label text-text-muted">请假原因</p>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-text">
              {request.reason}
            </p>
          </div>

          {/* 附件图片（签名 URL） */}
          {request.attachment_url && (
            <div>
              <p className="mb-1 text-label text-text-muted">附件图片</p>
              {attachmentLoading ? (
                <p className="text-xs text-text-subtle">加载中…</p>
              ) : attachmentUrl ? (
                <button
                  type="button"
                  onClick={() => setZoomImageUrl(attachmentUrl)}
                  className="block overflow-hidden rounded-xl border border-border"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={attachmentUrl}
                    alt="请假附件"
                    className="max-h-48 w-full object-contain"
                  />
                </button>
              ) : (
                <p className="text-xs text-danger">附件加载失败</p>
              )}
            </div>
          )}

          {/* 驳回原因（已驳回时展示） */}
          {request.status === "rejected" && request.reject_reason && (
            <div className="rounded-xl border border-danger/30 bg-danger/5 p-3">
              <p className="text-sm font-medium text-danger">驳回原因</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-danger">
                {request.reject_reason}
              </p>
            </div>
          )}

          {/* 驳回原因输入（内联） */}
          {rejectOpen && (
            <div className="rounded-xl border border-danger/30 bg-danger/5 p-3">
              <label className="mb-1 block text-label text-danger" htmlFor="admin-reject-reason">
                驳回原因<span className="text-danger">*</span>
              </label>
              {/* 弃用 .input（固定高度覆盖 rows）+ 去掉 resize-none，恢复可拖拽拉长（审计清理） */}
              <textarea
                id="admin-reject-reason"
                value={rejectReason}
                onChange={(e) => {
                  setRejectReason(e.target.value);
                  setRejectError(null);
                }}
                rows={3}
                className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-sm text-text outline-none focus:border-text-muted leading-[1.5]"
                placeholder="请填写驳回原因…"
                maxLength={200}
              />
              {rejectError && <p className="mt-1 text-xs text-danger">{rejectError}</p>}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setRejectOpen(false)}
                  className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-muted hover:bg-muted disabled:opacity-60"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleReject}
                  className="flex-1 rounded-lg bg-danger px-3 py-2 text-sm text-danger-foreground hover:opacity-90 disabled:opacity-60"
                >
                  {acting ? "驳回中…" : "确认驳回"}
                </button>
              </div>
            </div>
          )}

          {/* pending：底部固定通过/驳回（驳回输入展开时隐藏，Issue #182） */}
          {request.status === "pending" && !rejectOpen && (
            <div className="flex gap-2 border-t border-border pt-3">
              <button
                type="button"
                disabled={busy}
                onClick={handleApprove}
                className="flex-1 rounded-xl bg-success py-2.5 text-sm font-medium text-success-foreground hover:opacity-90 disabled:opacity-60"
              >
                {acting ? "处理中…" : "通过"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setRejectOpen(true)}
                className="flex-1 rounded-xl bg-danger py-2.5 text-sm font-medium text-danger-foreground hover:opacity-90 disabled:opacity-60"
              >
                驳回
              </button>
            </div>
          )}
        </div>
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
