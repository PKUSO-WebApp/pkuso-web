/**
 * `upload-modal-walk` 那套集成测试的**夹具状态与几何常量** —— 从测试文件里原样搬出来的，
 * 一个字没改（见 PR 描述里的行区间对账）。
 *
 * ## 为什么单独一个模块
 *
 * 这里是「假世界的可变状态」（`h`）与「假世界的尺寸常量」（`W`/`H`/`TITLE_TAG`/`FULL_TAG`）。
 * 它必须与 `upload-modal-mocks.ts` 分开，只有一条硬理由：**设计债棘轮按 400 行卡非测试文件**，
 * 而 `h` 的字段注释与假依赖的工厂加起来超过了 400 行。
 *
 * ## ⚠️ 两条实测出来的约束（改这个文件前先读）
 *
 * 1. **`h` 不能用 `export const h = vi.hoisted(...)` 导出** —— vitest 的 hoisting 变换
 *    直接报 `SyntaxError: Cannot export hoisted variable`。写成「先声明、再用导出列表」
 *    （`const h = vi.hoisted(...)` + `export { h }`）才过：那个检查看的是**声明本身**
 *    有没有被包在 `ExportNamedDeclaration` 里。
 * 2. **不要从这个模块转发 `h` 之外的运行时依赖**，也不要在**带 `vi.mock` 的模块**里
 *    写 `export { h }` 转发 —— 实测那种组合下转发出去的是 `undefined`（`h` 在工厂里是好的，
 *    在导入方却是 undefined）。所以本文件不含任何 `vi.mock`，转发只发生在
 *    `upload-modal-harness.tsx`（那个模块没有 `vi.mock`）。
 */
import { vi } from "vitest";

/** 假页面 100×100pt、scale 3 → 300×300 的 canvas；`OCR_TARGET_LONGEST_SIDE=2400` 时
 *  fitScale = 24，被 `OCR_MAX_SCALE=3` 封顶，所以缩放后正好是 300×300。 */
const W = 300;
const H = 300;

/** 交给 OCR 的图的「身份」：`toBlob` 把画布尺寸写成字节，于是 base64 解回来能区分
 *  标题区（300x85）与整页（300x300）—— 这是本文件唯一能分辨「送了哪张」的手段。 */
const TITLE_TAG = `${W}x85`;
const FULL_TAG = `${W}x${H}`;

