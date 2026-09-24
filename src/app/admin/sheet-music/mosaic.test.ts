import { describe, expect, it } from "vitest";
import {
  estimateMosaicBytes,
  mapLinesToPages,
  MOSAIC_BUDGET_BYTES,
  MOSAIC_MAX_PAGES,
  MOSAIC_PAGES_PER_CALL,
  MOSAIC_TYPICAL_BAND_BYTES,
  packBands,
} from "./mosaic";

const KB = 1024;

describe("分组：顺序装、装不下就新开一张", () => {
  it("全装得下就是一组，且**顺序不变**", () => {
    expect(packBands([10 * KB, 10 * KB, 10 * KB], 100 * KB, 24)).toEqual([[0, 1, 2]]);
  });

  it("超预算就分张，且不丢页（拼回去等于原序列）", () => {
    const sizes = Array.from({ length: 10 }, () => 30 * KB);
    const groups = packBands(sizes, 100 * KB, 99);
    expect(groups.flat()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(groups.length).toBeGreaterThan(1);
  });

  it("页数上限也生效（字节还很宽裕时）", () => {
    const groups = packBands(
      Array.from({ length: 10 }, () => 1 * KB),
      10 * 1024 * KB,
      4,
    );
    expect(groups.map((g) => g.length)).toEqual([4, 4, 2]);
  });

  it("**单页就超预算时仍单独成组** —— 宁可让上游报「太大」，也不在这里悄悄丢一页", () => {
    const groups = packBands([5 * KB, 900 * KB, 5 * KB], 100 * KB, 24);
    expect(groups).toEqual([[0], [1], [2]]);
  });

  it("空输入 = 空分组（不产出空组）", () => {
    expect(packBands([], 100 * KB, 24)).toEqual([]);
  });

  it("实际语料的量级：21KB/页 → 一张装三十来页", () => {
    const groups = packBands(Array.from({ length: 19 }, () => 21 * KB));
    expect(groups).toEqual([Array.from({ length: 19 }, (_, i) => i)]); // 19 页一份
    const big = packBands(Array.from({ length: 100 }, () => 21 * KB));
    expect(big.every((g) => g.length <= MOSAIC_MAX_PAGES)).toBe(true);
    expect(big.flat()).toEqual(Array.from({ length: 100 }, (_, i) => i));
  });

  it("估算就是求和（实测拼图 ≤ 各窄带之和，所以它是个安全上界）", () => {
    expect(estimateMosaicBytes([10 * KB, 20 * KB])).toBe(30 * KB);
    expect(MOSAIC_BUDGET_BYTES).toBe(700 * 1024);
  });
});

describe("坐标归页", () => {
  const H = 288; // 一条窄带的高度（x5 语料的实测值）

  it("按 top 落进哪条窄带就归哪一页", () => {
    const lines = [
      { top: 10, text: "P1" },
      { top: 300, text: "P2" }, // 第 2 条：288~575
      { top: 590, text: "P3" },
    ];
    expect(mapLinesToPages(lines, H, 3, H * 3)).toEqual(["P1", "P2", "P3"]);
  });

  it("**行的顺序不作假设** —— 实测 top 不是单调的（OCR 按块返回）", () => {
    const lines = [
      { top: 300, text: "P2" },
      { top: 10, text: "P1" },
      { top: 590, text: "P3" },
    ];
    expect(mapLinesToPages(lines, H, 3, H * 3)).toEqual(["P1", "P2", "P3"]);
  });

  it("一页多行按出现顺序拼起来（空行丢掉）", () => {
    const lines = [
      { top: 5, text: "A" },
      { top: 60, text: "" },
      { top: 90, text: "B" },
    ];
    expect(mapLinesToPages(lines, H, 1, H)).toEqual(["A\nB"]);
  });

  it("**归一化坐标（0~1）必须判不可用** —— 否则所有行都会被算进第 1 页，而每个信号都是正常的", () => {
    const lines = [
      { top: 0.1, text: "P1" },
      { top: 0.6, text: "P2" },
    ];
    expect(mapLinesToPages(lines, H, 3, H * 3)).toBeNull();
  });

  it("明显越界也判不可用（留 10% 余量给行高）", () => {
    expect(mapLinesToPages([{ top: H * 3 + 200, text: "X" }], H, 3, H * 3)).toBeNull();
    expect(mapLinesToPages([{ top: -500, text: "X" }], H, 3, H * 3)).toBeNull();
    // 略微越界（行高让底边出界）不算
    expect(mapLinesToPages([{ top: H * 3 + 10, text: "X" }], H, 3, H * 3)).toEqual(["", "", "X"]);
  });

  it("没有行 / 参数非法 → null（调用方据此退回逐页 OCR，而不是把空文本当「空白页」）", () => {
    expect(mapLinesToPages([], H, 3, H * 3)).toBeNull();
    expect(mapLinesToPages([{ top: 10, text: "X" }], 0, 3, H * 3)).toBeNull();
    expect(mapLinesToPages([{ top: 10, text: "X" }], H, 0, H * 3)).toBeNull();
  });

  it("超出页数的行被夹进最后一页（不产出第 N+1 页）", () => {
    // 实际发生：最后一条窄带的底部墨迹被判成一行，top 落到 bandH*3 之后
    expect(mapLinesToPages([{ top: H * 3 + 5, text: "X" }], H, 3, H * 3 + 20)).toEqual([
      "",
      "",
      "X",
    ]);
  });
});

describe("成本估算用的保守每页字节（两条线里更紧的那条）", () => {
  it("每张页数 = min(页数上限, 预算 ÷ 保守每页字节)，且写成字面量", () => {
    // 「不写死数字」这条习惯在被测的就是那个数字时不成立（见 memory 的验证陷阱）
    expect(MOSAIC_TYPICAL_BAND_BYTES).toBe(70 * 1024);
    expect(MOSAIC_PAGES_PER_CALL).toBe(10); // min(24, floor(700/70)) = 10
    expect(MOSAIC_PAGES_PER_CALL).toBeLessThanOrEqual(MOSAIC_MAX_PAGES);
  });

  it("**非有限坐标整张弃权** —— NaN 曾让两条量纲判据全失效、最后抛 TypeError 被 catch 掩盖", () => {
    expect(mapLinesToPages([{ top: NaN, text: "X" }], 288, 3, 864)).toBeNull();
    expect(
      mapLinesToPages(
        [
          { top: 10, text: "A" },
          { top: NaN, text: "B" },
        ],
        288,
        3,
        864,
      ),
    ).toBeNull();
    expect(mapLinesToPages([{ top: Infinity, text: "X" }], 288, 3, 864)).toBeNull();
  });
});
