"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/context/user-context";
import { LogOut } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useProfiles } from "@/hooks/useProfiles";
import { isValidPhoneNumber } from "@/lib/validation";
import { Modal } from "@/components/ui/Modal";

// 通知栏目按钮（均未实现，点击弹出「功能开发中」占位弹窗）
const notificationItems = ["考勤与请假", "活动", "系统"] as const;

// 设置栏目占位按钮（个人信息/账号与密码/退出登录已接线，不在此列）
const placeholderSettingItems = ["考勤", "外观", "已发布的活动", "问题与反馈"] as const;

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
  const pwdSubmittingRef = React.useRef(false); // 同步 guard，阻断竞态窗口

  // 占位功能弹窗：标题 = 按钮名，内容「功能开发中」；null 表示未打开
  const [placeholderTitle, setPlaceholderTitle] = React.useState<string | null>(null);

  // 编辑个人信息（联系方式 + 学院）
  const { data: profileData, update: updateProfile } = useProfiles({ userId: user?.id });
  const myProfile = profileData[0];
  const [isEditModalOpen, setIsEditModalOpen] = React.useState(false);
  const [editPhone, setEditPhone] = React.useState("");
  const [editCollege, setEditCollege] = React.useState("");
  const [editError, setEditError] = React.useState<string | null>(null);
  const [isEditSubmitting, setIsEditSubmitting] = React.useState(false);
  const editSubmittingRef = React.useRef(false); // 同步 guard，阻断竞态窗口

  // 打开弹窗时用最新 profile 预填
  const handleOpenEditModal = () => {
    // myProfile 未加载完成时为 undefined，预填会得到空值，保存会清空数据
    if (!myProfile) {
      alert("个人信息加载中，请稍候再试");
      return;
    }
    setEditPhone(myProfile.phone_number ?? "");
    setEditCollege(myProfile.college ?? "");
    setEditError(null);
    setIsEditModalOpen(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    // 双重 guard 防重复提交：ref 同步阻断 + state 异步兜底
    if (editSubmittingRef.current || isEditSubmitting) return;

    const phone = editPhone.trim();
    if (phone && !isValidPhoneNumber(phone)) {
      setEditError("手机号格式不正确（11 位数字，以 1 开头）");
      return;
    }

    editSubmittingRef.current = true;
    setIsEditSubmitting(true);
    setEditError(null);
    try {
      const ok = await updateProfile(user.id, {
        phone_number: phone || null,
        college: editCollege.trim() || null,
      });
      if (ok) {
        setIsEditModalOpen(false);
        alert("个人信息已更新");
      } else {
        setEditError("保存失败，请重试");
      }
    } finally {
      editSubmittingRef.current = false;
      setIsEditSubmitting(false);
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
    // 双重 guard 防重复提交：ref 同步阻断 + state 异步兜底
    if (pwdSubmittingRef.current || isUpdatingPwd) return;
    pwdSubmittingRef.current = true;
    setIsUpdatingPwd(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPwd.trim() });
      if (error) alert(error.message);
      else {
        alert("密码修改成功");
        setNewPwd("");
        setConfirmPwd("");
        setIsPwdModalOpen(false);
      }
    } finally {
      // 无论成败都复位：避免抛异常时 isUpdatingPwd 卡 true，弹窗被守卫锁死无法关闭
      pwdSubmittingRef.current = false;
      setIsUpdatingPwd(false);
    }
  };

  // 弹窗打开时锁定背景滚动（防滚动穿透：fixed 遮罩的最近可滚动祖先就是本页根容器），关闭后恢复
  const anyModalOpen = isPwdModalOpen || isEditModalOpen || placeholderTitle !== null;

  return (
    // 本页豁免：整页滚动——page 根节点自身为滚动容器，tab bar 固定；
    // 其余页面维持固定视口（见 CLAUDE.md「罗列内容必须可滚动」豁免说明）
    <div
      className={`flex-1 min-h-0 ${
        anyModalOpen ? "overflow-hidden" : "overflow-y-auto"
      } overscroll-contain`}
    >
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

        {/* 通知栏目 */}
        <section>
          <h2 className="text-xs font-medium text-text-muted">通知</h2>
          <div className="mt-2 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {notificationItems.map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => setPlaceholderTitle(label)}
                className="flex w-full items-center px-4 py-3 text-sm font-medium text-text hover:bg-muted"
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        {/* 设置栏目 */}
        <section>
          <h2 className="text-xs font-medium text-text-muted">设置</h2>
          <div className="mt-2 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            <button
              type="button"
              onClick={handleOpenEditModal}
              className="flex w-full items-center px-4 py-3 text-sm font-medium text-text hover:bg-muted"
            >
              个人信息
            </button>
            <button
              type="button"
              onClick={() => setIsPwdModalOpen(true)}
              className="flex w-full items-center px-4 py-3 text-sm font-medium text-text hover:bg-muted"
            >
              账号与密码
            </button>
            {placeholderSettingItems.map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => setPlaceholderTitle(label)}
                className="flex w-full items-center px-4 py-3 text-sm font-medium text-text hover:bg-muted"
              >
                {label}
              </button>
            ))}
            {/* 退出登录：最后一行，红色文字 */}
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
      </div>

      {/* 修改密码 Modal（底部弹出） */}
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

      {/* 编辑个人信息 Modal */}
      <Modal
        open={isEditModalOpen}
        onClose={() => {
          if (!isEditSubmitting) setIsEditModalOpen(false);
        }}
        title="编辑个人信息"
        position="bottom"
        closeOnOverlay={!isEditSubmitting}
      >
        <form onSubmit={handleEditSubmit} className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-text-muted">联系方式</label>
            <input
              type="text"
              value={editPhone}
              onChange={(e) => {
                setEditPhone(e.target.value);
                setEditError(null);
              }}
              className="input"
              placeholder="11 位手机号"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-muted">学院</label>
            <input
              type="text"
              value={editCollege}
              onChange={(e) => {
                setEditCollege(e.target.value);
                setEditError(null);
              }}
              className="input"
              placeholder="所在学院"
            />
          </div>
          {editError && <p className="text-xs text-danger">{editError}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              disabled={isEditSubmitting}
              onClick={() => setIsEditModalOpen(false)}
              className="rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium text-text-muted hover:bg-muted disabled:opacity-60"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isEditSubmitting}
              className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {isEditSubmitting ? "保存中..." : "保存"}
            </button>
          </div>
        </form>
      </Modal>

      {/* 占位功能 Modal：标题 = 按钮名，内容一行「功能开发中」 */}
      <Modal
        open={placeholderTitle !== null}
        onClose={() => setPlaceholderTitle(null)}
        title={placeholderTitle ?? ""}
        position="bottom"
      >
        <p className="py-6 text-center text-sm text-text-muted">功能开发中</p>
      </Modal>
    </div>
  );
}
