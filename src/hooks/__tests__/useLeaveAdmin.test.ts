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

  it("approve 批量通过：成功后静默重拉列表，行保留且状态更新为已通过（已处理 tab 可见，Issue #190）", async () => {
    // 调用序列：挂载 GET → 手动 fetch GET → POST 审批 → 重拉 GET
    const updatedRequests = [{ ...sampleRequests[0], status: "approved" }];
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
      )
      .mockResolvedValueOnce(jsonResponse({ requests: updatedRequests })) as never;

    const { result } = renderHook(() => useLeaveAdmin());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // 注入列表后审批
    await act(async () => {
      await result.current.fetch();
    });
    expect(result.current.requests).toHaveLength(1);

    const res = await act(() => result.current.approve(["lr-1"]));
    expect(res).toEqual({ ok: true, warnings: ["成员已实际签到，考勤未联动"] });
    // 行未被删除：重拉后仍在且状态为已通过（切到已处理 tab 可见）
    expect(result.current.requests).toHaveLength(1);
    expect(result.current.requests[0].status).toBe("approved");
  });

  it("reject 批量驳回：成功后静默重拉列表，行保留且状态为已驳回（含驳回原因，Issue #190）", async () => {
    // 调用序列：挂载 GET → 手动 fetch GET → POST 驳回 → 重拉 GET
    const updatedRequests = [
      { ...sampleRequests[0], status: "rejected", reject_reason: "理由不充分" },
    ];
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ requests: sampleRequests }))
      .mockResolvedValueOnce(jsonResponse({ requests: sampleRequests }))
      .mockResolvedValueOnce(jsonResponse({ success: true, processed: ["lr-1"], failed: [] }))
      .mockResolvedValueOnce(jsonResponse({ requests: updatedRequests })) as never;

    const { result } = renderHook(() => useLeaveAdmin());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.fetch();
    });
    expect(result.current.requests).toHaveLength(1);

    const res = await act(() => result.current.reject(["lr-1"], "理由不充分"));
    expect(res).toEqual({ ok: true, warnings: [] });
    // 行未被删除：重拉后仍在且状态为已驳回，驳回原因以服务端为准
    expect(result.current.requests).toHaveLength(1);
    expect(result.current.requests[0].status).toBe("rejected");
    expect(result.current.requests[0].reject_reason).toBe("理由不充分");
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

  it("审批成功但重拉失败：保留旧列表仅提示错误（不误伤已处理结果，Issue #190 对抗）", async () => {
    // 调用序列：挂载 GET → 手动 fetch GET → POST 审批成功 → 重拉 GET 网络异常
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ requests: sampleRequests }))
      .mockResolvedValueOnce(jsonResponse({ requests: sampleRequests }))
      .mockResolvedValueOnce(
        jsonResponse({ success: true, processed: ["lr-1"], failed: [], warnings: [] }),
      )
      .mockRejectedValueOnce(new Error("network down")) as never;

    const { result } = renderHook(() => useLeaveAdmin());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.fetch();
    });

    const res = await act(() => result.current.approve(["lr-1"]));
    // 审批结果照常返回成功
    expect(res).toEqual({ ok: true, warnings: [] });
    // keepOnError 重拉：失败仅提示错误，旧列表保留（不清空，已处理结果不受影响）
    expect(result.current.requests).toHaveLength(1);
    expect(result.current.requests[0].status).toBe("pending");
    expect(result.current.error).toBe("网络错误");
  });

  it("approve 响应含 failed：并入 warnings 提示文案（成员名反查，Issue #190 对抗）", async () => {
    // 调用序列：挂载 GET → 手动 fetch GET → POST 审批（1 条失败）→ 重拉 GET
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ requests: sampleRequests }))
      .mockResolvedValueOnce(jsonResponse({ requests: sampleRequests }))
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          processed: [],
          failed: [{ id: "lr-1", error: "申请不存在或已处理" }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ requests: sampleRequests })) as never;

    const { result } = renderHook(() => useLeaveAdmin());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.fetch();
    });

    const res = await act(() => result.current.approve(["lr-1"]));
    expect(res.ok).toBe(true);
    // failed 项从最新列表反查成员名后并入 warnings
    expect(res.warnings).toEqual(["有 1 条申请未被处理：张三（申请不存在或已处理）"]);
  });

  it("reject 响应含 failed：并入 warnings 提示文案（成员名反查，Issue #190 对抗）", async () => {
    // 调用序列：挂载 GET → 手动 fetch GET → POST 驳回（1 条失败）→ 重拉 GET
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ requests: sampleRequests }))
      .mockResolvedValueOnce(jsonResponse({ requests: sampleRequests }))
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          processed: [],
          failed: [{ id: "lr-1", error: "申请不存在或已处理" }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ requests: sampleRequests })) as never;

    const { result } = renderHook(() => useLeaveAdmin());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.fetch();
    });

    const res = await act(() => result.current.reject(["lr-1"], "理由不充分"));
    expect(res.ok).toBe(true);
    expect(res.warnings).toEqual(["有 1 条申请未被处理：张三（申请不存在或已处理）"]);
  });

  it("陈旧 GET 响应被递增序号守卫丢弃（快速刷新/审批并发时不复活旧列表，Issue #190 对抗）", async () => {
    // 挂载 GET#1 挂起（慢），手动 GET#2 先返回新列表；GET#1 迟到返回旧列表应被丢弃
    let resolveFirst!: (value: unknown) => void;
    const firstResponse = new Promise<unknown>((res) => {
      resolveFirst = res;
    });
    const freshList = [{ ...sampleRequests[0], reason: "重拉的新数据" }];
    const staleList = [{ ...sampleRequests[0], reason: "陈旧旧数据" }];
    global.fetch = vi
      .fn()
      .mockReturnValueOnce(firstResponse) // GET#1（慢）
      .mockResolvedValueOnce(jsonResponse({ requests: freshList })) // GET#2（快）
      .mockResolvedValueOnce(jsonResponse({ requests: staleList })) as never;

    const { result } = renderHook(() => useLeaveAdmin());

    // 手动刷新（GET#2）先返回新列表
    await act(async () => {
      await result.current.fetch();
    });
    expect(result.current.requests).toEqual(freshList);

    // GET#1 迟到返回旧列表：seq 守卫丢弃，列表不被覆盖
    await act(async () => {
      resolveFirst(jsonResponse({ requests: staleList }));
    });
    expect(result.current.requests).toEqual(freshList);
  });

  it("重拉失败后再点审批：陈旧列表触发 failed 闭环提示（组合场景，Issue #190 对抗遗留）", async () => {
    // 调用序列：挂载 GET → 手动 fetch GET → POST#1 审批成功 → 重拉 GET 网络失败（keepOnError 保留旧列表）
    // → POST#2 再次审批同一行 → 服务端返回 failed（申请不存在或已处理）→ 重拉 GET 成功
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ requests: sampleRequests }))
      .mockResolvedValueOnce(jsonResponse({ requests: sampleRequests }))
      .mockResolvedValueOnce(
        jsonResponse({ success: true, processed: ["lr-1"], failed: [], warnings: [] }),
      )
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          processed: [],
          failed: [{ id: "lr-1", error: "申请不存在或已处理" }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ requests: sampleRequests })) as never;

    const { result } = renderHook(() => useLeaveAdmin());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.fetch();
    });

    // 第一次审批：成功但重拉失败，旧列表保留（状态仍为 pending，管理员会误以为未处理）
    const first = await act(() => result.current.approve(["lr-1"]));
    expect(first).toEqual({ ok: true, warnings: [] });
    expect(result.current.requests[0].status).toBe("pending");
    expect(result.current.error).toBe("网络错误");

    // 再次审批同一行：processingRef 已释放可正常进入，服务端返回 failed 并入 warnings（闭环成立）
    const second = await act(() => result.current.approve(["lr-1"]));
    expect(second.ok).toBe(true);
    expect(second.warnings).toEqual(["有 1 条申请未被处理：张三（申请不存在或已处理）"]);
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

  it("reject 失败：返回 { ok: false, warnings: [] } 并写入 error", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "缺少驳回原因" }, false, 400)) as never;

    const { result } = renderHook(() => useLeaveAdmin());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const res = await act(() => result.current.reject(["lr-1"], ""));
    expect(res).toEqual({ ok: false, warnings: [] });
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
