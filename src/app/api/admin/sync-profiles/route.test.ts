import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * `/api/admin/sync-profiles` 的 0 行更新检测（Issue #368）。
 *
 * 逐个 `profiles.update(...)` 命中 0 行时 Supabase 返回 `{ data: null, error: null }`
 * （RLS 静默拒绝 / 行已被并发删除）。按成功处理会有两个后果：
 * 把它计进 `updatedCount`（对外报「更新 N 人」），并继续去改 **Auth 层邮箱** ——
 * 后者是改另一张表，属于「0 行检测之后才该发生的副作用」。
 */

const h = vi.hoisted(() => ({
  /** 按 id 指定每个人的 update 命中情况；缺省 = 命中 1 行 */
  hits: {} as Record<string, boolean>,
  /** 按 id 指定写操作报错；优先级高于 hits */
  writeErrors: {} as Record<string, string>,
  /** 每次 profiles 写操作的记录 */
  writes: [] as { id: unknown; selected: boolean }[],
  /** Auth 层邮箱同步的入参 */
  authUpdates: [] as { id: string; email: string }[],
  /** 返回给主流程的 approved profiles */
  profiles: [
    { id: "p1", full_name: "张三", email: null, instrument: null, college: null },
    { id: "p2", full_name: "李四", email: "old@b.c", instrument: null, college: null },
  ],
}));

vi.mock("@/lib/supabase-server", () => {
  const builder = (table: string) => {
    let op = "select";
    let cols: string | undefined;
    let selected = false;
    const filters: { col: string; value: unknown }[] = [];
    const o: Record<string, unknown> = {};
    Object.assign(o, {
      eq: (col: string, value: unknown) => {
        filters.push({ col, value });
        return o;
      },
      update: () => {
        op = "update";
        return o;
      },
      select: (c?: string) => {
        if (op !== "select") selected = true;
        cols = c ?? cols;
        return o;
      },
      single: () => Promise.resolve({ data: { role: "admin" }, error: null }),
      then: (resolve: (v: unknown) => void) => {
        if (op === "select") {
          if (cols === "role") return resolve({ data: { role: "admin" }, error: null });
          if (table === "member_info") {
            return resolve({
              data: [
                { full_name: "张三", email: "zs@b.c", instrument_name: "小提琴", college: "元培" },
                { full_name: "李四", email: "ls@b.c", instrument_name: "中提琴", college: "光华" },
              ],
              error: null,
            });
          }
          return resolve({ data: h.profiles, error: null });
        }
        const id = filters.find((f) => f.col === "id")?.value;
        h.writes.push({ id, selected });
        if (!selected) return resolve({ data: null, error: null });
        const err = h.writeErrors[String(id)];
        if (err) return resolve({ data: null, error: { message: err } });
        const hit = h.hits[String(id)] !== false;
        return resolve({ data: hit ? [{ id }] : [], error: null });
      },
    });
    return o;
  };

  return {
    createServerSupabase: () => ({
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: "admin-1" } }, error: null }),
        admin: {
          updateUserById: (id: string, attrs: { email: string }) => {
            h.authUpdates.push({ id, email: attrs.email });
            return Promise.resolve({ error: null });
          },
        },
      },
      from: (table: string) => builder(table),
    }),
  };
});

import { POST } from "./route";

const sync = () =>
  POST(
    new Request("http://localhost/api/admin/sync-profiles", {
      method: "POST",
      headers: { authorization: "Bearer token" },
    }),
  );

describe("POST /api/admin/sync-profiles — 0 行更新检测", () => {
  beforeEach(() => {
    h.hits = {};
    h.writeErrors = {};
    h.writes = [];
    h.authUpdates = [];
    h.profiles = [
      { id: "p1", full_name: "张三", email: null, instrument: null, college: null },
      { id: "p2", full_name: "李四", email: "old@b.c", instrument: null, college: null },
    ];
  });

  afterEach(() => vi.restoreAllMocks());

  it("全部命中 → updated 计数正确，写链带 .select(...)，且 Auth 邮箱照常同步（不回归）", async () => {
    const body = (await (await sync()).json()) as { updated: number; errors: number };

    expect(body.updated).toBe(2);
    expect(body.errors).toBe(0);
    expect(h.writes).toEqual([
      { id: "p1", selected: true },
      { id: "p2", selected: true },
    ]);
    // p2 的邮箱变了 → 同步到 Auth 层（p1 的 member_info 邮箱也是新值，所以两条都进）
    expect(h.authUpdates.map((u) => u.id)).toEqual(["p1", "p2"]);
  });

  it("某人命中 0 行 → 计进 errors（不报成 updated），**且不去改 Auth 层邮箱**", async () => {
    h.hits = { p2: false };

    const body = (await (await sync()).json()) as {
      updated: number;
      errors: number;
      details?: string[];
    };

    // p2 那行没更新成功 ⇒ 不能算进 updatedCount（原来会假成功）
    expect(body.updated).toBe(1);
    expect(body.errors).toBe(1);
    expect(body.details?.join(" ")).toContain("没有匹配的记录");
    // 0 行检测之后的副作用：p2 的 Auth 邮箱**不能**被改 —— 那是在宣称一件没发生的事
    expect(h.authUpdates.map((u) => u.id)).toEqual(["p1"]);
  });

  it("写操作报错 → 计进 errors、透传错误信息且不改 Auth 层邮箱（错误路径不回归）", async () => {
    h.writeErrors = { p2: "permission denied" };

    const body = (await (await sync()).json()) as {
      updated: number;
      errors: number;
      details?: string[];
    };

    expect(body.updated).toBe(1);
    expect(body.errors).toBe(1);
    expect(body.details?.join(" ")).toContain("permission denied");
    expect(h.authUpdates.map((u) => u.id)).toEqual(["p1"]);
  });
});
