import { describe, it, expect } from "vitest";
import { decideTitleCrop, findFirstStaffLine, rowLongestRun } from "./staff-line";

/**
 * 测试尺度取整便于手算：页宽 1000 → 长横线判定阈值为 1000×0.35 = 350；
 * 页高 1000 → 谱线间距带为 [3, 15]px（真实值约 0.65%~0.75% 页高，落在带内）。
 */
const W = 1000;
const H = 1000;

/** 造一份「每行最长连续暗段」数组：只给关心的行赋值，其余为 0 */
function runsFrom(spec: Array<[y: number, run: number]>, height = H): Int32Array {
  const out = new Int32Array(height);
  for (const [y, v] of spec) out[y] = v;
  return out;
}

/** 造一条谱线：从 top 起连续 thickness 行都达到长横线阈值 */
function staffLine(top: number, thickness = 1): Array<[number, number]> {
  return Array.from({ length: thickness }, (_, i) => [top + i, 900] as [number, number]);
}

/** 造一组等间距谱线：首线 top，共 count 条，间距 gap */
function staff(top: number, count: number, gap: number): Array<[number, number]> {
  return Array.from({ length: count }, (_, i) => [top + i * gap, 900] as [number, number]);
}

/** 造一个 width×height 的 RGBA 缓冲；paint 返回 null 表示白像素 */
function makeRgba(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number] | null,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const px = paint(x, y) ?? [255, 255, 255];
      data[i] = px[0];
      data[i + 1] = px[1];
      data[i + 2] = px[2];
      data[i + 3] = 255;
    }
  }
  return data;
}

describe("rowLongestRun", () => {
  it("白行 → 0", () => {
    const data = makeRgba(8, 1, () => null);
    expect(Array.from(rowLongestRun(data, 8, 1))).toEqual([0]);
  });

  it("量的是最长**连续**暗段，不是暗像素总数", () => {
    // 第 0 行：两段各 3 px（中间被白隔开）→ 最长 3；第 1 行：连续 6 px → 6
    const data = makeRgba(8, 2, (x, y) =>
      y === 0 ? (x < 3 || (x >= 4 && x < 7) ? [0, 0, 0] : null) : x < 6 ? [0, 0, 0] : null,
    );
    expect(Array.from(rowLongestRun(data, 8, 2))).toEqual([3, 6]);
  });

  it("任一通道低于阈值即算暗（彩色像素也算）", () => {
    const data = makeRgba(4, 1, (x) => (x < 2 ? [255, 0, 0] : null));
    expect(Array.from(rowLongestRun(data, 4, 1))).toEqual([2]);
  });

  it("被白像素打断的谱线只按最长的一段计（断口会让它跌破阈值，属安全降级）", () => {
    const data = makeRgba(10, 1, (x) => (x !== 5 ? [0, 0, 0] : null));
    expect(Array.from(rowLongestRun(data, 10, 1))).toEqual([5]);
  });
});

