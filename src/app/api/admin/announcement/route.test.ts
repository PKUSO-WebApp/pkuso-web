import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * `/api/admin/announcement` 的 0 行更新检测（PUT 与 DELETE 两处，Issue #368）。
 *
 * 命中 0 行时 Supabase 返回 `{ data: null, error: null }`（RLS 静默拒绝 / 公告已被并发删除），
 * 按成功处理就会显示「已更新」「已删除」而库里没变。
 *
 * 桩按真实语义建模：写链上没接 `.select(...)` 就返回 `{ data: null }`。
 */

const h = vi.hoisted(() => ({
  write: { data: [{ id: "a1" }], error: null } as { data: unknown; error: unknown },
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
      order: passthrough,
      update: () => {
        op = "update";
        return o;
      },
      delete: () => {
        op = "delete";
        return o;
      },
      select: () => {
        if (op !== "select") selected = true;
        return o;
      },
      single: () => Promise.resolve({ data: { role: "admin" }, error: null }),
      then: (resolve: (v: unknown) => void) => {
        if (op === "select") return resolve({ data: [], error: null });
        h.writes.push({ table, op, selected });
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

import { PUT, DELETE } from "./route";

const HEADERS = { authorization: "Bearer token", "content-type": "application/json" };

const put = (body: unknown) =>
  PUT(
    new Request("http://localhost/api/admin/announcement", {
      method: "PUT",
      headers: HEADERS,
      body: JSON.stringify(body),
    }),
  );

const del = (body: unknown) =>
  DELETE(
    new Request("http://localhost/api/admin/announcement", {
      method: "DELETE",
      headers: HEADERS,
      body: JSON.stringify(body),
    }),
  );

describe("PUT /api/admin/announcement — 0 行更新检测", () => {
  beforeEach(() => {
    h.write = { data: [{ id: "a1" }], error: null };
    h.writes = [];
  });

  afterEach(() => vi.restoreAllMocks());

  it("命中 1 行 → 200，且写链上接了 .select(...)", async () => {
    const res = await put({ id: "a1", content: "新内容" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(h.writes).toEqual([{ table: "announcements", op: "update", selected: true }]);
  });

  it("命中 0 行 → 非 2xx，报文说清「没有匹配的记录」（不是笼统 500）", async () => {
    h.write = { data: [], error: null };

    const res = await put({ id: "a1", content: "新内容" });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toContain("没有匹配的记录");
  });
});

describe("DELETE /api/admin/announcement — 0 行更新检测", () => {
  beforeEach(() => {
    h.write = { data: [{ id: "a1" }], error: null };
    h.writes = [];
  });

  afterEach(() => vi.restoreAllMocks());

  it("命中 1 行 → 200，且写链上接了 .select(...)", async () => {
    const res = await del({ id: "a1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(h.writes).toEqual([{ table: "announcements", op: "delete", selected: true }]);
  });

  it("命中 0 行 → 非 2xx，报文说清「没有匹配的记录」", async () => {
    h.write = { data: [], error: null };

    const res = await del({ id: "a1" });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toContain("没有匹配的记录");
  });
});
