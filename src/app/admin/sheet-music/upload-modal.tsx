"use client";

import { useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { supabase } from "@/lib/supabase";
import { runWithConcurrency } from "@/lib/concurrency";
import {
  FULL_SCORE_SECTION,
  INSTRUMENT_ORDER,
  OTHER_INSTRUMENT_GROUP,
} from "@/constants/instruments";
import type { PDFPageProxy } from "pdfjs-dist";
import {
  decideTitleCrop,
  findFirstStaffLine,
  rowLongestRun,
  type CropDecision,
} from "./staff-line";
import { needsSegmentation, normalizeSegments } from "./segmentation";
import {
  formatSubParts,
  generateFileName,
  MAX_SUB_PARTS,
  overSubPartsCap,
  parseSubPartsInput,
  sanitizeSubParts,
} from "./sub-parts";

/**
 * 乐器名现在是**开放集**：后端 llm-analyze 直接返回中文（`木琴` / `英国管` /
 * `低音单簧管`…），不再走「英文字典 → 中文」的映射。
 *
 * 原先那张 `INSTRUMENT_CN_MAP` 已删除 —— 它是开放集合的映射，每来一个新乐器就要
 * 加一行，而新乐器是无限的，注定追不上（它把 Bassoon 译成「巴松管」，与项目标准
 * 的「大管」冲突，就是这个割裂的产物）。
 */

/**
 * 存储键：`{scoreId}/{行 id}.pdf`。
 *
 * ⚠️ **不能用声部/乐器名做路径段** —— Supabase Storage 的键只允许
 * 字母数字与 `_ - . ' , ! * & $ @ = ; : + ? ( )` 和空白，**中日韩字符一律被
 * 拒为 `Invalid key`**（官方文档 *File names restrictions*）。中文名此前一直
 * 写在路径里，所以这个上传功能**从来没有成功过一次**（`sheet_music_files` 长期 0 行
 * 就是这个原因，不是"新功能还没用"）。
 *
 * 人类可读的名字改放 DB：`sheet_music_files.file_name` 与 `.instrument` 两列，
 * 下载时由客户端 `a.download = file_name` 还原文件名（`storage.download(path)`
 * 拿回 blob 后自己触发下载，**不走 `download` 选项**）。用行自己的 id 还顺带让
 * 「两个文件算出同一条路径互相覆盖」由**构造**消失（每个键唯一），不再需要批内查重。
 */
function pathOf(scoreId: string, storageId: string): string {
  return `${scoreId}/${storageId}.pdf`;
}

/** 零宽字符与控制字符。`.trim()` 不管它们 —— `"​".trim() === "​"` 是 JS 规范行为。 */
const INVISIBLE = /[\p{Cf}\p{Cc}]/gu;

/** 名字是不是「空的」：只有空白、或只有不可见字符，都算空。 */
function isBlankName(s: string): boolean {
  return s.replace(INVISIBLE, "").trim() === "";
}

/**
 * 会被当成**文件名 / DB 值**的字段里不允许出现的东西。
 *
 * ⚠️ 这条 guard 的**理由换过一次**：原写「会被当成路径段的字段」（`..` 构成路径穿越、
 * 控制字符造出「肉眼同名」的目录），那个前提**早已不成立** —— 存储键是
 * `{scoreId}/{行 id}.pdf`（见 `pathOf`），声部与乐器名都进不去。
 * 现在它守的是另外两处：`file_name`（用户下载时落到自己文件系统上的名字）
 * 与 `sheet_music_files` 的列值。后端为同一件事已经改过理由
 * （`pkuso-backend` 的 `analyze.ts`：`MAX_INSTRUMENT_CHARS` / `ILLEGAL_IN_INSTRUMENT`），
 * 前端这一份当时没跟上。
 *
 * **`/` 刻意不在此列** —— #12 明确允许「木琴/钟琴」这种合称。
 * （它现在只影响下载文件名里多一个斜杠，不再是「多一层目录」——那是上面那段
 * 已作废的存储路径前提。）
 */
const UNSAFE_IN_PATH = /\.\.|\p{Cc}|\p{Cf}/u;

/**
 * 后端返回的 `section` 是否落在项目标准的 16 声部内。
 *
 * **只校验，不映射** —— 后端 prompt 的词表与 `INSTRUMENT_ORDER` 是两份手抄副本，
 * 这里是把「词表漂移」变成界面上的可见告警，而不是再引入一张跨仓同步的映射表。
 * 「其他」是契约里的合法弃权声部，不算漂移。
 */
function isKnownSection(section: string): boolean {
  return (
    section === OTHER_INSTRUMENT_GROUP || (INSTRUMENT_ORDER as readonly string[]).includes(section)
  );
}

/** 行内文案：识别出了什么 / 需人工确认（未识别时输入框留空、不预填） */
function analysisSummary(section: string, instrument: string, subParts: number[]): string {
  if (!instrument) return "需人工确认（未识别出乐器）";
  const sub = subParts.length > 0 ? ` ${formatSubParts(subParts)}` : "";
  return `识别结果: ${section} / ${instrument}${sub}`;
}

interface UploadFile {
  file: File;
  originalName: string; // 原始文件名，展示用；上传文件名由 generateFileName 生成
  status: "pending" | "analyzing" | "analyzed" | "uploading" | "done" | "error";
  error?: string;
  /** 声部（闭集，写进 `sheet_music_parts.section`，详情页按它分组、也按它排序） */
  sectionGuess?: string;
  sectionEdit?: string;
  /** 中文乐器名（开集，写进 sheet_music_files.instrument，也是文件名主干的来源） */
  instrumentGuess?: string;
  instrumentEdit?: string;
  subPartsGuess?: number[];
  /**
   * 输入框里的**原文**（而不是解析后的数组）—— 存这个是因为受控输入不能存解析结果：
   * 用户敲 `1,` 的瞬间解析结果是 `[1]`，回填成 `"1"` 会把刚敲的逗号吃掉，
   * `1,2` 永远敲不出来。原文为 `undefined` = 没编辑过（用 Guess）。
   */
  subPartsEditText?: string;
  /**
   * 模型**给了**号但后端一个都没解析出来时，模型用的那个写法（`Analysis.subPartsRaw`）。
   *
   * ⚠️ 叫「写法」不是「原文」：后端 `describeRaw` 拿到的值已经过了 `JSON.parse`，
   * 超长整数会丢精度、非有限数只剩一个名字（后端注释里明说过「前端别拿它当原文用」）。
   * 它是**给用户看的线索**，不是模型的原话 —— 文案里也别承诺「原文」。
   *
   * 这一行**会被拦下**（见 `uploadBlocker` 的 `subPartsUnread`）：光提示不够，
   * 用户不填就点上传的话，号会连着文件名一起静默丢掉。
   */
  subPartsRaw?: string;
  /**
   * 后端返回的号**超过前端上界**的个数（`overSubPartsCap`）。仅用于给一句提示 ——
   * 这种情况今天不可达，它防的是两个仓库的 `MAX_SUB_PARTS` 漂移。
   */
  subPartsOverCap?: number;
  /**
   * 存储键里那一段 id。**每行生成一次、重试复用**，这样失败重传走 `upsert`
   * 覆盖同一个对象，不会留下一堆孤儿文件。
   */
  storageId?: string;
  /** 这一份 PDF 的总页数。分析时顺手记下 —— 成本估算与「要不要分段」都看它 */
  pageCount?: number;
  /**
   * 分段（#290 Step 1）。只有多页、且非总谱的文件才走这条路。
   *
   * `pageTexts` 与 `segmentStarts` 都要留着：用户改边界时**不重跑 OCR**
   *（验收标准点名的「改正后不重复 OCR」就是靠这两个字段）。
   */
  segState?: "running" | "done" | "error";
  segError?: string;
  pageTexts?: PageText[];
  /**
   * 各段的**起始页**（恒含第 1 页）。用户拖动边界 = 改这个数组。
   * `undefined` = 还没跑过分段；`[1]` = 明确不切（整份一段）。
   */
  segmentStarts?: number[];
  ocrText?: string;
  llmResult?: string;
  preview?: string; // 实际送去 OCR 的那张图的缩略图（排查用）
  sourcePage?: number; // 取的是第几页
  warning?: string; // 非致命问题（某页图像解码失败、OCR 失败等），不影响继续靠文件名识别
  cropNote?: string; // 裁切决策回显（裁到哪 / 为什么没裁），排查「切错位置」用
}

/**
 * 一行这次要落库的值（Edit 优先，用户清空后**不回退**到 Guess）。
 *
 * 判断「用户编辑过没有」用 `!== undefined`：空串是**用户主动清空**（合法值，
 * 表示这一行没有分声部），不能与「没编辑过」混为一谈 —— 用真值判断会把清空
 * 当成没填，然后把 subPartsGuess 捡回来，用户就会看到「清不掉」。
 */
function editsOf(f: UploadFile): {
  section: string;
  instrument: string;
  subParts: number[];
  subPartsInvalid?: string;
  subPartsUnread?: string;
  subPartsOverCap?: number;
} {
  const parsed =
    f.subPartsEditText !== undefined
      ? parseSubPartsInput(f.subPartsEditText)
      : { value: f.subPartsGuess ?? [] };
  return {
    section: (f.sectionEdit ?? f.sectionGuess ?? "").trim(),
    instrument: (f.instrumentEdit ?? f.instrumentGuess ?? "").trim(),
    subParts: parsed.value,
    subPartsInvalid: parsed.invalid,
    // 「模型给了号、后端没读懂、用户还没表态」—— 见 uploadBlocker 里为什么必须拦。
    // ⚠️ 条件里的 `guess 为空` 不能省：小提琴那类声部会在模型给不出号时用声部推导
    // 补出 [1]/[2]（**同时**带着 subPartsRaw），那种行**有号**，拦下就是误伤。
    subPartsUnread:
      f.subPartsEditText === undefined && (f.subPartsGuess ?? []).length === 0 && f.subPartsRaw
        ? f.subPartsRaw
        : undefined,
    subPartsOverCap: f.subPartsOverCap,
  };
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
const unreadMessage = (raw: string) =>
  `识别到分声部号但没读懂（模型给的是「${raw}」）：请填上号，或点「没有号」`;

/**
 * 这一行为什么不能上传；空串 = 可以传。
 *
 * **判据只此一份。**（早先声部是「先串行预建」，那时这段话写的是「预建段与上传 worker
 * 两处必须共用同一条判据」；声部改成按需建之后预建段没了，但规矩不变 —— 任何地方要判
 * 「这一行能不能上传」，都调它，别就地再写一套。）
 */
function uploadBlocker({
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
  // 空判据还必须**连不可见字符一起算空**：`"​".trim()` 还是它自己，
  // 放过去会建出一个肉眼看着是空、实际叫 "​" 的声部与文件。
  if (isBlankName(instrument)) return "未识别的乐器名，请先填写再上传";
  if (isBlankName(section)) return "未指定声部，请先填写再上传";
  // 后端只管得住它自己返回的值，用户手输的这一层得前端自己把关
  if (UNSAFE_IN_PATH.test(instrument) || UNSAFE_IN_PATH.test(section))
    return "声部或乐器名里不能有「..」或控制字符";
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

interface UploadModalProps {
  open: boolean;
  onClose: () => void;
  scoreId: string;
  onUploaded: () => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// —— pdf.js 装载 ——
//
// v6 已移除 disableWorker，且 PDFWorker 的初始化逻辑是「只要 globalThis.pdfjsWorker
// 上有 WorkerMessageHandler 就直接走 fake worker 路径」，既不读 GlobalWorkerOptions.workerSrc
// 也不 new Worker()。所以这里用一次普通的 ESM import 把 worker 模块挂到全局即可：
// 不需要往 public/ 放 worker 文件、不需要 bundler 处理 worker URL、也不可能出现主库与
// worker 版本不匹配（之前那几种失败模式都出在这里）。
//
// 代价：解析在主线程进行（pdf.js 按 chunk 让出事件循环），批量分析时页面会卡顿。
// 若将来卡顿不可接受，改用真实 worker：把 node_modules/pdfjs-dist/build/pdf.worker.min.mjs
// 拷到 public/，然后 GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"，
// 并把下面的 globalThis 赋值删掉（升级 pdfjs-dist 时必须同步重新拷该文件）。
let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

function loadPdfJs(): Promise<typeof import("pdfjs-dist")> {
  // 懒加载：pdf.js 主库 + worker 各约 1MB，只在真正开始分析时才下载
  pdfjsPromise ??= (async () => {
    const [lib, worker] = await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs"),
    ]);
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
    return lib;
  })();
  return pdfjsPromise;
}

// 首页栅格化参数：约 216 DPI，再往上 OCR 收益很小、体积翻倍（OCR.space 免费档单文件 1MB）
const OCR_MAX_SCALE = 3;
const OCR_TARGET_LONGEST_SIDE = 2400;
const OCR_JPEG_QUALITY = 0.8;

// OCR 文本去空白后少于这么多字符就当成「没读到」，触发回退整页。
// OCR 偶尔会返回单个字符或纯标点，严格判空会漏掉这种情况。
const MIN_OCR_CHARS = 5;

// 单次调用的超时（毫秒）。OCR 链路三段（前端 → 边缘函数 → OCR.space）都没有超时，
// 客户端不给上限的话，任何一段挂住都会让 await 永不 settle：重试逻辑没机会触发、
// UI 一直转圈且不报错。（这个缺陷最初由一次探针脚本挂死 4 分 43 秒暴露。）
// 取 20s 而非更长：超时是可重试的，单张图最坏 = 20s×3 次 + 退避 4.7s ≈ 65s。
// 实测正常 OCR 只要 2~4s，20s 已是 5~10 倍余量；给到 45s 会让 20 个文件的最坏
// 耗时逼近 45 分钟，而弹窗目前没有取消入口。
const OCR_TIMEOUT_MS = 20000;
// 取 45s 是为了**盖住后端的重试预算**：后端最坏 = 4 次尝试 × 8s 单次上限 + 退避
// 7s（1+2+4）= 39s。前端若比它短，最后一次尝试的结果就没人读 —— 用户看到的是笼统的
// 「LLM 请求失败（AbortError）」，而不是后端算出来的准确原因（「上游请求失败（…）」
// 或「上游响应无法解析（HTTP 500）」）。45s 给 6s 余量。
// 正常一次 LLM 调用只要 2~5s，这只在上游持续故障时才走到；最坏单文件
// ≈ OCR 65s + LLM 45s，批量耗时因此变长，但分析途中关掉弹窗即可中止（cancelledRef，
// 最坏再多做已在飞的那 PIPELINE_CONCURRENCY 个）。
const LLM_TIMEOUT_MS = 45000;

/**
 * 同时最多有几个文件在飞（分析、上传两段共用）。
 *
 * 批量耗时几乎全在网络等待（OCR 2~4s、LLM 2~5s、上传几 MB 的 PDF），串行时主线程基本闲着；
 * 并发把这些等待叠起来。**CPU 部分不会因此变快** —— 渲染与 JPEG 编码仍在主线程排队
 * （pdf.js 走 fake worker，见 loadPdfJs），并发只是让某个文件的网络往返不再挡着别的文件。
 * 实测（**仓库外**的 `.render-harness/`，与 pkuso-web 同级；33 份真实分谱 + 模拟 6.5s/份网络）：
 * 271s → 108s。
 *
 * 取 3 而不是更大，是因为再往上收益迅速变小：CPU 部分实测约 1.7s/份，3 路时已被网络那侧
 * 盖住；OCR.space 免费档也没必要主动去撞突发限流（后端有 429 重试兜底，但那是兜底）。
 *
 * ⚠️ **内存不是这里的约束，而且别按「份数 × 单份内存」估** —— 早先这版注释就是那么写的，
 * 基数低了约 14 倍。真 Chrome 里逐次记录 canvas 后备存储实测：
 *   - 单份 canvas 峰值可达 **~282MB**（46 份语料里 28 份如此）。其中约 265MB 是 **pdf.js
 *     自己解码那张 1500 DPI 扫描图时开的内部画布**（6467×8609 + 3234×4305），页面自己的
 *     canvas 只有 16MB —— 真正的大头在 pdf.js 里，不在这一层；
 *   - 另有 ~900MB 的 JS 堆瞬时高水位（强制 GC 后回落，不是泄漏）；
 *   - 但 **3 份并发只把它放大 1.02~1.14 倍，不是 3 倍**：那段解码是纯主线程 CPU 活，
 *     在飞的文件在解码段被自排队了。
 * 也就是说「取 3 是安全的」结论成立，但兜住它的是**主线程串行**，不是「每份只花一点内存」。
 * 想把常量调大的人，先看这条。
 */
const PIPELINE_CONCURRENCY = 3;

// pdf.js 的字体与图像解码资源（public/pdfjs 下，从 node_modules/pdfjs-dist 拷贝）。
// 缺了它们 pdf.js 不会报错，但会整页什么都不画：文本用未内嵌的标准字体、扫描件用 JBIG2/JPX 时命中。
// 升级 pdfjs-dist 时需要同步重新拷贝这三个目录。
const PDFJS_ASSET_BASE = "/pdfjs/";

// 首页可能是空白页（出版社分谱里常见），往后顺延试，取第一张画出了内容的
const MAX_BLANK_PAGES_TRIED = 3;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] || "");
    reader.onerror = () => reject(new Error("读取图片数据失败"));
    reader.readAsDataURL(blob);
  });
}

