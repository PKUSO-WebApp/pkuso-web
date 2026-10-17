/**
 * 「这份文档的窄带多高」—— **量**的那一半（`band-height.ts` 是判据，本模块是取数）。
 *
 * ## 为什么单独一个模块
 *
 * - 分段 OCR（`segmentation-run.ts`）与面板缩略图（`band-render.ts`）**各调一次**、彼此
 *   不知道对方，却必须拿到**同一个数**。缓存（按 `File`）与取数逻辑放在一处，这条性质
 *   才只有一个地方能破坏。
 * - 集成测试要把高度钉成固定值（假页面 + 假像素造不出真实排版），而 `renderBandThumbs`
 *   会在**模块内部**调用它 —— 只有它自己是模块边界时，测试的替换才真的生效。
 *
 * ## 高度从哪来（pkuso-backend#96 的「文档自适应」）
 *
 * 不再是全局常量：同一份 PDF 用**一个**高度，由这份文档自己的第一谱线位置推出来
 *（采样页数、聚合方式与兜底条件全在 `band-height.ts`，那里有为什么是 max 的理由）。
 * 推不出来时用 25%。测量结果按 `File` 对象缓存 —— 一份文档在「分段 OCR」与
 * 「面板缩略图」两处必须拿到**同一个数**。
 *
 * ⚠️ 缓存的是 `Promise`：分段开始前被调一次，面板再调时直接复用同一个结果。
 * 取消导致的 `null` 不缓存（下次重开要能重新量），异常同样不缓存。
 */

import type { PDFPageProxy } from "pdfjs-dist";
import { bandPlan, releaseCanvas } from "./band-geometry";
import { bandSamplePages, decideBandPct, type BandPctResult } from "./band-height";
import { openPdf } from "./pdf-render";
import { findFirstStaffLineInImage } from "./staff-line-tilt";

/**
 * 量「这一页第一条谱线在页高的哪里」。检测失败返回 `null`。
 *
 * 用整页 RGBA（`getImageData` 会复制一份，A4 在目标尺寸下约 17MB）跑生产用的
 * 倾斜跟随检测器 —— 与 `renderPageToJpeg` 决定标题裁切时**同一个函数、同一套缩放**，
 * 两处对「第一条谱线在哪」不会各说各话。
 */
async function firstStaffRatio(page: PDFPageProxy) {
  // 这里只用几何（viewport / 画布尺寸），bandHeight 不参与测量 ⇒ bandPct 传 0。
  const { viewport, canvasWidth, canvasHeight } = bandPlan(page, 0);
  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建 canvas 上下文");
    // 透明像素在检测器眼里是白，但先铺白与两条渲染路径保持一致（也让 JPEG/像素语义只有一种）
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const y = findFirstStaffLineInImage(img.data, canvas.width, canvas.height);
    if (y === null || canvas.height <= 0) return null;
    return y / canvas.height;
  } finally {
    releaseCanvas(canvas);
  }
}

/** 每份文档量一次。`null` = 中途被取消（不是失败，也不缓存） */
const bandPctCache = new WeakMap<File, Promise<BandPctResult | null>>();

/**
 * 这份文档的窄带高度（页高比例）。同一 `File` 只真跑一次，之后复用缓存。
 *
 * 只采 `bandSamplePages` 选出的页；每页单独 try —— 一页渲染/解码失败只是
 * 「这一页没测到」，不能把整份文档判死（扫描件偶尔有一页 JBIG2 解不出来，
 * 其余页仍然能给出答案）。所有采样页都失败时由 `decideBandPct` 退 25%。
 *
 * 取消返回 `null`，由调用方决定怎么停（分段侧是抛 `SegmentationCancelled`，
 * 缩略图侧是直接收工）—— 本模块不 import 那两处的错误类型，避免循环依赖。
 */
export function resolveBandPct(
  file: File,
  opts: { isCancelled: () => boolean },
): Promise<BandPctResult | null> {
  const cached = bandPctCache.get(file);
  if (cached) return cached;

  const pending = (async (): Promise<BandPctResult | null> => {
    // 先问一次再打开：关窗之后连 PDF 都不该再解析
    if (opts.isCancelled()) return null;
    const task = await openPdf(file);
    try {
      const pdf = await task.promise;
      const ratios: Array<number | null> = [];
      for (const pageNo of bandSamplePages(pdf.numPages)) {
        if (opts.isCancelled()) return null;
        let page: PDFPageProxy | null = null;
        try {
          page = await pdf.getPage(pageNo);
          ratios.push(await firstStaffRatio(page));
        } catch {
          // 这一页没量到：记 null，别的页照常（兜底条件会处理「样本不够」）
          ratios.push(null);
        } finally {
          page?.cleanup();
        }
      }
      return decideBandPct(ratios);
    } finally {
      // 与另外两条渲染路径同一条纪律：`await task.promise` 的抛点在 try 里，这里才走得到
      try {
        await task.destroy();
      } catch {
        // 销毁本身失败没有下游依赖（fake worker 下泄漏的是可被 GC 的对象图）
      }
    }
  })();

  // 取消/失败不缓存：用户重开面板或重试分段时要能重新量，而不是永远拿到同一个 null / 异常
  const tracked = pending.then(
    (r) => {
      if (r === null) bandPctCache.delete(file);
      return r;
    },
    (err) => {
      bandPctCache.delete(file);
      throw err;
    },
  );
  bandPctCache.set(file, tracked);
  return tracked;
}
