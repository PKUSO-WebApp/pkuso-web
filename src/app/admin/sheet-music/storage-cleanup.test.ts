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
  /** `sheet_music_files` 的读桩（#387 的两个新函数全靠它判断） */
  rows: [] as { part_id: string | null; file_name: string; storage_path: string }[],
  /** 每次读的 `.in(列, 值)` 入参 —— 按什么查、有没有分块都看它 */
  readIns: [] as { col: string; values: unknown[] }[],
  readFails: false,
  /** 落库次数 —— 「被堵住时连请求都发不出去」看它 */
  upserts: 0,
  /** 这一次 upsert 永不 settle（模拟对端静默不回包）：队头阻塞那条用例用 */
  hangUpsertOnce: false,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    // 读桩**不实现过滤**：整表回给调用方 —— 真库里由 PostgREST 过滤，而调用方自己还要在
    // 内存里挑精确配对（`part_id` + `file_name`），这里要验的正是它挑得对不对。
    from: () => ({
      select: () => ({
        in: (col: string, values: unknown[]) => {
          h.readIns.push({ col, values });
          return Promise.resolve(
            h.readFails
              ? { data: null, error: { message: "read boom" } }
              : { data: h.rows, error: null },
          );
        },
      }),
      // 落库桩是**有状态**的：写进去的行就是后面读得到的行（唯一约束怎么换行也在这里模拟）。
      // ⚠️ 工厂里不能引 `pairKey`（`vi.mock` 被提升，引了会炸）—— 键在这里就地拼一遍。
      upsert: (rows: { part_id?: string | null; file_name: string; storage_path: string }[]) => {
        h.upserts += 1;
        if (h.hangUpsertOnce) {
          h.hangUpsertOnce = false;
          return new Promise(() => {}); // 对端静默不回包：这一次落库永不 settle
        }
        for (const r of rows) {
          const key = `${r.part_id ?? ""}\n${r.file_name}`;
          h.rows = h.rows.filter((x) => `${x.part_id ?? ""}\n${x.file_name}` !== key);
          h.rows.push({
            part_id: r.part_id ?? null,
            file_name: r.file_name,
            storage_path: r.storage_path,
          });
        }
        return Promise.resolve({ error: null });
      },
    }),
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

import {
  dropUnreferencedStorageObjects,
  removeSheetMusicObjects,
  replacedStoragePaths,
  storeSheetMusicFiles,
  STORE_QUEUE_TIMEOUT_MS,
} from "./storage-cleanup";

