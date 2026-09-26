import { supabase } from "@/lib/supabase";
import { LLM_TIMEOUT_MS } from "./analysis";
import { mapLinesToPages, MOSAIC_HARD_LIMIT_BYTES, packBands } from "./mosaic";
import { invokeErrorDetail, invokeOcr, runOcr } from "./ocr-client";
import {
  blobToBase64,
  loadPdfJs,
  OCR_JPEG_QUALITY,
  OCR_MAX_SCALE,
  OCR_TARGET_LONGEST_SIDE,
  PDFJS_ASSET_BASE,
} from "./pdf-render";
import type { PageText } from "./upload-modal.types";

/** 用户关掉弹窗后中断 —— **不是失败**，不要落到 `segState: "error"` */
export class SegmentationCancelled extends Error {
  constructor() {
    super("已取消");
    this.name = "SegmentationCancelled";
  }
}

/**
 * 顶部窄带的固定高度（页高比例）。
 *
 * ⚠️ **必须是固定值，不能用 `decideTitleCrop`**：续页在裁切逻辑下会因「顶部过薄」
 * 退化成整页，那就把「续页只有页眉」这个判据本身毁掉了（#290 正文里写明了这条）。
 *
 * 12% 的来历：issue 正文给的例子是 12%；另一处提到的 33% 是 `decideTitleCrop` 的
 * `MAX_CROP_PCT`（**裁切上限**，另一件事），不是窄带高度。12% 在真实语料上验过
 * （语料、轮次与结论见 #290 的评论）—— **别在这里写份数/页数**：那是会腐烂的计数，
 * 每加一份语料就错一次。
 */
export const BAND_PCT = 0.12;

/**
 * 把若干条窄带**垂直叠成一张长图**。返回长图与它的高度（归页要用）。
 *
 * 拼图尺寸 ≈ 各窄带之和（实测 0.95~0.99），所以调用方能在合成前就分好组；
 * 这里再返回真实字节数，让调用方**提交前**能核一次（合成不花 OCR 配额）。
 */
