// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import FeedbackPage from "./page";
import { renderWithProviders } from "@/__tests__/render-with-providers";

// supabase 的链式 mock：页面写的是 `from(…).select(…).order(…)` 之后**直接 `.then(…)`**，
// 所以终点必须是个可 await 的值（`mockResolvedValue` 的 promise 正合适）。
const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  order: vi.fn(),
}));

/** 这次渲染里**每一次** `select` 的实参（首屏与「重试」是两条独立的查询）。 */
const selectCalls = () => mocks.select.mock.calls.map(([cols]) => String(cols));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({ select: mocks.select }),
  },
}));

/** 让查询返回给定的行。`select` 的实参由 `selectCalls()` 从调用记录里读 —— 不另存字段：
 *  那样写既会漏掉第二次查询，又会跨用例留值（`vi.clearAllMocks()` 只清 calls）。 */
function respondWith(rows: unknown[]) {
  mocks.select.mockImplementation(() => ({ order: mocks.order }));
  mocks.order.mockResolvedValue({ data: rows, error: null });
}

describe("反馈列表：作者名（#314 的行为修复）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("实名反馈：profiles 是**对象**时，作者名要显示出来", async () => {
    // ⚠️ 这条钉的是一个**已经回归过一次**的 bug（#268 修过、#271 重写页面时又回来了）：
    // PostgREST 的 **to-one 嵌入回对象**（`feedback_created_by_fkey` 在 feedback 一侧 ⇒ 多对一），
    // 而页面曾按数组取 `r.profiles?.[0]` ⇒ 对象上取 `[0]` 恒为 undefined ⇒ 作者名不显示
    //（#268 修过、#271 重写页面时又带回来了 —— 不是「从来没显示过」）。
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
    // ⚠️ **真正有牙的是下面那个字符串断言，不是上面这句渲染断言**：mock 无条件返回给它的行，
    // 从不模拟 PostgREST 的 inner-join 过滤 ⇒ 就算把 `!inner` 加回去，「匿名行渲染出来了」
    // 也照样成立（实测：加回 `!inner` 时唯一失败的就是下面那句）。渲染断言只说明「渲染路径没崩」，
    // 别以为它覆盖了「匿名行不会被滤掉」—— 那件事在本地测不了（要真 PostgREST）。
    expect(selectCalls().length).toBeGreaterThan(0);
    for (const cols of selectCalls()) {
      expect(cols).not.toContain("!inner");
      // ⚠️ 嵌入本身也要在查询里：类型一旦退回可选形态，漏掉 `profiles(full_name)`
      // 是 **tsc 0 错 + 用例全绿**（实测），而作者名会静静地不再显示 —— 这行是那种情况下
      // 唯一的警报。（顺带堵掉「无参调用被 `String()` 变成 "undefined"」的小口子。）
      // ⚠️ 嵌入必须是**没被别名**的 `profiles(...)`、且投影里要有 `full_name`。
      // 这里用正则而不是 `toContain("profiles(full_name)")`：后者两头都不对 ——
      // ① **太松**：`p:profiles(full_name)`（关系被别名）照样命中子串，而生产上 PostgREST 回的键是 `p`
      //    ⇒ 作者名照旧静静地不显示（实测：再配上「类型退回可选形态」就是 tsc 0 错 + 用例全绿）；
      // ② **太紧**：`profiles(full_name, avatar_url)`（顺手多取一列）、`profiles(full_name )`（多个空格）、
      //    `profiles!feedback_created_by_fkey(full_name)`（#268 时代真在跑的写法）都会被判红 ——
      //    那些是**合法**查询，测试不该拦（误伤逼着后人把断言删掉，比漏报更坏）。
      expect(cols).toMatch(/(?:^|,\s*)profiles\s*(?:![A-Za-z_]+)?\([^)]*\bfull_name\b/);
    }
  });

  it("「重试」那条查询同样不许带 `!inner` —— 首屏与 refetch 是两条独立的 select", async () => {
    // ⚠️ 这条补的是上面那条的盲区：只钉首屏的话，把 `!inner` 加回 **refetch** 照样绿
    //（实测过）。两条查询各有各的字符串，就得各钉一次。
    mocks.select.mockImplementation(() => ({ order: mocks.order }));
    mocks.order.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    renderWithProviders(<FeedbackPage />);
    await waitFor(() => expect(screen.getByText("重试")).toBeTruthy());

    mocks.order.mockResolvedValueOnce({
      data: [
        {
          id: "f3",
          content: "重试之后才看到的一条",
          created_at: "2026-09-22T10:00:00Z",
          is_anonymous: true,
          profiles: null,
        },
      ],
      error: null,
    });
    fireEvent.click(screen.getByText("重试"));
    await waitFor(() => expect(screen.getByText(/重试之后才看到的一条/)).toBeTruthy());

    // 两次查询都真的发生过（否则下面那个循环是空转）
    expect(selectCalls().length).toBeGreaterThanOrEqual(2);
    for (const cols of selectCalls()) {
      expect(cols).not.toContain("!inner");
      expect(cols).toMatch(/(?:^|,\s*)profiles\s*(?:![A-Za-z_]+)?\([^)]*\bfull_name\b/); // 同上：关系名不许别名、投影里必须有 full_name
    }
  });
});
