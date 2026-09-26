// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAttendanceEditor } from "../useAttendanceEditor";
import type { RehearsalRow } from "@/types/database";

const mocks = vi.hoisted(() => ({
  mockFetchByRehearsal: vi.fn(),
  mockUpdateStatus: vi.fn(),
  mockInsert: vi.fn(),
}));

vi.mock("@/hooks/useAttendance", () => ({
  useAttendance: () => ({
    map: {},
    list: [],
    loading: false,
    fetchMyAttendances: vi.fn(),
    fetchByRehearsal: mocks.mockFetchByRehearsal,
    upsert: vi.fn(),
    updateStatus: mocks.mockUpdateStatus,
    batchInsert: vi.fn(),
    fetchStats: vi.fn(),
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ insert: mocks.mockInsert }) },
}));

/** 同一场排练的两个不同对象引用（id 相同）——模拟列表重新取数后重开同一行 */
const rehearsalRow = (): RehearsalRow =>
  ({
    id: 1,
    repertoire: "贝多芬第五交响曲",
    start_time: "2026-08-20T19:00:00",
    end_time: "2026-08-20T21:00:00",
  }) as RehearsalRow;

const rows = () =>
  [
    {
      id: 1,
      rehearsal_id: 1,
      user_id: "u1",
      status: "absent",
      sign_in_time: null,
    },
  ] as never[];

describe("useAttendanceEditor 的换场生命周期", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "alert").mockImplementation(() => {});
    mocks.mockFetchByRehearsal.mockResolvedValue(rows());
    mocks.mockUpdateStatus.mockResolvedValue(null);
    mocks.mockInsert.mockResolvedValue({ error: null });
  });

  it("同一 id 换新对象再次打开：待保存改动不得被清空（两个重置键必须同键）", async () => {
    const { result } = renderHook(() => useAttendanceEditor());

    await act(async () => {
      result.current.openAttendance(rehearsalRow());
    });
    act(() => {
      result.current.onAttendanceStatusChange("u1", "exempt");
    });
    // 同一 id、新的对象引用再次打开（列表重新取数后重开同一行的形态）
    await act(async () => {
      result.current.openAttendance(rehearsalRow());
    });

    await act(async () => {
      await result.current.saveAttendance();
    });

    // 待保存集合若被误清，这里会是 0 次——即「界面显示一个存不进去的值」
    expect(mocks.mockUpdateStatus).toHaveBeenCalledTimes(1);
    expect(mocks.mockUpdateStatus).toHaveBeenCalledWith(1, "u1", "exempt");
  });

  it("换到另一场：上一场未保存的改动被清空，不得写进新一场", async () => {
    const { result } = renderHook(() => useAttendanceEditor());

    await act(async () => {
      result.current.openAttendance(rehearsalRow());
    });
    act(() => {
      result.current.onAttendanceStatusChange("u1", "exempt");
    });
    await act(async () => {
      result.current.openAttendance({ ...rehearsalRow(), id: 2 });
    });

    await act(async () => {
      await result.current.saveAttendance();
    });

    expect(mocks.mockUpdateStatus).not.toHaveBeenCalled();
  });
});
