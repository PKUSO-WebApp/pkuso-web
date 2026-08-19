"use client";

import React from "react";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children?: React.ReactNode;
  /** 标题行右侧附加内容（位于标题与「关闭」按钮之间）；不传时行为与现状一致 */
  headerExtra?: React.ReactNode;
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
  headerExtra,
  position = "bottom",
  closeOnOverlay = true,
}: ModalProps) {
  if (!open) return null;

  return (
    <ModalDialog
      onClose={onClose}
      title={title}
      headerExtra={headerExtra}
      position={position}
      closeOnOverlay={closeOnOverlay}
    >
      {children}
    </ModalDialog>
  );
}

/** 弹窗内容层（仅在 open 时挂载，焦点逻辑随挂载/卸载配对执行，Issue #186） */
function ModalDialog({
  onClose,
  title,
  children,
  headerExtra,
  position,
  closeOnOverlay,
}: Omit<ModalProps, "open">) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  // 打开前持有焦点的元素：关闭时还原（如触发弹窗的按钮）
  const previousFocusRef = React.useRef<HTMLElement | null>(null);

  // 焦点移入/还原（Issue #186 全站无障碍）：
  // 打开时记录触发元素并把焦点移入面板根（tabIndex=-1 可编程聚焦）；
  // 卸载（关闭/上层切换）时还原焦点，避免焦点停在已卸载的节点上
  React.useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    return () => {
      previousFocusRef.current?.focus();
    };
  }, []);

  // focus trap：Tab/Shift+Tab 永远停留在弹窗内可聚焦元素之间循环
  // （与 admin 全屏层同款过滤：disabled、aria-hidden、tabindex<0、inert 子树全部排除——
  //  叠加弹层场景下底层 Modal 被 inert 包裹，其元素自然不在 trap 范围内）
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = Array.from(
      panel.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]"),
    ).filter((el) => {
      if (el.hasAttribute("disabled")) return false;
      if (el.getAttribute("aria-hidden") === "true") return false;
      if (el.tabIndex < 0) return false;
      if (el.closest("[inert]")) return false;
      return true;
    });
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !panel.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || !panel.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  };

  const align = position === "center" ? "items-center" : "items-end";
  const radius = position === "center" ? "rounded-2xl" : "rounded-t-3xl sm:rounded-2xl";

  return (
    <div
      className={`fixed inset-0 flex ${align} justify-center bg-black/40 px-4 pb-safe`}
      style={{ zIndex: "var(--z-modal)" } as React.CSSProperties}
      role="dialog"
      aria-modal="true"
      onKeyDown={handleKeyDown}
    >
      {closeOnOverlay && (
        <button
          aria-label="关闭弹窗"
          // 遮罩按钮仅鼠标/触屏点击关闭用，不参与 Tab 顺序（键盘关闭走面板内「关闭」按钮）
          tabIndex={-1}
          className="absolute inset-0 h-full w-full"
          onClick={onClose}
        />
      )}
      <div
        ref={panelRef}
        // 面板根可编程聚焦（焦点移入目标）；outline-none 避免容器出现焦点框
        tabIndex={-1}
        className={`relative w-full max-w-md ${radius} border border-border bg-surface p-4 shadow-xl outline-none`}
      >
        {title && (
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-base font-semibold text-text">{title}</h2>
            <div className="flex items-center gap-2">
              {headerExtra}
              <button
                type="button"
                onClick={onClose}
                className="rounded-full bg-muted px-3 py-1 text-label text-text-muted hover:bg-border"
              >
                关闭
              </button>
            </div>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
