"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/context/user-context";
import { LogOut } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Modal } from "@/components/ui/Modal";
import { Toggle } from "@/components/ui/Toggle";
import { useInvitationCodes } from "@/hooks/useInvitationCodes";
import { formatDateTime } from "@/lib/date-utils";
import type { InvitationCodeRow } from "@/types/database";

export default function ProfilePage() {
  const router = useRouter();
  const { user, logout } = useUser();
  const fullName = user?.name ?? "—";
  const instrument = user?.section ?? "—";
  const email = user?.email ?? "—";
  const initials = fullName !== "—" ? fullName.slice(0, 2) || fullName.slice(0, 1) || "--" : "--";

  // 修改密码
  const [isPwdModalOpen, setIsPwdModalOpen] = React.useState(false);
  const [newPwd, setNewPwd] = React.useState("");
  const [confirmPwd, setConfirmPwd] = React.useState("");
  const [isUpdatingPwd, setIsUpdatingPwd] = React.useState(false);

  // 邀请码管理
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
  const [genResults, setGenResults] = React.useState<InvitationCodeRow[]>([]);
  const [genError, setGenError] = React.useState<string | null>(null);
  const [isGenSubmitting, setIsGenSubmitting] = React.useState(false);

  // 管理邀请码 Modal
  const [isManageModalOpen, setIsManageModalOpen] = React.useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = React.useState<string | null>(null);
  const [deleteConfirmCode, setDeleteConfirmCode] = React.useState<string>("");

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPwd.trim() !== confirmPwd.trim()) return alert("两次输入的密码不一致");
    if (newPwd.trim().length < 6) return alert("新密码长度至少 6 位");
    setIsUpdatingPwd(true);
    const { error } = await supabase.auth.updateUser({ password: newPwd.trim() });
    setIsUpdatingPwd(false);
    if (error) alert(error.message);
    else {
      alert("密码修改成功");
      setNewPwd("");
      setConfirmPwd("");
      setIsPwdModalOpen(false);
    }
  };

  const handleOpenGenModal = () => {
    setGenResults([]);
    setGenError(null);
    setGenMode("single");
    setBatchCount(5);
    setCustomCode("");
    setMaxUses(1);
    setIsGenModalOpen(true);
  };

  const handleGenerate = async () => {
    if (isGenSubmitting) return;
    setIsGenSubmitting(true);
    setGenResults([]);
    setGenError(null);

    try {
      if (genMode === "single") {
        const result = await createSingle({
          customCode: customCode.trim() || undefined,
          maxUses: maxUses >= 1 ? maxUses : 1,
        });
        if (result) {
          setGenResults([result]);
        } else {
          setGenError("邀请码生成失败，请重试");
        }
      } else {
        const count = Math.max(1, Math.min(100, batchCount));
        const results = await createBatch(count);
        if (results.length === 0) {
          setGenError("邀请码生成失败，请重试");
        } else {
          setGenResults(results);
        }
      }
    } finally {
      setIsGenSubmitting(false);
    }
  };

  const handleOpenManageModal = () => {
    setIsManageModalOpen(true);
    void fetchCodes();
  };

  const handleDeleteClick = (id: string, code: string) => {
    // 确认弹窗已打开时，忽略新的删除点击，防止目标被切换
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

  const handleCopyCode = (code: string) => {
    void navigator.clipboard.writeText(code);
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border-light bg-surface p-4 shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-base font-medium text-primary-foreground">
            {initials}
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <h1 className="text-lg font-semibold text-text">{fullName}</h1>
            <p className="text-sm text-text-muted">声部 {instrument}</p>
            <p className="text-xs text-text-muted">邮箱 {email}</p>
          </div>
        </div>
      </section>

      {/* 管理邀请码 */}
      <button
        type="button"
        onClick={handleOpenManageModal}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium text-text hover:bg-muted"
      >
        📋 管理邀请码
      </button>

      {/* 生成邀请码 */}
      <button
        type="button"
        onClick={handleOpenGenModal}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium text-text hover:bg-muted"
      >
        ✨ 生成邀请码
      </button>

      <button
        type="button"
        onClick={() => setIsPwdModalOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium text-text hover:bg-muted"
      >
        🔒 修改密码
      </button>

      <button
        type="button"
        onClick={handleLogout}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-danger-bg px-4 py-2.5 text-sm font-medium text-danger shadow-sm hover:opacity-90"
      >
        <LogOut className="h-4 w-4" />
        退出登录
      </button>

      {/* 修改密码 Modal */}
      <Modal
        open={isPwdModalOpen}
        onClose={() => {
          if (!isUpdatingPwd) setIsPwdModalOpen(false);
        }}
        title="修改登录密码"
        position="bottom"
        closeOnOverlay={!isUpdatingPwd}
      >
        <form onSubmit={handleUpdatePassword} className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-text-muted">新密码</label>
            <input
              type="password"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              className="input"
              placeholder="至少 6 位"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-muted">确认新密码</label>
            <input
              type="password"
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              className="input"
              placeholder="再次输入"
            />
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              disabled={isUpdatingPwd}
              onClick={() => setIsPwdModalOpen(false)}
              className="rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium text-text-muted hover:bg-muted disabled:opacity-60"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isUpdatingPwd}
              className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {isUpdatingPwd ? "提交中..." : "确认修改"}
            </button>
          </div>
        </form>
      </Modal>

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
          {/* 切换单个/批量 */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-muted">生成方式</span>
            <Toggle
              options={["single", "batch"] as const}
              value={genMode}
              onChange={(v) => setGenMode(v)}
              getLabel={(opt) => (opt === "single" ? "单个生成" : "批量生成")}
            />
          </div>

          {/* 单个生成：自定义邀请码和使用次数 */}
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
                  onChange={(e) => setMaxUses(parseInt(e.target.value, 10) || 1)}
                  className="input"
                  placeholder="1"
                />
              </div>
            </>
          )}

          {/* 批量生成：提示自动生成 */}
          {genMode === "batch" && (
            <div className="rounded-xl border border-border bg-page-bg px-3 py-2">
              <p className="text-xs text-text-muted">批量生成将自动生成邀请码，使用次数固定为 1</p>
            </div>
          )}

          {/* 批量数量输入 */}
          {genMode === "batch" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">生成数量</label>
              <input
                type="number"
                min={1}
                max={100}
                value={batchCount}
                onChange={(e) => setBatchCount(parseInt(e.target.value, 10) || 1)}
                className="input"
                placeholder="1-100"
              />
            </div>
          )}

          {/* 生成按钮 */}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isGenSubmitting || codesCreating}
            className="w-full rounded-xl bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {isGenSubmitting || codesCreating ? "生成中…" : "生成"}
          </button>

          {/* 错误提示 */}
          {genError && <p className="text-xs text-danger">{genError}</p>}

          {/* 结果列表 */}
          {genResults.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-text-muted">
                生成结果（{genResults.length} 个）
              </p>
              <div className="max-h-[200px] space-y-2 overflow-y-auto">
                {genResults.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between rounded-xl border border-border bg-page-bg px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="font-mono text-sm text-text">{item.code}</span>
                      {item.max_uses != null && item.max_uses > 1 && (
                        <span className="ml-2 text-xs text-text-muted">
                          最多 {item.max_uses} 次
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopyCode(item.code)}
                      className="rounded-full px-2 py-1 text-xs text-text-muted hover:bg-border"
                    >
                      复制
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 关闭按钮 */}
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
            <div className="max-h-[320px] space-y-3 overflow-y-auto">
              {invitationCodes.map((item) => (
                <div key={item.id} className="rounded-xl border border-border bg-surface p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <span className="block font-mono text-sm font-medium text-text">
                        {item.code}
                      </span>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-text-muted">
                        <span>
                          状态：
                          <span className={item.used ? "text-text-muted" : "text-success"}>
                            {item.used ? "已用完" : "使用中"}
                          </span>
                        </span>
                        {item.max_uses != null && (
                          <span>
                            使用：{item.used_count ?? 0}/{item.max_uses}
                          </span>
                        )}
                        <span>生成：{formatDateTime(item.created_at)}</span>
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

      {/* 删除确认弹窗 */}
      <Modal
        open={!!deleteConfirmId}
        onClose={() => {
          if (!codesDeleting) setDeleteConfirmId(null);
        }}
        position="center"
        closeOnOverlay={!codesDeleting}
      >
        <h3 className="text-base font-semibold text-text">确认删除</h3>
        <p className="mt-2 text-sm text-text-muted">
          确定要删除邀请码{" "}
          <span className="font-mono font-medium text-text">{deleteConfirmCode}</span>{" "}
          吗？删除后无法恢复。
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={codesDeleting}
            onClick={() => setDeleteConfirmId(null)}
            className="rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium text-text-muted hover:bg-muted disabled:opacity-60"
          >
            取消
          </button>
          <button
            type="button"
            disabled={codesDeleting}
            onClick={handleConfirmDelete}
            className="rounded-full bg-danger px-4 py-2 text-xs font-medium text-danger-foreground hover:opacity-90 disabled:opacity-60"
          >
            {codesDeleting ? "删除中…" : "确认删除"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
