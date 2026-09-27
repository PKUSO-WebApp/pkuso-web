/**
 * 「库里的谱子怎么改」的**纯判据**：输入是用户在弹窗里敲的几个字符串，
 * 输出要么是「落库那一行的四个值」，要么是「一句能照着改的话」。
 *
 * 单独成模块的理由与 `sub-parts.ts` / `sections.ts` / `unsafe-name.ts` 相同：判据被
 * **跨仓契约**（`file_name` 由 `generateFileName` 生成、`sub_parts` 是 INTEGER[]）、
 * **用户手输**与**库里既有的历史值**三侧夹着，必须能被测试直接 import。
 *
 * ## 它**不**新写任何判据
 *
 * 三条判据全部复用上传侧那一份，这正是本模块存在的意义：
 *
 * - 空值 / 不可见字符 / 不能进文件名的字符 → `uploadBlocker`（`row-text.ts`），
 *   与「确认上传」是**同一个函数**。分开写两份的后果很具体：上传拦得住、库里改得进去，
 *   于是同一份谱换个入口就能造出一个肉眼看着是空、实际叫 `"​"` 的乐器名。
 * - 分声部号 → `parseSubPartsInput`（`sub-parts.ts`），连错误文案都是同一句
 *   （「不接受区间「1-4」，请逐个写出」）—— 用户在两个入口看到同一句话，才认得出是同一件事。
 * - 文件名 → `generateFileName`，与上传落库时**逐字同一个函数**。
 *
 * ## 与上传侧唯一的一处**刻意**差异
 *
 * 上传侧判「总谱」用的是 `editsOf`，它会**顺带**读模型给的 `subPartsRaw` / `subPartsOverCap`
 * 决定要不要给用户一句「模型给了号但没读懂」的提示。库里没有「模型给的原文」这个概念
 * （那三列根本不落库），所以这里只保留总谱的**语义**部分：`section === 总谱` ⇒ 号恒为空。
 * 乐器名**不**强制成「总谱」—— 上传侧也不强制（`handleSectionChange` 只是顺手预填，
 * 用户仍可改），两边保持同一个口子，免得「为什么这里改不了」变成一个新问题。
 */

import { FULL_SCORE_SECTION } from "@/constants/instruments";
import { isBlankName, uploadBlocker } from "./row-text";
import { generateFileName, parseSubPartsInput } from "./sub-parts";
import { findInvisibleOnly, unsafeNameMessage } from "./unsafe-name";

/** 弹窗里那三个输入框的原文。 */
export interface FileEditInput {
  /** 声部。来自下拉，落库前是闭集里的值（或库里既有的非标准值） */
  section: string;
  /** 乐器名。开集，用户手输 */
  instrument: string;
  /** 分声部号的**原文**（不是解析结果）—— 解析放在这里做，与上传侧同一条路 */
  subPartsText: string;
}

/** 落库要用的四个值。`part_id` 不在这里 —— 那要先算出目标声部，见 `library-save.ts`。 */
export interface FileEditPlan {
  section: string;
  instrument: string;
  subParts: number[];
  fileName: string;
}

export type PlanResult<T> = { ok: true; plan: T } | { ok: false; error: string };

/**
 * 校验并算出「这一份谱改成什么样」。
 *
 * 失败时返回的 `error` 是**给用户看的原话**（不是给维护者的诊断），因为它会被直接渲染在弹窗里
 * —— 与上传侧的拦截文案同源，用户会在两个入口读到同一句话。
 *
 * ⚠️ **顺序有讲究**：先做总谱归一化，再过 `uploadBlocker`。反过来的话，总谱行上那句
 * 「请填上号」会从 `parseSubPartsInput` 的空串分支漏出来 —— 用户看着一个禁用的、
 * 写着「总谱」的输入框被要求填号。
 */
