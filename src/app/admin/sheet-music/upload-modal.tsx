"use client";

import { useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { supabase } from "@/lib/supabase";
import { INSTRUMENT_ORDER, OTHER_INSTRUMENT_GROUP } from "@/constants/instruments";
import type { PDFPageProxy } from "pdfjs-dist";
import {
  decideTitleCrop,
  findFirstStaffLine,
  rowLongestRun,
  type CropDecision,
} from "./staff-line";

/**
 * 乐器名现在是**开放集**：后端 llm-analyze 直接返回中文（`木琴` / `英国管` /
 * `低音单簧管`…），不再走「英文字典 → 中文」的映射。
 *
 * 原先那张 `INSTRUMENT_CN_MAP` 已删除 —— 它是开放集合的映射，每来一个新乐器就要
 * 加一行，而新乐器是无限的，注定追不上（它把 Bassoon 译成「巴松管」，与项目标准
 * 的「大管」冲突，就是这个割裂的产物）。
 */

/**
 * 文件名：`{乐器名}[_{subPart}].pdf`。**声部不进文件名，它是目录**（见 pathOf）。
 * 例：`打击乐/木琴.pdf`、`圆号/圆号_1.pdf`、`第一小提琴/小提琴_1.pdf`。
 * 同名冲突由 subPart 后缀解决，重传靠 upsert 覆盖。
 */
function generateFileName(instrument: string, subPart: number | null): string {
  const base = instrument.trim();
  if (subPart !== null && subPart > 0) return `${base}_${subPart}.pdf`;
  return `${base}.pdf`;
}

/** 存储路径：声部做目录，文件名干净。 */
function pathOf(
  scoreId: string,
  section: string,
  instrument: string,
  subPart: number | null,
): string {
  return `${scoreId}/${section}/${generateFileName(instrument, subPart)}`;
}

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
function analysisSummary(section: string, instrument: string, subPart: number | null): string {
  if (!instrument) return "需人工确认（未识别出乐器）";
  const sub = subPart !== null && subPart > 0 ? ` ${subPart}` : "";
  return `识别结果: ${section} / ${instrument}${sub}`;
}

interface UploadFile {
  file: File;
  originalName: string; // 原始文件名，展示用；上传文件名由 generateFileName 生成
  status: "pending" | "analyzing" | "analyzed" | "uploading" | "done" | "error";
  error?: string;
  /** 声部（闭集，写进 sheet_music_parts.section，也是存储路径的目录） */
  sectionGuess?: string;
  sectionEdit?: string;
  /** 中文乐器名（开集，写进 sheet_music_files.instrument，也是文件名主干的来源） */
  instrumentGuess?: string;
  instrumentEdit?: string;
  subPartGuess?: number | null;
  subPartEdit?: number | null;
  ocrText?: string;
  llmResult?: string;
  preview?: string; // 实际送去 OCR 的那张图的缩略图（排查用）
  sourcePage?: number; // 取的是第几页
  warning?: string; // 非致命问题（某页图像解码失败、OCR 失败等），不影响继续靠文件名识别
  cropNote?: string; // 裁切决策回显（裁到哪 / 为什么没裁），排查「切错位置」用
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
const LLM_TIMEOUT_MS = 30000;

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
 * 乐器识别：文件名作为一行证据，和 OCR 文本一起交给 LLM。
 * 出版社扫描分谱的乐器名往往就写在文件名里（PMLASIA01165-13-Horn_2.pdf），
 * 而它们的页面常是扫描乐谱、OCR 读出来是乱的 —— 这种情况下文件名比 OCR 可靠得多。
 * 后端 llm-analyze 只接受 text/ocr_text 字段，因此这里合并成一段文本发送。
 */
interface LlmAnalysis {
  section: string;
  instrument: string;
  subPart: number | null;
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
      subPart: data.subPart ?? null,
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
  // 循环还在跑：updateFile 变成 no-op，用户看不见进度、重开是全新空状态，OCR 配额却照烧 ——
  // 最坏 20 个文件能在后台持续请求半小时以上。卸载时置位，循环每轮开头检查后退出。
  const cancelledRef = useRef(false);
  // 防重复提交：ref 同步阻断竞态窗口（setState 是异步的，两次快速点击之间 phase 仍是旧值）
  const analyzingRef = useRef(false);
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

  const startAnalysis = async () => {
    if (analyzingRef.current) return;
    analyzingRef.current = true;
    setPhase("analyzing");
    cancelledRef.current = false;

    // 单轮串行：每个文件依次走「取页 → OCR → LLM」，每步只更新自己那一行。
    // 注意 files 是点击那一刻的快照，循环中 updateFile 不会改到它——只用它决定处理哪些文件，
    // 不要用它判断处理进度（上一版据此判断，导致永远进不了确认阶段）。
    for (let i = 0; i < files.length; i++) {
      // 弹窗被关掉就尽快收手：每轮开头检查一次，最坏多做当前这一个文件
      if (cancelledRef.current) {
        analyzingRef.current = false;
        return;
      }
      if (files[i].status !== "pending") continue;

      updateFile(i, { status: "analyzing", ocrText: "正在提取页面...", llmResult: "" });

      // 取页与 OCR 都是「能给就给」：失败不终止，退化成只用文件名让 LLM 判断
      let ocrText = "";
      let warning = "";
      let rendered: RenderedPage | null = null;
      let usedFullPage = false;

      try {
        rendered = await renderFirstContentPage(files[i].file);
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
        let analysis = await runLlmAnalysis(files[i].originalName, ocrText);

        // 识别不出时回退整页 OCR 再判一次：裁切条只含首页标题区，
        // 乐器名未必落在那里。空串是后端约定的「未识别」——
        // 它把「证据不足」和模型答「unknown / 无法判断」都收敛成了空串。
        if (!analysis.instrument && rendered?.cropped && !usedFullPage) {
          const { fullBase64, fullPreview, preview, cropNote } = rendered;
          usedFullPage = true;
          try {
            updateFile(i, { llmResult: "未能识别，回退整页 OCR 重试..." });
            ocrText = await runOcr(fullBase64);
            analysis = await runLlmAnalysis(files[i].originalName, ocrText);
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

        const { section, instrument, subPart } = analysis;
        // 未识别时**不预填** instrumentEdit（留空串）：预填一个猜测值会被用户直接
        // 接受，等于把错误洗成「已确认」。空的输入框会逼用户做一次真实判断。
        updateFile(i, {
          status: "analyzed",
          llmResult: analysisSummary(section, instrument, subPart),
          sectionGuess: section,
          sectionEdit: section,
          instrumentGuess: instrument,
          instrumentEdit: instrument,
          subPartGuess: subPart,
          subPartEdit: subPart,
        });
      } catch (err) {
        updateFile(i, {
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // 避免 LLM/OCR 限流，同时让出主线程刷新进度
      if (i < files.length - 1) await sleep(800);
    }

    analyzingRef.current = false;
    if (cancelledRef.current) return;
    setPhase("confirm");
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

  const handleInstrumentChange = (index: number, value: string) => {
    updateFile(index, { instrumentEdit: value });
  };

  const handleSectionChange = (index: number, value: string) => {
    updateFile(index, { sectionEdit: value });
  };

  const handleSubPartChange = (index: number, value: string) => {
    const num = value === "" ? null : parseInt(value, 10);
    updateFile(index, { subPartEdit: isNaN(num as number) ? null : num });
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

      for (let i = 0; i < files.length; i++) {
        // 上传阶段点「取消」会卸载组件，这里要及时收手：
        // 否则剩余文件照样写 storage + DB，用户以为取消了其实照传不误
        if (cancelledRef.current) return;

        const uploadFile = files[i];
        // 只跳过已成功的：失败的行要允许重试，否则真实网络失败（storage/PG 返回 {error}
        // 而非抛错，是断网的默认路径）会把该文件在同一会话内永久钉死
        if (uploadFile.status === "done") continue;

        // 声部与乐器名分开取：声部是闭集（写进 parts.section，也是存储目录名），
        // 乐器名是开集（写进 files.instrument，也是文件名主干）
        const section = (uploadFile.sectionEdit ?? uploadFile.sectionGuess ?? "").trim();
        const instrument = (uploadFile.instrumentEdit ?? uploadFile.instrumentGuess ?? "").trim();
        // 用 undefined 判断而不是 ??：用户把分声部清空时 subPartEdit 是 null，
        // 用 ?? 会被 subPartGuess 悄悄捡回来，导致「清不掉」
        const subPart =
          uploadFile.subPartEdit !== undefined
            ? uploadFile.subPartEdit
            : (uploadFile.subPartGuess ?? null);

        // 这里也把 `?? ` 而不是 `||` 用在 instrument 上：用户主动清空输入框时
        // 不该被 instrumentGuess 悄悄捡回来 —— 空乐器名必须**拦下**（后端的
        // 「未识别」正是空串），否则会建出一个没有名字的声部/文件。
        // 拦下，但**不改状态**。这两行缺的是用户补填，而编辑器只在有识别结果的行上
        // 渲染 —— 置成 error 会让输入框消失，界面变成「让你填却没有字段可填」，
        // 用户只能关掉弹窗、连带丢掉整批已经烧掉 OCR 配额的分析结果。
        if (!instrument || !section) {
          updateFile(i, {
            error: !instrument ? "未识别的乐器名，请先填写再上传" : "未指定声部，请先填写再上传",
          });
          continue;
        }
        // 这一行能往下走了，把上一次的拦截/失败提示清掉，免得文案留在界面上说谎
        updateFile(i, { error: undefined });

        updateFile(i, { status: "uploading" });

        const partId = await getOrCreatePart(section);
        if (!partId) {
          updateFile(i, { status: "error", error: "创建声部失败" });
          continue;
        }

        const generatedFileName = generateFileName(instrument, subPart);
        const filePath = pathOf(scoreId, section, instrument, subPart);
        const { error: uploadError } = await supabase.storage
          .from("sheet-music")
          .upload(filePath, uploadFile.file, { contentType: "application/pdf", upsert: true });

        if (uploadError) {
          updateFile(i, { status: "error", error: uploadError.message });
          continue;
        }

        const { error: dbError } = await supabase.from("sheet_music_files").insert({
          part_id: partId,
          storage_path: filePath,
          file_name: generatedFileName,
          // 乐器名单独存一列，与派生出的文件名分开 —— 便于区分
          // 「LLM 答错」与「文件名生成错」
          instrument,
          file_size: uploadFile.file.size,
          uploaded_by: user.id,
        });

        if (dbError) {
          updateFile(i, { status: "error", error: dbError.message });
          continue;
        }

        updateFile(i, { status: "done", instrumentGuess: instrument });
        hasSuccess = true;
      }
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
    // 取 Edit 优先的值：用户清空分声部后，行文案必须与文件名预览、落库结果一致，
    // 否则用户会以为「清空没生效」。用 `??` 而不是 `||` —— 主动清空乐器名时
    // 不该被 Guess 悄悄捡回来。
    const section = f.sectionEdit ?? f.sectionGuess ?? "";
    const instrument = f.instrumentEdit ?? f.instrumentGuess ?? "";
    const subPart = f.subPartEdit !== undefined ? f.subPartEdit : f.subPartGuess;
    const sub = subPart !== null && subPart !== undefined && subPart > 0 ? ` ${subPart}` : "";
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
  // 是否有已分析成功的文件（用于启用确认按钮）
  const hasAnalyzedFiles = files.some((f) => f.status === "analyzed");
  // 已分析完的数量，用于在按钮上显示进度（分析期间按钮是禁用的，见页脚）
  const analyzedCount = files.filter((f) => f.status === "analyzed").length;

  return (
    // 用全屏层而不是默认的底部弹窗：20 个文件的结果 + 每行的三个输入框，
    // 底部弹窗装不下（原先列表只有 max-h-80，剩下的全靠页面自己滚）。
    <Modal open={open} onClose={onClose} title="上传乐谱文件" position="fullscreen">
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
                          <div className="flex items-center gap-0.5">
                            <label className="text-xs text-text-muted w-12 shrink-0">声部</label>
                            <input
                              type="text"
                              value={f.sectionEdit ?? f.sectionGuess ?? ""}
                              onChange={(e) => handleSectionChange(i, e.target.value)}
                              placeholder="声部名"
                              className="px-1.5 py-0.5 text-sm bg-muted border border-border rounded w-26 shrink-0"
                            />
                            <label className="text-xs text-text-muted w-12 shrink-0 ml-1">
                              乐器
                            </label>
                            <input
                              type="text"
                              value={f.instrumentEdit ?? f.instrumentGuess ?? ""}
                              onChange={(e) => handleInstrumentChange(i, e.target.value)}
                              placeholder="乐器名"
                              className="px-1.5 py-0.5 text-sm bg-muted border border-border rounded w-26 shrink-0"
                            />
                            <label className="text-xs text-text-muted w-12 shrink-0 ml-1">
                              分声部
                            </label>
                            <input
                              type="text"
                              value={
                                f.subPartEdit !== null && f.subPartEdit !== undefined
                                  ? String(f.subPartEdit)
                                  : ""
                              }
                              onChange={(e) => handleSubPartChange(i, e.target.value)}
                              placeholder="号"
                              className="px-1.5 py-0.5 text-sm bg-muted border border-border rounded w-8 shrink-0"
                              inputMode="numeric"
                              pattern="[0-9]*"
                            />
                            <button
                              onClick={() =>
                                updateFile(i, {
                                  sectionEdit: f.sectionGuess ?? OTHER_INSTRUMENT_GROUP,
                                  instrumentEdit: f.instrumentGuess ?? "",
                                  subPartEdit: f.subPartGuess,
                                })
                              }
                              className="p-1 text-text-muted hover:text-primary shrink-0"
                              title="重置为识别结果"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                          {sectionWarning(f) && (
                            <p className="text-xs text-warning">{sectionWarning(f)}</p>
                          )}
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-text-muted">路径：</span>
                            <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono break-all">
                              {pathOf(
                                scoreId,
                                (f.sectionEdit ?? f.sectionGuess ?? "").trim(),
                                (f.instrumentEdit ?? f.instrumentGuess ?? "").trim(),
                                f.subPartEdit !== undefined
                                  ? f.subPartEdit
                                  : (f.subPartGuess ?? null),
                              )}
                            </code>
                          </div>
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
              ) : (
                <button
                  onClick={confirmUpload}
                  disabled={phase === "analyzing" || !hasAnalyzedFiles || hasAnalyzingFiles}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
                >
                  确认上传（{analyzedCount}/{files.length}）
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
