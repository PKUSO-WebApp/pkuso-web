/**
 * 「一份谱要落到哪几个声部」的纯逻辑，单独成模块的理由与 `sub-parts.ts` 相同：
 * 判据被**跨仓契约**（后端 `Analysis.extraSections`）与**用户手输**两侧夹着，
 * 必须能被测试直接 import（这个组件在本仓没有渲染测试，见 `isFullScoreRow` 的注释）。
 *
 * ## 它解决的是什么
 *
 * 有一类谱**一个分部、跨两个声部、又不能切**：贝多芬的 `Violoncello e Basso`
 * 是低音提琴与大提琴共用的那一份（低音提琴低八度跟大提琴走），**每一页页眉都是
 * 同一行** —— 没有任何页边界可找，所以「分段」那条路救不了它，而两个声部
 * **都得拿到整份**（硬切成两段的结果是两个声部各拿到一半的谱）。
 *
 * 表达方式是**两行**：同一份谱在 `sheet_music_files` 里落成两行，各有自己的 `part_id`
 * 与 `file_name`，于是两个声部的分组里都看得到它。
 * 本模块只回答「要落成哪几行、每行叫什么」—— **存储对象由调用方负责，而且必须是每行一个**：
 * 详情页删除时是**先删对象再删行**（`[id]/page.tsx` 的 `deleteFile` / `deletePart`），
 * 两行共用对象的话，删掉一行会把另一行还在用的 PDF 一起删掉（详情页看着完好、下载 404）。
 * 详见 `uploadOne` 里那段说明。
 *
 * ## 与 `subParts` 是两回事
 *
 * `subParts` 是**同一个声部**内的分声部号（`Horn_1,_2,_3,_4` → `[1,2,3,4]`，四个号
 * 都归圆号声部）；这里是**不同的声部**（大提琴 + 低音提琴）。一份谱可以两者都有，
 * 它们是正交的两个维度，别把「同一件乐器的多个号」写进这里。
 */

import {
  FULL_SCORE_SECTION,
  INSTRUMENT_ORDER,
  OTHER_INSTRUMENT_GROUP,
} from "@/constants/instruments";
import { generateFileName } from "./sub-parts";

/**
 * 后端 `Analysis.extraSections` 的**个数**上界。与后端那份保持一致 ——
 * `pkuso-backend/supabase/functions/llm-analyze/analyze.ts` 的 `MAX_EXTRA_SECTIONS`
 * （搜常量名，别写行号：行号会随改动漂走）。
 *
 * ⚠️ 与 `MAX_SUB_PARTS` 同样的处境：两份常量之间**没有任何机制能发现漂移**。
 * 后端调大而这里没跟上时，多出来的声部会被静默丢掉（用户看到的是「只落了一个声部」，
 * 而没有任何提示）；改任意一边时**两边一起看**。
 */
export const MAX_EXTRA_SECTIONS = 3;

/**
 * 声部名是不是一个**能拿来当落库分组**的声部。
 *
 * ⚠️ 这两句显式排除**今天是冗余的**：「总谱」与「其他」都不在 `INSTRUMENT_ORDER` 里
 * （见 `instruments.ts` —— 那张表是给成员分声部用的，两者都是谱务特有的特殊值），
 * 所以下面的 `.includes` 本来就会把它们挡掉。
 *
 * 留着是因为它们的排除是**语义要求**而不是巧合：总谱是「所有声部都在里面」、
 * 「其他」是弃权分组，两者都不该成为「额外落点」。写成显式的，是为了哪天有人
 * 往 `INSTRUMENT_ORDER` 里加东西时，这两条约束不会跟着一起消失。
 */
function isLandableSection(s: string): boolean {
  if (s === FULL_SCORE_SECTION || s === OTHER_INSTRUMENT_GROUP) return false;
  return (INSTRUMENT_ORDER as readonly string[]).includes(s);
}

