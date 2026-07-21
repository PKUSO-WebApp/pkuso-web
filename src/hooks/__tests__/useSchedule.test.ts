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
    neq: () => chain(res),
    // 返回真正的 Promise
    then: (resolve: (v: T) => void, reject?: (e: Error) => void) =>
      Promise.resolve(res).then(resolve, reject),
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
