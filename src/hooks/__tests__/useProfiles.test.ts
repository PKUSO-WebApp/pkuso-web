// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
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
  };
}

describe("useProfiles", () => {
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
      { data: [{ id: "1", full_name: "李四", status: "pending" }], error: null }, // fetch
      { error: null }, // update approve
    ]);
    const { result } = renderHook(() => useProfiles({ status: "pending" }, c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toHaveLength(1);

    await act(async () => {
      await result.current.approve("1");
    });
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
});