/** 采样统计非白像素，判断这一页是否真的画出了东西（纯白图渲染成功但内容为空时靠它识别） */
function hasVisibleContent(imageData: ImageData): boolean {
  const { data } = imageData;
  const stride = 4 * 8; // 每 8 个像素采一个点
  for (let i = 0; i + 2 < data.length; i += stride) {
    if (data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240) return true;
  }
  return false;
}

/** 缩略图：仅用于界面回显「实际送去 OCR 的是哪张图」，体积约 10KB */
function makePreview(canvas: HTMLCanvasElement, maxWidth = 260): string {
  const scale = Math.min(1, maxWidth / canvas.width);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(canvas.width * scale));
  c.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(canvas, 0, 0, c.width, c.height);
  const url = c.toDataURL("image/jpeg", 0.6);
  c.width = 0;
  c.height = 0;
  return url;
}

function canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", OCR_JPEG_QUALITY),
  ).then((blob) => {
    if (!blob) throw new Error("页面转 JPEG 失败");
    return blob;
  });
}

async function renderPageToJpeg(page: PDFPageProxy): Promise<{
  base64: string; // 实际送去 OCR 的图（裁切条优先）
  fullBase64: string; // 整页图，裁切条读不到东西时回退用
  preview: string; // base64 对应图的缩略图
  fullPreview: string; // 整页的缩略图，回退整页时顶替 preview
  blank: boolean;
  imageOps: number;
  width: number;
  height: number;
  staffY: number | null;
  crop: CropDecision;
  cropped: boolean; // base64 是否真的是裁切条（拿不到 2D 上下文时会退回整页）
}> {
  const pdfjs = await loadPdfJs();
  const unscaled = page.getViewport({ scale: 1 });
  // 只按最长边压到 OCR_TARGET_LONGEST_SIDE 以内，**不设缩放下限**：
  // 页面本身超过该尺寸时（「图片转 PDF」工具会把 MediaBox 设成扫描像素尺寸，
  // 最长边几千 pt），任何下限（Math.max(1,…) 或 0.2）都会让它不再往目标收敛 ——
  // 实测 20000pt 的页面在 0.2 下限下仍产出 4000×4000 的 canvas，
  // getImageData 峰值几十 MB，编码出的 JPEG 也必然冲破 OCR.space 免费档的 1MB 上限。
  // 页面很小时 fitScale > 1，由 OCR_MAX_SCALE 封顶，不会无限放大。
  const longestSide = Math.max(unscaled.width, unscaled.height);
  const fitScale = longestSide > 0 ? OCR_TARGET_LONGEST_SIDE / longestSide : OCR_MAX_SCALE;
  const scale = Math.min(OCR_MAX_SCALE, fitScale);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建 canvas 上下文");

  let stripCanvas: HTMLCanvasElement | null = null;
  try {
    // 页面不一定会自绘白色背景，而透明像素编码成 JPEG 会合成到黑底上（黑底黑字 OCR 读不出），先铺白
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // v6 的 RenderParameters 必须带 canvas（canvasContext 单独传不够）
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;

    // 只取一次像素给「判空」和「谱线检测」共用，省掉一次 ~18MB 的分配
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const blank = !hasVisibleContent(imageData);

    // 渲染为空时区分两种情况：这页本来就没内容 vs 图像解码失败（JBIG2/JPX 需要 /pdfjs/wasm 资源）
    let imageOps = 0;
    if (blank) {
      const ops = await page.getOperatorList();
      imageOps = ops.fnArray.filter(
        (fn) =>
          fn === pdfjs.OPS.paintImageXObject ||
          fn === pdfjs.OPS.paintImageXObjectRepeat ||
          fn === pdfjs.OPS.paintInlineImageXObject,
      ).length;
    }

    // 空白页会被顺延逻辑跳过，不必浪费一次行投影
    const staffY = blank
      ? null
      : findFirstStaffLine(
          rowLongestRun(imageData.data, canvas.width, canvas.height),
          canvas.width,
          canvas.height,
        );
    const crop = decideTitleCrop(staffY, canvas.height);

    // 裁到第一条谱线之上，把五线谱挡在送检图之外
    let ocrCanvas = canvas;
    let cropped = false;
    if (crop.crop) {
      stripCanvas = document.createElement("canvas");
      stripCanvas.width = canvas.width;
      stripCanvas.height = crop.height;
      const stripCtx = stripCanvas.getContext("2d");
      if (stripCtx) {
        stripCtx.fillStyle = "#ffffff";
        stripCtx.fillRect(0, 0, stripCanvas.width, stripCanvas.height);
        stripCtx.drawImage(
          canvas,
          0,
          0,
          canvas.width,
          crop.height,
          0,
          0,
          canvas.width,
          crop.height,
        );
        ocrCanvas = stripCanvas;
        cropped = true;
      } else {
        // 拿不到 2D 上下文就退回整页。cropped 必须与实际送出的图一致 ——
        // 否则界面会声称「标题区」，回退逻辑还会对同一张整页图白跑一遍 OCR。
        stripCanvas = null;
      }
    }

    const preview = makePreview(ocrCanvas);
    // 回退整页时缩略图要跟着换，否则界面展示的与实际送检图不符
    const fullPreview = cropped ? makePreview(canvas) : preview;
    const stripBlob = await canvasToJpegBlob(ocrCanvas);
    // 未裁切时裁切条就是整页，不必重复编码
    const fullBlob = cropped ? await canvasToJpegBlob(canvas) : stripBlob;

    return {
      base64: await blobToBase64(stripBlob),
      fullBase64: await blobToBase64(fullBlob),
      preview,
      fullPreview,
      blank,
      imageOps,
      width: canvas.width,
      height: canvas.height,
      staffY,
      crop,
      cropped,
    };
  } finally {
    // 释放 canvas 后备存储（scale 3 的一页约 20MB），避免批量处理时累积占用
    canvas.width = 0;
    canvas.height = 0;
    if (stripCanvas) {
      stripCanvas.width = 0;
      stripCanvas.height = 0;
    }
  }
}

