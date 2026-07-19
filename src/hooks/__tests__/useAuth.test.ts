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
});
