// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useAnnouncements } from "../useAnnouncements";

function mockClient<T>(responses: T[]) {
  let i = 0;
  const c = (r: T) => ({
    eq: () => c(r),
    order: () => c(r),
    limit: () => c(r),
    then: (resolve: (v: T) => void) => resolve(r),
  });
  return {
    from: () => ({ select: () => c(responses[i++]), insert: () => c(responses[i++]) }),
    auth: {
      getSession: () => Promise.resolve({ data: { session: { access_token: "test-token" } } }),
    },
  };
}

describe("useAnnouncements", () => {
  // 保存原始 fetch
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("fetch 获取最新公告", async () => {
    const c = mockClient([{ data: [{ id: "1", content: "测试" }], error: null }]);
    const { result } = renderHook(() => useAnnouncements(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toMatchObject({ content: "测试" });
  });

  it("fetch 失败", async () => {
    const c = mockClient([{ data: null, error: { message: "err" } }]);
    const { result } = renderHook(() => useAnnouncements(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("err");
  });

  it("无公告", async () => {
    const c = mockClient([{ data: [], error: null }]);
    const { result } = renderHook(() => useAnnouncements(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
  });

  it("publish 成功", async () => {
    const c = mockClient([{ data: [], error: null }, { error: null }]);
    const { result } = renderHook(() => useAnnouncements(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const ok = await act(() => result.current.publish("新公告"));
    expect(ok).toBe(true);
  });

  it("publish 失败", async () => {
    const c = mockClient([{ data: [], error: null }, { error: { message: "失败" } }]);
    const { result } = renderHook(() => useAnnouncements(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const ok = await act(() => result.current.publish("x"));
    expect(ok).toBe(false);
  });

  it("fetchAll 获取所有公告", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            { id: "1", content: "公告1" },
            { id: "2", content: "公告2" },
          ],
        }),
    });
    global.fetch = mockFetch;

    const c = mockClient([{ data: [], error: null }]);
    const { result } = renderHook(() => useAnnouncements(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.fetchAll());

    await waitFor(() => expect(result.current.loadingAll).toBe(false));
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/admin/announcement",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: expect.stringMatching(/^Bearer /),
        }),
      }),
    );
    expect(result.current.allData).toHaveLength(2);
    expect(result.current.allData[0].content).toBe("公告1");
  });

  it("fetchAll 获取失败", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "获取失败" }),
    });
    global.fetch = mockFetch;

    const c = mockClient([{ data: [], error: null }]);
    const { result } = renderHook(() => useAnnouncements(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.fetchAll());

    await waitFor(() => expect(result.current.loadingAll).toBe(false));
    expect(result.current.error).toBe("获取失败");
    expect(result.current.allData).toEqual([]);
  });

  it("remove 删除公告成功", async () => {
    // 第一次 fetchAll 返回公告列表，第二次 DELETE 返回成功
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              { id: "1", content: "公告1", created_at: "2024-01-01" },
              { id: "2", content: "公告2", created_at: "2024-01-02" },
            ],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });
    global.fetch = mockFetch;

    const c = mockClient([{ data: [], error: null }]);
    const { result } = renderHook(() => useAnnouncements(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // 通过 fetchAll 获取初始数据
    await act(() => result.current.fetchAll());
    await waitFor(() => expect(result.current.loadingAll).toBe(false));

    expect(result.current.allData).toHaveLength(2);

    // 执行删除
    const ok = await act(() => result.current.remove("1"));

    expect(ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/admin/announcement",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: expect.stringMatching(/^Bearer /),
        }),
        body: JSON.stringify({ id: "1" }),
      }),
    );
    expect(result.current.allData).toHaveLength(1);
    expect(result.current.allData[0].id).toBe("2");
  });

  it("remove 删除公告失败", async () => {
    // 第一次 fetchAll 返回公告列表，第二次 DELETE 返回失败
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ id: "1", content: "公告1", created_at: "2024-01-01" }],
          }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: "删除失败" }),
      });
    global.fetch = mockFetch;

    const c = mockClient([{ data: [], error: null }]);
    const { result } = renderHook(() => useAnnouncements(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // 通过 fetchAll 获取初始数据
    await act(() => result.current.fetchAll());
    await waitFor(() => expect(result.current.loadingAll).toBe(false));

    expect(result.current.allData).toHaveLength(1);

    // 执行删除
    const ok = await act(() => result.current.remove("1"));

    expect(ok).toBe(false);
    expect(result.current.error).toBe("删除失败");
    expect(result.current.allData).toHaveLength(1); // 数据应该保持不变
  });

  it("remove 防重复提交保护", async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      // 模拟慢速请求
      await new Promise((resolve) => setTimeout(resolve, 100));
      return {
        ok: true,
        json: () => Promise.resolve({ success: true }),
      };
    });
    global.fetch = mockFetch;

    const c = mockClient([{ data: [], error: null }]);
    const { result } = renderHook(() => useAnnouncements(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // 同时调用两次（模拟快速连续点击）
    const [ok1, ok2] = await act(() =>
      Promise.all([result.current.remove("1"), result.current.remove("1")]),
    );

    expect(ok1).toBe(true);
    expect(ok2).toBe(false); // 第二次应该被阻止

    // 等待第一次请求完成
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(callCount).toBe(1); // 只应该调用一次
  });

  it("update 更新公告成功", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ id: "1", content: "原始内容", created_at: "2024-01-01" }],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });
    global.fetch = mockFetch;

    const c = mockClient([{ data: [], error: null }]);
    const { result } = renderHook(() => useAnnouncements(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // 通过 fetchAll 获取初始数据
    await act(() => result.current.fetchAll());
    await waitFor(() => expect(result.current.loadingAll).toBe(false));

    expect(result.current.allData).toHaveLength(1);
    expect(result.current.allData[0].content).toBe("原始内容");

    // 执行更新
    const ok = await act(() => result.current.update("1", "更新后的内容"));

    expect(ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/admin/announcement",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: expect.stringMatching(/^Bearer /),
        }),
        body: JSON.stringify({ id: "1", content: "更新后的内容" }),
      }),
    );
    expect(result.current.allData).toHaveLength(1);
    expect(result.current.allData[0].content).toBe("更新后的内容");
  });

  it("update 更新公告失败", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ id: "1", content: "原始内容", created_at: "2024-01-01" }],
          }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: "更新失败" }),
      });
    global.fetch = mockFetch;

    const c = mockClient([{ data: [], error: null }]);
    const { result } = renderHook(() => useAnnouncements(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // 通过 fetchAll 获取初始数据
    await act(() => result.current.fetchAll());
    await waitFor(() => expect(result.current.loadingAll).toBe(false));

    expect(result.current.allData).toHaveLength(1);

    // 执行更新
    const ok = await act(() => result.current.update("1", "更新后的内容"));

    expect(ok).toBe(false);
    expect(result.current.error).toBe("更新失败");
    expect(result.current.allData[0].content).toBe("原始内容"); // 数据应该保持不变
  });

  it("update 防重复提交保护", async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      // 模拟慢速请求
      await new Promise((resolve) => setTimeout(resolve, 100));
      return {
        ok: true,
        json: () => Promise.resolve({ success: true }),
      };
    });
    global.fetch = mockFetch;

    const c = mockClient([{ data: [], error: null }]);
    const { result } = renderHook(() => useAnnouncements(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // 同时调用两次（模拟快速连续点击）
    const [ok1, ok2] = await act(() =>
      Promise.all([result.current.update("1", "内容1"), result.current.update("1", "内容2")]),
    );

    expect(ok1).toBe(true);
    expect(ok2).toBe(false); // 第二次应该被阻止

    // 等待第一次请求完成
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(callCount).toBe(1); // 只应该调用一次
  });
});
