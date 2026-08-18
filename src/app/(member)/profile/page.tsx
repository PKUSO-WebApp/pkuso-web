"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/context/user-context";
import { useNotificationsContext } from "@/context/notification-context";
import { LogOut } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useProfiles } from "@/hooks/useProfiles";
import { isValidEmail, isValidPhoneNumber } from "@/lib/validation";
import {
  formatDateTimeInChina,
  formatRehearsalRange,
  getLocalDateString,
  parseLocalISO,
} from "@/lib/date-utils";
import { getSignBlockReason, hasSignedIn } from "@/lib/attendance-utils";
import { STATUS_LABEL, STATUS_TEXT_COLOR } from "@/lib/attendance-status";
import { Modal } from "@/components/ui/Modal";
import { Toggle } from "@/components/ui/Toggle";
import { ThemeModal } from "./components/theme-modal";
import type { AttendanceRow, NotificationCategory, NotificationRow } from "@/types/database";

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

// 设置栏目占位按钮（个人信息/账号与密码/考勤/外观/退出登录已接线，不在此列）
const placeholderSettingItems = ["已发布的活动", "问题与反馈"] as const;

// ---- 考勤查看（Issue #201）----

/** 考勤 join 排练的返回行（仅取展示所需排练列；不含 profiles 敏感列，
 *  Issue #193 列级权限不受影响，attendances/rehearsals 表正常 join 即可） */
type AttendanceWithRehearsal = AttendanceRow & {
  rehearsals?: {
    start_time?: string | null;
    end_time?: string | null;
    location?: string | null;
    repertoire?: string | null;
  } | null;
};

/** 日期字符串的次日（YYYY-MM-DD）：区间上界用开区间（< 次日），
 *  结束当天 23:59 开始的排练也算在区间内（字符串前缀比较会误排除当天深夜的排练） */
const nextDayString = (dateStr: string): string => {
  const d = parseLocalISO(dateStr);
  d.setDate(d.getDate() + 1);
  return getLocalDateString(d);
};

/**
 * 考勤状态展示（与详情弹窗五行映射同源语义，Issue #201）：
 * - present/late/excused：管理员评定或签到确定，直接按 STATUS_LABEL 映射；
 * - absent：新建排练时为全员预生成的默认占位（未签到）——排练未结束时
 *   不构成缺勤，显示「未签到」（与详情弹窗一致）；已结束（或已签到补签）才确认缺勤；
 * - status 为 null（历史数据/未评定）：显示「—」（无考勤状态）。
 * 返回 { label, className }；className 为空时由渲染层用默认文字色兜底。
 */
