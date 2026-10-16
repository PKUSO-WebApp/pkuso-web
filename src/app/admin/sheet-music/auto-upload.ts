/**
 * 「分析完直接上传」开关（pkuso-web#386）：**点火判据** + 偏好读写。
 *
 * 这个模块里只有纯函数（不 import React、不读组件 state），三件事：
 *
 * 1. `autoUploadVerdict` —— **行级**：「这一行现在该不该自动上传」，附带原因码。
 * 2. `autoUploadBatch` —— **批次闸门**：「这一批现在该不该点火」。前四条守卫与页脚
 *    「确认上传」按钮同源（`phase` / `hasAnalyzingFiles` / `segBusy` / `refiningCount`），
 *    第五条 `segment-pending` 是自动路**独有**的（等分段跑完，理由见那一处）。
 * 3. 偏好读写（`AUTO_UPLOAD_PREF_KEY`），与 `src/lib/theme.ts` 同一套写法：
 *    可注入 storage 便于单测；读不到 / 值非法 / 抛异常一律退回默认（关）。
 *
 * ## 为什么判据要抽成独立模块，而不是包一层 `uploadBlocker`
 * 两者管的**不是同一件事**：
 *
 * - `uploadBlocker`（`row-text.ts`）管「**这一次写库放不放行**」—— 它在 `uploadOne`
 *   里被调用，手动与自动两条路都要过它。它是**最后一道闸**，管的是「这一份能不能落下去」。
 * - 这里管「**谁能让这一批起跑**」—— 是**点火条件**。手动路上没有它（人点了就是点了）；
 *   自动路上，只有「本来就该传、且不需要人看一眼」的行才配让工作开跑。
 *
 * 所以两者**看起来重叠**（都在意空乐器名、都在意非法名），但改动的动机不同
 * （前者为了不写坏库，后者为了不替人做决定）。合并成一份的话，「弃权行永不自动传」
 * 这条硬规矩就挂到别人的实现上去了 —— 那正是它被写成独立判据的原因。
 *
 * ## 弃权行（`isUnidentified`）永不自动传
 * 这是 issue 里点名「硬的」那一条：弃权是安全方向，而把没识别的名字写进文件名与
 * `sub_parts` 是**不可逆**的（文件名会落到用户文件系统上）。
 * 判据用 `isUnidentified`（界面上标「没认出乐器」用的是同一个函数），
 * **不另写一份 `instrument === ""`** —— 界面上标成弃权的行，自动上传也不碰。
 *
 * ⚠️ 「不点火」与「不被写库」是**两层**保证，别读混：判据为假只说明这一行不能
 * 让工作起跑。同批里只要有一行就绪，整批就按既有路径起跑，而弃权行到 `uploadOne`
 * 那里仍会被 `uploadBlocker` 拦下（行上留红字、不写库、不建存储对象）——
 * 与手点「确认上传」逐字相同的行为。
 *
 * ## 触发时机（调用点的规矩，不在这里）
 * 判据**只在收尾那一刻**评估（分析收尾 / 分段收尾），**不在每次 `files` 变化时评估**：
 * 后者会在用户敲第二个字时把半截乐器名当文件名传上去。所以调用点的 effect 依赖数组里
 * **没有 `files`**，行状态从 `filesRef.current` 现取。这里别加「自动重试」之类的东西。
 */

import type { UploadFile, UploadPhase } from "./upload-modal.types";
import { editsOf, isUnidentified, segEligible, unsplitSegments, uploadBlocker } from "./row-text";

/**
 * 偏好存在 `localStorage`。**只认 `"1"` 为开**：其余值（含 `"true"` / `"0"` / 空串）
 * 一律按关 —— 默认关是硬要求，宁可把读不懂的值当关，也不要因为写别的格式而默认开。
 */
export const AUTO_UPLOAD_PREF_KEY = "pkuso-sheet-music-auto-upload";

/**
 * 读偏好。`storage` 可注入（测试用）；不传时用 `window.localStorage`（SSR 下为空）。
 * 存储不可用（隐私模式 / SSR）或抛异常时按**关**处理，绝不抛出去。
 *
 * 调用点注意：**挂载后读**，不要在渲染期读 —— 服务端渲不出这个值，
 * 渲染期读会让首屏与 hydration 不一致。
 */
