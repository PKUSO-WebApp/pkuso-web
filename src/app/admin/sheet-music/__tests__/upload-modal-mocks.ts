/**
 * `upload-modal-walk` 那套集成测试的**假依赖** —— 从测试文件里原样搬出来的（见 PR 描述的行区间对账）。
 *
 * 里面是：`@/lib/supabase` / `pdfjs-dist` 的 `vi.mock`（含 worker 那个）、jsdom 缺的 canvas 像素垫片
 * （`makePixels` + `beforeEach` 里挂上的 `getContext`/`toBlob`/`toDataURL`）、
 * 以及每个用例前后的状态复位。
 *
 * ## ⚠️ 用它的测试文件必须**先**导入它，再导入 `upload-modal.tsx`
 *
 * `vi.mock` 是**按模块求值时机**注册的，不是像测试文件里那样被 hoist 到 import 之上：
 * 被 mock 的模块若先求值，拿到的就是真实现（`@/lib/supabase` 会因缺 env 当场抛）。
 * 实测过：顺序反了必炸。**正常用法是从 `upload-modal-harness` 导入**（它在自己体内
 * 把这个模块排在 `../upload-modal` 之前），那样顺序天然正确。
 *
 * ## 为什么 `h` 从 `upload-modal-fixtures.ts` 导入而不是在这里定义
 *
 * 见那个文件的注释（棘轮 400 行 + 「带 vi.mock 的模块里转发 h 会得到 undefined」）。
 */
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { h, W, H, TITLE_TAG, FULL_TAG } from "./upload-modal-fixtures";

// 分析链路要跑 pdfjs 假实现 + 多次 Edge Function 往返，默认 5s 不够
vi.setConfig({ testTimeout: 20000 });

