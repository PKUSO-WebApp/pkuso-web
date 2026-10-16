import { mapLinesToPages, MOSAIC_HARD_LIMIT_BYTES } from "./mosaic";
import { invokeOcr, runOcr } from "./ocr-client";
import {
  blobToBase64,
  loadPdfJs,
  OCR_JPEG_QUALITY,
  PDFJS_ASSET_BASE,
  renderPageToJpeg,
} from "./pdf-render";

/**
 * 「窄带图 → 逐页文本」的取法。三种，都在这里：
 *
 * - `composeMosaic` + `ocrMosaic`：把一批等高窄带**拼成一张长图**、一次调用，
 *   再按坐标把文字分回各页（探针数据见 #290 的评论；逐页那条路线在 `segmentation-run.ts`）。
 * - `retakeEmptyBands`：窄带**取到了、但一个字都没有**的页，换「标题区」那一刀再取一次。
 *
 * ⚠️ 这个模块是从 `segmentation-run.ts` 里搬出来的（**只搬，没改**）：那个文件在设计债
 * 棘轮（`scripts/check-design-debt.mjs`）上已顶到 400 行上限，而补救那一刀必须紧挨着
 * 它的两个同类 —— 「窄带怎么变成文字」这件事本来就该在一个文件里读完。
 */

/**
 * 把若干条窄带**垂直叠成一张长图**。返回长图与它的高度（归页要用）。
 *
 * 拼图尺寸 ≈ 各窄带之和（实测 0.95~0.99），所以调用方能在合成前就分好组；
 * 这里再返回真实字节数，让调用方**提交前**能核一次（合成不花 OCR 配额）。
 */
export async function composeMosaic(
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
export async function ocrMosaic(
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
 * 窄带取空时的**补救取法**：改用「标题区」那一刀再取一次。
 *
 * ## 为什么需要它
 *
 * 窄带是**固定的几何裁切**（页高 12%，见 `segmentation-run.ts` 的 `BAND_PCT`），而页眉/标题块
 * 在页面上的纵向位置由排版决定。**居中排版的标题页**（整页只在页面中部印一行大字）就是那种
 * 必然整块落在 12% 之下的页 —— 窄带渲染出来是一张白纸，OCR 返回空串。
 *
 * 那条空串会一路传到模型那里：后端 `segment-parts` 把它渲染成「第 N 页: （空白）」，
 * 于是模型**把「窄带没取到」读成「这一页没有文字」**。第 1 页上这一读错的代价最大 ——
 * 它是唯一没有前文可参照的页，「第 1 页空白 + 第 2 页一个完整标题块」直接导向
 * 「第 2 页是新的一份的开头」（多切）。
 *
 * ⚠️ 要修的普遍规律是**「窄带空 ≠ 页面空」**，不是「某一份谱要怎么修」：
 * 触发条件与页号无关（`page === 1` 这种分支不许出现），任何一页窄带取空都走这里。
 *
 * ## 为什么用 `renderPageToJpeg` 而不是「把窄带加高一点」
 *
 * 它给的正是**分析路径一直在用的那一刀**：第一条谱线之上（无谱线 / 过薄 / 过高时退回
 * 整页）—— 依据是 `staff-line.ts` 那条结构性判据「**标题区永远在乐谱之上，而乐谱必有
 * 谱线**」（真谱线落进送检图 0/34 是语料上验过的）。三点好处：
 * ① 不新增第二套「标题区在哪」的定义；② 不会把五线谱带进送检图（固定比例加高会）；
 * ③ 不引入新常量。
 *
 * **成本**：只在窄带**已经**返回空串时发生，一页最多 +1 次 `ocr-analyze`；窄带非空的页
 * 一次都不多发（舒八 83 页、艾格蒙特 42 页实测 0 页窄带为空 ⇒ 那两份语料的载荷逐字节相同）。
 *
 * ⚠️ 那几页也**不能并发**：一次整页渲染的 canvas 峰值在本项目的语料上量到过 ~282MB
 *（与 `renderNarrowBands` 同一条理由）。
 *
 * @param throwIfCancelled 每页开头的取消检查点。**抛什么由调用方决定**（那里抛
 *        `SegmentationCancelled`）：本模块是 `segmentation-run.ts` 的下游，反向 import
 *        那个类就成了一个真实的循环依赖，为省一个回调不值。
 * @returns 页号 → 补救拿到的文本（**只含真的取到了的页**；取不到的页不进这个 Map，
 *          调用方保持窄带那条结果 —— 拿不到就回到今天的行为，不新造失败态）
 */
export async function retakeEmptyBands(
  file: File,
  pages: number[],
  opts: { throwIfCancelled: () => void },
): Promise<Map<number, string>> {
  const got = new Map<number, string>();
  if (pages.length === 0) return got;
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
    for (const pageNo of pages) {
      // 关窗即收手。粒度是**页**：一份 19 页的谱补起来也是一次一次烧配额
      //（与 renderNarrowBands 同一条规矩，那个函数早为「没有取消点」栽过一次）
      opts.throwIfCancelled();
      let text = "";
      try {
        const page = await pdf.getPage(pageNo);
        try {
          // 这一页的「标题区」：第一条谱线之上；无谱线 / 过薄 / 过高时整页
          text = await runOcr((await renderPageToJpeg(page)).base64);
        } finally {
          page.cleanup();
        }
      } catch {
        // 这一页补救不了（渲染失败 / OCR 失败 / 超时）—— **保持窄带那条结果**。
        // 吞掉是对的：补救是**加法**，它失败时整份的走法必须与改动前逐字相同。
        continue;
      }
      if (text.trim()) got.set(pageNo, text.trim());
    }
    return got;
  } finally {
    // 与 renderNarrowBands 同一条：`await task.promise` 在 try 里面，抛了也走得到这里
    try {
      await task.destroy();
    } catch {
      // 销毁失败没有下游依赖（fake worker 下泄漏的是可被 GC 的对象图）
    }
  }
}
