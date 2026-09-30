import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * `/api/admin/reject` 的 0 行更新检测（Issue #368）。
 *
 * Supabase 的 `.update()` 命中 0 行时返回 `{ data: null, error: null }`（RLS 静默拒绝 /
 * 目标已被并发处理）。按成功处理就会对外宣称一件没发生的事：审批界面显示「已驳回」
 * 而库里没变。所以契约要求：写链上必须挂 `.select("id")` 拿回被影响的行，0 行时返回 4xx。
 *
 * 桩按真实语义建模：**写链上没接 `.select(...)` 就返回 `{ data: null }`**
 * —— 于是「去掉 `.select("id")`」会让下面第一条用例由 200 变 404 而变红。
 */

const h = vi.hoisted(() => ({
  /** `profiles.update(...).select("id")` 的返回（用例内改） */
  write: { data: [{ id: "u1" }], error: null } as { data: unknown; error: unknown },
  /** 每次写操作的记录：`selected` 为假说明这条链拿不回被影响的行 */
  writes: [] as { table: string; op: string; selected: boolean }[],
}));

vi.mock("@/lib/supabase-server", () => {
  const builder = (table: string) => {
    let op = "select";
    let selected = false;
    const o: Record<string, unknown> = {};
    const passthrough = () => o;
    Object.assign(o, {
      eq: passthrough,
      update: () => {
        op = "update";
        return o;
      },
      delete: () => {
        op = "delete";
        return o;
      },
      select: () => {
        selected = true;
        return o;
      },
      single: () => Promise.resolve({ data: { role: "admin" }, error: null }),
      then: (resolve: (v: unknown) => void) => {
        if (op === "select") return resolve({ data: null, error: null });
        h.writes.push({ table, op, selected });
        // 没接 .select(...) 的链拿不到行 —— 与真实 SDK 一致
        return resolve(selected ? h.write : { data: null, error: null });
      },
    });
    return o;
  };
  return {
    createServerSupabase: () => ({
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: "admin-1" } }, error: null }),
      },
      from: (table: string) => builder(table),
    }),
  };
});

import { POST } from "./route";

const reject = () =>
  POST(
    new Request("http://localhost/api/admin/reject", {
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: JSON.stringify({ id: "u1" }),
    }),
  );

describe("POST /api/admin/reject — 0 行更新检测", () => {
  beforeEach(() => {
    h.write = { data: [{ id: "u1" }], error: null };
    h.writes = [];
  });

  afterEach(() => vi.restoreAllMocks());

  it("命中 1 行 → 200，且写链上接了 .select(...)（拿回了被影响的行）", async () => {
    const res = await reject();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });

    // 这条断言就是契约第 1 条：写链必须能拿回行。去掉 `.select("id")` 时它会红。
    expect(h.writes).toEqual([{ table: "profiles", op: "update", selected: true }]);
  });

  it("命中 0 行 → 非 2xx，报文说清「没有匹配的记录」（不是笼统 500）", async () => {
    h.write = { data: [], error: null };

    const res = await reject();
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("没有匹配的记录");
  });

  it("写操作报错 → 500 并透传 Supabase 的错误信息（错误路径不回归）", async () => {
    h.write = { data: null, error: { message: "permission denied" } };

    const res = await reject();
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toBe("permission denied");
  });
});
