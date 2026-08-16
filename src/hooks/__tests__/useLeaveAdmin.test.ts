// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useLeaveAdmin } from "../useLeaveAdmin";

// mock 浏览器客户端（仅 auth.getSession 被使用；数据走 /api/admin/leave）
// vi.mock 工厂在模块加载时执行，需经 vi.hoisted 提升 getSessionMock 声明（避免 TDZ）
const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: getSessionMock } },
}));

/** 构造 window.fetch mock 返回 */
function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  };
}

const sampleRequests = [
  {
    id: "lr-1",
    rehearsal_id: 1,
    user_id: "u1",
    reason: "感冒",
    status: "pending",
    target_status: "excused",
    created_at: "2026-08-15T10:00:00Z",
    updated_at: "2026-08-15T10:00:00Z",
    attachment_url: null,
    reject_reason: null,
    profiles: { full_name: "张三", instrument: "第一小提琴" },
    rehearsals: {
      title: "合排",
      start_time: "2026-08-16T13:00:00",
      end_time: null,
      location: "排练厅",
    },
  },
];

describe("useLeaveAdmin", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: "test-token" } },
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("fetch 拉取全部申请并携带 Bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ requests: sampleRequests }));
    global.fetch = fetchMock as never;

    const { result } = renderHook(() => useLeaveAdmin());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.requests).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/leave", {
      method: "GET",
      headers: expect.objectContaining({
        Authorization: "Bearer test-token",
      }),
    });
  });

  it("fetch 失败写入 error", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "服务异常" }, false, 500)) as never;

    const { result } = renderHook(() => useLeaveAdmin());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("服务异常");
    expect(result.current.requests).toEqual([]);
  });

  it("approve 批量通过：成功后本地移除已处理行，warnings 透传为消息数组（Issue #159 返工）", async () => {
    // 前两次 GET（挂载 + 手动 fetch）返回列表，第三次 POST 返回审批结果
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ requests: sampleRequests }))
      .mockResolvedValueOnce(jsonResponse({ requests: sampleRequests }))
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          processed: ["lr-1"],
          failed: [],
          warnings: [{ id: "lr-1", message: "成员已实际签到，考勤未联动" }],
        }),
      ) as never;

    const { result } = renderHook(() => useLeaveAdmin());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // 注入列表后审批
    await act(async () => {
      await result.current.fetch();
    });
    expect(result.current.requests).toHaveLength(1);

    const res = await act(() => result.current.approve(["lr-1"]));
    expect(res).toEqual({ ok: true, warnings: ["成员已实际签到，考勤未联动"] });
    expect(result.current.requests).toEqual([]);
  });

  it("approve 无 warnings 响应：返回空数组（不报错）", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, processed: ["lr-1"], failed: [] })) as never;

    const { result } = renderHook(() => useLeaveAdmin());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const res = await act(() => result.current.approve(["lr-1"]));
    expect(res).toEqual({ ok: true, warnings: [] });
  });

  it("approve 失败：返回 { ok: false, warnings: [] } 并写入 error", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "服务异常" }, false, 500)) as never;

    const { result } = renderHook(() => useLeaveAdmin());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const res = await act(() => result.current.approve(["lr-1"]));
    expect(res).toEqual({ ok: false, warnings: [] });
    expect(result.current.error).toBe("服务异常");
  });

  it("approve 请求体包含 action 与 ids", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, processed: ["lr-1"], failed: [] }));
    global.fetch = fetchMock as never;

    const { result } = renderHook(() => useLeaveAdmin());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.approve(["lr-1"]));
    const call = fetchMock.mock.calls[1]; // [0] 是挂载时的 fetch
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body).toEqual({ action: "approve", ids: ["lr-1"] });
  });

  it("reject 请求体携带驳回原因", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, processed: ["lr-1"], failed: [] }));
    global.fetch = fetchMock as never;

    const { result } = renderHook(() => useLeaveAdmin());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.reject(["lr-1"], "理由不充分"));
    const call = fetchMock.mock.calls[1];
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body).toEqual({
      action: "reject",
      ids: ["lr-1"],
      reject_reason: "理由不充分",
    });
  });

  it("reject 失败返回 false 并写入 error", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "缺少驳回原因" }, false, 400)) as never;

    const { result } = renderHook(() => useLeaveAdmin());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() => result.current.reject(["lr-1"], ""));
    expect(ok).toBe(false);
    expect(result.current.error).toBe("缺少驳回原因");
  });

  it("getSignedUrl 返回签名链接", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ url: "https://x/signed" })) as never;

    const { result } = renderHook(() => useLeaveAdmin());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const url = await act(() => result.current.getSignedUrl("u1/1-a.jpg"));
    expect(url).toBe("https://x/signed");
  });

  it("getSignedUrl 失败返回 null", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "签名失败" }, false, 500)) as never;

    const { result } = renderHook(() => useLeaveAdmin());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const url = await act(() => result.current.getSignedUrl("u1/1-a.jpg"));
    expect(url).toBeNull();
  });
});
