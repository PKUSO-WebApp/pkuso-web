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

  // ---- approveAll ----
  it("approveAll 成功后清空列表", async () => {
    const c = mockClient([
      {
        data: [
          { id: "1", full_name: "张三", status: "pending" },
          { id: "2", full_name: "李四", status: "pending" },
        ],
        error: null,
      },
    ]);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });
    global.fetch = mockFetch;

    const { result } = renderHook(() => useProfiles({ status: "pending" }, c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toHaveLength(2);

    await act(async () => {
      await result.current.approveAll();
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/admin/approve-all",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: expect.stringMatching(/^Bearer /),
        }),
      }),
    );
    expect(result.current.data).toHaveLength(0);
    expect(result.current.error).toBeNull();
    expect(result.current.saving).toBe(false);
  });

  it("approveAll 失败时保留列表并设置 error", async () => {
    const c = mockClient([
      {
        data: [
          { id: "1", full_name: "张三", status: "pending" },
          { id: "2", full_name: "李四", status: "pending" },
        ],
        error: null,
      },
    ]);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ success: false, error: "批量批准失败" }),
    });
    global.fetch = mockFetch;

    const { result } = renderHook(() => useProfiles({ status: "pending" }, c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toHaveLength(2);

    await act(async () => {
      await result.current.approveAll();
    });

    expect(result.current.data).toHaveLength(2); // 列表保留
    expect(result.current.error).toBe("批量批准失败");
    expect(result.current.saving).toBe(false);
  });

  it("approveAll 网络错误时设置通用错误信息", async () => {
    const c = mockClient([
      { data: [{ id: "1", full_name: "张三", status: "pending" }], error: null },
    ]);

    const mockFetch = vi.fn().mockRejectedValue(new Error("network error"));
    global.fetch = mockFetch;

    const { result } = renderHook(() => useProfiles({ status: "pending" }, c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.approveAll();
    });

    expect(result.current.error).toBe("网络错误");
    expect(result.current.data).toHaveLength(1);
  });

  it("approveAll 防重复提交：并发调用只执行一次", async () => {
    const c = mockClient([
      { data: [{ id: "1", full_name: "张三", status: "pending" }], error: null },
    ]);

    let fetchCallCount = 0;
    const mockFetch = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            fetchCallCount += 1;
            resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
          }, 100),
        ),
    );
    global.fetch = mockFetch;

    const { result } = renderHook(() => useProfiles({ status: "pending" }, c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // 并发调用两次 approveAll
    const [first, second] = await act(async () => {
      return Promise.all([result.current.approveAll(), result.current.approveAll()]);
    });

    expect(first).toBe(true);
    expect(second).toBe(false); // 第二次被阻止
    expect(fetchCallCount).toBe(1);
  });

  it("fetch 竞态保护：旧请求返回不覆盖新数据", async () => {
    // 模拟两次 fetch，第一次慢第二次快，验证最终数据是第二次的
    const oldData = [{ id: "1", full_name: "旧数据", status: "pending" }];
    const newData = [{ id: "2", full_name: "新数据", status: "pending" }];

    let firstResolve!: (value: unknown) => void;
    let callCount = 0;

    const chain = (res: unknown, isSlow = false) => ({
      eq: () => chain(res, isSlow),
      in: () => chain(res, isSlow),
      order: () => chain(res, isSlow),
      then: (resolve: (v: unknown) => void) => {
        if (isSlow) {
          // 慢请求：等待手动触发
          firstResolve = resolve;
        } else {
          resolve(res);
        }
      },
    });

    const c = {
      from: () => ({
        select: () => {
          callCount += 1;
          if (callCount === 1) {
            return chain({ data: oldData, error: null }, true);
          }
          return chain({ data: newData, error: null }, false);
        },
      }),
      auth: {
        getSession: () => Promise.resolve({ data: { session: { access_token: "test-token" } } }),
      },
    };

    const { result } = renderHook(() => useProfiles({ status: "pending" }, c as never));
    // useEffect 会触发第一次 fetch（慢）
    // 手动触发第二次 fetch（快，立即返回）
    await act(async () => {
      await result.current.fetch();
    });

    // 此时 data 应该是第二次的结果
    expect(result.current.data[0].id).toBe("2");

    // 让第一次请求返回
    await act(async () => {
      firstResolve({ data: oldData, error: null });
      await new Promise((r) => setTimeout(r, 10));
    });

    // data 不应被旧请求覆盖
    expect(result.current.data[0].id).toBe("2");
  });

  // ---- rejectAll ----
  it("rejectAll 成功后清空列表", async () => {
    const c = mockClient([
      {
        data: [
          { id: "1", full_name: "张三", status: "pending" },
          { id: "2", full_name: "李四", status: "pending" },
        ],
        error: null,
      },
    ]);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });
    global.fetch = mockFetch;

    const { result } = renderHook(() => useProfiles({ status: "pending" }, c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toHaveLength(2);

    await act(async () => {
      await result.current.rejectAll();
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/admin/reject-all",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: expect.stringMatching(/^Bearer /),
        }),
      }),
    );
    expect(result.current.data).toHaveLength(0);
    expect(result.current.error).toBeNull();
    expect(result.current.saving).toBe(false);
  });

  it("rejectAll 失败时保留列表并设置 error", async () => {
    const c = mockClient([
      {
        data: [
          { id: "1", full_name: "张三", status: "pending" },
          { id: "2", full_name: "李四", status: "pending" },
        ],
        error: null,
      },
    ]);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ success: false, error: "批量拒绝失败" }),
    });
    global.fetch = mockFetch;

    const { result } = renderHook(() => useProfiles({ status: "pending" }, c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toHaveLength(2);

    await act(async () => {
      await result.current.rejectAll();
    });

    expect(result.current.data).toHaveLength(2); // 列表保留
    expect(result.current.error).toBe("批量拒绝失败");
    expect(result.current.saving).toBe(false);
  });

  it("rejectAll 网络错误时设置通用错误信息", async () => {
    const c = mockClient([
      { data: [{ id: "1", full_name: "张三", status: "pending" }], error: null },
    ]);

    const mockFetch = vi.fn().mockRejectedValue(new Error("network error"));
    global.fetch = mockFetch;

    const { result } = renderHook(() => useProfiles({ status: "pending" }, c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.rejectAll();
    });

    expect(result.current.error).toBe("网络错误");
    expect(result.current.data).toHaveLength(1);
  });

  it("rejectAll 防重复提交：并发调用只执行一次", async () => {
    const c = mockClient([
      { data: [{ id: "1", full_name: "张三", status: "pending" }], error: null },
    ]);

    let fetchCallCount = 0;
    const mockFetch = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            fetchCallCount += 1;
            resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
          }, 100),
        ),
    );
    global.fetch = mockFetch;

    const { result } = renderHook(() => useProfiles({ status: "pending" }, c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // 并发调用两次 rejectAll
    const [first, second] = await act(async () => {
      return Promise.all([result.current.rejectAll(), result.current.rejectAll()]);
    });

    expect(first).toBe(true);
    expect(second).toBe(false); // 第二次被阻止
    expect(fetchCallCount).toBe(1);
  });

  it("approveAll 调用正确的 API endpoint 并携带 Authorization header", async () => {
    const c = mockClient([
      { data: [{ id: "1", full_name: "张三", status: "pending" }], error: null },
    ]);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });
    global.fetch = mockFetch;

    const { result } = renderHook(() => useProfiles({ status: "pending" }, c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.approveAll();
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/admin/approve-all",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer test-token",
        }),
      }),
    );
    // approveAll 请求不应该有 body（与单个 approve 不同）
    const callArg = mockFetch.mock.calls[0][1];
    expect(callArg).not.toHaveProperty("body");
  });

  it("approveAll 与 rejectAll 共享同一 batchKey 互斥：并发调用只有第一个执行", async () => {
    const c = mockClient([
      {
        data: [
          { id: "1", full_name: "张三", status: "pending" },
          { id: "2", full_name: "李四", status: "pending" },
        ],
        error: null,
      },
    ]);

    let fetchCallCount = 0;
    const mockFetch = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            fetchCallCount += 1;
            resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
          }, 100),
        ),
    );
    global.fetch = mockFetch;

    const { result } = renderHook(() => useProfiles({ status: "pending" }, c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // 并发调用 approveAll 和 rejectAll
    const [approveAllResult, rejectAllResult] = await act(async () => {
      return Promise.all([result.current.approveAll(), result.current.rejectAll()]);
    });

    // 只有第一个会成功，第二个被阻止（共享 batchKey）
    expect(fetchCallCount).toBe(1);
    // 第一个成功（approveAll），第二个被阻止（rejectAll）
    expect(approveAllResult).toBe(true);
    expect(rejectAllResult).toBe(false);
  });
});
