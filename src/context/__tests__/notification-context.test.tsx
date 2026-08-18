// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";
import { NotificationProvider, useNotificationsContext } from "../notification-context";

// ---- Mock next/navigation（pathname 可在用例中动态配置）----
const { mockUsePathname, mockRefresh } = vi.hoisted(() => ({
  mockUsePathname: vi.fn(() => "/"),
  mockRefresh: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

// ---- Mock useNotifications：refresh 是稳定引用（同 vi.fn），供断言挂载/pathname 刷新 ----
vi.mock("@/hooks/useNotifications", () => ({
  useNotifications: () => ({
    unreadCounts: { attendance: 0, activity: 0, system: 0 },
    totalUnread: 0,
    loading: false,
    refresh: mockRefresh,
    markCategoryRead: vi.fn(),
  }),
}));

function Consumer() {
  const ctx = useNotificationsContext();
  return <span data-testid="total">{ctx.totalUnread}</span>;
}

describe("NotificationProvider（Issue #188）", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePathname.mockReturnValue("/");
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy?.mockRestore();
    cleanup();
  });

  it("挂载时拉取一次未读数", () => {
    render(
      <NotificationProvider>
        <Consumer />
      </NotificationProvider>,
    );
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("pathname 变化时刷新，未变化不重复刷新", () => {
    const { rerender } = render(
      <NotificationProvider>
        <Consumer />
      </NotificationProvider>,
    );
    expect(mockRefresh).toHaveBeenCalledTimes(1);

    // 切到 /profile：依赖 pathname 变化，触发第二次刷新
    mockUsePathname.mockReturnValue("/profile");
    rerender(
      <NotificationProvider>
        <Consumer />
      </NotificationProvider>,
    );
    expect(mockRefresh).toHaveBeenCalledTimes(2);

    // 路径不变重渲染：不重复刷新
    rerender(
      <NotificationProvider>
        <Consumer />
      </NotificationProvider>,
    );
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });

  it("无 Provider 时 useNotificationsContext 抛错（错误边界提示）", () => {
    expect(() => render(<Consumer />)).toThrow(/NotificationProvider/);
  });
});