export function readAutoUploadPref(storage?: Storage | null): boolean {
  try {
    const store = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
    return store?.getItem(AUTO_UPLOAD_PREF_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * 写偏好。关掉时**删键**而不是写 `"0"`：默认就是关，留一条与默认同义的记录没有意义，
 * 而且那种记录一旦被 `"1"` 之外的解析方式读出来就是错的。
 * 存储不可用（隐私模式）时静默跳过 —— 本次会话内仍然生效，只是不持久化。
 */
export function writeAutoUploadPref(on: boolean, storage?: Storage | null): void {
  try {
    const store = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
    if (!store) return;
    if (on) store.setItem(AUTO_UPLOAD_PREF_KEY, "1");
    else store.removeItem(AUTO_UPLOAD_PREF_KEY);
  } catch {
    // localStorage 不可用：不持久化，本次选择仍即时生效
  }
}

/**
 * 这一行**为什么**不自动传。给测试与将来界面上的解释用，不是文案
 *（文案要另外写，原因码改一次不该顺手改一句用户看得见的话）。
 */
export type AutoUploadRowReason =
  /** 开关关着 —— 任何行都不放行 */
  | "switch-off"
  /** 行还没到「已分析」（`pending` / `analyzing`），或者已经传完了（`uploading` / `done` / `error`） */
  | "not-ready"
  /** 弃权：没认出乐器名 */
  | "abstained"
  /** 识别出多段却还没拆（`unsplitSegments`）—— 拆完才有落点可言 */
  | "unsplit"
  /** 其余拦截（非法名 / 号没读懂 / 号非法），与手动上传过的是同一道 `uploadBlocker` */
  | "blocked";

export type AutoUploadRowVerdict =
  { upload: true } | { upload: false; reason: AutoUploadRowReason };

/**
 * 行级判据：**单看这一行**，它现在该不该自动上传。
 *
 * 检查顺序按「行状态机从早到晚」排，所以返回的原因是**这一行要往前走必须先解决的那件事**
 *（而不是随便哪一件）。顺序也是判据的一部分：
 *
 * - `status !== "analyzed"` 先于一切 —— 未就绪的行连「弃权」都还谈不上。
 *   这一条同时钉住「不重复传」：`uploading`（飞行中）与 `done`（已传完）都不放行，
 *   所以同一行不会被自动路径挑第二次。
 * - **弃权先于 `uploadBlocker`**：空乐器名本来也会被 `uploadBlocker` 拦下（那是它的第一条），
 *   但这里要**自己**判一次 —— 见文件头「为什么判据要抽成独立模块」。
 * - `unsplit` 先于 `blocked`：分段是分析刚收尾的事，而名字问题是用户可能正在敲的东西。
 */
export function autoUploadVerdict(f: UploadFile, enabled: boolean): AutoUploadRowVerdict {
  if (!enabled) return { upload: false, reason: "switch-off" };
  if (f.status !== "analyzed") return { upload: false, reason: "not-ready" };
  if (isUnidentified(f)) return { upload: false, reason: "abstained" };
  if (unsplitSegments(f)) return { upload: false, reason: "unsplit" };

  const { section, instrument, subPartsInvalid, subPartsUnread } = editsOf(f);
  if (uploadBlocker({ section, instrument, subPartsInvalid, subPartsUnread })) {
    return { upload: false, reason: "blocked" };
  }
  return { upload: true };
}

/**
 * 这一批**为什么**不点火。
 *
 * `nothing-ready` 与另外几条不同：前几条是「现在还不是时候」（等它安静下来还能再判），
 * 这一条是「安静下来也没有一行能传」—— 那一批本来就该由人来点。
 */
export type AutoUploadHold =
  | "switch-off"
  | "not-confirmed"
  | "analyzing"
  | "segmenting"
  | "refining"
  | "segment-pending"
  | "nothing-ready";

export type AutoUploadBatch = { fire: true } | { fire: false; reason: AutoUploadHold };

/**
 * 这一行**还在等分段**：分段开着、它够格分段、却还没跑过。
 *
 * 与 `segEligible` 不是一回事：`segEligible` 是「够格」，这里是「够格但还没跑」。
 * 「乐谱分段」这道总开关**不在这里**判 —— 它是调用方传进来的那一个
 * （`segPending` = 总开关 && 这个函数，见 `upload-modal.tsx`）。
 *
 * ⚠️ 这个判据放在本模块而不是 `row-text.ts`（那里才是别的行级谓词的家）：
 * 它服务的只有点火闸门这一处；`row-text.ts` 也正好在行数闸门的顶上，加不进去。
 */
export const segAwaiting = (f: UploadFile) => segEligible(f) && f.segState !== "done";

/** 点火前必须全部安静下来的那几样。字段名与 `upload-modal.tsx` / 页脚里的同源变量一一对应 */
export interface AutoUploadGuards {
  enabled: boolean;
  /**
   * 「乐谱分段」总开关（`autoSegment`）。
   *
   * 它是**守卫**而不是无关的旁路状态：开着时，还有行没跑分段就不点火（理由见
   * `autoUploadBatch` 里那一段）。关着时那几行不再「等」任何东西，该传就传。
   */
  segmentEnabled: boolean;
  phase: UploadPhase;
  hasAnalyzingFiles: boolean;
  segBusy: boolean;
  refiningCount: number;
}

/**
 * 批次闸门：这一批现在该不该自动点火。
 *
 * 四条守卫与页脚「确认上传」按钮的 `disabled` 表达式同源，但它们**必须各写一遍**：
 * 页脚管的是「按钮灰不灰」（灰着的按钮还能被人点，人点了就是明确授权），
 * 这里管的是「能不能没人看着就开跑」。后者要求**每一条**都确定安静下来 —— 少一条
 * 就会在用户正在编段、正在拆分、正在重试的时候把行状态改掉（#304 的教训）。
 *
 * 顺序即含义：开关关着时**永远**返回 `switch-off`（不看其他任何东西），
 * 这是「开关关时零行为差异」在判据层的样子。
 */
export function autoUploadBatch(
  files: readonly UploadFile[],
  guards: AutoUploadGuards,
): AutoUploadBatch {
  if (!guards.enabled) return { fire: false, reason: "switch-off" };
  // 只有「确认」这一相才是「分析完了、人在看」的时刻。选文件相还没分析完；
  // 「分析中」行还在变；「上传中」已经有一次在飞 —— 三相同一条判据挡掉
  if (guards.phase !== "confirm") return { fire: false, reason: "not-confirmed" };
  if (guards.hasAnalyzingFiles) return { fire: false, reason: "analyzing" };
  // 分段在跑：它要写回 `splitOf` / 段行，此刻起跑就是 #304 那条「改行集长度与异步写回冲突」
  if (guards.segBusy) return { fire: false, reason: "segmenting" };
  // 段级识别飞行中：行上的乐器名还可能被识别结果改掉，此时传出去的是**半截判断**
  if (guards.refiningCount > 0) return { fire: false, reason: "refining" };

  /**
   * **分段开着、却还有行没跑分段时不点火。**
   *
   * 这一条不是「等它安静」（分段根本没在跑），而是**替用户做主的边界**：
   * 分段**不自动跑**（一份 N 页的合订谱要烧 N 次 OCR，用户得先看到那个数才点火），
   * 于是「分析刚收尾」这一刻，一份等着被拆的合订谱在判据眼里是**就绪**的 ——
   * 起跑就会把它整份传上去，而它一转 `done`，`segEligible` 立刻为假、
   * 「识别分段」按钮连出现的机会都没有了。用户打开分段开关的意图被静默作废。
   *
   * 所以这一条**必须整批判**，不能只判行：本阶段不做行级过滤（见 issue 契约），
   * 混批里那一行照样会被 `confirmUpload` 带上。等用户跑完分段（或把分段总开关关掉）
   * 这道闸自己就开了 —— 后者是「我不打算分段」的明确表态。
   */
  if (guards.segmentEnabled && files.some(segAwaiting)) {
    return { fire: false, reason: "segment-pending" };
  }

  // 一行就绪都没有就别点：起跑了也只是把每行重新写一遍红字
  if (!files.some((f) => autoUploadVerdict(f, guards.enabled).upload)) {
    return { fire: false, reason: "nothing-ready" };
  }
  return { fire: true };
}
