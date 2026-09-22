"use client";

import { useState, useRef } from "react";
import JSZip from "jszip";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { supabase } from "@/lib/supabase";
import type { PDFPageProxy } from "pdfjs-dist";

// 英文乐器名 -> 中文映射（用于显示和文件名）
const INSTRUMENT_CN_MAP: Record<string, string> = {
  Violin: "小提琴",
  Viola: "中提琴",
  Cello: "大提琴",
  Contrabass: "低音提琴",
  Flute: "长笛",
  Piccolo: "短笛",
  Oboe: "双簧管",
  Clarinet: "单簧管",
  Bassoon: "巴松管",
  Contrabassoon: "倍巴松管",
  Horn: "圆号",
  Trumpet: "小号",
  Trombone: "长号",
  Tuba: "大号",
  Percussion: "打击乐",
  Timpani: "定音鼓",
  Drums: "鼓",
  Triangle: "三角铁",
  Cymbals: "钹",
  Piano: "钢琴",
  Celesta: "钢片琴",
  Harp: "竖琴",
  Guitar: "吉他",
};

// 小提琴特殊处理：1声部=第一小提琴，2声部=第二小提琴
const VIOLIN_PART_CN: Record<number, string> = {
  1: "第一小提琴",
  2: "第二小提琴",
};

function toCn(inst: string): string {
  return INSTRUMENT_CN_MAP[inst] || inst;
}

function generateFileName(instrument: string, subPart: number | null): string {
  // 小提琴特殊处理
  if (instrument === "Violin" && subPart !== null && subPart > 0) {
    return `${VIOLIN_PART_CN[subPart] || `小提琴_${subPart}`}.pdf`;
  }
  const base = toCn(instrument).trim();
  if (subPart !== null && subPart > 0) {
    return `${base}_${subPart}.pdf`;
  }
  return `${base}.pdf`;
}

interface UploadFile {
  file: File;
  originalName: string; // 原始文件名，展示用；上传文件名由 generateFileName 生成
  status: "pending" | "analyzing" | "analyzed" | "uploading" | "done" | "error";
  error?: string;
  instrumentGuess?: string;
  instrumentEdit?: string;
  subPartGuess?: number | null;
  subPartEdit?: number | null;
  ocrText?: string;
  llmResult?: string;
  preview?: string; // 实际送去 OCR 的那张图的缩略图（排查用）
  sourcePage?: number; // 取的是第几页
  warning?: string; // 非致命问题（某页图像解码失败、OCR 失败等），不影响继续靠文件名识别
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
function hasVisibleContent(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const { data } = ctx.getImageData(0, 0, width, height);
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

async function renderPageToJpeg(page: PDFPageProxy): Promise<{
  base64: string;
  preview: string;
  blank: boolean;
  imageOps: number;
  width: number;
  height: number;
}> {
  const pdfjs = await loadPdfJs();
  const unscaled = page.getViewport({ scale: 1 });
  const scale = Math.min(
    OCR_MAX_SCALE,
    Math.max(1, OCR_TARGET_LONGEST_SIDE / Math.max(unscaled.width, unscaled.height)),
  );
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建 canvas 上下文");

  try {
    // 页面不一定会自绘白色背景，而透明像素编码成 JPEG 会合成到黑底上（黑底黑字 OCR 读不出），先铺白
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // v6 的 RenderParameters 必须带 canvas（canvasContext 单独传不够）
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;

    const blank = !hasVisibleContent(ctx, canvas.width, canvas.height);
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

    const preview = makePreview(canvas);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", OCR_JPEG_QUALITY),
    );
    if (!blob) throw new Error("页面转 JPEG 失败");
    return {
      base64: await blobToBase64(blob),
      preview,
      blank,
      imageOps,
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    // 释放 canvas 后备存储（scale 3 的一页约 20MB），避免批量处理时累积占用
    canvas.width = 0;
    canvas.height = 0;
  }
}

interface RenderedPage {
  base64: string;
  preview: string;
  pageNo: number;
  warning: string;
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
        return { base64: result.base64, preview: result.preview, pageNo, warning };
      }
      preview = result.preview || preview;
      warning =
        result.imageOps > 0
          ? `第 ${pageNo} 页含图像但渲染为空 —— 图像解码失败（JBIG2/JPX 需要 /pdfjs/wasm 资源）`
          : `第 ${pageNo} 页无内容`;
    }

