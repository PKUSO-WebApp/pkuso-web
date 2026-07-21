"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useUser } from "@/context/user-context";
import type { UserRole } from "@/context/user-context";
import { useAuth } from "@/hooks/useAuth";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { login, logout } = useUser();
  const pathname = usePathname();
  const router = useRouter();

  const isAuthPage = pathname === "/login" || pathname === "/signup";

  const onProfileLoaded = React.useCallback(
    (profile: {
      id: string;
      name: string;
      role: string;
      section: string;
      status: string;
      email: string;
    }) => {
      login({
        id: profile.id,
        name: profile.name,
        role: (profile.role as UserRole) ?? "member",
        section: profile.section,
        status: profile.status,
        email: profile.email,
      });
    },
    [login],
  );

  const onClearProfile = React.useCallback(() => {
    logout();
  }, [logout]);

  const {
    sessionUserId,
    sessionLoading,
    emailConfirmed,
    profileStatus,
    profileRole,
    profileLoading,
    profileErrorMsg,
    handleSignOut,
  } = useAuth({ onProfileLoaded, onClearProfile });

  React.useEffect(() => {
    if (!sessionLoading && !sessionUserId && !isAuthPage) {
      router.replace("/login");
    }
  }, [sessionLoading, sessionUserId, isAuthPage, router]);

  // 管理员用户自动路由到 admin 端
  React.useEffect(() => {
    const isAdminPage = pathname === "/admin" || pathname.startsWith("/admin/");
    if (
      !sessionLoading &&
      !profileLoading &&
      sessionUserId &&
      emailConfirmed &&
      profileRole === "admin" &&
      profileStatus === "approved" &&
      !isAuthPage &&
      !isAdminPage
    ) {
      router.replace("/admin");
    }
  }, [
    sessionLoading,
    profileLoading,
    sessionUserId,
    emailConfirmed,
    profileRole,
    profileStatus,
    isAuthPage,
    pathname,
    router,
  ]);

  // 非 admin 用户访问 admin 路由时自动跳转到成员端
  React.useEffect(() => {
    const isAdminPage = pathname === "/admin" || pathname.startsWith("/admin/");
    if (
      !sessionLoading &&
      !profileLoading &&
      sessionUserId &&
      emailConfirmed &&
      profileRole !== "admin" &&
      profileStatus === "approved" &&
      !isAuthPage &&
      isAdminPage
    ) {
      router.replace("/");
    }
  }, [
    sessionLoading,
    profileLoading,
    sessionUserId,
    emailConfirmed,
    profileRole,
    profileStatus,
    isAuthPage,
    pathname,
    router,
  ]);

  const isPending = !!sessionUserId && profileStatus === "pending";
  const isRejected = !!sessionUserId && profileStatus === "rejected";
  const isEmailUnconfirmed = !!sessionUserId && !emailConfirmed;

  const handleLogout = () => {
    void handleSignOut();
    router.replace("/login");
  };

  return (
    <div className="h-screen flex justify-center">
      <div className="flex h-screen w-full max-w-md flex-col bg-page-bg">
        <main
          className={`flex-1 flex flex-col overflow-hidden ${isAuthPage ? "px-4 pt-4 pb-4" : ""}`}
        >
          {sessionLoading ? (
            <div className="flex h-full items-center justify-center text-xs text-text-subtle">
              正在检查登录状态…
            </div>
          ) : !sessionUserId && !isAuthPage ? (
            <div className="flex h-full items-center justify-center text-xs text-text-subtle">
              正在前往登录页…
            </div>
          ) : sessionUserId && profileLoading && !isAuthPage ? (
            <div className="flex h-full items-center justify-center text-xs text-text-subtle">
              正在加载账户信息…
            </div>
          ) : sessionUserId && profileErrorMsg && !isAuthPage ? (
            <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
              <h1 className="text-lg font-semibold text-text">账户信息异常</h1>
              <p className="mt-3 max-w-sm text-left text-sm leading-relaxed text-danger">
                {profileErrorMsg}
              </p>
              <p className="mt-2 text-xs text-text-muted">
                请打开浏览器控制台查看 [AuthGate] 的详细日志。
              </p>
              <button
                type="button"
                onClick={handleLogout}
                className="mt-6 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90"
              >
                退出登录
              </button>
            </div>
          ) : isPending && !isAuthPage ? (
            <div className="flex min-h-[70vh] flex-col items-center justify-center text-center">
              <div className="text-5xl">⏳</div>
              <h1 className="mt-4 text-lg font-semibold text-text">账号审核中...</h1>
              <p className="mt-2 max-w-xs text-sm text-text-muted">
                请等待管理员审批后访问乐团系统
              </p>
              <button
                type="button"
                onClick={handleLogout}
                className="mt-6 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90"
              >
                退出登录
              </button>
            </div>
          ) : isRejected && !isAuthPage ? (
            <div className="flex min-h-[70vh] flex-col items-center justify-center text-center">
              <div className="text-5xl">❌</div>
              <h1 className="mt-4 text-lg font-semibold text-text">账号已被拒绝</h1>
              <p className="mt-2 max-w-xs text-sm text-text-muted">
                您的申请未通过审核，无法访问乐团系统
              </p>
              <button
                type="button"
                onClick={handleLogout}
                className="mt-6 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90"
              >
                退出登录
              </button>
            </div>
          ) : isEmailUnconfirmed && !isAuthPage ? (
            <div className="flex min-h-[70vh] flex-col items-center justify-center text-center">
              <div className="text-5xl">📧</div>
              <h1 className="mt-4 text-lg font-semibold text-text">邮箱未验证</h1>
              <p className="mt-2 max-w-xs text-sm text-text-muted">
                请检查您的邮箱，点击验证链接完成邮箱验证
              </p>
              <p className="mt-2 text-xs text-text-muted">
                如果未收到邮件，请检查垃圾邮件箱或重新登录触发验证邮件
              </p>
              <button
                type="button"
                onClick={handleLogout}
                className="mt-6 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90"
              >
                退出登录
              </button>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
