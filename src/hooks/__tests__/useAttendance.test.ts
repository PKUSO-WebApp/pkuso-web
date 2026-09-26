// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAttendance } from "../useAttendance";

function mockClient<T>(responses: T[]) {
  let i = 0;
  const c = (r: T) => ({
    eq: () => c(r),
    in: () => c(r),
    select: () => c(r),
    order: () => c(r),
    then: (resolve: (v: T) => void) => resolve(r),
  });
  return {
    from: () => ({
      select: () => c(responses[i++]),
      upsert: () => c(responses[i++]),
      insert: () => c(responses[i++]),
      // update().eq().select("id") 的 0 行检测链（useAttendance.updateStatus）
      update: () => ({ eq: () => c(responses[i++]) }),
    }),
  };
}

/** 可控制返回时机的 mock：每次 .select() 同步登记一个 deferred，由测试决定谁先 resolve */
function raceClient<T>() {
  const defs: { promise: Promise<T>; resolve: (v: T) => void }[] = [];
  const mk = (d: { promise: Promise<T> }): unknown => ({
    eq: () => mk(d),
    in: () => mk(d),
    select: () => mk(d),
    order: () => mk(d),
    then: (resolve: (v: T) => void, reject?: (e: unknown) => void) =>
      d.promise.then(resolve, reject),
  });
  return {
    client: {
      from: () => ({
        select: () => {
          let resolve!: (v: T) => void;
          const promise = new Promise<T>((r) => {
            resolve = r;
          });
          const d = { promise, resolve };
          defs.push(d);
          return mk(d);
        },
      }),
    },
    defs,
  };
}