describe("findFirstStaffLine", () => {
  it("正常：返回第一组 5 线谱表的首线位置", () => {
    const runs = runsFrom([
      ...Array.from({ length: 100 }, (_, y) => [y, 60] as [number, number]), // 标题文字：连续段很短
      ...staff(150, 5, 7),
      ...staff(300, 5, 7), // 其下还有谱表，满足结构确认
    ]);
    expect(findFirstStaffLine(runs, W, H)).toBe(150);
  });

  it("标题文字行不会被当成谱线（连续段远低于页宽 35%）", () => {
    const runs = runsFrom([
      ...Array.from({ length: 200 }, (_, y) => [y, 300] as [number, number]), // 接近但未达阈值
      ...staff(300, 5, 7),
      ...staff(450, 5, 7),
    ]);
    expect(findFirstStaffLine(runs, W, H)).toBe(300);
  });

  it("只有 4 条线 → 不足以成组（用连续段做特征后不再漏线，因此要求完整 5 条）", () => {
    const runs = runsFrom([...staff(150, 4, 7), ...staff(300, 5, 7), ...staff(600, 5, 7)]);
    expect(findFirstStaffLine(runs, W, H)).toBe(300);
  });

  it("孤立的长横线不算谱表", () => {
    const runs = runsFrom([...staffLine(150), ...staffLine(600)]);
    expect(findFirstStaffLine(runs, W, H)).toBeNull();
  });

  it("其下再无谱表 → 拒绝（排除「标题区一排装饰线」）", () => {
    const runs = runsFrom(staff(150, 5, 7));
    expect(findFirstStaffLine(runs, W, H)).toBeNull();
  });

  it("全页只有一组谱表 → 不裁（结构确认过不去，属安全降级：退回整页）", () => {
    const runs = runsFrom(staff(900, 5, 7));
    expect(findFirstStaffLine(runs, W, H)).toBeNull();
  });

  it("组内间距明显不均匀 → 拒绝（间距比 1.75 超过容差 1.6）", () => {
    const runs = runsFrom([
      ...[100, 107, 114, 128, 135].map((y) => [y, 900] as [number, number]),
      ...staff(300, 5, 7),
      ...staff(600, 5, 7),
    ]);
    expect(findFirstStaffLine(runs, W, H)).toBe(300);
  });

  it("相邻候选行合并成一条线（谱线渲染后厚 1~4px）", () => {
    const runs = runsFrom([
      ...staffLine(500, 4),
      ...[507, 514, 521, 528].map((y) => [y, 900] as [number, number]),
      ...staff(700, 5, 7),
    ]);
    expect(findFirstStaffLine(runs, W, H)).toBe(500);
  });

  it("间距超出带内 → 断开，不误连", () => {
    // 间距 40px 远超带上限 15px
    const runs = runsFrom([
      ...[100, 140, 180, 220, 260].map((y) => [y, 900] as [number, number]),
      ...staff(400, 5, 7),
      ...staff(600, 5, 7),
    ]);
    expect(findFirstStaffLine(runs, W, H)).toBe(400);
  });

  it("全页无长横线 → null", () => {
    expect(findFirstStaffLine(new Int32Array(H), W, H)).toBeNull();
  });

  it("非法入参 → null（不抛错）", () => {
    const runs = runsFrom(staff(150, 5, 7));
    expect(findFirstStaffLine(new Int32Array(0), W, H)).toBeNull();
    expect(findFirstStaffLine(runs, 0, H)).toBeNull();
    expect(findFirstStaffLine(runs, W, 0)).toBeNull();
    expect(findFirstStaffLine(runs, NaN, H)).toBeNull();
    expect(findFirstStaffLine(runs, W, NaN)).toBeNull();
  });
});

describe("decideTitleCrop", () => {
  it("正常：裁到谱线之上（高度等于谱线 top，不含谱线本身）", () => {
    expect(decideTitleCrop(318, 2400)).toEqual({ crop: true, height: 318, staffPct: 318 / 2400 });
  });

  it("未检测到谱线 → 不裁", () => {
    expect(decideTitleCrop(null, 2400)).toEqual({ crop: false, reason: "no-staff" });
  });

  it("谱线超过页高 33% → 不裁", () => {
    expect(decideTitleCrop(900, 2400)).toEqual({
      crop: false,
      reason: "too-tall",
      staffPct: 900 / 2400,
    });
  });

  it("边界：恰好 33% 仍裁", () => {
    const staffY = Math.floor(2400 * 0.33);
    expect(decideTitleCrop(staffY, 2400)).toMatchObject({ crop: true, height: staffY });
  });

  it("裁切条过薄 → 不裁", () => {
    expect(decideTitleCrop(50, 2400)).toEqual({ crop: false, reason: "too-thin", height: 50 });
  });

  it("边界：恰好 80px 仍裁，79px 不裁", () => {
    expect(decideTitleCrop(80, 2400)).toMatchObject({ crop: true, height: 80 });
    expect(decideTitleCrop(79, 2400)).toMatchObject({ crop: false, reason: "too-thin" });
  });

  it("NaN / Infinity / 负数 / 零页高 → 一律不裁（不能让 NaN 传下去变成 0 高度的 canvas）", () => {
    expect(decideTitleCrop(NaN, 2400)).toEqual({ crop: false, reason: "no-staff" });
    expect(decideTitleCrop(318, NaN)).toEqual({ crop: false, reason: "no-staff" });
    expect(decideTitleCrop(Infinity, 2400)).toMatchObject({ crop: false });
    expect(decideTitleCrop(-5, 2400)).toEqual({ crop: false, reason: "no-staff" });
    expect(decideTitleCrop(318, 0)).toEqual({ crop: false, reason: "no-staff" });
  });
});
