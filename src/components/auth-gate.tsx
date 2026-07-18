"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useUser } from "@/context/UserContext";
import { TabBar } from "@/components/tab-bar";
import { supabase } from "@/lib/supabase";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, login, logout } = useUser();
  const pathname = usePathname();
  const router = useRouter();

  const isAuthPage = pathname === "/login" || pathname === "/signup";

  const [sessionLoading, setSessionLoading] = React.useState(true);
  const [sessionUserId, setSessionUserId] = React.useState<string | null>(null);
  const [profileLoading, setProfileLoading] = React.useState(false);
  const [profileStatus, setProfileStatus] = React.useState<string | null>(null);
  const [profileRole, setProfileRole] = React.useState<string | null>(null);
  const [profileName, setProfileName] = React.useState<string | null>(null);
  const [profileInstrument, setProfileInstrument] = React.useState<string | null>(null);
  const [profileEmail, setProfileEmail] = React.useState<string | null>(null);
  const [profileErrorMsg, setProfileErrorMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    let mounted = true;

    const init = async () => {
      setSessionLoading(true);
      const { data, error } = await supabase.auth.getSession();
      if (!mounted) return;
      if (error) {
        console.warn("[AuthGate] getSession 失败：", error.message);
      }
      const id = data.session?.user?.id ?? null;
      setSessionUserId(id);
      setSessionLoading(false);
    };

    void init();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!mounted) return;
      setSessionUserId(next?.user?.id ?? null);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  React.useEffect(() => {
    if (!sessionLoading && !sessionUserId && !isAuthPage) {
      router.replace("/login");
    }
  }, [sessionLoading, sessionUserId, isAuthPage, router]);

  const shouldShowShell = true;

  React.useEffect(() => {
    let mounted = true;
    const fetchProfile = async () => {
      if (!sessionUserId) {
        setProfileStatus(null);
        setProfileRole(null);
        setProfileName(null);
        setProfileInstrument(null);
        setProfileEmail(null);
        setProfileErrorMsg(null);
        logout();
        return;
      }

      setProfileLoading(true);
      setProfileErrorMsg(null);

      console.log("[AuthGate] 查询 profiles 前，session.user.id =", sessionUserId);

      const { data, error } = await supabase
        .from("profiles")
        .select("id, status, role, full_name, instrument, email")
        .eq("id", sessionUserId)
        .maybeSingle();

      console.log("[AuthGate] profiles 查询结果 data =", data, ", error =", error);

      if (!mounted) return;

      if (error) {
        console.warn("[AuthGate] 加载 profiles 失败：", error.message);
        setProfileLoading(false);
        setProfileErrorMsg(`查询失败：${error.message}`);
        setProfileStatus(null);
        return;
      }

      if (data == null) {
        setProfileLoading(false);
        setProfileErrorMsg(
          `未查到 profile 记录（id = ${sessionUserId}）。请确认 public.profiles 表中存在该用户。`,
        );
        setProfileStatus(null);
        return;
      }

      setProfileErrorMsg(null);
      setProfileStatus((data as any)?.status ?? null);
      setProfileRole((data as any)?.role ?? null);
      setProfileName((data as any)?.full_name ?? null);
      setProfileInstrument((data as any)?.instrument ?? null);
      setProfileEmail((data as any)?.email ?? null);

      // 将 profile 写回全局状态，兼容现有页面使用 useUser()
      login({
        id: sessionUserId,
        name: ((data as any)?.full_name as string) ?? "未命名用户",
        role: (((data as any)?.role as any) ?? "member") as any,
        section: ((data as any)?.instrument as string) ?? "",
        status: ((data as any)?.status as string) ?? undefined,
        email: ((data as any)?.email as string) ?? undefined,
      });

      setProfileLoading(false);
    };

    void fetchProfile();
    return () => {
      mounted = false;
    };
  }, [sessionUserId, login, logout]);

  const isPending = !!sessionUserId && profileStatus === "pending";
  const isApproved = !!sessionUserId && profileStatus === "approved";

  const handleLogout = () => {
    void supabase.auth.signOut();
    logout();
    router.replace("/login");
  };

  return (
    <div className="min-h-screen flex justify-center">
      <div className="flex min-h-screen w-full max-w-md flex-col bg-white shadow-lg">
        <main className={`flex-1 overflow-y-auto px-4 pt-4 ${isAuthPage ? "pb-4" : "pb-20"}`}>
          {sessionLoading ? (
            <div className="flex h-full items-center justify-center text-xs text-zinc-400">
              正在检查登录状态…
            </div>
          ) : !sessionUserId && !isAuthPage ? (
            <div className="flex h-full items-center justify-center text-xs text-zinc-400">
              正在前往登录页…
            </div>
          ) : sessionUserId && profileLoading && !isAuthPage ? (
            <div className="flex h-full items-center justify-center text-xs text-zinc-400">
              正在加载账户信息…
            </div>
          ) : sessionUserId && profileErrorMsg && !isAuthPage ? (
            <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
              <h1 className="text-lg font-semibold text-zinc-900">账户信息异常</h1>
              <p className="mt-3 max-w-sm text-left text-sm leading-relaxed text-red-600">
                {profileErrorMsg}
              </p>
              <p className="mt-2 text-xs text-zinc-500">
                请打开浏览器控制台查看 [AuthGate] 的详细日志（session.user.id、查询结果、error）。
              </p>
              <button
                type="button"
                onClick={handleLogout}
                className="mt-6 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800"
              >
                退出登录
              </button>
            </div>
          ) : sessionUserId && isPending && !isAuthPage ? (
            <div className="flex min-h-[70vh] flex-col items-center justify-center text-center">
              <div className="text-5xl">⏳</div>
              <h1 className="mt-4 text-lg font-semibold text-zinc-900">账号审核中...</h1>
              <p className="mt-2 max-w-xs text-sm text-zinc-500">请等待管理员审批后访问乐团系统</p>
              <button
                type="button"
                onClick={handleLogout}
                className="mt-6 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800"
              >
                退出登录
              </button>
            </div>
          ) : sessionUserId && !isApproved && !isAuthPage ? (
            <div className="flex min-h-[70vh] flex-col items-center justify-center text-center">
              <div className="text-5xl">⏳</div>
              <h1 className="mt-4 text-lg font-semibold text-zinc-900">账号审核中...</h1>
              <p className="mt-2 max-w-xs text-sm text-zinc-500">请等待管理员审批后访问乐团系统</p>
              <button
                type="button"
                onClick={handleLogout}
                className="mt-6 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800"
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
