/**
 * `upload-modal-walk` 那套集成测试的**共享 harness**：写用例只需要 import 这一个模块。
 *
 * 它做两件事：
 * 1. **保证假依赖先注册** —— 文件第一行就是 `import "./upload-modal-mocks"`，于是
 *    `vi.mock` 一定早于 `../upload-modal` 求值（顺序反了会拿到真模块，见那个文件的注释）。
 * 2. **转发夹具与工具** —— `h` / `W` / `TITLE_TAG` / `UploadModal` 与那几个驱动函数。
 *
 * 驱动函数都是从原测试文件里原样搬出来的：`installMosaicStub`（给 jsdom 补
 * `createImageBitmap`，让拼图成功路径可达）、`runAnalysis`、`readyToSegment`、
 * `startSegmentation`、`segButtonCount`、`okReply`。
 *
 * ⚠️ **不要在测试文件里直接 import `../upload-modal`**：那会让真模块先于
 * `vi.mock` 注册而求值。要组件就从这里拿。
 */
import "./upload-modal-mocks";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { h, W, H, TITLE_TAG, FULL_TAG } from "./upload-modal-fixtures";
import { UploadModal } from "../upload-modal";

/**
 * 给 jsdom 装上 `createImageBitmap`，让 `composeMosaic` 那条**成功路径**可达。
 *
 * 为什么必须显式装（而不是「jsdom 里做不到」）：jsdom 没有它，`composeMosaic` 的**第一句**
 * 就抛，抛在「本组必须等高」那条判据**之前**，被 `ocrBandsForSegmentation` 的逐组 catch
 * 吞掉、退回逐页 —— 于是拼图的成功路径与「不等高」那条设计不变量**在整套测试里都不可达**，
 * 而两者的正确后果都是「结果看起来一样对」。环境缺的东西可以补，补上之后才分得开。
 *
 * 解码取 Blob 的文本当元数据（`toBlob` 桩把画布尺寸写成了字节，见 `TITLE_TAG` 的来历），
 * 所以这里拿到的宽高就是**实现真的画出来的**那张画的宽高 —— 拼不拼得成、长图多高，
 * 全由实现决定，桩不许替它做主。
 */
function installMosaicStub() {
  globalThis.createImageBitmap = (async (blob: Blob) => {
    const [width, height] = (await blob.text()).split("x").map(Number);
    return { width, height, close: () => {} };
  }) as never;
}

async function runAnalysis({
  fullScore = false,
  ocrFail = false,
  ocrError = null as null | {
    title?: "transient" | "permanent";
    full?: "transient" | "permanent";
  },
  llmFail = false,
  loadFail = false,
  renderFailPages = [] as number[],
  names = ["圆号1,2.pdf"],
} = {}) {
  h.ocrFail = ocrFail;
  h.ocrError = ocrError;
  h.llmFail = llmFail;
  h.loadFail = loadFail;
  h.renderFailPages = renderFailPages;
  const { container } = render(
    <UploadModal open onClose={h.onClose} scoreId="score-1" onUploaded={() => {}} />,
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

/**
 * 一行进入「可以点『识别分段』」的状态（多页 + 非总谱 + 已识别）。
 *
 * 分段那条链路的入口只有它（`segEligible` 三个条件都要满足），所以凡是走分段的用例
 * 都从这里起步 —— 提到模块作用域是因为两处 describe 都要用（同 `runAnalysis`）。
 */
async function readyToSegment() {
  h.llmReply = {
    success: true,
    section: "圆号",
    instrument: "F调圆号",
    subParts: [1],
    isFullScore: false,
  };
  await runAnalysis({ names: ["短笛长笛.pdf"] });
  await waitFor(() => expect(screen.getByText(/^已识别 → 圆号/)).toBeTruthy(), {
    timeout: 10000,
  });
}

/** 点「识别分段」并等到自动拆出两段（切点默认 `[2]`） */
async function startSegmentation() {
  fireEvent.click(screen.getByText(/^识别分段（/));
  await waitFor(() => expect(screen.getAllByText("还原为一份")).toHaveLength(2), {
    timeout: 10000,
  });
}

/** 「识别分段（N 份，约 M 次 OCR）」里的 N */
function segButtonCount(): number {
  const btn = screen.getByText(/^识别分段（/).textContent ?? "";
  const m = /（(\d+) 份/.exec(btn);
  if (!m) throw new Error("按钮文案里读不出份数: " + JSON.stringify(btn));
  return Number(m[1]);
}

/** 一段 LLM 回复的默认形状。`section === "总谱"` 才算总谱 —— 与后端同一条判据 */
const okReply = (section = "圆号", instrument = "圆号") => ({
  success: true,
  section,
  instrument,
  subParts: [] as number[],
  isFullScore: section === "总谱",
});

export { h, W, H, TITLE_TAG, FULL_TAG, UploadModal };
export { installMosaicStub, runAnalysis, readyToSegment, startSegmentation };
export { segButtonCount, okReply };
