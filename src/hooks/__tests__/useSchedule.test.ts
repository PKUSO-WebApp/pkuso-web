// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useSchedule } from "../useSchedule";

function mockClient<T>(responses: T[]) {
  let i = 0;
  const chain = (res: T) => ({
    eq: () => chain(res),
    in: () => chain(res),
    order: () => chain(res),
    limit: () => chain(res),
    delete: () => chain(res),
    gte: () => chain(res),
    lte: () => chain(res),
    then: (resolve: (v: T) => void) => resolve(res),
  });
  return {
    from: () => ({
      select: () => chain(responses[i++]),
      insert: () => chain(responses[i++]),
      update: () => ({ eq: () => chain(responses[i++]) }),
      delete: () => ({ eq: () => chain(responses[i++]) }),
    }),
  };
}

describe("useSchedule", () => {
  it("fetch 预约列表", async () => {
    const c = mockClient([{ data: [{ id: 1, title: "排练房预约" }], error: null }]);
    const { result } = renderHook(() => useSchedule(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toHaveLength(1);
  });

  it("fetch 失败", async () => {
    const c = mockClient([{ data: null, error: { message: "err" } }]);
    const { result } = renderHook(() => useSchedule(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("err");
  });

  it("create + re-fetch", async () => {
    const c = mockClient([
      { data: [], error: null }, // initial fetch
      { data: null, error: null }, // insert
      { data: [{ id: 1, title: "新预约" }], error: null }, // re-fetch
    ]);
    const { result } = renderHook(() => useSchedule(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.create({ title: "新预约" });
    });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
  });

  it("remove 删除并重取", async () => {
    const c = mockClient([
      { data: [{ id: 1 }], error: null }, // fetch
      { data: null, error: null }, // schedules.delete
      { data: [], error: null }, // re-fetch
    ]);
    const { result } = renderHook(() => useSchedule(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.remove(1);
    });
    await waitFor(() => expect(result.current.data).toEqual([]));
  });

  it("按日期筛选 fetch", async () => {
    const c = mockClient([
      { data: [{ id: 1, title: "今日预约" }], error: null }, // initial fetch
      { data: [{ id: 2, title: "明日预约" }], error: null }, // fetch with date filter
    ]);
    const { result } = renderHook(() => useSchedule(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data[0].title).toBe("今日预约");

    await act(async () => {
      await result.current.fetch("2024-01-02");
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data[0].title).toBe("明日预约");
  });
});