interface RenderedPage {
  base64: string; // 送去 OCR 的图（裁切条优先）
  fullBase64: string; // 整页图，裁切条读不到文字时回退用
  preview: string;
  fullPreview: string; // 整页缩略图，回退整页时顶替 preview
  pageNo: number;
  /** 这一份 PDF 的总页数 —— 成本估算与「要不要分段」都看它，顺手带出来省一次解析 */
  pageCount: number;
  warning: string;
  cropNote: string; // 裁切决策回显，便于排查「切错位置」
  cropped: boolean; // base64 是否真的是裁切条
}

/**
 * 把裁切决策翻译成界面文案。
 * 必须同时看 `cropped`（**实际**有没有裁出来）—— 拿不到 2D 上下文时会退回整页，
 * 只翻译「决策」会让界面说反话，而这段文案正是用来排查「切错位置」的。
 */
function cropNoteOf(crop: CropDecision, cropped: boolean): string {
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

/**
 * 取第一张「有内容的」页并渲染成 JPEG。
 * 不抛「全空白」错误：页面取不到时调用方照样可以用文件名让 LLM 判断，
 * 但会把原因通过 warning 带回界面（这类出版社扫描分谱常年踩 JBIG2 解码这一脚）。
 */
async function renderFirstContentPage(file: File): Promise<RenderedPage> {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({
    data,
    standardFontDataUrl: `${PDFJS_ASSET_BASE}standard_fonts/`,
    wasmUrl: `${PDFJS_ASSET_BASE}wasm/`,
    iccUrl: `${PDFJS_ASSET_BASE}iccs/`,
  });
  const pdf = await task.promise;

  try {
    const pagesToTry = Math.min(MAX_BLANK_PAGES_TRIED, pdf.numPages);
    let warning = "";
    let preview = "";

    for (let pageNo = 1; pageNo <= pagesToTry; pageNo++) {
      const result = await renderPageToJpeg(await pdf.getPage(pageNo));
      if (!result.blank) {
        return {
          base64: result.base64,
          fullBase64: result.fullBase64,
          preview: result.preview,
          fullPreview: result.fullPreview,
          pageNo,
          pageCount: pdf.numPages,
          warning,
          cropNote: cropNoteOf(result.crop, result.cropped),
          cropped: result.cropped,
        };
      }
      preview = result.preview || preview;
      warning =
        result.imageOps > 0
          ? `第 ${pageNo} 页含图像但渲染为空 —— 图像解码失败（JBIG2/JPX 需要 /pdfjs/wasm 资源）`
          : `第 ${pageNo} 页无内容`;
    }

    return {
      base64: "",
      fullBase64: "",
      preview,
      fullPreview: preview,
      pageNo: 0,
      pageCount: pdf.numPages,
      warning,
      cropNote: "",
      cropped: false,
    };
  } finally {
    // 释放整个文档与 worker，每份文件的内存不跨轮次累积
    await task.destroy();
  }
}

/**
 * Edge Function 返回非 2xx 时，functions.invoke 会返回 { data: null, error }，
 * 真实错误体挂在 error.context（Response）上——不读它就会把服务端的报错吞掉。
 */
/** 把 context 上挂的原始错误（AbortError / DOMException 等）压成一句可读原因 */
function describeCause(ctx: unknown): string {
  if (ctx == null || ctx instanceof Response) return "";
  // 用结构化判断（读 name/message）而不是 `instanceof Error`：这里要处理的是
  // AbortError / DOMException 这类宿主对象。实测（真 Chrome）
  // `new DOMException("x","AbortError") instanceof Error === true`，所以 instanceof
  // 今天也能work —— 但结构化判断不依赖原型链，跨 realm（iframe/worker）或被
  // polyfill / 打包改写时更稳，也能容忍只有 name 没有 message 的对象。
  const name = (ctx as { name?: unknown }).name;
  const message = (ctx as { message?: unknown }).message;
  if (typeof name !== "string" || !name) return "";
  return `（${name}${typeof message === "string" && message ? `: ${message}` : ""}）`;
}

async function invokeErrorDetail(error: unknown): Promise<string> {
  const ctx = (error as { context?: unknown }).context;
  // supabase-js 在网络失败/超时时会把错误包成 FunctionsFetchError：message 是固定文案
  // 「Failed to send a request to the Edge Function」，真正的原因（AbortError 等）挂在
  // context 上且**不是** Response 实例。不读它就无法区分「超时」和「网络断了」，
  // 下面 OCR_TRANSIENT 的重试判据也匹配不到。
  const cause = describeCause(ctx);
  if (ctx instanceof Response) {
    const status = `HTTP ${ctx.status}`;
    try {
      const body = (await ctx.clone().json()) as { error?: string } | null;
      const detail = body?.error ? body.error : JSON.stringify(body);
      return `${detail}（${status}）${cause}`;
    } catch {
      try {
        const text = await ctx.clone().text();
        return text ? `${text}（${status}）${cause}` : `${status}${cause}`;
      } catch {
        return `${status}${cause}`;
      }
    }
  }
  return (error instanceof Error ? error.message : String(error)) + cause;
}

/** base64 长度换算回实际图片字节数 */
function base64Kb(base64: string): number {
  return Math.round(((base64.length * 3) / 4 / 1024) * 10) / 10;
}

// OCR.space 偶发 E502/E503 之类服务端引擎错误（实测 33 次里出现 1 次），重试即可。
// 注意只写 "Failed to fetch" 是不够的：supabase-js 会把网络错误与超时统一包成
// FunctionsFetchError，其 message 恒为「Failed to send a request to the Edge Function」，
// 原话里没有 "Failed to fetch"，那条分支永远不会命中 —— 超时和网络失败都不会重试。
const OCR_RETRY_DELAYS = [1200, 3500];
const OCR_TRANSIENT =
  /E5\d\d|HTTP 5\d\d|timeout|timed out|Failed to fetch|Failed to send a request|AbortError/i;

/** 首页图片交给 ocr-analyze 转发 OCR.space；瞬时错误自动重试，最终失败抛错并带上体积便于排查 */
async function runOcr(imageBase64: string): Promise<string> {
  const kb = base64Kb(imageBase64);
  let lastError = "";

  for (let attempt = 0; attempt <= OCR_RETRY_DELAYS.length; attempt++) {
    if (attempt > 0) await sleep(OCR_RETRY_DELAYS[attempt - 1]);

    const { data, error } = await supabase.functions.invoke("ocr-analyze", {
      body: { file_base64: imageBase64, mime_type: "image/jpeg" },
      timeout: OCR_TIMEOUT_MS,
    });

    if (error) {
      lastError = await invokeErrorDetail(error);
      if (OCR_TRANSIENT.test(lastError) && attempt < OCR_RETRY_DELAYS.length) continue;
      throw new Error(`OCR 请求失败（首页图 ${kb}KB）: ${lastError}`);
    }
    // 服务端 200 且 success：即便一个字都没读到也算成功，返回空串。
    // 这里**不能抛错** —— 调用方靠「文本去空白后 < 5 字符」触发回退整页，
    // 抛错会让最关键的那种情况（裁切条完全空白）根本走不到回退分支，
    // 而这正是「切错位置」最常见的表现。
    if (data?.success) return String(data.text ?? "");

    // success 为假：这张图确实没有可读文本，重试无意义
    lastError = `服务端 success=${data?.success} 但未返回文字`;
    break;
  }

  throw new Error(`OCR 未识别到文字（首页图 ${kb}KB）: ${lastError}`);
}

/**
 * 顶部窄带的固定高度（页高比例）。
 *
 * ⚠️ **必须是固定值，不能用 `decideTitleCrop`**：续页在裁切逻辑下会因「顶部过薄」
 * 退化成整页，那就把「续页只有页眉」这个判据本身毁掉了（#290 正文里写明了这条）。
 * 12% 是 issue 里给的例子，实测在 Egmont（Breitkopf）与德五（Dover 系）两批语料上
 * 都够装下首页的标题块。
 */
const BAND_PCT = 0.12;

/**
 * 逐页渲染顶部等高窄带（#290 Step 1 的输入）。
 *
 * 与 `renderFirstContentPage` **刻意分开**：那个的职责是「取首页、决定裁到哪」，
 * 这个的职责是「每一页都取一条等高的窄带」—— 两者的裁切逻辑必须不同（见 BAND_PCT）。
 * 代价是第 1 页被渲染两次（每份文件多一次渲染，与 N 次 OCR 相比可忽略），
 * 换来的是两条路径互不牵制。
 *
 * ⚠️ 内存：每页渲染后会 `page.cleanup()`。渲染一整页的 canvas 峰值在本项目的语料上
 * 量到过 ~282MB（大头是 pdf.js 解码扫描图的**内部**画布），19 页串行跑不会叠加，
 * 但**不能**把这里改成并发。
 */
async function renderNarrowBands(file: File): Promise<{ pageCount: number; bands: string[] }> {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({
    data,
    standardFontDataUrl: `${PDFJS_ASSET_BASE}standard_fonts/`,
    wasmUrl: `${PDFJS_ASSET_BASE}wasm/`,
    iccUrl: `${PDFJS_ASSET_BASE}iccs/`,
  });
  const pdf = await task.promise;
  try {
    const bands: string[] = [];
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      const page = await pdf.getPage(pageNo);
      try {
        const unscaled = page.getViewport({ scale: 1 });
        const longestSide = Math.max(unscaled.width, unscaled.height);
        const fitScale = longestSide > 0 ? OCR_TARGET_LONGEST_SIDE / longestSide : OCR_MAX_SCALE;
        const viewport = page.getViewport({ scale: Math.min(OCR_MAX_SCALE, fitScale) });

        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("无法创建 canvas 上下文");
        // 透明像素编码成 JPEG 会合成到黑底，先铺白（与 renderPageToJpeg 同一条理由）
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;

        const bandH = Math.max(1, Math.round(canvas.height * BAND_PCT));
        const band = document.createElement("canvas");
        band.width = canvas.width;
        band.height = bandH;
        const bctx = band.getContext("2d");
        if (!bctx) throw new Error("无法创建 canvas 上下文");
        bctx.fillStyle = "#ffffff";
        bctx.fillRect(0, 0, band.width, band.height);
        bctx.drawImage(canvas, 0, 0, canvas.width, bandH, 0, 0, band.width, band.height);

        const blob = await new Promise<Blob | null>((r) =>
          band.toBlob(r, "image/jpeg", OCR_JPEG_QUALITY),
        );
        if (!blob) throw new Error(`第 ${pageNo} 页窄带编码失败`);
        const buf = new Uint8Array(await blob.arrayBuffer());
        // 分段转成字符串再 btoa：一次 `String.fromCharCode(...buf)` 在大图上会撞
        // 「参数过多」的栈上限，所以按 32KB 切
        let bin = "";
        for (let i = 0; i < buf.length; i += 0x8000) {
          bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        }
        bands.push(btoa(bin));
      } finally {
        page.cleanup();
      }
    }
    return { pageCount: pdf.numPages, bands };
  } finally {
    void task.destroy?.();
  }
}

