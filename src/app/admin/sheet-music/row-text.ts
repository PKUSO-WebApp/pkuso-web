/**
 * 上传弹窗的**行级判据与文案**（拆 god file 第 2 步：从 `upload-modal.tsx` 搬出来）。
 *
 * 为什么值得单独一个模块：这些都是**纯函数**（输入 `UploadFile` 或几个标量，输出字符串 /
 * 布尔 / 取值），以前只能透过 DOM 测 —— 现在可以直接单测。搬的时候**一行逻辑都没改**，
 * 只是给它们 `export` 并补上原来在同文件里可见的依赖（常量、`unsafe-name` 等）。
 *
 * ⚠️ **注释跟着代码走**：下面每条注释里的「为什么」都是评审逼出来的（哪条判据会静默丢数据、
 * 哪处曾经各抄一份推导式），别在下次搬家时顺手删。
 */

import {
  FULL_SCORE_SECTION,
  INSTRUMENT_ORDER,
  OTHER_INSTRUMENT_GROUP,
} from "@/constants/instruments";
import { type FileTarget, normalizeExtraSections } from "./sections";
import { formatSubParts, parseSubPartsInput } from "./sub-parts";
import type { CropDecision } from "./staff-line";
import type { UploadFile } from "./upload-modal.types";
import { findUnsafeInName, unsafeNameMessage } from "./unsafe-name";

/**
 * 零宽字符与控制字符。`.trim()` 不管它们 —— `"\u200b".trim() === "\u200b"` 是 JS 规范行为。
 *
 * ⚠️ 与 `unsafe-name.ts` 的 `INVISIBLE_IN_NAME` **不是一回事**（名字像、用途不同）：
 * 这一份只回答「名字**是不是空的**」，所以只剥真正的零宽/控制字符；
 * 那一份回答「命中的字符**是不是看不见**」（好在文案里报码位），所以还收
 * `Cs`/`Zs`/`Zl`/`Zp` 与 `\p{Default_Ignorable_Code_Point}`。
 * 一个只填了韩文填充符（U+3164）的名字不在这里算空 —— 它由那条判据拦下，
 * 并给用户一句说得清的话（「有看不见的字符（U+3164），请手工重新输入」）。
 */
const INVISIBLE = /[\p{Cf}\p{Cc}]/gu;

/** 名字是不是「空的」：只有空白、或只有不可见字符，都算空。 */
function isBlankName(s: string): boolean {
  return s.replace(INVISIBLE, "").trim() === "";
}

/**
 * 后端返回的 `section` 是否落在项目标准的 16 声部内。
 *
 * **只校验，不映射** —— 后端 prompt 的词表与 `INSTRUMENT_ORDER` 是两份手抄副本，
 * 这里是把「词表漂移」变成界面上的可见告警，而不是再引入一张跨仓同步的映射表。
 * 「其他」是契约里的合法弃权声部，不算漂移。
 *
 * ⚠️ **「总谱」同样要认**：它不是声部（见 `instruments.ts` 的说明），但可以是
 * `sheet_music_parts.section` 的合法值。漏掉它会让用户选了总谱之后被标成
 * 「非标准」——而它是「总谱不参与切分检测」那条唯一的人工标记入口。
 */
export function isKnownSection(section: string): boolean {
  return (
    section === OTHER_INSTRUMENT_GROUP ||
    section === FULL_SCORE_SECTION ||
    (INSTRUMENT_ORDER as readonly string[]).includes(section)
  );
}

/**
 * 落库失败时给用户一句**能照着做**的话。
 *
 * ⚠️ 唯一冲突（`23505`）**不再是「意外」**：`sheet_music_files` 上有
 * `unique (part_id, file_name)`（pkuso-backend#29 加的），而 `file_name` 是由
 * 乐器名 + 分声部号生成的 —— **同一个声部下两份谱生成同一个名字**时就会撞。
 * 那种情况下把 PG 的原文（`duplicate key value violates unique constraint …`）
 * 甩给用户毫无用处：他既看不懂，也不知道该改哪一格。
 *
 * `21000` 是同一个约束的另一副面孔：一条 `INSERT … ON CONFLICT DO UPDATE` 里
 * 出现两个相同的键时 PG 会报 `cannot affect row a second time`。那要在**同一份谱的
 * 落点内部**撞名才可能出现（`fileTargetsOf` 按声部产出，正常不会有重复），
 * 一并给同一句话，总好过让用户看 PG 原文。
 */
export function describeInsertError(
  err: { code?: string; message: string },
  targets: FileTarget[],
): string {
  if (err.code === "23505" || err.code === "21000") {
    const names = [...new Set(targets.map((t) => t.fileName))].join("、");
    return `这一声部下已经有同名文件（${names}）—— 请改乐器名或分声部号，或先删掉详情页里那份`;
  }
  return err.message;
}

