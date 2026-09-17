"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/context/user-context";
import { supabase } from "@/lib/supabase";
import { ThemeModal } from "@/components/theme-modal";
import { Modal } from "@/components/ui/Modal";
import { LogOut } from "lucide-react";
import { useAdminPageHeader } from "@/context/admin-page-header-context";

export default function ProfilePage() {
  const router = useRouter();
  const { logout } = useUser();
  const { setTitle, setOnBack } = useAdminPageHeader();

  React.useEffect(() => {
    setTitle("设置");
    setOnBack(() => router.back);
  }, [setTitle, setOnBack, router]);

  const [isPwdModalOpen, setIsPwdModalOpen] = React.useState(false);
  const [newPwd, setNewPwd] = React.useState("");
  const [confirmPwd, setConfirmPwd] = React.useState("");
  const [isUpdatingPwd, setIsUpdatingPwd] = React.useState(false);

  const [isThemeModalOpen, setIsThemeModalOpen] = React.useState(false);

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
    <div className="flex h-full min-h-0 flex-col">
      {/* 设置 section —— 完全复刻原版「设置」section，仅 3 个按钮 */}
      <section className="flex-1 min-h-0 p-4 overflow-y-auto">
        <div className="mt-2 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          <button
            type="button"
            onClick={() => setIsPwdModalOpen(true)}
            className="flex w-full items-center px-4 py-3 text-sm font-medium text-text hover:bg-muted"
          >
            修改密码
          </button>
          <button
            type="button"
            onClick={() => setIsThemeModalOpen(true)}
            className="flex w-full items-center px-4 py-3 text-sm font-medium text-text hover:bg-muted"
          >
            外观
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium text-danger hover:bg-muted"
          >
            <LogOut className="h-4 w-4" />
            退出登录
          </button>
        </div>
      </section>

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

      <ThemeModal open={isThemeModalOpen} onClose={() => setIsThemeModalOpen(false)} />
    </div>
  );
}
