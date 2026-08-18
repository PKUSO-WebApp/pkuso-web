"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/context/user-context";
import { useNotificationsContext } from "@/context/notification-context";
import { LogOut } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useProfiles } from "@/hooks/useProfiles";
import { isValidPhoneNumber } from "@/lib/validation";
import { formatDateTimeInChina } from "@/lib/date-utils";
import { Modal } from "@/components/ui/Modal";
import { Toggle } from "@/components/ui/Toggle";
import type { NotificationCategory, NotificationRow } from "@/types/database";

// 隐私开关选项（Issue #193）：各字段行尾的「公开 / 隐藏」分段开关，随表单一起保存
const PRIVACY_OPTIONS = ["public", "hidden"] as const;
const privacyLabel = (v: (typeof PRIVACY_OPTIONS)[number]) => (v === "hidden" ? "隐藏" : "公开");
const privacyValue = (hide: boolean) => (hide ? "hidden" : "public");

/** 是否为标准 YYYY-MM-DD 日期格式（date input 可表示的格式；历史数据可能为「2024秋」等学期格式） */
const isStandardDateString = (v: string | null | undefined): boolean =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

// 通知栏目：信箱按钮 → 通知分类映射（Issue #188）
const notificationItems: { label: string; category: NotificationCategory }[] = [
  { label: "考勤与请假", category: "attendance" },
  { label: "活动", category: "activity" },
  { label: "系统", category: "system" },
];

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

  // ---- 通知信箱（Issue #188）----
  // 状态机（对抗返工）：fetch 成功后才标已读，且只标本次实际展示的未读行——
  // 打开瞬间到达的新通知不在本次列表内，不会被误标；fetch 失败不标已读（用户未看到消息），
  // 显示「加载失败」可重开。DB 标记成功（或本就无未读）后共享未读数归零，tab 气泡立即消失。
  const { unreadCounts, markCategoryRead } = useNotificationsContext();
  const [inbox, setInbox] = React.useState<{
    label: string;
    category: NotificationCategory;
  } | null>(null);
  const [inboxMessages, setInboxMessages] = React.useState<NotificationRow[]>([]);
  const [inboxLoading, setInboxLoading] = React.useState(false);
  const [inboxError, setInboxError] = React.useState(false); // 消息查询失败态（显示「加载失败」）
  const inboxSeqRef = React.useRef(0); // 竞态守卫：快速切换信箱时丢弃过期响应（递增序号模式）

  /** 打开信箱：拉取该分类消息列表（created_at 倒序），成功后标记本次展示的未读为已读 */
  const openInbox = (label: string, category: NotificationCategory) => {
    setInbox({ label, category });
    setInboxLoading(true);
    setInboxError(false);
    const seq = ++inboxSeqRef.current;
    void supabase
      .from("notifications")
      .select("*")
      .eq("category", category)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        // 仅当前信箱的响应生效（用户可能已快速切换到另一信箱）
        if (seq !== inboxSeqRef.current) return;
        setInboxLoading(false);
        if (error) {
          console.error("[Profile] 消息列表查询失败", error.message);
          setInboxError(true);
          setInboxMessages([]);
          return; // fetch 失败不标已读
        }
        const rows = (data as NotificationRow[]) ?? [];
        setInboxMessages(rows);
        // 只标本次展示的未读行（已读行无需重复标记）
        const unreadIds = rows.filter((m) => m.read_at === null).map((m) => m.id);
        void markCategoryRead(category, unreadIds);
      });
  };

  // 编辑个人信息（联系方式 + 入团时间 + 学院 + 隐私开关）
  const { data: profileData, update: updateProfile } = useProfiles({ userId: user?.id });
  const myProfile = profileData[0];
  const [isEditModalOpen, setIsEditModalOpen] = React.useState(false);
  const [editPhone, setEditPhone] = React.useState("");
  const [editJoinDate, setEditJoinDate] = React.useState("");
  const [editCollege, setEditCollege] = React.useState("");
  const [hideEmail, setHideEmail] = React.useState(false);
  const [hidePhone, setHidePhone] = React.useState(false);
  const [hideJoinDate, setHideJoinDate] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);
  const [isEditSubmitting, setIsEditSubmitting] = React.useState(false);
  const editSubmittingRef = React.useRef(false); // 同步 guard，阻断竞态窗口

  // join_date 是否被用户改动过：历史数据可能为学期格式（如「2024秋」），
  // date input 无法表示，未改动时保存不写 join_date 字段，保留原值防误清空（Issue #193）
  const [isJoinDateTouched, setIsJoinDateTouched] = React.useState(false);

  // 打开弹窗时用最新 profile 预填
  const handleOpenEditModal = () => {
    // myProfile 未加载完成时为 undefined，预填会得到空值，保存会清空数据
    if (!myProfile) {
      alert("个人信息加载中，请稍候再试");
      return;
    }
    setEditPhone(myProfile.phone_number ?? "");
    setEditJoinDate(myProfile.join_date ?? "");
    setEditCollege(myProfile.college ?? "");
    setHideEmail(myProfile.hide_email);
    setHidePhone(myProfile.hide_phone);
    setHideJoinDate(myProfile.hide_join_date);
    setIsJoinDateTouched(false);
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

    // join_date 写入条件：用户改动过且值与原值不同（手滑点到同一天不写，保留原值）。
    // 任何实际变化（含标准 YYYY-MM-DD 原值）都需用户确认——移动端手滑打开日期选择器
    // 默认选中「今天」，若不确认会静默覆盖原日期（对抗返工，Issue #193）。
    const originalJoinDate = myProfile?.join_date ?? "";
    const willWriteJoinDate = isJoinDateTouched && editJoinDate.trim() !== originalJoinDate.trim();
    if (willWriteJoinDate) {
      const source = originalJoinDate.trim() || "当前为空";
      const target = editJoinDate.trim() || "（空）";
      if (!window.confirm(`保存将把入团时间从「${source}」变更为「${target}」，确认？`)) {
        return;
      }
    }

    editSubmittingRef.current = true;
    setIsEditSubmitting(true);
    setEditError(null);
    try {
      const ok = await updateProfile(user.id, {
        phone_number: phone || null,
        college: editCollege.trim() || null,
        hide_email: hideEmail,
        hide_phone: hidePhone,
        hide_join_date: hideJoinDate,
        // 未改动过 join_date（如历史学期格式）或值未变化时不写入，保留原值
        ...(willWriteJoinDate ? { join_date: editJoinDate || null } : {}),
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
  const anyModalOpen =
    isPwdModalOpen || isEditModalOpen || placeholderTitle !== null || inbox !== null;

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

        {/* 通知栏目：三个信箱按钮，右侧未读数字徽章（>0 时显示，Issue #188） */}
        <section>
          <h2 className="text-xs font-medium text-text-muted">通知</h2>
          <div className="mt-2 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {notificationItems.map(({ label, category }) => {
              const count = unreadCounts[category];
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => openInbox(label, category)}
                  className="flex w-full items-center px-4 py-3 text-sm font-medium text-text hover:bg-muted"
                >
                  {label}
                  {count > 0 && (
                    <span className="ml-auto rounded-full bg-danger px-1.5 py-0.5 text-caption font-medium leading-none text-danger-foreground">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
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
          {/* 邮箱：不可编辑，仅提供隐藏开关（Issue #193） */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <label className="block text-xs font-medium text-text-muted">邮箱</label>
              <Toggle
                options={PRIVACY_OPTIONS}
                value={privacyValue(hideEmail)}
                onChange={(v) => setHideEmail(v === "hidden")}
                getLabel={privacyLabel}
              />
            </div>
            <p className="truncate text-xs text-text-subtle">{myProfile?.email ?? "—"}</p>
          </div>
          {/* 联系方式 + 隐藏手机号开关 */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <label className="block text-xs font-medium text-text-muted">联系方式</label>
              <Toggle
                options={PRIVACY_OPTIONS}
                value={privacyValue(hidePhone)}
                onChange={(v) => setHidePhone(v === "hidden")}
                getLabel={privacyLabel}
              />
            </div>
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
          {/* 入团时间 + 隐藏入团时间开关（TEXT 列，日期输入值格式 YYYY-MM-DD 与列存文本一致） */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <label className="block text-xs font-medium text-text-muted">入团时间</label>
              <Toggle
                options={PRIVACY_OPTIONS}
                value={privacyValue(hideJoinDate)}
                onChange={(v) => setHideJoinDate(v === "hidden")}
                getLabel={privacyLabel}
              />
            </div>
            <input
              type="date"
              value={editJoinDate}
              onChange={(e) => {
                setEditJoinDate(e.target.value);
                setIsJoinDateTouched(true);
                setEditError(null);
              }}
              className="input"
            />
            {/* 原值非标准日期格式（date input 无法显示）时提示当前值，未修改则保存时保留（Issue #193） */}
            {myProfile?.join_date && !isStandardDateString(myProfile.join_date) && (
              <p className="text-caption text-text-subtle">
                当前值：{myProfile.join_date}（非日期格式，未修改则保留）
              </p>
            )}
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

      {/* 通知信箱 Modal（底部弹出）：标题 = 信箱名；消息列表 created_at 倒序，空列表「暂无消息」 */}
      <Modal
        open={inbox !== null}
        onClose={() => setInbox(null)}
        title={inbox?.label ?? ""}
        position="bottom"
      >
        <div className="mt-4 max-h-[60vh] space-y-3 overflow-y-auto">
          {inboxLoading && <p className="py-6 text-center text-xs text-text-muted">加载中…</p>}
          {!inboxLoading && inboxError && (
            <p className="py-6 text-center text-sm text-text-muted">加载失败，请稍后重试</p>
          )}
          {!inboxLoading && !inboxError && inboxMessages.length === 0 && (
            <p className="py-6 text-center text-sm text-text-muted">暂无消息</p>
          )}
          {!inboxLoading &&
            !inboxError &&
            inboxMessages.map((msg) => (
              <div key={msg.id} className="rounded-xl border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 text-sm font-medium text-text">{msg.title}</p>
                  <p className="flex-shrink-0 text-caption text-text-muted">
                    {formatDateTimeInChina(msg.created_at)}
                  </p>
                </div>
                <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-text-muted">
                  {msg.content}
                </p>
              </div>
            ))}
        </div>
      </Modal>
    </div>
  );
}