/** 一页的窄带文本（分段用）。页码 1-based，与 PDF 页序一致。 */
interface PageText {
  page: number;
  text: string;
}

/**
 * 跑一份合订谱的分段：**逐页**窄带 OCR → `segment-parts` → 切点。
 *
 * 页文本一起返回：用户改边界时**不需要重跑 OCR**（验收标准里点名的「改正后不重复
 * OCR」就是靠这个 —— 文本留在手里，改边界只是重新算段）。
 *
 * ⚠️ 串行跑。一份 N 页 = N 次 OCR，**不能**与别的文件并发更多 —— 整个分析阶段已经
 * 有 `PIPELINE_CONCURRENCY` 个文件在飞，这里再并发会把 OCR.space 的瞬时压力翻几倍。
 */
async function runSegmentation(
  file: File,
): Promise<{ pageCount: number; pageTexts: PageText[]; cuts: number[] }> {
  const { pageCount, bands } = await renderNarrowBands(file);
  const pageTexts: PageText[] = [];
  for (let i = 0; i < bands.length; i++) {
    // 单页 OCR 失败不该让整份分段失败：那一页的文本留空，模型会看到「（空白）」，
    // 而 handler 也允许页与页之间有缺（页号是显式的，不会错位）。
    let text = "";
    try {
      text = await runOcr(bands[i]);
    } catch {
      text = "";
    }
    pageTexts.push({ page: i + 1, text });
  }

  const { data, error } = await supabase.functions.invoke("segment-parts", {
    body: { pageCount, pages: pageTexts },
    timeout: LLM_TIMEOUT_MS,
  });
  if (error) throw new Error(`分段请求失败: ${await invokeErrorDetail(error)}`);
  if (!data?.success) {
    throw new Error(`分段失败: ${data?.error || data?.message || "未知错误"}`);
  }
  const cuts = Array.isArray(data.cuts)
    ? data.cuts.filter((c: unknown): c is number => typeof c === "number")
    : [];
  return { pageCount, pageTexts, cuts };
}

/**
 * 乐器识别：文件名作为一行证据，和 OCR 文本一起交给 LLM。
 * 出版社扫描分谱的乐器名往往就写在文件名里（PMLASIA01165-13-Horn_2.pdf），
 * 而它们的页面常是扫描乐谱、OCR 读出来是乱的 —— 这种情况下文件名比 OCR 可靠得多。
 * 后端 llm-analyze 只接受 text/ocr_text 字段，因此这里合并成一段文本发送。
 */
interface LlmAnalysis {
  section: string;
  instrument: string;
  subParts: number[];
  /** 模型给了号但后端没解析出来时，模型用的那个写法，见 UploadFile.subPartsRaw */
  subPartsRaw?: string;
  /** 后端给的号超过前端上界时的个数，见 UploadFile.subPartsOverCap */
  subPartsOverCap?: number;
}

async function runLlmAnalysis(fileName: string, ocrText: string): Promise<LlmAnalysis> {
  const input = [`文件名: ${fileName}`];
  if (ocrText) input.push(`OCR 文本: ${ocrText}`);

  const { data, error } = await supabase.functions.invoke("llm-analyze", {
    body: { ocr_text: input.join("\n") },
    timeout: LLM_TIMEOUT_MS,
  });
  if (error) {
    throw new Error(`LLM 请求失败: ${await invokeErrorDetail(error)}`);
  }
  if (data?.success) {
    // 响应字段平铺在顶层。`instrument` 为空串即「未识别」—— 后端把
    // 「证据不足 / 答不出来（unknown、无法判断…）」都收敛成了空串，
    // 所以这里**不预填**，见 startAnalysis 里的处理。
    return {
      section: String(data.section ?? OTHER_INSTRUMENT_GROUP),
      instrument: String(data.instrument ?? ""),
      subParts: sanitizeSubParts(data.subParts),
      // 「模型给了号但没读懂」的信号，原样带过来给界面提示用户手填
      subPartsRaw: typeof data.subPartsRaw === "string" ? data.subPartsRaw : undefined,
      // 超上界时 sanitize 会把号整个丢掉，而这条路径**不带任何其他信号** ——
      // 不单独报的话它就是一条完全静默的丢号路径（见 overSubPartsCap）
      subPartsOverCap: overSubPartsCap(data.subParts) ?? undefined,
    };
  }
  throw new Error(`LLM 分析失败: ${data?.error || data?.message || "未知错误"}`);
}