/** 行内文案：识别出了什么 / 需人工确认（未识别时输入框留空、不预填） */
export function analysisSummary(section: string, instrument: string, subParts: number[]): string {
  if (!instrument) return "需人工确认（未识别出乐器）";
  const sub = subParts.length > 0 ? ` ${formatSubParts(subParts)}` : "";
  return `识别结果: ${section} / ${instrument}${sub}`;
}

/**
 * 一行这次要落库的值（Edit 优先，用户清空后**不回退**到 Guess）。
 *
 * 判断「用户编辑过没有」用 `!== undefined`：空串是**用户主动清空**（合法值，
 * 表示这一行没有分声部），不能与「没编辑过」混为一谈 —— 用真值判断会把清空
 * 当成没填，然后把 subPartsGuess 捡回来，用户就会看到「清不掉」。
 */
export function editsOf(f: UploadFile): {
  section: string;
  extraSections: string[];
  instrument: string;
  subParts: number[];
  subPartsInvalid?: string;
  subPartsUnread?: string;
  subPartsOverCap?: number;
} {
  const section = (f.sectionEdit ?? f.sectionGuess ?? "").trim();
  // 总谱**没有分声部可言**：它不是「第几号」，而是「整份都在里面」。所以 section 是总谱时
  // 一律把号当成空 —— 用户填什么、模型猜什么、模型没读懂什么，都不该在这里冒出拦截
  // （分声部输入框在这个状态下也是禁用的，见渲染处）。
  const isFullScore = section === FULL_SCORE_SECTION;
  const parsed = isFullScore
    ? { value: [] as number[] }
    : f.subPartsEditText !== undefined
      ? parseSubPartsInput(f.subPartsEditText)
      : { value: f.subPartsGuess ?? [] };
  return {
    section,
    // 清洗、保序、去主声部，只此一份 —— 文件名、落库行数、界面上的 chip 都读它
    extraSections: normalizeExtraSections(
      section,
      f.extraSectionsEdit ?? f.extraSectionsGuess ?? [],
    ),
    instrument: (f.instrumentEdit ?? f.instrumentGuess ?? "").trim(),
    subParts: parsed.value,
    subPartsInvalid: isFullScore ? undefined : parsed.invalid,
    // 「模型给了号、后端没读懂、用户还没表态」—— 见 uploadBlocker 里为什么必须拦。
    // ⚠️ 条件里的 `guess 为空` 不能省：小提琴那类声部会在模型给不出号时用声部推导
    // 补出 [1]/[2]（**同时**带着 subPartsRaw），那种行**有号**，拦下就是误伤。
    subPartsUnread:
      !isFullScore &&
      f.subPartsEditText === undefined &&
      (f.subPartsGuess ?? []).length === 0 &&
      f.subPartsRaw
        ? f.subPartsRaw
        : undefined,
    subPartsOverCap: isFullScore ? undefined : f.subPartsOverCap,
  };
}

/**
 * 这一行现在是不是总谱。取值**只走 editsOf**（与落库、文件名、拦截、分段资格同一条判据）。
 *
 * ⚠️ **必须放在模块作用域**，不能放进组件体：`segEligible`（组件体里更早的位置）要调它，
 * 而 `segTargets` 是渲染期立即求值的语句 —— 声明在使用点**之后**的 `const` 会在那一刻
 * 撞上 TDZ，`ReferenceError: Cannot access 'isFullScoreRow' before initialization`，
 * **选完文件整个弹窗就崩**。这种错 `tsc` 报不出来（嵌套闭包里的调用序它不判）、
 * 纯模块测试也测不到（这个组件在仓库里没有渲染测试）。
 */
export function isFullScoreRow(f: UploadFile): boolean {
  // 走 editsOf 而不是抄一遍 `(sectionEdit ?? sectionGuess).trim()`：同文件里已经栽过
  // 一次「三处各抄一份推导式」的跟头，总谱这条判据只能有一份。
  return editsOf(f).section === FULL_SCORE_SECTION;
}

/**
 * 这一行能不能有**额外声部**（跨声部的共用分谱，见 `sections.ts`）。
 *
 * ⚠️ 判据必须与 `normalizeExtraSections` **同源**：那个函数在总谱与「其他」时都返回 `[]`。
 * 分叉的后果很具体 —— 界面让用户加、加完被清洗悄悄丢掉（chip 不出现），
 * 而用户是照着界面上的东西核对的。渲染处据此决定是给「+ 声部」还是给一句解释。
 */
