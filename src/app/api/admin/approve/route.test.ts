import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * `/api/admin/approve` 的 0 行更新检测（两处，Issue #368）：
 *
 * 1. 主流程的 `status: "approved"` —— 0 行时返回 4xx（审批界面不能显示「已批准」而库里没变）
 * 2. `member_info` 预填 profile —— 预填本身是 best-effort（失败不影响批准），
 *    但 0 行时**不能**打「已预填」那句成功日志：那会把一次没生效的写入记成成功
 *
 * 桩按真实语义建模：写链上没接 `.select(...)` 就返回 `{ data: null }`。
 */

type Row = Record<string, unknown>;
type Res = { data: unknown; error: unknown };

const h = vi.hoisted(() => ({
  /** 主流程 `profiles.update({status}).select("id")` 的返回 */
  approve: { data: [{ id: "u1" }], error: null } as Res,
  /** 预填 `profiles.update(updates).select("id")` 的返回 */
  prefill: { data: [{ id: "u1" }], error: null } as Res,
  /** 预填的三次读取 */
  targetProfile: { full_name: "张三" } as Row | null,
  memberInfo: { email: "a@b.c", instrument_name: "小提琴", college: "元培" } as Row | null,
  fullProfile: { email: null, instrument: null, college: null } as Row | null,
  /** 每次写操作的记录：`selected` 为假说明这条链拿不回被影响的行 */
  writes: [] as { table: string; cols: string | undefined; selected: boolean; payload: Row }[],
}));

vi.mock("@/lib/supabase-server", () => {
  const builder = (table: string) => {
    let op = "select";
    let cols: string | undefined;
    let payload: Row = {};
    let selected = false;
    const o: Record<string, unknown> = {};
    const passthrough = () => o;
    Object.assign(o, {
      eq: passthrough,
      update: (p: Row) => {
        op = "update";
        payload = p;
        return o;
      },
      select: (c?: string) => {
        if (op !== "select") selected = true; // 写链上的 .select(...)
        cols = c ?? cols;
        return o;
      },
      single: () => {
        if (table === "member_info") return Promise.resolve({ data: h.memberInfo, error: null });
        if (cols === "role") return Promise.resolve({ data: { role: "admin" }, error: null });
        if (cols === "full_name") return Promise.resolve({ data: h.targetProfile, error: null });
        return Promise.resolve({ data: h.fullProfile, error: null });
      },
      then: (resolve: (v: unknown) => void) => {
        if (op !== "update") return resolve({ data: null, error: null });
        h.writes.push({ table, cols, selected, payload });
        // 没接 .select(...) 的链拿不到行 —— 与真实 SDK 一致
        if (!selected) return resolve({ data: null, error: null });
        // 带 `status` 的是主流程那次，其余是预填那次
        return resolve("status" in payload ? h.approve : h.prefill);
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

const approve = () =>
  POST(
    new Request("http://localhost/api/admin/approve", {
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: JSON.stringify({ id: "u1" }),
    }),
  );

describe("POST /api/admin/approve — 0 行更新检测", () => {
  beforeEach(() => {
    h.approve = { data: [{ id: "u1" }], error: null };
    h.prefill = { data: [{ id: "u1" }], error: null };
    h.targetProfile = { full_name: "张三" };
    h.memberInfo = { email: "a@b.c", instrument_name: "小提琴", college: "元培" };
    h.fullProfile = { email: null, instrument: null, college: null };
    h.writes = [];
  });

  afterEach(() => vi.restoreAllMocks());

  it("主流程命中 1 行 → 200，且两处写链都接了 .select(...)", async () => {
    const res = await approve();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });

    // 契约第 1 条：写链必须能拿回被影响的行。去掉任一处的 `.select("id")` 都会红。
    expect(h.writes).toEqual([
      { table: "profiles", cols: "id", selected: true, payload: { status: "approved" } },
      {
        table: "profiles",
        cols: "id",
        selected: true,
        payload: { email: "a@b.c", instrument: "小提琴", college: "元培" },
      },
    ]);
  });

  it("主流程命中 0 行 → 非 2xx，报文说清「没有匹配的记录」（不是笼统 500）", async () => {
    h.approve = { data: [], error: null };

    const res = await approve();
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toContain("没有匹配的记录");
  });

  it("预填命中 0 行 → 批准仍 200（best-effort），但**不**打「已预填」的成功日志", async () => {
    h.prefill = { data: [], error: null };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await approve();

    // 预填失败不拖累批准本身（既有行为，回归）
    expect(res.status).toBe(200);
    // 0 行不能按成功处理：那句「已从 member_info 预填 profile」是在宣称一件没发生的事
    expect(log.mock.calls.flat().join(" ")).not.toContain("已从 member_info 预填 profile");
    expect(err.mock.calls.flat().join(" ")).toContain("预填 profile 失败");
  });

  it("预填命中 1 行 → 照常打成功日志（成功路径不回归）", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await approve();

    expect(res.status).toBe(200);
    expect(log.mock.calls.flat().join(" ")).toContain("已从 member_info 预填 profile");
  });
});
