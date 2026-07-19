// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
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
  };
}

describe("useAnnouncements", () => {
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
});
