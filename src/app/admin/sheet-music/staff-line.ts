/**
 * 谱线检测 —— 把首页裁到「标题区」再送 OCR。
 *
 * 起因：出版社扫描分谱的首页，乐器名只占顶部很小一条，其余九成以上是五线谱。
 * 整页送 OCR 时谱面会被强行当文字读，输出阿拉伯文/西里尔文之类的乱码。
 *
 * 为什么不用固定比例裁切：标题区高度由出版社排版决定，与页面尺寸无关。同一批
 * PMLASIA 分谱实测「第一条谱线」落在 14.5%~24.5% 之间 —— 固定比例总会在某些文件上
 * 切进乐谱、在另一些文件上漏掉乐器名。所以要按内容找边界。
 *
 * 判据是结构性的：标题区永远在乐谱之上，而乐谱必有谱线。
 *
 * ## 为什么用「最长连续暗段」而不是「行墨量」
 *
 * 最初版本统计每行的非白像素**总数**，再拿全页最大值定阈值。这条路实测失败了：
 * 谱线本身是钟形剖面，且各条线上叠加的谱号/符尾/力度记号不同，同页各条谱线的
 * 墨量相差 10~20%，于是第一条线常常只有全页最大值的 83~95% → 不是候选行 →
 * 成组扫描从第 2~5 条线才开始 → 裁切线落进谱表内部（33 份真实分谱里约 47% 中招，
 * 13% 把整个第一谱表带进送检图）。
 *
 * 换成「行内最长**连续**暗段」就没了这个问题：它是绝对量（与页宽比较，不依赖全页
 * 最大值），而且抓住了谱线的本质——一条横贯谱表的长横线。文字行的最长连续暗段
 * 只有几个字母宽，与谱线差一个数量级。
 *
 * 本模块全部是纯函数（不碰 canvas），便于单测：jsdom 没有 canvas 实现，
 * 从 canvas 取像素的那一步留在调用方。
 */

/** 判定「非白」的通道阈值，与 upload-modal 的 hasVisibleContent 保持一致 */
const INK_THRESHOLD = 240;

/** 一行里最长连续暗段达到页宽的此比例，才算「长横线」候选 */
const RUN_MIN_PCT = 0.35;

/**
 * 第一组要有几条线才认作谱表。
 * 用最长连续暗段做特征后不再「漏线」，所以可以要求完整的 5 条 —— 这是排除
 * 「标题区里恰好几条等距装饰线」这类误判的主要手段。
 */
const MIN_LINES = 5;

/** 谱表下方还要再有这么一组线，才确认「这页确实有乐谱」（排除纯装饰线页面） */
const CONFIRM_MIN_LINES = 3;

/** 谱表内相邻谱线的间距范围（占页高比例）。实测 16~18px / 2400px ≈ 0.65%~0.75% */
const GAP_MIN_PCT = 0.003;
const GAP_MAX_PCT = 0.015;

/** 组内间距的 max/min 容差（扫描畸变下放宽） */
const GAP_TOLERANCE = 1.6;

/** 裁切上限：第一条谱线超过此页高比例就不裁（标题区已接近半页，裁切失去意义） */
const MAX_CROP_PCT = 0.33;

/** 裁切条最小高度：低于此值说明首页直接进音乐，前面没有标题区 */
const MIN_STRIP_HEIGHT = 80;

/** 从 canvas 像素里取出来的「每行最长连续暗段」数组 */
export type RowRun = Int32Array;

/**
 * 逐行量出「最长连续暗段」的长度（像素）。
 *
 * 注意这里**不采样列**：谱线的定义就是"连续"，隔列采样会把一条长线的连续段切碎，
 * 正好破坏要测的特征。整页约 1800×2400 ≈ 430 万像素，实测几十毫秒，可接受。
 *
 * @param data   canvas 的 RGBA 像素（`ImageData.data`）
 * @param width  画布宽（像素）
 * @param height 画布高（像素）
 */
export function rowLongestRun(data: Uint8ClampedArray, width: number, height: number): RowRun {
  const runs = new Int32Array(height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width * 4;
    let best = 0;
    let current = 0;
    for (let x = 0; x < width; x++) {
      const i = rowOffset + x * 4;
      if (data[i] < INK_THRESHOLD || data[i + 1] < INK_THRESHOLD || data[i + 2] < INK_THRESHOLD) {
        current++;
        if (current > best) best = current;
      } else {
        current = 0;
      }
    }
    runs[y] = best;
  }
  return runs;
}

