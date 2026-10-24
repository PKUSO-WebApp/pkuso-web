import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const ID_1 = "11111111-1111-4111-8111-111111111111";
const ID_2 = "22222222-2222-4222-8222-222222222222";

const h = vi.hoisted(() => {
  const chain: Record<string, unknown> = {};
  const select = vi.fn((...args: unknown[]) => {
    void args;
    return chain;
  });
  const inFilter = vi.fn((...args: unknown[]) => {
    void args;
    return chain;
  });
  const order = vi.fn();
  Object.assign(chain, { select, in: inFilter, order });
  return { chain, select, inFilter, order, rpc: vi.fn(), from: vi.fn() };
});

vi.mock("@/lib/verify-admin", () => ({ verifyAdmin: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ createServerSupabase: vi.fn() }));

import { verifyAdmin } from "@/lib/verify-admin";
import { GET, POST } from "./route";

const invokeGet = () =>
  GET(
    new Request("http://localhost/api/admin/attendance-requests", {
      method: "GET",
      headers: { authorization: "Bearer token" },
    }),
  );

const invokePost = (body: unknown) =>
  POST(
    new Request("http://localhost/api/admin/attendance-requests", {
      method: "POST",
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

describe("/api/admin/attendance-requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.from.mockReturnValue(h.chain);
    h.order.mockResolvedValue({ data: [], error: null });
    h.rpc.mockResolvedValue({ data: { ok: true, status: "approved" }, error: null });
    (verifyAdmin as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      supabaseServer: { from: h.from, rpc: h.rpc },
      userId: "admin-uuid",
    });
  });

  it("GET 只查 pending/approved/rejected，并 join 成员与排练", async () => {
    h.order.mockResolvedValue({
      data: [{ id: ID_1, status: "pending", target: { full_name: "张三" } }],
      error: null,
    });
    const res = await invokeGet();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      requests: [{ id: ID_1, status: "pending", target: { full_name: "张三" } }],
    });
    expect(h.from).toHaveBeenCalledWith("attendance_change_requests");
    const select = h.select.mock.calls[0]?.[0] as string;
    expect(select).toContain("target:profiles!attendance_change_requests_target_user_id_fkey");
    expect(select).toContain("requester:profiles!attendance_change_requests_requested_by_fkey");
    expect(select).toContain("decider:profiles!attendance_change_requests_decided_by_fkey");
    expect(select).toContain(
      "rehearsals(repertoire, title, start_time, end_time, type, target_section)",
    );
    expect(h.inFilter).toHaveBeenCalledWith("status", ["pending", "approved", "rejected"]);
    expect(h.order).toHaveBeenCalledWith("created_at", { ascending: false });
  });

  it("GET 查询失败回 500 且不泄露英文原文", async () => {
    h.order.mockResolvedValue({ data: null, error: { message: "relation does not exist" } });
    const res = await invokeGet();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "获取考勤修改申请失败" });
  });

  it("approve 默认 force=false，逐条调用 RPC，actor 取登录 admin", async () => {
    const res = await invokePost({ action: "approve", ids: [ID_1, ID_2] });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: [
        { id: ID_1, ok: true, status: "approved" },
        { id: ID_2, ok: true, status: "approved" },
      ],
    });
    expect(h.rpc).toHaveBeenNthCalledWith(1, "admin_decide_attendance_change_request", {
      p_request_id: ID_1,
      p_approve: true,
      p_reject_reason: "",
      p_force: false,
      p_actor_id: "admin-uuid",
    });
    expect(h.rpc).toHaveBeenNthCalledWith(2, "admin_decide_attendance_change_request", {
      p_request_id: ID_2,
      p_approve: true,
      p_reject_reason: "",
      p_force: false,
      p_actor_id: "admin-uuid",
    });
  });

  it("approve force=true 会透传 p_force", async () => {
    await invokePost({ action: "approve", ids: [ID_1], force: true });
    expect(h.rpc).toHaveBeenCalledWith(
      "admin_decide_attendance_change_request",
      expect.objectContaining({ p_force: true }),
    );
  });

  it("reject 必带原因，同一原因应用到全部", async () => {
    h.rpc.mockResolvedValue({ data: { ok: true, status: "rejected" }, error: null });
    const res = await invokePost({
      action: "reject",
      ids: [ID_1, ID_2],
      rejectReason: "材料不全",
    });

    expect(res.status).toBe(200);
    expect(h.rpc).toHaveBeenCalledTimes(2);
    expect(h.rpc).toHaveBeenCalledWith(
      "admin_decide_attendance_change_request",
      expect.objectContaining({
        p_approve: false,
        p_reject_reason: "材料不全",
        p_force: false,
      }),
    );
  });

  it("stale 结果原样带回 current_status", async () => {
    h.rpc.mockResolvedValue({
      data: { ok: false, code: "stale", current_status: "present" },
      error: null,
    });
    const res = await invokePost({ action: "approve", ids: [ID_1] });
    expect(await res.json()).toEqual({
      results: [{ id: ID_1, ok: false, code: "stale", currentStatus: "present" }],
    });
  });

  it("RPC 报错逐条记录 rpc_error，不中断整批", async () => {
    h.rpc
      .mockResolvedValueOnce({ data: null, error: { message: "boom" } })
      .mockResolvedValueOnce({ data: { ok: true, status: "approved" }, error: null });
    const res = await invokePost({ action: "approve", ids: [ID_1, ID_2] });
    expect(await res.json()).toEqual({
      results: [
        { id: ID_1, ok: false, code: "rpc_error" },
        { id: ID_2, ok: true, status: "approved" },
      ],
    });
  });

  it("42501 映射为 actor_not_admin，不把原始 DB 文案回给浏览器", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "actor_not_admin" } });
    const res = await invokePost({ action: "approve", ids: [ID_1] });
    expect(await res.json()).toEqual({
      results: [{ id: ID_1, ok: false, code: "actor_not_admin" }],
    });
  });

  it("单条 RPC 抛异常只记该条失败，不吞掉同批已成功的 id", async () => {
    h.rpc
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ data: { ok: true, status: "approved" }, error: null });
    const res = await invokePost({ action: "approve", ids: [ID_1, ID_2] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: [
        { id: ID_1, ok: false, code: "rpc_error" },
        { id: ID_2, ok: true, status: "approved" },
      ],
    });
  });

  it("非法参数一律 400，不调 RPC", async () => {
    expect((await invokePost({ action: "approve", ids: [] })).status).toBe(400);
    expect((await invokePost({ action: "approve", ids: ["abc"] })).status).toBe(400);
    expect((await invokePost({ action: "reject", ids: [ID_1] })).status).toBe(400);
    expect((await invokePost({ action: "reject", ids: [ID_1], rejectReason: " " })).status).toBe(
      400,
    );
    expect(
      (await invokePost({ action: "approve", ids: Array.from({ length: 51 }, () => ID_1) })).status,
    ).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("请求体不是 JSON → 400", async () => {
    const res = await POST(
      new Request("http://localhost/api/admin/attendance-requests", {
        method: "POST",
        headers: { authorization: "Bearer token", "content-type": "application/json" },
        body: "{",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("verifyAdmin 拒绝时原样透传", async () => {
    (verifyAdmin as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "权限不足" }, { status: 403 }),
    });
    const res = await invokePost({ action: "approve", ids: [ID_1] });
    expect(res.status).toBe(403);
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
