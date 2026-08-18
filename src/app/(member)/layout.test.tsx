/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";
import MemberLayout from "./layout";

// ---- Mock next/link（jsdom 下避免 Next 路由上下文缺失）----
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// ---- Mock next/navigation（pathname 可在用例中动态配置）----
const { mockUsePathname, mockUseNotificationsContext } = vi.hoisted(() => ({
  mockUsePathname: vi.fn(() => "/profile"),
  mockUseNotificationsContext: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

// ---- Mock 通知上下文：Provider 透传，未读总数由用例配置 ----
vi.mock("@/context/notification-context", () => ({
  NotificationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useNotificationsContext: () => mockUseNotificationsContext(),
}));

describe("MemberLayout tab 未读红气泡（Issue #188）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePathname.mockReturnValue("/profile");
    mockUseNotificationsContext.mockReturnValue({ totalUnread: 0 });
  });

  afterEach(() => {
    cleanup();
  });

  it("渲染页面内容与五个 tab", () => {
    render(
      <MemberLayout>
        <div>页面内容</div>
      </MemberLayout>,
    );
    expect(screen.getByText("页面内容")).toBeInTheDocument();
    for (const label of ["首页", "社区", "日程", "成员", "我的"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("无未读时不显示红气泡", () => {
    render(
      <MemberLayout>
        <div>页面内容</div>
      </MemberLayout>,
    );
    // 页面中不应出现任何红色徽章（bg-danger）
    expect(document.querySelector(".bg-danger")).toBeNull();
  });

  it("有未读时「我的」tab 图标右上角显示红色气泡与总数", () => {
    mockUseNotificationsContext.mockReturnValue({ totalUnread: 5 });
    render(
      <MemberLayout>
        <div>页面内容</div>
      </MemberLayout>,
    );
    const bubble = screen.getByText("5");
    expect(bubble.className).toContain("bg-danger");
    expect(bubble.className).toContain("text-danger-foreground");
    // 气泡绝对定位于图标右上角
    expect(bubble.className).toContain("absolute");
  });

  it("未读总数超过 99 时气泡显示 99+", () => {
    mockUseNotificationsContext.mockReturnValue({ totalUnread: 120 });
    render(
      <MemberLayout>
        <div>页面内容</div>
      </MemberLayout>,
    );
    expect(screen.getByText("99+")).toBeTruthy();
  });

  it("气泡只出现在「我的」tab，其他 tab 无红气泡", () => {
    mockUseNotificationsContext.mockReturnValue({ totalUnread: 2 });
    render(
      <MemberLayout>
        <div>页面内容</div>
      </MemberLayout>,
    );
    // 全页仅一个红色徽章
    expect(document.querySelectorAll(".bg-danger")).toHaveLength(1);
    // 气泡位于「我的」链接内部（向上找 a 标签）
    const bubble = screen.getByText("2");
    const link = bubble.closest("a");
    expect(link).toBeTruthy();
    expect(link!.getAttribute("href")).toBe("/profile");
  });
});
