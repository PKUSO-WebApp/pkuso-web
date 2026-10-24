import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/lib/verify-admin", () => ({ verifyAdmin: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ createServerSupabase: vi.fn() }));

import { verifyAdmin } from "@/lib/verify-admin";
import { POST } from "./route";

const invoke = (body: unknown) =>
  POST(
    new Request("http://localhost/api/admin/section-leadership", {
      method: "POST",
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

describe("POST /api/admin/section-leadership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.rpc.mockResolvedValue({ data: null, error: null });
    (verifyAdmin as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      supabaseServer: { rpc: h.rpc },
      userId: "admin-1",
    });
  });

  it("声部长：调用 admin_set_section_leader，actor 取真实登录 admin", async () => {
    const res = await invoke({
      action: "set_section_leader",
      section: "木管",
      userId: "leader-1",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(h.rpc).toHaveBeenCalledWith("admin_set_section_leader", {
      p_section: "木管",
      p_leader_id: "leader-1",
      p_actor_id: "admin-1",
    });
  });

  it("撤销声部长：调用 admin_remove_section_leader", async () => {
    const res = await invoke({ action: "remove_section_leader", section: "木管" });
    expect(res.status).toBe(200);
    expect(h.rpc).toHaveBeenCalledWith("admin_remove_section_leader", {
      p_section: "木管",
      p_actor_id: "admin-1",
    });
  });

  it("首席：调用 admin_set_principal", async () => {
    const res = await invoke({
      action: "set_principal",
      instrument: "长笛",
      userId: "principal-1",
    });
    expect(res.status).toBe(200);
    expect(h.rpc).toHaveBeenCalledWith("admin_set_principal", {
      p_instrument: "长笛",
      p_principal_id: "principal-1",
      p_actor_id: "admin-1",
    });
  });

  it("撤销首席：调用 admin_remove_principal", async () => {
    const res = await invoke({ action: "remove_principal", instrument: "长笛" });
    expect(res.status).toBe(200);
    expect(h.rpc).toHaveBeenCalledWith("admin_remove_principal", {
      p_instrument: "长笛",
      p_actor_id: "admin-1",
    });
  });

  it("未知 action 或缺字段 → 400，不调 RPC", async () => {
    expect((await invoke({ action: "nope" })).status).toBe(400);
    expect((await invoke({ action: "set_section_leader", section: "" })).status).toBe(400);
    expect((await invoke({ action: "set_principal", instrument: "长笛" })).status).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("请求体不是 JSON → 400", async () => {
    const res = await POST(
      new Request("http://localhost/api/admin/section-leadership", {
        method: "POST",
        headers: { authorization: "Bearer token", "content-type": "application/json" },
        body: "{",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("DB 业务错误按前缀映射成中文并回传 code", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "scope_overlap" } });
    const res = await invoke({ action: "set_section_leader", section: "木管", userId: "u1" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "该作用域与已有任命冲突，请先撤销冲突项",
      code: "scope_overlap",
    });
  });

  it("42501 映射为 403；未知错误映射为 500", async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: "boom", code: "42501" } });
    const forbidden = await invoke({ action: "remove_principal", instrument: "长笛" });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "权限不足", code: undefined });

    h.rpc.mockResolvedValueOnce({ data: null, error: { message: "unexpected" } });
    const failed = await invoke({ action: "remove_principal", instrument: "长笛" });
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "保存失败，请重试", code: undefined });
  });

  it("verifyAdmin 拒绝时原样透传响应", async () => {
    (verifyAdmin as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "未授权" }, { status: 401 }),
    });
    const res = await invoke({ action: "remove_principal", instrument: "长笛" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "未授权" });
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
