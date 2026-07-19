"use client";

import React from "react";
import { Modal } from "@/components/ui/Modal";

type Props = {
  open: boolean;
  title: string;
  submitting: boolean;
  codeInput: string;
  codeError: string | null;
  onCodeChange: (v: string) => void;
  onConfirm: (e: React.FormEvent) => void;
  onClose: () => void;
};

export function CodeVerifyModal({
  open,
  title,
  submitting,
  codeInput,
  codeError,
  onCodeChange,
  onConfirm,
  onClose,
}: Props) {
  return (
    <Modal open={open} onClose={onClose} title="输入签到码" closeOnOverlay={!submitting}>
      <p className="mb-3 text-[11px] text-text-muted">本次排练：{title}</p>
      <form onSubmit={onConfirm}>
        <div className="space-y-1 text-xs">
          <label className="block text-[11px] font-medium text-text-muted">四位数字签到码</label>
          <input
            type="text"
            inputMode="numeric"
            maxLength={4}
            value={codeInput}
            onChange={(e) => {
              onCodeChange(e.target.value);
            }}
            className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
            placeholder="如：8848"
          />
          {codeError && <p className="text-[11px] text-danger">{codeError}</p>}
        </div>
        <div className="mt-4 flex items-center justify-end gap-2 text-xs">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-full px-4 py-1.5 text-[11px] text-text-muted hover:bg-muted"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-full bg-primary px-4 py-1.5 text-[11px] font-medium text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-60"
          >
            {submitting ? "确认中…" : "确认签到"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