    return { base64: "", preview, pageNo: 0, warning };
  } finally {
    // 释放整个文档与 worker，每份文件的内存不跨轮次累积
    await task.destroy();
  }
}

/**
 * Edge Function 返回非 2xx 时，functions.invoke 会返回 { data: null, error }，
 * 真实错误体挂在 error.context（Response）上——不读它就会把服务端的报错吞掉。
 */
async function invokeErrorDetail(error: unknown): Promise<string> {
  const ctx = (error as { context?: unknown }).context;
  if (ctx instanceof Response) {
    const status = `HTTP ${ctx.status}`;
    try {
      const body = (await ctx.clone().json()) as { error?: string } | null;
      return body?.error ? `${body.error}（${status}）` : `${JSON.stringify(body)}（${status}）`;
    } catch {
      try {
        const text = await ctx.clone().text();
        return text ? `${text}（${status}）` : status;
      } catch {
        return status;
      }
    }
  }
  return error instanceof Error ? error.message : String(error);
}

/** base64 长度换算回实际图片字节数 */
function base64Kb(base64: string): number {
  return Math.round(((base64.length * 3) / 4 / 1024) * 10) / 10;
}

// OCR.space 偶发 E502/E503 之类服务端引擎错误（实测 33 次里出现 1 次），重试即可
const OCR_RETRY_DELAYS = [1200, 3500];
const OCR_TRANSIENT = /E5\d\d|HTTP 5\d\d|timeout|Failed to fetch/i;

