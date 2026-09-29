"use client";

import React from "react";
import { supabase } from "@/lib/supabase";

/** 与数据库枚举 `profileRole` 对齐；谁能进 web 端、能进哪些路径见 `@/lib/access` */
export type UserRole = "admin" | "member" | "score_manager";

export type User = {
  id: string;
  name: string;
  role: UserRole;
  section: string;
  grade?: string;
  department?: string;
  status?: string;
  email?: string;
};

type UserContextValue = {
  user: User | null;
  login: (user: User) => void;
  /**
   * **只清内存里的用户态 —— 它不结束 Supabase 会话。**
   *
   * ⚠️ 别把它接到「退出登录」上，也别给它加 signOut：`useAuth` 在
   * **本来就没有 session** 时也调它（`onClearProfile`，走那个 effect 里
   * `if (!sessionUserId)` 分支），在那里发一次登出是多余的。
   * 要真登出用 `signOut()`。
   */
  logout: () => void;
  /**
   * **真正的退出登录**：结束 Supabase 会话，再清用户态。
   *
   * admin 端那两个页内入口（`admin/profile` 与谱务列表页）走它。在此之前它们调的是
   * `logout()` ⇒ 只清 React state，会话仍在浏览器里，按后退就能免密回来
   * （守卫只看 `sessionUserId`，不看这里的 `user`）。
   *
   * ⚠️ 仓库里另有一条**互不相干**的登出机制：`useAuth` 的 `handleSignOut`，
   * 由 `auth-gate` 的守护页按钮调用。两条各自 `await client.auth.signOut()`，
   * **没有共用函数** —— 改这一处不影响那一处，反之亦然。
   */
  signOut: () => Promise<void>;
};

const UserContext = React.createContext<UserContextValue | undefined>(undefined);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null);

  const login = React.useCallback((nextUser: User) => {
    setUser(nextUser);
  }, []);

  const logout = React.useCallback(() => {
    setUser(null);
  }, []);

  const signOut = React.useCallback(async () => {
    // ⚠️ **失败要看返回值，不能只写 try/catch。**
    //
    // 现装版本（`@supabase/auth-js` 2.117.2）对**鉴权失败**（含 HTTP/网络错误）是
    // `return { error }` 而**不是** throw：`GoTrueAdminApi.signOut` 的 catch 把
    // AuthError 转成返回值，而 `GoTrueClient._returnResult` 只在 `throwOnError` 为真时
    // 才抛——本项目 `createClient` 没开那个开关（实测核过 dist，不是推断）。
    // 所以只包 try/catch 的话，真实的失败路径上一行日志都不会有。
    //
    // catch 仍然留着：**非** AuthError 会抛。注意「网络中断」**不属于**这一类 ——
    // 它是 `AuthRetryableFetchError`（`CustomAuthError → AuthError`），走的仍是
    // 「返回 { error }」那条路。真正抛的是 storage / `_removeSession` 之类的意外。
    try {
      const { error } = await supabase.auth.signOut();
      if (error) console.error("[user-context] signOut 返回错误", error);
    } catch (error) {
      console.error("[user-context] signOut 抛出异常", error);
    } finally {
      // 无论成败都清内存态：否则界面停在「已登录」，而调用方已经把人送到 /login 了。
      //
      // 注：失败时**本地**会话通常已被清掉 —— `_signOut` 在返回 error 之前就会
      // `await removeCurrentSession()`。真正没吊销的是**服务端** refresh token，
      // 而那一层现在的返回值被我们丢掉了，代码与 UI 都无从知道（缺口记在 PR 里）。
      setUser(null);
    }
  }, []);

  const value = React.useMemo(
    () => ({
      user,
      login,
      logout,
      signOut,
    }),
    [user, login, logout, signOut],
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser() {
  const ctx = React.useContext(UserContext);
  if (!ctx) {
    throw new Error("useUser 必须在 UserProvider 内部使用");
  }
  return ctx;
}