export function planFileEdit(input: FileEditInput): PlanResult<FileEditPlan> {
  const section = input.section.trim();
  // 总谱**没有分声部可言**：它表达的是「整份都在里面」，不是「第几号」。
  // 与 `editsOf` 同一条判据（那边注释里写着为什么总谱一律当空）。
  const isFullScore = section === FULL_SCORE_SECTION;
  const instrument = input.instrument.trim();
  const parsed = isFullScore ? { value: [] as number[] } : parseSubPartsInput(input.subPartsText);

  // ⚠️ 判据**只此一份**：别在这里重写「空 / 不可见字符 / 非法字符」那几条 ——
  // 它们就是 `uploadBlocker`，而两份拷贝迟早会漂（本仓栽过，见 `row-text.ts` 顶部）。
  const error = uploadBlocker({
    section,
    instrument,
    subPartsInvalid: isFullScore ? undefined : parsed.invalid,
  });
  if (error) return { ok: false, error };

  return {
    ok: true,
    plan: {
      section,
      instrument,
      subParts: parsed.value,
      fileName: generateFileName(instrument, parsed.value),
    },
  };
}

/** 曲目信息表单的三个字段。 */
export interface ScoreEditInput {
  title: string;
  composer: string;
  notes: string;
}

export interface ScoreEditPlan {
  title: string;
  composer: string | null;
  notes: string | null;
}

/**
 * 校验并算出曲子要改成什么样。
 *
 * 三个字段的**空值语义**与「新增曲子」弹窗逐字一致（`admin/sheet-music/page.tsx` 的 `createScore`）：
 * 曲名必填，作曲家与备注「空串 ⇒ null」—— 不是空字符串。这一条有后果：
 * 列表页与详情页都用 `{score.composer && …}` 判要不要渲染那一行，存成 `""` 与存成 `null`
 * 在渲染上恰好等价，但**查询**（`.is("composer", null)` 之类）与将来导出时不等价。
 *
 * ⚠️ 这里**不判** `findUnsafeInName`：曲名不是文件名的一部分（存储键是
 * `{scoreId}/{storageId}.pdf`，`unsafe-name.ts` 顶部写明了它守的恰好是另外两处）。
 * 给它加一道文件名判据，用户会给曲子起一个「肖五 / 艾格蒙特」这样的合称而**改不动** —— 那是误伤。
 *
 * ⚠️ **但空值要判**，且必须用 `isBlankName` 而不是 `.trim()`：只填了零宽字符的曲名
 * 在界面上看着是空的、在库里是个非空字符串，而列表页会把它渲染成一张**没有标题的卡片**，
 * 事后没人能选中它、也没人知道该删哪一张。
 *
 * ⚠️ **两道空判据都要**，它们管的不是同一批字符：`isBlankName`（宽，剥 `Cf`/`Cc` + trim）
 * 管得住零宽空格与普通空白，但**管不住**韩文填充符（U+3164）那类类别为 `Lo` 的
 * 「看不见的字」—— 那正是契约第 2 条「只由看不见的字符组成」那一格。
 * 第二道走 `findInvisibleOnly`（`unsafe-name.ts`，与文件名那条判据共用 `INVISIBLE_IN_NAME`），
 * 文案也复用 `unsafeNameMessage`，于是它与上传侧报的是**同一句话**。
 * ⚠️ 它**只**拦「整串都看不见」：夹在正常文字里的零宽字符照收（曲名不进文件名、
 * 也没有唯一约束，按文件名那套去拦会让「肖五​」这种无害输入被拒）。
 */
export function planScoreEdit(input: ScoreEditInput): PlanResult<ScoreEditPlan> {
  const title = input.title.trim();
  if (isBlankName(title)) return { ok: false, error: "曲名不能为空" };
  const invisible = findInvisibleOnly(title);
  if (invisible) return { ok: false, error: unsafeNameMessage("曲名", invisible) };
  return {
    ok: true,
    plan: {
      title,
      composer: input.composer.trim() || null,
      notes: input.notes.trim() || null,
    },
  };
}