const getAttendanceDisplay = (
  status: AttendanceRow["status"],
  signInTime: string | null,
  startTime: string | null,
  endTime: string | null,
): { label: string; className: string } => {
  if (!status) return { label: "—", className: "text-text-muted" };
  if (status === "absent" && !hasSignedIn(signInTime)) {
    const blockReason = getSignBlockReason(startTime, endTime, new Date());
    if (blockReason !== "ended") return { label: "未签到", className: "text-text" };
  }
  return {
    label: STATUS_LABEL[status] ?? status,
    className: STATUS_TEXT_COLOR[status] ?? "",
  };
};

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
  // 换绑邮箱（Issue #199）：新邮箱输入 + 提交中状态 + 同步 guard
  const [newEmail, setNewEmail] = React.useState("");
  const [isRebindingEmail, setIsRebindingEmail] = React.useState(false);
  const rebindSubmittingRef = React.useRef(false); // 同步 guard，阻断竞态窗口

  // 占位功能弹窗：标题 = 按钮名，内容「功能开发中」；null 表示未打开
  const [placeholderTitle, setPlaceholderTitle] = React.useState<string | null>(null);

  // 外观弹窗（Issue #203）：亮色 / 暗色 / 跟随系统主题切换
  const [isThemeModalOpen, setIsThemeModalOpen] = React.useState(false);

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

  // ---- 考勤查看（Issue #201）----
  // 状态机：打开弹窗与切换起止日期时查询本人考勤（attendances join rehearsals）；
  // 起 > 止 时提示且不查询（保留上次结果，不清空已选日期）；区间未选（两端都空）默认查全部。
  // 竞态守卫用递增序号：快速切换区间时丢弃过期响应（与 inbox 同模式，CLAUDE.md 范式）。
  const [isAttendanceOpen, setIsAttendanceOpen] = React.useState(false);
  const [attendanceStart, setAttendanceStart] = React.useState("");
  const [attendanceEnd, setAttendanceEnd] = React.useState("");
  const [attendanceRows, setAttendanceRows] = React.useState<AttendanceWithRehearsal[]>([]);
  const [attendanceLoading, setAttendanceLoading] = React.useState(false);
  const [attendanceError, setAttendanceError] = React.useState(false); // 查询失败态（显示「加载失败」）
  const attendanceSeqRef = React.useRef(0);

  /** 拉取本人考勤：区间两端都填按起止过滤，只填一端按该端开放过滤（另一端不设界），
   *  两端都空查全部（默认行为）。排序：按排练开始时间倒序（近 → 远，最近的排练在前）。 */
  const fetchAttendance = (userId: string, startDate: string, endDate: string) => {
    setAttendanceLoading(true);
    setAttendanceError(false);
    const seq = ++attendanceSeqRef.current;
    let builder = supabase
      .from("attendances")
      .select("*, rehearsals!inner(start_time, end_time, location, repertoire)")
      .eq("user_id", userId);
    if (startDate) builder = builder.gte("rehearsals.start_time", startDate);
    if (endDate) {
      // 上界取结束日期次日（开区间）：结束当天任意时刻开始的排练都算在区间内
      builder = builder.lt("rehearsals.start_time", nextDayString(endDate));
    }
    void builder
      .order("start_time", { referencedTable: "rehearsals", ascending: false })
      .then(({ data, error }) => {
        // 仅最新一次查询的响应生效（用户可能已快速切换区间）
        if (seq !== attendanceSeqRef.current) return;
        setAttendanceLoading(false);
        if (error) {
          console.error("[Profile] 考勤列表查询失败", error.message);
          setAttendanceError(true);
          setAttendanceRows([]);
          return;
        }
        setAttendanceRows((data as AttendanceWithRehearsal[] | null) ?? []);
      });
  };

  /** 打开考勤弹窗：清空上次区间（重新打开默认查全部本人排练），拉取列表 */
  const handleOpenAttendance = () => {
    setAttendanceStart("");
    setAttendanceEnd("");
    setIsAttendanceOpen(true);
    if (user) fetchAttendance(user.id, "", "");
  };

  /** 开始日期变更：起 > 止 时仅提示不查询（保留上次结果，不清空已选），否则按新区间查询 */
  const handleAttendanceStartChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setAttendanceStart(v);
    if (!user) return;
    if (v && attendanceEnd && v > attendanceEnd) return; // 非法区间（起 > 止）：不查询
    fetchAttendance(user.id, v, attendanceEnd);
  };

  /** 结束日期变更：同上（起 > 止 时提示不查询） */
  const handleAttendanceEndChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setAttendanceEnd(v);
    if (!user) return;
    if (attendanceStart && v && attendanceStart > v) return;
    fetchAttendance(user.id, attendanceStart, v);
  };

  // 编辑个人信息（联系方式 + 入团时间 + 学院 + 隐私开关）
  const { data: profileData, update: updateProfile } = useProfiles({ userId: user?.id });
  const myProfile = profileData[0];

  // 换绑邮箱后同步 profiles.email（Issue #199）：
  // user-context 的 user.email 来自 profiles_roster 视图（profiles 表值，见 useAuth），
  // 与 myProfile.email 同源——换绑只改 auth.users.email，必须用 supabase.auth.getUser()
  // 取真实 auth email 与 profiles email 对比（对抗返工），不同则补写 email 字段。
  // 窗口语义：GoTrue 在 updateUser 成功后立即更新 auth.users.email（未确认前旧邮箱仍可登录），
  // 故未确认窗口内本页会把 profiles.email 提前同步为新邮箱——展示先行、登录未变，可接受。
  // 防循环：仅在值不同时调用一次 update；成功后 useProfiles 内部把新值合并进本地 data，
  // myProfile.email 随之与 auth email 一致，依赖变化后再次对比已相同，不再触发。
  // update/getUser 失败时不合并 data、依赖不变，effect 不会重跑，不会无限循环。
  React.useEffect(() => {
    const userId = user?.id;
    const profileEmail = myProfile?.email;
    if (!userId || !profileEmail) return;
    void supabase.auth
      .getUser()
      .then(({ data }) => {
        const authEmail = data.user?.email;
        if (!authEmail) return;
        if (profileEmail.toLowerCase() === authEmail.toLowerCase()) return;
        void updateProfile(userId, { email: authEmail });
      })
      .catch((err: unknown) => {
        console.warn("[Profile] 获取 auth 邮箱失败，跳过 profiles.email 同步", err);
      });
  }, [myProfile?.email, user?.id, updateProfile]);

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
        // 换绑提交进行中不关闭弹窗（对抗返工 Issue #199）：用 ref 而非 state——
        // async 闭包里的 state 是提交时的旧值，ref 同步反映当前是否仍在飞行
        if (!rebindSubmittingRef.current) setIsPwdModalOpen(false);
      }
    } finally {
      // 无论成败都复位：避免抛异常时 isUpdatingPwd 卡 true，弹窗被守卫锁死无法关闭
      pwdSubmittingRef.current = false;
      setIsUpdatingPwd(false);
    }
  };

  // 换绑邮箱（Issue #199）：提交后 Supabase 向新邮箱发确认邮件，点击邮件内链接才完成换绑；
  // 未确认前 auth 仍用旧邮箱，因此只清空输入、不关闭弹窗（与改密同款 alert 提示）。
  const handleRebindEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const email = newEmail.trim();
    if (!email) return alert("请输入新邮箱");
    if (!isValidEmail(email)) return alert("邮箱格式不正确");
    if (email.toLowerCase() === (user.email ?? "").toLowerCase())
      return alert("新邮箱与当前邮箱相同");
    // 双重 guard 防重复提交：ref 同步阻断 + state 异步兜底
    if (rebindSubmittingRef.current || isRebindingEmail) return;
    rebindSubmittingRef.current = true;
    setIsRebindingEmail(true);
    try {
      const { error } = await supabase.auth.updateUser({ email });
      if (error) alert(error.message);
      else {
        alert("确认邮件已发送至新邮箱，请点击邮件内链接完成换绑（未确认前仍使用旧邮箱）");
        setNewEmail("");
      }
    } finally {
      // 无论成败都复位：避免抛异常时 isRebindingEmail 卡 true，输入被永久禁用
      rebindSubmittingRef.current = false;
      setIsRebindingEmail(false);
    }
  };

  // 弹窗打开时锁定背景滚动（防滚动穿透：fixed 遮罩的最近可滚动祖先就是本页根容器），关闭后恢复
  const anyModalOpen =
    isPwdModalOpen ||
    isEditModalOpen ||
    placeholderTitle !== null ||
    inbox !== null ||
    isAttendanceOpen ||
    isThemeModalOpen;

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
            {/* 考勤（Issue #201）：本人考勤历史，起止日期过滤 */}
            <button
              type="button"
              onClick={handleOpenAttendance}
              className="flex w-full items-center px-4 py-3 text-sm font-medium text-text hover:bg-muted"
            >
              考勤
            </button>
            {/* 外观（Issue #203）：亮色 / 暗色 / 跟随系统主题切换 */}
            <button
              type="button"
              onClick={() => setIsThemeModalOpen(true)}
              className="flex w-full items-center px-4 py-3 text-sm font-medium text-text hover:bg-muted"
            >
              外观
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

      {/* 账号与密码 Modal（底部弹出）：修改密码 + 换绑邮箱，两区块用 border-t 分隔 */}
      <Modal
        open={isPwdModalOpen}
        onClose={() => {
          // 任一提交进行中都不允许关闭（改密/换绑各自守卫，互不干扰）
          if (!isUpdatingPwd && !isRebindingEmail) setIsPwdModalOpen(false);
        }}
        title="修改登录密码"
        position="bottom"
        closeOnOverlay={!isUpdatingPwd && !isRebindingEmail}
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

        {/* 换绑邮箱（Issue #199）：当前邮箱只读展示 + 新邮箱输入；与改密区块 border-t 分隔 */}
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-xs font-medium text-text-muted">换绑邮箱</p>
          <p className="mt-1 text-xs text-text-subtle">当前邮箱：{email}</p>
          {/* noValidate：禁用浏览器原生邮箱格式气泡（英文/浏览器语言），统一走中文 alert 校验 */}
          <form onSubmit={handleRebindEmail} noValidate className="mt-3 space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">新邮箱</label>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="input"
                placeholder="输入新邮箱"
                disabled={isRebindingEmail}
              />
            </div>
            {/* 单主操作按钮右对齐（双按钮行右下角规范的唯一按钮豁免） */}
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="submit"
                disabled={isRebindingEmail}
                className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
              >
                {isRebindingEmail ? "发送中..." : "发送确认邮件"}
              </button>
            </div>
          </form>
        </div>
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

      {/* 外观 Modal（底部弹出，Issue #203）：亮色 / 暗色 / 跟随系统 三态切换 */}
      <ThemeModal open={isThemeModalOpen} onClose={() => setIsThemeModalOpen(false)} />

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

      {/* 考勤查看 Modal（底部弹出，Issue #201）：起止日期过滤本人考勤列表；
          两端都填按区间过滤、只填一端按该端开放过滤、都空查全部（默认）；
          起 > 止 显示校验提示且不查询（不清空已选日期） */}
      <Modal
        open={isAttendanceOpen}
        onClose={() => setIsAttendanceOpen(false)}
        title="我的考勤"
        position="bottom"
      >
        <div className="mt-4 space-y-3">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-text-muted">开始日期</label>
              <input
                type="date"
                value={attendanceStart}
                onChange={handleAttendanceStartChange}
                className="input"
              />
            </div>
            <span className="pb-2 text-sm text-text-muted">至</span>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-text-muted">结束日期</label>
              <input
                type="date"
                value={attendanceEnd}
                onChange={handleAttendanceEndChange}
                className="input"
              />
            </div>
          </div>
          {attendanceStart && attendanceEnd && attendanceStart > attendanceEnd && (
            <p className="text-xs text-danger">开始日期不能晚于结束日期</p>
          )}
          {/* 考勤列表：罗列内容可滚动（max-h 容器，CLAUDE.md） */}
          <div className="max-h-[60vh] space-y-3 overflow-y-auto pb-1">
            {attendanceLoading && (
              <p className="py-6 text-center text-xs text-text-muted">加载中…</p>
            )}
            {!attendanceLoading && attendanceError && (
              <p className="py-6 text-center text-sm text-text-muted">加载失败，请稍后重试</p>
            )}
            {!attendanceLoading && !attendanceError && attendanceRows.length === 0 && (
              <p className="py-6 text-center text-sm text-text-muted">该区间暂无考勤记录</p>
            )}
            {!attendanceLoading &&
              !attendanceError &&
              attendanceRows.map((row) => {
                const { label, className } = getAttendanceDisplay(
                  row.status,
                  row.sign_in_time,
                  row.rehearsals?.start_time ?? null,
                  row.rehearsals?.end_time ?? null,
                );
                return (
                  <div key={row.id} className="rounded-xl border border-border bg-card p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 text-sm font-medium text-text">
                        {row.rehearsals?.start_time
                          ? formatRehearsalRange(
                              row.rehearsals.start_time,
                              row.rehearsals.end_time ?? null,
                            )
                          : "时间未设置"}
                      </p>
                      <span
                        className={`flex-shrink-0 text-sm font-medium ${className || "text-text"}`}
                      >
                        {label}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-text-muted">
                      地点：{row.rehearsals?.location ?? "—"}
                    </p>
                    <p className="mt-0.5 text-xs text-text-muted">
                      曲目：{row.rehearsals?.repertoire ?? "—"}
                    </p>
                  </div>
                );
              })}
          </div>
        </div>
      </Modal>
    </div>
  );
}
