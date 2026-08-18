/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import React from "react";
import AdminCommunityPage from "./page";
import { usePosts } from "@/hooks/usePosts";
import { formatDateTimeInChina } from "@/lib/date-utils";

// 通知插入 mock + 当前管理员 id（hoisted，供 insertPostNotification 与自删判定使用）
const { mockInsert, mockUseUser, setAdminId } = vi.hoisted(() => {
  const mockInsert = vi.fn().mockResolvedValue({ error: null });
  let adminId = "admin-1";
  return {
    mockInsert,
    mockUseUser: () => ({ user: { id: adminId }, login: vi.fn(), logout: vi.fn() }),
    setAdminId: (id: string) => {
      adminId = id;
    },
  };
});

vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ insert: mockInsert }) },
}));

vi.mock("@/context/user-context", () => ({
  useUser: mockUseUser,
}));

vi.mock("@/hooks/usePosts", () => ({
  usePosts: vi.fn(),
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

type UpdateFn = (id: string, payload: Record<string, unknown>) => Promise<boolean>;
type RemoveFn = (id: string) => Promise<boolean>;

type PostsApi = {
  update: Mock<UpdateFn>;
  remove: Mock<RemoveFn>;
};

/**
 * 渲染页面。用 mockImplementation 每次渲染返回闭包持有的最新列表，
 * 模拟真实 usePosts 的乐观更新：update/remove 成功后 data 引用变化，
 * 驱动页面 useMemo 重算、派生详情弹窗自动刷新/关闭（与真实 hook 行为一致）。
 * 传入 hooks.update/remove 可覆盖（如挂起模拟 busy 态）。
 */
function renderPage(
  initialData: unknown[] = [],
  hooks: Partial<PostsApi> = {},
): PostsApi & { container: HTMLElement } {
  let data: unknown[] = initialData;
  const update =
    hooks.update ??
    vi.fn<UpdateFn>().mockImplementation(async (id, payload) => {
      // 乐观更新：原地合并修改内容（同 usePosts.update）
      data = data.map((p) =>
        (p as { id?: string })?.id === id ? { ...(p as Record<string, unknown>), ...payload } : p,
      );
      return true;
    });
  const remove =
    hooks.remove ??
    vi.fn<RemoveFn>().mockImplementation(async (id) => {
      // 乐观移除：从本地列表剔除（同 usePosts.remove）
      data = data.filter((p) => (p as { id?: string })?.id !== id);
      return true;
    });
  mockUsePosts.mockImplementation(() => ({
    data,
    loading: false,
    error: null,
    saving: false,
    fetch: vi.fn(),
    create: vi.fn(),
    update,
    remove,
    uploadImage: vi.fn(),
  }));
  const { container } = render(<AdminCommunityPage />);
  return { update, remove, container };
}

describe("AdminCommunityPage 社区管理", () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;
  let alertSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    setAdminId("admin-1"); // 自删用例会改管理员 id，默认恢复
    // jsdom 未实现 alert/confirm，spy 并配置默认行为
    alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  // ============================================================
  // 卡片去按钮化（Issue #179）：操作入口收敛到详情弹窗
  // ============================================================
  it("卡片无「编辑/删除/锁定」操作按钮，点击整卡打开详情弹窗", () => {
    renderPage([makePost()]);
    expect(screen.queryByText("编辑")).toBeNull();
    expect(screen.queryByText("删除")).toBeNull();
    expect(screen.queryByText("锁定")).toBeNull();
    // 点击卡片标题打开详情弹窗
    fireEvent.click(screen.getByText("测试公告"));
    expect(screen.getByText("联系方式")).toBeTruthy();
    expect(screen.getByText("wx-id")).toBeTruthy();
    // 底部操作行右下角（justify-end，Issue #182）
    expect(screen.getByText("锁定").parentElement!.className).toContain("justify-end");
  });

  it("详情弹窗完整展示帖子信息（类型/作者/时间/内容/图片/联系方式/锁定徽章）", () => {
    renderPage([
      makePost({
        is_locked: true,
        image_url: "https://mock.supabase.co/storage/v1/object/public/community-images/qr.png",
      }),
    ]);
    fireEvent.click(screen.getByText("测试公告")); // 打开详情弹窗
    // 类型徽章：卡片与弹窗各一个
    expect(screen.getAllByText("重奏").length).toBeGreaterThanOrEqual(2);
    // 创建者与时间（时间用与页面相同的格式化函数计算期望值，避免时区依赖）
    expect(screen.getByText("创建者：张三")).toBeTruthy();
    const expectedTime = formatDateTimeInChina("2026-01-01T00:00:00+08:00");
    expect(screen.getByText(`时间：${expectedTime}`)).toBeTruthy();
    // 内容：卡片预览 + 弹窗正文
    expect(screen.getAllByText("测试内容").length).toBeGreaterThanOrEqual(2);
    // 图片（只读展示，无放大浮层）
    expect(screen.getByAltText("公告图片")).toBeTruthy();
    // 联系方式
    expect(screen.getByText("wx-id")).toBeTruthy();
    // 已锁定徽章：卡片与弹窗各一个
    expect(screen.getAllByText("🔒 已锁定").length).toBeGreaterThanOrEqual(2);
  });

  it("点「锁定」：调用 update 切换 is_locked，弹窗内状态刷新（乐观更新）", async () => {
    const { update } = renderPage([makePost()]);
    fireEvent.click(screen.getByText("测试公告")); // 打开详情弹窗
    expect(screen.getByText("锁定")).toBeTruthy();
    fireEvent.click(screen.getByText("锁定"));
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith("post-1", { is_locked: true });
    });
    // 乐观更新后：弹窗内按钮变为「解锁」，已锁定徽章出现（卡片 + 弹窗）
    await waitFor(() => {
      expect(screen.getByText("解锁")).toBeTruthy();
    });
    expect(screen.getAllByText("🔒 已锁定").length).toBeGreaterThanOrEqual(2);
  });

  it("点「删除」：confirm 后调用 remove，列表刷新后派生弹窗自动关闭", async () => {
    const { remove } = renderPage([makePost()]);
    fireEvent.click(screen.getByText("测试公告")); // 打开详情弹窗
    expect(screen.getByText("联系方式")).toBeTruthy(); // 弹窗已打开
    fireEvent.click(screen.getByText("删除"));
    expect(confirmSpy).toHaveBeenCalledWith("确定删除？");
    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith("post-1");
    });
    // 删除成功后列表刷新，派生详情弹窗自动关闭（无需显式关闭）
    await waitFor(() => {
      expect(screen.queryByText("联系方式")).toBeNull();
    });
    expect(screen.queryByText("测试公告")).toBeNull(); // 帖子已从列表移除
  });

  it("锁定 busy 态：显示「处理中…」并禁用，完成后恢复", async () => {
    let resolveUpdate!: (ok: boolean) => void;
    const update = vi.fn<UpdateFn>().mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    renderPage([makePost()], { update });
    fireEvent.click(screen.getByText("测试公告")); // 打开详情弹窗
    fireEvent.click(screen.getByText("锁定"));
    // busy：显示「处理中…」且禁用；「删除」同步禁用
    expect((screen.getByText("处理中…") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("删除") as HTMLButtonElement).disabled).toBe(true);
    // 完成后恢复为「锁定」
    await act(async () => {
      resolveUpdate(true);
    });
    expect(screen.queryByText("处理中…")).toBeNull();
    expect(screen.getByText("锁定")).toBeTruthy();
  });

  it("删除 busy 态：显示「删除中…」并禁用，完成后恢复", async () => {
    let resolveRemove!: (ok: boolean) => void;
    const remove = vi.fn<RemoveFn>().mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveRemove = resolve;
        }),
    );
    renderPage([makePost()], { remove });
    fireEvent.click(screen.getByText("测试公告")); // 打开详情弹窗
    fireEvent.click(screen.getByText("删除"));
    // busy：显示「删除中…」且禁用；「锁定」同步禁用
    expect((screen.getByText("删除中…") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("锁定") as HTMLButtonElement).disabled).toBe(true);
    // 完成后恢复为「删除」
    await act(async () => {
      resolveRemove(true);
    });
    expect(screen.queryByText("删除中…")).toBeNull();
    expect(screen.getByText("删除")).toBeTruthy();
  });

  // ============================================================
  // 对抗修复回归：busy 期间弹窗关闭拦截 + 失败路径反馈
  // ============================================================
  it("锁定进行中：弹窗关闭被拦截（遮罩按钮不渲染、关闭按钮守卫），完成后可关闭", async () => {
    let resolveUpdate!: (ok: boolean) => void;
    const update = vi.fn<UpdateFn>().mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    renderPage([makePost()], { update });
    fireEvent.click(screen.getByText("测试公告")); // 打开详情弹窗
    fireEvent.click(screen.getByText("锁定"));
    // busy：遮罩关闭按钮不再渲染，标题栏「关闭」点击被守卫拦截
    expect(screen.queryByLabelText("关闭弹窗")).toBeNull();
    fireEvent.click(screen.getByText("关闭"));
    expect(screen.getByText("联系方式")).toBeTruthy(); // 弹窗保持打开
    // 完成后弹窗可正常关闭
    await act(async () => {
      resolveUpdate(true);
    });
    fireEvent.click(screen.getByText("关闭"));
    expect(screen.queryByText("联系方式")).toBeNull();
  });

  it("锁定失败：alert 提示、弹窗保持、按钮恢复可重试", async () => {
    const update = vi.fn<UpdateFn>().mockResolvedValue(false);
    renderPage([makePost()], { update });
    fireEvent.click(screen.getByText("测试公告")); // 打开详情弹窗
    fireEvent.click(screen.getByText("锁定"));
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith("post-1", { is_locked: true });
    });
    expect(alertSpy).toHaveBeenCalledWith("操作失败");
    // 弹窗保持，busy 解除后按钮恢复可点击
    expect(screen.getByText("联系方式")).toBeTruthy();
    expect((screen.getByText("锁定") as HTMLButtonElement).disabled).toBe(false);
  });

  it("删除失败：alert 提示、弹窗保持、按钮恢复可重试", async () => {
    const remove = vi.fn<RemoveFn>().mockResolvedValue(false);
    renderPage([makePost()], { remove });
    fireEvent.click(screen.getByText("测试公告")); // 打开详情弹窗
    fireEvent.click(screen.getByText("删除"));
    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith("post-1");
    });
    expect(alertSpy).toHaveBeenCalledWith("删除失败");
    // 弹窗保持，busy 解除后按钮恢复可点击
    expect(screen.getByText("联系方式")).toBeTruthy();
    expect((screen.getByText("删除") as HTMLButtonElement).disabled).toBe(false);
  });

  // ============================================================
  // Issue #188：删除/锁定成功 → 向作者插通知；作者=操作者时不通知
  // ============================================================
  it("删除成功 → 向作者插 activity 通知（文案含帖子类型与标题）", async () => {
    const { remove } = renderPage([makePost()]); // author_id: user-1 ≠ admin-1
    fireEvent.click(screen.getByText("测试公告"));
    fireEvent.click(screen.getByText("删除"));
    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith("post-1");
    });
    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalledWith({
        user_id: "user-1",
        category: "activity",
        title: "帖子已被删除",
        content: "你的重奏帖子《测试公告》已被管理员删除",
      });
    });
  });

  it("锁定（false→true）→ 插通知；解锁（true→false）不再插", async () => {
    const { update } = renderPage([makePost()]);
    fireEvent.click(screen.getByText("测试公告"));
    fireEvent.click(screen.getByText("锁定"));
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith("post-1", { is_locked: true });
    });
    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalledWith({
        user_id: "user-1",
        category: "activity",
        title: "帖子已被锁定",
        content: "你的重奏帖子《测试公告》已被管理员锁定",
      });
    });
    // 解锁（is_locked true→false）：不插通知，插入次数保持 1
    fireEvent.click(screen.getByText("解锁"));
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith("post-1", { is_locked: false });
    });
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it("作者=操作者：删除自己的帖子不插通知", async () => {
    setAdminId("user-1");
    const { remove } = renderPage([makePost({ author_id: "user-1" })]);
    fireEvent.click(screen.getByText("测试公告"));
    fireEvent.click(screen.getByText("删除"));
    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith("post-1");
    });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("作者=操作者：锁定自己的帖子不插通知", async () => {
    setAdminId("user-1");
    const { update } = renderPage([makePost({ author_id: "user-1" })]);
    fireEvent.click(screen.getByText("测试公告"));
    fireEvent.click(screen.getByText("锁定"));
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith("post-1", { is_locked: true });
    });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("通知插入失败不阻断删除主操作（列表仍移除、不弹失败提示）", async () => {
    mockInsert.mockResolvedValueOnce({ error: { message: "insert failed" } });
    const { remove } = renderPage([makePost()]);
    fireEvent.click(screen.getByText("测试公告"));
    fireEvent.click(screen.getByText("删除"));
    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith("post-1");
    });
    // 主操作照常成功：帖子移除、无「删除失败」提示
    await waitFor(() => {
      expect(screen.queryByText("测试公告")).toBeNull();
    });
    expect(alertSpy).not.toHaveBeenCalledWith("删除失败");
  });
});
