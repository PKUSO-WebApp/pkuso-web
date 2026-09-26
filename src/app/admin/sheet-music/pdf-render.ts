import type { PDFPageProxy } from "pdfjs-dist";
import {
  decideTitleCrop,
  findFirstStaffLine,
  rowLongestRun,
  type CropDecision,
} from "./staff-line";
import { cropNoteOf } from "./row-text";
import type { RenderedPage } from "./upload-modal.types";

// pdf.js 的字体与图像解码资源（public/pdfjs 下，从 node_modules/pdfjs-dist 拷贝）。
// 缺了它们 pdf.js 不会报错，但会整页什么都不画：文本用未内嵌的标准字体、扫描件用 JBIG2/JPX 时命中。
// 升级 pdfjs-dist 时需要同步重新拷贝这三个目录。
export const PDFJS_ASSET_BASE = "/pdfjs/";

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

// 首页栅格化参数：约 216 DPI，再往上 OCR 收益很小、体积翻倍（OCR.space 免费档单文件 1MB）
export const OCR_MAX_SCALE = 3;
export const OCR_TARGET_LONGEST_SIDE = 2400;
export const OCR_JPEG_QUALITY = 0.8;

export function loadPdfJs(): Promise<typeof import("pdfjs-dist")> {
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

export function blobToBase64(blob: Blob): Promise<string> {
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

export async function renderPageToJpeg(page: PDFPageProxy): Promise<{
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

/**
 * 逐页取图，**由调用方决定走到第几页**（#297 的总谱分析）。
 *
 * ## 为什么不再「返回第一张有内容的页就收工」
 *
 * 早先这里的职责是「取首页、决定裁到哪」，读到第一张**非空白**页就返回。总谱分析把
 * 这个前提打破了：Egmont 那份总谱的第 1 页是扉页 —— **有墨、但页面上没有乐器名**，
 * 所以它既不是空白、又给不出结论，只看第一张有内容的页会永远停在扉页上。
 *
 * 于是「空白顺延」（原来在本函数里）与「这一页没给出结论、换下一页」（原来在
 * `analyzeOne`（在 `upload-modal.tsx`）里）**合并成同一个循环** —— 两者都是「这一页不算数」。拆成两层的话
 * 前者会先返回，后者根本没机会跑。这也正是 `escalate` 只能是一个开关的原因。
 *
 * 文档只打开一次（一份 1500 DPI 扫描件解析一次的开销不小），所以「页游走」必须发生在
 * 这个函数**内部** —— 这也是它收一个 `tryPage` 回调、而不是把页数组返回出去的原因。
 *
 * 不抛「全空白」错误：一页有内容的都没取到时调用方照样可以用文件名让 LLM 判断，
 * 原因通过 `warning` 带回界面（这类出版社扫描分谱常年踩 JBIG2 解码这一脚）。
 */
export async function renderPagesForAnalysis(
  file: File,
  opts: {
    /** 最多看几页（**含**空白页）。到顶就停，不管有没有结论 —— 这是配额的上界 */
    maxPages: number;
    /**
     * 出现结论就停；**关掉时「读完第一张有内容的页就走」**，也就是加总谱分析之前的行为。
     * 这一条是全部行为差异的所在，改它等于改配额（见 `analysis.ts` 的 `MAX_PAGES_EXAMINED`）。
     */
    escalate: boolean;
    /** 这一页能不能定论。true = 定了，不再往下看 */
    tryPage: (page: RenderedPage) => Promise<boolean>;
    /** 弹窗关掉就尽快收手。粒度必须是「页」：开了升级之后一份文件最多 6 次 OCR */
    isCancelled: () => boolean;
  },
): Promise<{
  pageCount: number;
  /** 定论落在第几页（1-based）；没定论时 null */
  settledPageNo: number | null;
  /** 最后一张**有内容**的页；一页都没有（全空白 / 渲染失败）时 null */
  contentPage: RenderedPage | null;
  warning: string;
}> {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({
    data,
    standardFontDataUrl: `${PDFJS_ASSET_BASE}standard_fonts/`,
    wasmUrl: `${PDFJS_ASSET_BASE}wasm/`,
    iccUrl: `${PDFJS_ASSET_BASE}iccs/`,
  });

  let pdf: Awaited<typeof task.promise>;
  try {
    // ⚠️ `await task.promise` 必须在 try **里面**（这里）：加载失败（坏 PDF / 加密 /
    // 资源缺失）时它会抛，抛在 try 外面就永远走不到 `destroy()` —— 真 worker 模式下
    // 每导入一个坏文件漏一个 worker 线程。实测：坏 PDF 时 `getDocument` 被调 1 次、
    // `destroy` 被调 0 次。`renderNarrowBands` 里同一句早先也是这个形态，已经改过；
    // 两处一致才不会漏。
    pdf = await task.promise;
  } catch (err) {
    try {
      await task.destroy();
    } catch {
      // 销毁本身失败没有下游依赖（fake worker 下泄漏的是可被 GC 的对象图）
    }
    // **不抛**：加载失败时旧版就是降级到「只凭文件名让 LLM 判断」，抛出去会让整行落
    // `error`，把一条本来就只剩文件名可用的路也堵死。`pageCount` 给 0（未知）—— 与旧版
    // `rendered === null` 时 `pageCount: undefined` 同效（`needsSegmentation` 对两者都判假），
    // 但类型上是确定的数，不必让 `undefined` 在链路上传。
    return {
      pageCount: 0,
      settledPageNo: null,
      contentPage: null,
      warning: `读取 PDF 失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 累积而不覆盖：几页都出问题时要能同时看到（见下面空白页那条）
  const warnings: string[] = [];
  let contentPage: RenderedPage | null = null;
  try {
    const pagesToTry = Math.min(opts.maxPages, pdf.numPages);

    for (let pageNo = 1; pageNo <= pagesToTry; pageNo++) {
      // ⚠️ 粒度是**页**，不是文件：开了升级之后一份文件最多 3 页 × 2 张图 = 6 次 OCR，
      // 而配额是照烧的。只在这个文件开头检查一次等于让「关掉弹窗」晚生效最多 6 次调用。
      if (opts.isCancelled()) break;

      let result: Awaited<ReturnType<typeof renderPageToJpeg>>;
      try {
        result = await renderPageToJpeg(await pdf.getPage(pageNo));
      } catch (err) {
        // 一页渲染失败 ≠ 整份失败：扫描件偶尔有一页解不出来（JBIG2/JPX 那一脚），
        // 而升级链存在的意义正是「这一页读不出就换下一页」。**这一层不能把异常放出去** ——
        // 放出去会让整行落 `error`（旧版这里是降级到「只凭文件名」），把用户手里
        // 其实还能用的那份 PDF 判死。
        warnings.push(
          `第 ${pageNo} 页渲染失败：${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }
      const page: RenderedPage = {
        base64: result.base64,
        fullBase64: result.fullBase64,
        preview: result.preview,
        fullPreview: result.fullPreview,
        pageNo,
        pageCount: pdf.numPages,
        cropNote: cropNoteOf(result.crop, result.cropped),
        cropped: result.cropped,
      };

      if (result.blank) {
        // **累积**而不是覆盖：早先是 `warning = …`，于是「第 1 页渲染失败」会被后面
        // 某一页的「第 2 页无内容」盖掉 —— 信息量更低的那条把更可行动的那条顶掉了。
        warnings.push(
          result.imageOps > 0
            ? `第 ${pageNo} 页含图像但渲染为空 —— 图像解码失败（JBIG2/JPX 需要 /pdfjs/wasm 资源）`
            : `第 ${pageNo} 页无内容`,
        );
        // 空白页**不算结论**，一律继续往下 —— 分支只有这一个，与升级链共用
        //（早先这层是「顺延」，与升级是两件事；现在它们是同一个循环的同一支）
        continue;
      }

      contentPage = page;
      // ⚠️ **只有 `tryPage` 里 LLM 那一步的异常会穿出这个函数**（取页/OCR 的异常在
      // `tryPage` 内部就兜住了，见那边的注释）。这不是疏漏，是刻意的分工：LLM 失败 =
      // 「这一行失败」，该落 `status: "error"` 让用户重试；而取页/OCR 失败 = 「这一页
      // 读不出」，该降级。旧版也是这个分工。
      if (await opts.tryPage(page)) {
        return {
          pageCount: pdf.numPages,
          settledPageNo: pageNo,
          contentPage: page,
          warning: warnings.join("；"),
        };
      }
      // 这一页读不出结论。**只有开了升级才往下一页走** —— 关着的时候「读完第一张有内容的
      // 页就走」（那是绝大多数分谱的路径）。
      //
      // ⚠️ 与加总谱分析**之前**的版本相比，关着开关时有两处**有意**的行为差异，都是
      // 「把某一页读不出当成没有结论」这条更一致的规则带来的：
      // 1. **渲染失败**（上面那支）现在会继续看下一页；旧版是整份降级成「只凭文件名」。
      //    「第 1 页解不出来、第 2 页好好的」在扫描件里是真实存在的，旧版放弃得太早。
      // 2. **OCR 失败**同理 —— 旧版把它抛穿成整份降级；现在只是这一页没结论
      //    （这条见 `tryPage` 里的注释）。
      // 其余路径（空白页顺延、裁切条 → 整页回退、OCR/LLM 次数、行状态）逐字相同。
      if (!opts.escalate) break;
    }

    return {
      pageCount: pdf.numPages,
      settledPageNo: null,
      contentPage,
      warning: warnings.join("；"),
    };
  } finally {
    // 释放整个文档与 worker，每份文件的内存不跨轮次累积。
    // ⚠️ 必须自己吞掉销毁的异常：`tryPage` 的异常正在往外穿，finally 里再抛一个就会
    // **把它盖掉** —— 用户看到的会是「销毁失败」而不是真正的 LLM 失败原因。
    try {
      await task.destroy();
    } catch {
      // 同上
    }
  }
}
