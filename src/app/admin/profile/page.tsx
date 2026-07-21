"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/context/user-context";
import { LogOut } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Modal } from "@/components/ui/Modal";
import { Toggle } from "@/components/ui/Toggle";

export default function ProfilePage() {
  const router = useRouter();
  const { user, logout } = useUser();
  const fullName = user?.name ?? "—";
  const instrument = user?.section ?? "—";
  const email = user?.email ?? "—";
  const initials = fullName !== "—" ? fullName.slice(0, 2) || fullName.slice(0, 1) || "--" : "--";

  const [isPwdModalOpen, setIsPwdModalOpen] = React.useState(false);
  const [newPwd, setNewPwd] = React.useState("");
  const [confirmPwd, setConfirmPwd] = React.useState("");
  const [isUpdatingPwd, setIsUpdatingPwd] = React.useState(false);

  // 邀请码管理状态
  const [showInvitationCode, setShowInvitationCode] = React.useState(false);
  const [invitationMode, setInvitationMode] = React.useState<"single" | "batch">("single");
  const [customCode, setCustomCode] = React.useState("");
  const [maxUses, setMaxUses] = React.useState(1);
  const [batchCount, setBatchCount] = React.useState(1);
  const [generatedCodes, setGeneratedCodes] = React.useState<{ code: string; max_uses: number }[]>(
    [],
  );
  const [isGenerating, setIsGenerating] = React.useState(false);

  // 生成随机邀请码
  const generateRandomCode = (length: number = 20): string => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "";
    for (let i = 0; i < length; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };

  // 生成唯一邀请码（确保不重复）
  const generateUniqueCode = async (): Promise<string> => {
    let code: string;
    do {
      code = generateRandomCode(20).toUpperCase();
      const { data } = await supabase.from("invitation_codes").select("code").eq("code", code);
      if (!data?.length) break;
    } while (true);
    return code;
  };

  // 单个生成邀请码
  const handleSingleGenerate = async () => {
    if (isGenerating) return;
    const code = customCode.trim().toUpperCase() || generateRandomCode(20).toUpperCase();
    if (code.length > 20) {
      alert("邀请码长度不能超过 20 个字符");
      return;
    }
    if (!code) {
      alert("请输入邀请码或留空自动生成");
      return;
    }

    setIsGenerating(true);
    try {
      const { error } = await supabase.from("invitation_codes").insert([
        {
          code,
          max_uses: maxUses,
          used_count: 0,
          created_by: user?.id || null,
        },
      ]);

      if (error) {
        alert(`生成失败: ${error.message}`);
      } else {
        setGeneratedCodes([{ code, max_uses: maxUses }]);
        setCustomCode("");
      }
    } catch (err) {
      alert(`生成失败: ${(err as Error).message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  // 批量生成邀请码
  const handleBatchGenerate = async () => {
    if (isGenerating) return;
    if (batchCount < 1 || batchCount > 100) {
      alert("生成数量必须在1-100之间");
      return;
    }

    setIsGenerating(true);
    try {
      const codes: { code: string; max_uses: number }[] = [];
      for (let i = 0; i < batchCount; i++) {
        const code = await generateUniqueCode();
        codes.push({
          code,
          max_uses: 1,
        });
      }

      const insertData = codes.map((c) => ({
        code: c.code,
        max_uses: c.max_uses,
        used_count: 0,
        created_by: user?.id || null,
      }));

      const { error } = await supabase.from("invitation_codes").insert(insertData);

      if (error) {
        alert(`生成失败: ${error.message}`);
      } else {
        setGeneratedCodes(codes);
        setBatchCount(1);
      }
    } catch (err) {
      alert(`生成失败: ${(err as Error).message}`);
    } finally {
      setIsGenerating(false);
    }
  };

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

      <button
        type="button"
        onClick={() => setShowInvitationCode(!showInvitationCode)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium text-text hover:bg-muted"
      >
        🎟️ 生成邀请码
      </button>

      {showInvitationCode && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <Toggle
            options={["单个生成", "批量生成"] as const}
            value={invitationMode === "single" ? "单个生成" : "批量生成"}
            onChange={(value) => {
              setInvitationMode(value === "单个生成" ? "single" : "batch");
              setGeneratedCodes([]);
            }}
          />

          {invitationMode === "single" ? (
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-text-muted">
                  邀请码（可选，留空则随机生成20位）
                </label>
                <input
                  type="text"
                  value={customCode}
                  onChange={(e) => setCustomCode(e.target.value)}
                  className="input"
                  placeholder="输入邀请码或留空"
                  maxLength={20}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-text-muted">
                  使用次数（默认1，0表示不限次数）
                </label>
                <input
                  type="number"
                  value={maxUses}
                  onChange={(e) => setMaxUses(Math.max(0, parseInt(e.target.value) || 1))}
                  className="input"
                  min="0"
                  placeholder="1"
                />
              </div>
              <button
                type="button"
                onClick={handleSingleGenerate}
                disabled={isGenerating}
                className="w-full rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
              >
                {isGenerating ? "生成中..." : "生成"}
              </button>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-text-muted">生成数量</label>
                <input
                  type="number"
                  value={batchCount}
                  onChange={(e) =>
                    setBatchCount(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))
                  }
                  className="input"
                  min="1"
                  max="100"
                  placeholder="1"
                />
              </div>
              <p className="text-xs text-text-muted">随机生成的邀请码使用次数为1</p>
              <button
                type="button"
                onClick={handleBatchGenerate}
                disabled={isGenerating}
                className="w-full rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
              >
                {isGenerating ? "生成中..." : "生成"}
              </button>
            </div>
          )}

          {generatedCodes.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-text-muted">生成结果</p>
              <div className="max-h-[200px] overflow-y-auto space-y-2">
                {generatedCodes.map((item, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-xs"
                  >
                    <span className="text-text">{item.code}</span>
                    <span className="text-text-muted">
                      使用次数: {item.max_uses === 0 ? "不限" : item.max_uses}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

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
        className="flex w-full items-center justify-center gap-2 rounded-full bg-danger-bg px-4 py-2.5 text-sm font-medium text-danger shadow-sm hover:opacity-80"
      >
        <LogOut className="h-4 w-4" />
        退出登录
      </button>

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
    </div>
  );
}
