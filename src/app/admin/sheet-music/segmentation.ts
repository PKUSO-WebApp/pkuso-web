import { MOSAIC_PAGES_PER_CALL } from "./mosaic";
/**
 * 合订谱分段的纯逻辑（pkuso-web#290 Step 1）。
 *
 * 单独成模块的理由同 `staff-line.ts` / `sub-parts.ts`：这些是纯函数，正确性靠
 * 真实语料与用户操作两侧夹着，必须能被测试直接 import。
 *
 * ## 这一层负责什么
 *
 * 后端 `segment-parts` 只回答「哪几页是新的一份的开头」（`cuts`）。这里是：
 * 1. **跑之前**把代价说清楚（要几次 OCR）—— #290 的验收标准之一，
 *    而且 OCR.space 是 500 次/天/IP，用户有权在点火前知道要烧多少；
 * 2. **跑之后**把 `cuts` 变成用户能改的**段**（起止页 + 每段的乐器/分声部），
 *    并在用户拖动边界时**不重跑 OCR**（页文本已经在手里了）。
 *
 * ## 边界编辑的一条硬约束
 *
 * 界面上「段的起点」是**输入框**，而输入框里出现的是**打字过程中的中间态**。
 * 本模块的 `moveSegmentStart` / `parseBoundaryText` 因此一律**拒绝**非法值
 * （原样返回 / 返回 null），**绝不做「非法就把它过滤掉」**——`normalizeSegments`
 * 的语义是 filter，拿它直接接输入框，敲一个字符就会把那个边界**当成重复值合并掉**，
 * 一段就此消失，恢复只能重跑整个分段（= 再烧 N 次 OCR）。
 */

/**
 * 一份合订谱的页数 → 跑分段要几次 OCR。`done` = 已经在手里的页数（重试时不为 0）。
 *
 * ⚠️ 这是**估算**，不是上界也不是下界：单张拼图装多少页取决于每页窄带的真实大小
 * （40KB/页与 21KB/页差一倍）。另外每张拼图在瞬时故障时会重试（次数见 `upload-modal.tsx` 的
 * `OCR_RETRY_DELAYS`），所以真实调用数可能超过它 —— 界面上写「最多 N 次」是准的。
 */
export function estimateOcrCalls(pageCount: number, done = 0): number {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) return 0;
  const missing = pageCount - (Number.isSafeInteger(done) && done > 0 ? done : 0);
  if (missing <= 0) return 0;
  // 窄带是**拼图**后一次 OCR（见 `mosaic.ts`）：每张长图装多少页，取决于「页数上限」与
  // 「700KB 字节预算」**哪条先到**，而每页窄带多大要渲染完才知道。
  // 所以这里按 `MOSAIC_PAGES_PER_CALL`（两条线里更紧的那条 + 保守每页字节）估 ——
  // 界面上写「**约** N 次」：它既可能低估（窄带比典型值大）也可能高估（更小），
  // 拿它当承诺就是错的。`estimateOcrCalls` 的 doc 里写了这段。
  return Math.ceil(missing / MOSAIC_PAGES_PER_CALL);
}

/** 一批文件还要跑多少次 OCR —— 导入前给用户看的那个数 */
export function estimateTotalOcrCalls(
  files: Array<{ pageCount: number | null; eligible: boolean; donePages?: number }>,
): number {
  return files.reduce(
    (sum, f) => (f.eligible ? sum + estimateOcrCalls(f.pageCount ?? 0, f.donePages ?? 0) : sum),
    0,
  );
}

/**
 * 哪些文件要跑分段。
 *
 * 用户已定：**对所有多页文件跑**（不限于人工标记的合订谱）。
 * 两条排除：
 * - **单页文件**：没有边界可言，跑它是白烧一次 OCR。
 * - **总谱**：用户已定「总谱不参与切分检测」（省掉最大的一笔 OCR）。
 *   ⚠️ 总谱目前**认不出来**（实测否掉了三个本地判据，见 issue #290 的评论），
 *   只能靠人工标记 `section === '总谱'` 兜底 —— 所以这个函数收的是**已经算好的**
 *   `isFullScore`，而不是自己去判。界面上必须让用户**选得到**总谱，
 *   否则这条分支永远走不到（见 upload-modal 的声部下拉）。
 */
