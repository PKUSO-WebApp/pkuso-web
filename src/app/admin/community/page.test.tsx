/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import AdminCommunityPage from "./page";
import { usePosts } from "@/hooks/usePosts";

const mocks = vi.hoisted(() => ({
  posts: [] as Record<string, unknown>[],
  routerPush: vi.fn(),
}));

function setData(items: Record<string, unknown>[]) {
  mocks.posts.splice(0, mocks.posts.length, ...items);
}

vi.mock("@/hooks/usePosts", () => ({
  usePosts: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.routerPush,
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
  }),
}));

vi.mock("@/components/ui/Toggle", () => ({
  Toggle: vi.fn(() => <div data-testid="toggle" />),
}));

const mockUsePosts = vi.mocked(usePosts);

function makePost(overrides: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    title: "测试公告",
    type: "ensemble",
    content: "测试内容",
    image_url: null,
    author_id: "user-1",
    created_at: "2026-01-01T00:00:00+08:00",
    contact_info: "wx-id",
    current_sections: null,
    missing_sections: null,
    is_locked: false,
    profiles: { full_name: "张三", instrument: "小提琴" },
    ...overrides,
  };
}

function renderPage(initialData: unknown[] = []) {
  mockUsePosts.mockImplementation(() => ({
    data: initialData,
    loading: false,
    error: null,
    saving: false,
    fetch: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    uploadImage: vi.fn(),
  }));
  return render(<AdminCommunityPage />);
}

describe("AdminCommunityPage 社区管理（Issue #179：卡片→详情页路由）", () => {
  beforeEach(() => {
    mocks.routerPush.mockClear();
    setData([]);
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("列表查询排除「创建者自锁」帖（includeLocked + excludeUserLocked）", () => {
    renderPage();
    expect(mockUsePosts).toHaveBeenCalledWith({
      includeLocked: true,
      excludeUserLocked: true,
    });
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

  it("卡片无「编辑/删除/锁定」操作按钮，点击整卡跳转详情页路由", () => {
    renderPage([makePost()]);
    // 卡片无内联操作按钮（操作入口收敛到详情页）
    expect(screen.queryByText("编辑")).toBeNull();
    expect(screen.queryByText("删除")).toBeNull();
    expect(screen.queryByText("锁定")).toBeNull();
    // 点击卡片（标题冒泡）跳转详情页，列表页本身不渲染详情内容
    fireEvent.click(screen.getByText("测试公告"));
    expect(mocks.routerPush).toHaveBeenCalledWith("/admin/community/post-1");
    expect(screen.queryByText("联系方式")).toBeNull();
  });
});
