import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextResponse } from "next/server";
import { EMAIL_SIGNATURE_KEY } from "@/lib/email-signature";
import {
  EMAIL_TEMPLATE_FULL_SUBJECT_KEY,
  EMAIL_TEMPLATE_FULL_BODY_KEY,
} from "@/lib/email-template";

/**
 * `/api/admin/settings` 保存空值这条路（Issue #368）。
 *
 * ⚠️ **本处的结论与「定向写」那一类相反：0 行按成功处理。** 保存空值走的是
 * 「让这个键不存在」这条**幂等**路，它不是「删除某条已知存在的记录」——
 * 0 行 == 目标状态已达成。判据与回归场景见下面那条 `email-settings` 用例。
 *
 * `app_settings` 的主键是 `key`（没有 id 列），所以返回行取 `key`
 * —— 合约里的「或等价的返回行」，它仍要在写链上（判据：`.select(...)` 出现在写之后）。
 */

const h = vi.hoisted(() => ({
  write: { data: [{ key: "sig" }], error: null } as { data: unknown; error: unknown },
  writes: [] as { table: string; op: string; cols: string | undefined; selected: boolean }[],
}));

const supabaseServerMock = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("@/lib/verify-admin", () => ({ verifyAdmin: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({
  createServerSupabase: vi.fn().mockReturnValue({}),
}));

import { verifyAdmin } from "@/lib/verify-admin";
import { PUT } from "./route";

const invoke = (body: unknown) =>
  PUT(
    new Request("http://localhost/api/admin/settings", {
      method: "PUT",
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

describe("PUT /api/admin/settings — 清空设置项时的 0 行检测", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.write = { data: [{ key: EMAIL_SIGNATURE_KEY }], error: null };
    h.writes = [];
    (verifyAdmin as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      supabaseServer: supabaseServerMock,
    });
    // ⚠️ 必须接住真实的表名：把表名写成字面量的话，`{ table: "app_settings" }` 那几条
    // 断言会**恒为真** —— 实测把 route 里的 `.from("app_settings")` 改成别的表，用例照样绿。
    supabaseServerMock.from.mockImplementation((table: string) => {
      let op = "select";
      let cols: string | undefined;
      let selected = false;
      const o: Record<string, unknown> = {};
      const passthrough = () => o;
      Object.assign(o, {
        eq: passthrough,
        upsert: () => {
          op = "upsert";
          return o;
        },
        delete: () => {
          op = "delete";
          return o;
        },
        select: (c?: string) => {
          if (op !== "select") selected = true;
          cols = c ?? cols;
          return o;
        },
        then: (resolve: (v: unknown) => void) => {
          if (op !== "delete") return resolve({ data: null, error: null });
          h.writes.push({ table, op, cols, selected });
          return resolve(selected ? h.write : { data: null, error: null });
        },
      });
      return o;
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("命中 1 行 → 200，且写链上接了 .select(...)（用主键 key 拿回被删的行）", async () => {
    const res = await invoke({ key: EMAIL_SIGNATURE_KEY, value: "" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(h.writes).toEqual([
      { table: "app_settings", op: "delete", cols: "key", selected: true },
    ]);
  });

  it("命中 0 行（这个键本来就不存在）→ 与命中 1 行**同样的成功响应**", async () => {
    h.write = { data: [], error: null };

    const res = await invoke({ key: EMAIL_SIGNATURE_KEY, value: "   " });

    // 「让它不存在」这个意图已经达成 ⇒ 不是失败。返回体必须与命中 1 行时逐字一致。
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    // 写链仍要能拿回被影响的行（契约第 1 条；去掉 `.select("key")` 时这条会红）
    expect(h.writes).toEqual([
      { table: "app_settings", op: "delete", cols: "key", selected: true },
    ]);
  });

  it("回归：email-settings 整 tab 全字段保存时，从未设置过的键存空值**不该报错**", async () => {
    // `email-settings/page.tsx` 的 `handleSave` 是
    //   `Promise.all([saveSetting(subjectKey, subject), saveSetting(bodyKey, body)])`
    // —— 任一 reject 整次保存就显示「保存失败，请重试」。而 `fetchSettings` 会把
    // 不存在的键补成 null ⇒ 首次配置时字段本来就是空的。若 0 行判失败，
    // 「留空 + 保存」会由「已保存」变成「保存失败」（这正是本次要钉住的回归）。
    h.write = { data: [], error: null }; // 两个键都从来没有过 ⇒ 两次都命中 0 行

    const [subject, body] = await Promise.all([
      invoke({ key: EMAIL_TEMPLATE_FULL_SUBJECT_KEY, value: "" }),
      invoke({ key: EMAIL_TEMPLATE_FULL_BODY_KEY, value: "  " }),
    ]);

    expect(subject.status).toBe(200);
    expect(body.status).toBe(200);
    expect(await subject.json()).toEqual({ success: true });
    expect(await body.json()).toEqual({ success: true });
  });

  it("未授权时透传 verifyAdmin 的响应（不回归）", async () => {
    (verifyAdmin as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "未授权" }, { status: 401 }),
    });

    const res = await invoke({ key: EMAIL_SIGNATURE_KEY, value: "" });
    expect(res.status).toBe(401);
    expect(h.writes).toEqual([]);
  });
});
