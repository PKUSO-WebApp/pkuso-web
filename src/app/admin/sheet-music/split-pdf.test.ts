import { describe, expect, it } from "vitest";
import {
  duplicateNames,
  openForSplit,
  pageIndices,
  SPLIT_MAX_BYTES,
  SPLIT_MAX_PAGES,
  SPLIT_MAX_SEGMENTS,
  splitRefusal,
} from "./split-pdf";

const ok = { byteSize: 2 * 1048576, pageCount: 19, segTotal: 4 };

describe("切分的拒绝线（病理输入宁可不切）", () => {
  it("正常输入放行", () => {
    expect(splitRefusal(ok)).toBeNull();
    // 实测过的最重语料：11.6MB / 82 页 / 4 段
    expect(splitRefusal({ byteSize: 12 * 1048576, pageCount: 82, segTotal: 4 })).toBeNull();
  });

  it("每条线各自能拦住，且文案说清「怎么办」", () => {
    for (const [input, keyword] of [
      [{ ...ok, segTotal: SPLIT_MAX_SEGMENTS + 1 }, "段数太多"],
      [{ ...ok, pageCount: SPLIT_MAX_PAGES + 1 }, "页数太多"],
      [{ ...ok, byteSize: SPLIT_MAX_BYTES + 1 }, "文件太大"],
      [{ ...ok, pageCount: 0 }, "页数未知"],
      [{ ...ok, pageCount: NaN as unknown as number }, "页数未知"],
    ] as const) {
      const msg = splitRefusal(input);
      expect(msg, JSON.stringify(input)).toContain(keyword);
      expect(msg).toContain("人工"); // 拒绝之后要有出路，不能只说「不行」
    }
  });

  it("**恰好等于上限放行**（边界是「超过」才拦）", () => {
    expect(splitRefusal({ ...ok, segTotal: SPLIT_MAX_SEGMENTS })).toBeNull();
    expect(splitRefusal({ ...ok, pageCount: SPLIT_MAX_PAGES })).toBeNull();
    expect(splitRefusal({ ...ok, byteSize: SPLIT_MAX_BYTES })).toBeNull();
  });

  it("只有一段不是「拒绝」，是「不必切」", () => {
    expect(splitRefusal({ ...ok, segTotal: 1 })).toContain("无需切分");
    expect(splitRefusal({ ...ok, segTotal: 0 })).toContain("无需切分");
  });
});

describe("页下标换算（pdf-lib 要 0-based，用户看的是 1-based）", () => {
  it("闭区间两端都算进去", () => {
    expect(pageIndices(1, 3, 10)).toEqual([0, 1, 2]);
    expect(pageIndices(7, 7, 10)).toEqual([6]);
    expect(pageIndices(1, 10, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("越界 / 空区间 / 反区间一律 null（调用方据此拒绝，而不是猜一个）", () => {
    for (const [from, to, n] of [
      [0, 3, 10],
      [8, 11, 10],
      [5, 4, 10],
      [1, 3, 0],
      [1, 3, NaN as unknown as number],
      [1.5, 3, 10],
      [1, 3.5, 10],
      [NaN as unknown as number, 3, 10],
    ] as const) {
      expect(pageIndices(from, to, n), `${from}-${to}/${n}`).toBeNull();
    }
  });

  it("切出来的段拼回去正好是原页数（段之间不重不漏）", () => {
    const segs = [
      { from: 1, to: 6 },
      { from: 7, to: 12 },
      { from: 13, to: 16 },
      { from: 17, to: 19 },
    ];
    const all = segs.flatMap((s) => pageIndices(s.from, s.to, 19)!);
    expect(all).toEqual(Array.from({ length: 19 }, (_, i) => i));
  });
});

describe("同组重名（切出来的每一份必须靠文件名能区分）", () => {
  it("无重名 = 空数组", () => {
    expect(duplicateNames(["圆号_1.pdf", "圆号_2.pdf", "圆号_3.pdf"])).toEqual([]);
  });

  it("重名的只标**后面**那个（第一份放行，用户只改被标出来的）", () => {
    expect(duplicateNames(["圆号.pdf", "圆号.pdf", "圆号.pdf"])).toEqual([1, 2]);
    expect(duplicateNames(["圆号_1.pdf", "圆号.pdf", "圆号_1.pdf"])).toEqual([2]);
  });

  it("空名字不算重名 —— 那是「还没填」，由别的拦截去管", () => {
    expect(duplicateNames(["", "", "圆号_1.pdf"])).toEqual([]);
  });

  it("去掉首尾空白后比较（用户多敲一个空格不该算成两个名字）", () => {
    expect(duplicateNames(["圆号_1.pdf", " 圆号_1.pdf "])).toEqual([1]);
  });
});

/**
 * 真的切一份出来（不是纯函数）：**页序与页数**是 Step 2 唯一不能错的地方 ——
 * 切错页就是把两个声部的谱混进同一份上传文件，事后看不出来。
 *
 * 做法：造一份每页**宽度都不同**的 PDF，切完再读回每页宽度 —— 宽度序列就等于页序。
 * 这比只数页数强：页数对而顺序错（比如 copyPages 的下标算错）也能被抓到。
 */
describe("真切一份（pdf-lib 往返）", () => {
  const makeFile = async (pages: number): Promise<File> => {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    for (let i = 1; i <= pages; i++) {
      doc.addPage([200 + i, 400]); // 第 i 页宽 200+i → 宽度就是页号的指纹
    }
    const bytes = await doc.save();
    return new File([bytes as BlobPart], "bundle.pdf", { type: "application/pdf" });
  };

  const widthsOf = async (bytes: Uint8Array): Promise<number[]> => {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes);
    return doc.getPages().map((p) => Math.round(p.getWidth()));
  };

  it("按 4 段切：每段页数对、页序对", async () => {
    const file = await makeFile(19);
    const src = await openForSplit(file);
    expect(src.pageCount).toBe(19);
    for (const [from, to] of [
      [1, 6],
      [7, 12],
      [13, 16],
      [17, 19],
    ]) {
      const bytes = await src.extract(from, to);
      const want = Array.from({ length: to - from + 1 }, (_, k) => 200 + from + k);
      expect(await widthsOf(bytes), `第 ${from}-${to} 页`).toEqual(want);
    }
  });

  it("整份切（1..N）与原文件逐页相同 —— 顺带证明我们没有偷偷丢页", async () => {
    const file = await makeFile(7);
    const src = await openForSplit(file);
    const bytes = await src.extract(1, 7);
    expect(await widthsOf(bytes)).toEqual([201, 202, 203, 204, 205, 206, 207]);
  });

  it("区间越界时**抛错**，不产出残缺文件（上传一半的组比失败更糟）", async () => {
    const src = await openForSplit(await makeFile(5));
    await expect(src.extract(4, 6)).rejects.toThrow(/页区间非法/);
    await expect(src.extract(0, 2)).rejects.toThrow(/页区间非法/);
  });

  it("同一份源可以连续切多段（源只 load 一次，这正是调用方的用法）", async () => {
    const src = await openForSplit(await makeFile(10));
    const first = await src.extract(1, 3);
    const second = await src.extract(4, 10);
    expect(await widthsOf(first)).toEqual([201, 202, 203]);
    expect(await widthsOf(second)).toEqual([204, 205, 206, 207, 208, 209, 210]);
  });
});