async function composeMosaic(
  bands: Blob[],
): Promise<{ blob: Blob; width: number; height: number; bandHeight: number }> {
  const bitmaps: ImageBitmap[] = [];
  try {
    for (const b of bands) bitmaps.push(await createImageBitmap(b));
    // ⚠️ **本组必须等高**。`bandH` 是**逐页**算的（`round(canvas.height * 0.12)`，而 canvas
    // 高度取决于该页自己的尺寸与缩放）—— 同一份合订谱里混了横排插页 / 不同扫描仪的页时
    // 就不等高。那时叠图步长（第一条的高）与归页除数（`renderNarrowBands` 返回的高）会对不上，
    // 后果是**把两页的文字并进一页、另一页留空** —— 看起来完全合法的错答案。
    // 判据落在这里：不等高时**唯一的正确做法是不拼图**（抛错 → 调用方退回逐页 OCR，结果一样对）。
    // 宽不等没关系：叠图按 x=0 画，右边露白不影响识别，所以只判高。
    const heights = new Set(bitmaps.map((b) => b.height));
    if (heights.size !== 1) {
      throw new Error(`窄带高度不一致（${[...heights].join("/")}）—— 不拼图，退回逐页`);
    }
  } catch (err) {
    // 解码循环也在这个 try 里：第 k 条失败时前 k−1 个 ImageBitmap 必须 close
    //（每个约 1788×285×4B ≈ 2MB 的解码后像素，一批最多几十 MB）
    bitmaps.forEach((b) => b.close());
    throw err;
  }
  const width = Math.max(...bitmaps.map((b) => b.width));
  const bandHeight = bitmaps[0].height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = bandHeight * bitmaps.length;
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建 canvas 上下文");
    // 与单页窄带同一条理由：透明像素编码成 JPEG 会合成到黑底
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    bitmaps.forEach((bmp, i) => ctx.drawImage(bmp, 0, i * bandHeight));
    const blob = await new Promise<Blob | null>((r) =>
      canvas.toBlob(r, "image/jpeg", OCR_JPEG_QUALITY),
    );
    if (!blob) throw new Error("拼图编码失败");
    // ⚠️ 把**本组自己的**窄带高一起返回：归页必须用它做除数，而不是用外面那个
    // 文件级的 `bandHeight`（那是**最后渲染那一页**的高）。两者只在「整份文件等高」时相等，
    // 而尺寸不同的页只要**落在组边界上**，组内断言就抓不到 —— 那时除数偏掉会把整组的文字
    // 往后挤并夹进最后一页，而所有信号都是正常的（静默错答案）。
    return { blob, width: canvas.width, height: canvas.height, bandHeight };
  } finally {
    bitmaps.forEach((b) => b.close());
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * 一张拼图 → 各页文本。**坐标不可用时抛错**，让调用方退回逐页 OCR ——
 * 那比「把文字归到错页」或「全归第 1 页」好：后两者都是看起来完全正常的错答案。
 */
async function ocrMosaic(
  blob: Blob,
  bandHeight: number,
  pageCount: number,
  mosaicHeight: number,
): Promise<string[]> {
  // 提交前核一次真实大小（不花配额）：超了当场抛，让调用方退回逐页 —— 发出去也是白费
  if (blob.size > MOSAIC_HARD_LIMIT_BYTES) {
    throw new Error(`拼图 ${Math.round(blob.size / 1024)}KB 超上限`);
  }
  const { lines, text } = await invokeOcr(await blobToBase64(blob), {
    overlay: true,
    what: `拼图 ${pageCount} 页`,
  });
  const mapped = mapLinesToPages(lines, bandHeight, pageCount, mosaicHeight);
  if (!mapped) {
    throw new Error(`拼图坐标不可用（${lines.length} 行）`);
  }
  // 坐标都在，但一行都没归到任何页 —— 也当失败（否则整批会变成 N 个空串）
  if (mapped.every((t) => !t.trim()) && text.trim()) {
    throw new Error("拼图坐标归页结果为空");
  }
  return mapped;
}

/**
 * 逐页渲染顶部等高窄带（#290 Step 1 的输入）。
 *
 * 与 `renderPagesForAnalysis` **刻意分开**：那个的职责是「从第一张有内容的页起往后走、
 * 决定每页裁到哪」，这个的职责是「每一页都取一条等高的窄带」—— 两者的裁切逻辑必须不同
 * （见 BAND_PCT）。代价是分析阶段看过的页会被渲染第二次（与 N 次 OCR 相比可忽略），
 * 换来的是两条路径互不牵制。
 *
 * ⚠️ 内存：每页渲染后会 `page.cleanup()`。渲染一整页的 canvas 峰值在本项目的语料上
 * 量到过 ~282MB（大头是 pdf.js 解码扫描图的**内部**画布），19 页串行跑不会叠加，
 * 但**不能**把这里改成并发。
 */
async function renderNarrowBands(
  file: File,
  opts: { needed: (pageNo: number) => boolean; isCancelled: () => boolean },
): Promise<{ pageCount: number; bands: Blob[] }> {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({
    data,
    standardFontDataUrl: `${PDFJS_ASSET_BASE}standard_fonts/`,
    wasmUrl: `${PDFJS_ASSET_BASE}wasm/`,
    iccUrl: `${PDFJS_ASSET_BASE}iccs/`,
  });
  try {
    const pdf = await task.promise;
    const bands: Blob[] = [];
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      // ⚠️ 关掉弹窗之后不能继续往下跑：一份 19 页的谱还有最多 19×65s 的 OCR 在排队，
      // 而配额是照烧的。**每个文件开头检查一次是不够的** —— 分段路径的粒度是
      // 「1 个文件 = N 次 OCR」，不是「1 个文件 = 1 次请求」。
      if (opts.isCancelled()) throw new SegmentationCancelled();
      // 已经在手里的页不重渲染（失败重试只补缺的页）。占位空串保住
      // `bands.length === pageCount` 这个对应关系，调用方按页号取。
      if (!opts.needed(pageNo)) {
        bands.push(new Blob([])); // 占位，保住 bands.length === pageCount
        continue;
      }
      const page = await pdf.getPage(pageNo);
      try {
        const unscaled = page.getViewport({ scale: 1 });
        const longestSide = Math.max(unscaled.width, unscaled.height);
        const fitScale = longestSide > 0 ? OCR_TARGET_LONGEST_SIDE / longestSide : OCR_MAX_SCALE;
        const viewport = page.getViewport({ scale: Math.min(OCR_MAX_SCALE, fitScale) });

        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const bandH = Math.max(1, Math.round(canvas.height * BAND_PCT));
        const band = document.createElement("canvas");
        band.width = canvas.width;
        band.height = bandH;
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
          bctx.drawImage(canvas, 0, 0, canvas.width, bandH, 0, 0, band.width, band.height);

          const blob = await new Promise<Blob | null>((r) =>
            band.toBlob(r, "image/jpeg", OCR_JPEG_QUALITY),
          );
          if (!blob) throw new Error(`第 ${pageNo} 页窄带编码失败`);
          // 存 **Blob** 而不是 base64：拼图要在 canvas 上把它们画出来（`createImageBitmap`
          // 直接吃 Blob），而 base64 还得先解回去。尺寸也现成（`blob.size`）—— 分组要靠它。
          bands.push(blob);
        } finally {
          // 释放 canvas 后备存储（与 renderPageToJpeg 同一条规矩：scale 3 的一页约 20MB）。
          // 串行跑不会叠加，但「自己立的规矩自己不守」是最容易长出真泄漏的地方。
          canvas.width = 0;
          canvas.height = 0;
          band.width = 0;
          band.height = 0;
        }
      } finally {
        page.cleanup();
      }
    }
    return { pageCount: pdf.numPages, bands };
  } finally {
    // ⚠️ `await task.promise` 必须在 try 里（上面）：加载失败（坏 PDF / 加密 /
    // 资源缺失）时它会抛，抛在 try 外面就**永远走不到销毁** —— 真 worker 模式下
    // 漏的是一个线程。这里也不吞异常：finally 里的 destroy 失败不该盖住真错误。
    try {
      await task.destroy();
    } catch {
      // 销毁本身失败没有下游依赖（fake worker 下泄漏的是可被 GC 的对象图）
    }
  }
}

