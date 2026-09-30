import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteScheduleGroup, rollbackGroupAfterInsertFailure } from "./group-ops";

/**
 * 这两个函数是 Issue #368 在预约「组」上的落点，判据只有一条：
 * **0 行不能当成成功**（Supabase 的 delete 命中 0 行时 `error` 是 null）。
 *
 * 返回值是「给用户看的文案」而不是 boolean，所以用例断言的是**文案的指向性** ——
 * 「请稍后重试」（可重试）与「可能已被删除」（重试无意义）、以及回滚失败时必须
 * **说清残留**（否则用户只看到「添加失败」，而列表里悄悄多了一条空组）。
 */

const h = vi.hoisted(() => ({
  /** 依次返回；用完后返回 `{ data: [], error: null }` */
  results: [] as unknown[],
  calls: [] as { table: string; id: string }[],
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      delete: () => ({
        eq: (_col: string, id: string) => ({
          select: async () => {
            h.calls.push({ table, id });
            return h.results.length ? h.results.shift() : { data: [], error: null };
          },
        }),
      }),
    }),
  },
}));

beforeEach(() => {
  h.results.length = 0;
  h.calls.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("deleteScheduleGroup", () => {
  it("删掉 1 行 ⇒ null（成功）", async () => {
    h.results.push({ data: [{ id: "g7" }], error: null });
    await expect(deleteScheduleGroup("g7")).resolves.toBeNull();
    expect(h.calls).toEqual([{ table: "schedule_groups", id: "g7" }]);
  });

  it("**命中 0 行 ⇒ 不算成功**，文案说「可能已被删除」（重试无意义，不能说「请稍后重试」）", async () => {
    h.results.push({ data: [], error: null });
    await expect(deleteScheduleGroup("g7")).resolves.toBe("没有匹配的记录，该预约组可能已被删除");
  });

  it("data 为 null（写链没接 .select 时的形状）也按没删掉处理", async () => {
    h.results.push({ data: null, error: null });
    await expect(deleteScheduleGroup("g7")).resolves.toBe("没有匹配的记录，该预约组可能已被删除");
  });

  it("真报错 ⇒ 文案是「请稍后重试」（网络/权限这类是暂时的）", async () => {
    h.results.push({ data: null, error: { message: "network" } });
    await expect(deleteScheduleGroup("g7")).resolves.toBe("删除预约组失败，请稍后重试");
  });
});

describe("rollbackGroupAfterInsertFailure", () => {
  it("没有 group 可回滚 ⇒ 原文案，且**不发请求**", async () => {
    await expect(rollbackGroupAfterInsertFailure(null)).resolves.toBe("添加预约失败，请重试");
    expect(h.calls).toHaveLength(0);
  });

  it("回滚成功 ⇒ 原文案（库已回到插入前）", async () => {
    h.results.push({ data: [{ id: 9 }], error: null });
    await expect(rollbackGroupAfterInsertFailure("g9")).resolves.toBe("添加预约失败，请重试");
  });

  it("回滚命中 0 行 ⇒ **说清残留**（用户才知道去列表里清掉那条空组）", async () => {
    h.results.push({ data: [], error: null });
    await expect(rollbackGroupAfterInsertFailure("g9")).resolves.toContain(
      "可能残留空的重复预约组",
    );
  });

  it("回滚报错 ⇒ 同样说清残留", async () => {
    h.results.push({ data: null, error: { message: "boom" } });
    await expect(rollbackGroupAfterInsertFailure("g9")).resolves.toContain(
      "可能残留空的重复预约组",
    );
  });
});
