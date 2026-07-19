"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useUser } from "@/context/user-context";
import type { UserRole } from "@/context/user-context";
import { TabBar } from "@/components/tab-bar";
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
    profileStatus,
    profileLoading,
    profileErrorMsg,
    handleSignOut,
  } = useAuth({ onProfileLoaded, onClearProfile });

  React.useEffect(() => {
    if (!sessionLoading && !sessionUserId && !isAuthPage) {
      router.replace("/login");
    }
  }, [sessionLoading, sessionUserId, isAuthPage, router]);

  const isPending = !!sessionUserId && profileStatus === "pending";
  const isApproved = !!sessionUserId && profileStatus === "approved";

  const handleLogout = () => {
    void handleSignOut();
    router.replace("/login");
  };

  return (
    <div className="min-h-screen flex justify-center">
      <div className="flex min-h-screen w-full max-w-md flex-col bg-white shadow-lg">
        <main className={`flex-1 overflow-y-auto px-4 pt-4 ${isAuthPage ? "pb-4" : "pb-20"}`}>
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
              <p className="mt-3 max-w-sm text-left text-sm leading-relaxed text-red-600">
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
          ) : sessionUserId && isPending && !isAuthPage ? (
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
          ) : sessionUserId && !isApproved && !isAuthPage ? (
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
          ) : (
            children
          )}
        </main>
        {!isAuthPage && sessionUserId && isApproved && <TabBar />}
      </div>
    </div>
  );
}