/**
 * 分段第一步：**逐页**窄带 OCR。产物（`pageTexts` / `failedPages`）由调用方**先落状态**。
 *
 * 拆成两步的理由：第二步（`segment-parts`）失败或用户中途再来一次时，这 N 次 OCR 的
 * 产物必须留下来 —— 否则重试 = 整份重烧（19 页 = 19 次配额，而免费档是 500 次/天）。
 * `existing` 就是上一次留下来的东西，有它则那几页连渲染都不做。
 *
 * ⚠️ 串行跑。一份 N 页 = N 次 OCR，**不能**与别的文件并发更多 —— 整个分析阶段已经
 * 有 `PIPELINE_CONCURRENCY` 个文件在飞，这里再并发会把 OCR.space 的瞬时压力翻几倍。
 */
export async function ocrBandsForSegmentation(
  file: File,
  opts: { existing?: PageText[]; isCancelled: () => boolean },
): Promise<{ pageCount: number; pageTexts: PageText[]; failedPages: number[] }> {
  const have = new Map((opts.existing ?? []).map((p) => [p.page, p.text]));
  const { pageCount, bands } = await renderNarrowBands(file, {
    needed: (pageNo) => !have.has(pageNo),
    isCancelled: opts.isCancelled,
  });

  const pageTexts: PageText[] = [];
  const failedPages: number[] = [];
  /** 还需要 OCR 的页号（已有的页已经在 `pageTexts` 里） */
  const need: number[] = [];
  for (let i = 0; i < pageCount; i++) {
    const page = i + 1;
    const known = have.get(page);
    if (known !== undefined) {
      pageTexts.push({ page, text: known });
      continue;
    }
    if (opts.isCancelled()) throw new SegmentationCancelled();
    // 剩下的页交给下面的拼图批次统一处理（`need` 收集页号，循环后按批跑）
    need.push(page);
  }

  /**
   * **拼图批次**：把待 OCR 的窄带按大小分组，每组合成一张长图**一次**调用，
   * 再用 overlay 坐标把文字分回各页（`mosaic.ts`；探针数据见 #290 的评论）。
   *
   * 一次 load 全部窄带 → 一组一次调用 → 页文本的形状与逐页路线**完全一致**，
   * 所以后面（`segment-parts`、失败页处理、成本显示）一行都不用改。
   *
   * 分组用**渲染时就拿到的大小**（`blob.size`），实测「拼图 ≤ 各窄带之和」，所以
   * 预算是安全上界；合成后还会拿真实字节数再核一次（不花 OCR 配额）。
   */
  if (need.length > 0) {
    const groups = packBands(need.map((page) => bands[page - 1].size));
    for (const group of groups) {
      if (opts.isCancelled()) throw new SegmentationCancelled();
      const pages = group.map((k) => need[k]);
      try {
        const {
          blob,
          height,
          bandHeight: groupBandHeight,
        } = await composeMosaic(pages.map((page) => bands[page - 1]));
        const texts = await ocrMosaic(blob, groupBandHeight, pages.length, height);
        pages.forEach((page, k) => pageTexts.push({ page, text: texts[k] }));
      } catch {
        // 这一批没成：**退回逐页**（多花配额但结果一样对），而不是把整批发成空文本 ——
        // 「拿不到文本」与「这一页是空白页」在后端是两件事（见下面那段说明）。
        for (const page of pages) {
          // ⚠️ 取消点不能只在每组开头：这一批最多 24 页，关窗后最坏再烧 24×65s 的 OCR，
          // 而配额是照烧的（本文件早为「逐页循环没有取消点」栽过一次）
          if (opts.isCancelled()) throw new SegmentationCancelled();
          try {
            pageTexts.push({ page, text: await runOcr(await blobToBase64(bands[page - 1])) });
          } catch {
            failedPages.push(page);
          }
        }
      }
    }
  }

  // 一页都没成功 = 没有任何可判断的内容。**必须报错**，不能退化成「不切」：
  // 界面上「这份谱只有一份」与「OCR 全挂」长得一样的话，用户会照着错结论往下走
  // （这正是本仓记过的「降级逻辑掩盖失败」）。
  if (pageTexts.length === 0) {
    throw new Error(
      `全部 ${pageCount} 页的窄带 OCR 都失败了（配额用尽或会话过期？）—— 没有可判断的内容`,
    );
  }
  // 第二种形态：OCR 每页都**回报成功**、但一个字都没读到。实测可达 —— 上游在配额/
  // 限流状态下会回一个不带任何错误标志的空结果集（见 pkuso-backend#25），那时
  // `runOcr` 拿到的是空串而不是异常，于是每一页都被当成「空白页」发下去，模型只能
  // 返回「不切」，界面上显示「共 1 段」—— 与「这份谱确实只有一份」不可区分。
  // 判据是**全部页都空**：单片空白页是正常的（真空白页），全空则是没读到东西。
  //
  // ⚠️ 这里**故意不把 `pageTexts` 交给调用方落状态**（与上面「OCR 产物先落」的
  // 原则相反）：这条路留下的产物是 N 个空串，一旦落状态，重试会因为「所有页都已在
  // 手里」而跳过 OCR、立刻撞回这条守卫 —— 于是「配额恢复后再试一次」永远走不通，
  // 变成一个不可自救的死路。宁可让重试重烧 N 次，也不要一个点了没反应的按钮。
  if (pageTexts.every((p) => !p.text.trim())) {
    throw new Error(
      `${pageCount} 页的窄带都没读到文字（OCR 配额/限流，或窄带不可识别）` +
        `—— 没有可判断的内容。可以直接上传（分段是可选的），或稍后重试`,
    );
  }
  return { pageCount, pageTexts, failedPages };
}

/** 分段第二步：把页文本交给 `segment-parts`，拿回原始 `cuts`（校验交给 `startsFromResponse`） */
export async function requestSegmentation(
  pageCount: number,
  pageTexts: PageText[],
): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke("segment-parts", {
    body: { pageCount, pages: pageTexts },
    timeout: LLM_TIMEOUT_MS,
  });
  if (error) throw new Error(`分段请求失败: ${await invokeErrorDetail(error)}`);
  if (!data?.success) {
    throw new Error(`分段失败: ${data?.error || data?.message || "未知错误"}`);
  }
  return data.cuts;
}
