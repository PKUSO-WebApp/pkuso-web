import { describe, it, expect } from "vitest";
import { decideTitleCrop, findFirstStaffLine, rowLongestRun } from "./staff-line";
import { buildTiltMasks, findFirstStaffLineInImage, shearedRowRun } from "./staff-line-tilt";

/**
 * 倾斜页的尺度：页宽 1000（长横线阈值 1000×0.35 = 350）、页高 3000（谱线间距带
 * [3000×0.003, 3000×0.015] = [9, 45]px，取 20px = 0.67% 页高，落在真实值 0.65%~0.75% 内）。
 *
 * 这套数不是随手挑的，它让两条性质在几何上**确定**成立，测试不会飘：
 * - 倾斜线的平扫最长段只有约 1/|slope| px（slope = 0.01 时约 100px），必然低于阈值
 *   350px ⇒ 旧判据对倾斜谱表一条线都看不到（失手可复现）；
 * - 平页不会被斜率跟随推着上移：候选复核答案最多比真线靠上 `页宽·slope - 1` px，
 *   而这里 1000×0.0125 - 1 = 11px，够不到 3000×0.003 = 9px 的采纳线 —— 上移量必须
 *   ≥ 一个 GAP_MIN_PCT 才会被采纳，所以平页零位移。
 *
 * 倾斜用例的答案按「真首线 ± 线厚」验收（`withinFirstLine`），不钉死像素值：候选斜率
 * 按 0.125% 一格取，胜出的那一格可能比真倾斜差一格，报出来的上沿就跟着差 1~2px。
 */
const TW = 1000;
const TH = 3000;
const T_GAP = 20;
const T_THICK = 3;

/** 一条谱线：列 x ∈ [0, xTo) 处占 [top + round(slope·x), + 厚度) 行 */
type PaintedLine = { top: number; slope: number; xTo: number };

/** 一组等间距谱线（与实现同用 Math.round，保证「同一根线」） */
function staffLines(top: number, slope: number, count = 5, gap = T_GAP, xTo = TW): PaintedLine[] {
  return Array.from({ length: count }, (_, i) => ({ top: top + i * gap, slope, xTo }));
}

/** 画一页：命中的像素画黑，其余白（白底是为了让 INK_THRESHOLD 的判定与真实页一致） */
function paintPage(width: number, height: number, lines: PaintedLine[]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let ink = false;
      for (const line of lines) {
        if (x >= line.xTo) continue;
        const dy = y - line.top - Math.round(line.slope * x);
        if (dy >= 0 && dy < T_THICK) {
          ink = true;
          break;
        }
      }
      const i = (y * width + x) * 4;
      const v = ink ? 0 : 255;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return data;
}

/** 与 buildTiltMasks 同一个阈值（非白 = 任一通道 < 240）从 RGBA 取墨迹掩码 */
function maskFrom(data: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; p < mask.length; p++, i += 4) {
    mask[p] = data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240 ? 1 : 0;
  }
  return mask;
}

/**
 * 逐像素参考实现（每一列都访问）：段走实现必须与它逐元素同值。
 *
 * 注意它**共用同一套锚点约定**（`x0 = slope > 0 ? 0 : width`）—— 所以它验的是「段走
 * 优化没改变语义」，不是「锚点选得对」。锚点本身由下面那条负斜率用例单独验（答案必须
 * 落在线的较高那一角）。
 */
function referenceShearedRuns(
  mask: Uint8Array,
  width: number,
  height: number,
  slope: number,
): number[] {
  const x0 = slope > 0 ? 0 : width;
  const out: number[] = [];
  for (let y = 0; y < height; y++) {
    let best = 0;
    let current = 0;
    for (let x = 0; x < width; x++) {
      const yy = y + Math.round(slope * (x - x0));
      if (yy >= 0 && yy < height && mask[yy * width + x]) {
        current++;
        if (current > best) best = current;
      } else {
        current = 0;
      }
    }
    out.push(best);
  }
  return out;
}