/** 把相邻候选行合并成「一条线」（谱线渲染后厚 1~4px），记 top 供定位、center 供间距比较 */
function mergeIntoLines(
  rowRun: ArrayLike<number>,
  threshold: number,
): Array<{ top: number; center: number }> {
  const lines: Array<{ top: number; center: number }> = [];
  let runTop = -1;
  for (let y = 0; y < rowRun.length; y++) {
    const hit = rowRun[y] >= threshold;
    if (hit && runTop < 0) runTop = y;
    if (!hit && runTop >= 0) {
      lines.push({ top: runTop, center: (runTop + y - 1) / 2 });
      runTop = -1;
    }
  }
  if (runTop >= 0) lines.push({ top: runTop, center: (runTop + rowRun.length - 1) / 2 });
  return lines;
}

/** 从 lines[start] 起，能连出多少条「间距在带内」的线；返回该组的末位下标与间距 */
function growGroup(
  lines: Array<{ top: number; center: number }>,
  start: number,
  gapMin: number,
  gapMax: number,
): { end: number; gaps: number[] } {
  const gaps: number[] = [];
  let j = start;
  while (j + 1 < lines.length) {
    const gap = lines[j + 1].center - lines[j].center;
    if (gap < gapMin || gap > gapMax) break;
    gaps.push(gap);
    j++;
  }
  return { end: j, gaps };
}

/** 一组线是否「够多且间距近似相等」 */
function isStaffGroup(gaps: number[], minLines: number): boolean {
  if (gaps.length + 1 < minLines) return false;
  return Math.max(...gaps) / Math.min(...gaps) <= GAP_TOLERANCE;
}

/** 从下标 start 起，其下是否还存在另一组合格谱表 */
function hasGroupBelow(
  lines: Array<{ top: number; center: number }>,
  start: number,
  gapMin: number,
  gapMax: number,
): boolean {
  for (let i = start; i < lines.length; i++) {
    const { gaps } = growGroup(lines, i, gapMin, gapMax);
    if (isStaffGroup(gaps, CONFIRM_MIN_LINES)) return true;
  }
  return false;
}

/**
 * 找第一条谱线的 y（像素）。找不到返回 null（此时调用方应放弃裁切、退回整页）。
 *
 * 步骤：取「最长连续暗段 ≥ 页宽 35%」的行 → 合并相邻行成一条线 → 找第一组
 * 5 条间距近似相等的线 → 再确认其下还有另一组线（排除纯装饰线页面）。
 */
export function findFirstStaffLine(
  rowRun: ArrayLike<number>,
  pageWidth: number,
  pageHeight: number,
): number | null {
  const height = rowRun.length;
  if (height === 0 || !Number.isFinite(pageWidth) || !Number.isFinite(pageHeight)) return null;
  if (pageWidth <= 0 || pageHeight <= 0) return null;

  const lines = mergeIntoLines(rowRun, pageWidth * RUN_MIN_PCT);
  if (lines.length < MIN_LINES) return null;

  const gapMin = pageHeight * GAP_MIN_PCT;
  const gapMax = pageHeight * GAP_MAX_PCT;

  for (let i = 0; i < lines.length; i++) {
    const { end, gaps } = growGroup(lines, i, gapMin, gapMax);
    if (!isStaffGroup(gaps, MIN_LINES)) continue;
    if (!hasGroupBelow(lines, end + 1, gapMin, gapMax)) continue;
    return lines[i].top;
  }
  return null;
}

/** 裁切决策的结果。每个分支都带上界面回显所需的数据。 */
export type CropDecision =
  | { crop: true; height: number; staffPct: number }
  | { crop: false; reason: "no-staff" }
  | { crop: false; reason: "too-tall"; staffPct: number }
  | { crop: false; reason: "too-thin"; height: number };

/**
 * 由第一条谱线位置决定裁不裁、裁多高。
 * 三种不裁的情况都是**安全降级**：退回整页，最多是 OCR 效果差一些，不会更糟。
 */
export function decideTitleCrop(staffY: number | null, pageHeight: number): CropDecision {
  if (staffY === null || !Number.isFinite(staffY) || !Number.isFinite(pageHeight)) {
    return { crop: false, reason: "no-staff" };
  }
  if (pageHeight <= 0 || staffY < 0) return { crop: false, reason: "no-staff" };
  const staffPct = staffY / pageHeight;
  if (staffPct > MAX_CROP_PCT) return { crop: false, reason: "too-tall", staffPct };
  if (staffY < MIN_STRIP_HEIGHT) return { crop: false, reason: "too-thin", height: staffY };
  // 裁到谱线**之上**（不含谱线本身），避免把五线谱带进送检图
  return { crop: true, height: staffY, staffPct };
}
