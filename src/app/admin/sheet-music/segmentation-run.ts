import { supabase } from "@/lib/supabase";
import { LLM_TIMEOUT_MS } from "./analysis";
import { composeMosaic, ocrMosaic, retakeEmptyBands } from "./band-ocr";
import { bandPlan } from "./band-render";
import { packBands } from "./mosaic";
import { invokeErrorDetail, runOcr } from "./ocr-client";
import { blobToBase64, OCR_JPEG_QUALITY, openPdf } from "./pdf-render";
import type { PageText } from "./upload-modal.types";

/** 用户关掉弹窗后中断 —— **不是失败**，不要落到 `segState: "error"` */
export class SegmentationCancelled extends Error {
  constructor() {
    super("已取消");
    this.name = "SegmentationCancelled";
  }
}

/**

/**
 * 逐页渲染顶部等高窄带（#290 Step 1 的输入）。
 *
 * 与 `pdf-render.ts` 的 `renderPagesForAnalysis` **刻意分开**：那个的职责是「从第一张有内容的页起往后走、
 * 决定每页裁到哪」，这个的职责是「每一页都取一条等高的窄带」—— 两者的裁切逻辑必须不同
 * （见 `band-render.ts` 的 `BAND_PCT`）。代价是分析阶段看过的页会被渲染第二次（与 N 次 OCR 相比可忽略），
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
  const task = await openPdf(file);
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
        // 几何（缩放口径 + 窄带高）在 `band-render.ts`：界面上的缩略图与这里必须是同一条窄带
        const { viewport, canvasWidth, canvasHeight, bandHeight: bandH } = bandPlan(page);
        const canvas = document.createElement("canvas");
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
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
 * 有 `upload-modal.tsx` 的 `PIPELINE_CONCURRENCY` 个文件在飞，这里再并发会把 OCR.space 的瞬时压力翻几倍。
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

  /**
   * 补救：哪几页的窄带**取到了、但一个字都没有**（`text` 是空串），换「标题区」那一刀
   * 再取一次（见 `band-ocr.ts` 的 `retakeEmptyBands`）。空串会被后端渲染成「（空白）」
   * 交给模型，而「窄带空」根本推不出「这一页没文字」—— 居中排版的标题页必然落在 15% 之下。
   *
   * ⚠️ 判据是**空串**，不是「没读到」（后者在 `failedPages` 里，页根本就不在 `pageTexts`
   * 中）：那种是传输/配额问题，换裁切不治，且后端对缺页已有「不要在那几页上给切点」的提示。
   * 两者混在一起会把「能补救」和「补救不了」的一起补一遍，白烧配额。
   *
   * ⚠️ 位置在**两条守卫之后**：补救是这个函数的**加法**，不能把「所有页都没读到」
   * 那条守卫的语义（立刻报错、让用户稍后重试）变成「先烧 N 次补救再报错」。
   */
  const emptyPages = pageTexts.filter((p) => !p.text.trim()).map((p) => p.page);
  if (emptyPages.length > 0) {
    try {
      const retaken = await retakeEmptyBands(file, emptyPages, {
        // 取消在这里是一个异常（`SegmentationCancelled`），而那个类定义在本文件里 ——
        // 抛的动作留在这一侧，`band-ocr.ts` 就不必反向 import 本文件（循环依赖）。
        throwIfCancelled: () => {
          if (opts.isCancelled()) throw new SegmentationCancelled();
        },
      });
      for (const p of pageTexts) {
        const better = retaken.get(p.page);
        // ⚠️ 只改**本函数自己拼出来的**那一份（上面每个元素都是新对象）：调用方
        // `opts.existing` 那份数组要一字不动 —— 它可能就是 React state 里的数组。
        if (better !== undefined) p.text = better;
      }
    } catch (err) {
      // 取消照抛（那是调用方的语义，不是补救失败）。
      if (err instanceof SegmentationCancelled) throw err;
      // ⚠️ **补救必须整体是可失败而不留痕的**：它自己那几步（`openPdf` —— 里面是
      // `loadPdfJs` / 重新 `file.arrayBuffer()` / `getDocument` 三件事）在窄带阶段
      // 跑完**之后**才发生，那一刻文件读不出来（被移走、网络盘掉线）或二次解析失败
      // 都是可能的 —— 而它们抛出去会把这一行推成 `error`，**把窄带阶段已经烧掉的整批
      // 结果一起丢掉**，而改动前同一状态是成功的。契约第 4 条要的是「拿不到就回到
      // 今天的行为」，所以这里吞掉：`pageTexts` 保持窄带那条，`failedPages` 也不动。
      void err;
    }
  }
  return { pageCount, pageTexts, failedPages };
}

