/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UploadModal } from "./upload-modal";

// 分析链路要跑 pdfjs 假实现 + 多次 Edge Function 往返，默认 5s 不够
vi.setConfig({ testTimeout: 20000 });

/**
 * 升级链的**集成**测试 —— 真的跑 `renderPagesForAnalysis` 那个循环和 `analyzeOne` 的
 * `tryPage`，用假 pdfjs + 假 canvas 像素 + 假 Edge Function 驱动。
 *
 * ## 为什么必须有这一个文件
 *
 * 对抗测试用变异证明了**只钉两个纯函数不够**：把 `analyzeOne` 里那句
 * `if (analysisSettled(got)) return true;` 改回 `return analysisSettled(got)`
 * （后果是「整页」那张图变成死代码、旧版那条回退静默消失），
 * **原有那套测试全绿、一条都不红** —— 因为没有任何测试执行到 `tryPage` 或那个循环。
 * 这个文件补的就是它：断言的是「**哪几张图真的被送出去了**」，不是判据本身。
 *
 * 下面每条用例都钉着一条被对抗测试击破的缺陷 —— 「整页也被送检」「OCR 读不出不终止
 * 链条」「OCR 全失败保住页数」「LLM 失败 = 整行失败」—— 各自做过变异验证：
 * 把对应的实现改回去，那一条就变红，且报错里能直接看出少送了哪张图。
 */

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
  llm: [] as string[],
  ocrFail: false,
  llmFail: false,
  loadFail: false,
  renderFailPages: [] as number[],
  pages: 3,
  /** 登录用户。`null` = 未登录（`confirmUpload` 会 alert 并返回） */
  user: null as { id: string } | null,
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
  /** `storage.upload` 收到的路径 */
  uploaded: [] as string[],
  /** 只想让**某几个文件**的 LLM 失败时用（OCR 文本里含这些名字就失败） */
  llmFailFor: [] as string[],
  /**
   * 非 null 时所有 LLM 调用都挂在这里，直到测试放行。
   * 用途是**造出「分析还在飞」的窗口** —— 真实的一次 LLM 调用要几秒到几十秒（前端 LLM_TIMEOUT_MS 45s 是它的上限），而
   * 「飞行中能不能改行集」这个判据只在那段窗口里才存在（对抗测试实测出来的缺口）。
   */
  llmGate: null as null | Promise<void>,
  /** `segment-parts` 回什么 cuts（3 页 → `[2]` 即两段） */
  segmentCuts: [2] as number[],
}));

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
            insert: async (rows: unknown) => {
              h.fileInserts.push(rows);
              return { error: null };
            },
          };
        }
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
      }),
      storage: {
        from: vi.fn(() => ({
          upload: async (path: string) => {
            h.uploaded.push(path);
            return { error: null };
          },
        })),
      },
      functions: {
        invoke: vi.fn(async (name: string, opts: { body: Record<string, unknown> }) => {
          if (name === "ocr-analyze") {
            h.ocr.push(Buffer.from(String(opts.body.file_base64 ?? ""), "base64").toString());
            // success:false 那条路**不重试**（见 invokeOcr：「重试无意义」）—— 用它模拟
            // 「这张图读不出文字」，不会引入 OCR_RETRY_DELAYS 的 sleep
            if (h.ocrFail) return { data: { success: false }, error: null };
            return { data: { success: true, text: "PMLASIA 出版社 编号" }, error: null };
          }
          if (name === "llm-analyze") {
            const text = String(opts.body.ocr_text ?? "");
            h.llm.push(text);
            // 需要「分析还在飞」的窗口时挂在这里（真实 LLM 要几秒到几十秒）
            if (h.llmGate) await h.llmGate;
            // LLM 失败走 `error` 那条路：`runLlmAnalysis` 会抛，而**抛出来的异常该让整行
            // 落 `status: "error"`**，不该被降级 catch 吞掉再补一次「只凭文件名」的调用
            if (h.llmFail || h.llmFailFor.some((n) => text.includes(n))) {
              return { data: null, error: { message: "boom" } };
            }
            return { data: h.llmReply, error: null };
          }
          if (name === "segment-parts") {
            return { data: { success: true, cuts: h.segmentCuts }, error: null };
          }
          return { data: null, error: { message: `未预期的调用 ${name}` } };
        }),
      },
    },
  };
});

