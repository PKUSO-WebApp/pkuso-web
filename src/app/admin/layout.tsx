"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useUser } from "@/context/user-context";
import { AdminPageHeaderProvider, useAdminPageHeader } from "@/context/admin-page-header-context";
import { canVisitAdminPath, landingPathFor } from "@/lib/access";
import { ArrowLeft, Settings as Gear } from "lucide-react";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = useUser();
  const pathname = usePathname();
  const router = useRouter();

  // 当前路径不在本角色允许范围内时弹走：member / 未知角色 → 成员引导页；
  // score_manager 越界（非谱务路径，含 /admin 本身与 /admin/profile）→ 谱务列表。
  // 判据只有一份（lib/access），别再内联角色比较。
  React.useEffect(() => {
    if (!user) return;
    if (canVisitAdminPath(pathname, user.role)) return;
    router.replace(landingPathFor(user.role) ?? "/");
  }, [user, pathname, router]);

  // 拆分"加载中"与"未授权"两种状态
  const isLoading = !user;
  const isUnauthorized = !!user && !canVisitAdminPath(pathname, user.role);
  const isGuarding = isLoading || isUnauthorized;

  const [showReloadHint, setShowReloadHint] = React.useState(false);
  const [reloadFailed, setReloadFailed] = React.useState(false);

  const guardKey = `${isGuarding}|${isLoading}`;
  const [prevGuardKey, setPrevGuardKey] = React.useState(guardKey);
  if (prevGuardKey !== guardKey) {
    setPrevGuardKey(guardKey);
    setShowReloadHint(false);
    setReloadFailed(false);
  }

  React.useEffect(() => {
    if (!isGuarding) return;
    if (!isLoading) return;

    const hintTimer = setTimeout(() => setShowReloadHint(true), 3000);

    const reloadTimer = setTimeout(() => {
      if (typeof window === "undefined") return;
      const refreshes = parseInt(sessionStorage.getItem("admin_layout_refreshes") || "0", 10);
      if (refreshes < 2) {
        sessionStorage.setItem("admin_layout_refreshes", String(refreshes + 1));
        window.location.reload();
      } else {
        setReloadFailed(true);
      }
    }, 5000);

    return () => {
      clearTimeout(hintTimer);
      clearTimeout(reloadTimer);
    };
  }, [isGuarding, isLoading]);

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
    <AdminPageHeaderProvider>
      <div className="flex h-full flex-col">
        {/* 顶部栏 */}
        <AdminHeader />

        {/* 内容区 */}
        <main className="flex-1 min-h-0 px-4 py-4 overflow-y-auto">{children}</main>
      </div>
    </AdminPageHeaderProvider>
  );
}

function AdminHeader() {
  const router = useRouter();
  const { title, headerRight, onBack, headerLoading, hideBackButton } = useAdminPageHeader();
  const hasTitle = title.length > 0;

  const handleBack = React.useCallback(() => {
    if (onBack) {
      onBack();
    } else {
      router.push("/admin");
    }
  }, [onBack, router]);

  return (
    <header className="flex items-center px-4 py-3 border-b border-border bg-surface/95 backdrop-blur sticky top-0 z-10">
      {hasTitle && !hideBackButton ? (
        <button
          type="button"
          onClick={handleBack}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted hover:bg-border transition-colors"
          aria-label="返回"
        >
          <ArrowLeft className="h-4 w-4 text-text" />
        </button>
      ) : hasTitle && hideBackButton && headerLoading ? (
        <div
          className="animate-spin rounded-full h-5 w-5 border-2 border-primary border-t-transparent shrink-0"
          aria-label="加载中"
        />
      ) : !hasTitle && headerLoading ? (
        <div
          className="animate-spin rounded-full h-5 w-5 border-2 border-primary border-t-transparent shrink-0"
          aria-label="加载中"
        />
      ) : null}
      {hasTitle && <h1 className="ml-2 text-lg font-semibold text-text">{title}</h1>}
      <div className="ml-auto">
        {hasTitle && !hideBackButton ? (
          headerRight
        ) : (
          <button
            type="button"
            onClick={() => router.push("/admin/profile")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted hover:bg-border transition-colors"
            aria-label="设置"
          >
            <Gear className="h-4 w-4 text-text" />
          </button>
        )}
      </div>
    </header>
  );
}
