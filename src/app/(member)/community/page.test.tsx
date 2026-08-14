/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import React from "react";
import CommunityPage from "./page";
import { useUser } from "@/context/user-context";
import { usePosts } from "@/hooks/usePosts";
import type { PostRowWithAuthor } from "@/types/database";

vi.mock("@/context/user-context", () => ({
  useUser: vi.fn(),
}));

vi.mock("@/hooks/usePosts", () => ({
  usePosts: vi.fn(),
}));

vi.mock("@/components/ui/Toggle", () => ({
  Toggle: vi.fn(() => <div data-testid="toggle" />),
}));

vi.mock("@/components/ui/Card", () => ({
  Card: vi.fn(({ children }: { children: React.ReactNode }) => <div>{children}</div>),
}));

// 提交时才用到，避免 jsdom 中加载浏览器模块副作用
vi.mock("browser-image-compression", () => ({
  default: vi.fn(),
}));

const mockUseUser = vi.mocked(useUser);
const mockUsePosts = vi.mocked(usePosts);

const IMG_URL = "https://example.com/image.png";

function makePost(overrides: Partial<PostRowWithAuthor> = {}): PostRowWithAuthor {
  return {
    id: "p1",
    title: "重奏招募",
    content: "招募长笛",
    type: "ensemble",
    contact_info: "wx123",
    current_sections: null,
    missing_sections: "长笛",
    image_url: IMG_URL,
    author_id: "u1",
    created_at: "2026-08-01T10:00:00",
    is_locked: false,
    profiles: { full_name: "张三", instrument: "小提琴" },
    ...overrides,
  };
}

function renderPage(posts: PostRowWithAuthor[] = [makePost()]) {
  mockUsePosts.mockReturnValue({
    data: posts,
    loading: false,
    error: null,
    saving: false,
    fetch: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    uploadImage: vi.fn(),
  });
  return render(<CommunityPage />);
}

/** 打开详情弹窗并点击图片进入放大视图 */
function openZoomOverlay() {
  fireEvent.click(screen.getByText("重奏招募")); // 打开详情弹窗
  fireEvent.click(screen.getByAltText("二维码或配图")); // 点击图片放大
}

describe("CommunityPage 公告板", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseUser.mockReturnValue({
      user: { id: "u1", name: "张三", role: "member", section: "小提琴" },
      login: vi.fn(),
      logout: vi.fn(),
    });
    // jsdom 的 alert 未实现，spy 并吞掉
    vi.spyOn(window, "alert").mockImplementation(() => {});
    // jsdom 未实现 createObjectURL/revokeObjectURL，手动补齐
    URL.createObjectURL = vi.fn(() => "blob:mock-url");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    cleanup();
  });

  // ============================================================
  // 1. 放大视图 blob 化（Issue #133 核心修复）
  // ============================================================
  describe("放大视图 blob 化", () => {
    it("fetch 成功时 overlay 图片 src 为 blob: 开头", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(["fake-image"], { type: "image/png" })),
      });
      vi.stubGlobal("fetch", fetchMock);
      renderPage();

      openZoomOverlay();

      await waitFor(() => {
        expect(screen.getByAltText("图片放大查看").getAttribute("src")).toMatch(/^blob:/);
      });
      expect(fetchMock).toHaveBeenCalledWith(IMG_URL);
    });

    it("fetch 失败（网络/CORS）时回退原 URL", async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error("网络错误"));
      vi.stubGlobal("fetch", fetchMock);
      renderPage();

      openZoomOverlay();

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(IMG_URL);
      });
      // 等待 catch 回退分支执行完
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(screen.getByAltText("图片放大查看").getAttribute("src")).toBe(IMG_URL);
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    });

    it("关闭 overlay 时 revokeObjectURL 被调用（回收 blob）", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          blob: () => Promise.resolve(new Blob()),
        }),
      );
      renderPage();

      openZoomOverlay();

      await waitFor(() => {
        expect(screen.getByAltText("图片放大查看").getAttribute("src")).toMatch(/^blob:/);
      });
      expect(URL.revokeObjectURL).not.toHaveBeenCalled(); // 打开期间不回收

      fireEvent.click(screen.getByTestId("zoom-overlay")); // 点击遮罩关闭

      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
      expect(screen.queryByTestId("zoom-overlay")).toBeNull();
    });

    it("关闭后迟到的 fetch 响应被丢弃，不生成 blob（竞态守卫）", async () => {
      let resolveFetch!: (value: { ok: boolean; blob: () => Promise<Blob> }) => void;
      const fetchMock = vi.fn().mockReturnValue(
        new Promise<{ ok: boolean; blob: () => Promise<Blob> }>((resolve) => {
          resolveFetch = resolve;
        }),
      );
      vi.stubGlobal("fetch", fetchMock);
      renderPage();

      openZoomOverlay(); // fetch 挂起中
      fireEvent.click(screen.getByTestId("zoom-overlay")); // 立即关闭

      await act(async () => {
        resolveFetch({ ok: true, blob: () => Promise.resolve(new Blob()) });
        // 等待 fetch 链全部微任务执行完
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // 竞态守卫生效：卸载后的响应不创建、不设置 blob
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    });

    it("overlay 底部显示长按保存提示文案", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          blob: () => Promise.resolve(new Blob()),
        }),
      );
      renderPage();

      openZoomOverlay();

      expect(screen.getByText("长按图片即可保存到相册")).toBeTruthy();
    });
  });

  // ============================================================
  // 2. 「保存图片」按钮暂时隐藏
  // ============================================================
  describe("保存图片按钮", () => {
    it("详情弹窗不渲染「保存图片」按钮，图片本身仍展示可点击放大", () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          blob: () => Promise.resolve(new Blob()),
        }),
      );
      renderPage();

      fireEvent.click(screen.getByText("重奏招募")); // 打开详情弹窗

      expect(screen.getByAltText("二维码或配图")).toBeTruthy(); // 图片仍在
      expect(screen.queryByText("保存图片")).toBeNull(); // 按钮被隐藏
    });
  });
});
