// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useRehearsals } from "../useRehearsals";

function mockClient<T>(responses: T[]) {
  let i = 0;
  /** 依次记录每次 `from(table)` 的表名 —— 用来断言「哪个副作用跑没跑、按什么顺序跑」 */
  const tables: string[] = [];
  /** 写链有没有接 `.select(...)` —— 没有它就拿不回被影响的行（Issue #368） */
  const writeSelects: { table: string; selected: boolean }[] = [];
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
  /**
   * 写链（`update`/`delete` 之后）。**按真实 SDK 语义建模**：没接 `.select(...)` 就
   * 拿不到行、返回 `{ data: null }` —— 于是「去掉 `.select("id")`」会让走成功路径的
   * 用例由 true 变 false 而变红。
   */
  const writeChain = (table: string, res: T) => {
    let selected = false;
    const o: Record<string, unknown> = {};
    const self = () => o;
    Object.assign(o, {
      eq: self,
      select: () => {
        selected = true;
        return o;
      },
      then: (resolve: (v: unknown) => void) => {
        writeSelects.push({ table, selected });
        return resolve(selected ? res : { data: null, error: null });
      },
    });
    return o;
  };
  return {
    from: (table: string) => {
      tables.push(table);
      return {
        select: () => chain(responses[i++]),
        insert: () => chain(responses[i++]),
        update: () => ({ eq: () => writeChain(table, responses[i++]) }),
        delete: () => ({ eq: () => writeChain(table, responses[i++]) }),
      };
    },
    tables,
    writeSelects,
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
    /** 写链：没接 `.select(...)` 就拿不到行 ⇒ 走 0 行分支（与真实 SDK 同语义） */
    const writeChain = (res: unknown) => {
      let selected = false;
      const o: Record<string, unknown> = {};
      const self = () => o;
      Object.assign(o, {
        eq: self,
        select: () => {
          selected = true;
          return o;
        },
        then: (resolve: (v: unknown) => void) =>
          resolve(selected ? res : { data: null, error: null }),
      });
      return o;
    };
    const capturingClient = {
      from: () => ({
        select: () => chain({ data: [], error: null }),
        insert: () => chain({ data: null, error: null }),
        update: (payload: Record<string, unknown>) => {
          calls.push(payload);
          // 命中 1 行：0 行检测（Issue #368）之后，不命中会走 false 分支
          return { eq: () => writeChain({ data: [{ id: 1 }], error: null }) };
        },
        delete: () => ({ eq: () => writeChain({ data: null, error: null }) }),
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

  it("update 0 行 → 返回 false 并置可见 error，且不重取（不宣称成功）", async () => {
    const c = mockClient([
      { data: [{ id: 1, repertoire: "柴四" }], error: null }, // fetch
      { data: [], error: null }, // update .select("id") 命中 0 行（无 error 的假成功）
    ]);
    const { result } = renderHook(() => useRehearsals(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok = true;
    await act(async () => {
      ok = await result.current.update(1, { repertoire: "新曲目" });
    });
    expect(ok).toBe(false);
    expect(result.current.error).toBe("没有匹配的记录，排练可能已被删除");
    // 首屏 fetch 1 次 + 本次 update 1 次；0 行时不重取（重取会让「没变」看着像成功）
    expect(c.tables.filter((t) => t === "rehearsals")).toHaveLength(2);
  });

  it("remove 命中 1 行 → 先删排练、再清考勤，最后重取（副作用都在检测之后）", async () => {
    const c = mockClient([
      { data: [{ id: 1 }], error: null }, // fetch
      { data: [{ id: 1 }], error: null }, // rehearsals.delete .select("id") 命中 1 行
      { data: [{ id: 9 }], error: null }, // attendances.delete（CASCADE 前还有考勤）
      { data: [], error: null }, // re-fetch
    ]);
    const { result } = renderHook(() => useRehearsals(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok = false;
    await act(async () => {
      ok = await result.current.remove(1);
    });
    expect(ok).toBe(true);
    // 顺序即契约：删排练（含 0 行检测）必须排在清考勤之前
    expect(c.tables).toEqual(["rehearsals", "rehearsals", "attendances", "rehearsals"]);
    // `remove` 里的**两条**写链都要能拿回被影响的行：删排练那条、清考勤那条
    expect(c.writeSelects).toEqual([
      { table: "rehearsals", selected: true },
      { table: "attendances", selected: true },
    ]);
    await waitFor(() => expect(result.current.data).toEqual([]));
  });

  it("remove 0 行 → 返回 false + 可见 error，**且一行副作用都没跑**（不删考勤、不重取）", async () => {
    const c = mockClient([
      { data: [{ id: 1, repertoire: "柴四" }], error: null }, // fetch
      { data: [], error: null }, // rehearsals.delete 命中 0 行（RLS 静默拒绝/并发已删）
    ]);
    const { result } = renderHook(() => useRehearsals(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok = true;
    await act(async () => {
      ok = await result.current.remove(1);
    });
    expect(ok).toBe(false);
    expect(result.current.error).toBe("没有匹配的记录，排练可能已被删除");
    // 同步出口也必须是这句：调用方是在 await 之后的**同一个闭包**里取文案的，
    // 那时 `error` state 还没进闭包（见 hook 里 lastErrorRef 的注释）
    expect(result.current.getLastError()).toBe("没有匹配的记录，排练可能已被删除");
    // 附 :删除侧效应的守卫——0 行检测之前不许动考勤（usePosts.remove 的同款顺序）
    expect(c.tables).not.toContain("attendances");
    // 也不许重取：界面里那行必须留着（库里还在）
    expect(c.tables.filter((t) => t === "rehearsals")).toHaveLength(2);
    expect(result.current.data).toHaveLength(1);
  });

  it("remove：考勤清理命中 0 行不算失败（CASCADE 已带走，是合法结果）", async () => {
    const c = mockClient([
      { data: [{ id: 1 }], error: null }, // fetch
      { data: [{ id: 1 }], error: null }, // rehearsals.delete 命中 1 行
      { data: [], error: null }, // attendances.delete 0 行 —— CASCADE 已经删过了
      { data: [], error: null }, // re-fetch
    ]);
    const { result } = renderHook(() => useRehearsals(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok = false;
    await act(async () => {
      ok = await result.current.remove(1);
    });
    // `attendances.rehearsal_id` 是 ON DELETE CASCADE（prod 与 dev 都核过，见 hook 里那段
    // 注释），排练删掉后这里**本来就**是 0 行。判据是这条 DELETE 的意图：它是
    // 「让这些子行不存在」的**幂等**清理，0 行 == 目标状态已达成 —— 当失败处理会让
    // 「删除一场没有考勤记录的排练」永远报错。
    // 链 .select("id") 是为了把 error 暴露出来（原写法连 error 都没接），不是要求 0 行判失败。
    expect(ok).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("remove：考勤清理报错不改判结果（主操作已成功，同 usePosts 的附件清理）", async () => {
    const c = mockClient([
      { data: [{ id: 1 }], error: null }, // fetch
      { data: [{ id: 1 }], error: null }, // rehearsals.delete 命中 1 行
      { data: null, error: { message: "attendances denied" } }, // 考勤清理失败
      { data: [], error: null }, // re-fetch
    ]);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useRehearsals(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok = false;
    await act(async () => {
      ok = await result.current.remove(1);
    });
    expect(ok).toBe(true);
    expect(result.current.error).toBeNull();
    expect(err.mock.calls.flat().join(" ")).toContain("清理考勤失败");
    err.mockRestore();
  });
});
