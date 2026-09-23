import { describe, expect, it } from "vitest";
import {
  cutsToSegments,
  estimateTotalOcrCalls,
  needsSegmentation,
  normalizeSegments,
  segmentsFromResponse,
} from "./segmentation";

const ranges = (segs: Array<{ from: number; to: number }>) => segs.map((s) => [s.from, s.to]);
/** 段是否闭合覆盖 1..n：不留空洞、不重叠 —— 破了这条后面的切分与改名会错位 */
const covers = (segs: Array<{ from: number; to: number }>, n: number) =>
  segs.length > 0 &&
  segs[0].from === 1 &&
  segs[segs.length - 1].to === n &&
  segs.every((s, i) => s.from <= s.to && (i === 0 || s.from === segs[i - 1].to + 1));

describe("成本可见（验收标准：OCR 调用次数在导入前可见）", () => {
  it("一份 N 页的合订谱 = N 次 OCR（每页一次，没有别的调用）", () => {
    expect(estimateTotalOcrCalls([{ pageCount: 19, eligible: true }])).toBe(19);
  });

  it("不合格的文件不计入 —— 用户看到的数就是真实会烧的数", () => {
    expect(
      estimateTotalOcrCalls([
        { pageCount: 19, eligible: true },
        { pageCount: 3, eligible: false },
        { pageCount: null, eligible: true },
      ]),
    ).toBe(19);
  });

  it("空列表是 0", () => {
    expect(estimateTotalOcrCalls([])).toBe(0);
  });
});

describe("哪些文件要跑（用户已定：对所有多页文件跑，总谱除外）", () => {
  it("多页 → 跑；单页 → 不跑（没有边界，白烧一次 OCR）", () => {
    expect(needsSegmentation(19, false)).toBe(true);
    expect(needsSegmentation(2, false)).toBe(true);
    expect(needsSegmentation(1, false)).toBe(false);
  });

  it("页数未知 → 不跑（拿不到页数就没法算成本，也没法判单页）", () => {
    expect(needsSegmentation(null, false)).toBe(false);
    expect(needsSegmentation(undefined as unknown as number, false)).toBe(false);
  });

  it("**总谱不参与切分检测**（用户已定；省掉最大的一笔 OCR）", () => {
    // ⚠️ 总谱认不出来（三个本地判据都被实测否掉，见 issue #290），
    // 只能靠人工标记 section='总谱' —— 所以这里收的是算好的 isFullScore
    expect(needsSegmentation(30, true)).toBe(false);
  });
});

describe("cuts → 段", () => {
  it("正常：切点把页切成闭合的段", () => {
    expect(ranges(cutsToSegments([7, 13, 17], 19))).toEqual([
      [1, 6],
      [7, 12],
      [13, 16],
      [17, 19],
    ]);
  });

  it("不切 = 整份一段", () => {
    expect(ranges(cutsToSegments([], 19))).toEqual([[1, 19]]);
  });

  it("第 1 页不是切点：写进去会被丢掉，段仍然从 1 开始", () => {
    expect(ranges(cutsToSegments([1, 7], 10))).toEqual([
      [1, 6],
      [7, 10],
    ]);
  });

  it("越界与重复的切点丢掉，不产生空洞", () => {
    const segs = cutsToSegments([0, -1, 99, 7, 7, 5.5], 10);
    expect(covers(segs, 10)).toBe(true);
    expect(ranges(segs)).toEqual([
      [1, 6],
      [7, 10],
    ]);
  });

  it("一页的文件就是一段", () => {
    expect(ranges(cutsToSegments([], 1))).toEqual([[1, 1]]);
  });
});

describe("用户改边界后的收敛", () => {
  it("移动起点后段重新闭合", () => {
    expect(ranges(normalizeSegments([7, 13, 17], 19))).toEqual([
      [1, 6],
      [7, 12],
      [13, 16],
      [17, 19],
    ]);
  });

  it("把某个起点删掉 = 合并两段", () => {
    expect(ranges(normalizeSegments([13, 17], 19))).toEqual([
      [1, 12],
      [13, 16],
      [17, 19],
    ]);
  });

  it("起点落到第 1 页：那条不是边界，被并进第 1 段", () => {
    const segs = normalizeSegments([1, 7], 10);
    expect(covers(segs, 10)).toBe(true);
    expect(ranges(segs)).toEqual([
      [1, 6],
      [7, 10],
    ]);
  });

  it("**任何输入都不能产生空洞或重叠**（破了这条后面的切分会错位）", () => {
    for (const starts of [[], [1], [5], [3, 3, 3], [0, 5, 99], [-2, 4, 4, 7], [2, 3, 4, 5]]) {
      const segs = normalizeSegments(starts, 10);
      expect(covers(segs, 10), JSON.stringify(starts)).toBe(true);
    }
  });

  it("页数为 0 / 负数时不产生段（不抛）", () => {
    expect(normalizeSegments([2], 0)).toEqual([]);
    expect(normalizeSegments([2], -1)).toEqual([]);
  });
});

describe("响应收敛：以 cuts 为准，不信 ranges", () => {
  it("正常 cuts", () => {
    expect(ranges(segmentsFromResponse([7, 13], 19))).toEqual([
      [1, 6],
      [7, 12],
      [13, 19],
    ]);
  });

  it("cuts 不是数组 / 是垃圾 → 退化成「不切」，不抛", () => {
    for (const bad of [null, undefined, "7", 7, {}, [null], ["7"], [NaN]]) {
      const segs = segmentsFromResponse(bad, 19);
      expect(ranges(segs), JSON.stringify(bad)).toEqual([[1, 19]]);
    }
  });

  it("pageCount 非法时也不抛（退化成一页一段是最安全的）", () => {
    expect(segmentsFromResponse([2], 0)).toEqual([]);
    expect(segmentsFromResponse([2], NaN as unknown as number)).toEqual([]);
  });
});
