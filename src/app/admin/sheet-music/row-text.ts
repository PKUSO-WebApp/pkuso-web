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

import { estimateOcrCalls, needsSegmentation, normalizeSegments } from "./segmentation";
import {
  FULL_SCORE_SECTION,
  INSTRUMENT_ORDER,
  OTHER_INSTRUMENT_GROUP,
} from "@/constants/instruments";
import { type FileTarget, fileTargetsOf, normalizeExtraSections } from "./sections";
import { formatSubParts, MAX_SUB_PARTS, parseSubPartsInput } from "./sub-parts";
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
export function isBlankName(s: string): boolean {
  return s.replace(INVISIBLE, "").trim() === "";
}

/**
 * 后端返回的 `section` 是否落在项目标准的声部表（`INSTRUMENT_ORDER`）内。
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
 * ⚠️ **必须放在模块作用域**，不能放进组件体：`segEligible`（在本模块，比它靠后）要调它，
 * 而 `upload-modal.tsx` 的 `segTargets` 是渲染期立即求值的语句 —— 这三者当年都在组件体里时，
 * 声明在使用点**之后**的 `const` 会在那一刻撞上 TDZ，
 * `ReferenceError: Cannot access 'isFullScoreRow' before initialization`，
 * **选完文件整个弹窗就崩**。这种错 `tsc` 报不出来（嵌套闭包里的调用序它不判）、
 * 纯模块测试也测不到 —— 补它的是渲染冒烟测试（`upload-modal.test.tsx` 的头一段就写着这件事）。
 */
