/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import React from "react";
import CommunityPage from "./page";
import { useUser } from "@/context/user-context";
import { usePosts } from "@/hooks/usePosts";
import { Toggle } from "@/components/ui/Toggle";
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

function renderPage(
  posts: PostRowWithAuthor[] = [makePost()],
  overrides: Partial<ReturnType<typeof usePosts>> = {},
) {
  mockUsePosts.mockReturnValue({
    data: posts,
    loading: false,
    error: null,
    saving: false,
    fetch: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    // 默认删除成功（handleDelete 依赖返回 true 才关闭详情弹窗）
    remove: vi.fn().mockResolvedValue(true),
    uploadImage: vi.fn(),
    ...overrides,
  });
  return render(<CommunityPage />);
}

/** 打开详情弹窗并点击图片进入放大视图 */
function openZoomOverlay() {
  fireEvent.click(screen.getByText("重奏招募")); // 打开详情弹窗
  fireEvent.click(screen.getByAltText("二维码或配图")); // 点击图片放大
}

describe("CommunityPage 公告板", () => {
  let alertSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseUser.mockReturnValue({
      user: { id: "u1", name: "张三", role: "member", section: "小提琴" },
      login: vi.fn(),
      logout: vi.fn(),
    });
    // jsdom 的 alert 未实现，spy 并吞掉（后续用例可断言调用）
    alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    // jsdom 的 confirm 未实现，spy 默认确认（取消场景在用例内覆盖）
    vi.spyOn(window, "confirm").mockReturnValue(true);
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

  // ============================================================
  // 3. 列表滚动容器（Issue #146）：页面固定视口链路下，帖子列表需独立滚动
  // ============================================================
  describe("列表滚动容器（Issue #146）", () => {
    it("页面根容器为 flex 列布局且占满视口高度", () => {
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

  // ============================================================
  // 4. 卡片去按钮化（Issue #179）：操作入口收敛到详情弹窗
  // ============================================================
  describe("卡片去按钮化（Issue #179）", () => {
    it("列表卡片不渲染「编辑/删除」操作按钮", () => {
      renderPage();
      expect(screen.queryByText("编辑")).toBeNull();
      expect(screen.queryByText("删除")).toBeNull();
    });

    it("帖主打开详情弹窗可见「编辑/删除」操作行", () => {
      renderPage();
      fireEvent.click(screen.getByText("重奏招募")); // 打开详情弹窗
      expect(screen.getByText("编辑")).toBeTruthy();
      expect(screen.getByText("删除")).toBeTruthy();
      // 操作行右下角（justify-end，Issue #182）
      expect(screen.getByText("编辑").parentElement!.className).toContain("justify-end");
    });

    it("非帖主（其他成员）打开详情弹窗看不到操作行", () => {
      mockUseUser.mockReturnValue({
        user: { id: "u2", name: "李四", role: "member", section: "长笛" },
        login: vi.fn(),
        logout: vi.fn(),
      });
      renderPage();
      fireEvent.click(screen.getByText("重奏招募")); // 打开详情弹窗
      expect(screen.queryByText("编辑")).toBeNull();
      expect(screen.queryByText("删除")).toBeNull();
      // 弹窗本身仍正常展示帖子信息
      expect(screen.getByText("重奏 · 创建者：张三")).toBeTruthy();
    });

    it("点「编辑」：详情弹窗关闭并打开发布弹窗（编辑模式预填标题/内容/类型）", () => {
      renderPage();
      fireEvent.click(screen.getByText("重奏招募")); // 打开详情弹窗
      fireEvent.click(screen.getByText("编辑"));
      // 详情弹窗关闭
      expect(screen.queryByText("重奏 · 创建者：张三")).toBeNull();
      // 发布弹窗以编辑模式打开并预填
      expect(screen.getByText("编辑公告")).toBeTruthy();
      expect((screen.getByPlaceholderText("请输入标题") as HTMLInputElement).value).toBe(
        "重奏招募",
      );
      expect((screen.getByPlaceholderText("请输入内容") as HTMLTextAreaElement).value).toBe(
        "招募长笛",
      );
      // 类型预填为原帖子类型（Toggle 被 mock，从最后一次调用的 props 断言）
      const calls = vi.mocked(Toggle).mock.calls;
      expect(calls[calls.length - 1][0].value).toBe("ensemble");
    });

    it("点「删除」：confirm 后调用 remove 并关闭详情弹窗", async () => {
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
      const removeMock = vi.fn().mockResolvedValue(true);
      renderPage([makePost()], { remove: removeMock });
      fireEvent.click(screen.getByText("重奏招募")); // 打开详情弹窗
      fireEvent.click(screen.getByText("删除"));
      expect(confirmSpy).toHaveBeenCalledWith("确定要删除这条公告吗？");
      await waitFor(() => {
        expect(removeMock).toHaveBeenCalledWith("p1");
      });
      // 删除成功后详情弹窗关闭，操作行随之消失
      await waitFor(() => {
        expect(screen.queryByText("重奏 · 创建者：张三")).toBeNull();
      });
      expect(screen.queryByText("删除")).toBeNull();
    });

    it("删除 confirm 取消时不调用 remove，弹窗保持打开", () => {
      vi.spyOn(window, "confirm").mockReturnValue(false);
      const removeMock = vi.fn();
      renderPage([makePost()], { remove: removeMock });
      fireEvent.click(screen.getByText("重奏招募")); // 打开详情弹窗
      fireEvent.click(screen.getByText("删除"));
      expect(removeMock).not.toHaveBeenCalled();
      expect(screen.getByText("重奏 · 创建者：张三")).toBeTruthy();
    });

    it("删除进行中：按钮显示「删除中…」且「编辑」禁用（防操作已删帖子）", async () => {
      let resolveRemove!: (ok: boolean) => void;
      const removeMock = vi.fn<(id: string) => Promise<boolean>>().mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            resolveRemove = resolve;
          }),
      );
      renderPage([makePost()], { remove: removeMock });
      fireEvent.click(screen.getByText("重奏招募")); // 打开详情弹窗
      fireEvent.click(screen.getByText("删除"));
      // 删除 pending 期间：删除按钮显示「删除中…」并禁用，「编辑」同步禁用
      expect((screen.getByText("删除中…") as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByText("编辑") as HTMLButtonElement).disabled).toBe(true);
      // 完成后删除成功，详情弹窗关闭
      await act(async () => {
        resolveRemove(true);
      });
      await waitFor(() => {
        expect(screen.queryByText("重奏 · 创建者：张三")).toBeNull();
      });
    });

    it("删除进行中：弹窗关闭被拦截（遮罩按钮不渲染、关闭按钮守卫），完成后可关", async () => {
      let resolveRemove!: (ok: boolean) => void;
      const removeMock = vi.fn<(id: string) => Promise<boolean>>().mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            resolveRemove = resolve;
          }),
      );
      renderPage([makePost()], { remove: removeMock });
      fireEvent.click(screen.getByText("重奏招募")); // 打开详情弹窗
      fireEvent.click(screen.getByText("删除"));
      // busy：遮罩关闭按钮不再渲染，标题栏「关闭」点击被守卫拦截
      expect(screen.queryByLabelText("关闭弹窗")).toBeNull();
      fireEvent.click(screen.getByText("关闭"));
      expect(screen.getByText("重奏 · 创建者：张三")).toBeTruthy(); // 弹窗保持打开
      // 完成后删除成功，详情弹窗关闭
      await act(async () => {
        resolveRemove(true);
      });
      await waitFor(() => {
        expect(screen.queryByText("重奏 · 创建者：张三")).toBeNull();
      });
    });

    it("删除失败：alert 提示、详情弹窗保持、按钮恢复可重试", async () => {
      const removeMock = vi.fn<(id: string) => Promise<boolean>>().mockResolvedValue(false);
      renderPage([makePost()], { remove: removeMock });
      fireEvent.click(screen.getByText("重奏招募")); // 打开详情弹窗
      fireEvent.click(screen.getByText("删除"));
      await waitFor(() => {
        expect(removeMock).toHaveBeenCalledWith("p1");
      });
      expect(alertSpy).toHaveBeenCalledWith("删除失败");
      // 弹窗保持打开，busy 解除后按钮恢复可点击
      expect(screen.getByText("重奏 · 创建者：张三")).toBeTruthy();
      expect((screen.getByText("删除") as HTMLButtonElement).disabled).toBe(false);
    });

    it("编辑保存失败（帖子已被删除，update 0 行返回 false）：alert 提示且不报假成功", async () => {
      const updateMock = vi.fn().mockResolvedValue(false);
      renderPage([makePost()], { update: updateMock });
      fireEvent.click(screen.getByText("重奏招募")); // 打开详情弹窗
      fireEvent.click(screen.getByText("编辑")); // 进入编辑模式
      fireEvent.click(screen.getByText("保存")); // 提交保存
      await waitFor(() => {
        expect(updateMock).toHaveBeenCalledWith(
          "p1",
          expect.objectContaining({ title: "重奏招募" }),
        );
      });
      // 0 行更新返回 false → 提示更新失败，不假成功
      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith("更新失败");
      });
      // 编辑弹窗保持打开，可修改后重试
      expect(screen.getByText("编辑公告")).toBeTruthy();
    });
  });
});