describe("shearedRowRun", () => {
  it("slope = 0 与 rowLongestRun 逐行同值（剪切行退化成原行）", () => {
    const data = paintPage(TW, TH, [...staffLines(300, 0.01), ...staffLines(440, 0.01)]);
    const sheared = shearedRowRun(maskFrom(data, TW, TH), TW, TH, 0);
    expect(Array.from(sheared)).toEqual(Array.from(rowLongestRun(data, TW, TH)));
  });

  it("与逐像素 Math.round 参考实现逐元素同值（负斜率走右沿锚点）", () => {
    // 确定性伪随机掩码：形状无所谓，要紧的是两种实现读同一份输入、走同一套边界规则
    const w = 137;
    const h = 91;
    const mask = new Uint8Array(w * h);
    let seed = 12345;
    for (let i = 0; i < mask.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      mask[i] = seed % 100 < 45 ? 1 : 0;
    }
    for (const slope of [0.0125, -0.0125, 0.00125, -0.00125, 0.00625, -0.00625]) {
      expect(Array.from(shearedRowRun(mask, w, h, slope))).toEqual(
        referenceShearedRuns(mask, w, h, slope),
      );
    }
  });

  it("退化入参不抛错（零宽返回全 0，零高返回空）", () => {
    expect(Array.from(shearedRowRun(new Uint8Array(0), 0, 0, 0.01))).toEqual([]);
    expect(Array.from(shearedRowRun(new Uint8Array(0), 0, 5, 0.01))).toEqual([0, 0, 0, 0, 0]);
  });

  it("全墨页：每一行的最长段都等于页宽（漏掉任何一列都会立刻少 1）", () => {
    // 这条把「x ∈ [0, width) 每一列都进了段走循环」直接钉在结果上：段边界写错（少一列、
    // 段区间首尾相接出洞）都会让全墨页的最长段 < 页宽。只断言「不在页内的行」以外的行。
    const w = 40;
    const h = 40;
    const mask = new Uint8Array(w * h).fill(1);
    for (const slope of [0, 0.5, -0.5, 0.0125, -0.0125]) {
      const maxDy = Math.round(Math.abs(slope) * (slope > 0 ? w - 1 : w));
      const runs = shearedRowRun(mask, w, h, slope);
      for (let y = 0; y < h - maxDy; y++) {
        expect(`${y}/${slope}:${runs[y]}`).toBe(`${y}/${slope}:${w}`);
      }
    }
  });

  it("只墨在最后一列：该行的最长段是 1（末列被漏掉就会是 0）", () => {
    // 末列落在**最后一段**里（dy 随列变化，段是真分段），而不是「整行一段」的退化情形。
    // w = 201、slope = 0.5 ⇒ dy(x) = round(0.5x)，末段 [199, 201) 的 dy = 100：
    // 唯一一个墨点 (x = 200, y = 100) 只能由第 0 行经 yy = 0 + 100 看到。
    const w = 201;
    const h = 101;
    const mask = new Uint8Array(w * h);
    mask[100 * w + 200] = 1;
    const runs = shearedRowRun(mask, w, h, 0.5);
    expect(runs[0]).toBe(1);
    expect(Array.from(runs).filter((r) => r !== 0)).toEqual([1]);
  });
});

