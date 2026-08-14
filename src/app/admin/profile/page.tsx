"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/context/user-context";
import { LogOut } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getFreshAccessToken } from "@/lib/auth-token";
import { EMAIL_SIGNATURE_MAX_LENGTH } from "@/lib/email-signature";
import { Modal } from "@/components/ui/Modal";
import { Toggle } from "@/components/ui/Toggle";
import { useInvitationCodes } from "@/hooks/useInvitationCodes";
import { formatDateTimeInChina } from "@/lib/date-utils";
import type { InvitationCodeRow } from "@/types/database";

export default function ProfilePage() {
  const router = useRouter();
  const { user, logout } = useUser();
  const fullName = user?.name ?? "—";
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
  const [expiresInDays, setExpiresInDays] = React.useState<number>(7); // 有效期天数
  const [genResults, setGenResults] = React.useState<InvitationCodeRow[]>([]);
  const [genError, setGenError] = React.useState<string | null>(null);
  const [isGenSubmitting, setIsGenSubmitting] = React.useState(false);

  // 管理邀请码 Modal
  const [isManageModalOpen, setIsManageModalOpen] = React.useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = React.useState<string | null>(null);
  const [deleteConfirmCode, setDeleteConfirmCode] = React.useState<string>("");
  const [copiedAll, setCopiedAll] = React.useState(false);
  const [copiedCode, setCopiedCode] = React.useState<string | null>(null);

  // 邮件签名设置
  const [isSigModalOpen, setIsSigModalOpen] = React.useState(false);
  const [sigLoading, setSigLoading] = React.useState(false);
  const [sigSubmitting, setSigSubmitting] = React.useState(false);
  const sigSubmittingRef = React.useRef(false); // 同步 guard，阻断竞态窗口
  const sigFetchSeqRef = React.useRef(0); // 请求序号守卫：快速开关 Modal 时丢弃过期响应
  const [sigValue, setSigValue] = React.useState("");
  const [sigError, setSigError] = React.useState<string | null>(null);
  const [sigSuccess, setSigSuccess] = React.useState(false);

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
    setExpiresInDays(7); // 重置为默认 7 天
    setIsGenModalOpen(true);
  };

  const handleGenerate = async () => {
    if (isGenSubmitting) return;

    // 清除之前的错误
    setGenError(null);

    // 批量生成前校验数量
    if (genMode === "batch" && (batchCount < 1 || batchCount > 100)) {
      setGenError("生成数量必须为 1-100");
      return;
    }

    setIsGenSubmitting(true);
    setGenResults([]);

    try {
      if (genMode === "single") {
        // createSingle 直接返回 { data, error }，避免依赖 useEffect 同步 hook 的 error 状态
        // （连续相同 23505 冲突时 React batching 会让 useEffect 不触发，导致通用兜底文案覆盖具体错误）
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

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode((prev) => (prev === code ? null : prev)), 2000);
    } catch {
      alert("复制失败，请手动复制");
    }
  };

  /** 读取当前邮件签名（打开 Modal 时调用） */
  const fetchSignature = async () => {
    const seq = ++sigFetchSeqRef.current; // 本次请求序号
    setSigLoading(true);
    setSigError(null);
    try {
      const token = await getFreshAccessToken();
      // 序号不匹配说明期间已触发新请求（如关闭后重开），丢弃过期响应
      if (sigFetchSeqRef.current !== seq) return;
      if (!token) {
        // token 获取失败（登录过期），不发请求，提示重新登录
        setSigError("登录状态异常，请重新登录");
        return;
      }
      const res = await fetch("/api/admin/settings", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await res.json().catch(() => ({}));
      // 序号不匹配说明期间已触发新请求（如关闭后重开），丢弃过期响应
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

  const handleOpenSigModal = () => {
    setIsSigModalOpen(true);
    setSigSuccess(false);
    void fetchSignature();
  };

  /** 保存邮件签名：ref 同步阻断 + state 异步兜底，防止重复提交 */
  const handleSaveSignature = async () => {
    if (sigSubmittingRef.current || sigSubmitting) return;
    sigSubmittingRef.current = true;
    setSigSubmitting(true);
    setSigError(null);
    setSigSuccess(false);
    try {
      const token = await getFreshAccessToken();
      if (!token) {
        // token 获取失败（登录过期），不发请求，提示重新登录
        setSigError("登录状态异常，请重新登录");
        return;
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
    } catch (err) {
      setSigError(err instanceof Error ? err.message : "保存失败，请重试");
    } finally {
      sigSubmittingRef.current = false;
      setSigSubmitting(false);
    }
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

      {/* 邮件签名设置 */}
      <button
        type="button"
        onClick={handleOpenSigModal}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium text-text hover:bg-muted"
      >
        📧 邮件签名设置
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

      {/* 邮件签名设置 Modal */}
      <Modal
        open={isSigModalOpen}
        onClose={() => {
          if (!sigSubmitting) setIsSigModalOpen(false);
        }}
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
              <textarea
                value={sigValue}
                onChange={(e) => {
                  setSigValue(e.target.value);
                  setSigSuccess(false);
                }}
                rows={3}
                maxLength={EMAIL_SIGNATURE_MAX_LENGTH}
                disabled={sigSubmitting}
                className="input resize-none p-3 leading-[1.6]"
                placeholder="如：北京大学交响乐团管理团队"
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-text-muted">多行内容在邮件中会合并为一行显示</p>
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
                  onClick={() => setIsSigModalOpen(false)}
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

          {/* 批量生成：提示自动生成 */}
          {genMode === "batch" && (
            <div className="space-y-2">
              <p className="text-xs text-danger">
                批量生成将自动生成邀请码，有效期固定为一周，使用次数固定为 1
              </p>
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
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  // 允许空值和 0（校验在 handleGenerate 中进行）
                  setBatchCount(Number.isNaN(val) ? 0 : val);
                }}
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
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-text-muted">
                  生成结果（{genResults.length} 个）
                </p>
                {/* 批量生成时显示"复制全部"按钮 */}
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
                      {/* 显示截止时间 */}
                      {item.expires_at && (
                        <p className="mt-0.5 text-xs text-text-muted">
                          截止：{formatDateTimeInChina(item.expires_at)}
                        </p>
                      )}
                    </div>
                    {/* 单个生成时显示逐条复制按钮 */}
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
            <>
              <div className="mb-2">
                <span className="text-xs text-text-muted">
                  共 {invitationCodes.length} 个邀请码
                </span>
              </div>
              {/* 删除确认内联块 */}
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
              <div className="max-h-[320px] space-y-3 overflow-y-auto">
                {invitationCodes.map((item) => (
                  <div key={item.id} className="rounded-xl border border-border bg-surface p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1 space-y-1">
                        <span className="block font-mono text-sm font-medium text-text">
                          {item.code}
                        </span>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-text-muted">
                          {(() => {
                            // 新逻辑：只用 used_count 和 max_uses 判断状态
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
