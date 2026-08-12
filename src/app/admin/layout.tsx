"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useUser } from "@/context/user-context";
import { ClipboardList, Calendar, Music, User, UsersRound, MessagesSquare } from "lucide-react";

const tabs = [
  { href: "/admin", label: "控制台", icon: ClipboardList },
  { href: "/admin/rehearsals", label: "排练", icon: Music },
  { href: "/admin/community", label: "社区", icon: MessagesSquare },
  { href: "/admin/schedule", label: "日程", icon: Calendar },
  { href: "/admin/members", label: "成员", icon: UsersRound },
  { href: "/admin/profile", label: "我的", icon: User },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = useUser();
  const router = useRouter();
  const pathname = usePathname();

  // 非管理员自动跳转到成员端
  React.useEffect(() => {
    if (user && user.role !== "admin") router.replace("/");
  }, [user, router]);

  // 拆分"加载中"与"未授权"两种状态：
  // - isLoading: user 尚未加载完成（user === null），此时才允许自动刷新
  // - isUnauthorized: user 已加载完成但非 admin（正在跳转回成员端），不应触发刷新
  const isLoading = !user;
  const isUnauthorized = !!user && user.role !== "admin";
  const isGuarding = isLoading || isUnauthorized;

  const [showReloadHint, setShowReloadHint] = React.useState(false);
  const [reloadFailed, setReloadFailed] = React.useState(false);

  // 重新进入守护页（或守护状态切换）时重置提示状态
  // 采用 render 阶段调整 state 模式（React 官方推荐），避免 effect 体内同步 setState 触发级联渲染
  const guardKey = `${isGuarding}|${isLoading}`;
  const [prevGuardKey, setPrevGuardKey] = React.useState(guardKey);
  if (prevGuardKey !== guardKey) {
    setPrevGuardKey(guardKey);
    setShowReloadHint(false);
    setReloadFailed(false);
  }

  // 守护页超时自动刷新：仅在真正加载中（user === null）时启动
  // sessionStorage 限 2 次，防死循环；达到上限后切换到"加载失败"UI，提供手动重试入口
  React.useEffect(() => {
    if (!isGuarding) return;
    // 未授权用户：等待跳转即可，不启动自动刷新（避免浪费刷新计数）
    if (!isLoading) return;

    const hintTimer = setTimeout(() => setShowReloadHint(true), 3000);

    const reloadTimer = setTimeout(() => {
      if (typeof window === "undefined") return;
      const refreshes = parseInt(sessionStorage.getItem("admin_layout_refreshes") || "0", 10);
      if (refreshes < 2) {
        sessionStorage.setItem("admin_layout_refreshes", String(refreshes + 1));
        window.location.reload();
      } else {
        // 达到刷新上限，切换到"加载失败"UI
        setReloadFailed(true);
      }
    }, 5000);

    return () => {
      clearTimeout(hintTimer);
      clearTimeout(reloadTimer);
    };
  }, [isGuarding, isLoading]);

  // 清除刷新计数：
  // - 进入 admin 成功态（!isGuarding）时立即清除（成功摆脱守护页即复位）
  // - 组件卸载时（无论成功进入 admin 还是被跳转回成员端）也清除，
  //   避免 member 用户访问 /admin 触发自动刷新后 sessionStorage 残留计数，
  //   导致后续晋升为 admin 再访问时被误判为"多次刷新仍失败"
  React.useEffect(() => {
    if (!isGuarding && typeof window !== "undefined") {
      sessionStorage.removeItem("admin_layout_refreshes");
    }
    return () => {
      if (typeof window !== "undefined") {
        sessionStorage.removeItem("admin_layout_refreshes");
      }
    };
  }, [isGuarding]);

  // 手动重试：清除计数后重新加载
  const handleRetry = React.useCallback(() => {
    if (typeof window === "undefined") return;
    sessionStorage.removeItem("admin_layout_refreshes");
    window.location.reload();
  }, []);

  if (isGuarding) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center text-sm text-text-muted">
        {reloadFailed ? (
          <>
            <span className="text-danger">加载失败</span>
            <span className="mt-1 text-xs text-text-subtle">多次自动刷新仍未成功</span>
            <button
              type="button"
              onClick={handleRetry}
              className="mt-3 rounded-md bg-primary px-4 py-2 text-xs text-primary-foreground"
            >
              重试
            </button>
          </>
        ) : (
          <>
            <span>{isLoading ? "正在加载用户…" : "正在跳转…"}</span>
            {showReloadHint && (
              <span className="mt-2 text-xs text-text-subtle">加载较久，即将自动刷新页面…</span>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 h-full px-4 pt-4 pb-20 overflow-hidden">{children}</div>
      <nav className="fixed inset-x-0 bottom-0 z-20 flex justify-center bg-transparent pb-safe">
        <div className="w-full max-w-md border-t border-border bg-surface/95 backdrop-blur">
          <div className="flex items-center justify-around px-4 py-2">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active =
                tab.href === "/admin"
                  ? pathname === "/admin"
                  : pathname === tab.href || pathname.startsWith(tab.href + "/");

              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className="flex flex-1 flex-col items-center justify-center gap-1 text-xs"
                >
                  <div
                    className={`flex items-center justify-center rounded-full p-1.5 ${
                      active
                        ? "bg-primary text-primary-foreground"
                        : "text-text-muted hover:text-text"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <span
                    className={
                      active ? "text-label font-medium text-text" : "text-label text-text-muted"
                    }
                  >
                    {tab.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </nav>
    </>
  );
}
