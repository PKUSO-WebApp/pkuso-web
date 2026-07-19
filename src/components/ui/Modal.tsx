"use client";

import React from "react";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children?: React.ReactNode;
  /** 底部弹出(默认)｜居中 */
  position?: "bottom" | "center";
  /** 点击遮罩关闭,默认 true */
  closeOnOverlay?: boolean;
};

export function Modal({
  open,
  onClose,
  title,
  children,
  position = "bottom",
  closeOnOverlay = true,
}: ModalProps) {
  if (!open) return null;

  const align = position === "center" ? "items-center" : "items-end";
  const radius = position === "center" ? "rounded-2xl" : "rounded-t-3xl sm:rounded-2xl";

  return (
    <div
      className={`fixed inset-0 flex ${align} justify-center bg-black/40 px-4 pb-safe`}
      style={{ zIndex: "var(--z-modal)" } as React.CSSProperties}
      role="dialog"
      aria-modal="true"
    >
      {closeOnOverlay && (
        <button
          aria-label="关闭弹窗"
          className="absolute inset-0 h-full w-full"
          onClick={onClose}
        />
      )}
      <div
        className={`relative w-full max-w-md ${radius} border border-border bg-surface p-4 shadow-xl`}
      >
        {title && (
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-base font-semibold text-text">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-muted px-3 py-1 text-[11px] text-text-muted hover:bg-border"
            >
              关闭
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