export function needsSegmentation(pageCount: number | null, isFullScore: boolean): boolean {
  if (isFullScore) return false;
  return typeof pageCount === "number" && pageCount > 1;
}

/** 把「切点」变成「段」。与后端 `planToRanges` 同义 —— 但前端拿到的响应里已经带了 `ranges`，
 * 这个函数用于**用户改了边界之后**重算，所以两边都要有。 */
export function cutsToSegments(
  cuts: number[],
  pageCount: number,
): Array<{ from: number; to: number }> {
  // 页数非法就没有段可言 —— 不守这一条会产出 `{from: 1, to: 0}` 这种
  // 「起点在终点之后」的段，而下游会照着它去切片（切片时越界或切出空文件）
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) return [];
  const starts = [1, ...cuts.filter((c) => Number.isSafeInteger(c) && c > 1 && c <= pageCount)];
  const uniq = [...new Set(starts)].sort((a, b) => a - b);
  return uniq.map((from, i) => ({
    from,
    to: i + 1 < uniq.length ? uniq[i + 1] - 1 : pageCount,
  }));
}

/**
 * 用户在界面上改完边界后，把段收敛成合法的两级结构。
 *
 * 用户能做的两件事：**把某个切点往后拖**（把下一页并进当前段）或**往前拖**（把当前页
 * 让给下一段）。所以这里收的是一组「段的起点」而不是原始 cuts —— 用户的动作本质是
 * 移动起点。约束：
 * - 第 1 段恒从第 1 页开始（那条不是边界，是定义）；
 * - 起点严格升序、落在 2..pageCount 内；
 * - 段区间闭合并覆盖全部页（不留空洞、不重叠）—— 否则后面的切分与改名会错位。
 *
 * ⚠️ 语义是 **filter**：落不进合法范围的起点会被**丢掉**（= 该段并进上一段）。
 * 这是「收敛最终状态」该有的语义，但**不能**拿它直接接输入框的中间态
 * ——要接输入框请走 `moveSegmentStart`（拒绝而不是丢弃）。
 */
export function normalizeSegments(
  segmentStarts: number[],
  pageCount: number,
): Array<{ from: number; to: number }> {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) return [];
  const starts = [...new Set([1, ...segmentStarts])]
    .filter((s) => Number.isSafeInteger(s) && s >= 1 && s <= pageCount)
    .sort((a, b) => a - b);
  return starts.map((from, i) => ({
    from,
    to: i + 1 < starts.length ? starts[i + 1] - 1 : pageCount,
  }));
}

/**
 * 把一次 `segment-parts` 的响应收敛成可以直接显示的段。
 *
 * **不信 `ranges`**：它与 `cuts` 是同一个响应的两个字段，但契约上真正被校验过的是
 * `cuts`（后端只对 cuts 做页号范围与证据校验）。所以这里从 `cuts` 自己算段 ——
 * 万一两者不一致，以 cuts 为准。响应里的 ranges 只当参考。
 */
export function segmentsFromResponse(
  cuts: unknown,
  pageCount: number,
): Array<{ from: number; to: number }> {
  if (!Array.isArray(cuts) || !Number.isSafeInteger(pageCount) || pageCount < 1) {
    return cutsToSegments([], pageCount);
  }
  const nums = cuts.filter((c): c is number => typeof c === "number" && Number.isSafeInteger(c));
  return cutsToSegments(nums, pageCount);
}

/**
 * 一次响应 → 段的**起点数组**（恒含第 1 页，严格升序）。
 *
 * 界面上编辑的就是这个数组：它与渲染出来的段**逐位对应**（`starts[i]` 是第 i 段的
 * 起点）。两者一旦不同步（例如一边过滤了一边没过滤），编辑就会落到**别的段**上。
 */
