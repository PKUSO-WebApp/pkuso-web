import { supabase } from "@/lib/supabase";
import { STORAGE_BUCKETS, sheetMusicPagePath } from "@/lib/storage";
import {
  OCR_MAX_SCALE,
  OCR_TARGET_LONGEST_SIDE,
  PDFJS_ASSET_BASE,
  canvasToJpegBlob,
  loadPdfJs,
} from "./pdf-render";

/**
 * 页图（page previews）：上传时预渲染的整页 JPEG，小程序阅读器直接显示（#378）。
 *
 * 为什么要有它：小程序里 pdf.js 没有 WebCodecs `ImageDecoder`，只能走纯 JS 解码器
 * 全分辨率解码每页 JPEG——一页 300dpi 扫描件约 6 秒（实测 renderMs 5.3–6.0s/页），
 * 且 iOS 真机上会静默失败成白屏。把解码搬到上传时（浏览器有原生解码）是一次性成本。
 *
 * 原始 PDF **始终保留**（打印/转发/管理端依赖它）；页图是可再生的派生物。
 */

// 渲染串行链（模块级 = 全应用一条）：渲染是纯 CPU（pdf.js 的 fake worker 在主线程），
// 并发不会让它变快、只会让界面更卡（本仓实测结论）。放模块级而不是调用点局部，
// 是为了让所有上传（并发的行、多个弹窗）共用同一条链。
let renderChain: Promise<unknown> = Promise.resolve();
function serializeRender<T>(fn: () => Promise<T>): Promise<T> {
  const run = renderChain.then(fn, fn);
  renderChain = run.catch(() => {});
  return run;
}

/**
 * 逐页渲染整页 JPEG。与 `pdf-render.renderPageToJpeg`（OCR 用：裁标题条、判空、找谱线）
 * 不同，这里只要整页原样图；规格常量与 OCR 路径共享，不各写一份。
 *
 * 失败语义：任何一页失败都抛出（调用方降级为「不写 page_count」）——不做「跳过坏页
 * 继续」：页图缺一页就是阅读器少一页，比整份没有更糟。
 */
async function renderPagesToJpeg(
  file: Blob,
  opts: {
    onPage: (pageNo: number, jpeg: Blob) => Promise<void>;
    isCancelled: () => boolean;
  },
): Promise<{ pageCount: number; rendered: number }> {
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
    // `await task.promise` 必须在 try 里，否则加载失败（坏 PDF/加密）会漏掉 destroy
    pdf = await task.promise;
  } catch (err) {
    try {
      await task.destroy();
    } catch {
      // 销毁失败没有下游依赖
    }
    throw new Error(`读取 PDF 失败：${err instanceof Error ? err.message : String(err)}`);
  }

  let rendered = 0;
  try {
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      if (opts.isCancelled()) break;
      const page = await pdf.getPage(pageNo);
      const unscaled = page.getViewport({ scale: 1 });
      // 与 OCR 路径同一套缩放规则（只按最长边压、不设下限，理由见 pdf-render 的注释）
      const longestSide = Math.max(unscaled.width, unscaled.height);
      const fitScale = longestSide > 0 ? OCR_TARGET_LONGEST_SIDE / longestSide : OCR_MAX_SCALE;
      const scale = Math.min(OCR_MAX_SCALE, fitScale);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      try {
        if (!ctx) throw new Error("无法创建 canvas 上下文");
        // 透明像素编码成 JPEG 会合成到黑底，先铺白（与 OCR 路径同款）
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // v6 的 RenderParameters 必须带 canvas（canvasContext 单独传不够）
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        await opts.onPage(pageNo, await canvasToJpegBlob(canvas));
        rendered = pageNo;
      } finally {
        // 释放 canvas 后备存储（一页几十 MB），跨页不累积；页对象顺手清理
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
      }
    }
    return { pageCount: pdf.numPages, rendered };
  } finally {
    // 销毁异常绝不能盖住正在外穿的真正原因
    try {
      await task.destroy();
    } catch {
      // 同上
    }
  }
}

/**
 * 渲染整页 JPEG 并上传到**每个落点**的页图前缀下；返回页数（或 null）。
 *
 * 每个落点各存一份（与 PDF 的落点语义一致：同一份字节在桶里有 N 个独立对象，
 * 删除时按行枚举才不会误删别人引用的那份）。多存的是可再生的派生物，
 * 换来的是删除路径不需要引用计数。
 *
 * **失败不阻塞**（#378 契约第 6 条）：渲染或上传任一步失败只 `console.warn` 并返回
 * null ⇒ 调用方不写 `page_count` ⇒ 阅读器回退 pdf.js。被取消导致提前收手同样返回
 * null——页图缺页时宁可全不用，也不能声称「有页图」而让阅读器少显示几页。
 */
export async function uploadPagePreviews(
  pdfBlob: Blob,
  pdfPaths: string[],
  isCancelled: () => boolean,
): Promise<number | null> {
  try {
    return await serializeRender(async () => {
      const { pageCount, rendered } = await renderPagesToJpeg(pdfBlob, {
        isCancelled,
        onPage: async (pageNo, jpeg) => {
          for (const pdfPath of pdfPaths) {
            const { error } = await supabase.storage
              .from(STORAGE_BUCKETS.sheetMusic)
              .upload(sheetMusicPagePath(pdfPath, pageNo), jpeg, {
                contentType: "image/jpeg",
                upsert: true,
              });
            if (error) throw new Error(`第 ${pageNo} 页页图上传失败：${error.message}`);
          }
        },
      });
      if (rendered < pageCount) return null;
      return pageCount;
    });
  } catch (err) {
    console.warn("[sheet-music] 页图生成失败（不影响上传，阅读器将回退 pdf.js）", err);
    return null;
  }
}
