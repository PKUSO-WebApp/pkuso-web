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
import type { FeedbackRow, InvitationCodeRow, SystemNotificationRow } from "@/types/database";

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
  const genSubmittingRef = React.useRef(false); // 同步 guard，阻断竞态窗口

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
  const [isSigFullscreen, setIsSigFullscreen] = React.useState(false);

  // ---- 反馈列表（Issue #209）----
  // 状态机：打开弹窗时查询（避免进「我的」页就拉一次）；成员端匿名提交（表无作者列），
  // 只读展示内容 + 提交时间倒序，无删除/标记。竞态守卫用递增序号（快速开关丢弃过期响应）。
  const [isFeedbackOpen, setIsFeedbackOpen] = React.useState(false);
  const [feedbackRows, setFeedbackRows] = React.useState<FeedbackRow[]>([]);
  const [feedbackLoading, setFeedbackLoading] = React.useState(false);
  const [feedbackError, setFeedbackError] = React.useState(false); // 查询失败态（显示「加载失败」+ 重试）
  const feedbackSeqRef = React.useRef(0);
  // 删除进行中 id（Issue #210）：防重复删除的同步阻断（CLAUDE.md deletingId 范式）
  const [deletingFeedbackId, setDeletingFeedbackId] = React.useState<string | null>(null);

  /** 拉取反馈列表（created_at 倒序；admin 浏览器端，is_admin() RLS 放行） */
  const fetchFeedback = () => {
    const seq = ++feedbackSeqRef.current;
    setFeedbackLoading(true);
    setFeedbackError(false);
    void supabase
      .from("feedback")
      .select("id, content, created_at")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        // 仅最新一次打开弹窗的响应生效（快速开关时丢弃过期响应）
        if (seq !== feedbackSeqRef.current) return;
        setFeedbackLoading(false);
        if (error) {
          console.error("[Admin Profile] 反馈列表查询失败", error.message);
          setFeedbackError(true);
          setFeedbackRows([]);
          return;
        }
        setFeedbackRows((data as FeedbackRow[] | null) ?? []);
      });
  };

  const handleOpenFeedbackModal = () => {
    setIsFeedbackOpen(true);
    fetchFeedback();
  };

  /** 删除反馈（Issue #210）：走 service role API route（feedback 无 DELETE RLS 策略）。
   *  confirm 二次确认；deletingFeedbackId 同步阻断防重复删除；成功后本地移除该行 */
  const handleDeleteFeedback = async (id: string) => {
    if (deletingFeedbackId) return; // 同步阻断（setState 异步，deletingFeedbackId 闭包旧值兜底）
    if (!window.confirm("确定删除这条反馈吗？删除后不可恢复")) return;
    setDeletingFeedbackId(id);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const response = await window.fetch(`/api/admin/feedback?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : undefined,
      });
      const result = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (response.ok && result?.ok) {
        setFeedbackRows((prev) => prev.filter((r) => r.id !== id));
      } else {
        alert(result?.error || "删除失败");
      }
    } catch {
      alert("网络错误");
    } finally {
      setDeletingFeedbackId(null);
    }
  };

  // ---- 发布系统通知（Issue #227）----
  // 状态机：打开弹窗拉历史；发布走 service role API（向全体 approved 成员广播）。
  // 撰写区：标题 + 内容 + 发布按钮（双 guard：publishingRef 同步 + isPublishing state）；
  // 历史列表：system_notifications 倒序、只读。竞态守卫用递增序号（快速开关丢弃过期响应）。
  const [isNotifyOpen, setIsNotifyOpen] = React.useState(false);
  const [notifyTitle, setNotifyTitle] = React.useState("");
  const [notifyContent, setNotifyContent] = React.useState("");
  const [isPublishing, setIsPublishing] = React.useState(false);
  const publishingRef = React.useRef(false); // 同步 guard，阻断竞态窗口
  const [publishError, setPublishError] = React.useState<string | null>(null);
  const [publishSuccess, setPublishSuccess] = React.useState(false);
  const [notifyRows, setNotifyRows] = React.useState<SystemNotificationRow[]>([]);
  const [notifyLoading, setNotifyLoading] = React.useState(false);
  const [notifyError, setNotifyError] = React.useState(false); // 查询失败态（显示「加载失败」+ 重试）
  const notifySeqRef = React.useRef(0);

  /** 拉取系统通知历史（created_at 倒序；admin 浏览器端，is_admin() RLS 放行） */
  const fetchNotifyHistory = () => {
    const seq = ++notifySeqRef.current;
    setNotifyLoading(true);
    setNotifyError(false);
    void supabase
      .from("system_notifications")
      .select("id, title, content, created_at")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        // 仅最新一次打开弹窗的响应生效（快速开关时丢弃过期响应）
        if (seq !== notifySeqRef.current) return;
        setNotifyLoading(false);
        if (error) {
          console.error("[Admin Profile] 系统通知历史查询失败", error.message);
          setNotifyError(true);
          setNotifyRows([]);
          return;
        }
        setNotifyRows((data as SystemNotificationRow[] | null) ?? []);
      });
  };

  const handleOpenNotifyModal = () => {
    setIsNotifyOpen(true);
    fetchNotifyHistory();
  };

  /** 发布系统通知（Issue #227）：POST /api/admin/notify-system（service role 广播）。
   *  双 guard（publishingRef + isPublishing）防重复提交；成功后清空输入、刷新历史 */
  const handlePublishNotify = async () => {
    const title = notifyTitle.trim();
    const content = notifyContent.trim();
    if (!title || !content) {
      setPublishError("标题与内容均不能为空");
      return;
    }
    if (publishingRef.current || isPublishing) return; // 双 guard
    publishingRef.current = true;
    setIsPublishing(true);
    setPublishError(null);
    setPublishSuccess(false);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const response = await window.fetch("/api/admin/notify-system", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ title, content }),
      });
      const result = (await response.json().catch(() => null)) as {
        success?: boolean;
        count?: number;
        error?: string;
      } | null;
      if (response.ok && result?.success) {
        setNotifyTitle("");
        setNotifyContent("");
        setPublishSuccess(true);
        fetchNotifyHistory(); // 发布后刷新历史
      } else {
        setPublishError(result?.error || "发布失败");
      }
    } catch {
      setPublishError("网络错误");
    } finally {
      publishingRef.current = false;
      setIsPublishing(false);
    }
  };

  // 全屏编辑时锁定背景滚动（清理时恢复；组件卸载时 cleanup 同样恢复）
  React.useEffect(() => {
    if (!isSigFullscreen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isSigFullscreen]);

  // 全屏入口按钮 ref：全屏关闭后把焦点归还给它，避免焦点停在已卸载的覆盖层上
  const fullscreenToggleRef = React.useRef<HTMLButtonElement>(null);

  // 全屏关闭（或组件卸载）时归还焦点到「⤢ 全屏」按钮；
  // 先捕获节点再用于 cleanup：cleanup 执行时 ref 可能已变化，且卸载时 focus 天然 no-op
  React.useEffect(() => {
    if (!isSigFullscreen) return;
    const toggleBtn = fullscreenToggleRef.current;
    return () => {
      toggleBtn?.focus();
    };
  }, [isSigFullscreen]);

  // 全屏覆盖层根节点 ref：焦点循环（focus trap）据此实时查询容器内可聚焦元素
  const fullscreenRef = React.useRef<HTMLDivElement>(null);

  /**
   * 全屏覆盖层焦点循环：Tab/Shift+Tab 永远停留在覆盖层内，
   * 防止焦点逃逸到页面其他按钮（如「退出登录」），误触回车直接登出丢失草稿。
   * 注意：必须用 e.key === "Tab" 精确匹配（Tab 的 key 是 "Tab"，不是 keyCode）
   */
  const handleFullscreenKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const container = fullscreenRef.current;
    if (!container) return;
    // 每次按键实时查询容器内可聚焦元素（querySelectorAll 以容器为作用域），
    // 保证 disabled/显隐变化后顺序仍正确；disabled、aria-hidden、inert、
    // tabindex="-1"（仅可编程聚焦，不参与 Tab 顺序）的元素均排除
    const focusables = Array.from(
      container.querySelectorAll<HTMLElement>("button, textarea, [tabindex]"),
    ).filter((el) => {
      if (el.hasAttribute("disabled")) return false;
      if (el.getAttribute("aria-hidden") === "true") return false;
      if (el.tabIndex < 0) return false;
      if (el.closest("[inert]")) return false;
      return true;
    });
    if (focusables.length === 0) {
      // 覆盖层内无可聚焦元素（如保存中全部按钮 disabled）：
      // 同样必须拦截 Tab，否则焦点逃逸到覆盖层外（如「退出登录」），Enter 误触直接登出丢草稿。
      // 真实浏览器中 disabled 持焦会把 activeElement 移到 body（focus fixup），之后 keydown
      // target 是 body、不会冒泡到这里——handleSaveSignature 进入提交时已主动把焦点移入
      // 覆盖层根（tabIndex=-1），保证此处的 keydown 一定来自覆盖层内（根节点或其后代），
      // preventDefault 真实生效。焦点停留在原地，元素恢复可用后焦点循环自然恢复
      e.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    // 边界判定：焦点是否落在可聚焦列表内。
    // 不在列表内的元素（容器内 disabled/aria-hidden 等被过滤的元素、以及容器外元素）
    // 一律视为边界——否则点击「保存」后按钮 disabled 且焦点仍停在上面时，
    // 浏览器默认 Tab 会让焦点逃逸到覆盖层外（如「退出登录」），Enter 误触直接登出丢草稿
    const active = document.activeElement as HTMLElement | null;
    const onFocusable = active !== null && focusables.includes(active);
    if (e.shiftKey) {
      // Shift+Tab：焦点不在可聚焦列表内、或在首元素时循环到末元素
      if (!onFocusable || active === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      // Tab：焦点不在可聚焦列表内、或在末元素时循环回首元素
      if (!onFocusable || active === last) {
        e.preventDefault();
        first.focus();
      }
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
    // 双重检查：ref 同步阻断，state 异步兜底
    if (genSubmittingRef.current || isGenSubmitting) return;

    // 清除之前的错误
    setGenError(null);

    // 批量生成前校验数量
    if (genMode === "batch" && (batchCount < 1 || batchCount > 100)) {
      setGenError("生成数量必须为 1-100");
      return;
    }

    genSubmittingRef.current = true;
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
      genSubmittingRef.current = false;
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
    setIsSigFullscreen(false);
    setSigSuccess(false);
    void fetchSignature();
  };

  /** 关闭签名 Modal：若全屏编辑开着，一并关闭，避免覆盖层残留 */
  const handleCloseSigModal = () => {
    if (sigSubmitting) return;
    setIsSigModalOpen(false);
    setIsSigFullscreen(false);
  };

  /** 全屏编辑中的保存：成功后关闭全屏回到弹窗（弹窗显示"签名已保存"） */
  const handleSaveFromFullscreen = async () => {
    const ok = await handleSaveSignature();
    if (ok) setIsSigFullscreen(false);
  };

  /** 保存邮件签名：ref 同步阻断 + state 异步兜底，防止重复提交；成功返回 true */
  const handleSaveSignature = async (): Promise<boolean> => {
    if (sigSubmittingRef.current || sigSubmitting) return false;
    sigSubmittingRef.current = true;
    setSigSubmitting(true);
    // 保存开始后覆盖层内全部按钮将 disabled。真实浏览器中 disabled 持焦会把 activeElement
    // 移到 body（HTML focus fixup；jsdom 不模拟），之后 Tab 的 keydown target 是 body、
    // 不冒泡经过覆盖层 → handleFullscreenKeyDown 收不到 → 空列表分支的 preventDefault
    // 不生效 → 焦点逃逸到页面按钮（如「管理邀请码」）。
    // 因此主动把焦点移入覆盖层根（tabIndex=-1，可编程聚焦但不进 Tab 顺序），
    // 之后 keydown 从覆盖层内冒泡，空列表分支的 preventDefault 真实生效
    if (isSigFullscreen) fullscreenRef.current?.focus();
    setSigError(null);
    setSigSuccess(false);
    try {
      const token = await getFreshAccessToken();
      if (!token) {
        // token 获取失败（登录过期），不发请求，提示重新登录
        setSigError("登录状态异常，请重新登录");
        return false;
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
      return true;
    } catch (err) {
      setSigError(err instanceof Error ? err.message : "保存失败，请重试");
      return false;
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

      {/* 反馈列表（Issue #209）：成员匿名反馈，只读列表 */}
      <button
        type="button"
        onClick={handleOpenFeedbackModal}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium text-text hover:bg-muted"
      >
        💬 反馈列表
      </button>

      {/* 发布系统通知（Issue #227）：向全体已批准成员广播站内通知 + 历史列表 */}
      <button
        type="button"
        onClick={handleOpenNotifyModal}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium text-text hover:bg-muted"
      >
        📢 发布系统通知
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

      {/* 邮件签名设置 Modal（全屏编辑打开时 inert 隔离：Tab/点击无法逃逸到弹窗，防止误触「关闭」丢草稿） */}
      <div inert={isSigFullscreen}>
        <Modal
          open={isSigModalOpen}
          onClose={handleCloseSigModal}
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
                <div className="relative">
                  {/* 不用 .input（其固定 height 会让 rows 失效），显式类与输入框样式保持一致 */}
                  <textarea
                    value={sigValue}
                    onChange={(e) => {
                      setSigValue(e.target.value);
                      setSigSuccess(false);
                    }}
                    rows={9}
                    maxLength={EMAIL_SIGNATURE_MAX_LENGTH}
                    disabled={sigSubmitting}
                    className="w-full resize-none rounded-xl border border-border bg-muted px-3 py-3 pr-16 text-xs leading-[1.6] text-text outline-none focus:border-text-muted"
                    placeholder="如：北京大学交响乐团管理团队"
                  />
                  {/* 全屏编辑入口：不动 sigValue，草稿自然保留 */}
                  <button
                    type="button"
                    ref={fullscreenToggleRef}
                    disabled={sigSubmitting}
                    onClick={() => setIsSigFullscreen(true)}
                    className="absolute right-2 top-2 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text-muted hover:bg-muted disabled:opacity-60"
                  >
                    ⤢ 全屏
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-text-muted">支持多行换行</p>
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
                    onClick={handleCloseSigModal}
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
      </div>

      {/* 邮件签名全屏编辑覆盖层（页内独立，不动共享 Modal；z-index 高于 Modal 的 --z-modal） */}
      {isSigFullscreen && (
        <div
          ref={fullscreenRef}
          onKeyDown={handleFullscreenKeyDown}
          // tabIndex=-1：可编程聚焦但不进 Tab 顺序。保存开始时焦点会被主动移入此根节点，
          // 保证后续 keydown（target 在覆盖层内）能冒泡到 onKeyDown，空列表分支的
          // preventDefault 真实生效（详见 handleSaveSignature / handleFullscreenKeyDown 注释）
          tabIndex={-1}
          className="fixed inset-0 flex h-[100dvh] flex-col overscroll-contain bg-page-bg"
          style={{ zIndex: "var(--z-overlay)" }}
          role="dialog"
          aria-modal="true"
          aria-label="编辑邮件签名"
        >
          {/* 顶部栏 */}
          <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-base font-semibold text-text">编辑邮件签名</h2>
            <button
              type="button"
              aria-label="关闭全屏编辑"
              disabled={sigSubmitting}
              onClick={() => setIsSigFullscreen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-text-muted hover:bg-border disabled:opacity-60"
            >
              ✕
            </button>
          </div>

          {/* 中间：textarea 铺满（text-base 防 iOS 聚焦缩放） */}
          <div className="flex min-h-0 flex-1 flex-col">
            <textarea
              autoFocus
              value={sigValue}
              onChange={(e) => {
                setSigValue(e.target.value);
                setSigSuccess(false);
              }}
              maxLength={EMAIL_SIGNATURE_MAX_LENGTH}
              disabled={sigSubmitting}
              className="w-full min-h-0 flex-1 resize-none overscroll-contain rounded-xl border border-border bg-muted px-4 py-3 text-base leading-[1.6] text-text outline-none focus:border-text-muted"
              placeholder="如：北京大学交响乐团管理团队"
            />
            {sigError && <p className="shrink-0 px-4 pb-2 text-xs text-danger">{sigError}</p>}
          </div>

          {/* 底部栏 */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-3 pb-safe">
            <p className="text-xs text-text-muted">
              {sigValue.length}/{EMAIL_SIGNATURE_MAX_LENGTH}
            </p>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                disabled={sigSubmitting}
                onClick={() => setIsSigFullscreen(false)}
                className="rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium text-text-muted hover:bg-muted disabled:opacity-60"
              >
                返回
              </button>
              <button
                type="button"
                disabled={sigSubmitting}
                onClick={() => void handleSaveFromFullscreen()}
                className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
              >
                {sigSubmitting ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* 反馈列表 Modal（底部弹出，Issue #209/#210）：展示成员匿名反馈（内容 + 提交时间倒序）。
          表结构无作者列（匿名是结构保证），不显示任何作者信息；支持删除治理（走 service role API） */}
      <Modal
        open={isFeedbackOpen}
        onClose={() => setIsFeedbackOpen(false)}
        title="反馈列表"
        position="bottom"
      >
        <div className="mt-4 space-y-3 pb-safe">
          {feedbackLoading ? (
            <p className="py-8 text-center text-xs text-text-muted">加载中…</p>
          ) : feedbackError ? (
            <div className="py-8 text-center">
              <p className="text-xs text-danger">加载失败，请稍后重试</p>
              <button
                type="button"
                onClick={fetchFeedback}
                className="mt-3 rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium text-text-muted hover:bg-muted"
              >
                重试
              </button>
            </div>
          ) : feedbackRows.length === 0 ? (
            <p className="py-8 text-center text-xs text-text-muted">暂无反馈</p>
          ) : (
            // 罗列内容可滚动（max-h 容器，CLAUDE.md）
            <div className="max-h-[60vh] space-y-3 overflow-y-auto pb-1">
              {feedbackRows.map((row) => (
                <div key={row.id} className="rounded-xl border border-border bg-card p-3">
                  {/* 行头：提交时间 + 删除入口（Issue #210 治理：匿名反馈唯一清理途径） */}
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-caption text-text-muted">
                      {formatDateTimeInChina(row.created_at)}
                    </p>
                    <button
                      type="button"
                      disabled={deletingFeedbackId !== null}
                      onClick={() => void handleDeleteFeedback(row.id)}
                      className="shrink-0 text-caption text-danger hover:opacity-80 disabled:opacity-50"
                    >
                      {deletingFeedbackId === row.id ? "删除中…" : "删除"}
                    </button>
                  </div>
                  <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-text">
                    {row.content}
                  </p>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => setIsFeedbackOpen(false)}
            className="w-full rounded-xl border border-border bg-surface py-2.5 text-sm font-medium text-text-muted hover:bg-muted"
          >
            关闭
          </button>
        </div>
      </Modal>

      {/* 发布系统通知 Modal（底部弹出，Issue #227）：撰写区（标题+内容+发布）+ 历史列表。
           仅站内通知，向全体已批准成员广播；历史只读展示标题/内容/发布时间倒序。 */}
      <Modal
        open={isNotifyOpen}
        onClose={() => setIsNotifyOpen(false)}
        title="发布系统通知"
        position="bottom"
      >
        <div className="mt-4 space-y-3 pb-safe">
          {/* 撰写区 */}
          <div className="space-y-2 rounded-xl border border-border bg-card p-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">标题</label>
              <input
                type="text"
                value={notifyTitle}
                onChange={(e) => setNotifyTitle(e.target.value)}
                maxLength={100}
                className="input"
                placeholder="通知标题（必填，≤100 字）"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">内容</label>
              <textarea
                value={notifyContent}
                onChange={(e) => setNotifyContent(e.target.value)}
                maxLength={2000}
                rows={4}
                className="w-full rounded-lg border border-border bg-surface p-2 text-sm text-text leading-relaxed outline-none"
                placeholder="通知正文（必填，≤2000 字）"
              />
            </div>
            {/* 双按钮操作行右下角（Issue #182）：单一主操作靠右 */}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={isPublishing || !notifyTitle.trim() || !notifyContent.trim()}
                onClick={handlePublishNotify}
                className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
              >
                {isPublishing ? "发布中…" : "发布"}
              </button>
            </div>
            {publishError && <p className="text-xs text-danger">{publishError}</p>}
            {publishSuccess && <p className="text-xs text-success">已发布给全体已批准成员</p>}
          </div>

          {/* 历史列表 */}
          <p className="text-xs font-medium text-text-muted">已发布通知</p>
          {notifyLoading ? (
            <p className="py-6 text-center text-xs text-text-muted">加载中…</p>
          ) : notifyError ? (
            <div className="py-6 text-center">
              <p className="text-xs text-danger">加载失败，请稍后重试</p>
              <button
                type="button"
                onClick={fetchNotifyHistory}
                className="mt-3 rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium text-text-muted hover:bg-muted"
              >
                重试
              </button>
            </div>
          ) : notifyRows.length === 0 ? (
            <p className="py-6 text-center text-xs text-text-muted">暂无通知</p>
          ) : (
            // 罗列内容可滚动（max-h 容器，CLAUDE.md）
            <div className="max-h-[40vh] space-y-3 overflow-y-auto pb-1">
              {notifyRows.map((row) => (
                <div key={row.id} className="rounded-xl border border-border bg-card p-3">
                  <p className="text-caption text-text-muted">
                    {formatDateTimeInChina(row.created_at)}
                  </p>
                  <p className="mt-1 text-sm font-medium text-text">{row.title}</p>
                  <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-text">
                    {row.content}
                  </p>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => setIsNotifyOpen(false)}
            className="w-full rounded-xl border border-border bg-surface py-2.5 text-sm font-medium text-text-muted hover:bg-muted"
          >
            关闭
          </button>
        </div>
      </Modal>
    </div>
  );
}