/**
 * 清洗**额外声部**：只留闭集里认得的、去掉与主声部重复的、去重、保序、截到上界。
 *
 * 非法值**直接丢弃**，不因此拦截整行 —— 丢的只是一个多余的目的地，主声部照常成立，
 * 而界面上有「+ 声部」可以手工补，所以不存在静默丢信息。
 * （与后端 `parseExtraSections` 是同一套判据，那边的注释解释了为什么不给 Raw 信号。）
 *
 * 主声部是**总谱**或**「其他」**时恒返回 `[]`：总谱是「所有声部都在里面」，不是
 * 「一份谱落到某几个声部」；「其他」是「认不出主声部」，而「**除了**主声部还落到哪几个」
 * 的前提是主声部已经定了。两条判据与后端 `parseExtraSections` 逐条对应。
 */
export function normalizeExtraSections(primary: string, extra: unknown): string[] {
  // 总谱：是「所有声部都在里面」，不是「一份谱落到某几个声部」。
  if (primary.trim() === FULL_SCORE_SECTION) return [];
  // 「其他」：模型说「我认不出这是哪个声部」。而额外声部的语义是「**除了**主声部，
  // 还落到哪几个」—— 主声部都没定下来，「除了」就没有立足点；照落的话，一次不确定的
  // 判读会往**具体**声部里塞一份文件，而用户在「其他」与那个声部两处都会看到它。
  // **与后端 `parseExtraSections` 是同一条判据** —— 两边必须一致，否则界面上的 chip
  // 与真实落库结果会对不上（这一层正是「预览与落库同源」的一部分）。
  if (primary.trim() === OTHER_INSTRUMENT_GROUP) return [];
  // 标量写成数组、数组写成标量，JSON 里两种都会发生，都接 —— 与 parseSubParts 同一条规矩
  const list = Array.isArray(extra) ? extra : [extra];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const s = item.trim();
    if (!isLandableSection(s)) continue;
    if (s === primary.trim()) continue;
    if (out.includes(s)) continue;
    out.push(s);
    if (out.length >= MAX_EXTRA_SECTIONS) break;
  }
  // **保序，不排序**：声部名之间没有天然次序，而这个顺序**是有后果的** ——
  // 它决定建 part 与插文件行的先后（后端那边同样保序，见 Analysis.extraSections）。
  return out;
}

/** 一份谱落库时的一行：落到哪个声部、乐器名写什么、文件名是什么。 */
export interface FileTarget {
  section: string;
  /** 落进 `sheet_music_files.instrument`，也是文件名主干 */
  instrument: string;
  fileName: string;
}

/**
 * 这一行要落成**几条**文件记录。
 *
 * - 主声部那条用**用户可见的乐器名**（`editsOf().instrument`，界面上那一格，可编辑）；
 * - 额外声部那些用**声部名当乐器名** —— 16 个声部名本身就是标准乐器名
 *   （大提琴 / 低音提琴 / 中提琴 / 第一小提琴…），而模型只给了一份谱的**主**乐器名，
 *   没有第二件的信息可用。这是本实现的一处**已知取舍**：额外那条的文件名不可编辑。
 * - `subParts` **所有落点共用同一份**：它们是同一件物理分谱的不同落点，
 *   号描述的是那份谱，不是某个声部。（落点最多 = 1 个主声部 + `MAX_EXTRA_SECTIONS` 个额外声部。）
 *
 * ⚠️ 主声部为空时返回 `[]`。调用方（`uploadOne`）已经在前面过了 `uploadBlocker`，
 * 正常到不了这里；但**必须把「没有可落的行」当失败报出去**，不能悄悄传个空数组 ——
 * 那会变成「上传成功但库里什么都没有」，正是本仓反复记载的那类静默失败。
 */
export function fileTargetsOf(
  section: string,
  extra: unknown,
  instrument: string,
  subParts: number[],
): FileTarget[] {
  const primary = section.trim();
  if (!primary) return [];
  const primaryInstrument = instrument.trim();
  return [
    {
      section: primary,
      instrument: primaryInstrument,
      fileName: generateFileName(primaryInstrument, subParts),
    },
    ...normalizeExtraSections(primary, extra).map((s) => ({
      section: s,
      instrument: s,
      fileName: generateFileName(s, subParts),
    })),
  ];
}
