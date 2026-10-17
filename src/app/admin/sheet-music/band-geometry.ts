/**
 * 窄带的**几何**：缩放口径 + 「整页画布尺寸 → 窄带高」。
 *
 * 分段 OCR 的那条窄带与界面上看到的那张缩略图必须是**同一条** —— 否则「模型看到的
 * 就是这个」是一句假话。两处各写一份 `round(高 × pct)` 迟早会漂，所以这里是唯一来源：
 * `segmentation-run.ts`（逐页窄带）与 `band-render.ts`（面板缩略图）都从这里拿。
 *
 * 高度本身（`bandPct`）由 `band-measure.ts` 按文档量出来，本模块只负责把它落到像素。
 */

import { OCR_MAX_SCALE, OCR_TARGET_LONGEST_SIDE } from "./pdf-render";

/**
 * 一页的窄带几何：**缩放后的整页画布尺寸 + 窄带高**。
 *
 * `bandPct` 是**整份文档**的高度（`resolveBandPct` 的结果，或兜底 25%），
 * 调用方不许逐页换值 —— 那会把「首页有标题块、续页只有页眉」这条分段判据抹掉。
 *
 * 缩放口径与 `renderPageToJpeg` 是同一套（最长边压到 `OCR_TARGET_LONGEST_SIDE` 以内、
 * `OCR_MAX_SCALE` 封顶、**不设下限**），理由见那里：页面本身超过目标尺寸时（图片转 PDF
 * 会把 MediaBox 设成扫描像素尺寸），任何下限都会让它不再往目标收敛。
 */
export function bandPlan<V extends { width: number; height: number }>(
  page: { getViewport(opts: { scale: number }): V },
  bandPct: number,
): { viewport: V; canvasWidth: number; canvasHeight: number; bandHeight: number } {
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
    bandHeight: Math.max(1, Math.round(canvasHeight * bandPct)),
  };
}

/**
 * 释放画布后备存储（与 `renderPageToJpeg` 同一条规矩：自己立的规矩自己不守就是长泄漏的地方）。
 * 窄带渲染与高度测量两条路都要收尾，定义放这里，免得各写一份 `width = 0; height = 0`。
 */
export function releaseCanvas(c: HTMLCanvasElement) {
  c.width = 0;
  c.height = 0;
}
