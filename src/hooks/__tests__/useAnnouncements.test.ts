// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const { mockLimit, mockInsert } = vi.hoisted(() => ({
  mockLimit: vi.fn(),
  mockInsert: vi.fn(),
}));

// Pattern matching useAuth.test.ts (which works)
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        order: vi.fn(() => ({ limit: mockLimit })),
      })),
      insert: mockInsert,
    })),
  },
}));

import { useAnnouncements } from "../useAnnouncements";

describe("useAnnouncements", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockLimit.mockResolvedValue({ data: [], error: null });
    mockInsert.mockResolvedValue({ error: null });
  });

  it("fetch 获取最新公告", async () => {
    mockLimit.mockResolvedValue({
      data: [{ id: "1", content: "测试", created_at: "2024-01-01" }],
      error: null,
    });

    const { result } = renderHook(() => useAnnouncements());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toMatchObject({ id: "1", content: "测试" });
  });

  it("fetch 失败设置 error", async () => {
    mockLimit.mockResolvedValue({ data: null, error: { message: "查询失败" } });

    const { result } = renderHook(() => useAnnouncements());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("查询失败");
  });

  it("无公告时 data 为 null", async () => {
    const { result } = renderHook(() => useAnnouncements());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
  });

  it("publish 成功", async () => {
    const { result } = renderHook(() => useAnnouncements());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok = false;
    await act(async () => {
      ok = (await result.current.publish("新公告")) || false;
    });
    expect(ok).toBe(true);
    expect(mockInsert).toHaveBeenCalledWith({ content: "新公告" });
  });

  it("publish 失败", async () => {
    mockInsert.mockResolvedValue({ error: { message: "失败" } });

    const { result } = renderHook(() => useAnnouncements());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok = true;
    await act(async () => {
      ok = (await result.current.publish("x")) ?? false;
    });
    expect(ok).toBe(false);
  });
});
