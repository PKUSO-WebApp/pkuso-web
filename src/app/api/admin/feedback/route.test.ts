import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextResponse } from "next/server";
import { DELETE } from "./route";

// 最小 mock：verifyAdmin 成功时返回 service role 客户端的 delete 链
const deleteMock = vi.fn();
const supabaseServerMock = {
  from: vi.fn().mockReturnValue({
    delete: () => ({
      eq: vi.fn().mockReturnThis(),
      select: deleteMock,
    }),
  }),
};

vi.mock("@/lib/verify-admin", () => ({
  verifyAdmin: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabase: vi.fn().mockReturnValue(supabaseServerMock),
}));

import { verifyAdmin } from "@/lib/verify-admin";

describe("DELETE /api/admin/feedback（Issue #210）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (verifyAdmin as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      supabaseServer: supabaseServerMock,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("未授权：verifyAdmin 失败时透传其响应", async () => {
    (verifyAdmin as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "未授权" }, { status: 401 }),
    });
    const res = await DELETE(new Request("http://localhost/api/admin/feedback?id=f1"));
    expect(res.status).toBe(401);
  });

  it("缺少 id 参数 → 400", async () => {
    const res = await DELETE(new Request("http://localhost/api/admin/feedback"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("缺少参数");
  });

  it("删除成功 → { ok: true }", async () => {
    deleteMock.mockResolvedValue({ data: [{ id: "f1" }], error: null });
    const res = await DELETE(new Request("http://localhost/api/admin/feedback?id=f1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("0 行（不存在或已删）→ 404，不误报成功", async () => {
    deleteMock.mockResolvedValue({ data: [], error: null });
    const res = await DELETE(new Request("http://localhost/api/admin/feedback?id=f1"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("反馈不存在或已被删除");
  });

  it("数据库错误 → 500 透传 message", async () => {
    deleteMock.mockResolvedValue({ data: null, error: { message: "db down" } });
    const res = await DELETE(new Request("http://localhost/api/admin/feedback?id=f1"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("db down");
  });
});
