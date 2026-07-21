// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useProfiles } from "../useProfiles";

function mockClient<T>(responses: T[]) {
  let i = 0;
  const chain = (res: T) => ({
    eq: () => chain(res),
    in: () => chain(res),
    maybeSingle: () => chain(res),
    order: () => chain(res),
    limit: () => chain(res),
    then: (resolve: (v: T) => void) => resolve(res),
  });
  return {
    from: () => ({
      select: () => chain(responses[i++]),
      update: () => ({ eq: () => chain(responses[i++]) }),
      insert: () => chain(responses[i++]),
    }),
    auth: {
      getSession: () => Promise.resolve({ data: { session: { access_token: "test-token" } } }),
    },
  };
}

describe("useProfiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("status 过滤 profiles", async () => {
    const c = mockClient([
      { data: [{ id: "1", full_name: "张三", status: "approved" }], error: null },
    ]);
    const { result } = renderHook(() => useProfiles({ status: "approved" }, c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toHaveLength(1);
  });

  it("fetch 失败", async () => {
    const c = mockClient([{ data: null, error: { message: "err" } }]);
    const { result } = renderHook(() => useProfiles({ status: "pending" }, c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("err");
  });

  it("approve 批准并移除", async () => {
    const c = mockClient([
      { data: [{ id: "1", full_name: "李四", status: "pending" }], error: null },
    ]);

    // Mock fetch API
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });
    global.fetch = mockFetch;

    const { result } = renderHook(() => useProfiles({ status: "pending" }, c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toHaveLength(1);

    await act(async () => {
      await result.current.approve("1");
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/admin/approve",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: expect.stringMatching(/^Bearer /),
        }),
        body: JSON.stringify({ id: "1" }),
      }),
    );
    expect(result.current.data).toHaveLength(0);
  });

  it("insert 创建 profile", async () => {
    const c = mockClient([{ data: [], error: null }, { error: null }]);
    const { result } = renderHook(() => useProfiles(undefined, c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() =>
      result.current.insert({
        id: "u1",
        email: "a@b.com",
        full_name: "王五",
        instrument: "大提琴",
      }),
    );
    expect(ok).toBe(true);
  });

  it("reject 拒绝并移除", async () => {
    const c = mockClient([
      { data: [{ id: "1", full_name: "李四", status: "pending" }], error: null },
    ]);

    // Mock fetch API
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });
    global.fetch = mockFetch;

    const { result } = renderHook(() => useProfiles({ status: "pending" }, c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toHaveLength(1);

    await act(async () => {
      await result.current.reject("1");
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/admin/reject",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: expect.stringMatching(/^Bearer /),
        }),
        body: JSON.stringify({ id: "1" }),
      }),
    );
    expect(result.current.data).toHaveLength(0);
  });

  it("reject 防重复提交", async () => {
    const c = mockClient([
      { data: [{ id: "1", full_name: "李四", status: "pending" }], error: null },
    ]);

    // Mock fetch API - 慢速响应
    const mockFetch = vi
      .fn()
      .mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () => resolve({ ok: true, json: () => Promise.resolve({ success: true }) }),
              100,
            ),
          ),
      );
    global.fetch = mockFetch;

    const { result } = renderHook(() => useProfiles({ status: "pending" }, c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // 同时调用两次 reject
    const [first, second] = await Promise.all([
      act(() => result.current.reject("1")),
      act(() => result.current.reject("1")),
    ]);

    expect(first).toBe(true);
    expect(second).toBe(false); // 第二次调用应该被阻止
    expect(mockFetch).toHaveBeenCalledTimes(1); // 只应该发起一次请求
  });

  it("reject API 失败时不更新本地状态", async () => {
    const c = mockClient([
      { data: [{ id: "1", full_name: "李四", status: "pending" }], error: null },
    ]);

    // Mock fetch API - 返回失败
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ success: false, error: "拒绝失败" }),
    });
    global.fetch = mockFetch;

    const { result } = renderHook(() => useProfiles({ status: "pending" }, c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toHaveLength(1);

    await act(async () => {
      await result.current.reject("1");
    });

    expect(result.current.data).toHaveLength(1); // 失败时数据不应该被移除
    expect(result.current.error).toBe("拒绝失败");
  });

  it("approve 防重复提交", async () => {
    const c = mockClient([
      { data: [{ id: "1", full_name: "李四", status: "pending" }], error: null },
    ]);

    // Mock fetch API - 慢速响应
    const mockFetch = vi
      .fn()
      .mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () => resolve({ ok: true, json: () => Promise.resolve({ success: true }) }),
              100,
            ),
          ),
      );
    global.fetch = mockFetch;

    const { result } = renderHook(() => useProfiles({ status: "pending" }, c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // 同时调用两次 approve
    const [first, second] = await Promise.all([
      act(() => result.current.approve("1")),
      act(() => result.current.approve("1")),
    ]);

    expect(first).toBe(true);
    expect(second).toBe(false); // 第二次调用应该被阻止
    expect(mockFetch).toHaveBeenCalledTimes(1); // 只应该发起一次请求
  });

  it("approve API 失败时不更新本地状态", async () => {
    const c = mockClient([
      { data: [{ id: "1", full_name: "李四", status: "pending" }], error: null },
    ]);

    // Mock fetch API - 返回失败
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ success: false, error: "批准失败" }),
    });
    global.fetch = mockFetch;

    const { result } = renderHook(() => useProfiles({ status: "pending" }, c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toHaveLength(1);

    await act(async () => {
      await result.current.approve("1");
    });

    expect(result.current.data).toHaveLength(1); // 失败时数据不应该被移除
    expect(result.current.error).toBe("批准失败");
  });
});
