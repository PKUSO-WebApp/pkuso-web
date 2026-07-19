"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/context/UserContext";
import { LogOut } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useProfiles } from "@/hooks/useProfiles";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import { Modal } from "@/components/ui/Modal";

function formatTime(s: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export default function ProfilePage() {
  const router = useRouter();
  const { user, logout } = useUser();

  const fullName = user?.name ?? "—";
  const instrument = user?.section ?? "—";
  const email = user?.email ?? "—";
  const isAdmin = user?.role === "admin";
  const initials = fullName !== "—" ? fullName.slice(0, 2) || fullName.slice(0, 1) || "--" : "--";

  const [isPwdModalOpen, setIsPwdModalOpen] = React.useState(false);
  const [newPwd, setNewPwd] = React.useState("");
  const [confirmPwd, setConfirmPwd] = React.useState("");
  const [isUpdatingPwd, setIsUpdatingPwd] = React.useState(false);

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  // —— 管理员：入团审批 ——
  const {
    data: pendingRows,
    loading: pendingLoading,
    approve,
  } = useProfiles(isAdmin ? { status: "pending" } : undefined);
  const [approvingId, setApprovingId] = React.useState<string | null>(null);

  const handleApprove = async (id: string) => {
    if (approvingId) return;
    setApprovingId(id);
    const ok = await approve(id);
    setApprovingId(null);
    if (!ok) alert("审批失败，请稍后重试。");
    else alert("已批准该用户。");
  };

  // —— 管理员：发布公告 ——
  const [announcementBody, setAnnouncementBody] = React.useState("");
  const { publish, publishing: announcementSubmitting } = useAnnouncements();

  const handlePublishAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = announcementBody.trim();
    if (!text) {
      alert("请输入公告内容。");
      return;
    }
    const ok = await publish(text);
    if (!ok) alert("发布失败");
    else {
      setAnnouncementBody("");
      alert("公告已发布");
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const pwd = newPwd.trim();
    const confirm = confirmPwd.trim();

    if (pwd !== confirm) {
      alert("两次输入的密码不一致");
      return;
    }
    if (pwd.length < 6) {
      alert("新密码长度至少 6 位");
      return;
    }

    setIsUpdatingPwd(true);
    const { error } = await supabase.auth.updateUser({ password: pwd });
    setIsUpdatingPwd(false);

    if (error) {
      alert(error.message || "密码修改失败，请稍后重试");
      return;
    }

    alert("密码修改成功！");
    setNewPwd("");
    setConfirmPwd("");
    setIsPwdModalOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* 顶部个人信息 */}
      <section className="rounded-2xl border border-border-light bg-surface p-4 shadow-[0_1px_4px_rgba(15,23,42,0.06)]">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-base font-medium text-white">
            {initials}
          </div>
          <div className={`min-w-0 flex-1 ${isAdmin ? "flex items-center" : "space-y-1"}`}>
            <h1 className="text-lg font-semibold text-text">{fullName}</h1>
            {!isAdmin ? (
              <>
                <p className="text-sm text-text-muted">
                  <span className="text-text-muted">声部</span> {instrument}
                </p>
                <p className="text-xs text-text-muted">
                  <span className="text-text-subtle">邮箱</span> {email}
                </p>
              </>
            ) : null}
          </div>
        </div>
      </section>

      {/* 管理员控制台：仅 admin */}
      {isAdmin && (
        <section className="space-y-4 rounded-2xl border-2 border-primary bg-muted p-4 shadow-sm">
          <h2 className="text-base font-semibold text-text">💃 管理员控制台</h2>

          {/* 入团审批 */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-label font-medium text-text-muted">
                入团审批 · 待处理（{pendingRows.length}）
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-full px-2 py-1 text-label text-text-muted hover:bg-border"
              >
                刷新
              </button>
            </div>
            {pendingLoading ? (
              <p className="py-4 text-center text-xs text-text-subtle">加载中…</p>
            ) : pendingRows.length === 0 ? (
              <p className="rounded-xl bg-surface/80 py-4 text-center text-xs text-text-muted">
                暂无待审批用户
              </p>
            ) : (
              <div className="max-h-[40vh] space-y-2 overflow-y-auto">
                {pendingRows.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-start justify-between gap-3 rounded-xl border border-border bg-surface px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-text">
                        {r.full_name || "未填写姓名"}
                      </p>
                      <p className="mt-0.5 text-xs text-text-muted">
                        {r.instrument || "未选择声部"}
                      </p>
                      <p className="mt-0.5 text-xs text-text-muted">{r.email || "未填写邮箱"}</p>
                      <p className="mt-0.5 text-label text-text-subtle">
                        注册时间：{formatTime(r.created_at)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleApprove(r.id)}
                      disabled={approvingId === r.id}
                      className="shrink-0 rounded-full bg-emerald-600 px-3 py-1.5 text-label font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                    >
                      {approvingId === r.id ? "处理中…" : "✅ 批准"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 发布公告 */}
          <div className="border-t border-border pt-4">
            <p className="mb-2 text-label font-medium text-text-muted">发布全团公告</p>
            <form onSubmit={handlePublishAnnouncement} className="space-y-2">
              <textarea
                value={announcementBody}
                onChange={(e) => setAnnouncementBody(e.target.value)}
                rows={4}
                className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-text-muted"
                placeholder="输入公告内容…"
              />
              <button
                type="submit"
                disabled={announcementSubmitting}
                className="w-full rounded-xl bg-primary py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
              >
                {announcementSubmitting ? "发布中…" : "发布"}
              </button>
            </form>
          </div>
        </section>
      )}

      {/* 修改密码入口 */}
      <section className="mt-4">
        <button
          type="button"
          onClick={() => setIsPwdModalOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium text-text hover:bg-muted"
        >
          <span>🔒 修改密码</span>
        </button>
      </section>

      {/* 退出登录 */}
      <section className="mt-3">
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600 shadow-sm hover:bg-red-100"
        >
          <LogOut className="h-4 w-4" />
          <span>退出登录</span>
        </button>
      </section>

      {/* 修改密码弹窗 */}
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
              className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-sm text-text outline-none focus:border-text-muted"
              placeholder="至少 6 位"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-muted">确认新密码</label>
            <input
              type="password"
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-sm text-text outline-none focus:border-text-muted"
              placeholder="再次输入新密码"
            />
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              disabled={isUpdatingPwd}
              onClick={() => {
                if (isUpdatingPwd) return;
                setIsPwdModalOpen(false);
              }}
              className="rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium text-text-muted hover:bg-muted disabled:opacity-60"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isUpdatingPwd}
              className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {isUpdatingPwd ? "提交中..." : "确认修改"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
