// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useRehearsals } from "../useRehearsals";

function mockClient<T>(responses: T[]) {
  let i = 0;
  const chain = (res: T) => ({
    eq: () => chain(res),
    in: () => chain(res),
    order: () => chain(res),
    limit: () => chain(res),
    delete: () => chain(res),
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

describe("useRehearsals", () => {
  it("fetch 排练列表", async () => {
    const c = mockClient([{ data: [{ id: 1, repertoire: "柴四" }], error: null }]);
    const { result } = renderHook(() => useRehearsals(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toHaveLength(1);
  });

  it("fetch 失败", async () => {
    const c = mockClient([{ data: null, error: { message: "err" } }]);
    const { result } = renderHook(() => useRehearsals(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("err");
  });

  it("create + re-fetch", async () => {
    const c = mockClient([
      { data: [], error: null }, // initial fetch
      { data: null, error: null }, // insert
      { data: [{ id: 1, repertoire: "新排练" }], error: null }, // re-fetch
    ]);
    const { result } = renderHook(() => useRehearsals(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.create({ repertoire: "新排练" });
    });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
  });

  it("remove 删除并重取", async () => {
    const c = mockClient([
      { data: [{ id: 1 }], error: null }, // fetch
      { data: null, error: null }, // attendances.delete
      { data: null, error: null }, // rehearsals.delete
      { data: [], error: null }, // re-fetch
    ]);
    const { result } = renderHook(() => useRehearsals(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.remove(1);
    });
    await waitFor(() => expect(result.current.data).toEqual([]));
  });
});
