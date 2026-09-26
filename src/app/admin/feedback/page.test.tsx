// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import FeedbackPage from "./page";
import { renderWithProviders } from "@/__tests__/render-with-providers";

// supabase 的链式 mock：页面写的是 `from(…).select(…).order(…)` 之后**直接 `.then(…)`**，
// 所以终点必须是个可 await 的值（`mockResolvedValue` 的 promise 正合适）。
const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  order: vi.fn(),
  selectArg: "",
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({ select: mocks.select }),
  },
}));

/** 让这次查询返回给定的行，并记下 `select` 的实参（用来钉「没有 `!inner`」）。 */
function respondWith(rows: unknown[]) {
  mocks.select.mockImplementation((cols: string) => {
    mocks.selectArg = cols;
    return { order: mocks.order };
  });
  mocks.order.mockResolvedValue({ data: rows, error: null });
}

describe("反馈列表：作者名（#314 的行为修复）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("实名反馈：profiles 是**对象**时，作者名要显示出来", async () => {
    // ⚠️ 这条钉的是一个**已经回归过一次**的 bug（#268 修过、#271 重写页面时又回来了）：
    // PostgREST 的 **to-one 嵌入回对象**（`feedback_created_by_fkey` 在 feedback 一侧 ⇒ 多对一），
    // 而页面曾按数组取 `r.profiles?.[0]` ⇒ 对象上取 `[0]` 恒为 undefined ⇒ 作者名从来没显示出来过。
    // 修前红、修后绿。
    respondWith([
      {
        id: "f1",
        content: "音响太响了",
        created_at: "2026-09-20T10:00:00Z",
        is_anonymous: false,
        profiles: { full_name: "张三" },
      },
    ]);
    renderWithProviders(<FeedbackPage />);
    await waitFor(() => expect(screen.getByText(/音响太响了/)).toBeTruthy());
    expect(screen.getByText(/张三/)).toBeTruthy();
  });

  it("匿名反馈（created_by 为空）也要照样列出来 —— 查询里不能带 `!inner`", async () => {
    // `profiles!inner(…)` 会把「嵌入为 null」的父行**整个滤掉**（PostgREST 的 inner-join 语义），
    // 而匿名反馈的 `created_by` 正是 null ⇒ 那样写会让**匿名反馈从列表里消失**（#271 带进来的回归）。
    respondWith([
      {
        id: "f2",
        content: "匿名说一句",
        created_at: "2026-09-21T10:00:00Z",
        is_anonymous: true,
        profiles: null,
      },
    ]);
    renderWithProviders(<FeedbackPage />);
    await waitFor(() => expect(screen.getByText(/匿名说一句/)).toBeTruthy());
    expect(mocks.selectArg).not.toContain("!inner");
  });
});
