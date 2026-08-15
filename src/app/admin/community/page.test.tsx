/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";
import AdminCommunityPage from "./page";
import { usePosts } from "@/hooks/usePosts";

vi.mock("@/hooks/usePosts", () => ({
  usePosts: vi.fn(),
}));

vi.mock("@/components/ui/Toggle", () => ({
  Toggle: vi.fn(() => <div data-testid="toggle" />),
}));

const mockUsePosts = vi.mocked(usePosts);

function renderPage() {
  mockUsePosts.mockReturnValue({
    data: [],
    loading: false,
    error: null,
    saving: false,
    fetch: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    uploadImage: vi.fn(),
  });
  return render(<AdminCommunityPage />);
}

describe("AdminCommunityPage 社区管理", () => {
  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it("页面根容器为 flex 列布局且占满视口高度（Issue #146）", () => {
    const { container } = renderPage();
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("flex-col");
    expect(root.className).toContain("h-full");
  });

  it("帖子列表 section 可独立滚动（flex-1 + overflow-y-auto）", () => {
    const { container } = renderPage();
    const section = container.querySelector("section") as HTMLElement | null;
    expect(section).toBeTruthy();
    expect(section!.className).toContain("flex-1");
    expect(section!.className).toContain("overflow-y-auto");
  });
});