const h = vi.hoisted(() => ({
  ocr: [] as string[],
  /**
   * **发出去了**几次 `ocr-analyze`（在 `ocrGate` **之前**记）。
   *
   * `h.ocr` 记的是「回包了」几次 —— 判「请求已经在飞」只能用这个：门挂着的时候
   * `h.ocr` 一个都不涨，而那正是这一类用例要卡住的位置（同 `bandCalls` 与 `bandTexts` 的分别）。
   */
  ocrStarted: 0,
  /**
   * 每次 `functions.invoke` 的**字段名 + `timeout`**，按调用顺序。
   *
   * ⚠️ 这个桩此前**根本不记 `timeout`**，于是三处调用点（`ocr-client`、`analysis`、
   * `segmentation-run`）声明的客户端上限在全仓测试里**零引用**：删掉 `timeout: …` 那一行、
   * 或把常量改成 0，整套照绿 —— 而线上表现是「链路上任何一段挂住都让 `await` 永不 settle：
   * UI 一直转圈且不报错」（那几处注释讲的正是这件事，却一直只有注释）。
   */
  invokeTimeouts: [] as { name: string; timeout?: number }[],
  llm: [] as string[],
  ocrFail: false,
  llmFail: false,
  loadFail: false,
  /** `pdf.getPage(n)` 取过的页号，按顺序 —— 「这一段有没有真的走到下一页」的直接观察量 */
  pagesFetched: [] as number[],
  renderFailPages: [] as number[],
  pages: 3,
  /**
   * 逐页的页高（pt）。默认等高。
   *
   * 它决定 pdfjs 桩渲染出的页高（下面 `getPage` 的 `height`），也就决定窄带的像素高
   * （`round(canvas.height × BAND_PCT)`）—— OCR 桩靠「图很矮」认出窄带。买的是**渲染尺寸**。
   *
   * ⚠️ 默认环境下它买不到「不等高 ⇒ 不拼图」：jsdom 没有 `createImageBitmap`，
   * `composeMosaic` 的第一句就抛，抛在「本组必须等高」那条判据**之前**，被
   * `ocrBandsForSegmentation` 的逐组 catch 吞掉、退回逐页（两者都在 `segmentation-run.ts`）——
   * 于是「不等高」与「等高」在这里没有区别。要走通那条判据（以及整条拼图成功路径），
   * 必须先 `installMosaicStub()`（见那里）。这不等于「测试环境判不了」：
   * 环境缺的东西是可以补的，补上之后两条路各自可辨。
   */
  pageHeights: [100, 100, 100] as number[],
  /**
   * OCR 桩为**窄带**（矮图）返回过的文本，按调用顺序 —— 也就是页序。
   *
   * ⚠️ 只在**逐页**那条路上增长；拼图那条路若真成功，这里会是空的（拼图是一张图一次调用）。
   */
  bandTexts: [] as string[],
  /**
   * 窄带那条路上**送给 OCR 的图的尺寸**（`宽x高`），按调用顺序。
   *
   * 它是「页序」在页高不等时**唯一**的可观察量：桩回的文本是按调用序编号的，
   * 渲染循环倒着走也照样对得上（`bandTexts` 看不出来），而尺寸来自**那一条**窄带本身 ——
   * 倒序 = 第 1 页拿到第 3 页的窄带，尺寸序列会反过来。
   */
  bandSizes: [] as string[],
  /**
   * 拼图那张长图的 OCR 调用次数。
   *
   * 判据是 `overlay: true` —— 全仓只有 `segmentation-run.ts` 的 `ocrMosaic` 传它，
   * 所以这个计数就是「拼图那条路真的走通了」本身。逐页路线与它互斥（`bandCalls`）。
   */
  mosaicCalls: 0,
  /** 拼图长图的尺寸（`宽x高`），按调用顺序 */
  mosaicSizes: [] as string[],
  /**
   * 每一次 `ctx.drawImage` 的落点：目标画布尺寸 + 纵偏移。
   *
   * 记它是因为**画到哪**和**画布多大**是两回事（jsdom 里 `drawImage` 本身不画像素）：
   * 画布高度对了、可三条窄带全叠在 `y=0`，长图上就只剩最后一条 —— 而 OCR 桩按收到的
   * 图高现算坐标，这条用例看起来仍然全绿。只比尺寸会漏掉这一维。
   */
  draws: [] as { w: number; h: number; dy: number }[],
  /**
   * 夹具声明「这一张拼图里有几页」。
   *
   * ⚠️ **不能从收到的那张图反推**（`高 / 每页高`）：那样正好把「画布少画了一条窄带」
   * 这类缺陷抹平 —— 桩会跟着实现一起把行挤进更小的坐标里，归页看着还是对的。
   * 桩的语义是「上游把 n 行按坐标报在**它收到的那张图**上」（真实语义如此：
   * 坐标就是它所收图片的像素坐标），页数只能由夹具说。
   */
  mosaicBandCount: 3,
  /**
   * 拼图的坐标行全是空白（`top` 都合法、`data.text` 非空）——
   * 造「坐标都在，但一行都没归到任何页」那个形态。
   *
   * 可达性：`data.text` 与 `pages[0].lines` 是**两个独立字段**（`ocr-client.ts:120-129`），
   * 上游在块之间回空白行是常态，于是「有文字、但每一行都归不到页」真实存在。
   */
  mosaicBlankLines: false,
  /** 登录用户。`null` = 未登录（`confirmUpload` 会 alert 并返回） */
  user: null as { id: string } | null,
  /**
   * 弹窗的「关闭」回调。**用 spy 而不是 `() => {}`**（#317）：此前一律传空函数，于是
   * 「取消接错成别的动作」这类改动全套全绿（对抗测试实测：`onClose={startSegmentation}`
   * 会让点「取消」真的去烧 OCR，而那一批里一条都不红）。
   */
  onClose: vi.fn(),
  /** LLM 成功时回什么。默认「一律未识别」—— 那正是要逼出回退/升级的那种输入 */
  llmReply: {
    success: true,
    section: "",
    instrument: "",
    subParts: [] as number[],
    isFullScore: false,
  } as Record<string, unknown>,
  /** `sheet_music_files` 每次 `.insert()` 的入参（**调用次数**本身就是要断言的东西） */
  fileInserts: [] as unknown[],
  /** 最近一次 `upsert` 的 `onConflict` —— 它必须与后端那条唯一约束逐字对应 */
  upsertOnConflict: null as string | null,
  /** 非 null 时 `upsert` 回这个错（模拟唯一冲突等落库失败） */
  upsertError: null as { code: string; message: string } | null,
  /** `storage.upload` 收到的路径 */
  uploaded: [] as string[],
  /** 页图对象的上传路径（contentType image/jpeg，见 page-previews.ts），与 PDF 分开记 */
  uploadedPages: [] as string[],
  /**
   * `sheet_music_files` 里**已存在的行**（`part_id` + `file_name` + `storage_path`）。
   *
   * ⚠️ 这个桩是**有状态**的：`upsert` 成功之后它就是那批新行（真库也是这样）。于是
   * 「先读旧行、再 upsert、最后删旧对象」这条顺序**可被检测** —— 读被挪到 upsert 之后，
   * 读回来的是新路径，就没有对象可删了（#387 的回归就是这条顺序）。
   */
  existingFileRows: [] as { part_id: string; file_name: string; storage_path: string }[],
  /** `storage.remove` 每次收到的路径 —— 「被替换掉的旧对象真的被删了」看它 */
  storageRemoves: [] as string[][],
  /** 置 true 时页图上传返回 error（造「页图失败」路径，#378） */
  failPageUpload: false,
  /** 只想让**某几个文件**的 LLM 失败时用（OCR 文本里含这些名字就失败） */
  llmFailFor: [] as string[],
  /**
   * 非 null 时所有 LLM 调用都挂在这里，直到测试放行。
   * 用途是**造出「分析还在飞」的窗口** —— 真实的一次 LLM 调用要几秒到几十秒
   *（`analysis.ts` 的 `LLM_TIMEOUT_MS` 是它的上限），而
   * 「飞行中能不能改行集」这个判据只在那段窗口里才存在（对抗测试实测出来的缺口）。
   */
  llmGate: null as null | Promise<void>,
  /** 同 llmGate，但挂在 storage.upload 上 —— 「上传飞行中」那个相位只有挂住它才到得了 */
  uploadGate: null as null | Promise<void>,
  /** 同 llmGate，但挂在 ocr-analyze 上 —— `segState === "running"` 那个相位只有挂住它才到得了 */
  ocrGate: null as null | Promise<void>,
  /**
   * `segment-parts` 的失败形态：`"error"` = 传输层报错，`"soft"` = 回了 `success: false`。
   * 两条都是 `requestSegmentation` 的抛错分支（#317 实测：这个桩此前**只会成功**）。
   */
  segmentFail: null as null | "error" | "soft",
  /** 让**第 N 页**的窄带 OCR 失败（页序 = 调用序，见 `bandCalls`）—— 造「有几页没读到」 */
  bandFailFor: [] as number[],
  /** 窄带 OCR 的调用计数。**不能拿 `bandTexts.length` 当页号**：失败的那页不入数组，会错位 */
  bandCalls: 0,
  /** `segment-parts` 回什么 cuts（3 页 → `[2]` 即两段） */
  segmentCuts: [2] as number[],
  /**
   * **追加**到 `segment-parts` 成功回包里的字段 —— 也就是 `evidence` / `rawCuts` / `rejected`
   * 这三个「为什么没切」的字段（`SegmentationResponse`）。
   *
   * ⚠️ 默认**缺席**：prod 现在还在没有这三个字段的后端上，而「缺字段 ⇒ 界面不许说『模型弃权』」
   * 恰恰是一条要测的判据（`seg-evidence.tsx`）。要测「后端回了、但是空的」就显式给 `rawCuts: []`。
   */
  segmentExtra: {} as Record<string, unknown>,
  /** `segment-parts` 最近一次的**请求体** —— 归页与页文本真正交给后端的那一份 */
  segmentBody: null as { pageCount?: number; pages?: unknown } | null,
  /**
   * 按**调用顺序**逐个回不同的答案（用光之后回落到 `llmReply`）。
   *
   * 需要它是因为「段级识别」现在**不带任何可辨识的标记**了 —— 段级调用不发文件名，
   * 而各段的首页文本在桩里又是常量，于是「这一份是哪一段」只能靠调用顺序区分。
   * 用它复刻真机上出问题的那份：整份 `[1,2]`、第 1 段 `[1]`、第 2 段 `[2]`。
   */
  llmReplies: [] as Record<string, unknown>[],
  /**
   * 按**文件名**给不同答案（优先于 `llmReplies` / `llmReply`）。
   *
   * ⚠️ 匹配口径是 `fileName.includes(键)`，三个坑：① 只匹配文件名，不像 `llmFailFor` 那样
   * 还看 OCR 文本；② `Object.entries` 的**首个命中胜出** —— 键互为前缀时（`a.pdf` 与
   * `1a.pdf`）先插的那个会劫持；③ **空串键会匹配所有调用**（段级调用不带文件名 ⇒
   * `fileName === ""`，而 `"".includes("")` 为真）。键取有区分度的整名即可。
   *
   * 需要它是因为「同一次分析里两份文件状态不同」**不能**靠 `llmReplies` —— 那个队列按
   * **调用顺序**取，而哪一份先跑完 OCR 是不受控的。这里按名字取，与顺序无关。
   */
  llmReplyFor: {} as Record<string, Record<string, unknown>>,
  /**
   * 每次 `llm-analyze` 调用带的 `file_name`（与 `llm` 逐位对应；空串 = 没带）。
   *
   * ⚠️ **判「这是段级调用吗」只能靠它**：拆字段之后，段级调用**不带文件名**，
   * 而整份调用带 —— 以前那个「文本里含不含『文件名:』」的判据在拆完之后对两者都成立，
   * 于是「两段各问了一次」这种断言会数出 3 次（把整份那次也算进来）。
   */
  llmFileNames: [] as string[],
}));

export { h, W, H, TITLE_TAG, FULL_TAG };
