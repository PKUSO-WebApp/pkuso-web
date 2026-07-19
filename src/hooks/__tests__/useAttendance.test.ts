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
    }),
  };
}

describe("useAttendance", () => {
  it("fetchMyAttendances 加载我的考勤", async () => {
    const c = mockClient([{ data: [{ rehearsal_id: 1, status: "present" }], error: null }]);
    const { result } = renderHook(() => useAttendance(c as never));
    await act(async () => {
      await result.current.fetchMyAttendances("user-1", [1, 2]);
    });
    expect(result.current.map).toEqual({ 1: { status: "present" } });
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
});