describe("useAttendance", () => {
  it("初始 loading 为 true（map 未就绪，调用方据此抑制首屏状态渲染）", () => {
    const { result } = renderHook(() => useAttendance(mockClient([]) as never));
    expect(result.current.loading).toBe(true);
  });

  it("fetchMyAttendances 期间 loading=true，完成后复位 false", async () => {
    const c = mockClient([{ data: [], error: null }]);
    const { result } = renderHook(() => useAttendance(c as never));
    const p = result.current.fetchMyAttendances("user-1", [1, 2]);
    expect(result.current.loading).toBe(true);
    await act(async () => {
      await p;
    });
    expect(result.current.loading).toBe(false);
  });

  it("fetchMyAttendances 空 ids 时标记就绪（loading 复位 false）", async () => {
    const { result } = renderHook(() => useAttendance(mockClient([]) as never));
    await act(async () => {
      await result.current.fetchMyAttendances("user-1", []);
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.map).toEqual({});
  });

  it("fetchMyAttendances 加载我的考勤（含 sign_in_time，缺省归一化为 null）", async () => {
    const c = mockClient([
      {
        data: [
          { rehearsal_id: 1, status: "present", sign_in_time: null },
          { rehearsal_id: 2, status: "absent", sign_in_time: "2026-08-15T20:05:00" },
        ],
        error: null,
      },
    ]);
    const { result } = renderHook(() => useAttendance(c as never));
    await act(async () => {
      await result.current.fetchMyAttendances("user-1", [1, 2]);
    });
    expect(result.current.map).toEqual({
      1: { status: "present", sign_in_time: null },
      2: { status: "absent", sign_in_time: "2026-08-15T20:05:00" },
    });
  });

  it("fetchMyAttendances 响应缺 sign_in_time 字段时归一化为 null", async () => {
    const c = mockClient([{ data: [{ rehearsal_id: 1, status: "present" }], error: null }]);
    const { result } = renderHook(() => useAttendance(c as never));
    await act(async () => {
      await result.current.fetchMyAttendances("user-1", [1, 2]);
    });
    expect(result.current.map).toEqual({ 1: { status: "present", sign_in_time: null } });
  });

  it("fetchByRehearsal 查看排练考勤", async () => {
    const c = mockClient([{ data: [{ id: 1, user_id: "u1", status: "present" }], error: null }]);
    const { result } = renderHook(() => useAttendance(c as never));
    let rows: unknown[] = [];
    await act(async () => {
      rows = (await result.current.fetchByRehearsal(1)) || [];
    });
    expect(rows).toHaveLength(1);
  });

  it("fetchByRehearsal 竞态：先发后返的过期响应返回 null，且不覆盖新一轮的名单/loading", async () => {
    const r = raceClient<{ data: unknown; error: null }>();
    const { result } = renderHook(() => useAttendance(r.client as never));

    let stale: unknown = "未赋值";
    let fresh: unknown = "未赋值";
    let p1!: Promise<unknown>;
    let p2!: Promise<unknown>;
    // .select() 在 await 之前同步执行，故两轮 deferred 已就位
    act(() => {
      p1 = result.current.fetchByRehearsal(1); // 第 1 轮（旧）
      p2 = result.current.fetchByRehearsal(2); // 第 2 轮（新）
    });
    expect(r.defs).toHaveLength(2);

    // 新一轮先返回 → 写入 B 场名单
    await act(async () => {
      r.defs[1].resolve({ data: [{ id: 2, user_id: "u2", status: "present" }], error: null });
      fresh = await p2;
    });
    // 旧一轮后返回 → 必须整体作废
    await act(async () => {
      r.defs[0].resolve({ data: [{ id: 1, user_id: "u1", status: "absent" }], error: null });
      stale = await p1;
    });

    expect(stale).toBeNull(); // 返回值即契约：null = 过期，调用方据此忽略
    expect(fresh).toHaveLength(1);
    expect(result.current.list).toEqual([{ id: 2, user_id: "u2", status: "present" }]);
    expect(result.current.loading).toBe(false); // 终态：新一轮已完成，loading 正常复位
  });

  it("fetchByRehearsal 竞态：过期响应先返回时不改动 loading 与名单（新一轮仍在进行）", async () => {
    const r = raceClient<{ data: unknown; error: null }>();
    const { result } = renderHook(() => useAttendance(r.client as never));

    let p1!: Promise<unknown>;
    act(() => {
      p1 = result.current.fetchByRehearsal(1); // 第 1 轮（旧）
      void result.current.fetchByRehearsal(2); // 第 2 轮（新），故意留在进行中
    });
    expect(r.defs).toHaveLength(2);

    // 旧一轮先返回：新一轮尚未完成，过期响应不得把 loading 置 false、也不得写入名单
    await act(async () => {
      r.defs[0].resolve({ data: [{ id: 1, user_id: "u1", status: "absent" }], error: null });
      await p1;
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.list).toEqual([]);
  });

  it("upsert 签到成功", async () => {
    const c = mockClient([{ error: null }]);
    const { result } = renderHook(() => useAttendance(c as never));
    let err: string | null = null;
    await act(async () => {
      err = await result.current.upsert([{ rehearsal_id: 1, user_id: "u1", status: "present" }]);
    });
    expect(err).toBeNull();
  });

  it("upsert 失败返回错误信息", async () => {
    const c = mockClient([{ error: { message: "冲突" } }]);
    const { result } = renderHook(() => useAttendance(c as never));
    const err = await act(() =>
      result.current.upsert([{ rehearsal_id: 1, user_id: "u1", status: "present" }]),
    );
    expect(err).toBe("冲突");
  });

  it("updateStatus 命中 1 行返回 null（成功语义，可发通知）", async () => {
    const c = mockClient([{ data: [{ id: 1 }], error: null }]);
    const { result } = renderHook(() => useAttendance(c as never));
    const err = await act(() => result.current.updateStatus(1, "u1", "present"));
    expect(err).toBeNull();
  });

  it("updateStatus 0 行（级联删除/RLS 静默失败）返回错误语义（不得发通知）", async () => {
    const c = mockClient([{ data: [], error: null }]);
    const { result } = renderHook(() => useAttendance(c as never));
    const err = await act(() => result.current.updateStatus(1, "u1", "present"));
    expect(err).not.toBeNull();
    expect(err).toContain("考勤行不存在");
  });
});