describe("buildTiltMasks（粗掩码与细掩码同源）", () => {
  it("粗掩码 = 细掩码的 pool×pool 最大池化，逐字节同值（参考实现独立重算）", () => {
    // 独立重算：阈值/通道判定也照契约重写一遍（任一通道 < 240 即墨，alpha 不参与），
    // 不调用被测代码的任何中间结果。
    const w = 137;
    const h = 61;
    const pool = 4;
    const data = new Uint8ClampedArray(w * h * 4);
    let seed = 987654321;
    const ref = new Uint8Array(w * h);
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const kind = seed % 4;
      data[i] = kind === 1 || kind === 2 ? 0 : 255;
      data[i + 1] = kind === 1 || kind === 3 ? 0 : 255;
      data[i + 2] = kind === 1 ? 0 : 255;
      data[i + 3] = 255;
      ref[p] = kind === 0 ? 0 : 1; // kind 2/3 只有一个通道暗，也算墨
    }

    const { mask, coarseMask, coarseWidth, coarseHeight } = buildTiltMasks(data, w, h, pool);
    expect(mask.length).toBe(w * h);
    expect(Array.from(mask)).toEqual(Array.from(ref));

    const cw = Math.ceil(w / pool);
    const ch = Math.ceil(h / pool);
    expect(coarseWidth).toBe(cw);
    expect(coarseHeight).toBe(ch);
    const refCoarse = new Uint8Array(cw * ch);
    for (let cy = 0; cy < ch; cy++) {
      for (let cx = 0; cx < cw; cx++) {
        let hit = 0;
        for (let y = cy * pool; y < Math.min((cy + 1) * pool, h) && !hit; y++) {
          for (let x = cx * pool; x < Math.min((cx + 1) * pool, w); x++) {
            if (ref[y * w + x]) {
              hit = 1;
              break;
            }
          }
        }
        refCoarse[cy * cw + cx] = hit;
      }
    }
    expect(Array.from(coarseMask)).toEqual(Array.from(refCoarse));
  });

  it("宽/高不是 pool 的整数倍：最后一块（右沿与下沿）照样算进去", () => {
    const w = 9;
    const rows = 6;
    const pool = 4;
    const data = new Uint8ClampedArray(w * rows * 4).fill(255);
    // 唯一墨点是缓冲区最后一个像素 (y = 5, x = 8)：它落在最后一块 (cx = 2, cy = 1)
    data[(5 * w + 8) * 4] = 0;
    const { mask, coarseMask, coarseWidth, coarseHeight } = buildTiltMasks(data, w, rows, pool);
    expect(coarseWidth).toBe(3);
    expect(coarseHeight).toBe(2);
    expect(mask[5 * w + 8]).toBe(1);
    expect(Array.from(coarseMask)).toEqual([0, 0, 0, 0, 0, 1]);
  });
});

