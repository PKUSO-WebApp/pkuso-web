"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/context/UserContext";
import { LogOut } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Modal } from "@/components/ui/Modal";

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
        position="center"
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
