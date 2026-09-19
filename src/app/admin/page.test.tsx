// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import AdminHomePage from "./page";
import { supabase } from "@/lib/supabase";
import { useSearchParams } from "next/navigation";
import { renderWithProviders } from "@/__tests__/render-with-providers";

// ---- Mock supabase ----
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ count: 0, error: null })),
      })),
    })),
  },
}));

// ---- Mock next/navigation ----
const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockBack = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
    prefetch: vi.fn(),
  })),
  useSearchParams: vi.fn(),
}));

const mockSupabaseFrom = supabase.from as Mock;

describe("AdminHomePage", () => {
  let mockSearchParams: { get: Mock };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = { get: vi.fn() };
    (useSearchParams as unknown as Mock).mockReturnValue(mockSearchParams);

    // Default: no pending counts
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ count: 0, error: null })),
      })),
    });
  });

  it("渲染 13 个功能卡片网格", () => {
    renderWithProviders(<AdminHomePage />);

    // Check all 13 cards are present
    const cards = [
      "入团审批",
      "请假审批",
      "公告管理",
      "排练管理",
      "排练房预约",
      "考勤管理",
      "成员花名册",
      "社区管理",
      "邀请码管理",
      "系统通知",
      "反馈查看",
      "邮件签名",
      "数据导入",
    ];

    cards.forEach((title) => {
      expect(screen.getByRole("link", { name: title })).toBeInTheDocument();
    });
  });

  it("入团审批徽章显示待审批数", async () => {
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ count: 5, error: null })),
      })),
    });

    renderWithProviders(<AdminHomePage />);

    await waitFor(() => {
      const approvalCard = screen.getByRole("link", { name: /入团审批/ });
      expect(approvalCard).toHaveTextContent("5");
    });
  });

  it("请假审批徽章显示待审批数", async () => {
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ count: 3, error: null })),
      })),
    });

    renderWithProviders(<AdminHomePage />);

    await waitFor(() => {
      const leaveCard = screen.getByRole("link", { name: /请假审批/ });
      expect(leaveCard).toHaveTextContent("3");
    });
  });

  it("点击卡片导航到对应路由", async () => {
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ count: 0, error: null })),
      })),
    });

    renderWithProviders(<AdminHomePage />);

    await waitFor(() => {
      const approvalCard = screen.getByRole("link", { name: /入团审批/ });
      expect(approvalCard).toHaveAttribute("href", "/admin/approval");
    });
  });

  it("旧深链 /admin?tab=leave 重定向到 /admin/leave", () => {
    const mockSearchParamsWithTab = { get: vi.fn().mockReturnValue("leave") };
    (useSearchParams as unknown as Mock).mockReturnValue(mockSearchParamsWithTab);

    renderWithProviders(<AdminHomePage />);

    expect(mockReplace).toHaveBeenCalledWith("/admin/leave");
  });

  it("旧深链 /admin?tab=approval 重定向到 /admin/approval", () => {
    const mockSearchParamsWithTab = { get: vi.fn().mockReturnValue("approval") };
    (useSearchParams as unknown as Mock).mockReturnValue(mockSearchParamsWithTab);

    renderWithProviders(<AdminHomePage />);

    expect(mockReplace).toHaveBeenCalledWith("/admin/approval");
  });

  it("旧深链 /admin?tab=rehearsals 重定向到 /admin/rehearsals", () => {
    const mockSearchParamsWithTab = { get: vi.fn().mockReturnValue("rehearsals") };
    (useSearchParams as unknown as Mock).mockReturnValue(mockSearchParamsWithTab);

    renderWithProviders(<AdminHomePage />);

    expect(mockReplace).toHaveBeenCalledWith("/admin/rehearsals");
  });

  it("无 tab 参数时不重定向", () => {
    const mockSearchParamsNoTab = { get: vi.fn().mockReturnValue(null) };
    (useSearchParams as unknown as Mock).mockReturnValue(mockSearchParamsNoTab);

    renderWithProviders(<AdminHomePage />);

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("卡片网格为 2 列布局", () => {
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ count: 0, error: null })),
      })),
    });

    const { container } = renderWithProviders(<AdminHomePage />);
    const grid = container.querySelector(".grid-cols-2");
    expect(grid).not.toBeNull();
  });
});
