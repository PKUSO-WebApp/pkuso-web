import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `removeSheetMusicObjects` 的两个上限与三条出口（#378）：
 * - `list` 分页（>1000 页的长总谱，尾部页图不能漏）
 * - `remove` 分块（单次上限 1000 个对象，整批塞会被**整批拒绝** ⇒ 连 PDF 都删不掉）
 * - `list` / `remove` 失败都只 warn、不抛（best-effort 语义不变）
 *
 * 页面测试里的桩固定返回空数组（模拟老文件、不关心页图），钉不住这些出口——所以单独测。
 */
const h = vi.hoisted(() => ({
  /** 前缀 → 该前缀下的对象名（按 name 升序，与 Storage 默认排序一致） */
  objects: {} as Record<string, string[]>,
  listCalls: [] as { prefix: string; limit: number; offset: number }[],
  /** 这些前缀的 list 返回 error */
  listFailFor: [] as string[],
  removeBatches: [] as string[][],
  removeFails: false,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    storage: {
      from: () => ({
        list: (prefix: string, opts: { limit: number; offset: number }) => {
          h.listCalls.push({ prefix, limit: opts.limit, offset: opts.offset });
          if (h.listFailFor.includes(prefix)) {
            return Promise.resolve({ data: null, error: { message: "list boom" } });
          }
          const all = h.objects[prefix] ?? [];
          return Promise.resolve({
            data: all.slice(opts.offset, opts.offset + opts.limit).map((name) => ({ name })),
            error: null,
          });
        },
        remove: (paths: string[]) => {
          h.removeBatches.push(paths);
          return Promise.resolve({
            data: null,
            error: h.removeFails ? { message: "remove boom" } : null,
          });
        },
      }),
    },
  },
}));

import { removeSheetMusicObjects } from "./storage-cleanup";

beforeEach(() => {
  h.objects = {};
  h.listCalls.length = 0;
  h.listFailFor = [];
  h.removeBatches.length = 0;
  h.removeFails = false;
});

describe("removeSheetMusicObjects（#378 契约第 8 条）", () => {
  it("连同前缀下的全部页图一起删；>1000 页时 list 翻页 + remove 分块都取全", async () => {
    const prefix = "score-1/file-1/";
    h.objects[prefix] = Array.from({ length: 1200 }, (_, i) => `p${i + 1}.jpg`);

    await removeSheetMusicObjects(["score-1/file-1.pdf"]);

    // list 翻了两页（1200 > 1000），offset 单调
    expect(h.listCalls.map((c) => c.offset)).toEqual([0, 1000]);
    // remove 分了块（1 + 1200 > 1000），凑起来正好是「PDF 本体 + 全部页图」且无重复
    const removed = h.removeBatches.flat();
    expect(removed).toHaveLength(1201);
    expect(new Set(removed).size).toBe(1201);
    expect(removed[0]).toBe("score-1/file-1.pdf");
    expect(removed).toContain(`${prefix}p1.jpg`);
    expect(removed).toContain(`${prefix}p1200.jpg`);
    // 每一批都不超过单次上限（整批塞会被整批拒绝，这条钉的就是它）
    expect(h.removeBatches.every((b) => b.length <= 1000)).toBe(true);
  });

  it("老文件（无页图）：只删 PDF 本身", async () => {
    await removeSheetMusicObjects(["score-1/file-2.pdf"]);
    expect(h.removeBatches.flat()).toEqual(["score-1/file-2.pdf"]);
  });

  it("list 失败：只 warn、不抛，PDF 本体照删", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.listFailFor = ["score-1/file-3/"];

    await expect(removeSheetMusicObjects(["score-1/file-3.pdf"])).resolves.toBeUndefined();

    expect(h.removeBatches.flat()).toEqual(["score-1/file-3.pdf"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("remove 失败：只 warn、不抛", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.removeFails = true;

    await expect(removeSheetMusicObjects(["score-1/file-4.pdf"])).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
