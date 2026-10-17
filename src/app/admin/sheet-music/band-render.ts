import type { PDFPageProxy } from "pdfjs-dist";
import { makePreview, OCR_MAX_SCALE, OCR_TARGET_LONGEST_SIDE, openPdf } from "./pdf-render";

/**
 * 窄带的**几何**与**按需渲染**（pkuso-backend#96 §6：让分段结果看得见、能当场核实）。
 *
 * ## 为什么单独一个模块
 *
 * 1. `BAND_PCT` 与「怎么缩放、窄带取多高」是**一条判据**：分段那次 OCR 看到的那条窄带，
 *    与用户在界面上看到的那张缩略图，必须**是同一条** —— 否则「模型看到的就是这个」
 *    是一句假话。两处各写一份 `round(高 × 0.15)` 迟早会漂，所以这里是唯一来源，
 *    `segmentation-run.ts` 的逐页渲染也用它。
 * 2. 面板上的缩略图是**新的一类调用**（用户在确认阶段点开才跑，与「跑一次分段」无关），
 *    它的取消与释放纪律自成一块：整页渲染一张 scale 3 的画布约 20MB 后备存储，
 *    取消点必须落在**每一页之间**，`page.cleanup()` 与画布清零一个都不能漏。
 */

/**
 * 顶部窄带的固定高度（页高比例）。
 *
 * ⚠️ **必须是固定值，不能用 `decideTitleCrop`**：续页在裁切逻辑下会因「顶部过薄」
 * 退化成整页，那就把「续页只有页眉」这个判据本身毁掉了（#290 正文里写明了这条）。
 *
 * 15% 的依据：由离线探针与语料 A/B 定出，落在「真切页所需高度」与「第一谱线」
 * 之间的空档里。另一处提到的 33% 是 `decideTitleCrop` 的 `MAX_CROP_PCT`（**裁切上限**，
 * 另一件事），不是窄带高度。**别在这里写份数/页数/轮数**：那是会腐烂的计数，
 * 每加一份语料就错一次。
 */
export const BAND_PCT = 0.15;

/**
 * 一页的窄带几何：**缩放后的整页画布尺寸 + 窄带高**。
 *
 * 缩放口径与 `renderPageToJpeg` 是同一套（最长边压到 `OCR_TARGET_LONGEST_SIDE` 以内、
 * `OCR_MAX_SCALE` 封顶、**不设下限**），理由见那里：页面本身超过目标尺寸时（图片转 PDF
 * 会把 MediaBox 设成扫描像素尺寸），任何下限都会让它不再往目标收敛。
 */
export function bandPlan<V extends { width: number; height: number }>(page: {
  getViewport(opts: { scale: number }): V;
}): { viewport: V; canvasWidth: number; canvasHeight: number; bandHeight: number } {
  const unscaled = page.getViewport({ scale: 1 });
  const longestSide = Math.max(unscaled.width, unscaled.height);
  const fitScale = longestSide > 0 ? OCR_TARGET_LONGEST_SIDE / longestSide : OCR_MAX_SCALE;
  const viewport = page.getViewport({ scale: Math.min(OCR_MAX_SCALE, fitScale) });
  const canvasWidth = Math.ceil(viewport.width);
  const canvasHeight = Math.ceil(viewport.height);
  return {
    viewport,
    canvasWidth,
    canvasHeight,
    bandHeight: Math.max(1, Math.round(canvasHeight * BAND_PCT)),
  };
}

/** 释放画布后备存储（与 `renderPageToJpeg` 同一条规矩：自己立的规矩自己不守就是长泄漏的地方） */
function release(c: HTMLCanvasElement) {
  c.width = 0;
  c.height = 0;
}

/** 一页 → 顶部窄带的缩略图（data URL）。宽 `maxWidth`，高按比例 */
async function bandThumb(page: PDFPageProxy, maxWidth: number): Promise<string> {
  const { viewport, canvasWidth, canvasHeight, bandHeight } = bandPlan(page);
  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const band = document.createElement("canvas");
  band.width = canvasWidth;
  band.height = bandHeight;
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建 canvas 上下文");
    // 透明像素编码成 JPEG 会合成到黑底，先铺白（与 renderPageToJpeg 同一条理由）
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;

    const bctx = band.getContext("2d");
    if (!bctx) throw new Error("无法创建 canvas 上下文");
    bctx.fillStyle = "#ffffff";
    bctx.fillRect(0, 0, band.width, band.height);
    // 九段式（源矩形 → 目标矩形）：窄带是整页的**顶部一条**，不是缩小的整页
    bctx.drawImage(canvas, 0, 0, canvas.width, bandHeight, 0, 0, band.width, band.height);
    return makePreview(band, maxWidth);
  } finally {
    release(canvas);
    release(band);
  }
}

/**
 * 按需渲染**指定页**的窄带缩略图 → `页号 → data URL`。
 *
 * ⚠️ **只在用户展开面板时才调**（面板默认关着 = 零成本）；⚠️ **不进行状态**：一张缩略图
 * 是几十 KB 的 data URL，十几页塞进 `UploadFile` 会跟着每次 `setFiles` 一起被复制。
 * 缓存留在面板组件的 ref 里，随组件卸载消失。
 *
 * 失败形态（两句话都要有用）：整份打不开（坏 PDF / 资源缺失）→ 抛；**单页**渲染不出来
 * → 那一页**不在**返回的 map 里 —— 调用方按「请求过却没回来」说一句「这一页没渲染出来」，
 * 而不是永远转圈（本仓栽过的「降级掩盖失败」）。
 */
export async function renderBandThumbs(
  file: File,
  pages: number[],
  opts: { isCancelled: () => boolean; maxWidth?: number },
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const want = [...new Set(pages)]
    .filter((n) => Number.isSafeInteger(n) && n >= 1)
    .sort((a, b) => a - b);
  if (want.length === 0) return out;

  const task = await openPdf(file);
  try {
    const pdf = await task.promise;
    for (const pageNo of want) {
      // 取消点落在**页之间**：每页都可能要几十秒的渲染，关掉面板之后继续跑是白烧 CPU
      if (opts.isCancelled()) break;
      if (pageNo > pdf.numPages) continue;
      // ⚠️ `getPage` 必须在这一页的 `try` **里面**：它同样会抛（页对象建不出来、选中文件之后
      // 文件被移走），摆在外面的代价是**整份渲染中断** —— 调用方于是永远停在「渲染中…」，
      // 而已经画好的页也一起丢（这正是本仓栽过的「降级掩盖失败」）。
      let page: PDFPageProxy | null = null;
      try {
        page = await pdf.getPage(pageNo);
        out.set(pageNo, await bandThumb(page, opts.maxWidth ?? 360));
      } catch {
        // 这一页没画出来：留在 map 外面，由调用方说一句（见 docblock）
      } finally {
        page?.cleanup();
      }
    }
    return out;
  } finally {
    // 与 `renderNarrowBands` 同一条纪律：`await task.promise` 的抛点在里面，这里才走得到
    try {
      await task.destroy();
    } catch {
      // 销毁本身失败没有下游依赖（fake worker 下泄漏的是可被 GC 的对象图）
    }
  }
}
