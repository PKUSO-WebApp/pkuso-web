/**
 * 窄带**拼图**：把一份合订谱的所有窄带叠成若干张长图，一次 OCR 拿回全部页的文本
 * （pkuso-web#290 的 OCR 成本优化）。
 *
 * ## 为什么可行（实测，不是推断）
 *
 * 探针（真实浏览器合成 + 部署在 dev 的 `ocr-analyze`，数据见 #290 的评论）：
 *
 * | 页数 | 拼图尺寸 | 结果 |
 * | --- | --- | --- |
 * | 12 | 254KB | **1 页**、39 行、按坐标**全部归对**（p7 拿 `III`、p9 拿 `IV`） |
 * | 6 | 76~102KB | 1 页、22~29 行，与逐页路线逐页吻合 |
 *
 * 三条要点：
 * 1. **一张图算 1 页** —— 绕开免费档「一次 ≤3 页」的限制（那是按页数算的，不是按图）；
 * 2. **尺寸 ≈ 各窄带之和 × 0.95~0.99**（实测），所以**渲染时就知道**每页多大、能事先分组，
 *    不必先合成再发现超了；
 * 3. 长图上的识别质量没垮（5472px 高、窄带里的小字照样读得出来）。
 *
 * ## 坐标归页是这一层唯一的风险点
 *
 * 上游给的是**像素坐标**（实测：12 页拼图里 top 落在 0~3456 之间）。但 `shape.ts`
 * 明确说过「单位由上游决定，本模块不做量纲判断 —— 那个检查在知道图高的**调用方**那里」。
 * 所以 `mapLinesToPages` 必须**自己验一次**：坐标全在 0~1 之间（归一化了）或超出图高，
 * 都判「不可用」并返回 null —— 让调用方退回逐页 OCR，而不是把文字归到错页或全归第 1 页
 * （那正是本仓记过的「看起来完全合法的错答案」）。
 */

/**
 * 单张拼图的**原始字节**预算（不是 base64）。
 *
 * 免费档是 1MB，而 base64 会放大 4/3 → 1MB base64 ≈ 750KB 原始字节。
 * 取 700KB 留一点余量（实测 21KB/页 → 约 33 页/张）。
 */
export const MOSAIC_BUDGET_BYTES = 700 * 1024;

/**
 * 单张拼图的**页数**上限。
 *
 * 为什么不只靠字节预算：拼图要在 canvas 上合成，画布是 `宽 × 页高 × N`，
 * 每像素 4 字节常驻。24 页 × 288px 高 × 1788 宽 ≈ 49MB —— 可接受且是瞬时的；
 * 再往上就该主动收口了（浏览器对 canvas 还有 32767px 的高度上限）。
 */
export const MOSAIC_MAX_PAGES = 24;

/**
 * **硬上限**：免费档一次 1MB。分组是按估算来的（安全上界），但合成之后拿到的是真实字节数 ——
 * 提交前再核一次，超了就让调用方退回逐页 OCR，而不是发一个注定被拒的请求。
 * （合成不花 OCR 配额，所以这次核对是免费的。）
 */
export const MOSAIC_HARD_LIMIT_BYTES = 1024 * 1024;

/**
 * 把一组「每页字节数」切成若干组，每组合成一张拼图。
 *
 * 贪心：**顺序装、装不下就新开一张**。顺序不能打乱 —— 页号是段边界的坐标系，
 * 而且归页要靠「第 k 条窄带在图上的 y 偏移」，乱序会让两者都错。
 *
 * 单页就超过预算时**仍然单独成组**（返回它自己）：宁可让上游去报「文件太大」，
 * 也不在这里悄悄丢一页 —— 丢页等于把边界判据挖掉一块，而界面上看不出来。
 */
export function packBands(
  pageBytes: number[],
  budgetBytes: number = MOSAIC_BUDGET_BYTES,
  maxPages: number = MOSAIC_MAX_PAGES,
): number[][] {
  const groups: number[][] = [];
  let cur: number[] = [];
  let curBytes = 0;
  for (const [i, bytes] of pageBytes.entries()) {
    const fits = cur.length > 0 && curBytes + bytes <= budgetBytes && cur.length < maxPages;
    if (!fits && cur.length > 0) {
      groups.push(cur);
      cur = [];
      curBytes = 0;
    }
    cur.push(i);
    curBytes += bytes;
  }
  if (cur.length > 0) groups.push(cur);
  return groups;
}

/** 一行 OCR 结果在**提交图**上的位置（只用得到 top） */
export interface MosaicLine {
  top: number;
  text: string;
}

/**
 * 按 y 把 OCR 行分回各页，返回**按页顺序**的文本数组；坐标不可用时返回 `null`。
 *
 * 判「不可用」的两条（都必须有，缺一个都会静默出错）：
 * - **归一化坐标**：上游若给 0~1 的比值，`floor(top / bandH)` 会把所有行都算到第 1 页 ——
 *   每一页的文本都错，而 `success`、`pageCount`、`lines.length` 全是正常的。
 *   判据：所有 top 都 ≤ 1.5 且图高远大于 1（真的只有一行像素高的情况不存在）。
 * - **超出图高**：负值或大于图高，说明坐标系不是我们想的那样。允许一点余量（行高可能
 *   让最后一个字的底边略微越界），但明显越界就整张弃权。
 *
 * 行的**顺序不作假设**（实测 `top` 不是单调的，OCR 按块返回），逐行独立判定。
 */
export function mapLinesToPages(
  lines: MosaicLine[],
  bandHeight: number,
  pageCount: number,
  mosaicHeight: number,
): string[] | null {
  if (!Number.isFinite(bandHeight) || bandHeight <= 0) return null;
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) return null;
  if (lines.length === 0) return null;
  const maxTop = Math.max(...lines.map((l) => l.top));
  const minTop = Math.min(...lines.map((l) => l.top));
  // 归一化坐标（0~1）：全部行都会被算进第 1 页 —— 必须当场认出这个形态
  if (maxTop <= 1.5 && mosaicHeight > 2) return null;
  // 明显越界：留 10% 余量给行高
  if (minTop < -mosaicHeight * 0.1 || maxTop > mosaicHeight * 1.1) return null;

  const pages = Array.from({ length: pageCount }, () => [] as string[]);
  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;
    const idx = Math.min(pageCount - 1, Math.max(0, Math.floor(line.top / bandHeight)));
    pages[idx].push(text);
  }
  return pages.map((t) => t.join("\n").trim());
}

/**
 * 拼图**编码前**的尺寸估算（字节）。实测比值 ≤ 0.99，所以用「各窄带之和」当上界是安全的。
 *
 * 这个数只在**分组**时用（真实大小由 `canvas.toBlob` 给，提交前还会再核一次）——
 * 它让「渲染完就知道该怎么分组」成立，而不是先合成再发现超了。
 */
export function estimateMosaicBytes(groupBytes: number[]): number {
  return groupBytes.reduce((s, b) => s + b, 0);
}
