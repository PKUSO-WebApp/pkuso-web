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
 */

/** 一份合订谱的页数 → 跑分段要几次 OCR（每页一次，没有别的调用） */
export function estimateOcrCalls(pageCount: number): number {
  return pageCount > 0 ? pageCount : 0;
}

/** 一批文件要跑多少次 OCR —— 导入前给用户看的那个数 */
export function estimateTotalOcrCalls(
  files: Array<{ pageCount: number | null; eligible: boolean }>,
): number {
  return files.reduce((sum, f) => (f.eligible ? sum + estimateOcrCalls(f.pageCount ?? 0) : sum), 0);
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
 *   `isFullScore`，而不是自己去判。
 */
export function needsSegmentation(pageCount: number | null, isFullScore: boolean): boolean {
  if (isFullScore) return false;
  return typeof pageCount === "number" && pageCount > 1;
}

/** 一段：闭区间的起止页 + 该段的识别结果（由后续的单段识别填） */
export interface Segment {
  from: number;
  to: number;
  /** 该段的乐器名 —— 先留空，由单段识别（或用户）填 */
  instrument: string;
  /** 该段的声部（闭集） */
  section: string;
  /** 该段的分声部号 */
  subParts: number[];
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
 */
export function normalizeSegments(
  segmentStarts: number[],
  pageCount: number,
): Array<{ from: number; to: number }> {
  if (pageCount < 1) return [];
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