export function UploadModal({ open, onClose, scoreId, onUploaded }: UploadModalProps) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [phase, setPhase] = useState<"select" | "analyzing" | "confirm" | "uploading">("select");
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 关闭弹窗会把本组件卸载（page.tsx 把 selectedScoreId 置 null），但 startAnalysis 的
  // 并发池还在跑：updateFile 变成 no-op，用户看不见进度、重开是全新空状态，OCR 配额却照烧 ——
  // 最坏 20 个文件（并发 3、单文件最坏 ≈ OCR 65s + LLM 45s）仍能在后台持续请求十几分钟。
  // 卸载时置位，每个文件开头检查一次后退出（已在飞的那几个会跑完）。
  const cancelledRef = useRef(false);
  // 防重复提交：ref 同步阻断竞态窗口（setState 是异步的，两次快速点击之间 phase 仍是旧值）
  const analyzingRef = useRef(false);
  const segRunningRef = useRef(false);
  const uploadingRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    const newFiles: UploadFile[] = [];

    for (const file of selected) {
      if (file.type === "application/pdf") {
        newFiles.push({ file, originalName: file.name, status: "pending" });
      } else if (file.name.endsWith(".zip")) {
        try {
          const zip = await JSZip.loadAsync(file);
          const pdfFiles = Object.keys(zip.files).filter((name) =>
            name.toLowerCase().endsWith(".pdf"),
          );

          for (const pdfName of pdfFiles) {
            const pdfData = await zip.files[pdfName].async("blob");
            const pdfFile = new File([pdfData], pdfName.split("/").pop() || pdfName, {
              type: "application/pdf",
            });
            const baseName = pdfName.split("/").pop() || pdfName;
            newFiles.push({
              file: pdfFile,
              originalName: baseName,
              status: "pending",
            });
          }
        } catch {
          alert(`ZIP 文件解压失败: ${file.name}`);
        }
      }
    }

    setFiles((prev) => [...prev, ...newFiles]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const updateFile = (index: number, patch: Partial<UploadFile>) => {
    setFiles((prev) => prev.map((f, idx) => (idx === index ? { ...f, ...patch } : f)));
  };

  /**
   * 单个文件：取页 → OCR → LLM，每步只更新自己那一行。
   *
   * files 是点击那一刻的快照，worker 里的 updateFile 不会改到它——只用它决定处理哪些
   * 文件，不要用它判断处理进度（上一版据此判断，导致永远进不了确认阶段）。
   */
  const analyzeOne = async (file: UploadFile, i: number) => {
    // 弹窗被关掉就尽快收手：每个文件开头检查一次，最坏多做已在飞的那几个
    if (cancelledRef.current) return;
    if (file.status !== "pending") return;

    updateFile(i, { status: "analyzing", ocrText: "正在提取页面...", llmResult: "" });

    // 取页与 OCR 都是「能给就给」：失败不终止，退化成只用文件名让 LLM 判断
    let ocrText = "";
    let warning = "";
    let rendered: RenderedPage | null = null;
    let usedFullPage = false;

    try {
      rendered = await renderFirstContentPage(file.file);
      warning = rendered.warning;
      updateFile(i, {
        preview: rendered.preview || undefined,
        sourcePage: rendered.pageNo || undefined,
        warning: warning || undefined,
        cropNote: rendered.cropNote || undefined,
      });

      if (rendered.base64) {
        const where = rendered.cropped ? "标题区" : "整页";
        updateFile(i, { ocrText: `已取第 ${rendered.pageNo} 页（${where}），正在 OCR...` });

        // 裁切条 OCR 失败也按「没读到」处理，一并交给下面的回退。
        // 服务端表达「没读到文字」有两种形态：200 + 空 text，以及 400 + success:false
        // （见 pkuso-backend 的 ocr-analyze：IsErroredOnProcessing 为真时回 400）——
        // 后者会被 runOcr 抛成异常。只在返回空串时才回退，等于漏掉更常见的那一半，
        // 而「切错位置」恰恰是最容易让裁切条读不到文字的情况。
        let stripError = "";
        try {
          ocrText = await runOcr(rendered.base64);
        } catch (err) {
          if (!rendered.cropped) throw err; // 没裁切就没什么可回退的
          ocrText = "";
          stripError = err instanceof Error ? err.message : String(err);
        }
        updateFile(i, { ocrText });

        // 标题区没读到文字就回退整页再试一次（未裁切时两者是同一张图，不回退）
        if (rendered.cropped && ocrText.trim().length < MIN_OCR_CHARS) {
          usedFullPage = true;
          updateFile(i, { ocrText: "标题区未读到文字，回退整页 OCR…" });
          try {
            ocrText = await runOcr(rendered.fullBase64);
          } catch (err) {
            // 两次都失败时把两条原因都带上，否则第一条（往往更有诊断价值）会被吞掉
            const fullError = err instanceof Error ? err.message : String(err);
            throw new Error(stripError ? `标题区：${stripError}；整页：${fullError}` : fullError);
          }
          // 缩略图与裁切说明必须跟着换成「整页」。这两个字段的用途就是排查
          // 「切错位置」，回退后还说「已裁至标题区」正好在最需要它时说反话。
          updateFile(i, {
            ocrText,
            preview: rendered.fullPreview || rendered.preview || undefined,
            cropNote: `${rendered.cropNote}｜回退项：标题区未读到文字，已改用整页`,
          });
        }
      } else {
        updateFile(i, { ocrText: warning });
      }
    } catch (err) {
      warning = err instanceof Error ? err.message : String(err);
      updateFile(i, { ocrText: warning, warning });
    }

    updateFile(i, { llmResult: "等待 LLM 分析..." });
    try {
      let analysis = await runLlmAnalysis(file.originalName, ocrText);

      // 识别不出时回退整页 OCR 再判一次：裁切条只含首页标题区，
      // 乐器名未必落在那里。空串是后端约定的「未识别」——
      // 它把「证据不足」和模型答「unknown / 无法判断」都收敛成了空串。
      if (!analysis.instrument && rendered?.cropped && !usedFullPage) {
        const { fullBase64, fullPreview, preview, cropNote } = rendered;
        usedFullPage = true;
        try {
          updateFile(i, { llmResult: "未能识别，回退整页 OCR 重试..." });
          ocrText = await runOcr(fullBase64);
          analysis = await runLlmAnalysis(file.originalName, ocrText);
          // 两步都成功了才改缩略图与裁切说明，否则界面会说「已改用整页」而结果其实来自裁切条
          updateFile(i, {
            ocrText,
            preview: fullPreview || preview || undefined,
            cropNote: `${cropNote}｜回退项：未能识别，已改用整页`,
          });
        } catch (err) {
          // 回退失败就保留第一次的结果，不要让整行失败
          warning = err instanceof Error ? err.message : String(err);
          updateFile(i, { warning });
        }
      }

      const { section, instrument, subParts, subPartsRaw, subPartsOverCap } = analysis;
      // 未识别时**不预填** instrumentEdit（留空串）：预填一个猜测值会被用户直接
      // 接受，等于把错误洗成「已确认」。空的输入框会逼用户做一次真实判断。
      updateFile(i, {
        status: "analyzed",
        llmResult: analysisSummary(section, instrument, subParts),
        sectionGuess: section,
        sectionEdit: section,
        instrumentGuess: instrument,
        instrumentEdit: instrument,
        subPartsGuess: subParts,
        // 不设 subPartsEditText：`undefined` = 没编辑过 → 输入框显示 Guess。
        // 「模型给了号但没读懂」时 subParts 是空数组，输入框自然留空，
        // 配合下面的 subPartsRaw 提示，用户知道这一格需要他填。
        subPartsRaw,
        // ⚠️ 这一行曾经漏掉：`runLlmAnalysis` 算出了 overCap、`subPartsNotice` 也写了那一支，
        // 但**中间没人把它写进行状态**，于是那条提示是死代码 —— 上界漂移时号被静默吞掉，
        // 一个字都不显示（审查靠「提示可达性」的探针抓出来的）。三个环节缺一不可。
        subPartsOverCap,
        // 记下页数：成本估算与「这份要不要分段」都看它（多页且非总谱才走分段）
        pageCount: rendered?.pageCount,
        // 存储键要在**分析完成时**就定下来（每行一次、重试复用），
        // 而不是每次点上传现生成 —— 否则失败重传会不断产生新对象。
        storageId: crypto.randomUUID(),
      });
    } catch (err) {
      updateFile(i, {
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const startAnalysis = async () => {
    if (analyzingRef.current) return;
    analyzingRef.current = true;
    setPhase("analyzing");
    cancelledRef.current = false;

    // 并发跑：每份文件各自走完「取页 → OCR → LLM」，最多 PIPELINE_CONCURRENCY 个同时在飞。
    // 结果乱序完成没关系 —— 每步只按自己的下标 updateFile，互不干扰。
    //
    // 文件之间**不再 sleep**：原先那句「避免 LLM/OCR 限流」是误判 —— 当时那批 429 是
    // ocr-analyze 里 pdf-lib 抽首页爆缓冲区导致的，不是服务端限流；而 OCR 与 LLM 两条
    // 链路本来就各有 429 重试兜底（见 runOcr）。
    try {
      await runWithConcurrency(files, PIPELINE_CONCURRENCY, analyzeOne);
    } catch (err) {
      // 兜底：worker 理论上不抛（每个文件的失败都写进了它自己那一行），真抛了也不能让弹窗
      // 卡在「分析中」—— 「确认上传」会被 hasAnalyzingFiles 永久禁用，用户唯一的出路是
      // 关掉弹窗，而代价是丢掉整批已经烧掉 OCR 配额的分析结果。
      console.error("分析阶段意外中断:", err);
      const message = err instanceof Error ? err.message : String(err);
      setFiles((prev) =>
        prev.map((f) => (f.status === "analyzing" ? { ...f, status: "error", error: message } : f)),
      );
    } finally {
      analyzingRef.current = false;
    }

    if (cancelledRef.current) return;
    setPhase("confirm");
  };

  /**
   * 这份文件要不要跑分段：**多页、非总谱**。
   *
   * 总谱的排除是用户定的（省掉最大的一笔 OCR）；而「总谱认不出来」这件事有实测支撑
   * （三个本地判据都被否掉，见 #290 的评论），所以只能靠 `section === 总谱` 人工标记兜底。
   * 页数未知（分析失败）时不跑 —— 连成本都算不出来。
   */
  const segEligible = (f: UploadFile) =>
    f.status !== "error" &&
    needsSegmentation(
      f.pageCount ?? null,
      (f.sectionEdit ?? f.sectionGuess ?? "").trim() === FULL_SCORE_SECTION,
    );

  /** 跑一遍分段要烧多少次 OCR —— **点火前必须让用户看到**（#290 验收标准之一） */
  const segCost = files.reduce((n, f) => (segEligible(f) ? n + (f.pageCount ?? 0) : n), 0);
  const segTargets = files.filter(segEligible);

  /**
   * 跑分段（#290 Step 1）。**不自动跑** —— 一份 N 页的合订谱要烧 N 次 OCR，
   * 用户必须在点火前知道这个数（见 segCost 与界面上的按钮文案）。
   */
  const startSegmentation = async () => {
    if (segRunningRef.current) return;
    segRunningRef.current = true;
    cancelledRef.current = false;
    try {
      const targets = files
        .map((f, i) => ({ f, i }))
        .filter(({ f }) => segEligible(f) && f.segState !== "done");
      await runWithConcurrency(targets, PIPELINE_CONCURRENCY, async ({ f, i }) => {
        if (cancelledRef.current) return;
        updateFile(i, { segState: "running", segError: undefined });
        try {
          const { pageTexts, cuts } = await runSegmentation(f.file);
          updateFile(i, {
            segState: "done",
            pageTexts,
            // 段的**起点**（恒含第 1 页）：用户拖动边界就是改这个数组
            segmentStarts: [...new Set([1, ...cuts])].sort((a, b) => a - b),
          });
        } catch (err) {
          updateFile(i, {
            segState: "error",
            segError: err instanceof Error ? err.message : String(err),
          });
        }
      });
    } finally {
      segRunningRef.current = false;
    }
  };

  /** 界面上显示的段（由起点页推出闭区间）。用户改过起点就按改过的算 */
  const segmentsOf = (f: UploadFile) => normalizeSegments(f.segmentStarts ?? [1], f.pageCount ?? 1);

  /** 改某一段的起点页。会立刻收敛（不留空洞/重叠），并把结果写回状态 */
  const setSegmentStart = (index: number, segIndex: number, startPage: number) => {
    const f = files[index];
    const starts = [...(f.segmentStarts ?? [1])].sort((a, b) => a - b);
    starts[segIndex] = startPage;
    updateFile(index, { segmentStarts: [...new Set(starts)].sort((a, b) => a - b) });
  };

  /**
   * 声部现在是**闭集**，分组靠 `section` 而不是乐器名 —— 木琴与马林巴都归打击乐，
   * 低音大管归大管。乐器名只进文件名与展示。
   */
  const getOrCreatePart = async (section: string): Promise<string | null> => {
    const { data: existing } = await supabase
      .from("sheet_music_parts")
      .select("id")
      .eq("sheet_music_id", scoreId)
      .eq("section", section)
      .maybeSingle();

    if (existing) return existing.id;

    const { data: newPart, error } = await supabase
      .from("sheet_music_parts")
      .insert({ sheet_music_id: scoreId, section })
      .select("id")
      .single();

    if (error) {
      console.error("Create part failed:", error);
      return null;
    }
    return newPart.id;
  };

  // 三个输入 handler 都顺手清 `error`：那是**上一次**拦截留下的红字，而它只在
  // 「下一次点确认上传且通过判据」时才被清掉 —— 用户明明改好了，红字还挂着，
  // 读起来像「改完还是不行」。（清 error 不会让漏填的行失去提示：
  // 那种行本来就由 `uploadBlocker` 在点上传时重新写一遍。）
  const handleInstrumentChange = (index: number, value: string) => {
    updateFile(index, { instrumentEdit: value, error: undefined });
  };

  const handleSectionChange = (index: number, value: string) => {
    updateFile(index, { sectionEdit: value, error: undefined });
  };

  /**
   * 预览「这将存成什么名字」。乐器名为空时返回空串。
   *
   * 预览的是**人类可读的名字**（`声部 / 文件名`）而不是真实的存储键 ——
   * 存储键现在是 `{scoreId}/{行 id}.pdf`，给用户看一串 uuid 没有意义；
   * 可读名落 `sheet_music_files.file_name`，下载时会用它还原文件名。
   */
  const previewPath = (f: UploadFile) => {
    // 取值**只走 editsOf**（与落库、与 uploadBlocker 是同一条判据）。
    // 早先这里自己抄了一份推导式，于是非法输入时预览会显示成一个**看着完全正常**的
    // `圆号.pdf`（非法时 parse 的 value 恒为 `[]`）—— 而那一行其实传不上去。
    const { section, instrument, subParts, subPartsInvalid, subPartsUnread } = editsOf(f);
    if (!instrument) return "";
    // 有硬伤时不报一个像样的名字：宁可显示「待确认」，也别让用户以为存的就是它
    if (subPartsInvalid || subPartsUnread) return `${section} / （分声部号待确认）`;
    return `${section} / ${generateFileName(instrument, subParts)}`;
  };

  const handleSubPartsChange = (index: number, value: string) => {
    // 存**原文**而不是解析结果：解析结果会把用户正在敲的 `1,` 归一成 `1`，
    // 逗号在受控输入里当场消失，`1,2` 永远敲不出来。解析发生在读取时（editsOf）。
    updateFile(index, { subPartsEditText: value, error: undefined });
  };

  const confirmUpload = async () => {
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    setPhase("uploading");

    let hasSuccess = false;
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        alert("请先登录");
        return;
      }

      // 声部：**按需建、同一个声部全批只发一次** SELECT+INSERT。
      //
      // 为什么不能让每个 worker 各自去建：getOrCreatePart 是「先 SELECT 再 INSERT」，
      // 两个并发 worker 撞上同一个新声部会双双查空、双双插入 → **重复声部行**
      // （表上还没有唯一约束）。这里用 Map 存**同一张票（promise）**，后到的 await 同一张，
      // 竞态就没了 —— 靠的是一张票，而不是靠「先把全批串行建完」。
      //
      // 也**不能**先串行把全批声部建出来：取消（或中途失败）会留下一批**没有任何文件
      // 指向的空声部**，而曲谱详情页会把它们逐个列出来、只能手工删。按需建才是
      // 「用到了才留下」，且建失败天然只影响用到它的行（保持逐行语义）。
      const partTickets = new Map<string, Promise<string | null>>();
      const ensurePart = (section: string): Promise<string | null> => {
        let ticket = partTickets.get(section);
        if (!ticket) {
          // get → 调用 → set 之间没有 await，两个 worker 不会各拿到一张票
          ticket = getOrCreatePart(section);
          partTickets.set(section, ticket);
        }
        return ticket;
      };

      // 并发上传 + 落库。结果乱序返回没关系：列表是按行状态驱动的，
      // updateFile(i, …) 按索引更新，互不干扰。
      await runWithConcurrency(files, PIPELINE_CONCURRENCY, async (uploadFile, i) => {
        // 取消时最多再做已在飞的那几个（其余 worker 领到下标会立刻返回）
        if (cancelledRef.current) return;
        if (uploadFile.status === "done") return;

        // 声部与乐器名分开取：声部是闭集（写进 parts.section），
        // 乐器名是开集（写进 files.instrument，也是文件名主干）
        const { section, instrument, subParts, subPartsInvalid, subPartsUnread } =
          editsOf(uploadFile);

        // 拦下，但**不改状态**。这两行缺的是用户补填，而编辑器只在有识别结果的行上
        // 渲染 —— 置成 error 会让输入框消失，界面变成「让你填却没有字段可填」，
        // 用户只能关掉弹窗、连带丢掉整批已经烧掉 OCR 配额的分析结果。
        const blocker = uploadBlocker({ section, instrument, subPartsInvalid, subPartsUnread });
        if (blocker) {
          updateFile(i, { error: blocker });
          return;
        }
        // 这一行能往下走了，把上一次的拦截/失败提示清掉，免得文案留在界面上说谎
        updateFile(i, { error: undefined, status: "uploading" });

        // 用到才建。建失败时这张票就是 null，用到同一张票的行各报各的错。
        const partId = await ensurePart(section);
        if (!partId) {
          updateFile(i, { status: "error", error: "创建声部失败" });
          return;
        }

        const generatedFileName = generateFileName(instrument, subParts);
        const filePath = pathOf(scoreId, uploadFile.storageId ?? crypto.randomUUID());
        const { error: uploadError } = await supabase.storage
          .from("sheet-music")
          .upload(filePath, uploadFile.file, { contentType: "application/pdf", upsert: true });

        if (uploadError) {
          updateFile(i, { status: "error", error: uploadError.message });
          return;
        }

        const { error: dbError } = await supabase.from("sheet_music_files").insert({
          part_id: partId,
          storage_path: filePath,
          file_name: generatedFileName,
          // 乐器名单独存一列，与派生出的文件名分开 —— 便于区分
          // 「LLM 答错」与「文件名生成错」
          instrument,
          // 分声部号同样单独存一列。**它此前只活在 file_name 字符串里** ——
          // 详情页刷新后拿不到分声部，排序与显示都无从谈起；文件名不是数据。
          sub_parts: subParts,
          file_size: uploadFile.file.size,
          uploaded_by: user.id,
        });

        if (dbError) {
          updateFile(i, { status: "error", error: dbError.message });
          return;
        }

        updateFile(i, { status: "done", instrumentGuess: instrument });
        hasSuccess = true;
      });
    } catch (err) {
      // 任何一步意外 reject（例如 supabase-js 的 navigator.locks 以非 AbortError 拒绝时
      // getUser() 会抛）都不能让弹窗卡死在「上传中」——那会锁死 uploadingRef，
      // 用户只能关掉弹窗，而关掉就丢掉整批已烧掉的分析结果。
      //
      // 还把停在「上传中」的那几行退回「已分析」：否则它们会永远转圈，
      // 而没有文件保持 analyzed 时「确认上传」按钮也会被禁用，用户连重试都做不到。
      setFiles((prev) =>
        prev.map((f) => (f.status === "uploading" ? { ...f, status: "analyzed" } : f)),
      );
      alert(`上传失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      uploadingRef.current = false;
      // 已经传成功的要让列表刷新；组件已被卸载时 onUploaded 打给父组件，仍应执行
      if (hasSuccess) onUploaded();
      if (!cancelledRef.current) setPhase("confirm");
    }
  };

  const statusText = (f: UploadFile) => {
    // 取值**只走 editsOf**：行文案必须与文件名预览、落库结果一致，否则用户会以为
    // 「清空没生效」。三处各抄一份推导式就迟早会漂（这个文件里已经栽过一次）。
    const { section, instrument, subParts } = editsOf(f);
    const sub = subParts.length > 0 ? ` ${formatSubParts(subParts)}` : "";
    switch (f.status) {
      case "pending":
        return "待分析";
      case "analyzing":
        return "分析中...";
      case "analyzed":
        // 空乐器名 = 后端弃权（证据不足 / 答不出来），必须与「已识别」区分开：
        // 输入框是空的、等用户填，不能显示成识别成功
        return instrument ? `已识别 → ${section} / ${instrument}${sub}` : "需人工确认";
      case "uploading":
        return "上传中...";
      case "done":
        return instrument ? `已上传 → ${section} / ${instrument}${sub}` : "已上传";
      case "error":
        return `失败: ${f.error}`;
    }
  };

  /**
   * 声部词表漂移告警。后端 prompt 里的 16 个声部名与前端 `INSTRUMENT_ORDER`
   * 是两份手抄副本，没有跨仓同步机制 —— 这条告警就是那个机制缺席时的可见信号。
   */
  const sectionWarning = (f: UploadFile) => {
    const s = (f.sectionEdit ?? f.sectionGuess ?? "").trim();
    return s && !isKnownSection(s) ? `声部「${s}」不在标准列表内` : "";
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
  const subPartsNotice = (f: UploadFile) => {
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

  const statusColor = (status: UploadFile["status"]) => {
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

  const hasDetails = (f: UploadFile) =>
    f.ocrText || f.llmResult || f.preview || f.warning || f.cropNote;

  // 是否有文件正在分析中
  const hasAnalyzingFiles = files.some((f) => f.status === "analyzing");
  /**
   * 这次点「确认上传」真的会去传的行数（兼作按钮的启用判据与进度显示）。
   *
   * 判据必须是「**还没传成功的、且分析过**」，不能是「状态是 analyzed」——
   * 上传失败的行会变 `error`，若不算进来，analyzed 计数归零会让按钮**永久禁用**，
   * 而上传循环的注释明写「失败的行要允许重试」。那时用户唯一的出路是关掉弹窗，
   * 而代价是丢掉整批已经烧掉 OCR 配额的分析结果。
   */
  const uploadableCount = files.filter(
    (f) => f.status !== "done" && f.instrumentGuess !== undefined,
  ).length;
  /** 传成功的行数。用于判断「这一批是不是已经干完了」。 */
  const doneCount = files.filter((f) => f.status === "done").length;
  /**
   * 活干完了：没有待传的行，且至少成功过一个。
   *
   * 没有这个状态时，全部传完后按钮是「确认上传（0/N）」且禁用 —— 用户没有任何
   * **正向出口**，只能点「取消」或右上角关闭，看起来像没成功。（合规审查报过。）
   */
  const allDone = uploadableCount === 0 && doneCount > 0 && !hasAnalyzingFiles;

  return (
    // 用全屏层而不是默认的底部弹窗：20 个文件的结果 + 每行的三个输入框，
    // 底部弹窗装不下（原先列表只有 max-h-80，剩下的全靠页面自己滚）。
    <Modal
      open={open}
      onClose={onClose}
      title="上传乐谱文件"
      position="fullscreen"
      // 上传途中不让点遮罩关掉：会静默中止剩余的传输，用户以为只是关了窗口。
      // 仓库既有写法同此（page.tsx 新增曲子弹窗、create-schedule-modal.tsx）。
      // 分析阶段仍可关（那是「取消分析」的正当出口）。
      closeOnOverlay={phase !== "uploading"}
    >
      <div className="flex flex-1 min-h-0 flex-col gap-4">
        {phase === "select" && (
          <>
            <div
              className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.zip"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />
              <p className="text-text-muted">点击选择文件</p>
              <p className="text-sm text-text-muted mt-1">支持 PDF 或 ZIP（自动解压）</p>
            </div>

            {files.length > 0 && (
              <>
                <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
                  {files.map((f, i) => (
                    <div
                      key={i}
                      className="bg-card border border-border rounded-lg px-3 py-2 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-text truncate">{f.originalName}</p>
                          <p className={`text-xs ${statusColor(f.status)}`}>{statusText(f)}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                        className="p-1 text-text-muted hover:text-danger"
                        title="移除"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end gap-3">
                  <button onClick={onClose} className="px-4 py-2 text-text-muted hover:text-text">
                    取消
                  </button>
                  <button
                    onClick={startAnalysis}
                    disabled={files.length === 0}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
                  >
                    开始分析 ({files.length} 个文件)
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {/*
         * 单一列表，**按行状态驱动**而不是按阶段切换。
         *
         * 原先「分析中」与「确认」是两个几乎相同的块，编辑 UI 只长在后者里 ——
         * 于是用户必须等**全部**文件跑完才能改任何一个。现在两者合并：某个文件
         * 一分析完（status 变 "analyzed"）它那一行的输入框就出现，不必等其余的。
         */}
        {phase !== "select" && (
          <>
            {/* flex-1 min-h-0：全屏层里列表吃掉剩余高度、自己滚；页脚固定在底部 */}
            <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
              {files.map((f, i) => (
                <div key={i} className="bg-card border border-border rounded-lg overflow-hidden">
                  <div className="px-3 py-2 space-y-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {hasDetails(f) ? (
                        <button
                          onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                          className="shrink-0 text-text-muted hover:text-text"
                        >
                          {expandedIdx === i ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </button>
                      ) : (
                        <span className="w-4 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-text truncate">{f.originalName}</p>
                        <p className={`text-xs ${statusColor(f.status)}`}>{statusText(f)}</p>
                      </div>
                      {f.status === "analyzing" && (
                        <span className="shrink-0 animate-spin text-primary">⏳</span>
                      )}
                    </div>

                    {/* 只要这一行**有识别结果**就渲染编辑器，不只是 analyzed：
                        上传失败的行同样需要能改（否则名字打错一次就把该行钉死，
                        只能关掉弹窗重来）。用 `instrumentGuess !== undefined` 区分
                        「分析过」与「分析本身就失败了」——后者没有可编辑的内容。 */}
                    {(f.status === "analyzed" || f.status === "error") &&
                      f.instrumentGuess !== undefined && (
                        <div className="space-y-1.5 pl-5 border-l border-border">
                          {/* ⚠️ `flex-wrap` 是必需的：这一行 7 个元素**全部 `shrink-0`**，
                              而卡片是 `overflow-hidden` —— 不换行时窄屏上右边的控件会被裁掉
                              且**滚不到**（实测 448px 下输入框与「重置」按钮就在卡片外）。
                              允许换行后窄屏会折成两行，内容始终可达。 */}
                          <div className="flex flex-wrap items-center gap-0.5">
                            <label className="text-xs text-text-muted w-12 shrink-0">声部</label>
                            {/* 声部按契约是**闭集**，所以用 select 而不是自由文本 ——
                                否则用户能凭空造出一个声部名写进 `parts.section`
                                （那是详情页分组与排序的依据），而后端的闭集校验对
                                用户手输这一层管不着。后端返回的值若不在闭集里，临时补一个
                                选项把它显示出来：词表漂移依然看得见、也依然改得掉。 */}
                            <select
                              value={f.sectionEdit ?? f.sectionGuess ?? OTHER_INSTRUMENT_GROUP}
                              onChange={(e) => handleSectionChange(i, e.target.value)}
                              disabled={phase === "uploading"}
                              className="px-1.5 py-0.5 text-sm bg-muted border border-border rounded w-26 shrink-0 disabled:opacity-50"
                            >
                              {!isKnownSection(f.sectionEdit ?? f.sectionGuess ?? "") && (
                                <option value={f.sectionEdit ?? f.sectionGuess ?? ""}>
                                  {f.sectionEdit ?? f.sectionGuess}（非标准）
                                </option>
                              )}
                              {INSTRUMENT_ORDER.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                              <option value={OTHER_INSTRUMENT_GROUP}>
                                {OTHER_INSTRUMENT_GROUP}
                              </option>
                            </select>
                            <label className="text-xs text-text-muted w-12 shrink-0 ml-1">
                              乐器
                            </label>
                            <input
                              type="text"
                              value={f.instrumentEdit ?? f.instrumentGuess ?? ""}
                              onChange={(e) => handleInstrumentChange(i, e.target.value)}
                              placeholder="乐器名"
                              disabled={phase === "uploading"}
                              className="px-1.5 py-0.5 text-sm bg-muted border border-border rounded w-26 shrink-0 disabled:opacity-50"
                            />
                            <label className="text-xs text-text-muted w-12 shrink-0 ml-1">
                              分声部
                            </label>
                            <input
                              type="text"
                              value={f.subPartsEditText ?? formatSubParts(f.subPartsGuess ?? [])}
                              onChange={(e) => handleSubPartsChange(i, e.target.value)}
                              placeholder="号，如 1,2"
                              disabled={phase === "uploading"}
                              className="px-1.5 py-0.5 text-sm bg-muted border border-border rounded w-16 shrink-0 disabled:opacity-50"
                            />
                            {/* 「没有号」——**逃生口**，只在模型给了号却没读懂时出现。
                                没有它的话 uploadBlocker 那道拦截会把人锁死：那种状态下
                                「确实没有分声部」只能靠清空输入框表达，而框本来就空着、
                                用户没有任何操作能表达这个意思。点它 = 显式表态（置成空串）。
                                ⚠️ 三个条件缺一不可，且必须与 `uploadBlocker` 的 `subPartsUnread`
                                **完全同源**。漏掉 `guess 为空` 会让按钮出现在**有号**的行上
                                （小提琴声部推导补出 [1]/[2] 时就是这样，且旁边没有任何提示），
                                点一下就把那个号静默抹掉 —— 与「消灭静默丢号」正好相反。 */}
                            {f.subPartsRaw &&
                              f.subPartsEditText === undefined &&
                              (f.subPartsGuess ?? []).length === 0 && (
                                <button
                                  onClick={() => updateFile(i, { subPartsEditText: "" })}
                                  disabled={phase === "uploading"}
                                  className="px-1.5 py-0.5 text-xs text-text-muted border border-border rounded shrink-0 hover:text-primary disabled:opacity-50"
                                  title="这份谱子确实没有分声部"
                                >
                                  没有号
                                </button>
                              )}
                            <button
                              onClick={() =>
                                updateFile(i, {
                                  sectionEdit: f.sectionGuess ?? OTHER_INSTRUMENT_GROUP,
                                  instrumentEdit: f.instrumentGuess ?? "",
                                  // 清掉**编辑痕迹**（`undefined` = 回到识别结果）。
                                  // 与上面两个字段写法不同是有意的：它们存的是值，
                                  // 分声部存的是「原文 + 有没有被编辑过」这个二元状态，
                                  // 置成 Guess 的值会把「没编辑过」这个信息抹掉。
                                  subPartsEditText: undefined,
                                })
                              }
                              disabled={phase === "uploading"}
                              className="p-1 text-text-muted hover:text-primary shrink-0 disabled:opacity-50"
                              title="重置为识别结果"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                          {sectionWarning(f) && (
                            <p className="text-xs text-warning">{sectionWarning(f)}</p>
                          )}
                          {subPartsNotice(f) && (
                            <p className="text-xs text-warning">{subPartsNotice(f)}</p>
                          )}
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-text-muted">路径：</span>
                            {previewPath(f) ? (
                              <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono break-all">
                                {previewPath(f)}
                              </code>
                            ) : (
                              <span className="text-xs text-text-muted">填写乐器名后显示</span>
                            )}
                          </div>

                          {/* 分段（#290 Step 1）：只在**多页、非总谱**的文件上出现。
                              边界用「段的起始页」表达 —— 用户改这个数就等于拖动边界，
                              而**不重跑 OCR**（逐页窄带文本留在 pageTexts 里）。
                              段内的乐器/分声部**不在这里编辑**：切分之后每一段会各自成为
                              一行，用的还是上面那套编辑器（同一件事不造两套界面）。 */}
                          {segEligible(f) && (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-xs text-text-muted">分段：</span>
                                {f.segState === "running" && (
                                  <span className="text-xs text-text-muted">
                                    识别中…（{f.pageCount} 页，消耗 {f.pageCount} 次 OCR）
                                  </span>
                                )}
                                {f.segState === "error" && (
                                  <span className="text-xs text-danger">失败：{f.segError}</span>
                                )}
                                {f.segState === undefined && (
                                  <span className="text-xs text-text-muted">
                                    未识别（{f.pageCount} 页）—— 点左下角「识别分段」
                                  </span>
                                )}
                                {f.segState === "done" && (
                                  <span className="text-xs text-text-muted">
                                    共 {segmentsOf(f).length} 段 —— 段的起始页可改
                                  </span>
                                )}
                              </div>
                              {f.segState === "done" && (
                                <ul className="space-y-0.5">
                                  {segmentsOf(f).map((seg, si) => (
                                    <li key={si} className="flex items-center gap-1.5 text-xs">
                                      <span className="text-text-muted shrink-0 w-14">
                                        第 {si + 1} 段
                                      </span>
                                      {si === 0 ? (
                                        <span className="text-text-muted w-16 shrink-0">
                                          第 1 页起
                                        </span>
                                      ) : (
                                        <input
                                          type="number"
                                          min={2}
                                          max={f.pageCount}
                                          value={seg.from}
                                          onChange={(e) =>
                                            setSegmentStart(i, si, Number(e.target.value))
                                          }
                                          className="w-16 px-1.5 py-0.5 text-xs bg-muted border border-border rounded shrink-0"
                                          disabled={phase === "uploading"}
                                        />
                                      )}
                                      <span className="text-text-muted">– 第 {seg.to} 页</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}
                          {!(f.instrumentEdit ?? f.instrumentGuess ?? "").trim() && (
                            <p className="text-xs text-warning">未识别出乐器，请先填写再上传</p>
                          )}
                          {/* 拦截提示与上传失败原因都落在这里 —— 行状态可能仍是 analyzed */}
                          {f.error && <p className="text-xs text-danger">{f.error}</p>}
                        </div>
                      )}
                  </div>

                  {expandedIdx === i && hasDetails(f) && (
                    <div className="border-t border-border px-3 py-2 text-xs space-y-2 bg-muted/30">
                      {f.preview && (
                        <div>
                          <span className="font-medium text-text-muted">
                            送检图像{f.sourcePage ? `（第 ${f.sourcePage} 页）` : ""}：
                          </span>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={f.preview}
                            alt="送去 OCR 的图像"
                            className="mt-1 w-40 border border-border rounded"
                          />
                        </div>
                      )}
                      {f.cropNote && <p className="text-text-muted">{f.cropNote}</p>}
                      {f.warning && <p className="text-warning">{f.warning}</p>}
                      {f.ocrText && (
                        <div>
                          <span className="font-medium text-text-muted">OCR 文本：</span>
                          <pre className="mt-1 p-2 bg-muted border border-border rounded text-text max-h-24 overflow-y-auto whitespace-pre-wrap break-all">
                            {f.ocrText}
                          </pre>
                        </div>
                      )}
                      {f.llmResult && (
                        <div>
                          <span className="font-medium text-text-muted">LLM 结果：</span>
                          <p className="mt-1 text-text">{f.llmResult}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-border">
              {/* 分段**不自动跑**：一份 N 页的合订谱要烧 N 次 OCR，而免费档是 500 次/天/IP。
                  所以这个按钮把代价写在脸上（#290 验收标准：调用次数在导入前可见）。 */}
              {segTargets.length > 0 && !allDone && (
                <button
                  onClick={startSegmentation}
                  disabled={phase === "analyzing" || phase === "uploading"}
                  className="mr-auto px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted disabled:opacity-50"
                  title="合订谱里可能装着好几份分谱。识别出边界后可以逐段确认、再切分上传。"
                >
                  {segTargets.some((f) => f.segState === "running")
                    ? "识别分段中..."
                    : `识别分段（${segTargets.length} 份，消耗 ${segCost} 次 OCR）`}
                </button>
              )}
              <button onClick={onClose} className="px-4 py-2 text-text-muted hover:text-text">
                {phase === "analyzing" ? "取消分析" : "取消"}
              </button>
              {/* 分析期间就把「确认上传」显示出来、但禁用：让用户看得见终点在哪、
                  还差几个文件，而不是对着一个转圈图标猜还要等多久。 */}
              {phase === "uploading" ? (
                <button
                  disabled
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg opacity-50"
                >
                  上传中...
                </button>
              ) : allDone ? (
                // 干完了就给一个**正向出口**：全部传完后还显示禁用的「确认上传（0/N）」
                // 会让用户以为没成功，而唯一能点的是「取消」。
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90"
                >
                  完成（已上传 {doneCount} 个）
                </button>
              ) : (
                <button
                  onClick={confirmUpload}
                  disabled={phase === "analyzing" || uploadableCount === 0 || hasAnalyzingFiles}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
                >
                  确认上传（{uploadableCount}/{files.length}）
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