export function canHaveExtraSections(f: UploadFile): boolean {
  const section = editsOf(f).section;
  return section !== FULL_SCORE_SECTION && section !== OTHER_INSTRUMENT_GROUP;
}

/**
 * 「模型给了号但没读懂」的**统一文案**。
 *
 * ⚠️ 必须只有一份：`uploadBlocker` 用它做**拦截原因**，`subPartsNotice` 用它做**行内提示**
 * —— 两处各写一句、措辞稍有不同的后果，是去重守卫（`f.error === 提示文案`）永远匹配不上，
 * 于是用户点一次上传会看到**同一件事的黄红两行**（审查实测过）。
 *
 * 按钮名写「没有号」而不是「本谱没有分声部」：用户要在屏幕上**照着找那个按钮**，
 * 文案必须与按钮上的字一致（按钮的 title 才是解释性文字）。
 */
export const unreadMessage = (raw: string) =>
  `识别到分声部号但没读懂（模型给的是「${raw}」）：请填上号，或点「没有号」`;

/**
 * 这一行为什么不能上传；空串 = 可以传。
 *
 * **判据只此一份。**（早先声部是「先串行预建」，那时这段话写的是「预建段与上传 worker
 * 两处必须共用同一条判据」；声部改成按需建之后预建段没了，但规矩不变 —— 任何地方要判
 * 「这一行能不能上传」，都调它，别就地再写一套。）
 */
export function uploadBlocker({
  section,
  instrument,
  subPartsInvalid,
  subPartsUnread,
}: {
  section: string;
  instrument: string;
  subPartsInvalid?: string;
  subPartsUnread?: string;
}): string {
  // editsOf 用 `??` 而不是 `||` 取值，用户主动清空输入框时这里拿到的就是空串 ——
  // 空乐器名必须**拦下**（后端的「未识别」正是空串），否则会建出一个没有名字的声部/文件。
  // 空判据还必须**连不可见字符一起算空**：`"\u200b".trim()` 还是它自己，
  // 放过去会建出一个肉眼看着是空、实际叫 "\u200b" 的声部与文件。
  if (isBlankName(instrument)) return "未识别的乐器名，请先填写再上传";
  if (isBlankName(section)) return "未指定声部，请先填写再上传";
  // 后端只管得住它自己返回的值，用户手输的这一层得前端自己把关。
  // 判据（与后端逐字同一份）在 `unsafe-name.ts`；两个字段分开报，用户才知道该改哪一格。
  const badInstrument = findUnsafeInName(instrument);
  if (badInstrument) return unsafeNameMessage("乐器名", badInstrument);
  const badSection = findUnsafeInName(section);
  if (badSection) return unsafeNameMessage("声部名", badSection);
  // 分声部号非法就**别传**：文件名是前端生成的，非法输入会被原样写进文件名与库
  if (subPartsInvalid) return subPartsInvalid;
  // **模型给了号却谁都没读懂，就必须拦住。**
  //
  // 只给一句黄色提示是不够的：默认动作（直接点「确认上传」）仍然会落一个没有号的
  // 文件名与 `sub_parts = {}`，而且行一旦变成 done，那句提示就消失了 —— 界面事后
  // 只剩「已上传 → 圆号 / 圆号」，看不出丢过东西。把「静默」降级成「提示」并没有
  // 解决这条路径，它仍然是本 issue 要消灭的那种丢号。
  //
  // ⚠️ **但不能裸拦**：此时「确实没有分声部」只能靠清空输入框表达，而用户根本没动过
  // 那个框（`subPartsEditText === undefined`），裸拦会把人锁死在无法通过的状态里。
  // 所以界面上配了一个显式的「本谱没有分声部」按钮（把 EditText 置成空串，即用户表态）。
  if (subPartsUnread) {
    return unreadMessage(subPartsUnread);
  }
  return "";
}

/**
 * 把裁切决策翻译成界面文案。
 * 必须同时看 `cropped`（**实际**有没有裁出来）—— 拿不到 2D 上下文时会退回整页，
 * 只翻译「决策」会让界面说反话，而这段文案正是用来排查「切错位置」的。
 */
export function cropNoteOf(crop: CropDecision, cropped: boolean): string {
  if (crop.crop && cropped)
    return `已裁至标题区（谱线在页高 ${(crop.staffPct * 100).toFixed(1)}%）`;
  if (crop.crop) return "未裁切（裁切画布创建失败，已改用整页）";
  switch (crop.reason) {
    case "no-staff":
      return "未裁切（未检测到谱线）";
    case "too-tall":
      return `未裁切（标题区达页高 ${(crop.staffPct * 100).toFixed(1)}%，超过 33% 上限）`;
    case "too-thin":
      return `未裁切（标题区仅 ${crop.height}px，首页直接进音乐）`;
  }
}
