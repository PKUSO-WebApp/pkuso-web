// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useLeaveRequests } from "../useLeaveRequests";

/**
 * 链式 mock 客户端：依次消费 responses（含挂载时的初始 fetch）。
 * 记录每次 update 的表名与载荷（calls），供断言 withdraw 的考勤还原逻辑。
 */
function mockClient<T>(responses: T[]) {
  const calls: { table: string; op: "update"; payload: unknown }[] = [];
  let i = 0;
  const c = (r: T) => ({
    eq: () => c(r),
    order: () => c(r),
    maybeSingle: () => c(r),
    then: (resolve: (v: T) => void) => resolve(r),
  });
  return {
    calls,
    from: (table: string) => ({
      select: () => c(responses[i++]),
      insert: () => c(responses[i++]),
      update: (payload: unknown) => {
        calls.push({ table, op: "update", payload });
        return { eq: () => ({ eq: () => c(responses[i++]) }) };
      },
    }),
    storage: {
      from: () => ({
        upload: () => c(responses[i++]),
        createSignedUrl: () => c(responses[i++]),
      }),
    },
  };
}

const fetchOk = { data: [{ id: "1", rehearsal_id: 1 }], error: null };
const emptyOk = { data: [], error: null };

describe("useLeaveRequests", () => {
  it("fetchMine 加载我的申请（含排练 join）", async () => {
    const c = mockClient([
      {
        data: [
          {
            id: "lr-1",
            rehearsal_id: 1,
            status: "pending",
            rehearsals: { title: "排练", start_time: "2026-08-15T13:00:00" },
          },
        ],
        error: null,
      },
    ]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data[0]).toMatchObject({ id: "lr-1", status: "pending" });
  });

  it("fetchMine 失败写入 error 并清空列表", async () => {
    const c = mockClient([{ data: null, error: { message: "查询失败" } }]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("查询失败");
    expect(result.current.data).toEqual([]);
  });

  it("create 新申请（target_status 缺省按 excused 提交）", async () => {
    const c = mockClient([fetchOk, { error: null }, emptyOk]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() =>
      result.current.create({ rehearsal_id: 1, user_id: "u1", reason: "感冒了" }),
    );
    expect(ok).toBe(true);
  });

  it("create 失败返回 false 并写入 error", async () => {
    const c = mockClient([fetchOk, { error: { message: "插入失败" } }]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() =>
      result.current.create({ rehearsal_id: 1, user_id: "u1", reason: "x" }),
    );
    expect(ok).toBe(false);
    expect(result.current.error).toBe("插入失败");
  });

  it("updateReason 更新 pending 申请内容", async () => {
    const c = mockClient([fetchOk, { error: null }, emptyOk]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() =>
      result.current.updateReason("lr-1", { reason: "改原因", attachment_url: null }),
    );
    expect(ok).toBe(true);
  });

  it("reapply 重新申请：状态回 pending 并清空驳回原因（限 rejected 行）", async () => {
    const c = mockClient([fetchOk, { error: null }, emptyOk]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() =>
      result.current.reapply("lr-1", { reason: "再次申请", attachment_url: null }),
    );
    expect(ok).toBe(true);
  });

  it("withdraw 撤回已通过申请（不带考勤参数：仅撤回申请不动考勤）", async () => {
    const c = mockClient([fetchOk, { error: null }, emptyOk]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() => result.current.withdraw("lr-1"));
    expect(ok).toBe(true);
    expect(c.calls.map((x) => x.table)).toEqual(["leave_requests"]);
  });

  it("withdraw 未签到（sign_in_time 空）且考勤状态与 target_status 一致 → 考勤还原为 absent", async () => {
    const c = mockClient([
      fetchOk,
      { error: null }, // 撤回申请 update
      { data: { sign_in_time: null, status: "excused" }, error: null }, // 查考勤
      { error: null }, // 考勤还原 update
      emptyOk, // 撤回后 fetchMine
    ]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() =>
      result.current.withdraw("lr-1", {
        rehearsal_id: 1,
        user_id: "u1",
        target_status: "excused",
      }),
    );
    expect(ok).toBe(true);
    expect(c.calls.map((x) => `${x.table}:${x.op}`)).toEqual([
      "leave_requests:update",
      "attendances:update",
    ]);
    expect(c.calls[1].payload).toEqual({ status: "absent" });
  });

  it("withdraw 已签到（sign_in_time 非空）：考勤锁定不动，仅撤回申请", async () => {
    const c = mockClient([
      fetchOk,
      { error: null },
      { data: { sign_in_time: "2026-08-16T13:05:00", status: "excused" }, error: null },
      emptyOk,
    ]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() =>
      result.current.withdraw("lr-1", {
        rehearsal_id: 1,
        user_id: "u1",
        target_status: "excused",
      }),
    );
    expect(ok).toBe(true);
    expect(c.calls.map((x) => x.table)).toEqual(["leave_requests"]);
  });

  it("withdraw 考勤状态与 target_status 不一致（管理员另行改写）：不还原", async () => {
    const c = mockClient([
      fetchOk,
      { error: null },
      { data: { sign_in_time: null, status: "present" }, error: null },
      emptyOk,
    ]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() =>
      result.current.withdraw("lr-1", {
        rehearsal_id: 1,
        user_id: "u1",
        target_status: "excused",
      }),
    );
    expect(ok).toBe(true);
    expect(c.calls.map((x) => x.table)).toEqual(["leave_requests"]);
  });

  it("withdraw 无考勤行（maybeSingle 返回 null）：不还原", async () => {
    const c = mockClient([fetchOk, { error: null }, { data: null, error: null }, emptyOk]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() =>
      result.current.withdraw("lr-1", {
        rehearsal_id: 1,
        user_id: "u1",
        target_status: "excused",
      }),
    );
    expect(ok).toBe(true);
    expect(c.calls.map((x) => x.table)).toEqual(["leave_requests"]);
  });

  it("withdraw 考勤还原失败返回 false（撤回已生效，调用方可重试）", async () => {
    const c = mockClient([
      fetchOk,
      { error: null },
      { data: { sign_in_time: null, status: "excused" }, error: null },
      { error: { message: "还原失败" } },
    ]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() =>
      result.current.withdraw("lr-1", {
        rehearsal_id: 1,
        user_id: "u1",
        target_status: "excused",
      }),
    );
    expect(ok).toBe(false);
    expect(result.current.error).toBe("撤回成功，但考勤还原失败：还原失败");
  });

  it("uploadAttachment 上传到私有桶并返回 storage 路径（无公开 URL）", async () => {
    const c = mockClient([fetchOk, { error: null }]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const r = await act(() => result.current.uploadAttachment(new File([], "a.jpg"), "u1"));
    expect(r).toHaveProperty("url");
    expect((r as { url: string }).url).toMatch(/^u1\/\d+-a\.jpg$/);
  });

  it("uploadAttachment 上传失败返回 error", async () => {
    const c = mockClient([fetchOk, { error: { message: "存储拒绝" } }]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const r = await act(() => result.current.uploadAttachment(new File([], "a.jpg"), "u1"));
    expect(r).toHaveProperty("error", "存储拒绝");
  });

  it("getSignedUrl 返回 60s 签名链接", async () => {
    const c = mockClient([fetchOk, { data: { signedUrl: "https://x/signed?a=1" }, error: null }]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const r = await act(() => result.current.getSignedUrl("u1/1-a.jpg"));
    expect(r).toEqual({ url: "https://x/signed?a=1" });
  });
});
