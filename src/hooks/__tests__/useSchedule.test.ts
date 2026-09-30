// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useSchedule } from "../useSchedule";

function mockClient<T>(responses: T[]) {
  let i = 0;
  // 记录所有链式查询调用（含参数），供断言查询条件使用
  const calls: string[] = [];
  const chain = (res: T) => {
    const record = (name: string, ...args: unknown[]) => {
      calls.push(`${name}(${args.map((a) => JSON.stringify(a)).join(", ")})`);
      return chain(res);
    };
    return {
      eq: (...args: unknown[]) => record("eq", ...args),
      in: (...args: unknown[]) => record("in", ...args),
      order: (...args: unknown[]) => record("order", ...args),
      limit: (...args: unknown[]) => record("limit", ...args),
      delete: (...args: unknown[]) => record("delete", ...args),
      // 写链上的 0 行检测（update/delete 之后接 .select("id")，Issue #368）
      select: (...args: unknown[]) => record("select", ...args),
      gte: (...args: unknown[]) => record("gte", ...args),
      lte: (...args: unknown[]) => record("lte", ...args),
      neq: (...args: unknown[]) => record("neq", ...args),
      is: (...args: unknown[]) => record("is", ...args),
      // 返回真正的 Promise
      then: (resolve: (v: T) => void, reject?: (e: Error) => void) =>
        Promise.resolve(res).then(resolve, reject),
    };
  };
  /** 写链有没有接 `.select(...)` —— 没有它就拿不回被影响的行（Issue #368） */
  const writeSelects: { table: string; selected: boolean }[] = [];
  /**
   * 写链（`update`/`delete` 之后）。**按真实 SDK 语义建模**：没接 `.select(...)` 就
   * 拿不到行、返回 `{ data: null }` —— 于是「去掉 `.select("id")`」会让走成功路径的
   * 用例由 true 变 false 而变红。
   */
  const writeChain = (table: string, res: T) => {
    let selected = false;
    const o: Record<string, unknown> = {};
    Object.assign(o, {
      eq: (...args: unknown[]) => {
        calls.push(`eq(${args.map((a) => JSON.stringify(a)).join(", ")})`);
        return o;
      },
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
    from: (table: string) => ({
      select: () => chain(responses[i++]),
      insert: () => chain(responses[i++]),
      update: () => ({ eq: () => writeChain(table, responses[i++]) }),
      delete: () => ({ eq: () => writeChain(table, responses[i++]) }),
    }),
    writeSelects,
    __calls: calls,
    /** 已发出的查询次数 —— 直接量「有没有多打一次往返」（如 0 行时不该重取） */
    __consumed: () => i,
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
      { data: [{ id: 1 }], error: null }, // schedules.delete .select("id") 命中 1 行
      { data: [], error: null }, // re-fetch
    ]);
    const { result } = renderHook(() => useSchedule(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.remove(1);
    });
    // 契约第 1 条：写链必须能拿回被影响的行（去掉 `.select("id")` 时这条会红）
    expect(c.writeSelects).toEqual([{ table: "schedules", selected: true }]);
    await waitFor(() => expect(result.current.data).toEqual([]));
  });

  it("update 命中 1 行 → true 并重取（成功路径不回归）", async () => {
    const c = mockClient([
      { data: [{ id: 1, title: "原标题" }], error: null }, // fetch
      { data: [{ id: 1 }], error: null }, // update .select("id") 命中 1 行
      { data: [{ id: 1, title: "新标题" }], error: null }, // re-fetch
    ]);
    const { result } = renderHook(() => useSchedule(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok = false;
    await act(async () => {
      ok = await result.current.update(1, { title: "新标题" });
    });
    expect(ok).toBe(true);
    expect(result.current.error).toBeNull();
    // 契约第 1 条：写链必须能拿回被影响的行（去掉 `.select("id")` 时这条会红）
    expect(c.writeSelects).toEqual([{ table: "schedules", selected: true }]);
    await waitFor(() => expect(result.current.data[0].title).toBe("新标题"));
  });

  it("update 0 行 → false + 可见 error，且不重取（不宣称成功）", async () => {
    const c = mockClient([
      { data: [{ id: 1, title: "原标题" }], error: null }, // fetch
      { data: [], error: null }, // update 命中 0 行（无 error 的假成功）
    ]);
    const { result } = renderHook(() => useSchedule(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok = true;
    await act(async () => {
      ok = await result.current.update(1, { title: "新标题" });
    });
    expect(ok).toBe(false);
    expect(result.current.error).toBe("没有匹配的记录，预约可能已被删除");
    // 首屏 fetch 与本次 update 各 1 次查询；0 行时不重取（重取会让「没变」看着像成功）
    expect((c as unknown as { __consumed: () => number }).__consumed()).toBe(2);
    expect(result.current.data[0].title).toBe("原标题");
  });

  it("remove 0 行 → false + 可见 error，且不重取（列表里那行必须留着）", async () => {
    const c = mockClient([
      { data: [{ id: 1, title: "预约" }], error: null }, // fetch
      { data: [], error: null }, // schedules.delete 命中 0 行（RLS 静默拒绝/并发已删）
    ]);
    const { result } = renderHook(() => useSchedule(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok = true;
    await act(async () => {
      ok = await result.current.remove(1);
    });
    expect(ok).toBe(false);
    expect(result.current.error).toBe("没有匹配的记录，预约可能已被删除");
    // 同步出口也必须是这句：调用方是在 await 之后的**同一个闭包**里取文案的，
    // 那时 `error` state 还没进闭包（见 hook 里 lastErrorRef 的注释）
    expect(result.current.getLastError()).toBe("没有匹配的记录，预约可能已被删除");
    expect(result.current.data).toHaveLength(1);
    // 同样不许重取：界面里那行必须留着（库里还在）
    expect((c as unknown as { __consumed: () => number }).__consumed()).toBe(2);
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

  // 冲突检测测试
  describe("checkConflict", () => {
    it("无冲突 - 正常路径", async () => {
      const c = mockClient([
        { data: [], error: null }, // initial fetch
        { data: [], error: null }, // schedules query
        { data: [], error: null }, // rehearsals query
      ]);
      const { result } = renderHook(() => useSchedule(c as never));
      await waitFor(() => expect(result.current.loading).toBe(false));

      const conflictResult = await act(async () => {
        return await result.current.checkConflict("2024-01-01", "14:00", "15:00");
      });

      expect(conflictResult).toBeNull();
    });

    it("与已有预约时间冲突", async () => {
      const c = mockClient([
        { data: [], error: null }, // initial fetch
        {
          data: [
            {
              id: 1,
              rehearsal_id: null, // 人工预约（rehearsal_id 为 null）
              start_time: "2024-01-01T14:30:00",
              end_time: "2024-01-01T15:30:00",
            },
          ],
          error: null,
        }, // schedules query - overlapping
        { data: [], error: null }, // rehearsals query
      ]);
      const { result } = renderHook(() => useSchedule(c as never));
      await waitFor(() => expect(result.current.loading).toBe(false));

      const conflictResult = await act(async () => {
        return await result.current.checkConflict("2024-01-01", "14:00", "15:00");
      });

      expect(conflictResult).toBe("该时间段已有其他预约");
    });

    it("与已有排练时间冲突", async () => {
      const c = mockClient([
        { data: [], error: null }, // initial fetch
        { data: [], error: null }, // schedules query
        {
          data: [
            {
              id: 1,
              start_time: "2024-01-01T14:30:00",
              end_time: "2024-01-01T15:30:00",
            },
          ],
          error: null,
        }, // rehearsals query - overlapping
      ]);
      const { result } = renderHook(() => useSchedule(c as never));
      await waitFor(() => expect(result.current.loading).toBe(false));

      const conflictResult = await act(async () => {
        return await result.current.checkConflict("2024-01-01", "14:00", "15:00");
      });

      expect(conflictResult).toBe("该时间段已有排练安排");
    });

    it("编辑排练时排除自身 - 边界值", async () => {
      // 当编辑排练 id=5 时，数据库查询会通过 .neq("id", 5) 过滤掉该排练
      // 所以 mock 返回空数据，表示已正确过滤
      const c = mockClient([
        { data: [], error: null }, // initial fetch
        { data: [], error: null }, // schedules query
        { data: [], error: null }, // rehearsals query - filtered by neq(id, 5), so empty
      ]);
      const { result } = renderHook(() => useSchedule(c as never));
      await waitFor(() => expect(result.current.loading).toBe(false));

      const conflictResult = await act(async () => {
        return await result.current.checkConflict("2024-01-01", "14:00", "15:00", 5);
      });

      expect(conflictResult).toBeNull();
    });

    it("编辑排练时 - 影子预约不误报（schedules 分支过滤 rehearsal_id 非空行）", async () => {
      // 编辑排练 id=5：触发器为该排练生成的影子预约（rehearsal_id=5，时间与排练相同）在
      // 数据库层被 .is("rehearsal_id", null) 过滤，所以 mock 的 schedules 查询返回空
      // （模拟过滤后的结果）；rehearsals 查询通过 .neq("id", 5) 排除自身，同样为空
      const c = mockClient([
        { data: [], error: null }, // initial fetch
        { data: [], error: null }, // schedules query - 影子预约已被 is 过滤
        { data: [], error: null }, // rehearsals query - 编辑中的排练已被 neq 过滤
      ]);
      const { result } = renderHook(() => useSchedule(c as never));
      await waitFor(() => expect(result.current.loading).toBe(false));

      const conflictResult = await act(async () => {
        return await result.current.checkConflict("2024-01-01", "14:00", "15:00", 5);
      });

      expect(conflictResult).toBeNull();
    });

    it("创建人工预约与排练重叠 - 返回排练冲突文案", async () => {
      // 当天存在排练及其影子预约：影子预约被 .is("rehearsal_id", null) 过滤（mock schedules 为空），
      // 不会先命中 schedules 分支的「该时间段已有其他预约」；rehearsals 分支命中排练，
      // 文案准确为「该时间段已有排练安排」
      const c = mockClient([
        { data: [], error: null }, // initial fetch
        { data: [], error: null }, // schedules query - 影子预约已被 is 过滤
        {
          data: [
            {
              id: 5,
              start_time: "2024-01-01T14:30:00",
              end_time: "2024-01-01T15:30:00",
            },
          ],
          error: null,
        }, // rehearsals query - overlapping
      ]);
      const { result } = renderHook(() => useSchedule(c as never));
      await waitFor(() => expect(result.current.loading).toBe(false));

      const conflictResult = await act(async () => {
        return await result.current.checkConflict("2024-01-01", "14:00", "15:00");
      });

      expect(conflictResult).toBe("该时间段已有排练安排");
    });

    it('schedules 查询带 is("rehearsal_id", null) 过滤影子预约', async () => {
      const c = mockClient([
        { data: [], error: null }, // initial fetch
        { data: [], error: null }, // schedules query
        { data: [], error: null }, // rehearsals query
      ]);
      const { result } = renderHook(() => useSchedule(c as never));
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.checkConflict("2024-01-01", "14:00", "15:00");
      });

      // 只有 schedules 查询带 is 过滤；rehearsals 查询只有 gte/lte/neq
      const calls = (c as unknown as { __calls: string[] }).__calls;
      expect(calls.filter((call) => call.startsWith("is("))).toEqual(['is("rehearsal_id", null)']);
    });

    it("预约查询失败返回错误", async () => {
      const c = mockClient([
        { data: [], error: null }, // initial fetch
        { data: null, error: { message: "schedule error" } }, // schedules query error
      ]);
      const { result } = renderHook(() => useSchedule(c as never));
      await waitFor(() => expect(result.current.loading).toBe(false));

      const conflictResult = await act(async () => {
        return await result.current.checkConflict("2024-01-01", "14:00", "15:00");
      });

      expect(conflictResult).toBe("查询预约失败");
    });

    it("排练查询失败返回错误", async () => {
      const c = mockClient([
        { data: [], error: null }, // initial fetch
        { data: [], error: null }, // schedules query
        { data: null, error: { message: "rehearsal error" } }, // rehearsals query error
      ]);
      const { result } = renderHook(() => useSchedule(c as never));
      await waitFor(() => expect(result.current.loading).toBe(false));

      const conflictResult = await act(async () => {
        return await result.current.checkConflict("2024-01-01", "14:00", "15:00");
      });

      expect(conflictResult).toBe("查询排练安排失败");
    });

    it("时间边界不重叠 - 新预约开始等于已有结束", async () => {
      const c = mockClient([
        { data: [], error: null }, // initial fetch
        {
          data: [
            {
              id: 1,
              rehearsal_id: null, // 人工预约（rehearsal_id 为 null）
              start_time: "2024-01-01T13:00:00",
              end_time: "2024-01-01T14:00:00",
            },
          ],
          error: null,
        }, // schedules query
        { data: [], error: null }, // rehearsals query
      ]);
      const { result } = renderHook(() => useSchedule(c as never));
      await waitFor(() => expect(result.current.loading).toBe(false));

      const conflictResult = await act(async () => {
        return await result.current.checkConflict("2024-01-01", "14:00", "15:00");
      });

      expect(conflictResult).toBeNull();
    });

    it("时间边界不重叠 - 新预约结束等于已有开始", async () => {
      const c = mockClient([
        { data: [], error: null }, // initial fetch
        {
          data: [
            {
              id: 1,
              rehearsal_id: null, // 人工预约（rehearsal_id 为 null）
              start_time: "2024-01-01T15:00:00",
              end_time: "2024-01-01T16:00:00",
            },
          ],
          error: null,
        }, // schedules query
        { data: [], error: null }, // rehearsals query
      ]);
      const { result } = renderHook(() => useSchedule(c as never));
      await waitFor(() => expect(result.current.loading).toBe(false));

      const conflictResult = await act(async () => {
        return await result.current.checkConflict("2024-01-01", "14:00", "15:00");
      });

      expect(conflictResult).toBeNull();
    });
  });
});