vi.mock("pdfjs-dist", () => ({
  getDocument: () => {
    if (h.loadFail) {
      return { promise: Promise.reject(new Error("坏 PDF")), destroy: async () => {} };
    }
    return {
      promise: Promise.resolve({
        numPages: h.pages,
        getPage: async (n: number) => ({
          getViewport: ({ scale }: { scale: number }) => ({
            width: 100 * scale,
            height: 100 * scale,
          }),
          // 指定页渲染失败：那条「就地消化、不判死整份」的分支否则一条测试都跑不到
          render: () =>
            h.renderFailPages.includes(n)
              ? { promise: Promise.reject(new Error("图像解码失败")) }
              : { promise: Promise.resolve() },
          cleanup: () => {},
          getOperatorList: async () => ({ fnArray: [] }),
        }),
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
  h.llm.length = 0;
  h.ocrFail = false;
  h.llmFail = false;
  h.loadFail = false;
  h.renderFailPages = [];
  h.pages = 3;
  h.user = null;
  h.llmReply = { success: true, section: "", instrument: "", subParts: [], isFullScore: false };
  h.fileInserts.length = 0;
  h.uploaded.length = 0;
  h.llmFailFor = [];
  h.llmGate = null;
  h.segmentCuts = [2];
  const pixels = makePixels();
  HTMLCanvasElement.prototype.getContext = function () {
    return {
      fillStyle: "",
      fillRect: () => {},
      drawImage: () => {},
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

afterEach(cleanup);

async function runAnalysis({
  fullScore = false,
  ocrFail = false,
  llmFail = false,
  loadFail = false,
  renderFailPages = [] as number[],
  names = ["圆号1,2.pdf"],
} = {}) {
  h.ocrFail = ocrFail;
  h.llmFail = llmFail;
  h.loadFail = loadFail;
  h.renderFailPages = renderFailPages;
  const { container } = render(
    <UploadModal open onClose={() => {}} scoreId="score-1" onUploaded={() => {}} />,
  );
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: {
      files: names.map((n) => new File([new Uint8Array([1])], n, { type: "application/pdf" })),
    },
  });
  for (const n of names) await waitFor(() => expect(screen.getByText(n)).toBeTruthy());
  if (fullScore) fireEvent.click(screen.getByLabelText("分析总谱"));
  fireEvent.click(screen.getByText(/开始分析/));
  // 收尾信号用「阶段结束」而不是「某个按钮出现」：阶段还在 analyzing 时页脚是
  // 「取消分析」，跑完才变「取消」。用按钮当信号的话，**任何让该按钮不渲染的 bug
  // 都会表现成 20 秒超时**，而不是一句能读的断言失败（这个文件要钉的恰好就是那类 bug）。
  await waitFor(() => expect(screen.queryByText(/取消分析/)).toBeNull(), { timeout: 10000 });
}

describe("升级链的集成：哪几张图真的被送出去了", () => {
  it("开关关着：标题区读出文字但 LLM 未识别 → **整页也送检**，且**到此为止**（第 2、3 页一张都不试）", async () => {
    await runAnalysis();
    // 两条断言合成一条序列比对，因为这个序列同时证明两件事：
    // - 退化成 `return analysisSettled(got)` 时只剩 ["300x85"]（整页那条成了死代码）
    // - 多出第 2、3 页的份，就说明「开关关着 = 读完第一张有内容的页就走」被破坏了
    expect(h.ocr).toEqual([TITLE_TAG, FULL_TAG]);
    expect(h.llm).toHaveLength(2);
  });

  it("OCR 读不出**不终止链条**：开着「分析总谱」时 3 页都会试（每页 2 张图）", async () => {
    await runAnalysis({ fullScore: true, ocrFail: true });
    expect(h.ocr).toEqual([TITLE_TAG, FULL_TAG, TITLE_TAG, FULL_TAG, TITLE_TAG, FULL_TAG]);
  });

  it("OCR 全失败也**保住页数** —— 「识别分段」按钮不能静默消失", async () => {
    await runAnalysis({ ocrFail: true });
    // 页数一旦丢了（walk 抛穿 → pageCount 是 undefined → `needsSegmentation` 判假），
    // 这个按钮就整块不渲染，而**屏幕上一个字都不会解释为什么** —— 用户从此没法对
    // 那份谱跑分段/拆分。这条断言钉的就是那件事。
    expect(screen.getByText(/^识别分段（/)).toBeTruthy();
  });

  it("LLM 失败 = **整行失败**，不会再补一次「只凭文件名」的调用把错误洗成结果", async () => {
    await runAnalysis({ llmFail: true });
    // 被降级 catch 吞掉时这里会是 **2**：第 2 次的 body 里连 OCR 文本都没有（本地
    // `ocrText` 只在 LLM 成功后才赋值），而行会被标成「已分析」—— 用户拿到一个
    // 没有证据的结论，且无从分辨。
    expect(h.llm).toHaveLength(1);
    expect(screen.getByText(/LLM 请求失败/)).toBeTruthy();
  });

  it("**一页渲染失败不判死整份**：换下一页继续（旧版这里整份降级成「只凭文件名」）", async () => {
    await runAnalysis({ renderFailPages: [1] });
    // 第 1 页渲染抛错 → 当「这一页没结论」→ 第 2 页照常送检。
    // 异常一旦放出去，这里会是 0 次 OCR、整行落 error（而 PDF 其实还能用）。
    expect(h.ocr).toEqual([TITLE_TAG, FULL_TAG]);
  });

  it("**PDF 加载失败不判死整份**：退化成只凭文件名，行照样出结论、不崩", async () => {
    await runAnalysis({ loadFail: true });
    expect(h.ocr).toEqual([]); // 打不开就没有页可送
    expect(h.llm).toHaveLength(1); // 但 LLM 仍被问了一次（只带文件名）
    expect(h.llm[0]).toContain("圆号1,2.pdf");
  });
});

/**
 * 「首次分析就失败」的行曾经是**死胡同**（pkuso-web#298 的已知问题）：
 * `uploadableCount` 按 `instrumentGuess !== undefined` 计数 → 它不进上传；
 * 编辑器整格都在同一道门里（连那行红字也是）→ 屏幕上**一个能点的控件都没有**；
 * 确认阶段又没有移除按钮。（失败**原因**本身一直看得见：标题行的 `statusText` 就是
 * `失败: …`，且是红的 —— 缺的是出路，不是信息。）
 * 整批都是这种行时「确认上传」还被禁用 —— 用户唯一的出路是关掉弹窗重加文件，
 * 代价是丢掉整批已经烧掉的 OCR 配额。
 *
 * 下面每条各自做过变异验证：把「重试按钮」或「成功 patch 里的 `error: undefined`」
 * 去掉，对应的断言就变红。
 */
describe("错误行不再是死胡同：重试", () => {
  it("首次失败的行**点得到重试**（加这个之前它一个控件都没有）", async () => {
    await runAnalysis({ llmFail: true });
    // 失败原因本身一直是可见的（标题行那句 `失败: …`）—— 缺的是能点的东西
    expect(screen.getByText(/LLM 请求失败/)).toBeTruthy();
    expect(screen.getByText("重试")).toBeTruthy();
  });

  it("**重试飞行中不能改行集** —— 否则结果会写进别的行、被重试那行永远卡住", async () => {
    // ⚠️ 对抗测试实测出来的缺口：逐行重试是确认阶段**第一个「攥着下标飞行」的长任务**，
    // 而「还原为一份」与「确认这 N 段」都会**改变 files 的长度**。它飞行时这两个按钮
    // 若可点，行集会平移而 worker 攥着的还是旧下标 → 重试的结果写进**别的行**，
    // 被重试那行永远停在「分析中」→ `hasAnalyzingFiles` 恒真 →「确认上传」永久禁用，
    // 用户只能关窗、丢掉整批已经烧掉的分析结果。
    // 同一文件里对分段 worker 早写过这条教训（`segBusy`），重试这条新路径漏了。
    h.llmFailFor = ["b.pdf"];
    await runAnalysis({ names: ["a.pdf", "c.pdf", "b.pdf"] });

    // a 与 c 都可以拆（各出现一个「确认这 N 段」）
    fireEvent.click(screen.getByText(/^识别分段（/));
    await waitFor(() => expect(screen.getAllByText(/^确认这 \d+ 段$/)).toHaveLength(2), {
      timeout: 10000,
    });

    // 只把 a 拆开：拆出来的段带「还原为一份」，而 c 那个「确认这 N 段」留在原地 ——
    // 这样两种「改行集」的按钮同时在屏幕上，一次断言都覆盖到
    fireEvent.click(screen.getAllByText(/^确认这 \d+ 段$/)[0]!);
    await waitFor(() => expect(screen.getAllByText("还原为一份").length).toBeGreaterThan(0));

    // 让重试挂住 —— 真实的一次 LLM 调用要几秒到几十秒（前端 LLM_TIMEOUT_MS 45s 是它的上限），判据只在那段窗口里才有意义
    let release: () => void = () => {};
    h.llmGate = new Promise<void>((r) => {
      release = r;
    });
    fireEvent.click(screen.getByText("重试"));

    // 每段各有一个「还原为一份」（它们属于同一组），所以断言**全部**禁用
    await waitFor(() =>
      expect(
        screen.getAllByText("还原为一份").every((b) => (b as HTMLButtonElement).disabled),
      ).toBe(true),
    );
    expect((screen.getByText(/^确认这 \d+ 段$/) as HTMLButtonElement).disabled).toBe(true);

    // 放行，让这次重试跑完（不留悬挂的 promise）
    release();
    h.llmGate = null;
    await waitFor(() => expect(screen.queryByText("重试")).toBeNull(), { timeout: 10000 });
    // 单独给这一条放宽时限：它是本文件最重的集成用例（3 个文件各跑一遍完整分析，
    // 再跑分段、再跑一次重试），而文件级的 `testTimeout` 是 20s —— 机器有负载时
    // 最容易被拖过时限的正是这个形状（造一个飞行窗口 + 靠 waitFor 收尾）。
    // 放宽只影响「等多久算失败」，不会让真正的挂起变成通过。
  }, 30000);

  it("点重试**重跑这一行**；成功后旧错误不再残留、行回到可上传状态", async () => {
    await runAnalysis({ llmFail: true });
    const llmBefore = h.llm.length;
    const ocrBefore = h.ocr.length;

    h.llmFail = false;
    fireEvent.click(screen.getByText("重试"));

    // 完成信号用「行落回 analyzed 且未识别」（`statusText` 给的是「需人工确认」）。
    // ⚠️ **不能用「重试按钮消失」当信号** —— 行一进 pending/analyzing 按钮就没了，
    // 那时流水线才刚起步，等它等于什么都没验证。
    await waitFor(() => expect(screen.getByText("需人工确认")).toBeTruthy(), { timeout: 10000 });

    // ⚠️ 这条钉的是成功 patch 里的 `error: undefined`。去掉它的话：行变成 analyzed 之后
    // `instrumentGuess` 有了 → 编辑器那道门打开 → 里面那行红字把**上一次的失败**渲染出来，
    // 挂在一条已经成功的行上，读起来像「重试也没用」。
    expect(screen.queryByText(/LLM 请求失败/)).toBeNull();
    // 真的重跑了这一份（重新取页 + 重新问 LLM）
    expect(h.ocr.length).toBeGreaterThan(ocrBefore);
    expect(h.llm.length).toBeGreaterThan(llmBefore);
  });
});

/**
 * 跨声部的共用分谱（`Violoncello e Basso` 那种）落成**两行、每行各自一个存储对象**。
 *
 * ⚠️ 这一组盯的是本改动**最容易出错的地方**：多条落库行必须**一次批量 insert**。
 * 循环插的话，第 k 条失败会留下前 k-1 行；而重试走的是 upsert（同一个 `storageId`），
 * storage 对象不会重复，**却会给那 k-1 个声部各再插一行** —— 详情页出现两份同名文件，
 * `storage_path` 还完全相同，事后分不出哪行是多的。
 */
describe("跨声部的共用分谱：一份文件落成两行", () => {
  it("LLM 给了 extraSections → **一次** insert 带两行，**每行各自一个存储对象**", async () => {
    h.user = { id: "u1" };
    h.llmReply = {
      success: true,
      section: "大提琴",
      instrument: "大提琴",
      subParts: [],
      extraSections: ["低音提琴"],
      isFullScore: false,
    };
    await runAnalysis();

    fireEvent.click(screen.getByText(/确认上传/));
    await waitFor(() => expect(h.fileInserts.length).toBeGreaterThan(0), { timeout: 10000 });

    // **一次**调用。改成循环插时这里是 2。
    expect(h.fileInserts).toHaveLength(1);
    const rows = h.fileInserts[0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    // 主声部用模型给的乐器名，额外声部用**声部名**当乐器名（模型没有第二件的信息）
    expect(rows.map((r) => r.file_name)).toEqual(["大提琴.pdf", "低音提琴.pdf"]);
    expect(rows.map((r) => r.instrument)).toEqual(["大提琴", "低音提琴"]);
    // 各自建/取自己的 part —— 详情页按 section 分组，两行得落在两个组里
    expect(rows.map((r) => r.part_id)).toEqual(["part-大提琴", "part-低音提琴"]);
    // ⚠️ **每个落点各自一个存储对象**（不是共用同一个）。
    // 共用的写法曾经出现在这里，是错的：详情页 `deleteFile` / `deletePart` 都是
    // **先 `storage.remove(...)` 再删行**，共用对象时删掉一行会把另一行还在用的 PDF
    // 一起删掉（详情页看着完好、下载 404）。这条断言钉的就是「不共用」。
    expect(h.uploaded).toHaveLength(2);
    expect(new Set(rows.map((r) => r.storage_path)).size).toBe(2);
    expect(rows.map((r) => r.storage_path)).toEqual(h.uploaded);
    // 第 0 个沿用行自己的 storageId（既有形态不变），其余按序号派生 —— 于是**重试
    // 仍落在同一条路径**上、走 upsert 不会堆孤儿对象。这里断言的是**派生规则**，
    // 不断言具体 uuid（那是分析阶段随机生成的，写死等于编一个值）。
    const base = h.uploaded[0]!.replace(/\.pdf$/, "");
    expect(base.startsWith("score-1/")).toBe(true);
    expect(h.uploaded[1]).toBe(`${base}-1.pdf`);
  });

  it("界面上把额外声部摆明 —— 否则用户看到的落库结果与预览对不上", async () => {
    h.llmReply = {
      success: true,
      section: "大提琴",
      instrument: "大提琴",
      subParts: [],
      extraSections: ["低音提琴"],
      isFullScore: false,
    };
    await runAnalysis();
    // chip 上有一个、且它已从「+ 声部」的选项里排除（选不进去的东西不该还留在列表里）
    expect(screen.getAllByText("低音提琴").length).toBeGreaterThan(0);
    expect(screen.getByText(/大提琴 \/ 大提琴\.pdf、低音提琴 \/ 低音提琴\.pdf/)).toBeTruthy();
    // ⚠️ **行标题也要带上落点**。`previewPath` 展开成两个落点之后，标题若只报主声部，
    // 同一张卡片里两句话就互相矛盾（用户按标题核对会以为只落一个声部）——
    // 而 `statusText` 自己的注释写着「必须与文件名预览一致」。对抗测试实测抓出来的。
    expect(screen.getByText(/已识别 → 大提琴 \/ 大提琴（还落到 低音提琴）/)).toBeTruthy();
  });

  it("主声部是「其他」时：不显示「+ 声部」，但**说清为什么**（不静默丢弃）", async () => {
    // 清洗那条判据（`normalizeExtraSections`）会让「其他」时的额外声部一律落空。
    // 若界面照旧给「+ 声部」，用户加完会发现 chip 不出现 —— 那就是本仓最忌的静默丢弃。
    // 所以渲染条件与清洗判据**同源**（`canHaveExtraSections`），并给一句解释。
    h.llmReply = {
      success: true,
      section: "其他",
      instrument: "大提琴",
      subParts: [],
      extraSections: ["低音提琴"],
      isFullScore: false,
    };
    await runAnalysis();

    expect(screen.getByText(/主声部是「其他」时不会落到具体声部/)).toBeTruthy();
    expect(screen.queryByText("+ 声部")).toBeNull();
  });

  it("没有额外声部时仍是**一行、一次 insert**（加这个功能之前的行为一字不变）", async () => {
    h.user = { id: "u1" };
    h.llmReply = {
      success: true,
      section: "圆号",
      instrument: "F调圆号",
      subParts: [1],
      isFullScore: false,
    };
    await runAnalysis();

    fireEvent.click(screen.getByText(/确认上传/));
    await waitFor(() => expect(h.fileInserts.length).toBeGreaterThan(0), { timeout: 10000 });

    expect(h.fileInserts).toHaveLength(1);
    expect(h.fileInserts[0] as unknown[]).toHaveLength(1);
  });
});