describe("findFirstStaffLineInImage（斜率跟随）", () => {
  /**
   * 答案的验收窗口：真首线的**线身** ± 一个线厚。
   *
   * 不钉死 300 是因为候选斜率是按格取的（0.125% 一格），胜出的那一格可能比真倾斜差一格，
   * 报出来的上沿就跟着差 1~2px —— 与线厚同量级、远小于一条谱线的间距（GAP_MIN = 9px），
   * 按实现自己的口径仍是「同一根线」。反过来，答案深到 440 那一组（100px 开外）就说明
   * 成组/复核机制失手，这个窗口会红。
   */
  const withinFirstLine = (y: number | null) => y !== null && Math.abs(y - 300) <= T_THICK;

  it("整页倾斜：旧判据一条线都看不到，新入口给出真谱表首线附近的答案并裁得下去", () => {
    const data = paintPage(TW, TH, [...staffLines(300, 0.01), ...staffLines(440, 0.01)]);
    // 失手本身也要钉住：平扫的逐行最长段（约 1/0.01 = 100px）够不到阈值 350px ⇒ null
    const flat = findFirstStaffLine(rowLongestRun(data, TW, TH), TW, TH);
    expect(flat).toBeNull();
    expect(decideTitleCrop(flat, TH)).toEqual({ crop: false, reason: "no-staff" });

    const y = findFirstStaffLineInImage(data, TW, TH);
    expect(withinFirstLine(y)).toBe(true);
    expect(decideTitleCrop(y, TH)).toMatchObject({ crop: true });
  });

  it("首组倾斜、其下有平谱表：旧判据 latch 到后者，新入口取倾斜的真首组", () => {
    const data = paintPage(TW, TH, [
      ...staffLines(300, 0.01),
      ...staffLines(440, 0.01),
      ...staffLines(900, 0),
      ...staffLines(1200, 0),
    ]);
    // 旧判据只能看到平的两组 ⇒ 答案落在 900（= 把整个第一谱表带进送检图）
    expect(findFirstStaffLine(rowLongestRun(data, TW, TH), TW, TH)).toBe(900);
    expect(withinFirstLine(findFirstStaffLineInImage(data, TW, TH))).toBe(true);
  });

  it("确认组是下一个谱表（隔 ~30 个线距）：复核窗口按「紧跟第一组」截断会漏救", () => {
    // 真第一谱表（300、倾斜）之下是 900 的谱表（= 确认组所在，谱间距 600px = 30 个线距），
    // 再往下 1400 给旧判据做确认（间距 500px）。按「MIN_LINES + CONFIRM_MIN_LINES 个线距」
    // 估的复核窗口（8×45 = 360px，从候选下沿 300 起 ⇒ 截在 660）看不到 900 那一组 ⇒ 精扫
    // 凑不出确认 ⇒ null ⇒ 答案停在 yFlat = 900（整个第一谱表被带进送检图）。
    const data = paintPage(TW, TH, [
      ...staffLines(300, 0.01),
      ...staffLines(900, 0),
      ...staffLines(1400, 0),
    ]);
    expect(findFirstStaffLine(rowLongestRun(data, TW, TH), TW, TH)).toBe(900);
    expect(withinFirstLine(findFirstStaffLineInImage(data, TW, TH))).toBe(true);
  });

  it("同页两种局部倾斜：最强候选在更靠下的一组上被确认，答案仍取最浅的那个确认", () => {
    // 复现 11份_一提 p10 的形态：上段（300/700，斜率 +0.0125、只横跨 60% 页宽）与下段
    // （950/1130，斜率 -0.0125、整幅）**局部倾斜不同**。粗扫的池化把上段的局部畸变
    // 吸收掉 ⇒ 粗提案也指向 300，但两个斜率在粗域的连续段长度是 1000/4 vs 600/4 ——
    // 下段的候选排在前面。于是：
    // - 首个采纳即停 ⇒ 950（把整个首谱表带进送检图，p10 实测 678 就是这么来的）；
    // - 名额内取最浅 ⇒ 300 = 真首线。
    // 两边都必须先让旧判据失手（两个斜率都让平扫最长段掉到阈值以下 ⇒ yFlat = null），
    // 否则采纳线会把 950 挡掉、这个用例就验不到复核顺序了。
    const data = paintPage(TW, TH, [
      ...staffLines(300, 0.0125, 5, T_GAP, 600),
      ...staffLines(700, 0.0125, 5, T_GAP, 600),
      ...staffLines(950, -0.0125),
      ...staffLines(1130, -0.0125),
    ]);
    expect(findFirstStaffLine(rowLongestRun(data, TW, TH), TW, TH)).toBeNull();
    expect(withinFirstLine(findFirstStaffLineInImage(data, TW, TH))).toBe(true);
  });

  it("整页不倾斜：与旧判据逐像素同答案（斜率跟随不引入位移）", () => {
    const data = paintPage(TW, TH, [...staffLines(300, 0), ...staffLines(440, 0)]);
    const flat = findFirstStaffLine(rowLongestRun(data, TW, TH), TW, TH);
    expect(flat).toBe(300);
    expect(findFirstStaffLineInImage(data, TW, TH)).toBe(300);
  });

  it("旧判据已经答对的页：倾斜候选看到一个**更深**的谱表也不许改答案（采纳线 = GAP_MIN）", () => {
    // S1（300 起，只横跨页宽左侧 80%）：平判据看得到 ⇒ yFlat = 300（这就是正确答案）
    // S2（900 起 + 其下 1200 的确认组，整幅倾斜 0.01）：倾斜候选在它上面的连续段更长
    //     （整幅 vs 80%），复核顺序排在 S1 前面，而它的答案 ≈900 比 yFlat **深** ——
    //     必须被「至少高一个 GAP_MIN_PCT」那条采纳线挡掉。
    // S3（1600 起，平，整幅）：给 yFlat 的确认组；它在倾斜层的 40% 扫描窗**之外**
    //     （所以 S1 在倾斜层里凑不出确认组，一个候选都提不出来）。
    const data = paintPage(TW, TH, [
      ...staffLines(300, 0, 5, T_GAP, Math.round(TW * 0.8)),
      ...staffLines(900, 0.01),
      ...staffLines(1200, 0.01),
      ...staffLines(1600, 0),
    ]);
    expect(findFirstStaffLine(rowLongestRun(data, TW, TH), TW, TH)).toBe(300);
    expect(findFirstStaffLineInImage(data, TW, TH)).toBe(300);
  });

  it("旧判据已经答对的页（二）：池化伪影进得来，采纳线单独守住零位移", () => {
    // 这一页的尺度比上面小一档（高 2000、间距 10），是**故意**挑的：两条门要落在 gapMin
    // 的两侧，只有这个尺度上能同时成立。
    // - 粗扫用 4px 池化，谱线所在的那一格连同它上面那一格都带墨 ⇒ 粗答案比真上沿高
    //   4~7px（上沿 ≡ 3 mod 4 时 7px）。这里 gapMin = 2000×0.3% = 6px，于是伪影答案
    //   296 过得了剪枝（< 303 - 6 = 297）—— 候选**进得来**，不是被剪枝挡掉的；
    // - 精扫在一个**平**谱表上最多把上沿抬 4~5px（剪切量在页宽内只有几个像素，
    //   抬高 1px 就得让整段连续暗段跟着错位），这里各候选给出 298/299，全部 < gapMin
    //   ⇒ 只能靠「比 yFlat 至少高一个 gapMin」这条采纳线拒掉。
    // 去掉采纳线（拿第一个非空精扫答案）这页就变成 298；有它才是 303 = yFlat。
    // 真实页上这条差额同样存在（离线重放全语料：去掉采纳线会让一批旧判据已答对的页
    // 被上移几像素），只是那里页高更大、两个量都放大，说不成这么干净的 6px 一档。
    const H2 = 2000;
    const GAP2 = 10;
    const data = paintPage(TW, H2, [
      ...staffLines(303, 0, 5, GAP2),
      ...staffLines(440, 0, 5, GAP2),
    ]);
    expect(findFirstStaffLine(rowLongestRun(data, TW, H2), TW, H2)).toBe(303);
    expect(findFirstStaffLineInImage(data, TW, H2)).toBe(303);
  });

  it("倾斜超过候选斜率上限（相邻线在一个页宽内互相错开 ≥ 内间距）→ 退回旧答案", () => {
    // 0.05 ⇒ 一个页宽内漂 50px：既超出 TILT_SLOPES 的 ±0.0125，也让相邻线（间距 20px）互相错开
    const data = paintPage(TW, TH, [
      ...staffLines(300, 0.05),
      ...staffLines(900, 0),
      ...staffLines(1200, 0),
    ]);
    expect(findFirstStaffLineInImage(data, TW, TH)).toBe(900);
  });

  it("倾斜路径沿用同一套成组/确认机制：单组谱表、或确认组不足 3 条线 → 仍不裁", () => {
    const single = paintPage(TW, TH, staffLines(300, 0.01));
    expect(findFirstStaffLineInImage(single, TW, TH)).toBeNull();

    const thinConfirm = paintPage(TW, TH, [...staffLines(300, 0.01), ...staffLines(440, 0.01, 2)]);
    expect(findFirstStaffLineInImage(thinConfirm, TW, TH)).toBeNull();
  });

  it("负斜率：答案落在线的**较高那一角**（右沿），不是左沿 —— 锚点跟着斜率换边", () => {
    // slope = -0.01、页宽 1000：整根线在右沿比左沿高 round(0.01×1000) = 10px。锚点若固定
    // 取左沿（dy(x) = round(slope·x)，x 从 0 起算），剪切后会报出 300（线在**左沿**的高度），
    // 把 10px 的谱线留在送检图里。锚点取右沿才是 290 = 线的上沿。
    const data = paintPage(TW, TH, [...staffLines(300, -0.01), ...staffLines(440, -0.01)]);
    expect(findFirstStaffLine(rowLongestRun(data, TW, TH), TW, TH)).toBeNull();
    const y = findFirstStaffLineInImage(data, TW, TH);
    expect(y).not.toBeNull();
    expect(Math.abs((y as number) - 290)).toBeLessThanOrEqual(T_THICK);
    expect(decideTitleCrop(y, TH)).toMatchObject({ crop: true });
  });

  it("缓冲短于 width×height×4 → null（少了就是非法入参，不许当成一张部分空白的页）", () => {
    const page = paintPage(TW, TH, [...staffLines(300, 0), ...staffLines(440, 0)]);
    expect(findFirstStaffLineInImage(page, TW, TH)).toBe(300);
    // 少最后一个像素：没有守卫时读越界得 undefined，按「无墨」处理，答案照样是 300
    expect(findFirstStaffLineInImage(page.subarray(0, TW * TH * 4 - 4), TW, TH)).toBeNull();
    // 尺寸写错但缓冲只有几个字节：没有守卫时要扫 16 亿次才可能返回（实测 5s 未返回）
    expect(findFirstStaffLineInImage(new Uint8ClampedArray(4), 40_000, 40_000)).toBeNull();
  });

  it("非法入参 → null（不抛错）", () => {
    expect(findFirstStaffLineInImage(new Uint8ClampedArray(0), 0, 0)).toBeNull();
    expect(findFirstStaffLineInImage(new Uint8ClampedArray(16), NaN, 10)).toBeNull();
    expect(findFirstStaffLineInImage(new Uint8ClampedArray(16), 10, Infinity)).toBeNull();
    expect(findFirstStaffLineInImage(new Uint8ClampedArray(16), -4, 10)).toBeNull();
    expect(findFirstStaffLineInImage(new Uint8ClampedArray(4), 2.5, 3.5)).toBeNull();
    // 非整数尺寸单独也要挡：上面几条都同时带着别的非法性，分不出是哪一条挡住的。
    // 用一张真能检出的页，只把尺寸改成非整数 —— 没有守卫时 `Int32Array` 的静默截断
    // 会照常给出 300，而不是 null。
    //
    // 缓冲同时要**给足**：给一张按整数尺寸算出来的缓冲，「缓冲长度前置条件」会顺带
    // 判非法，这条就变成在验另一个守卫，整数性守卫本身没人看着（实测：把整数守卫退回
    // `Number.isFinite`，用原页当入参照样绿）。空白缓冲也不行 —— 全墨页本来就返回 null，
    // 于是红不了。所以下面把同一张真页铺进「按非整数尺寸算出来的缓冲」里。
    const page = paintPage(TW, TH, [...staffLines(300, 0), ...staffLines(440, 0)]);
    expect(findFirstStaffLineInImage(page, TW, TH)).toBe(300);

    const taller = new Uint8ClampedArray(TW * (TH + 0.5) * 4).fill(255);
    taller.set(page);
    expect(findFirstStaffLineInImage(taller, TW, TH + 0.5)).toBeNull();

    const wider = new Uint8ClampedArray((TW + 0.5) * TH * 4).fill(255);
    wider.set(page); // 行跨距按非整数宽度算，扫描时每行相对源页错开半个像素，仍到处是墨
    expect(findFirstStaffLineInImage(wider, TW + 0.5, TH)).toBeNull();
  });
});
