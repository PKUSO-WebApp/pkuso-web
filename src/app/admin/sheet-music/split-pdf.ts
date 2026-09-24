/**
 * 合订谱的**物理切分**（pkuso-web#290 Step 2）。
 *
 * 与 `segmentation.ts` 的分工：那边算「哪几页是一份」（纯数字），这边把 PDF 真的切开。
 * 单独成模块的理由同 `staff-line.ts` / `sub-parts.ts`：拒绝线那几条判据是纯函数，
 * 必须能被测试直接 import。
 *
 * ## 为什么又是 pdf-lib
 *
 * ⚠️ 先把历史说准：**本仓库（pkuso-web）从来没有装过 pdf-lib**。被它坑过的是
 * **后端 `ocr-analyze`** —— 那里用它抽首页，而它的内存模型是「整本常驻供编辑」，
 * 与「批量只看第一页」拧着，于是崩在 ArrayBuffer 外部内存分配上；前端这边一直是
 * pdf.js（换的是后端那条链路）。所以这次不是走回头路：切分要的正是 pdf-lib 的强项 ——
 * `copyPages` **只搬 PDF 对象、不解码图像流**，那个内存炸弹不在切分环节。
 *
 * 这不是推断，是实测（探针数据见 #290 的评论）：最重的 12 份语料（含 82 页总谱
 * 11.6MB）在「pdf.js 渲染 ∥ pdf-lib 切分**同一份 buffer**」下 **12/12 页面存活**；
 * 切出来的 **224/224 页与原文件逐像素相同**。
 *
 * ⚠️ 判据只能是「页面活没活下来」：两个库的 ArrayBuffer 都**不计入** `usedJSHeapSize`，
 * 而当初爆掉的正是那一部分 —— 量不到的东西不能当判据。
 *
 * ## 用法上的一条硬约束
 *
 * **一份文件只 load 一次，切一份、传一份、立刻丢**（见 `openForSplit` 与调用方）。
 * 逐段各 load 一次会让峰值变成 N 倍源文件，正是探针要防的那个形状。
 */

/**
 * 拒绝线：**病理输入宁可不切**，让用户人工处理（保守降级优于崩浏览器）。
 *
 * 这三条不是「经验值」，是「明显病态」的下界：实测过的最重语料是 11.6MB / 82 页，
 * 在并发下都稳；走到这几条线上的是几百页 / 几百 MB 的整本扫描件 —— 那种输入下
 * 浏览器可能直接分配不出 ArrayBuffer，而**切到一半失败会留下传了一半的组**。
 */
export const SPLIT_MAX_BYTES = 80 * 1024 * 1024;
export const SPLIT_MAX_PAGES = 400;
export const SPLIT_MAX_SEGMENTS = 16;

/** 拒绝理由（`null` = 可以切）。文案直接给用户看，要说清「怎么办」 */
export function splitRefusal(input: {
  byteSize: number;
  pageCount: number;
  segTotal: number;
}): string | null {
  if (!Number.isSafeInteger(input.pageCount) || input.pageCount < 1) {
    return "页数未知，无法切分 —— 请先让它分析成功，或人工切好再逐个上传";
  }
  if (input.segTotal < 2) return "只有一段，无需切分";
  if (input.segTotal > SPLIT_MAX_SEGMENTS) {
    return `段数太多（${input.segTotal} 段）—— 请人工切分后逐个上传，避免浏览器内存不足`;
  }
  if (input.pageCount > SPLIT_MAX_PAGES) {
    return `页数太多（${input.pageCount} 页）—— 请人工切分后逐个上传`;
  }
  if (input.byteSize > SPLIT_MAX_BYTES) {
    const mb = Math.round(input.byteSize / 1048576);
    return `文件太大（${mb}MB）—— 请人工切分后逐个上传`;
  }
  return null;
}

/** 从一段的闭区间算出 pdf-lib 要的 0-based 页下标。越界/空区间返回 null */
export function pageIndices(from: number, to: number, pageCount: number): number[] | null {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to)) return null;
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) return null;
  if (from < 1 || to > pageCount || from > to) return null;
  const out: number[] = [];
  for (let p = from; p <= to; p++) out.push(p - 1);
  return out;
}

/**
 * 同一组里**重名**的下标（无重名 = 空数组）。
 *
 * 切分的产物是按文件名区分的：4 段都叫「圆号.pdf」的话，用户在详情页看到 4 个一模一样的
 * 名字，谁也分不清哪份是哪份 —— 而它们的号本来就在文件名里（`圆号1.pdf`）。
 * 所以这一组内部**必须**靠名字能区分；组与组之间不管（不同乐器重名很正常）。
 *
 * 判据用「谁与前面的人重名就标谁」，于是第一份总是放行、用户只需要改被标出来的那几份。
 */
export function duplicateNames(names: string[]): number[] {
  const seen = new Set<string>();
  const dup: number[] = [];
  names.forEach((n, i) => {
    const key = n.trim();
    if (key !== "" && seen.has(key)) dup.push(i);
    seen.add(key);
  });
  return dup;
}

/** 一份可以切分的源文件。**同一份只开一次**，切完丢掉引用即释放 */
export interface SplitSource {
  pageCount: number;
  /** 取 [from,to]（1-based 闭区间）切出一份新的 PDF 字节。区间非法时抛错 */
  extract(from: number, to: number): Promise<Uint8Array>;
}

/**
 * 打开一份 PDF 供切分。**动态 import**：pdf-lib 只在真的要切分时才下载，
 * 不进主包 —— 大多数导入根本没有合订谱，没必要为它付首屏体积。
 */
export async function openForSplit(file: File): Promise<SplitSource> {
  const { PDFDocument } = await import("pdf-lib");
  const bytes = new Uint8Array(await file.arrayBuffer());
  // updateMetadata: false —— 不改元数据就没有额外写入路径。
  //
  // ⚠️ **不给 `ignoreEncryption`**（虽然探针里给过）：pdf-lib 没有解密能力，
  // 忽略加密只意味着「照样读」，`copyPages` 搬出来的流**仍是加密的**、而 /Encrypt
  // 已经不在新文档里 —— 那会切出一份**打不开的文件**，而它在界面上看起来完全成功。
  // 不加这个选项时，加密的 PDF 会在 `load` 当场抛 `EncryptedPDFError`，用户得到一句明确的
  // 「切分失败」，然后**先点「还原为一份」**再整份上传（那条路本来就能用 —— 拆分已经把原行
  // 换成了 N 段行，所以退回那一步是必须的）。
  // 实测 58 份真实语料**没有一份加密**，所以这条严格化不影响任何现有文件。
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pageCount = doc.getPageCount();

  return {
    pageCount,
    async extract(from: number, to: number) {
      const idx = pageIndices(from, to, pageCount);
      if (!idx) throw new Error(`页区间非法：${from}-${to}（共 ${pageCount} 页）`);
      const out = await PDFDocument.create();
      // copyPages 只搬对象、不解码图像流 —— 这正是切分能扛住大扫描件的原因
      for (const page of await out.copyPages(doc, idx)) out.addPage(page);
      // useObjectStreams: false —— 输出略大，但少一层打包，峰值更可控（探针用的就是这个）
      return out.save({ useObjectStreams: false });
    },
  };
}
