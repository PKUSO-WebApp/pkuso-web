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
  pages: 3,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
    from: vi.fn(),
    storage: { from: vi.fn() },
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
          h.llm.push(String(opts.body.ocr_text ?? ""));
          // LLM 失败走 `error` 那条路：`runLlmAnalysis` 会抛，而**抛出来的异常该让整行
          // 落 `status: "error"`**，不该被降级 catch 吞掉再补一次「只凭文件名」的调用
          if (h.llmFail) return { data: null, error: { message: "boom" } };
          // 一律「未识别」：这正是要逼出回退/升级的那种输入
          return {
            data: { success: true, section: "", instrument: "", subParts: [], isFullScore: false },
            error: null,
          };
        }
        return { data: null, error: { message: `未预期的调用 ${name}` } };
      }),
    },
  },
}));

vi.mock("pdfjs-dist", () => ({
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: h.pages,
      getPage: async () => ({
        getViewport: ({ scale }: { scale: number }) => ({
          width: 100 * scale,
          height: 100 * scale,
        }),
        render: () => ({ promise: Promise.resolve() }),
        cleanup: () => {},
        getOperatorList: async () => ({ fnArray: [] }),
      }),
    }),
    destroy: async () => {},
  }),
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
  h.pages = 3;
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

async function runAnalysis({ fullScore = false, ocrFail = false, llmFail = false } = {}) {
  h.ocrFail = ocrFail;
  h.llmFail = llmFail;
  const { container } = render(
    <UploadModal open onClose={() => {}} scoreId="score-1" onUploaded={() => {}} />,
  );
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: {
      files: [new File([new Uint8Array([1])], "圆号1,2.pdf", { type: "application/pdf" })],
    },
  });
  await waitFor(() => expect(screen.getByText("圆号1,2.pdf")).toBeTruthy());
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
});
