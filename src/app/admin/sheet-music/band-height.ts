/**
 * 「窄带多高」这件事里**不碰 canvas 的那一半**：采样哪几页、怎么把几页的
 * 第一谱线位置收成一个数、什么时候退回兜底高度。
 *
 * 单独成模块有两个原因：
 *
 * 1. 判据要能被单测逐条钉住（尤其是兜底条件），不必造 canvas/pdf.js；
 * 2. 复现台（仓库外的 `.render-harness/seg-replay/`）可以直接把这一个文件
 *    搬过去，用**同一份**采样与聚合规则算语料的自适应高度 —— 复现台自己
 *    再抄一份公式的话，验的就不是上线的那份实现。
 *
 * ## 为什么是「一份文档一个值」
 *
 * 窄带之所以能当分段信号，靠的是同一个高度下「首页有标题块、续页只有页眉」
 * 这个**页与页之间的差**。改成逐页自适应会把这条差整个抹掉（首页带高、续页
 * 带矮，内容分布反而趋同），判据本身就不存在了。所以这里所有函数都以
 * 「一份文档」为粒度：`bandSamplePages` 收总页数，`decideBandPct` 收几页的
 * 比值、只出一个数。
 *
 * ## 为什么聚合用 max
 *
 * 要覆盖的是「标题区最高能到哪」—— 窄带必须够高，才能把标题页上那整块
 * 乐器名/曲名圈进来。续页天然是「页眉 + 少量乐谱」，它们的第一谱线位置
 * 是**文档里的低值**；min / 中位数都会被这些占多数的续页拉回 9%~13%，
 * 于是又变回原来那个固定 12%（标题页仍然被切掉）。max 是唯一在估计
 * 「这份文档排版允许的标题区上界」的量级。语料上实测：同一批文档里
 * max 能覆盖绝大部分标题页的第一谱线，min/中位数几乎一个都覆盖不到
 * （测量方式与数字见 PR；这里不写会腐烂的计数）。
 *
 * ## 为什么采样这几页
 *
 * 扫描分谱常见「封面页 + 标题页」的开头：封面常常没有谱线（检测返回
 * null），真正的标题页是第 2 页。所以前两页**必须**进样本，不能只取
 * 第 1 页 + 均匀分布。之后再均匀取几页，是为了照顾合订谱里**后面**那些
 * 声部的标题页（它们的排版可能比第一份更深）。
 *
 * 页数取 5（前 2 + 后 3，含末页）：每多采一页就多一次整页渲染
 * （pdf.js 解码是大头，不能并发），而第 6 页往后对「最深标题区」的
 * 估计只有边际收益 —— 语料上多采一页只改善个别边缘样本，成本却多 20%。
 * 页数少的文档自动退化为「有几页采几页」。
 */

/**
 * 兜底高度（页高比例）—— **用户定的**：推不出来时用 25%。
 *
 * 它不是「另一个固定值」，而是「这次没法从文档本身得到答案」时的安全窗：
 * 比旧 12% 高，至少不会把标题页整块切掉；又低于 `BAND_PCT_MAX`，仍在
 * 「窄带」而不是「半页」的量级。
 */
export const BAND_PCT_FALLBACK = 0.25;

/**
 * 自适应高度的下界。低于它就认为「检测到的东西不像标题区」。
 *
 * 依据是结构性的：续页的第一谱线实测落在页高 9%~13%（页眉本身就占那么多），
 * 8% 比所有观察到的续页位置都浅。全文档最深的采样页都不到 8%，更可能是
 * 检测器咬到了顶部一条装饰线/分隔线，而不是真的标题区边界 —— 那时退回
 * 25% 比把整条窄带压到 8% 以下安全（太薄会把标题也切掉，而且切掉的不是
 * 一行两行，是整块）。
 */
export const BAND_PCT_MIN = 0.08;

/**
 * 自适应高度的上界。超过它就退回兜底。
 *
 * 33% 与 `decideTitleCrop` 的 `MAX_CROP_PCT` 是同一个量级判断（那里是
 * 「标题区已接近半页，裁切失去意义」），但**故意不 import 那个常量**：
 * 那是裁切策略的上限，这里是窄带高度是否还可信的上限，两者将来可能分开调。
 *
 * 语料里标题页的第一谱线大多在 15%~25%；34% 以上的值是孤立异常页
 * （检测器 latch 到页中部的谱表）。到了 30% 以上，窄带已经装进大量乐谱，
 * 「窄带」这个前提本身就不成立了。
 */
export const BAND_PCT_MAX = 0.33;

/**
 * 至少要有几页**真的测到**第一谱线，才允许用 max。
 *
 * 一页的读数分不清「这是这份文档的标题区深度」还是「这一页的个别异常」；
 * 两页一致才说明这是排版层面的性质。只有一页测到时退回 25%：单页文档
 * 本来也没有分段可做，兜底没有损失。
 */
export const BAND_MIN_DETECTED = 2;

/** 前几页固定进样本（封面 + 标题页） */
const SAMPLE_HEAD = 2;

/** 之后均匀取几页（含末页） */
const SAMPLE_SPREAD = 3;

/**
 * 这份文档要采样哪几页（升序、去重、1-based）。
 *
 * 前 `SAMPLE_HEAD` 页固定；其余在 `[SAMPLE_HEAD+1, pageCount]` 上均匀取
 * `SAMPLE_SPREAD` 个位置（**含末页**，否则合订谱最后一份的标题页永远是
 * 盲区）。总页数不够时自然退化为全采。
 */
export function bandSamplePages(pageCount: number): number[] {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) return [];
  const picked = new Set<number>();
  for (let p = 1; p <= Math.min(SAMPLE_HEAD, pageCount); p++) picked.add(p);
  if (pageCount <= SAMPLE_HEAD) return [...picked].sort((a, b) => a - b);

  const start = SAMPLE_HEAD + 1;
  const span = pageCount - start;
  for (let k = 0; k < SAMPLE_SPREAD; k++) {
    const at = start + (span * k) / Math.max(1, SAMPLE_SPREAD - 1);
    picked.add(Math.min(pageCount, Math.max(start, Math.round(at))));
  }
  return [...picked].sort((a, b) => a - b);
}

/** 一次自适应高度的结论。`fallback` 只为复现台/测试报告「有没有走兜底」 */
export interface BandPctResult {
  pct: number;
  fallback: boolean;
}

/**
 * 把采样页的第一谱线位置（`staffY / pageHeight`，检测失败为 `null`）
 * 收成**一份文档唯一**的窄带高度。
 *
 * 决策顺序（每一步都有测试钉住）：
 * 1. 有效读数（有限、>0 且 ≤1）少于 `BAND_MIN_DETECTED` → 25%；
 * 2. 取 max；
 * 3. max 在 `[BAND_PCT_MIN, BAND_PCT_MAX]` 之外 → 25%；
 * 4. 否则用 max。
 *
 * 无效输入（NaN / Infinity / 负数 / 0 / >1）按「这一页没测到」处理，不是
 * 让整份文档失败 —— 单页异常不该把一份好文档推去兜底以外的状态。
 */
export function decideBandPct(staffPcts: ReadonlyArray<number | null | undefined>): BandPctResult {
  const detected = staffPcts.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1,
  );
  if (detected.length < BAND_MIN_DETECTED) {
    return { pct: BAND_PCT_FALLBACK, fallback: true };
  }
  const pct = Math.max(...detected);
  if (pct < BAND_PCT_MIN || pct > BAND_PCT_MAX) {
    return { pct: BAND_PCT_FALLBACK, fallback: true };
  }
  return { pct, fallback: false };
}
