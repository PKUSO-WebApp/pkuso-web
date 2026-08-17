// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useLeaveRequests } from "../useLeaveRequests";

/**
 * 链式 mock 客户端：依次消费 responses（含挂载时的初始 fetch）。
 * 记录每次 update 的表名与载荷（calls），供断言状态变更；
 * 记录 eq/in 过滤参数（filters），供断言 cancelOnSignIn 的「已驳回不动」过滤（Issue #155）；
 * 记录 storage.remove 调用（removes），供断言附件删除（Issue #149）。
 * update 链（eq → eq）中仅首个 eq 消费响应，后续链式调用（eq/in/select）返回同一
 * thenable，await 解开为对应响应——兼容有无 select 两种链。
 */
function mockClient<T>(responses: T[]) {
  const calls: { table: string; op: "update"; payload: unknown }[] = [];
  const removes: { bucket: string; paths: string[] }[] = [];
  const uploads: { bucket: string; path: string }[] = [];
  const filters: { table: string; args: unknown[] }[] = [];
  let i = 0;
  const chain = (r: T, table: string) => ({
    eq: (...args: unknown[]) => {
      filters.push({ table, args: ["eq", ...args] });
      return chain(r, table);
    },
    in: (...args: unknown[]) => {
      filters.push({ table, args: ["in", ...args] });
      return chain(r, table);
    },
    order: () => chain(r, table),
    maybeSingle: () => chain(r, table),
    select: () => chain(r, table),
    then: (resolve: (v: T) => void) => resolve(r),
  });
  return {
    calls,
    removes,
    uploads,
    filters,
    from: (table: string) => ({
      select: () => chain(responses[i++], table),
      insert: () => chain(responses[i++], table),
      update: (payload: unknown) => {
        calls.push({ table, op: "update", payload });
        return chain(responses[i++], table);
      },
    }),
    storage: {
      from: (bucket: string) => ({
        upload: (path: string) => {
          uploads.push({ bucket, path });
          return chain(responses[i++], bucket);
        },
        createSignedUrl: () => chain(responses[i++], bucket),
        remove: (paths: string[]) => {
          removes.push({ bucket, paths });
          return chain(responses[i++], bucket);
        },
      }),
    },
  };
}

