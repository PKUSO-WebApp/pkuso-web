/**
 * 「窄带多高」的判据本体（`band-height.ts`）：采样哪几页、几页的读数怎么收成一个数、
 * 什么时候退回 25%。
 *
 * 这些用例的价值全在**区分力**上：每条都把「换一种看似合理的做法」会得出的不同答案
 * 写进断言里（min / 中位数 / 只看首页 / 没有界 / 总是兜底），而不是只复述实现。
 * 真实检测器的端到端行为在 `band-render.test.ts`（合成像素），真实语料在仓库外的
 * `.render-harness/seg-replay/`。
 */
import { describe, expect, it } from "vitest";
import { bandSamplePages, decideBandPct } from "./band-height";

describe("bandSamplePages", () => {
  it("前两页固定，其余在 [3, 末页] 上均匀取三个位置（含末页）", () => {
    // 8 页：3、6、8 —— 中段不是「连续三页」，否则合订谱最后一份永远是盲区
    expect(bandSamplePages(8)).toEqual([1, 2, 3, 6, 8]);
    // 11 页：3、7、11
    expect(bandSamplePages(11)).toEqual([1, 2, 3, 7, 11]);
    // 12 页：3、8、12
    expect(bandSamplePages(12)).toEqual([1, 2, 3, 8, 12]);
  });

  it("页数不够时退化为「有几页采几页」，不重复、不越界", () => {
    expect(bandSamplePages(1)).toEqual([1]);
    expect(bandSamplePages(2)).toEqual([1, 2]);
    expect(bandSamplePages(3)).toEqual([1, 2, 3]);
    expect(bandSamplePages(4)).toEqual([1, 2, 3, 4]);
  });

  it("采样页数封顶 5（每页都是一次整页渲染）", () => {
    for (const n of [5, 8, 12, 19, 100]) expect(bandSamplePages(n)).toHaveLength(5);
  });

  it("非法页数 ⇒ 空样本（不抛、不猜）", () => {
    for (const n of [0, -3, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(bandSamplePages(n)).toEqual([]);
    }
  });
});

describe("decideBandPct", () => {
  it("取采样页的**最大**值 —— 不是首页、不是中位数", () => {
    // 三个读数：首页 10%（续页水平）、中位 12%、最深 20%（标题页）。
    // min ⇒ 0.10、中位数 ⇒ 0.12、只看首页 ⇒ 0.10，三条都会被这条打红。
    expect(decideBandPct([0.1, 0.12, 0.2])).toEqual({ pct: 0.2, fallback: false });
    // 顺序无关：max 不应依赖「最深的那页刚好在最后」
    expect(decideBandPct([0.2, 0.1, 0.12])).toEqual({ pct: 0.2, fallback: false });
  });

  it("有效读数少于 2 页 ⇒ 兜底 25%（一页分不清「文档性质」与「个别异常」）", () => {
    expect(decideBandPct([])).toEqual({ pct: 0.25, fallback: true });
    expect(decideBandPct([0.2, null, undefined])).toEqual({ pct: 0.25, fallback: true });
    // 单页文档也算「不够」：它本来就没有分段可做，兜底没有损失
    expect(decideBandPct([0.17])).toEqual({ pct: 0.25, fallback: true });
  });

  it("max 低于下界 ⇒ 兜底（太薄的窄带会把标题整块切掉）", () => {
    expect(decideBandPct([0.05, 0.07])).toEqual({ pct: 0.25, fallback: true });
    // 边界：8% 本身是可信的（闭区间），别把它误伤成兜底
    expect(decideBandPct([0.08, 0.08])).toEqual({ pct: 0.08, fallback: false });
  });

  it("max 高于上界 ⇒ 兜底（那已经不是「窄带」了）", () => {
    // 如果实现忘了上界，这里会得到 0.4 —— 一条把半页乐谱当窄带的窄带
    expect(decideBandPct([0.4, 0.2])).toEqual({ pct: 0.25, fallback: true });
    // 边界：33% 本身仍可信（闭区间）
    expect(decideBandPct([0.33, 0.1])).toEqual({ pct: 0.33, fallback: false });
  });

  it("非法读数按「这一页没测到」处理，不污染整份文档", () => {
    // NaN / Infinity / 负 / 0 / >1 都是检测器的坏输出，不能让它们参与 max
    const bad = [Number.NaN, Number.POSITIVE_INFINITY, -0.2, 0, 1.5];
    expect(decideBandPct([...bad, 0.1, 0.14])).toEqual({ pct: 0.14, fallback: false });
    // 但要是一份文档只剩坏读数，仍然只有「不够」这一条路
    expect(decideBandPct(bad)).toEqual({ pct: 0.25, fallback: true });
  });
});