/**
 * 后端 `segment-parts` 丢掉的一个切点（#96 §3.2 的排查字段）：**模型弃权**与「模型给了切点但被 evidence 子串
 * 校验丢掉」此前逐字相同（都只有空 `cuts`），而两者修法**相反**（改 prompt vs 改校验/抄写规则）—— 那几份
 * 0/9 的合订谱就是这样卡住的：分不开是哪一种，就不知道该改 prompt 还是改校验。
 */
export interface SegmentationRejection {
  /** 模型给的那个页号（`4.5` 也原样带上：它正是「为什么被丢」的一部分）；不是有限数字时是 `null` */
  page: number | null;
  /**
   * 丢掉它的理由，取值由后端 `REJECTION_REASONS` 定义（**别把取值抄到这里**，抄一份烂一份）。
   * 类型是 `string` 不是那串字面量的联合：后端只允许加值，联合类型会在它加值时安静地变成
   * 一句假话。按理由分支时记得留兜底，别写成「穷尽 switch」。
   */
  reason: string;
  /** 只在「引文没在那一页的原文里找到」时带上：模型抄的那段（缺了它就还是「不知道它说了什么」） */
  evidence?: string;
}

/**
 * 一次 `segment-parts` 的响应。⚠️ **不校验 `cuts`**：那是 `segmentation.ts` 的
 * `startsFromResponse` 的职责，`cuts` 保持 `unknown` 原样传下去（在本模块再写一份判据 =
 * 第三份实现）；`rawCuts` / `rejected` 本模块只负责带出来（展示与否是另一个决定），所以只做形状级收口。
 */
export interface SegmentationResponse {
  /** 通过校验的切点（升序，1-based，恒不含第 1 页） */
  cuts: unknown;
  /** 与 `cuts` 一一对应的原文片段。后端从第一天就在回，前端此前一直丢掉 */
  evidence: unknown;
  /**
   * 模型原样给的切点（**未校验**）。`[]` = 后端**回了**这个字段、里面是空的；缺字段是 `undefined`
   * （**不是 `[]`**）—— 这条分界线就是「后端没回这个字段」（prod 还在旧后端时就是这样）与
   * 「回了、但是空的」之间的区别。
   * ⚠️ `[]` **不等于「模型弃权」**：后端把「模型回了空 cuts」与「输出没解析成那个形状」
   * （例如截断成非法 JSON）折叠成同一个空数组 —— 界面只能据此说「没拿到切点」，不许点名原因
   * （点错了会把管理员推向「改 prompt」，而真相可能是这次输出被截断）。
   * `rejected` 那边缺字段归一成 `[]` 无所谓：没有它时不显示任何「丢掉了几个」的结论。
   */
  rawCuts?: unknown[];
  rejected: SegmentationRejection[];
}

/** 后端 `rejected` → 类型化的数组。非数组、非对象、缺 `reason` 的一律丢掉 */
function normalizeRejections(raw: unknown): SegmentationRejection[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): SegmentationRejection[] => {
    if (!item || typeof item !== "object") return [];
    const { page, reason, evidence } = item as Record<string, unknown>;
    // 说不出理由的条目留着只会让界面显示一句空话 —— 理由正是这个字段存在的意义
    if (typeof reason !== "string" || !reason) return [];
    // 不是有限数字就是 `null`（`JSON.stringify(NaN)` 是 `"null"`，不显式挡会在本地与线上出现两种形状）
    const pageNo = typeof page === "number" && Number.isFinite(page) ? page : null;
    return [
      typeof evidence === "string" ? { page: pageNo, reason, evidence } : { page: pageNo, reason },
    ];
  });
}

/**
 * 分段第二步：把页文本交给 `segment-parts`，拿回切点**与「为什么没切」**。校验交给
 * `segmentation.ts` 的 `startsFromResponse`（它只信 `cuts`）。
 *
 * ⚠️ **不发文件名**（合订谱的文件名里写着 `_1,2,3,4`，会把模型锚定在「应该有 4 段」上），所以入参只有页数与各页窄带文本。
 */
export async function requestSegmentation(
  pageCount: number,
  pageTexts: PageText[],
): Promise<SegmentationResponse> {
  const { data, error } = await supabase.functions.invoke("segment-parts", {
    body: { pageCount, pages: pageTexts },
    timeout: LLM_TIMEOUT_MS,
  });
  if (error) throw new Error(`分段请求失败: ${await invokeErrorDetail(error)}`);
  if (!data?.success) {
    throw new Error(`分段失败: ${data?.error || data?.message || "未知错误"}`);
  }
  // `cuts` / `rawCuts` 缺字段就传 `undefined`（不补 `?? []`）：`startsFromResponse` 对「不是数组」同样处置成「不切」，补默认值却会抹平「后端没回字段」
  return {
    cuts: data.cuts,
    evidence: data.evidence,
    rawCuts: Array.isArray(data.rawCuts) ? data.rawCuts : undefined,
    rejected: normalizeRejections(data.rejected),
  };
}
