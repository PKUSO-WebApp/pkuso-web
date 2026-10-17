import type { PDFPageProxy } from "pdfjs-dist";
import { bandPlan, releaseCanvas } from "./band-geometry";
import { resolveBandPct } from "./band-measure";
import { makePreview, openPdf } from "./pdf-render";

/**
 * 窄带的**按需出图**（核实面板的缩略图）与它用的几何（pkuso-backend#96 §6）。
 *
 * ## 为什么单独一个模块
 *
 * 1. 窄带高度与「怎么缩放、窄带取多高」是**一条判据**：分段那次 OCR 看到的那条窄带，
 *    与用户在界面上看到的那张缩略图，必须**是同一条** —— 否则「模型看到的就是这个」
 *    是一句假话。几何的唯一来源是 `band-geometry.ts`（`bandPlan`），高度由
 *    `band-measure.ts` 按文档量出来；`segmentation-run.ts` 的逐页渲染与这里都从它们拿。
 * 2. 面板上的缩略图是**新的一类调用**（用户在确认阶段点开才跑，与「跑一次分段」无关），
 *    它的取消与释放纪律自成一块：整页渲染一张 scale 3 的画布约 20MB 后备存储，
 *    取消点必须落在**每一页之间**，`page.cleanup()` 与画布清零一个都不能漏。
 *
 * ⚠️ 高度**一份文档只有一个**（`resolveBandPct` 按 `File` 缓存）：面板里看到的条
 * 必须就是模型看到的那条，包括「同一份文档只取一个高度」这条性质。
 */

/** 一页 → 顶部窄带的缩略图（data URL）。宽 `maxWidth`，高按 `bandPct` */
async function bandThumb(page: PDFPageProxy, maxWidth: number, bandPct: number): Promise<string> {
  const { viewport, canvasWidth, canvasHeight, bandHeight } = bandPlan(page, bandPct);
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
    releaseCanvas(canvas);
    releaseCanvas(band);
  }
}

/**
 * 按需渲染**指定页**的窄带缩略图 → `页号 → data URL`。
 *
 * 高度走 `resolveBandPct`（与分段 OCR 共用同一份缓存）—— 面板里看到的条
 * 必须就是模型看到的那条，包括**同一份文档只取一个高度**这条性质。
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

  // 取消就一页都不开（测量阶段也一样）；null 只在取消时出现
  const bandPct = await resolveBandPct(file, opts);
  if (bandPct === null) return out;

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
        out.set(pageNo, await bandThumb(page, opts.maxWidth ?? 360, bandPct.pct));
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
