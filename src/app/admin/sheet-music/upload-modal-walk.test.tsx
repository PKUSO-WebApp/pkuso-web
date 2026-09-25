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
  /**
   * 按**调用顺序**逐个回不同的答案（用光之后回落到 `llmReply`）。
   *
   * 需要它是因为「段级识别」现在**不带任何可辨识的标记**了 —— 段级调用不发文件名，
   * 而各段的首页文本在桩里又是常量，于是「这一份是哪一段」只能靠调用顺序区分。
   * 用它复刻真机上出问题的那份：整份 `[1,2]`、第 1 段 `[1]`、第 2 段 `[2]`。
   */
  llmReplies: [] as Record<string, unknown>[],
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
            // 按调用顺序取的答案优先（见 `llmReplies`）
            const perCall = h.llmReplies.shift();
            return { data: perCall ?? h.llmReply, error: null };
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
  // ⚠️ 必须清空：mock 里是 `shift()` 按调用顺序取答案，用例中途失败时数组里会**剩下几条**
  // —— 不清的话后面所有用例的 LLM 回包都被顶掉，报错指向无辜的用例。
  h.llmReplies.length = 0;
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

  it("OCR 全失败也**保住页数** —— 未识别时页数照旧显示（分段按钮按新规则不给）", async () => {
    await runAnalysis({ ocrFail: true });
    // 页数一旦丢了（walk 抛穿 → pageCount 是 undefined），屏幕上**一个字都不会解释
    // 为什么**，用户从此没法对那份谱跑分段/拆分。这条断言钉的就是那件事。
    //
    // ⚠️ 2026-09-25 起「识别分段」按钮对**未识别**的行不再出现（分段是**按页**烧 OCR，
    // 而这一行是什么都还没定，跑完也归不了声部）。所以「保住页数」的责任从那个按钮
    // 挪到了这句提示上 —— **断言的意图没变**，换的是承载它的文案。
    expect(screen.getByText(/未识别（\d+ 页）/)).toBeTruthy();
    expect(screen.queryByText(/^识别分段（/)).toBeNull();
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

  it("模型依据要显示给用户 —— 没在原文里找到时是警示色", async () => {
    // ⚠️ 这条用例守的是**后端那批改动的补偿信号**：后端不再因为「引文找不到」而弃权
    // （改用 `evidenceFound` 标一下、答案照用）。如果前端不显示这段引文，
    // 那批改动的净效果就是「预填一个可能错的答案 + 显示成已识别」——比原来更差。
    // prompt 里也向模型承诺了「让用户一眼就能复核你」。
    h.llmReply = {
      success: true,
      section: "圆号",
      instrument: "F调圆号",
      subParts: [],
      isFullScore: false,
      evidence: "Corno I in F.",
      evidenceFound: true,
    };
    await runAnalysis({});
    expect(screen.getByText(/^依据：Corno I in F\.$/)).toBeTruthy();

    cleanup();
    h.llmReply = {
      success: true,
      section: "圆号",
      instrument: "F调圆号",
      subParts: [],
      isFullScore: false,
      evidence: "引文是编的",
      evidenceFound: false,
    };
    await runAnalysis({});
    const warn = screen.getByText(/未在原文中找到/);
    expect(warn.className).toContain("text-warning");
  });

  it("未识别的行：给「重试」，且不进分段（页数照旧显示）", async () => {
    // 默认桩就是「一律未识别」——正是这一行要测的形态（多页 → 本可分段）
    await runAnalysis({});
    // 能重试：同一输入两次结果不同时，这是用户唯一的出路；也是未识别行唯一的动作
    expect(screen.getByText("重试")).toBeTruthy();
    // 不给分段按钮：分段是**按页**烧 OCR，而这一行是什么都还没定
    expect(screen.queryByText(/^识别分段（/)).toBeNull();
    // 但页数必须看得见（见上面那条用例的说明）
    expect(screen.getByText(/未识别（\d+ 页）/)).toBeTruthy();
  });

  it("**重试飞行中不能改行集** —— 否则结果会写进别的行、被重试那行永远卡住", async () => {
    // ⚠️ 对抗测试实测出来的缺口：逐行重试是确认阶段**第一个「攥着下标飞行」的长任务**，
    // 而「还原为一份」与「确认这 N 段」都会**改变 files 的长度**。它飞行时这两个按钮
    // 若可点，行集会平移而 worker 攥着的还是旧下标 → 重试的结果写进**别的行**，
    // 被重试那行永远停在「分析中」→ `hasAnalyzingFiles` 恒真 →「确认上传」永久禁用，
    // 用户只能关窗、丢掉整批已经烧掉的分析结果。
    // 同一文件里对分段 worker 早写过这条教训（`segBusy`），重试这条新路径漏了。
    // ⚠️ 这条用例要的是「a、c 能分段、b 是错误行」——所以桩必须返回**已识别**的结果：
    // 2026-09-25 起未识别的行不进分段（见 `segEligible`），用默认那条「一律未识别」的
    // 桩会让「识别分段」按钮根本不出现，这条竞态就无从触发。
    h.llmReply = {
      success: true,
      section: "圆号",
      instrument: "F调圆号",
      subParts: [],
      isFullScore: false,
    };
    h.llmFailFor = ["b.pdf"];
    await runAnalysis({ names: ["a.pdf", "c.pdf", "b.pdf"] });

    // 点一次「识别分段」：a 与 c **各自自动拆成两段**（「确认这 N 段」那道人工关卡已删）
    fireEvent.click(screen.getByText(/^识别分段（/));
    await waitFor(() => expect(screen.getAllByText("还原为一份")).toHaveLength(4), {
      timeout: 10000,
    });

    // 再把其中一组还原回去 —— 屏幕上于是同时有「还原为一份」与「确认这 N 段」，
    // 两种「改行集」的按钮一次断言都覆盖到。
    // ⚠️ 还原之后**不许再自动拆**（否则用户永远退不回去）：自动拆做成事件驱动
    // （放在 `startSegmentation` 末尾）就是为了这件 —— 改成渲染期效果的话这里会
    // 立刻被重拆，「确认这 N 段」永远不会出现，下面那句断言先红。
    fireEvent.click(screen.getAllByText("还原为一份")[0]!);
    await waitFor(() => expect(screen.getByText(/^确认这 \d+ 段$/)).toBeTruthy(), {
      timeout: 10000,
    });
    expect(screen.getAllByText("还原为一份").length).toBeGreaterThan(0);

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

  it("**重试飞行中不能点「识别分段」** —— 自动拆会平移行集，把重试结果写进别的行", async () => {
    // 对抗测试第 2 轮实测出来的缺口：自动拆**改变 `files` 的长度**，而逐行重试是
    // 「攥着下标飞行」的长任务。这个按钮原先只判 `phase`/`segBusy`（重试期间两条都为假），
    // 于是可点 → 自动拆行 → 行集平移 → 重试结果写进别的行、被重试那行永远停在「分析中」
    // →`hasAnalyzingFiles` 恒真 →「确认上传」永久禁用，用户只能关窗丢掉整批已烧的 OCR。
    // 改动前它只写 `segState`、不动行集，所以当时不需要这道门。
    //
    // ⚠️ 必须留一个**没点过分段**的文件（a），否则 `segTargets` 为空、按钮根本不渲染，
    // 这条断言就无从谈起（`**重试飞行中不能改行集**` 那条正是这个形态）。
    h.llmReply = {
      success: true,
      section: "圆号",
      instrument: "F调圆号",
      subParts: [],
      isFullScore: false,
    };
    h.llmFailFor = ["b.pdf"];
    await runAnalysis({ names: ["a.pdf", "b.pdf"] });

    let release: () => void = () => {};
    h.llmGate = new Promise<void>((r) => {
      release = r;
    });
    fireEvent.click(screen.getByText("重试"));

    await waitFor(() =>
      expect((screen.getByText(/^识别分段（/) as HTMLButtonElement).disabled).toBe(true),
    );

    release();
    h.llmGate = null;
    await waitFor(() => expect(screen.queryByText("重试")).toBeNull(), { timeout: 10000 });
  });

  it("每一段用**自己那一页**重新识别一次（N 次 LLM、**0 次 OCR**）", async () => {
    // 合订谱的典型形态：一段短笛 + 一段长笛，切点落在页边界上。
    // 不各自识别的话两段都继承**整份第一页**的判断，第二段要用户手改 ——
    // 而改它所需的数据（那一段自己的首页文本）在分段那一步就已经 OCR 过了。
    h.llmReply = {
      success: true,
      section: "长笛",
      instrument: "长笛",
      subParts: [],
      isFullScore: false,
    };
    h.segmentCuts = [2];
    await runAnalysis({ names: ["短笛长笛.pdf"] });
    // ⚠️ **必须等分析落定再取基准**：`runAnalysis` 只等到渲染，此刻 LLM 调用还在飞
    //（第一版就栽在这里：基准取成 0，断言变成「总共 5 次」而期望 2 次）。
    await waitFor(() => expect(screen.getByText(/^已识别 → 长笛/)).toBeTruthy(), {
      timeout: 10000,
    });

    const ocrBefore = h.ocr.length;
    fireEvent.click(screen.getByText(/^识别分段（/));
    // 切点判出后**自动**拆成两行 —— 不再需要点「确认这 N 段」
    await waitFor(() => expect(screen.getAllByText("还原为一份")).toHaveLength(2), {
      timeout: 10000,
    });
    // 分段本身确实要烧 OCR（每页窄带各一次），这是它贵的地方
    const ocrAfterSeg = h.ocr.length;
    expect(ocrAfterSeg).toBeGreaterThan(ocrBefore);

    // 两段各问了一次 LLM，而且**都没带「文件名:」那一行**。
    // 段行继承的是源合订本的名字（`…--_Piccolo,_Flute_1,_2.pdf`），而 prompt 规则 8
    // 明写「文件名是 `Flute 1-2` 这种就写 [1,2]」—— 带着它，每一段都会被填成源行那份号、
    // 盖过页眉上真正写着的那一行（`Flauto I.` / `Flauto II.`）。整份那次调用是带文件名的，
    // 所以按这一条筛得出来。
    await waitFor(() => expect(h.llm.filter((t) => !t.includes("文件名:"))).toHaveLength(2), {
      timeout: 10000,
    });

    // ⚠️ **0 次额外 OCR** —— 这条就是「各段用的是每段自己的 `segHeadText`，而不是重跑
    // 一遍取页+OCR」的充分证据（重跑必然增加 `h.ocr`）。桩的 OCR 文本是常量（每页同文），
    // 所以两条 prompt 无法区分，这里不断言它们不同。
    expect(h.ocr.length).toBe(ocrAfterSeg);
  });

  it("段级识别出的号落到各段行上；读不出的那一段由组级补号兜住", async () => {
    // 复刻真机上出问题的那份合订谱（`…--_Piccolo,_Flute_1,_2.pdf`）：源行读出 `[1,2]`，
    // 第 1 段的页眉读出 `[1]`、第 2 段的页眉上没印号 → 靠 `fillMissingSubParts` 从源行减出 `[2]`。
    //
    // ⚠️ **本条不负责钉「段级不发文件名」**（那是根因，也是隔壁那条用例的
    // `h.llm.filter(t => !t.includes("文件名:"))` 在钉）：段级带不带文件名，桩都按调用序
    // 回同样的答案，所以这一条在两种实现下都绿。它钉的是**落值与补号接线**。
    h.segmentCuts = [2];
    h.llmReplies = [
      // #1 整份那次：长笛 1、2 订在一起
      { success: true, section: "长笛", instrument: "长笛", subParts: [1, 2], isFullScore: false },
      // #2 第 1 段（第 1 页）：页眉上印着号，自己读出来
      { success: true, section: "长笛", instrument: "长笛", subParts: [1], isFullScore: false },
      // #3 第 2 段（第 2 页起）：**页眉上没印号** → 空数组，靠组级补号从源行减出 `[2]`
      { success: true, section: "长笛", instrument: "长笛", subParts: [], isFullScore: false },
    ];
    await runAnalysis({ names: ["短笛长笛.pdf"] });
    await waitFor(() => expect(screen.getByText(/^已识别 → 长笛/)).toBeTruthy(), {
      timeout: 10000,
    });

    fireEvent.click(screen.getByText(/^识别分段（/));
    await waitFor(() => expect(screen.getAllByText("还原为一份")).toHaveLength(2), {
      timeout: 10000,
    });

    // 两段的号**各归各的**（本 issue 的验收点）。等到两次段级识别都落地。
    await waitFor(
      () => {
        const vals = screen
          .getAllByPlaceholderText("号，如 1,2")
          .map((el) => (el as HTMLInputElement).value);
        expect(vals).toEqual(["1", "2"]);
      },
      { timeout: 10000 },
    );

    // 也**不该再出现**那句按位置预填的提示。
    // ⚠️ 本条是「号数 = 段数」（2 段 / 2 个号）的**对齐**形态，旧实现在这个形态下渲染的是
    // 「按位置预填…」那一支 —— 所以 `按位置预填` 是可打红的判据；
    // 「但文件名里是…」那一支属于**不等**的形态，由下一条用例承载（写在这里是恒真断言）。
    expect(screen.queryByText(/按位置预填/)).toBeNull();
  });

  it("**多段都读不出号时不猜**（有意取舍：旧实现会按位置各给一个号）", async () => {
    // 这条是**唯一能按值区分新旧实现**的形态，也是本次改动的取舍所在：
    // 源行 `[1,2]`、2 段，但两段的页眉都没印号。
    // · 旧实现：按位置预填 → 第 1 段 `1`、第 2 段 `2`（**猜的**，用户核一眼即可）
    // · 新实现：两段都留空 → 两段都叫 `长笛.pdf` → `duplicatedInGroup` 会把整组拦下，
    //   用户得逐段手填（红字那条「改乐器名」解不开，要改的是号）
    //
    // 取舍是**有意**的：号只由各段自己的页眉定，读不到就不猜 —— 猜错的号会写进
    // 下载文件名与 `sub_parts`，而那份错名字事后看不出来。代价是这种形态要多几次手填。
    h.segmentCuts = [2];
    h.llmReplies = [
      { success: true, section: "长笛", instrument: "长笛", subParts: [1, 2], isFullScore: false },
      { success: true, section: "长笛", instrument: "长笛", subParts: [], isFullScore: false },
      { success: true, section: "长笛", instrument: "长笛", subParts: [], isFullScore: false },
    ];
    await runAnalysis({ names: ["短笛长笛.pdf"] });
    await waitFor(() => expect(screen.getByText(/^已识别 → 长笛/)).toBeTruthy(), {
      timeout: 10000,
    });

    fireEvent.click(screen.getByText(/^识别分段（/));
    await waitFor(() => expect(screen.getAllByText("还原为一份")).toHaveLength(2), {
      timeout: 10000,
    });
    // 等两次段级识别都落地，再看号：两段都应为空（旧实现这里是 ["1","2"]）
    await waitFor(() => expect(h.llm.filter((t) => !t.includes("文件名:"))).toHaveLength(2), {
      timeout: 10000,
    });
    expect(
      screen.getAllByPlaceholderText("号，如 1,2").map((el) => (el as HTMLInputElement).value),
    ).toEqual(["", ""]);
  });

  it("识别落地前用户把某段乐器改对 → **不补号**（补号只看模型读出的乐器）", async () => {
    // 对抗测试第 3 轮实测：`fillMissingSubParts` 的约束 1（「乐器与源行相同才补」）判的是
    // **模型读出的**乐器，而落值守卫原先不看 `instrumentEdit` —— 于是用户趁段级识别还没
    // 落地、把某段的乐器改对（逐段确认乐器与号正是本功能的主动作，输入框那时可编辑）
    // 之后，减法猜出来的号照样写进那一行：`file_name` / `sub_parts` 落一个从没确认过的号，
    // 界面上还看不出是猜的。
    h.segmentCuts = [2];
    h.llmReplies = [
      { success: true, section: "长笛", instrument: "长笛", subParts: [1, 2], isFullScore: false },
      { success: true, section: "长笛", instrument: "长笛", subParts: [1], isFullScore: false },
      { success: true, section: "长笛", instrument: "长笛", subParts: [], isFullScore: false },
    ];
    await runAnalysis({ names: ["短笛长笛.pdf"] });
    await waitFor(() => expect(screen.getByText(/^已识别 → 长笛/)).toBeTruthy(), {
      timeout: 10000,
    });

    // 挂门必须在点「识别分段」之前：自动拆之后段级那几次调用紧跟着就发出去了
    let release: () => void = () => {};
    h.llmGate = new Promise<void>((r) => {
      release = r;
    });
    fireEvent.click(screen.getByText(/^识别分段（/));
    await waitFor(() => expect(screen.getAllByText("还原为一份")).toHaveLength(2), {
      timeout: 10000,
    });

    // 用户发现第 2 段的乐器被认错了，趁识别还没落地改对
    fireEvent.change(screen.getAllByPlaceholderText(/乐器名/)[1]!, { target: { value: "短笛" } });
    release();
    h.llmGate = null;

    // 「落地了」的信号取第 1 段的号变成 `1`（模型给的）；然后第 2 段的号**必须是空**
    await waitFor(() =>
      expect((screen.getAllByPlaceholderText("号，如 1,2")[0] as HTMLInputElement).value).toBe("1"),
    );
    expect((screen.getAllByPlaceholderText(/乐器名/)[1] as HTMLInputElement).value).toBe("短笛");
    expect((screen.getAllByPlaceholderText("号，如 1,2")[1] as HTMLInputElement).value).toBe("");
  });

  it("识别落地前用户改了**兄弟段**的乐器 → 整组都不补号", async () => {
    // 对抗测试第 4 轮：上一轮那条守卫只判「**被补的那一行**动没动过」，而
    // `fillMissingSubParts` 的约束 1（乐器与源行相同才补）用的是**所有段模型读出的**乐器。
    // 用户改的若是**兄弟段**（模型把 B 认错了），`taken` 里那个号根本不属于源行那套号，
    // 减法算出来的结果就是错的 —— 而界面上那一格看起来就是识别结果。
    // 现在整组里任一行被动过，整组不补。
    h.segmentCuts = [2];
    h.llmReplies = [
      { success: true, section: "长笛", instrument: "长笛", subParts: [1, 2], isFullScore: false },
      // 第 1 段页眉没印号 → 本来会被补成 `[1]`
      { success: true, section: "长笛", instrument: "长笛", subParts: [], isFullScore: false },
      // 第 2 段读出 `[2]`
      { success: true, section: "长笛", instrument: "长笛", subParts: [2], isFullScore: false },
    ];
    await runAnalysis({ names: ["短笛长笛.pdf"] });
    await waitFor(() => expect(screen.getByText(/^已识别 → 长笛/)).toBeTruthy(), {
      timeout: 10000,
    });

    let release: () => void = () => {};
    h.llmGate = new Promise<void>((r) => {
      release = r;
    });
    fireEvent.click(screen.getByText(/^识别分段（/));
    await waitFor(() => expect(screen.getAllByText("还原为一份")).toHaveLength(2), {
      timeout: 10000,
    });

    // 用户改的是**第 2 段**（兄弟段），第 1 段原封不动
    fireEvent.change(screen.getAllByPlaceholderText(/乐器名/)[1]!, { target: { value: "小号" } });
    release();
    h.llmGate = null;

    // 「落地了」的信号：第 2 段的号变成模型给的 `2`
    await waitFor(() =>
      expect((screen.getAllByPlaceholderText("号，如 1,2")[1] as HTMLInputElement).value).toBe("2"),
    );
    expect((screen.getAllByPlaceholderText(/乐器名/)[1] as HTMLInputElement).value).toBe("小号");
    // 第 1 段**不该**被补成 `1` —— 整组有人动过就不补
    expect((screen.getAllByPlaceholderText("号，如 1,2")[0] as HTMLInputElement).value).toBe("");
  });

  it("段数与号数**不等**时不再拿文件名对账（旧实现会在这里要用户逐段手填）", async () => {
    // 源行读出 `[1,2]`（2 个号）而切点分出 3 段。旧实现在这个形态下会渲染
    // 「共 3 段，但文件名里是 2 个号（1,2）—— 请逐段确认乐器与号」，
    // 把「文件名里的号数」当成判据去跟段数对账。文件名可能什么有用信息都没有，
    // 这条规则连同文案一起删了。
    //
    // ⚠️ 本条的**行为判据**是「不点按钮也已经拆成 3 行」（旧实现在这里就没有自动拆，
    // 会超时变红）；末尾那两句 `queryByText` 是**字符串守卫**，只有在有人把
    // `splitOf.note` 那套文案重新引回来时才会红 —— 它们是「删干净了没有」，不是行为判据。
    h.segmentCuts = [2, 3];
    h.llmReply = {
      success: true,
      section: "长笛",
      instrument: "长笛",
      subParts: [1, 2],
      isFullScore: false,
    };
    await runAnalysis({ names: ["短笛长笛.pdf"] });
    await waitFor(() => expect(screen.getByText(/^已识别 → 长笛/)).toBeTruthy(), {
      timeout: 10000,
    });

    fireEvent.click(screen.getByText(/^识别分段（/));
    await waitFor(() => expect(screen.getAllByText("还原为一份")).toHaveLength(3), {
      timeout: 10000,
    });

    expect(screen.queryByText(/但文件名里是/)).toBeNull();
    expect(screen.queryByText(/按位置预填/)).toBeNull();
  });

  it("各段识别**回来晚了**不会抹掉用户已经改过的值", async () => {
    // 识别是异步的（真实要几秒），而那正是用户会去改值的窗口 —— 结果回来时把用户
    // 刚落的手抹掉，是最难受的一种「智能」。判据是「编辑框还等于切分时预填的那个值」。
    //
    // 两次回包**故意给不同答案**（整份第一页 →「短笛」、各段自己的页 →「长笛」），
    // 这样「识别落地了没有」是可观察的：第 2 段变成「长笛」就是落地信号。
    // ⚠️ 第一版没有这个信号，`release()` 后立刻断言 —— 覆盖还没落地，断言**必然**通过，
    // 于是撤掉那道守卫它也全绿（变异实测 NOT-CAUGHT）。
    h.llmReply = {
      success: true,
      section: "短笛",
      instrument: "短笛",
      subParts: [],
      isFullScore: false,
    };
    h.segmentCuts = [2];
    await runAnalysis({ names: ["短笛长笛.pdf"] });
    await waitFor(() => expect(screen.getByText(/^已识别 → 短笛/)).toBeTruthy(), {
      timeout: 10000,
    });

    // ⚠️ 挂门必须**在点「识别分段」之前**：自动拆之后，段级那几次调用紧跟着切分
    // 就发出去了，中间没有可点的按钮 —— 点完再挂就晚了，要挂住的那一次已经跑了。
    h.llmReply = {
      success: true,
      section: "长笛",
      instrument: "长笛",
      subParts: [],
      isFullScore: false,
    };
    let release: () => void = () => {};
    h.llmGate = new Promise<void>((r) => {
      release = r;
    });
    fireEvent.click(screen.getByText(/^识别分段（/));
    await waitFor(() => expect(screen.getAllByText("还原为一份").length).toBeGreaterThan(0), {
      timeout: 10000,
    });

    // 用户手改第 1 段的乐器名
    fireEvent.change(screen.getAllByPlaceholderText(/乐器名/)[0]!, {
      target: { value: "用户自己填的" },
    });

    release();
    h.llmGate = null;
    // **先等识别落地**（另一段变成「长笛」），再断言被改过的那一段
    await waitFor(() => expect(screen.getAllByDisplayValue("长笛").length).toBeGreaterThan(0), {
      timeout: 10000,
    });
    expect((screen.getAllByPlaceholderText(/乐器名/)[0] as HTMLInputElement).value).toBe(
      "用户自己填的",
    );
  });

  it("未识别行点「重试」**不覆盖用户已经选好的声部**（模型给的乐器名照收）", async () => {
    // 合规审查实测出来的：`analyzeOne` 的成功 patch 无条件写 `sectionEdit`/`instrumentEdit`，
    // 而这两个字段是**用户的表态**（本文件上面写过）。于是一个未识别的行、用户选好声部、
    // 再点重试 —— 用户的声部被模型答案顶掉，且没有任何提示。
    // 这条路径**不需要竞态**就能复现（同步的：点一下按钮就发生）。
    await runAnalysis({});
    await waitFor(() => expect(screen.getByText("需人工确认")).toBeTruthy(), { timeout: 10000 });

    // 用户从声部下拉里选了「大提琴」
    const sel = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: "大提琴" } });
    expect((screen.getAllByRole("combobox")[0] as HTMLSelectElement).value).toBe("大提琴");

    // 重试时换一个**已识别**的回包 —— 这样「结果落地了没有」是可观察的
    h.llmReply = {
      success: true,
      section: "中提琴",
      instrument: "中提琴",
      subParts: [],
      isFullScore: false,
    };
    fireEvent.click(screen.getByText("重试"));

    // 落地信号：模型给的**乐器名**进来了（它那个框用户没动过 → 该被写）
    await waitFor(() => expect(screen.getByText(/已识别 → .*中提琴/)).toBeTruthy(), {
      timeout: 10000,
    });
    // 而**声部**必须还是用户选的那个
    expect((screen.getAllByRole("combobox")[0] as HTMLSelectElement).value).toBe("大提琴");
  });

  it("**段行**上的「重试」只重跑这一段（0 次额外 OCR、页数不变）", async () => {
    // 合规审查实测出来的：段行的重试走的是整份源文件的完整分析 —— 2 页的段点一次重试
    // 会变成「未识别（3 页）」（`pageCount` 被源文件覆盖），还会去渲染不属于该段的第 1 页。
    h.llmReply = {
      success: true,
      section: "长笛",
      instrument: "长笛",
      subParts: [],
      isFullScore: false,
    };
    h.segmentCuts = [2];
    await runAnalysis({ names: ["短笛长笛.pdf"] });
    await waitFor(() => expect(screen.getByText(/^已识别 → 长笛/)).toBeTruthy(), {
      timeout: 10000,
    });
    fireEvent.click(screen.getByText(/^识别分段（/));
    // 切点判出后自动拆成两行（不再点「确认这 N 段」）
    await waitFor(() => expect(screen.getAllByText("还原为一份").length).toBeGreaterThan(0), {
      timeout: 10000,
    });

    // 让第 2 段落进「未识别」：**清空它的乐器名**（段级识别现在会保留继承值，
    // 所以不能指望「模型答不出来」把它变成未识别 —— 那条路已经改成保留 + 提示了）。
    fireEvent.change(screen.getAllByPlaceholderText(/乐器名/)[1]!, { target: { value: "" } });
    await waitFor(() => expect(screen.getAllByText("重试").length).toBeGreaterThan(0), {
      timeout: 10000,
    });

    const ocrBefore = h.ocr.length;
    fireEvent.click(screen.getAllByText("重试")[0]!);
    // 收尾信号用「页数不变」这条断言本身：段行只有 2 页，整份重跑会覆盖成源文件的 3 页
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/未识别（3 页）/)).toBeNull();
    expect(h.ocr.length).toBe(ocrBefore);
  });
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
