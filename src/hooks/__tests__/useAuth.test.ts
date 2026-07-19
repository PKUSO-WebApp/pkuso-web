// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import React from "react";

const { mockGetSession, mockOnAuthStateChange, mockSignOut, mockMaybeSingle } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockOnAuthStateChange: vi.fn(),
  mockSignOut: vi.fn(),
  mockMaybeSingle: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
      onAuthStateChange: mockOnAuthStateChange,
      signOut: mockSignOut,
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: mockMaybeSingle })),
      })),
    })),
  },
}));

// Mock UserContext
const MockUserContext = React.createContext({
  user: null as unknown,
  login: vi.fn(),
  logout: vi.fn(),
});
vi.mock("@/context/UserContext", () => ({
  useUser: () => React.useContext(MockUserContext),
  UserRole: {} as never, // type-only, placeholder
}));

import { useAuth } from "../useAuth";

function Wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(
    MockUserContext.Provider,
    { value: { user: null, login: vi.fn(), logout: vi.fn() } },
    children,
  );
}

describe("useAuth", () => {
  const onProfileLoaded = vi.fn();
  const onClearProfile = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    onProfileLoaded.mockReset();
    onClearProfile.mockReset();
  });

  it("初始加载时 sessionLoading 为 true,完成后为 false", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    });

    const { result } = renderHook(() => useAuth({ onProfileLoaded, onClearProfile }), {
      wrapper: Wrapper,
    });

    expect(result.current.sessionLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.sessionLoading).toBe(false);
    });
    expect(result.current.sessionUserId).toBe("user-1");
  });

  it("无 session 时清除 profile", async () => {
    const { result } = renderHook(() => useAuth({ onProfileLoaded, onClearProfile }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.sessionLoading).toBe(false);
    });

    expect(result.current.sessionUserId).toBeNull();
    expect(onClearProfile).toHaveBeenCalled();
  });

  it("有 session 时加载 profile 数据", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    });
    mockMaybeSingle.mockResolvedValue({
      data: {
        id: "user-1",
        full_name: "张三",
        instrument: "长笛",
        status: "approved",
        role: "member",
        email: "test@example.com",
      },
      error: null,
    });

    const { result, rerender } = renderHook(() => useAuth({ onProfileLoaded, onClearProfile }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.sessionLoading).toBe(false);
    });
    // 第二个 effect 在 sessionUserId 更新后触发
    await waitFor(
      () => {
        expect(result.current.profileLoading).toBe(false);
      },
      { timeout: 3000 },
    );

    expect(result.current.profileName).toBe("张三");
    expect(result.current.profileRole).toBe("member");
    expect(result.current.profileStatus).toBe("approved");
    expect(result.current.profileInstrument).toBe("长笛");
    expect(onProfileLoaded).toHaveBeenCalledWith({
      id: "user-1",
      name: "张三",
      role: "member",
      section: "长笛",
      status: "approved",
      email: "test@example.com",
    });
  });

  it("profile 查询失败时设置错误信息", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    });
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: "数据库连接失败" },
    });

    const { result } = renderHook(() => useAuth({ onProfileLoaded, onClearProfile }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.profileLoading).toBe(false);
    });

    expect(result.current.profileErrorMsg).toContain("查询失败");
  });

  it("profile 为空时设置提示信息", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    });
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useAuth({ onProfileLoaded, onClearProfile }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.profileLoading).toBe(false);
    });

    expect(result.current.profileErrorMsg).toContain("未查到");
  });

  it("handleSignOut 调用 supabase.auth.signOut 并清除 profile", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    });
    mockSignOut.mockResolvedValue({ error: null });

    const { result } = renderHook(() => useAuth({ onProfileLoaded, onClearProfile }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.sessionLoading).toBe(false);
    });

    await act(async () => {
      await result.current.handleSignOut();
    });

    expect(mockSignOut).toHaveBeenCalled();
    expect(onClearProfile).toHaveBeenCalled();
  });
});
