"use client";

import React from "react";
import { Modal } from "@/components/ui/Modal";
import { getFreshAccessToken } from "@/lib/auth-token";
import { EMAIL_SIGNATURE_MAX_LENGTH } from "@/lib/email-signature";
import { useAdminPageHeader } from "@/context/admin-page-header-context";

export default function EmailSignaturePage() {
  const { setTitle, setHeaderRight } = useAdminPageHeader();
  const [isSigModalOpen, setIsSigModalOpen] = React.useState(false);
  const [sigLoading, setSigLoading] = React.useState(false);
  const [sigSubmitting, setSigSubmitting] = React.useState(false);
  const sigSubmittingRef = React.useRef(false);
  const sigFetchSeqRef = React.useRef(0);
  const [sigValue, setSigValue] = React.useState("");
  const [sigError, setSigError] = React.useState<string | null>(null);
  const [sigSuccess, setSigSuccess] = React.useState(false);
  const [isSigFullscreen, setIsSigFullscreen] = React.useState(false);

  const fullscreenToggleRef = React.useRef<HTMLButtonElement>(null);
  const fullscreenRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!isSigFullscreen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isSigFullscreen]);

  React.useEffect(() => {
    if (!isSigFullscreen) return;
    const toggleBtn = fullscreenToggleRef.current;
    return () => {
      toggleBtn?.focus();
    };
  }, [isSigFullscreen]);

  const handleFullscreenKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const container = fullscreenRef.current;
    if (!container) return;
    const focusables = Array.from(
      container.querySelectorAll<HTMLElement>("button, textarea, [tabindex]"),
    ).filter((el) => {
      if (el.hasAttribute("disabled")) return false;
      if (el.getAttribute("aria-hidden") === "true") return false;
      if (el.tabIndex < 0) return false;
      if (el.closest("[inert]")) return false;
      return true;
    });
    if (focusables.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const onFocusable = active !== null && focusables.includes(active);
    if (e.shiftKey) {
      if (!onFocusable || active === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (!onFocusable || active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const fetchSignature = async () => {
    const seq = ++sigFetchSeqRef.current;
    setSigLoading(true);
    setSigError(null);
    try {
      const token = await getFreshAccessToken();
      if (sigFetchSeqRef.current !== seq) return;
      if (!token) {
        setSigError("登录状态异常，请重新登录");
        return;
      }
      const res = await fetch("/api/admin/settings", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await res.json().catch(() => ({}));
      if (sigFetchSeqRef.current !== seq) return;
      if (!res.ok) throw new Error(result.error || "加载失败");
      setSigValue(result.value ?? "");
    } catch (err) {
      if (sigFetchSeqRef.current !== seq) return;
      setSigError(err instanceof Error ? err.message : "加载失败，请重试");
    } finally {
      if (sigFetchSeqRef.current === seq) setSigLoading(false);
    }
  };

  const handleOpenSigModal = React.useCallback(() => {
    setIsSigModalOpen(true);
    setIsSigFullscreen(false);
    setSigSuccess(false);
    void fetchSignature();
  }, []);

  const handleCloseSigModal = () => {
    if (sigSubmitting) return;
    setIsSigModalOpen(false);
    setIsSigFullscreen(false);
  };

  const handleSaveFromFullscreen = async () => {
    const ok = await handleSaveSignature();
    if (ok) setIsSigFullscreen(false);
  };

  const handleSaveSignature = async (): Promise<boolean> => {
    if (sigSubmittingRef.current || sigSubmitting) return false;
    sigSubmittingRef.current = true;
    setSigSubmitting(true);
    if (isSigFullscreen) fullscreenRef.current?.focus();
    setSigError(null);
    setSigSuccess(false);
    try {
      const token = await getFreshAccessToken();
      if (!token) {
        setSigError("登录状态异常，请重新登录");
        return false;
      }
      const trimmed = sigValue.trim();
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ value: trimmed }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || "保存失败，请重试");
      setSigValue(trimmed);
      setSigSuccess(true);
      return true;
    } catch (err) {
      setSigError(err instanceof Error ? err.message : "保存失败，请重试");
      return false;
    } finally {
      sigSubmittingRef.current = false;
      setSigSubmitting(false);
    }
  };

  React.useEffect(() => {
    setTitle("邮件签名设置");
    setHeaderRight(
      <button
        type="button"
        onClick={handleOpenSigModal}
        className="rounded-full bg-primary px-3 py-1 text-label font-medium text-primary-foreground hover:opacity-90"
      >
        编辑签名
      </button>,
    );
  }, [setTitle, setHeaderRight, handleOpenSigModal]);

  return (
    <div className="flex h-full min-h-0 flex-col space-y-4">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <p className="text-xs text-text-muted text-center py-8">
          排练通知邮件底部的落款签名，点击「编辑签名」进行设置
        </p>
      </div>

      <div inert={isSigFullscreen}>
        <Modal
          open={isSigModalOpen}
          onClose={handleCloseSigModal}
          title="邮件签名设置"
          position="bottom"
          closeOnOverlay={!sigSubmitting}
        >
          <div className="mt-4 space-y-3 pb-safe">
            <p className="text-xs text-text-muted">排练通知邮件底部的落款签名</p>

            {sigLoading ? (
              <p className="py-6 text-center text-xs text-text-muted">加载中…</p>
            ) : sigError && sigValue === "" ? (
              <div className="py-4 text-center">
                <p className="text-xs text-danger">加载失败：{sigError}</p>
                <button
                  type="button"
                  onClick={() => void fetchSignature()}
                  className="mt-3 rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium text-text-muted hover:bg-muted"
                >
                  重试
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <textarea
                    value={sigValue}
                    onChange={(e) => {
                      setSigValue(e.target.value);
                      setSigSuccess(false);
                    }}
                    rows={9}
                    maxLength={EMAIL_SIGNATURE_MAX_LENGTH}
                    disabled={sigSubmitting}
                    className="w-full resize-none rounded-xl border border-border bg-muted px-3 py-3 pr-16 text-xs leading-[1.6] text-text outline-none focus:border-text-muted"
                    placeholder="如：北京大学交响乐团管理团队"
                  />
                  <button
                    type="button"
                    ref={fullscreenToggleRef}
                    disabled={sigSubmitting}
                    onClick={() => setIsSigFullscreen(true)}
                    className="absolute right-2 top-2 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text-muted hover:bg-muted disabled:opacity-60"
                  >
                    ⤢ 全屏
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-text-muted">支持多行换行</p>
                  <p className="text-xs text-text-muted">
                    {sigValue.length}/{EMAIL_SIGNATURE_MAX_LENGTH}
                  </p>
                </div>
                {!sigValue.trim() && (
                  <p className="text-xs text-text-muted">未设置时邮件将使用默认签名</p>
                )}
                {sigSuccess && <p className="text-xs text-success">签名已保存</p>}
                {sigError && <p className="text-xs text-danger">{sigError}</p>}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={sigSubmitting}
                    onClick={handleCloseSigModal}
                    className="rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium text-text-muted hover:bg-muted disabled:opacity-60"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={sigSubmitting}
                    onClick={() => void handleSaveSignature()}
                    className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
                  >
                    {sigSubmitting ? "保存中…" : "保存"}
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>
      </div>

      {isSigFullscreen && (
        <div
          ref={fullscreenRef}
          onKeyDown={handleFullscreenKeyDown}
          tabIndex={-1}
          className="fixed inset-0 flex h-[100dvh] flex-col overscroll-contain bg-page-bg"
          style={{ zIndex: "var(--z-overlay)" }}
          role="dialog"
          aria-modal="true"
          aria-label="编辑邮件签名"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-base font-semibold text-text">编辑邮件签名</h2>
            <button
              type="button"
              aria-label="关闭全屏编辑"
              disabled={sigSubmitting}
              onClick={() => setIsSigFullscreen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-text-muted hover:bg-border disabled:opacity-60"
            >
              ✕
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <textarea
              autoFocus
              value={sigValue}
              onChange={(e) => {
                setSigValue(e.target.value);
                setSigSuccess(false);
              }}
              maxLength={EMAIL_SIGNATURE_MAX_LENGTH}
              disabled={sigSubmitting}
              className="w-full min-h-0 flex-1 resize-none overscroll-contain rounded-xl border border-border bg-muted px-4 py-3 text-base leading-[1.6] text-text outline-none focus:border-text-muted"
              placeholder="如：北京大学交响乐团管理团队"
            />
            {sigError && <p className="shrink-0 px-4 pb-2 text-xs text-danger">{sigError}</p>}
          </div>

          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-3 pb-safe">
            <p className="text-xs text-text-muted">
              {sigValue.length}/{EMAIL_SIGNATURE_MAX_LENGTH}
            </p>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                disabled={sigSubmitting}
                onClick={() => setIsSigFullscreen(false)}
                className="rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium text-text-muted hover:bg-muted disabled:opacity-60"
              >
                返回
              </button>
              <button
                type="button"
                disabled={sigSubmitting}
                onClick={() => void handleSaveFromFullscreen()}
                className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
              >
                {sigSubmitting ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
