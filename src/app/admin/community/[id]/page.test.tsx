/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import React from "react";
import AdminPostDetailPage from "./page";
import { usePosts } from "@/hooks/usePosts";
import { formatDateTimeInChina } from "@/lib/date-utils";

const mocks = vi.hoisted(() => {
  const insert = vi.fn().mockResolvedValue({ error: null });
  let adminId = "admin-1";
  const mockUseUser = () => ({ user: { id: adminId }, login: vi.fn(), logout: vi.fn() });
  const setAdminId = (id: string) => {
    adminId = id;
  };
  return { routerPush: vi.fn(), insert, mockUseUser, setAdminId };
});

vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ insert: mocks.insert }) },
}));

vi.mock("@/context/user-context", () => ({
  useUser: mocks.mockUseUser,
}));

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
  useParams: () => ({ id: "post-1" }),
}));

const mockUsePosts = vi.mocked(usePosts);

type UpdateFn = (id: string, payload: Record<string, unknown>) => Promise<boolean>;
type RemoveFn = (id: string) => Promise<boolean>;

function makePost(overrides: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    title: "测试公告",
    type: "ensemble",
    content: "测试内容",
    image_url: "https://mock.supabase.co/storage/v1/object/public/community-images/qr.png",
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

function renderDetail(
  post: Record<string, unknown>,
  hooks: Partial<{ update: UpdateFn; remove: RemoveFn }> = {},
) {
  let data: unknown[] = [post];
  const update =
    hooks.update ??
    vi.fn<UpdateFn>().mockImplementation(async (id, payload) => {
      data = data.map((p) =>
        (p as { id?: string })?.id === id ? { ...(p as Record<string, unknown>), ...payload } : p,
      );
      return true;
    });
  const remove =
    hooks.remove ??
    vi.fn<RemoveFn>().mockImplementation(async (id) => {
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
  render(<AdminPostDetailPage />);
  return { update, remove };
}

describe("AdminPostDetailPage 公告详情（Issue #179：Modal→页面）", () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;
  let alertSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mocks.routerPush.mockClear();
    mocks.insert.mockClear();
    mocks.setAdminId("admin-1");
    vi.clearAllMocks();
    alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("详情页完整展示帖子信息（类型/时间/内容/图片/联系方式）", () => {
    renderDetail(makePost({ is_locked: true }));
    expect(screen.getByText("测试公告")).toBeTruthy();
    // 副标题：类型 · 时间
    const expectedTime = formatDateTimeInChina("2026-01-01T00:00:00+08:00");
    expect(screen.getByText(/重奏/)).toBeTruthy();
    expect(screen.getByText((text) => text.includes(expectedTime))).toBeTruthy();
    // 内容
    expect(screen.getByText("内容")).toBeTruthy();
    expect(screen.getByText("测试内容")).toBeTruthy();
    // 图片
    expect(screen.getByAltText("公告图片")).toBeTruthy();
    // 联系方式
    expect(screen.getByText("联系方式")).toBeTruthy();
    expect(screen.getByText("wx-id")).toBeTruthy();
    // 已锁定 → 操作按钮为「解锁」
    expect(screen.getByText("解锁")).toBeTruthy();
  });

  it("点「锁定」：调用 update 切换 is_locked，按钮变「解锁」", async () => {
    const { update } = renderDetail(makePost());
    expect(screen.getByText("锁定")).toBeTruthy();
    fireEvent.click(screen.getByText("锁定"));
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith("post-1", { is_locked: true });
    });
    await waitFor(() => {
      expect(screen.getByText("解锁")).toBeTruthy();
    });
  });

  it("点「删除」：confirm 后调用 remove，跳转列表", async () => {
    const { remove } = renderDetail(makePost());
    expect(screen.getByText("联系方式")).toBeTruthy();
    fireEvent.click(screen.getByText("删除"));
    expect(confirmSpy).toHaveBeenCalledWith("确定删除？");
    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith("post-1");
    });
    await waitFor(() => {
      expect(mocks.routerPush).toHaveBeenCalledWith("/admin/community");
    });
  });

  it("锁定 busy 态：显示「处理中…」并禁用，完成后恢复", async () => {
    let resolveUpdate!: (ok: boolean) => void;
    const update = vi.fn<UpdateFn>().mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    renderDetail(makePost(), { update });
    fireEvent.click(screen.getByText("锁定"));
    expect((screen.getByText("处理中…") as HTMLButtonElement).disabled).toBe(true);
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
    renderDetail(makePost(), { remove });
    fireEvent.click(screen.getByText("删除"));
    expect((screen.getByText("删除中…") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      resolveRemove(true);
    });
    expect(screen.queryByText("删除中…")).toBeNull();
    expect(screen.getByText("删除")).toBeTruthy();
  });

  it("锁定失败：alert 提示、按钮恢复可重试", async () => {
    const update = vi.fn<UpdateFn>().mockResolvedValue(false);
    renderDetail(makePost(), { update });
    fireEvent.click(screen.getByText("锁定"));
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith("post-1", { is_locked: true });
    });
    expect(alertSpy).toHaveBeenCalledWith("操作失败");
    expect((screen.getByText("锁定") as HTMLButtonElement).disabled).toBe(false);
  });

  it("删除失败：alert 提示、按钮恢复可重试", async () => {
    const remove = vi.fn<RemoveFn>().mockResolvedValue(false);
    renderDetail(makePost(), { remove });
    fireEvent.click(screen.getByText("删除"));
    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith("post-1");
    });
    expect(alertSpy).toHaveBeenCalledWith("删除失败");
    expect((screen.getByText("删除") as HTMLButtonElement).disabled).toBe(false);
  });

  // ============================================================
  // Issue #188：删除/锁定成功 → 向作者插通知；作者=操作者时不通知
  // ============================================================
  it("删除成功 → 向作者插 activity 通知（文案含帖子类型与标题）", async () => {
    const { remove } = renderDetail(makePost()); // author_id: user-1 ≠ admin-1
    fireEvent.click(screen.getByText("删除"));
    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith("post-1");
    });
    await waitFor(() => {
      expect(mocks.insert).toHaveBeenCalledWith({
        user_id: "user-1",
        category: "activity",
        title: "帖子已被删除",
        content: "你的重奏帖子《测试公告》已被管理员删除",
      });
    });
  });

  it("锁定（false→true）→ 插通知；解锁（true→false）不再插", async () => {
    const { update } = renderDetail(makePost());
    fireEvent.click(screen.getByText("锁定"));
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith("post-1", { is_locked: true });
    });
    await waitFor(() => {
      expect(mocks.insert).toHaveBeenCalledWith({
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
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });

  it("作者=操作者：删除自己的帖子不插通知", async () => {
    mocks.setAdminId("user-1");
    const { remove } = renderDetail(makePost({ author_id: "user-1" }));
    fireEvent.click(screen.getByText("删除"));
    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith("post-1");
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("作者=操作者：锁定自己的帖子不插通知", async () => {
    mocks.setAdminId("user-1");
    const { update } = renderDetail(makePost({ author_id: "user-1" }));
    fireEvent.click(screen.getByText("锁定"));
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith("post-1", { is_locked: true });
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("通知插入失败不阻断删除主操作（列表仍移除、不弹失败提示）", async () => {
    mocks.insert.mockResolvedValueOnce({ error: { message: "insert failed" } });
    const { remove } = renderDetail(makePost());
    fireEvent.click(screen.getByText("删除"));
    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith("post-1");
    });
    await waitFor(() => {
      expect(screen.queryByText("测试公告")).toBeNull();
    });
    expect(alertSpy).not.toHaveBeenCalledWith("删除失败");
  });
});