const fetchOk = { data: [{ id: "1", rehearsal_id: 1 }], error: null };
const emptyOk = { data: [], error: null };
/** update 匹配到行（0 行检测通过）；无 data 字段的 { error: null } 已被 0 行检测拦截 */
const updateOk = { data: [{ id: "lr-1" }], error: null };

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
    const c = mockClient([fetchOk, updateOk, emptyOk]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() =>
      result.current.updateReason("lr-1", { reason: "改原因", attachment_url: null }),
    );
    expect(ok).toBe(true);
  });

  it("reapply 重新申请：状态回 pending 并清空驳回原因（限 rejected 行）", async () => {
    const c = mockClient([fetchOk, updateOk, emptyOk]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() =>
      result.current.reapply("lr-1", { reason: "再次申请", attachment_url: null }),
    );
    expect(ok).toBe(true);
  });

  it("withdraw 撤回已通过申请：仅撤回申请，不动考勤（Issue #155）", async () => {
    const c = mockClient([fetchOk, { error: null }, emptyOk]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() => result.current.withdraw("lr-1"));
    expect(ok).toBe(true);
    // 只更新 leave_requests，绝不触碰 attendances（移除 #149 的考勤还原逻辑）
    expect(c.calls.map((x) => x.table)).toEqual(["leave_requests"]);
    expect(c.calls[0].payload).toEqual({ status: "withdrawn" });
    // 撤回后刷新申请列表（卡片申请状态同步）
    expect(result.current.data).toEqual([]);
  });

  it("withdraw 更新失败返回 false 并写入 error", async () => {
    const c = mockClient([fetchOk, { error: { message: "撤回失败" } }]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() => result.current.withdraw("lr-1"));
    expect(ok).toBe(false);
    expect(result.current.error).toBe("撤回失败");
  });

  // ---- cancelOnSignIn（覆盖请假签到，Issue #155）----

  it("cancelOnSignIn 无有效申请（查询为空）：不更新、不删附件，直接成功", async () => {
    const c = mockClient([fetchOk, { data: [], error: null }, emptyOk]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() => result.current.cancelOnSignIn(1));
    expect(ok).toEqual({ ok: true });
    expect(c.calls).toEqual([]);
    expect(c.removes).toEqual([]);
    // 查询按排练 + pending/approved 过滤（已驳回/已撤回/已取消不在撤销范围）
    expect(c.filters).toContainEqual({
      table: "leave_requests",
      args: ["in", "status", ["pending", "approved"]],
    });
  });

  it("cancelOnSignIn 撤销 pending+approved 申请：批量置 canceled、清理附件、刷新列表", async () => {
    const c = mockClient([
      fetchOk,
      // 查询本排练 pending/approved 申请（含附件路径）
      {
        data: [
          { id: "lr-1", attachment_url: "u1/1-a.jpg" },
          { id: "lr-2", attachment_url: null },
        ],
        error: null,
      },
      updateOk, // 批量撤销 update（select 0 行检测通过）
      { error: null }, // lr-1 附件删除 remove
      emptyOk, // 撤销后 fetchMine
    ]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() => result.current.cancelOnSignIn(1));
    expect(ok).toEqual({ ok: true });
    expect(c.calls).toEqual([
      { table: "leave_requests", op: "update", payload: { status: "canceled" } },
    ]);
    expect(c.removes).toEqual([{ bucket: "leave-attachments", paths: ["u1/1-a.jpg"] }]);
  });

  it('cancelOnSignIn 查询失败返回 { ok:false, reason:"network" } 并写入 error', async () => {
    const c = mockClient([fetchOk, { data: null, error: { message: "查询失败" } }]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() => result.current.cancelOnSignIn(1));
    expect(ok).toEqual({ ok: false, reason: "network" });
    expect(result.current.error).toBe("查询失败");
    expect(c.calls).toEqual([]);
  });

  it('cancelOnSignIn 更新失败返回 { ok:false, reason:"network" } 并写入 error，附件不被误删', async () => {
    const c = mockClient([
      fetchOk,
      { data: [{ id: "lr-1", attachment_url: "u1/1-a.jpg" }], error: null },
      { error: { message: "更新失败" } },
    ]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() => result.current.cancelOnSignIn(1));
    expect(ok).toEqual({ ok: false, reason: "network" });
    expect(result.current.error).toBe("更新失败");
    expect(c.removes).toEqual([]);
  });

  it("cancelOnSignIn 并发处理后 0 行更新：返回 already-processed、跳过附件清理（防误删已驳回行附件，返工）", async () => {
    // SELECT 时申请仍为 approved（查询命中），UPDATE 前管理员已驳回 → update 匹配 0 行；
    // 此时附件属审批结果一部分，不得删除（已驳回申请仍需追溯）
    const c = mockClient([
      fetchOk,
      { data: [{ id: "lr-1", attachment_url: "u1/1-a.jpg" }], error: null },
      { data: [], error: null }, // 批量撤销 update 0 行
    ]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() => result.current.cancelOnSignIn(1));
    expect(ok).toEqual({ ok: false, reason: "already-processed" });
    expect(result.current.error).toBe("申请已被处理，请刷新后重试");
    expect(c.removes).toEqual([]); // 已驳回申请的附件不得被误删
  });

  it("cancelOnSignIn 多申请并发：UPDATE 精确到 SELECT 快照 id，只删实际被撤销行的附件（返工）", async () => {
    // SELECT 快照 lr-1/lr-2 均为 pending 且带附件；UPDATE 间隙管理员并发驳回了 lr-2。
    // UPDATE 按快照 id 集合精确过滤（不再 rehearsal_id + status 宽匹配），仅命中仍为
    // pending/approved 的 lr-1 → 附件只删 lr-1 的，lr-2（已驳回）附件保留
    const c = mockClient([
      fetchOk,
      {
        data: [
          { id: "lr-1", attachment_url: "u1/1-a.jpg" },
          { id: "lr-2", attachment_url: "u2/2-b.jpg" },
        ],
        error: null,
      },
      { data: [{ id: "lr-1" }], error: null }, // 批量撤销 update 仅命中 lr-1（lr-2 已被并发驳回）
      { error: null }, // lr-1 附件删除 remove
      emptyOk, // 撤销后 fetchMine
    ]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() => result.current.cancelOnSignIn(1));
    expect(ok).toEqual({ ok: true });
    // UPDATE 按 SELECT 快照返回的 id 集合精确过滤
    expect(c.filters).toContainEqual({
      table: "leave_requests",
      args: ["in", "id", ["lr-1", "lr-2"]],
    });
    // 附件只删实际被撤销行 lr-1 的，并发驳回行 lr-2 的附件不得被误删
    expect(c.removes).toEqual([{ bucket: "leave-attachments", paths: ["u1/1-a.jpg"] }]);
  });

  // ---- cancelRequest（Issue #149）----

  it("cancelRequest 取消 pending 申请（无附件）：状态更新为 canceled，不调用存储删除", async () => {
    const c = mockClient([fetchOk, updateOk, emptyOk]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() => result.current.cancelRequest("lr-1"));
    expect(ok).toBe(true);
    expect(c.calls).toEqual([
      { table: "leave_requests", op: "update", payload: { status: "canceled" } },
    ]);
    expect(c.removes).toEqual([]);
  });

  it("cancelRequest 带附件：取消成功后删除私有桶附件", async () => {
    const c = mockClient([
      fetchOk,
      updateOk, // 取消申请 update
      { error: null }, // 附件删除 remove
      emptyOk, // 取消后 fetchMine
    ]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() =>
      result.current.cancelRequest("lr-1", { attachment_url: "u1/1-a.jpg" }),
    );
    expect(ok).toBe(true);
    expect(c.removes).toEqual([{ bucket: "leave-attachments", paths: ["u1/1-a.jpg"] }]);
  });

  it("cancelRequest 附件删除失败（remove 返回 error）：不影响状态取消", async () => {
    const c = mockClient([
      fetchOk,
      updateOk,
      { error: { message: "删除失败" } }, // remove 返回错误（容错忽略）
      emptyOk,
    ]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() =>
      result.current.cancelRequest("lr-1", { attachment_url: "u1/1-a.jpg" }),
    );
    expect(ok).toBe(true);
    expect(result.current.error).toBeNull();
    expect(c.removes).toEqual([{ bucket: "leave-attachments", paths: ["u1/1-a.jpg"] }]);
  });

  it("cancelRequest 完整 URL 附件：提取 leave-attachments/ 之后解码的路径删除", async () => {
    const c = mockClient([fetchOk, updateOk, { error: null }, emptyOk]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() =>
      result.current.cancelRequest("lr-1", {
        attachment_url: "https://x.supabase.co/storage/v1/object/leave-attachments/u1%2F1-a.jpg",
      }),
    );
    expect(ok).toBe(true);
    expect(c.removes).toEqual([{ bucket: "leave-attachments", paths: ["u1/1-a.jpg"] }]);
  });

  it("cancelRequest 更新失败返回 false 并写入 error", async () => {
    const c = mockClient([fetchOk, { error: { message: "取消失败" } }]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() => result.current.cancelRequest("lr-1"));
    expect(ok).toBe(false);
    expect(result.current.error).toBe("取消失败");
    expect(c.removes).toEqual([]);
  });

  it("cancelRequest 并发审批后 0 行更新：返回 false、写入 error、附件不被误删", async () => {
    // 管理员已并发审批通过（status 非 pending），update 匹配 0 行
    const c = mockClient([fetchOk, { data: [], error: null }]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() =>
      result.current.cancelRequest("lr-1", { attachment_url: "u1/1-a.jpg" }),
    );
    expect(ok).toBe(false);
    expect(result.current.error).toBe("申请已被处理，请刷新后重试");
    expect(c.removes).toEqual([]); // 已通过申请的附件不得被删除
  });

  // ---- 编辑换图删旧附件（Issue #149）----

  it("updateReason 换图：保存成功后删除旧附件（仅删除旧路径）", async () => {
    const c = mockClient([
      fetchOk,
      updateOk, // 更新申请 update
      { error: null }, // 旧附件删除 remove
      emptyOk, // 保存后 fetchMine
    ]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() =>
      result.current.updateReason("lr-1", {
        reason: "改原因",
        attachment_url: "u1/2-b.jpg",
        old_attachment_url: "u1/1-a.jpg",
      }),
    );
    expect(ok).toBe(true);
    expect(c.calls[0].payload).toEqual({
      reason: "改原因",
      attachment_url: "u1/2-b.jpg",
    });
    expect(c.removes).toEqual([{ bucket: "leave-attachments", paths: ["u1/1-a.jpg"] }]);
  });

  it("updateReason 未换图（新旧相同）：不删除附件", async () => {
    const c = mockClient([fetchOk, updateOk, emptyOk]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() =>
      result.current.updateReason("lr-1", {
        reason: "改原因",
        attachment_url: "u1/1-a.jpg",
        old_attachment_url: "u1/1-a.jpg",
      }),
    );
    expect(ok).toBe(true);
    expect(c.removes).toEqual([]);
  });

  it("updateReason 仅移除附件（新为 null）：不删除旧附件（换图语义）", async () => {
    const c = mockClient([fetchOk, updateOk, emptyOk]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() =>
      result.current.updateReason("lr-1", {
        reason: "改原因",
        attachment_url: null,
        old_attachment_url: "u1/1-a.jpg",
      }),
    );
    expect(ok).toBe(true);
    expect(c.removes).toEqual([]);
  });

  it("updateReason 并发审批后 0 行更新：返回 false、写入 error、旧附件不被误删", async () => {
    // 管理员已并发审批通过（status 非 pending），update 匹配 0 行
    const c = mockClient([fetchOk, { data: [], error: null }]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() =>
      result.current.updateReason("lr-1", {
        reason: "改原因",
        attachment_url: "u1/2-b.jpg",
        old_attachment_url: "u1/1-a.jpg",
      }),
    );
    expect(ok).toBe(false);
    expect(result.current.error).toBe("申请已被处理，请刷新后重试");
    expect(c.removes).toEqual([]); // 已通过申请的附件不得被删除
  });

  it("reapply 换图：保存成功后同样删除旧附件（与 updateReason 同语义）", async () => {
    const c = mockClient([
      fetchOk,
      updateOk, // 重新申请 update
      { error: null }, // 旧附件删除 remove
      emptyOk,
    ]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() =>
      result.current.reapply("lr-1", {
        reason: "再次申请",
        attachment_url: "u1/2-b.jpg",
        old_attachment_url: "u1/1-a.jpg",
      }),
    );
    expect(ok).toBe(true);
    expect(c.removes).toEqual([{ bucket: "leave-attachments", paths: ["u1/1-a.jpg"] }]);
  });

  it("reapply 并发处理后 0 行更新：返回 false、写入 error、旧附件不被误删", async () => {
    // 管理员已并发处理（status 非 rejected），update 匹配 0 行
    const c = mockClient([fetchOk, { data: [], error: null }]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ok = await act(() =>
      result.current.reapply("lr-1", {
        reason: "再次申请",
        attachment_url: "u1/2-b.jpg",
        old_attachment_url: "u1/1-a.jpg",
      }),
    );
    expect(ok).toBe(false);
    expect(result.current.error).toBe("申请已被处理，请刷新后重试");
    expect(c.removes).toEqual([]); // 已处理申请的附件不得被删除
  });

  it("uploadAttachment 上传到私有桶并返回 storage 路径（无公开 URL）", async () => {
    const c = mockClient([fetchOk, { error: null }]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const r = await act(() => result.current.uploadAttachment(new File([], "a.jpg"), "u1"));
    expect(r).toHaveProperty("url");
    expect((r as { url: string }).url).toMatch(/^u1\/\d+-a\.jpg$/);
  });

  it("uploadAttachment 消毒含中文/空格的文件名（Storage InvalidKey）", async () => {
    const c = mockClient([fetchOk, { error: null }]);
    const { result } = renderHook(() => useLeaveRequests(c as never));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const r = await act(() =>
      result.current.uploadAttachment(new File([], "病假证明 2025-11-11.pdf"), "u1"),
    );
    expect(r).toHaveProperty("url");
    // 消毒后 storage key 为纯 ASCII，不含中文/空格，且保留扩展名
    expect(c.uploads[0]).toMatchObject({ bucket: "leave-attachments" });
    expect(c.uploads[0].path).not.toMatch(/[一-龥\s]/);
    expect(c.uploads[0].path).toMatch(/^[A-Za-z0-9._/-]+$/);
    expect(c.uploads[0].path).toContain(".pdf");
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