export function isFullScoreRow(f: UploadFile): boolean {
  // 走 editsOf 而不是抄一遍 `(sectionEdit ?? sectionGuess).trim()`：「三处各抄一份推导式」
  // 的跟头已经栽过一次，总谱这条判据只能有一份。
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

/* ------------------------------------------------------------------ *
 * 行卡片的状态行 / 提示文案 / 预览路径（2026-09-26 从 upload-modal.tsx 搬来）
 *
 * 这一批都是 `(f: UploadFile) => …` 的**纯函数**（没有一个闭包组件状态 ——
 * `canUnsplit` / `unsplitGroup` / `duplicatedInGroup` 因为读 `files` 而留在原处）。
 * 搬出来是为了让行卡片能抽成组件：它们原本要占 15 个 prop，现在两边都直接 import。
 * ------------------------------------------------------------------ */

// ⚠️ 顺序上 `isUnidentified` 仍排在 `segEligible` 之前（后者读前者）。
// **模块作用域下这条约束已经不会咬人了**：两者都是本模块的 `const`，而消费它们的
// `segTargets` 在**另一个模块**里 —— ESM 保证本模块整体求值完才轮到那边（实测把两者对调，
// `tsc` 与全部用例都过）。留着它是因为它记录了一次真实的 TDZ 事故（见 `isFullScoreRow`
// 的 docblock）：别读成「调换顺序 = 弹窗崩」。
/** 这一行「分析完了但没认出乐器」。它与「已识别」是**两件事**：要提示、要能重试、
 * 且**不该进分段**（见下）。总谱的 instrument 是「总谱」，不会落进来。 */
export const isUnidentified = (f: UploadFile) => f.status === "analyzed" && !editsOf(f).instrument;

/**
 * 这份文件要不要跑分段：**多页、非总谱**。
 *
 * 总谱的排除是用户定的（省掉最大的一笔 OCR）；而「总谱认不出来」这件事有实测支撑
 * （三个本地判据都被否掉，见 #290 的评论），所以只能靠 `section === 总谱` 人工标记兜底。
 * 页数未知（分析失败）时不跑 —— 连成本都算不出来。
 */
export const segEligible = (f: UploadFile) =>
  f.status !== "error" &&
  // **已上传成功的不算**（`status === "done"`）：分段的结果只写进组件 state，
  // 而 `done` 的行**不再渲染编辑器块**（那道门是 `analyzed || error`）—— 于是
  // 份数与真实调用都会白烧：实测 2 份文件、第 1 份已上传、第 2 份被 uploadBlocker
  // 拦下时，按钮按 2 份计费，点下去真的烧掉两份的配额，而第 1 份的段一个都看不到。
  f.status !== "done" &&
  // **已经切出来的段不算**：它们是产物不是源，对一段再跑分段没有意义
  !f.splitOf &&
  // **未识别的行不跑**（2026-09-25 加）：分段是**按页**烧 OCR 的动作，而这一行
  // 「是什么」都还没定 —— 跑完也归不了声部。反过来说，未识别在这条链路里不是
  // 「安全」而是**最贵**的那条路（这正是用户定「尽量减少弃权」的根据之一）。
  // ⚠️ 界面**不能因此把页数藏起来**：页数是「这份文件读到几页」的事实，与要不要
  // 分段无关 —— 有一条集成用例专门钉它不许消失（见 `upload-modal-walk.test.tsx`）。
  !isUnidentified(f) &&
  // 「是不是总谱」只认一个判据（`isFullScoreRow` 走 editsOf）—— 同文件里已经栽过
  // 一次「三处各抄一份推导式」的跟头，不再抄第二份
  needsSegmentation(f.pageCount ?? null, isFullScoreRow(f));

/**
 * 这一份文件还要烧几次 OCR（下界，见 `estimateOcrCalls` 的说明）。
 *
 * 按**缺的页**算：已经在手里的页不重烧（`pageTexts` 只装成功的页，所以失败重试时
 * 这个数正好等于要补的页数）。**按钮文案与「识别中…」那行共用这一个函数** ——
 * 各算一次的话，两个数会在同屏里互相矛盾（一个按整份页数、一个按缺的页数）。
 */
export const costOf = (f: UploadFile) =>
  estimateOcrCalls(f.pageCount ?? 0, f.pageTexts?.length ?? 0);

/** 界面上显示的段（由起点页推出闭区间）。用户改过起点就按改过的算 */
export const segmentsOf = (f: UploadFile) =>
  normalizeSegments(f.segmentStarts ?? [1], f.pageCount ?? 1);

/**
 * **识别出多段、却还没拆** —— 界面上「确认这 N 段」按钮的显示条件，也是上传时
 * 拦下这一行的条件。**必须是同一个函数**：分成两份写的时候，上传那侧漏掉 `segEligible`
 * 就会造出一个死胡同 —— 跑完分段后把声部改成总谱，分段块整块不渲染（`segEligible` 为假），
 * 而拦截还在，文案指着两个**屏幕上不存在**的按钮。实测过这条路径。
 */
export const unsplitSegments = (f: UploadFile) =>
  segEligible(f) && segmentsOf(f).length > 1 && !f.splitOf;

/** 段的起点数组（界面上编辑的那个），带兜底 */
export const startsOf = (f: UploadFile) => f.segmentStarts ?? [1];

/** 输入框原文数组。老状态没有这个字段时按起点回填，保证与 `segmentStarts` 等长 */
export const startTextOf = (f: UploadFile) => f.segmentStartText ?? startsOf(f).map(String);

/**
 * 预览「这将存成什么名字」。乐器名为空时返回空串。
 *
 * 预览的是**人类可读的名字**（`声部 / 文件名`）而不是真实的存储键 ——
 * 存储键现在是 `{scoreId}/{行 id}.pdf`，给用户看一串 uuid 没有意义；
 * 可读名落 `sheet_music_files.file_name`，下载时会用它还原文件名。
 */
export const previewPath = (f: UploadFile) => {
  // 取值**只走 editsOf**（与落库、与 uploadBlocker 是同一条判据）。
  // 早先这里自己抄了一份推导式，于是非法输入时预览会显示成一个**看着完全正常**的
  // `圆号.pdf`（非法时 parse 的 value 恒为 `[]`）—— 而那一行其实传不上去。
  const { section, extraSections, instrument, subParts, subPartsInvalid, subPartsUnread } =
    editsOf(f);
  if (!instrument) return "";
  // 有硬伤时不报一个像样的名字：宁可显示「待确认」，也别让用户以为存的就是它
  if (subPartsInvalid || subPartsUnread) return `${section} / （分声部号待确认）`;
  // **跨声部时要把落点全列出来** —— 只显示主声部的话，用户看到的落库结果与预览对不上，
  // 而这份文件确实会在两个声部组里各出现一次。逐条复用 `fileTargetsOf`（同一个判据），
  // 不在这里另写一套推导式 —— 三处各抄一份的跟头这个文件已经栽过一次。
  return fileTargetsOf(section, extraSections, instrument, subParts)
    .map((t) => `${t.section} / ${t.fileName}`)
    .join("、");
};

export const statusText = (f: UploadFile) => {
  // 取值**只走 editsOf**：行文案必须与文件名预览、落库结果一致，否则用户会以为
  // 「清空没生效」。三处各抄一份推导式就迟早会漂（这个文件里已经栽过一次）。
  const { section, extraSections, instrument, subParts } = editsOf(f);
  const sub = subParts.length > 0 ? ` ${formatSubParts(subParts)}` : "";
  // ⚠️ **跨声部时要把落点写出来**：`previewPath` 已经展开成两个落点，标题只报主声部的话，
  // 同一张卡片里两句话互相矛盾（用户按标题核对会以为只落一个声部）。这条正是上面那句
  // 「必须与预览一致」要守的东西 —— 改成多落点之后漏掉了它，对抗测试实测抓出来的。
  const also = extraSections.length > 0 ? `（并另存到 ${extraSections.join("、")}）` : "";
  switch (f.status) {
    case "pending":
      return "待分析";
    case "analyzing":
      return "分析中...";
    case "analyzed":
      // 空乐器名 = **模型自己说不知道**（或响应不可用），必须与「已识别」区分开：
      // 输入框是空的、等用户填，不能显示成识别成功。
      // ⚠️ 「证据不足」不再进这一支（后端已改成照样采用 + `evidenceFound` 提示）。
      return instrument ? `已识别 → ${section} / ${instrument}${sub}${also}` : "需人工确认";
    case "uploading":
      return "上传中...";
    case "done":
      return instrument ? `已上传 → ${section} / ${instrument}${sub}${also}` : "已上传";
    case "error":
      return `失败: ${f.error}`;
  }
};

/**
 * 声部词表漂移告警。后端 prompt 里的 16 个声部名与前端 `INSTRUMENT_ORDER`
 * 是两份手抄副本，没有跨仓同步机制 —— 这条告警就是那个机制缺席时的可见信号。
 *
 * ⚠️ **两个来源都要判**（pkuso-web#302）：只看字段里的值（`sectionEdit ?? sectionGuess`）
 * 时，模型返回词表外声部的那条路**完全不可见** —— 后端已经把它折成了合法的「其他」，
 * 于是「漂移」与「模型真的判不出来」在界面上长得一模一样。原值在 `sectionRaw` 里。
 */
export const sectionWarning = (f: UploadFile) => {
  const s = (f.sectionEdit ?? f.sectionGuess ?? "").trim();
  if (s && !isKnownSection(s)) return `声部「${s}」不在标准列表内`;
  // 只陈述模型给过什么，**不**说「已记为其他」：用户可能已经改成别的声部了，
  // 那句话在那时会变成假话（而这一行是排查用的，宁可少说）
  // ⚠️ 用**过去式**（对抗测试实测的取舍）：用户把声部改对之后这句仍然挂着 —— 它陈述的是
  // 模型**当时**给过什么（漂移要维护者去改 prompt 词表），不随用户的修改消失。
  // 说成「现在的声部不在列表内」会让用户以为自己的修改没生效。
  if (f.sectionRaw) return `模型曾给出声部「${f.sectionRaw}」（不在标准列表内）`;
  return "";
};

/**
 * 分声部这一格要不要给用户一句话。三种情形都返回文案（空串 = 不用提示）：
 *
 * 1. **输入非法** —— 优先显示，因为它是用户当下能改的；
 * 2. **模型给了号但没读懂**（`subPartsRaw`）—— 这一行看起来是「已识别成功」，
 *    但号是空的，不提示就没人会去填，号就静默丢了；
 * 3. 都不适用 → 空串。
 *
 * ⚠️ 第 2 条只在**用户还没动手**时提示（`subPartsEditText === undefined`）——
 * 否则用户填完之后那句「没读懂」会一直挂着，变成一条永远消不掉的假告警。
 */
export const subPartsNotice = (f: UploadFile) => {
  if (f.subPartsEditText !== undefined) {
    const invalid = parseSubPartsInput(f.subPartsEditText).invalid;
    // ⚠️ 与 uploadBlocker 返回的是同一句话时**让位** —— 否则点一次「确认上传」
    // 会在行里出现两行一模一样的提示（一行黄、一行红），看着像两个不同的问题。
    if (!invalid || f.error === invalid) return "";
    return invalid;
  }
  // 上界漂移：用户解决不了这件事，这句其实是给维护者看的
  if (f.subPartsOverCap) {
    return `后端返回了 ${f.subPartsOverCap} 个分声部号，超过前端上界 ${MAX_SUB_PARTS}，未填入 —— 请核对前后端上限是否一致`;
  }
  if (f.subPartsRaw && (f.subPartsGuess ?? []).length === 0) {
    // 让位判据必须与 uploadBlocker **同源**（同一个 `unreadMessage`）。
    // 早先两处各写一句、措辞差一个字（「模型给的是」vs「模型给的写法是」），
    // 于是这个守卫**结构上永远匹配不上**，用户照样看到黄红两行。
    const msg = unreadMessage(f.subPartsRaw);
    return f.error === msg ? "" : msg;
  }
  return "";
};

/**
 * 模型据以判断的那段原文 —— **让用户一眼复核**。
 *
 * ⚠️ 这不是装饰：后端删掉「证据弃权门」的**唯一**依据就是「交给前端提示用户核对」。
 * 不显示的话，那批改动的净效果就是「预填一个可能错的答案 + 显示成已识别」——
 * 比原来（不预填、逼用户填）**更差**。prompt 里也向模型承诺了「让用户一眼就能复核你」。
 *
 * 三种状态合成一句，因为它们对用户是同一件事（「这个结论凭什么」）：
 *   · 引文在原文里找到 → `依据：…`（muted）
 *   · 引文**没**找到   → `依据（未在原文中找到，请核对）：…`（warning）
 *   · 模型没给引文      → `依据：（模型没给引文，请核对）`（warning）
 *
 * ⚠️ **字段缺失（`undefined`）时不显示任何东西** —— 那是「这一行没有这个信号」，
 * 与「模型没给引文」（空串）是两件事，所以判的是 `undefined` 而不是 falsy
 * （口径见 `LlmAnalysis` 的 docblock「为什么这些字段都写成可选」：这里的 `undefined` 判断
 * **不是**兼容层）。
 */
export const evidenceLine = (f: UploadFile): string | null => {
  if (f.status !== "analyzed" && f.status !== "done") return null;
  if (f.evidence === undefined) return null;
  const ev = f.evidence.trim();
  if (!ev) return "依据：（模型没给引文，请核对）";
  // 引文只在**文件名**里 —— 那不是「没找到」，而是「依据不在页面上」（pkuso-web#300）：
  // 出版社把乐器名印在文件名里而页面是扫描件时，抄文件名是**正当**依据；
  // 但用户该去核对的地方不同（看文件名，不是看谱面），所以分开说。
  if (f.evidenceFromFileName) return `依据（来自文件名，不在页面上）：${ev}`;
  return f.evidenceFound === false ? `依据（未在原文中找到，请核对）：${ev}` : `依据：${ev}`;
};

/** `evidenceLine` 要不要按警示色显示（没找到 / 没给）。 */
export const evidenceWarn = (f: UploadFile) =>
  f.evidenceFound === false || !(f.evidence ?? "").trim();

export const statusColor = (f: UploadFile) => {
  // ⚠️ 未识别行**不能是绿的**：一行「需人工确认」配上 success 色，用户扫一眼会以为没事。
  if (isUnidentified(f)) return "text-warning";
  const { status } = f;
  switch (status) {
    case "pending":
      return "text-text-muted";
    case "analyzing":
      return "text-primary";
    case "analyzed":
      return "text-success";
    case "uploading":
      return "text-primary";
    case "done":
      return "text-success";
    case "error":
      return "text-danger";
  }
};

export const hasDetails = (f: UploadFile) =>
  f.ocrText || f.llmResult || f.preview || f.warning || f.cropNote;
