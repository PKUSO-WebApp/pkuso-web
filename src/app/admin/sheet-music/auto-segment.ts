/**
 * 「勾了『乐谱分段』，分析完就自动跑分段」的判据（#386）。
 *
 * 这份判据是**纯的** —— 不 import React、不读组件 state、不碰 DOM，所以能直接单测；
 * 「什么时候评估」那件事留在接线层 `use-auto-segment.ts`。
 *
 * 分两层，因为两层的失败方式不一样：
 *
 * | 层 | 函数 | 回答 |
 * |---|---|---|
 * | 行级 | `autoSegmentRowVerdict` | 这一行为什么进 / 不进目标集（带原因码） |
 * | 批次级 | `autoSegmentPlan` | 这一拍该不该点火、该跑哪几行 |
 *
 * ⚠️ 目标集**由这里算出来、显式传给 `startSegmentation`**，不复用 `segPending`：
 * 那一份把 `segState === "error"` 也算作候选（手点 = 重试），而自动路径只挑
 * **从没跑过**的行 —— 否则「失败 → 收尾 → 又失败 → …」是个无界循环，
 * 而每一圈都真烧 OCR。
 */
import type { UploadFile, UploadPhase } from "./upload-modal.types";
import { isUnidentified, segEligible } from "./row-text";

/**
 * 「乐谱分段」开关的初值：**关**。
 *
 * 勾上 = 这一批分析完**自动**跑窄带 OCR 分段。不勾时保留的是「改这个功能之前、
 * 开关处于默认状态」的那套行为：页脚那个「识别分段」按钮照旧按 `segPending` 出现、
 * 点了照旧跑同一条路。
 *
 * ⚠️ 有一处**刻意的不对称**，它是本设计唯一可被质疑的地方：改动之前这颗开关
 * **同时**控制那个按钮的显隐（不勾 = 这一批整个跳过分段）。改后它只管「自动不自动」。
 * 之所以不把按钮也一起收进开关：不勾就没按钮的话，「先分析、看着结果再决定要不要分段」
 * 这条路会先被掐掉 —— 而那个按钮本来就是分段的**成本守卫**（代价写在按钮脸上），
 * 把它藏起来换来的不是安全，是先必须盲勾。
 *
 * 导出成常量（而不是在组件里写 `useState(false)`）是为了让「默认关」有个**能被测到**
 * 的落点：组件取初值就是读它。默认关的理由是成本 —— 分段一份 N 页的合订谱要烧 N 次
 * OCR（免费档 500 次/天/IP），自动点火必须由人显式勾选。
 */
export const AUTO_SEGMENT_DEFAULT = false;

/** 一行没进目标集的原因。只用于排查与测试断言 —— 行为只由 `segment` 决定。 */
export type SegAutoSkipReason =
  /** 这一行分析还没跑完（或在逐行重试中）：不是「不跑」，是「这一拍还轮不到它」 */
  | "not-ready"
  /**
   * 分段这一步已经有结论了：`running`（在途，算重入）/ `done`（跑过了） /
   * `error`（失败了，**只等手点重试** —— 自动重试是无界循环）。
   */
  | "already-run"
  /**
   * 弃权行（`instrument === ""`）：模型自己说不认识这张谱。永不自动推进 ——
   * 自动推进意味着为一张「不知道是什么」的谱自动烧掉 N 次 OCR。
   */
  | "abstained"
  /** 与手点同源的资格判据（多页、非总谱、非失败行、不是切出来的段…）不同意为真 */
  | "not-eligible";

export type SegAutoRowVerdict =
  { segment: true; reason: "todo" } | { segment: false; reason: SegAutoSkipReason };

/**
 * 行级判据。**顺序有意义**：先「轮到它了吗」，再「它已经有结论了吗」，最后才是资格 ——
 * 原因码要指向**最靠前的那个**否因，否则弃权行会以 `not-eligible` 的名义被记下来，
 * 而排查时最想知道的就是「它是弃权、还是被别的条件拦了」。
 */
export function autoSegmentRowVerdict(f: UploadFile): SegAutoRowVerdict {
  if (f.status !== "analyzed") return { segment: false, reason: "not-ready" };
  if (f.segState !== undefined) return { segment: false, reason: "already-run" };
  if (isUnidentified(f)) return { segment: false, reason: "abstained" };
  if (!segEligible(f)) return { segment: false, reason: "not-eligible" };
  return { segment: true, reason: "todo" };
}

/** 这一拍没点火的原因。 */
export type SegAutoBlockedReason =
  /** 开关没勾 —— 默认就是它 */
  | "switch-off"
  /** 阶段不在 `confirm`（选文件阶段还没有行；分析/上传阶段行集不该被拆） */
  | "not-settled"
  /** 还有行在分析 / 上传中。同 `hasAnalyzingFiles` 那条纪律：这时候拆行会让在飞的任务写错行 */
  | "analyzing"
  /** 上一轮分段还在飞（`segBusy`）—— 重入 */
  | "segmenting"
  /** 段级识别还在飞（`refiningCount`）—— 与「确认上传」禁用是同一条理由 */
  | "refining"
  /** 闸门都开了，但没有一行符合行级判据 */
  | "nothing-to-do";

/** 自动路径要跑的那几行：`{ f, i }` 就是 `startSegmentation` 吃的形状。 */
export type SegAutoTarget = { f: UploadFile; i: number };

export type AutoSegmentPlan =
  { fire: true; targets: SegAutoTarget[] } | { fire: false; reason: SegAutoBlockedReason };

export type AutoSegmentInput = {
  /** 「乐谱分段」开关（组件态，勾选态在选文件阶段就定死 —— 之后整个开关块不再渲染） */
  enabled: boolean;
  phase: UploadPhase;
  /** 行**现取**（组件传 `filesRef.current`），不是渲染那一刻的快照 */
  files: readonly UploadFile[];
  hasAnalyzingFiles: boolean;
  segBusy: boolean;
  refiningCount: number;
};

/**
 * 批次级判据。闸门顺序也是**由外到内**：先在飞判据、最后才算目标集 ——
 * 前面任何一条为真时都不该去算目标集（那些行在这一拍根本没资格起跑）。
 *
 * ⚠️ **闸门这一组必须与手点那条路同源**：`phase === "confirm"` 与 `!hasAnalyzingFiles`
 * 是页脚那个按钮的 `disabled` 里就有的两条，`segBusy` / `refiningCount` 是
 * 「确认上传」的。自动路径比手点**更宽**的话，就会出现「按钮还灰着、自动却跑了」。
 */
export function autoSegmentPlan(input: AutoSegmentInput): AutoSegmentPlan {
  const { enabled, phase, files, hasAnalyzingFiles, segBusy, refiningCount } = input;
  if (!enabled) return { fire: false, reason: "switch-off" };
  if (phase !== "confirm") return { fire: false, reason: "not-settled" };
  if (hasAnalyzingFiles) return { fire: false, reason: "analyzing" };
  if (segBusy) return { fire: false, reason: "segmenting" };
  if (refiningCount > 0) return { fire: false, reason: "refining" };
  const targets = files
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => autoSegmentRowVerdict(f).segment);
  if (targets.length === 0) return { fire: false, reason: "nothing-to-do" };
  return { fire: true, targets };
}
