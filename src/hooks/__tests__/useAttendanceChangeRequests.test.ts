// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: mockGetSession } },
}));

import { useAttendanceChangeRequests } from "../useAttendanceChangeRequests";

const ID = "11111111-1111-4111-8111-111111111111";

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

describe("useAttendanceChangeRequests", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "token" } } });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("挂载时 GET 列表，带 Bearer token", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ requests: [{ id: ID, status: "pending" }] }));
    const { result } = renderHook(() => useAttendanceChangeRequests());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.requests).toEqual([{ id: ID, status: "pending" }]);
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/attendance-requests", {
      method: "GET",
      headers: { "Content-Type": "application/json", Authorization: "Bearer token" },
    });
  });

  it("approve POST 后重拉列表；force 透传", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ requests: [] }))
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: ID, ok: true, status: "approved" }] }))
      .mockResolvedValueOnce(jsonResponse({ requests: [] }));
    const { result } = renderHook(() => useAttendanceChangeRequests());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let response;
    await act(async () => {
      response = await result.current.approve([ID], true);
    });

    expect(response).toEqual({
      ok: true,
      results: [{ id: ID, ok: true, status: "approved" }],
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/admin/attendance-requests",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "approve", ids: [ID], force: true }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/admin/attendance-requests",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("HTTP 失败返回 error，不清空旧列表", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ requests: [{ id: ID, status: "pending" }] }))
      .mockResolvedValueOnce(jsonResponse({ error: "权限不足" }, false));
    const { result } = renderHook(() => useAttendanceChangeRequests());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let response;
    await act(async () => {
      response = await result.current.reject([ID], "材料不全");
    });

    expect(response).toEqual({ ok: false, results: [], error: "权限不足" });
    expect(result.current.error).toBe("权限不足");
    expect(result.current.requests).toHaveLength(1);
  });
});