vi.mock("@/lib/supabase", () => {
  /**
   * PostgREST 的链式桩。`getOrCreatePart` 会走两条路：
   * `.select().eq().eq().maybeSingle()`（查不到）与 `.insert().select().single()`（建）。
   * 用一个对象同时支持两条，靠**最后调的方法**决定返回什么。
   */
  const partsTable = () => {
    let inserted: Record<string, unknown> | null = null;
    const api = {
      select: () => api,
      eq: () => api,
      maybeSingle: async () => ({ data: null, error: null }),
      insert: (row: Record<string, unknown>) => {
        inserted = row;
        return api;
      },
      single: async () => ({ data: { id: `part-${inserted?.section ?? "?"}` }, error: null }),
    };
    return api;
  };

  return {
    supabase: {
      auth: { getUser: vi.fn(async () => ({ data: { user: h.user } })) },
      from: vi.fn((table: string) => {
        if (table === "sheet_music_parts") return partsTable();
        if (table === "sheet_music_files") {
          return {
            // ⚠️ 上传走的是 `upsert(rows, { onConflict: "part_id,file_name" })` 而不是
            // `insert`（pkuso-backend#29 的唯一约束 + 重试幂等，见 `uploadOne`）。
            // `insert` 留在这里是给**其它**路径用的（若有），别删掉就当它不存在。
            upsert: async (rows: unknown, opts?: { onConflict?: string }) => {
              h.fileInserts.push(rows);
              h.upsertOnConflict = opts?.onConflict ?? null;
              // 落库成功就**提交**：后读到的就是新行（`existingFileRows` 的说明）
              if (!h.upsertError) {
                h.existingFileRows = (rows as typeof h.existingFileRows).map((r) => ({
                  part_id: r.part_id,
                  file_name: r.file_name,
                  storage_path: r.storage_path,
                }));
              }
              return { error: h.upsertError };
            },
            insert: async (rows: unknown) => {
              h.fileInserts.push(rows);
              return { error: null };
            },
            // 上传路径上的读只有一处：`replacedStoragePaths`（upsert 之前查同名旧行）
            select: () => ({
              in: async () => ({ data: h.existingFileRows, error: null }),
            }),
          };
        }
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
      }),
      storage: {
        from: vi.fn(() => ({
          upload: async (path: string, _body: unknown, opts?: { contentType?: string }) => {
            // 需要「上传还在飞」的窗口时挂在这里（phase === "uploading" 的禁用态要用它）
            if (h.uploadGate) await h.uploadGate;
            // 页图（image/jpeg）与 PDF 分开记：既有断言都在数「PDF 落点」，
            // 混在一起会被页图（页数 × 落点数 条）撑爆
            if (opts?.contentType === "application/pdf") {
              h.uploaded.push(path);
            } else {
              if (h.failPageUpload) return { error: { message: "页图上传失败（测试）" } };
              h.uploadedPages.push(path);
            }
            return { error: null };
          },
          // `removeSheetMusicObjects` 先 list 页图前缀、再合批 remove。这里的对象一律视为
          // 「没有页图」（页图那条路在 `storage-cleanup.test.ts` 里单测），只记 remove 的入参。
          list: async () => ({ data: [], error: null }),
          remove: async (paths: string[]) => {
            h.storageRemoves.push(paths);
            return { error: null };
          },
        })),
      },
      functions: {
        invoke: vi.fn(
          async (name: string, opts: { body: Record<string, unknown>; timeout?: number }) => {
            // 客户端上限（`functions.invoke` 的 `timeout`）逐次留档 —— 见 `h.invokeTimeouts`
            h.invokeTimeouts.push({ name, timeout: opts.timeout });
            if (name === "ocr-analyze") {
              // 需要「分段还在飞」的窗口时挂在这里（`segState === "running"` 的文案要用它）
              h.ocrStarted += 1;
              if (h.ocrGate) await h.ocrGate;
              const size = Buffer.from(String(opts.body.file_base64 ?? ""), "base64").toString();
              h.ocr.push(size);
              // success:false 那条路**不重试**（见 invokeOcr：「重试无意义」）—— 用它模拟
              // 「这张图读不出文字」，不会引入 OCR_RETRY_DELAYS 的 sleep
              if (h.ocrFail) return { data: { success: false }, error: null };
              // **拼图长图**：`overlay: true` 全仓只有 `segmentation-run.ts` 的 `ocrMosaic` 传，
              // 所以这条分支 = 「拼图那条路」。它必须回**坐标**（`pages[0].lines`），归页全靠它 ——
              // 逐页路线那两条分支都不带 `pages`，所以此前没人走过带坐标的回包。
              if (opts.body.overlay === true) {
                h.mosaicCalls += 1;
                h.mosaicSizes.push(size);
                const picH = Number(size.split("x")[1]);
                // n 行按坐标报在**收到的那张图**上（真实语义：坐标是这张图的像素坐标）。
                // ⚠️ 每页的高按「整张图 / 夹具声明的页数」均分，而不是按实现回给归页的那个
                // 除数 —— 两者不一致时（画布少画一条 / 除数写错）就会现形为**某些页一个字
                // 都归不到**，而不是被桩顺手抹平。
                const lines = Array.from({ length: h.mosaicBandCount }, (_, k) => ({
                  top: (k + 0.5) * (picH / h.mosaicBandCount),
                  text: h.mosaicBlankLines ? " " : `第${k + 1}页页眉`,
                }));
                return {
                  data: {
                    success: true,
                    // `text` 与 `lines` 是两个独立字段（同 `ocr-client.ts:120-129`）——
                    // `mosaicBlankLines` 造的正是「text 非空、行文本全空白」那个形态
                    text: h.mosaicBlankLines
                      ? "拼图整页文字（坐标行是空的）"
                      : lines.map((l) => l.text).join("\n"),
                    pages: [{ lines }],
                  },
                  error: null,
                };
              }
              // 窄带（页高 × BAND_PCT 那一小块）：给**逐页不同**的文本，编号按调用序。
              // 判据是「图很矮」—— 夹在**标题条**（`W x 85`，见 TITLE_TAG 的来历）与
              // **整页**（`W x 300` 上下）之间：默认页高下窄带是 45，两端的页高见 `h.pageHeights`。
              // ⚠️ 这三个常量（`OCR_MAX_SCALE`=3、`BAND_PCT`=0.15、页高）任一变大到把窄带顶过 60，
              // 这条分支就不再命中 —— 那时两条 prompt 会退化成同一个常量、断言**打红**（不是静默变绿），
              // 但要照着这里才能看懂报错。
              if (Number(size.split("x")[1]) < 60) {
                // 窄带 OCR 只服务分段，所以调用序 = 页序
                h.bandCalls += 1;
                h.bandSizes.push(size);
                if (h.bandFailFor.includes(h.bandCalls)) {
                  return { data: { success: false }, error: null };
                }
                if (h.bandEmptyFor.includes(h.bandCalls)) {
                  // 成功但空串（图上没有字）。⚠️ 也占住 `bandTexts` 的位置（见那里的注释）
                  h.bandTexts.push("");
                  return { data: { success: true, text: "" }, error: null };
                }
                // 页号取**调用序**而不是 `bandTexts.length`：失败的那页不入数组，
                // 用长度当页号会让后面每一页的文本都往前错一位（编造出一个假的页序）
                const text = `第${h.bandCalls}页页眉`;
                h.bandTexts.push(text);
                return { data: { success: true, text }, error: null };
              }
              // 高图。`bandCalls > 0` 之后来的那一张只可能是**补救**（见 `retakeStub` 的说明）；
              // 分析路径的高图都在窄带之前，不受这个开关影响。
              // ⚠️ 先处理**请求报错**：与 `success: false` 是两条路；形态与理由见 `h.ocrError`。
              const errMode =
                size === TITLE_TAG
                  ? h.ocrError?.title
                  : size === FULL_TAG
                    ? h.ocrError?.full
                    : undefined;
              if (errMode === "transient") {
                return {
                  data: null,
                  error: {
                    name: "FunctionsFetchError",
                    message: "Failed to send a request to the Edge Function",
                    context: { name: "AbortError", message: "aborted" },
                  },
                };
              }
              if (errMode === "permanent") {
                return {
                  data: null,
                  error: {
                    context: new Response(JSON.stringify({ error: "bad request（测试）" }), {
                      status: 400,
                    }),
                  },
                };
              }
              if (h.bandCalls > 0) {
                h.retakeStarted += 1;
                if (h.retakeGate) await h.retakeGate;
                if (h.retakeStub === "fail") return { data: { success: false }, error: null };
                if (h.retakeStub === "empty")
                  return { data: { success: true, text: "" }, error: null };
              }
              return { data: { success: true, text: "PMLASIA 出版社 编号" }, error: null };
            }
            if (name === "llm-analyze") {
              const text = String(opts.body.ocr_text ?? "");
              // ⚠️ 文件名是**另一个字段**（pkuso-web#300 之后）：以前它拼在 `ocr_text`
              // 第一行里，所以「这次调用带没带文件名」可以直接看文本 —— 现在不行了。
              // 桩必须把两个字段都记下来，否则 `llmFailFor` 匹配不上、也分不出段级调用。
              const fileName = typeof opts.body.file_name === "string" ? opts.body.file_name : "";
              h.llm.push(text);
              h.llmFileNames.push(fileName);
              // 需要「分析还在飞」的窗口时挂在这里（真实 LLM 要几秒到几十秒）
              if (h.llmGate) await h.llmGate;
              // LLM 失败走 `error` 那条路：`analysis.ts` 的 `runLlmAnalysis` 会抛，而**抛出来的异常该让整行
              // 落 `status: "error"`**，不该被降级 catch 吞掉再补一次「只凭文件名」的调用
              if (h.llmFail || h.llmFailFor.some((n) => text.includes(n) || fileName.includes(n))) {
                return { data: null, error: { message: "boom" } };
              }
              // 按**文件名**给的答案最优先（`llmReplyFor`）—— 同一次分析里要让两份文件
              // 状态不同时用它：`llmReplies` 那个队列按调用顺序取，而哪一份先跑完
              // OCR 是不受控的，会变成偶发。
              const byName = Object.entries(h.llmReplyFor).find(([n]) => fileName.includes(n))?.[1];
              // 其次是按调用顺序取的答案（见 `llmReplies`）
              const perCall = byName ?? h.llmReplies.shift();
              return { data: perCall ?? h.llmReply, error: null };
            }
            if (name === "segment-parts") {
              // 请求体留档：归页的结果与页文本真正交给后端的就是它（两条抛错分支也经过这里）
              h.segmentBody = opts.body as { pageCount?: number; pages?: unknown };
              // 两条抛错分支各要一条用例（#317：这个桩此前只会成功）
              if (h.segmentFail === "error") {
                return { data: null, error: { message: "boom-seg" } };
              }
              if (h.segmentFail === "soft") {
                return { data: { success: false, error: "no-cuts" }, error: null };
              }
              return {
                data: { success: true, cuts: h.segmentCuts, ...h.segmentExtra },
                error: null,
              };
            }
            return { data: null, error: { message: `未预期的调用 ${name}` } };
          },
        ),
      },
    },
  };
});