beforeEach(() => {
  h.objects = {};
  h.listCalls.length = 0;
  h.listFailFor = [];
  h.removeBatches.length = 0;
  h.removeFails = false;
  h.rows = [];
  h.readIns.length = 0;
  h.readFails = false;
  h.upserts = 0;
  h.hangUpsertOnce = false;
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

/**
 * 被 `upsert` 替换掉的旧对象（#387）。
 *
 * `upsert(rows, { onConflict: "part_id,file_name" })` 对同一个声部下的同名文件是**更新**：
 * 那行的 `storage_path` 被改成新对象，旧对象（PDF + 它的页图）再没有任何行引用 ——
 * 而删除路径是按行枚举对象的，于是它永远删不掉（dev 桶里那个孤儿就是这么来的）。
 */
describe("被替换掉的旧对象（#387）", () => {
  it("挑出将被替换的路径：只认精确的 (part_id, file_name)，且排除本次要写的新路径", async () => {
    h.rows = [
      // 会被替换：同名同声部，指向另一个对象
      { part_id: "p1", file_name: "大提琴.pdf", storage_path: "s1/old.pdf" },
      // 同一个声部、但这次要写的路径与它现有的一致（= 同一个 storageId 的重试）⇒ 不能删
      { part_id: "p1", file_name: "低音提琴.pdf", storage_path: "s1/same.pdf" },
      // 别的声部下的同名文件：`.in(part_id).in(file_name)` 的笛卡尔积会把它捞进来，必须挑掉
      { part_id: "p2", file_name: "大提琴.pdf", storage_path: "s1/other.pdf" },
      // `part_id` 可空（生成类型就是 `string | null`）：NULL 在唯一索引里互不相等，
      // 这次 upsert 匹配不到它 ⇒ 它不可能被替换，别把它的对象也捎上
      { part_id: null, file_name: "长笛.pdf", storage_path: "s1/nullpart.pdf" },
    ];

    const got = await replacedStoragePaths(
      [
        { part_id: "p1", file_name: "大提琴.pdf" },
        { part_id: "p1", file_name: "低音提琴.pdf" },
        { part_id: null, file_name: "长笛.pdf" },
      ],
      new Set(["s1/same.pdf", "s1/new.pdf"]),
    );

    expect(got).toEqual(["s1/old.pdf"]);
    // 按 part_id 查（不是两个 `.in` 的笛卡尔积），且只查这批落点涉及的声部（去重）
    expect(h.readIns).toEqual([{ col: "part_id", values: ["p1"] }]);
  });

  it("读失败 → 返回空数组（这次少删一次），只 warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.readFails = true;

    await expect(
      replacedStoragePaths([{ part_id: "p1", file_name: "大提琴.pdf" }], new Set(["s1/new.pdf"])),
    ).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("删除前看**库里现在的引用**：仍被别的行指着的路径一个都不删", async () => {
    h.objects["s1/old/"] = ["p1.jpg", "p2.jpg"];
    // 这条路径还有行指着（比如并发落库、历史数据）—— 删了就是「下载 404」，比留孤儿糟
    h.rows = [{ part_id: "p9", file_name: "别的.pdf", storage_path: "s1/still.pdf" }];

    await dropUnreferencedStorageObjects(["s1/old.pdf", "s1/still.pdf"]);

    const removed = h.removeBatches.flat();
    expect(removed).toContain("s1/old.pdf");
    // 连同页图一起删
    expect(removed).toContain("s1/old/p1.jpg");
    expect(removed).toContain("s1/old/p2.jpg");
    expect(removed).not.toContain("s1/still.pdf");
  });

  it("查引用失败 → 一个都不删（宁可留可见的孤儿，不误删别人在用的对象）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.readFails = true;

    await dropUnreferencedStorageObjects(["s1/old.pdf"]);

    expect(h.removeBatches).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("空输入不发任何请求（上传路径上「没有同名旧行」是绝大多数情况）", async () => {
    await replacedStoragePaths([], new Set(["s1/new.pdf"]));
    await dropUnreferencedStorageObjects([]);
    expect(h.readIns).toEqual([]);
    expect(h.removeBatches).toEqual([]);
  });

  it("两次落库落在同一个 (part_id, file_name)：串行跑，后一次收掉前一次那份（#387 对抗）", async () => {
    // 跨行重名（同一批里两行算到同一个落点）时两行会**同时在飞**（PIPELINE_CONCURRENCY）。
    // 若不串行：两边都先读到「还没有行」，各自 upsert 后各自复查 —— 先写那份对象被挤掉而两次
    // 复查都发生在对方写之前，于是谁都不认领它。串行之后第二次读看得见第一次写，它就成了
    // 「被替换掉的旧对象」被收掉。
    h.rows = [];
    const first = storeSheetMusicFiles(
      [{ part_id: "p1", file_name: "大提琴.pdf", storage_path: "s1/U1.pdf" }],
      ["s1/U1.pdf"],
    );
    const second = storeSheetMusicFiles(
      [{ part_id: "p1", file_name: "大提琴.pdf", storage_path: "s1/U2.pdf" }],
      ["s1/U2.pdf"],
    );
    await Promise.all([first, second]);

    const removed = h.removeBatches.flat();
    // 先写那份：库里已没有行指着它
    expect(removed).toContain("s1/U1.pdf");
    // 后写那份：库里现在指着它，一个都不能动
    expect(removed).not.toContain("s1/U2.pdf");
  });

  it("某次落库永不 settle 时，后面的落库不连坐（队头阻塞，复审 F1）", async () => {
    // supabase-js 的请求没有超时：对端静默不回包时这次落库**永不 settle**。队列若只等它，
    // 模块级的 `storeQueue` 会把之后所有落库一起堵死 —— 连请求都发不出去（关弹窗重开照旧）。
    vi.useFakeTimers();
    try {
      h.rows = [];
      h.hangUpsertOnce = true;
      const stuck = storeSheetMusicFiles(
        [{ part_id: "p1", file_name: "长笛.pdf", storage_path: "s1/stuck.pdf" }],
        ["s1/stuck.pdf"],
      );
      const next = storeSheetMusicFiles(
        [{ part_id: "p1", file_name: "双簧管.pdf", storage_path: "s1/next.pdf" }],
        ["s1/next.pdf"],
      );

      // 截止时间之前：第二次连请求都发不出去（这正是阻塞的样子）
      await vi.advanceTimersByTimeAsync(STORE_QUEUE_TIMEOUT_MS - 1);
      expect(h.upserts).toBe(1);

      // 到点之后：队列照常往下走，第二次落库真的写进去了
      await vi.advanceTimersByTimeAsync(1);
      await next;
      expect(h.upserts).toBe(2);
      expect(h.rows.some((r) => r.storage_path === "s1/next.pdf")).toBe(true);

      // 卡住那次的 promise 语义不变：调用方拿到的仍是它自己那次的 promise
      void stuck;
    } finally {
      vi.useRealTimers();
    }
  });
});