export function startsFromResponse(cuts: unknown, pageCount: number): number[] {
  return segmentsFromResponse(cuts, pageCount).map((s) => s.from);
}

/**
 * 第 `i` 个边界的**可动区间**（闭区间）。
 *
 * 边界是「第 i 段的起点」，它左右都不能碰相邻的起点：往左最多到上一段起点 +1，
 * 往右最多到下一段起点 -1（最后一条边界的上界是 pageCount）。
 * 返回 `null` = 这个下标不是一个可动的边界（第 0 段恒从第 1 页起，不是边界）。
 */
export function boundarySpan(
  starts: number[],
  i: number,
  pageCount: number,
): { lo: number; hi: number } | null {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) return null;
  if (!Number.isSafeInteger(i) || i < 1 || i >= starts.length) return null;
  const lo = starts[i - 1] + 1;
  const hi = (i + 1 < starts.length ? starts[i + 1] : pageCount + 1) - 1;
  return { lo, hi };
}

/**
 * 输入框里的**原文** → 可提交的起点页。非法返回 `null`。
 *
 * 只认纯数字串：`""`（用户清空）、`-`、`1.5`、`1e3`、`12abc` 全部拒绝。
 * **非法一律不提交**，既不修正也不删除 —— 空串在别处常被当成「没有值、删掉这一项」，
 * 那在边界上等于「静默合并两段」，用户根本没下过这个命令。
 */
export function parseBoundaryText(raw: string, lo: number, hi: number): number | null {
  const t = raw.trim();
  if (!/^[0-9]+$/.test(t)) return null;
  const v = Number(t);
  if (!Number.isSafeInteger(v) || v < lo || v > hi) return null;
  return v;
}

/**
 * 把第 `i` 个边界移到 `value`。非法/越界**原样返回**（不删边界、不抛）。
 *
 * `value` 落在 `boundarySpan` 内 → 结果仍严格升序，所以下标不变、段的条数不变。
 */
export function moveSegmentStart(
  starts: number[],
  i: number,
  value: number,
  pageCount: number,
): number[] {
  const span = boundarySpan(starts, i, pageCount);
  if (!span) return starts;
  if (!Number.isSafeInteger(value) || value < span.lo || value > span.hi) return starts;
  const next = [...starts];
  next[i] = value;
  return next;
}

/**
 * 把第 `i` 段从中间拆成两段 —— **模型漏切时人工补一个边界**。
 *
 * 后端刻意「宁可少切不可多切」（少切只是当成一份处理，多切会把两份谱混进一段），
 * 所以「补边界」是用户的高频动作，不能只提供「移动」。
 * 只有一页的段拆不开，原样返回（用引用相等判断「没改」）。
 */
export function splitSegment(starts: number[], i: number, pageCount: number): number[] {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) return starts;
  if (!Number.isSafeInteger(i) || i < 0 || i >= starts.length) return starts;
  const from = starts[i];
  const to = i + 1 < starts.length ? starts[i + 1] - 1 : pageCount;
  if (to - from < 1) return starts;
  const mid = from + Math.floor((to - from + 1) / 2);
  const next = [...starts];
  next.splice(i + 1, 0, mid);
  return next;
}

/**
 * 删掉第 `i` 个边界（第 `i` 段并进上一段）。第 0 段不是边界，删不动，原样返回。
 *
 * ⚠️ 这是**唯一的**会减少段数的操作，只有用户在界面上显式点了「合并」才会走到
 * —— 打字打到一半绝不该有同样的效果（见文件头的硬约束）。
 */
export function mergeSegmentIntoPrev(starts: number[], i: number): number[] {
  if (!Number.isSafeInteger(i) || i < 1 || i >= starts.length) return starts;
  const next = [...starts];
  next.splice(i, 1);
  return next;
}
