// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import React from "react";
import { useAuth } from "../useAuth";

// 复用 useProfiles 的 mockClient 模式 + auth mock
function mockSupabaseClient(session: unknown, profile: unknown) {
  const c = (r: unknown) => ({
    eq: () => ({ maybeSingle: () => c(r) }),
    order: () => c(r),
    limit: () => c(r),
    then: (resolve: (v: unknown) => void) => resolve(r),
  });
  return {
    from: () => ({ select: () => c(profile) }),
    auth: {
      getSession: () => Promise.resolve(session),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signOut: () => Promise.resolve({ error: null }),
    },
  };
}

// Mock UserContext
const MockCtx = React.createContext({ user: null as unknown, login: vi.fn(), logout: vi.fn() });
vi.mock("@/context/UserContext", () => ({
  useUser: () => React.useContext(MockCtx),
  UserRole: {},
}));
function Wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(
    MockCtx.Provider,
    { value: { user: null, login: vi.fn(), logout: vi.fn() } },
    children,
  );
}

describe("useAuth", () => {
  const onLoaded = vi.fn();
  const onClear = vi.fn();

  it("有 session + profile", async () => {
    const c = mockSupabaseClient(
      { data: { session: { user: { id: "u1" } } }, error: null },
      {
        data: {
          id: "u1",
          full_name: "张三",
          role: "member",
          status: "approved",
          instrument: "长笛",
          email: "a@b.com",
        },
        error: null,
      },
    );
    const { result } = renderHook(
      () => useAuth({ onProfileLoaded: onLoaded, onClearProfile: onClear }, c as never),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.sessionLoading).toBe(false), { timeout: 3000 });
    await waitFor(() => expect(result.current.profileLoading).toBe(false), { timeout: 3000 });
    expect(result.current.profileName).toBe("张三");
  });

  it("无 session", async () => {
    const c = mockSupabaseClient(
      { data: { session: null }, error: null },
      { data: null, error: null },
    );
    const { result } = renderHook(
      () => useAuth({ onProfileLoaded: onLoaded, onClearProfile: onClear }, c as never),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.sessionLoading).toBe(false));
    expect(onClear).toHaveBeenCalled();
  });

  it("signOut", async () => {
    const c = mockSupabaseClient(
      { data: { session: { user: { id: "u1" } } }, error: null },
      { data: null, error: null },
    );
    const { result } = renderHook(
      () => useAuth({ onProfileLoaded: onLoaded, onClearProfile: onClear }, c as never),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.sessionLoading).toBe(false));
    await act(async () => {
      await result.current.handleSignOut();
    });
    expect(onClear).toHaveBeenCalled();
  });

  // emailConfirmed 相关测试
  it("有 session 且邮箱已验证", async () => {
    const c = mockSupabaseClient(
      {
        data: { session: { user: { id: "u1", email_confirmed_at: "2024-01-01T00:00:00Z" } } },
        error: null,
      },
      {
        data: {
          id: "u1",
          full_name: "张三",
          role: "member",
          status: "approved",
          instrument: "长笛",
          email: "a@b.com",
        },
        error: null,
      },
    );
    const { result } = renderHook(
      () => useAuth({ onProfileLoaded: onLoaded, onClearProfile: onClear }, c as never),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.sessionLoading).toBe(false), { timeout: 3000 });
    expect(result.current.emailConfirmed).toBe(true);
  });

  it("有 session 但邮箱未验证", async () => {
    const c = mockSupabaseClient(
      { data: { session: { user: { id: "u1", email_confirmed_at: null } } }, error: null },
      {
        data: {
          id: "u1",
          full_name: "张三",
          role: "member",
          status: "approved",
          instrument: "长笛",
          email: "a@b.com",
        },
        error: null,
      },
    );
    const { result } = renderHook(
      () => useAuth({ onProfileLoaded: onLoaded, onClearProfile: onClear }, c as never),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.sessionLoading).toBe(false), { timeout: 3000 });
    expect(result.current.emailConfirmed).toBe(false);
  });

  it("无 session 时 emailConfirmed 保持 null", async () => {
    const c = mockSupabaseClient(
      { data: { session: null }, error: null },
      { data: null, error: null },
    );
    const { result } = renderHook(
      () => useAuth({ onProfileLoaded: onLoaded, onClearProfile: onClear }, c as never),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.sessionLoading).toBe(false), { timeout: 3000 });
    expect(result.current.emailConfirmed).toBe(null);
  });

  it("初始加载时 emailConfirmed 为 null", async () => {
    const c = mockSupabaseClient(
      {
        data: { session: { user: { id: "u1", email_confirmed_at: "2024-01-01T00:00:00Z" } } },
        error: null,
      },
      {
        data: {
          id: "u1",
          full_name: "张三",
          role: "member",
          status: "approved",
          instrument: "长笛",
          email: "a@b.com",
        },
        error: null,
      },
    );
    const { result } = renderHook(
      () => useAuth({ onProfileLoaded: onLoaded, onClearProfile: onClear }, c as never),
      { wrapper: Wrapper },
    );
    // 加载过程中 emailConfirmed 应为 null
    expect(result.current.emailConfirmed).toBe(null);
    expect(result.current.sessionLoading).toBe(true);
    // 加载完成后变为 true
    await waitFor(() => expect(result.current.sessionLoading).toBe(false), { timeout: 3000 });
    expect(result.current.emailConfirmed).toBe(true);
  });
});
