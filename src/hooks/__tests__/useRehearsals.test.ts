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
    select: () => chain(res),
    single: () => res,
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
      { data: { id: 1 }, error: null }, // insert (returns id via .select("id").single())
      { data: [{ id: 1, repertoire: "新排练" }], error: null }, // re-fetch
    ]);
    const { result } = renderHook(() => useRehearsals(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.create({ repertoire: "新排练" });
    });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
  });

  it("update 不写 updated_at（由 DB 触发器统一写入，避免客户端时钟漂移）", async () => {
    // 捕获 update 的 payload，验证 updated_at 不再由客户端写入
    const calls: Record<string, unknown>[] = [];
    const chain = (res: unknown) => ({
      eq: () => chain(res),
      order: () => chain(res),
      select: () => chain(res),
      single: () => res,
      then: (resolve: (v: unknown) => void) => resolve(res),
    });
    const capturingClient = {
      from: () => ({
        select: () => chain({ data: [], error: null }),
        insert: () => chain({ data: null, error: null }),
        update: (payload: Record<string, unknown>) => {
          calls.push(payload);
          return { eq: () => chain({ data: null, error: null }) };
        },
        delete: () => ({ eq: () => chain({ data: null, error: null }) }),
      }),
    };
    const { result } = renderHook(() => useRehearsals(capturingClient as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.update(1, { repertoire: "新曲目" });
    });
    expect(result.current.error).toBeNull();
    expect(calls).toHaveLength(1);
    const payload = calls[0];
    expect(payload.repertoire).toBe("新曲目");
    // updated_at 不再由客户端写入（DB 触发器统一设置，与 created_at 同源时钟）
    expect(payload.updated_at).toBeUndefined();
  });

  it("fetch 返回的排练行包含 updated_at", async () => {
    const c = mockClient([
      {
        data: [{ id: 1, repertoire: "柴四", updated_at: "2026-08-15T10:00:00.000Z" }],
        error: null,
      },
    ]);
    const { result } = renderHook(() => useRehearsals(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data[0].updated_at).toBe("2026-08-15T10:00:00.000Z");
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
