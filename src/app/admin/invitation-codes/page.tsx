"use client";

import React from "react";
import { useInvitationCodes } from "@/hooks/useInvitationCodes";
import { Modal } from "@/components/ui/Modal";
import { Toggle } from "@/components/ui/Toggle";
import { formatDateTimeInChina } from "@/lib/date-utils";
import { supabase } from "@/lib/supabase";
import type { InvitationCodeRow } from "@/types/database";
import { useAdminPageHeader } from "@/context/admin-page-header-context";

export default function InvitationCodesPage() {
  const { setTitle, setHeaderRight } = useAdminPageHeader();
  const {
    data: invitationCodes,
    loading: codesLoading,
    error: codesError,
    creating: codesCreating,
    deleting: codesDeleting,
    isDeleting: isCodeDeleting,
    fetch: fetchCodes,
    createSingle,
    createBatch,
    remove: deleteCode,
  } = useInvitationCodes(supabase);

  // 生成邀请码 Modal
  const [isGenModalOpen, setIsGenModalOpen] = React.useState(false);
  const [genMode, setGenMode] = React.useState<"single" | "batch">("single");
  const [batchCount, setBatchCount] = React.useState<number>(5);
  const [customCode, setCustomCode] = React.useState("");
  const [maxUses, setMaxUses] = React.useState<number>(1);
  const [expiresInDays, setExpiresInDays] = React.useState<number>(7);
  const [genResults, setGenResults] = React.useState<InvitationCodeRow[]>([]);
  const [genError, setGenError] = React.useState<string | null>(null);
  const [isGenSubmitting, setIsGenSubmitting] = React.useState(false);
  const genSubmittingRef = React.useRef(false);

  // 管理邀请码 Modal
  const [isManageModalOpen, setIsManageModalOpen] = React.useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = React.useState<string | null>(null);
  const [deleteConfirmCode, setDeleteConfirmCode] = React.useState<string>("");
  const [copiedAll, setCopiedAll] = React.useState(false);
  const [copiedCode, setCopiedCode] = React.useState<string | null>(null);

  const handleOpenGenModal = React.useCallback(() => {
    setGenResults([]);
    setGenError(null);
    setGenMode("single");
    setBatchCount(5);
    setCustomCode("");
    setMaxUses(1);
    setExpiresInDays(7);
    setIsGenModalOpen(true);
  }, []);

  const handleGenerate = async () => {
    if (genSubmittingRef.current || isGenSubmitting) return;

    setGenError(null);

    if (genMode === "batch" && (batchCount < 1 || batchCount > 100)) {
      setGenError("生成数量必须为 1-100");
      return;
    }

    genSubmittingRef.current = true;
    setIsGenSubmitting(true);
    setGenResults([]);

    try {
      if (genMode === "single") {
        const result = await createSingle({
          customCode: customCode.trim() || undefined,
          maxUses: maxUses >= 1 ? maxUses : 1,
          expiresInDays: expiresInDays >= 1 && expiresInDays <= 30 ? expiresInDays : 7,
        });
        if (result.data) {
          setGenResults([result.data]);
        } else if (result.error) {
          setGenError(result.error);
        } else {
          setGenError("邀请码生成失败，请重试");
        }
      } else {
        const results = await createBatch(batchCount);
        if (results.length === 0) {
          setGenError("邀请码生成失败，请重试");
        } else {
          setGenResults(results);
        }
      }
    } finally {
      genSubmittingRef.current = false;
      setIsGenSubmitting(false);
    }
  };

  const handleOpenManageModal = React.useCallback(() => {
    setIsManageModalOpen(true);
    void fetchCodes();
  }, [fetchCodes]);

  const handleDeleteClick = (id: string, code: string) => {
    if (deleteConfirmId) return;
    if (isCodeDeleting(id)) return;
    setDeleteConfirmId(id);
    setDeleteConfirmCode(code);
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmId) return;
    const ok = await deleteCode(deleteConfirmId);
    if (ok) {
      setDeleteConfirmId(null);
      setDeleteConfirmCode("");
    } else {
      alert("删除失败，请重试");
    }
  };

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode((prev) => (prev === code ? null : prev)), 2000);
    } catch {
      alert("复制失败，请手动复制");
    }
  };

  React.useEffect(() => {
    setTitle("邀请码管理");
    setHeaderRight(
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleOpenManageModal}
          className="rounded-full bg-primary px-3 py-1 text-label font-medium text-primary-foreground hover:opacity-90"
        >
          管理邀请码
        </button>
        <button
          type="button"
          onClick={handleOpenGenModal}
          className="rounded-full bg-primary px-3 py-1 text-label font-medium text-primary-foreground hover:opacity-90"
        >
          生成邀请码
        </button>
      </div>,
    );
  }, [setTitle, setHeaderRight, handleOpenManageModal, handleOpenGenModal]);

  return (
    <div className="flex h-full min-h-0 flex-col space-y-4">
      {/* 生成邀请码 Modal */}
      <Modal
        open={isGenModalOpen}
        onClose={() => {
          if (!isGenSubmitting && !codesCreating) setIsGenModalOpen(false);
        }}
        title="生成邀请码"
        position="bottom"
        closeOnOverlay={!isGenSubmitting && !codesCreating}
      >
        <div className="mt-4 space-y-4 pb-safe">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-muted">生成方式</span>
            <Toggle
              options={["single", "batch"] as const}
              value={genMode}
              onChange={(v) => setGenMode(v)}
              getLabel={(opt) => (opt === "single" ? "单个生成" : "批量生成")}
            />
          </div>

          {genMode === "single" && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-text-muted">
                  自定义邀请码（留空自动生成）
                </label>
                <input
                  type="text"
                  value={customCode}
                  onChange={(e) => setCustomCode(e.target.value)}
                  className="input"
                  placeholder="如：MY-INVITE-001"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-text-muted">
                  最大使用次数
                </label>
                <input
                  type="number"
                  min={1}
                  value={maxUses}
                  onChange={(e) => setMaxUses(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className="input"
                  placeholder="1"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-text-muted">
                  有效期（天数）
                </label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={expiresInDays}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10) || 7;
                    setExpiresInDays(Math.max(1, Math.min(30, val)));
                  }}
                  className="input"
                  placeholder="1-30"
                />
                <p className="mt-1 text-xs text-text-muted">有效期 1-30 天，默认 7 天</p>
              </div>
            </>
          )}

          {genMode === "batch" && (
            <div className="space-y-2">
              <p className="text-xs text-danger">
                批量生成将自动生成邀请码，有效期固定为一周，使用次数固定为 1
              </p>
            </div>
          )}

          {genMode === "batch" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">生成数量</label>
              <input
                type="number"
                min={1}
                max={100}
                value={batchCount}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setBatchCount(Number.isNaN(val) ? 0 : val);
                }}
                className="input"
                placeholder="1-100"
              />
            </div>
          )}

          <button
            type="button"
            onClick={handleGenerate}
            disabled={isGenSubmitting || codesCreating}
            className="w-full rounded-xl bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {isGenSubmitting || codesCreating ? "生成中…" : "生成"}
          </button>

          {genError && <p className="text-xs text-danger">{genError}</p>}

          {genResults.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-text-muted">
                  生成结果（{genResults.length} 个）
                </p>
                {genMode === "batch" && genResults.length >= 1 && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const allCodes = genResults.map((item) => item.code).join("\n");
                        await navigator.clipboard.writeText(allCodes);
                        setCopiedAll(true);
                        setTimeout(() => setCopiedAll(false), 2000);
                      } catch {
                        alert("复制失败，请手动复制");
                      }
                    }}
                    className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-text-muted hover:bg-muted"
                  >
                    {copiedAll ? "已复制全部" : "复制全部"}
                  </button>
                )}
              </div>
              <div className="max-h-[200px] space-y-2 overflow-y-auto">
                {genResults.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between rounded-xl border border-border bg-page-bg px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div>
                        <span className="font-mono text-sm text-text">{item.code}</span>
                        {item.max_uses != null && item.max_uses > 1 && (
                          <span className="ml-2 text-xs text-text-muted">
                            最多 {item.max_uses} 次
                          </span>
                        )}
                      </div>
                      {item.expires_at && (
                        <p className="mt-0.5 text-xs text-text-muted">
                          截止：{formatDateTimeInChina(item.expires_at)}
                        </p>
                      )}
                    </div>
                    {genMode === "single" && (
                      <button
                        type="button"
                        onClick={() => handleCopyCode(item.code)}
                        className="shrink-0 rounded-full px-2 py-1 text-xs text-text-muted hover:bg-border"
                      >
                        {copiedCode === item.code ? "已复制" : "复制"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            disabled={isGenSubmitting || codesCreating}
            onClick={() => setIsGenModalOpen(false)}
            className="w-full rounded-xl border border-border bg-surface py-2.5 text-sm font-medium text-text-muted hover:bg-muted disabled:opacity-60"
          >
            关闭
          </button>
        </div>
      </Modal>

      {/* 管理邀请码 Modal */}
      <Modal
        open={isManageModalOpen}
        onClose={() => {
          if (!codesDeleting) setIsManageModalOpen(false);
        }}
        title="管理邀请码"
        position="bottom"
        closeOnOverlay={!codesDeleting}
      >
        <div className="mt-4 space-y-3 pb-safe">
          {codesLoading ? (
            <p className="py-8 text-center text-xs text-text-muted">加载中…</p>
          ) : codesError ? (
            <div className="py-8 text-center">
              <p className="text-xs text-danger">加载失败：{codesError}</p>
              <button
                type="button"
                onClick={() => void fetchCodes()}
                className="mt-3 rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium text-text-muted hover:bg-muted"
              >
                重试
              </button>
            </div>
          ) : invitationCodes.length === 0 ? (
            <p className="py-8 text-center text-xs text-text-muted">暂无邀请码</p>
          ) : (
            <>
              <div className="mb-2">
                <span className="text-xs text-text-muted">
                  共 {invitationCodes.length} 个邀请码
                </span>
              </div>
              {deleteConfirmId && (
                <div className="mb-3 rounded-xl border border-danger/30 bg-danger/5 p-4">
                  <p className="mb-3 text-sm text-danger">
                    确认删除邀请码{" "}
                    <span className="font-mono font-medium text-text">{deleteConfirmCode}</span>
                    ？删除后无法恢复。
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={codesDeleting}
                      onClick={() => setDeleteConfirmId(null)}
                      className="flex-1 rounded-lg bg-border px-3 py-2 text-sm text-text-muted hover:bg-muted disabled:opacity-60"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      disabled={codesDeleting}
                      onClick={handleConfirmDelete}
                      className="flex-1 rounded-lg bg-danger px-3 py-2 text-sm text-danger-foreground hover:bg-danger/90 disabled:opacity-60"
                    >
                      {codesDeleting ? "删除中…" : "确认删除"}
                    </button>
                  </div>
                </div>
              )}
              <div className="max-h-[400px] space-y-3 overflow-y-auto">
                {invitationCodes.map((item) => (
                  <div key={item.id} className="rounded-xl border border-border bg-surface p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1 space-y-1">
                        <span className="block font-mono text-sm font-medium text-text">
                          {item.code}
                        </span>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-text-muted">
                          {(() => {
                            const isExhausted =
                              item.max_uses != null && (item.used_count ?? 0) >= item.max_uses;
                            return (
                              <span>
                                状态：
                                <span className={isExhausted ? "text-text-muted" : "text-success"}>
                                  {isExhausted ? "已用完" : "可用"}
                                </span>
                              </span>
                            );
                          })()}
                          {item.max_uses != null ? (
                            <span>
                              使用：{item.used_count ?? 0}/{item.max_uses}
                            </span>
                          ) : (
                            <span>无限次 · 已使用 {item.used_count ?? 0} 次</span>
                          )}
                          <span>生成：{formatDateTimeInChina(item.created_at)}</span>
                          {item.expires_at && (
                            <span>截止：{formatDateTimeInChina(item.expires_at)}</span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteClick(item.id, item.code)}
                        disabled={isCodeDeleting(item.id) || !!deleteConfirmId}
                        className="shrink-0 rounded-full bg-danger-bg px-3 py-1.5 text-xs font-medium text-danger hover:opacity-90 disabled:opacity-60"
                      >
                        {isCodeDeleting(item.id) ? "删除中…" : "删除"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <button
            type="button"
            disabled={codesDeleting}
            onClick={() => setIsManageModalOpen(false)}
            className="w-full rounded-xl border border-border bg-surface py-2.5 text-sm font-medium text-text-muted hover:bg-muted disabled:opacity-60"
          >
            关闭
          </button>
        </div>
      </Modal>
    </div>
  );
}