/** 首页图片交给 ocr-analyze 转发 OCR.space；瞬时错误自动重试，最终失败抛错并带上体积便于排查 */
async function runOcr(imageBase64: string): Promise<string> {
  const kb = base64Kb(imageBase64);
  let lastError = "";

  for (let attempt = 0; attempt <= OCR_RETRY_DELAYS.length; attempt++) {
    if (attempt > 0) await sleep(OCR_RETRY_DELAYS[attempt - 1]);

    const { data, error } = await supabase.functions.invoke("ocr-analyze", {
      body: { file_base64: imageBase64, mime_type: "image/jpeg" },
    });

    if (error) {
      lastError = await invokeErrorDetail(error);
      if (OCR_TRANSIENT.test(lastError) && attempt < OCR_RETRY_DELAYS.length) continue;
      throw new Error(`OCR 请求失败（首页图 ${kb}KB）: ${lastError}`);
    }
    if (data?.success && data.text) return data.text as string;

    // 服务端 200 但没文字：这张图确实没有可读文本，重试无意义
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
async function runLlmAnalysis(
  fileName: string,
  ocrText: string,
): Promise<{ instrument: string; subPart: number | null }> {
  const input = [`文件名: ${fileName}`];
  if (ocrText) input.push(`OCR 文本: ${ocrText}`);

  const { data, error } = await supabase.functions.invoke("llm-analyze", {
    body: { ocr_text: input.join("\n") },
  });
  if (error) {
    throw new Error(`LLM 请求失败: ${await invokeErrorDetail(error)}`);
  }
  if (data?.success) {
    return { instrument: String(data.instrument), subPart: data.subPart ?? null };
  }
  throw new Error(`LLM 分析失败: ${data?.error || data?.message || "未知错误"}`);
}

export function UploadModal({ open, onClose, scoreId, onUploaded }: UploadModalProps) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [phase, setPhase] = useState<"select" | "analyzing" | "confirm" | "uploading">("select");
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    setPhase("analyzing");

    // 单轮串行：每个文件依次走「取页 → OCR → LLM」，每步只更新自己那一行。
    // 注意 files 是点击那一刻的快照，循环中 updateFile 不会改到它——只用它决定处理哪些文件，
    // 不要用它判断处理进度（上一版据此判断，导致永远进不了确认阶段）。
    for (let i = 0; i < files.length; i++) {
      if (files[i].status !== "pending") continue;

      updateFile(i, { status: "analyzing", ocrText: "正在提取页面...", llmResult: "" });

      // 取页与 OCR 都是「能给就给」：失败不终止，退化成只用文件名让 LLM 判断
      let ocrText = "";
      let warning = "";

      try {
        const rendered = await renderFirstContentPage(files[i].file);
        warning = rendered.warning;
        updateFile(i, {
          preview: rendered.preview || undefined,
          sourcePage: rendered.pageNo || undefined,
          warning: warning || undefined,
        });

        if (rendered.base64) {
          updateFile(i, { ocrText: `已取第 ${rendered.pageNo} 页，正在 OCR...` });
          ocrText = await runOcr(rendered.base64);
          updateFile(i, { ocrText });
        } else {
          updateFile(i, { ocrText: warning });
        }
      } catch (err) {
        warning = err instanceof Error ? err.message : String(err);
        updateFile(i, { ocrText: warning, warning });
      }

      updateFile(i, { llmResult: "等待 LLM 分析..." });
      try {
        const { instrument, subPart } = await runLlmAnalysis(files[i].originalName, ocrText);
        const display = subPart !== null ? `${instrument} ${subPart}` : instrument;
        updateFile(i, {
          status: "analyzed",
          llmResult: `识别结果: ${display}`,
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

    setPhase("confirm");
  };

  const getOrCreatePart = async (instrument: string): Promise<string | null> => {
    const { data: existing } = await supabase
      .from("sheet_music_parts")
      .select("id")
      .eq("sheet_music_id", scoreId)
      .eq("instrument", instrument)
      .maybeSingle();

    if (existing) return existing.id;

    const { data: newPart, error } = await supabase
      .from("sheet_music_parts")
      .insert({ sheet_music_id: scoreId, instrument })
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

  const handleSubPartChange = (index: number, value: string) => {
    const num = value === "" ? null : parseInt(value, 10);
    updateFile(index, { subPartEdit: isNaN(num as number) ? null : num });
  };

  const confirmUpload = async () => {
    setPhase("uploading");
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      alert("请先登录");
      setPhase("confirm");
      return;
    }

    let hasSuccess = false;

    for (let i = 0; i < files.length; i++) {
      const uploadFile = files[i];
      if (uploadFile.status === "done" || uploadFile.status === "error") continue;

      const instrument = uploadFile.instrumentEdit || uploadFile.instrumentGuess;
      const subPart = uploadFile.subPartEdit ?? uploadFile.subPartGuess ?? null;

      if (!instrument) {
        updateFile(i, { status: "error", error: "未指定声部" });
        continue;
      }

      updateFile(i, { status: "uploading" });

      const partId = await getOrCreatePart(instrument);
      if (!partId) {
        updateFile(i, { status: "error", error: "创建声部失败" });
        continue;
      }

      const generatedFileName = generateFileName(instrument, subPart);
      const filePath = `${scoreId}/${instrument}/${generatedFileName}`;
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

    if (hasSuccess) onUploaded();
    setPhase("confirm");
  };

  const statusText = (f: UploadFile) => {
    const inst = toCn(f.instrumentGuess || "");
    const sub = f.subPartGuess !== null && f.subPartGuess !== undefined ? ` ${f.subPartGuess}` : "";
    switch (f.status) {
      case "pending":
        return "待分析";
      case "analyzing":
        return "分析中...";
      case "analyzed":
        return inst ? `已识别 → ${inst}${sub}` : "识别失败";
      case "uploading":
        return "上传中...";
      case "done":
        return inst ? `已上传 → ${inst}${sub}` : "已上传";
      case "error":
        return `失败: ${f.error}`;
    }
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

  const hasDetails = (f: UploadFile) => f.ocrText || f.llmResult || f.preview || f.warning;

  // 是否有文件正在分析中
  const hasAnalyzingFiles = files.some((f) => f.status === "analyzing");
  // 是否有已分析成功的文件（用于启用确认按钮）
  const hasAnalyzedFiles = files.some((f) => f.status === "analyzed");

  return (
    <Modal open={open} onClose={onClose} title="上传乐谱文件">
      <div className="space-y-4">
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
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {files.map((f, i) => (
                    <div
                      key={i}
                      className="bg-background border border-border rounded-lg px-3 py-2 flex items-center justify-between"
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

        {phase === "analyzing" && (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {files.map((f, i) => (
              <div
                key={i}
                className="bg-background border border-border rounded-lg overflow-hidden"
              >
                <div className="flex items-center justify-between px-3 py-2">
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
                  </div>
                  {f.status === "analyzing" && (
                    <span className="animate-spin text-primary">⏳</span>
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
                    {f.warning && <p className="text-warning">{f.warning}</p>}
                    {f.ocrText && (
                      <div>
                        <span className="font-medium text-text-muted">OCR 文本：</span>
                        <pre className="mt-1 p-2 bg-background border border-border rounded text-text max-h-24 overflow-y-auto whitespace-pre-wrap break-all">
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
        )}

        {(phase === "confirm" || phase === "uploading") && (
          <>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {files.map((f, i) => (
                <div
                  key={i}
                  className="bg-background border border-border rounded-lg overflow-hidden"
                >
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
                    </div>

                    {f.status === "analyzed" && (
                      <div className="space-y-1.5 pl-5 border-l border-border">
                        <div className="flex items-center gap-0.5">
                          <label className="text-xs text-text-muted w-12 shrink-0">乐器</label>
                          <input
                            type="text"
                            value={f.instrumentEdit || ""}
                            onChange={(e) => handleInstrumentChange(i, e.target.value)}
                            placeholder="乐器名"
                            className="px-1.5 py-0.5 text-sm bg-background border border-border rounded w-26 shrink-0"
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
                            placeholder="分声部号"
                            className="px-1.5 py-0.5 text-sm bg-background border border-border rounded w-8 shrink-0"
                            inputMode="numeric"
                            pattern="[0-9]*"
                          />
                          <button
                            onClick={() =>
                              updateFile(i, {
                                instrumentEdit: f.instrumentGuess || "",
                                subPartEdit: f.subPartGuess,
                              })
                            }
                            className="p-1 text-text-muted hover:text-primary shrink-0"
                            title="重置为识别结果"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-text-muted">预览：</span>
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                            {generateFileName(
                              f.instrumentEdit || f.instrumentGuess || "",
                              f.subPartEdit ?? f.subPartGuess ?? null,
                            )}
                          </code>
                        </div>
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
                      {f.warning && <p className="text-warning">{f.warning}</p>}
                      {f.ocrText && (
                        <div>
                          <span className="font-medium text-text-muted">OCR 文本：</span>
                          <pre className="mt-1 p-2 bg-background border border-border rounded text-text max-h-24 overflow-y-auto whitespace-pre-wrap break-all">
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
                取消
              </button>
              {phase === "confirm" && (
                <button
                  onClick={confirmUpload}
                  disabled={!hasAnalyzedFiles || hasAnalyzingFiles}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
                >
                  确认上传 ({files.filter((f) => f.status === "analyzed").length} 个文件)
                </button>
              )}
              {phase === "uploading" && (
                <button
                  disabled
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg opacity-50"
                >
                  上传中...
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