vi.mock("pdfjs-dist", () => ({
  getDocument: () => {
    // 打开计数：补救会**再打开一次**（`documentFailForRetake` 靠它认那一次）
    h.documentOpens += 1;
    if (h.bandCalls > 0) h.retakeOpens += 1;
    // ⚠️ 判据是「窄带**已经在发** OCR 请求了」：窄带那条路是先打开文档、再逐页渲染+送检，
    // 所以「`bandCalls > 0` 之后的下一次打开」只可能是**补救自己重读文件**那一次。
    // （用调用序号写死「第 2 次/第 3 次」会在管线里多出一次打开时静静指错地方。）
    if (h.loadFail || (h.documentFailForRetake && h.bandCalls > 0)) {
      return { promise: Promise.reject(new Error("坏 PDF")), destroy: async () => {} };
    }
    return {
      promise: Promise.resolve({
        numPages: h.pages,
        getPage: async (n: number) => {
          // 「哪几页真的被取过」—— 走没走到下一页的直接证据（`Math.min` 夹取、取消判据都用它）
          h.pagesFetched.push(n);
          return {
            getViewport: ({ scale }: { scale: number }) => ({
              width: 100 * scale,
              height: (h.pageHeights[n - 1] ?? 100) * scale,
            }),
            // 指定页渲染失败：那条「就地消化、不判死整份」的分支否则一条测试都跑不到
            render: () =>
              h.renderFailPages.includes(n)
                ? { promise: Promise.reject(new Error("图像解码失败")) }
                : { promise: Promise.resolve() },
            cleanup: () => {},
            getOperatorList: async () => ({ fnArray: [] }),
          };
        },
      }),
      destroy: async () => {},
    };
  },
  OPS: { paintImageXObject: 1, paintImageXObjectRepeat: 2, paintInlineImageXObject: 3 },
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs", () => ({}));

/**
 * 造一页「有标题区、下面有乐谱」的像素：第一组 5 条谱线（间距 3px，落在页高 28.3%）
 * 外加其下一组 3 条。这是 `findFirstStaffLine` 要求的完整形态（5 条成组 + 下方还有一组），
 * 于是这一页会被真的裁出标题区 —— 而「裁出来了」正是本文件所有断言的前提。
 */
function makePixels() {
  const d = new Uint8ClampedArray(W * H * 4).fill(255);
  for (const y of [85, 88, 91, 94, 97, 120, 123, 126]) {
    for (let x = 0; x < 200; x++) {
      const i = (y * W + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 0;
    }
  }
  return d;
}

beforeEach(() => {
  h.ocr.length = 0;
  h.ocrStarted = 0;
  h.invokeTimeouts.length = 0;
  h.llm.length = 0;
  h.llmFileNames.length = 0;
  h.pageHeights = [100, 100, 100];
  h.bandTexts.length = 0;
  h.bandSizes.length = 0;
  h.mosaicCalls = 0;
  h.mosaicSizes.length = 0;
  h.draws.length = 0;
  h.mosaicBandCount = 3;
  h.mosaicBlankLines = false;
  h.ocrFail = false;
  h.ocrError = null;
  h.llmFail = false;
  h.loadFail = false;
  h.pagesFetched = [];
  h.renderFailPages = [];
  h.pages = 3;
  h.user = null;
  h.onClose.mockClear();
  h.llmReply = { success: true, section: "", instrument: "", subParts: [], isFullScore: false };
  h.fileInserts.length = 0;
  h.upsertOnConflict = null;
  h.upsertError = null;
  h.uploaded.length = 0;
  h.uploadedPages.length = 0;
  h.existingFileRows = [];
  h.storageRemoves.length = 0;
  h.failPageUpload = false;
  h.llmFailFor = [];
  h.llmGate = null;
  h.uploadGate = null;
  h.ocrGate = null;
  h.segmentFail = null;
  h.segmentBody = null;
  h.bandFailFor = [];
  h.bandEmptyFor = [];
  h.retakeStub = null;
  h.documentFailForRetake = false;
  h.documentOpens = 0;
  h.retakeOpens = 0;
  h.retakeGate = null;
  h.retakeStarted = 0;
  h.bandCalls = 0;
  h.segmentCuts = [2];
  // ⚠️ 必须清空（同下面 `llmReplies` 的理由）：它是个追加字段的口袋，
  // 用例中途失败时里面会**留下上一条用例塞的东西** —— 而「响应里没有 rawCuts」
  // 与「rawCuts 是空的」在界面上是两句不同的话（见 `segmentExtra` 的说明）。
  h.segmentExtra = {};
  // ⚠️ 必须清空：mock 里是 `shift()` 按调用顺序取答案，用例中途失败时数组里会**剩下几条**
  // —— 不清的话后面所有用例的 LLM 回包都被顶掉，报错指向无辜的用例。
  h.llmReplies.length = 0;
  h.llmReplyFor = {};
  const pixels = makePixels();
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    // `this` 是目标画布 —— 尺寸在 `getContext` 之前就设好了（各调用点都这样），
    // 所以箭头函数里读到的就是「这张画布多大」。
    return {
      fillStyle: "",
      fillRect: () => {},
      // 目标纵偏移在两种重载里位置不同：三段/五段式 `(图, dx, dy, …)` 是第 3 个实参，
      // 九段式 `(图, sx, sy, sw, sh, dx, dy, …)` 是第 7 个（第 3 个那里是 **源** 纵偏移）。
      // **必须按实参个数取** —— 否则把同一条调用改写成等价的九段式（`segmentation-run.ts`
      // 下游就有一处这么写的）会记到 `sy`，让画对了的实现被判红。
      drawImage: (...args: unknown[]) => {
        const dy = Number(args.length >= 9 ? args[6] : args[2]);
        h.draws.push({ w: this.width, h: this.height, dy });
      },
      getImageData: (_x: number, _y: number, w: number, hh: number) => ({
        data: pixels,
        width: w,
        height: hh,
      }),
    };
  } as never;
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    cb(new Blob([`${this.width}x${this.height}`], { type: "image/jpeg" }));
  };
  HTMLCanvasElement.prototype.toDataURL = () => "data:image/jpeg;base64,AAAA";
});

afterEach(() => {
  cleanup();
  // 拼图桩是**逐条用例**装的（装上它整条路就变了），不许漏在全局
  delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
});
