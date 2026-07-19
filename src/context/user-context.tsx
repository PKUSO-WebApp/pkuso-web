"use client";

import React from "react";

export type UserRole = "admin" | "member";

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
  logout: () => void;
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

  const value = React.useMemo(
    () => ({
      user,
      login,
      logout,
    }),
    [user, login, logout],
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
