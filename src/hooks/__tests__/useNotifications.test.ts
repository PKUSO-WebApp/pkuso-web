// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNotifications } from "../useNotifications";

/**
 * 可编程响应的 supabase mock（Issue #188）：
 * - from("notifications").select("category").is("read_at", null) → refresh 链，走 refreshResult
 * - from("notifications").update({...}).in(...).is(...).select("id") → mark 链，走 markResult
 * 中间节点（is/in/select/update）均为同一 thenable 链，最终在 then 处取出当前结果。
 */
function mockClient() {
  let refreshResult: () => unknown = () => ({ data: [], error: null });
  let markResult: () => unknown = () => ({ data: [{ id: "n1" }], error: null });
  const markIds: string[][] = [];
  const chain = (r: () => unknown) => ({
    is: () => chain(r),
    in: (_col: string, ids: string[]) => {
      markIds.push(ids);
      return chain(r);
    },
    select: () => chain(r),
    update: () => chain(r),
    then: (resolve: (v: unknown) => void) => resolve(r()),
  });
  return {
    markIds, // markCategoryRead 收到的 id 数组（断言 update 是否被触发）
    setRefreshResult: (r: () => unknown) => (refreshResult = r),
    setMarkResult: (r: () => unknown) => (markResult = r),
    from: () => ({
      select: () => chain(refreshResult),
      update: () => chain(markResult),
    }),
  };
}

describe("useNotifications（Issue #188）", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy?.mockRestore();
  });

  it("refresh 按 category 分组计数，未知分类跳过，totalUnread 汇总", async () => {
    const c = mockClient();
    c.setRefreshResult(() => ({
      data: [
        { category: "attendance" },
        { category: "attendance" },
        { category: "activity" },
        { category: "system" },
        { category: "future-category" },
      ],
      error: null,
    }));
    const { result } = renderHook(() => useNotifications(c as never));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.unreadCounts).toEqual({ attendance: 2, activity: 1, system: 1 });
    expect(result.current.totalUnread).toBe(4);
    expect(result.current.loading).toBe(false);
  });

  it("refresh 查询失败：保留上次计数而非清 0，loading 复位", async () => {
    const c = mockClient();
    c.setRefreshResult(() => ({ data: [{ category: "system" }], error: null }));
    const { result } = renderHook(() => useNotifications(c as never));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.unreadCounts.system).toBe(1);

    c.setRefreshResult(() => ({ data: null, error: { message: "RLS 拒绝" } }));
    await act(async () => {
      await result.current.refresh();
    });
    // error 分支不 setUnreadCounts：保留旧计数，避免红气泡误消失
    expect(result.current.unreadCounts.system).toBe(1);
    expect(result.current.loading).toBe(false);
  });

  it("markCategoryRead ids 为空：跳过 update 直接归零返回 true", async () => {
    const c = mockClient();
    const { result } = renderHook(() => useNotifications(c as never));
    let ok = false;
    await act(async () => {
      ok = await result.current.markCategoryRead("attendance", []);
    });
    expect(ok).toBe(true);
    expect(result.current.unreadCounts.attendance).toBe(0);
    // 未触发任何 update 链
    expect(c.markIds).toEqual([]);
  });

  it("markCategoryRead 命中 1 行：归零返回 true，其他分类不受影响", async () => {
    const c = mockClient();
    c.setRefreshResult(() => ({ data: [{ category: "activity" }], error: null }));
    const { result } = renderHook(() => useNotifications(c as never));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.unreadCounts.activity).toBe(1);

    let ok = false;
    await act(async () => {
      ok = await result.current.markCategoryRead("activity", ["n1"]);
    });
    expect(ok).toBe(true);
    expect(c.markIds).toEqual([["n1"]]);
    expect(result.current.unreadCounts.activity).toBe(0);
    expect(result.current.unreadCounts.attendance).toBe(0);
    expect(result.current.unreadCounts.system).toBe(0);
  });

  it("markCategoryRead 0 行（并发已读/RLS 静默失败）：返回 false 且不归零", async () => {
    const c = mockClient();
    c.setRefreshResult(() => ({ data: [{ category: "attendance" }], error: null }));
    c.setMarkResult(() => ({ data: [], error: null }));
    const { result } = renderHook(() => useNotifications(c as never));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.unreadCounts.attendance).toBe(1);

    let ok = true;
    await act(async () => {
      ok = await result.current.markCategoryRead("attendance", ["n1"]);
    });
    expect(ok).toBe(false);
    // 0 行不归零本地计数，避免徽章与 DB 不一致
    expect(result.current.unreadCounts.attendance).toBe(1);
  });

  it("markCategoryRead dbError：返回 false 且不归零", async () => {
    const c = mockClient();
    c.setRefreshResult(() => ({ data: [{ category: "system" }], error: null }));
    c.setMarkResult(() => ({ data: null, error: { message: "断网" } }));
    const { result } = renderHook(() => useNotifications(c as never));
    await act(async () => {
      await result.current.refresh();
    });
    let ok = true;
    await act(async () => {
      ok = await result.current.markCategoryRead("system", ["n1"]);
    });
    expect(ok).toBe(false);
    expect(result.current.unreadCounts.system).toBe(1);
  });

  it("markCategoryRead 抛异常（网络中断）：返回 false 且不归零", async () => {
    const c = mockClient();
    c.setRefreshResult(() => ({ data: [{ category: "attendance" }], error: null }));
    c.setMarkResult(() => {
      throw new Error("network down");
    });
    const { result } = renderHook(() => useNotifications(c as never));
    await act(async () => {
      await result.current.refresh();
    });
    let ok = true;
    await act(async () => {
      ok = await result.current.markCategoryRead("attendance", ["n1"]);
    });
    expect(ok).toBe(false);
    expect(result.current.unreadCounts.attendance).toBe(1);
  });
});
