/**
 * 分段结果的**核实面板**（pkuso-backend#96 §6 的人工侧）集成用例 —— 走真的弹窗、真的分段链路。
 *
 * 它要解决的是管理员那两句抱怨：**「分段流程别扭 + 出错了没法核实」**。分段的结论只有一行
 * 「识别出 N 段 / 1 段」，而**「模型没找到边界」与「模型找到了、被后端丢掉」在那行字上逐字相同**
 * —— 两者的修法却相反（改 prompt vs 改校验）。面板把这一层的差异、每条边界的引文、以及
 * 「模型看到的那条窄带」摆出来，让「人工补一条边界」不必重跑 OCR（#290 的验收标准之一）。
 *
 * ## 这里的四条判据（用例按它组织）
 *
 * 1. **不许猜**：响应里没有 `rawCuts` 这个字段（prod 现在的后端）⇒ 面板必须说「分不开」；
 *    回了 `rawCuts: []` 也只能说「这次没拿到切点」，**不许**点名原因（后端把「模型弃权」与
 *    「输出没解析出来」折叠成同一个形状）。两种响应各占一条用例。
 * 2. **默认关着 = 零成本**：不展开就一次 PDF 渲染、一次 OCR 都不发。
 * 3. **展开只渲染边界那几页**（边界页 ±1），且从缓存补 —— 挪一次边界不会重渲染手里的页。
 * 4. **挪边界不重跑 OCR、不调模型**：页文本与窄带图都已经在手里。这条是零配额的前提。
 *
 * ⚠️ 用共享 harness（`./upload-modal-harness`）而不是自己搭假依赖：`vi.mock` 的注册时机
 * 有一条硬约束（见那个文件的头注释）。⚠️ **不要**把这批用例写进 `upload-modal-walk.test.tsx`。
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { h, readyToSegment, startSegmentation } from "./upload-modal-harness";
import { SegEvidence } from "../components/seg-evidence";
import type { UploadFile } from "../upload-modal.types";

/** 点「识别分段」并等到这一行跑完。
 *  ⚠️ 不能复用 harness 的 `startSegmentation`：那个等的是「拆出 2 行」，
 *  而弃权（`cuts` 为空）那条路上**不会有拆** —— 等它只会超时。 */
async function segmentAndWaitFor(text: string) {
  fireEvent.click(screen.getByText(/^识别分段（/));
  await waitFor(() => expect(screen.getByText(text)).toBeTruthy(), { timeout: 10000 });
}

/** 展开核实面板（按钮文案是它的两个状态，见 `seg-evidence.tsx`） */
function openPanel() {
  fireEvent.click(screen.getByText("分段依据与页文本"));
}

describe("核实面板：『模型弃权』与『后端没回这个字段』必须分得开", () => {
  it("回了 `rawCuts: []` ⇒ 说「这次没拿到任何切点」；一段不拆，面板就在屏幕上", async () => {
    h.pages = 3;
    h.segmentCuts = [];
    h.segmentExtra = { evidence: [], rawCuts: [], rejected: [] };
    await readyToSegment();
    await segmentAndWaitFor("识别出 1 段");
    // 只有一段 ⇒ 不自动拆 ⇒ 源行还在屏幕上（多段那条路要先把行拆出去，见下一个 describe）
    expect(screen.getByText("识别出 1 段")).toBeTruthy();
    expect(screen.queryByText("确认这 1 段")).toBeNull();

    // 关着 = 零成本：一次页都没取过，也没有任何图
    h.pagesFetched = [];
    const invokes = h.invokeTimeouts.length;
    expect(screen.queryAllByAltText(/首部窄带/)).toHaveLength(0);

    openPanel();
    // ⚠️ 文案**不许**说「模型弃权」：后端在「模型回了空 cuts」与「输出没解析成那个形状」上回的是
    // 同一个形状（`rawCuts: []`），替它下结论会把管理员推向「改 prompt」而真相可能是输出被截断。
    expect(
      screen.getByText(
        "这次没拿到任何切点 —— 漏掉的边界只能人工补" +
          "（「模型弃权」与「输出没解析出来」在后端是同一个形状，这里分不开）",
      ),
    ).toBeTruthy();
    // 没有边界 ⇒ 没有边界那一块（也没有可点的缩略图），页也没被取过
    expect(screen.queryByText(/^第 2 段从第/)).toBeNull();
    expect(screen.queryAllByAltText(/首部窄带/)).toHaveLength(0);
    expect(h.pagesFetched).toEqual([]);
    // 页文本那一块是零成本的（数据早在手上）：没拿到切点时它是唯一能看出「为什么没切」的东西
    expect(screen.getByText("全部 3 页的窄带文本：")).toBeTruthy();
    expect(screen.getByText("第 1 页：第1页页眉")).toBeTruthy();
    expect(screen.getByText("第 3 页：第3页页眉")).toBeTruthy();
    // 展开面板不发任何请求
    expect(h.invokeTimeouts.length).toBe(invokes);
  });

  it("响应里**没有** rawCuts（prod 现在的后端）⇒ 说「分不开」，绝不说「弃权」", async () => {
    // 默认 `h.segmentExtra = {}` 复刻的正是那个后端：响应里没有这两个字段。
    // ⚠️ 这一条与上面那条**必须不同形** —— 它是本仓唯一钉住「`undefined` 没被 `?? []` 抹平」
    // 的用例：抹平之后界面会把「不知道」说成「模型弃权」，而那是一句**假话**
    //（管理员据此去改 prompt，方向从头到尾都是错的）。
    h.pages = 3;
    h.segmentCuts = [];
    await readyToSegment();
    await segmentAndWaitFor("识别出 1 段");

    openPanel();
    expect(
      screen.getByText(
        "这次响应里没有 rawCuts / rejected（后端还没回这两个字段）——" +
          "「模型没给切点」与「给了被丢掉」在这里分不开",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/弃权/)).toBeNull();
    // 页文本那一块与后端回什么无关：它就在手上
    expect(screen.getByText("全部 3 页的窄带文本：")).toBeTruthy();
  });

  it("这一行压根没有诊断字段（防御分支）：说「看不到」，也不说「弃权」", async () => {
    // 走界面今天到不了这里（`startSegmentation` 每次都写 `segDiagnostics`），
    // 所以直接给组件一份没有该字段的行 —— 钉住的是「没有数据时不许下结论」这条纪律，
    // 而不是某条业务路径。
    const f = {
      file: new File([new Uint8Array([1])], "x.pdf", { type: "application/pdf" }),
      pageCount: 4,
      pageTexts: [{ page: 1, text: "第1页页眉" }],
      segmentStarts: [1],
    } as unknown as UploadFile;
    render(
      <SegEvidence
        f={f}
        i={0}
        phase="confirm"
        segBusy={false}
        starts={[1]}
        onSegmentStartRawChange={() => {}}
        onCommitSegmentStart={() => {}}
        onMergeSegment={() => {}}
        onSplitSegment={() => {}}
      />,
    );

    openPanel();
    expect(screen.getByText("这次分段没留下诊断字段 —— 引文与「为什么没切」都看不到")).toBeTruthy();
    expect(screen.queryByText(/弃权/)).toBeNull();
    expect(screen.queryByText(/分不开/)).toBeNull();
  });
});

describe("核实面板：边界那几页的窄带图、引文、被丢掉的切点", () => {
  /** 5 页；模型给 2 个切点（第 3、4 页），后端只留下第 3 页（第 4 页的引文在原文里找不到）。
   *  跑完自动拆成两行 —— 源行离屏，用「还原为一份」把它（连同诊断字段）放回来。 */
  async function setup() {
    h.pages = 5;
    h.segmentCuts = [3];
    h.segmentExtra = {
      evidence: ["Corno II in F"],
      rawCuts: [3, 4],
      rejected: [{ page: 4, reason: "evidence-unsupported", evidence: "Oboe I in C" }],
    };
    await readyToSegment();
    await startSegmentation();
    fireEvent.click(screen.getAllByText("还原为一份")[0]);
    await waitFor(() => expect(screen.getByText("识别出 2 段 —— 可改分段点")).toBeTruthy());
    // 等段级识别（`refineSegments`：每段一次 `llm-analyze`）落地再取基线，
    // 否则它的长尾会让下面「一次模型都没调」的断言偶发地假红
    await waitFor(() => expect(h.llm.length).toBe(3), { timeout: 10000 });
    return {
      invokes: h.invokeTimeouts.length,
      ocr: h.ocr.length,
      bandCalls: h.bandCalls,
      mosaicCalls: h.mosaicCalls,
      llm: h.llm.length,
    };
  }

  it("展开只渲染边界页 ±1；引文与理由都在；挪边界不重跑 OCR / 不调模型", async () => {
    const base = await setup();

    h.pagesFetched = [];
    // 关着 = 零成本（这一条在**有边界**的行上也必须成立：图是按需出的）
    expect(screen.queryAllByAltText(/首部窄带/)).toHaveLength(0);
    expect(h.pagesFetched).toEqual([]);
    openPanel();

    // 候选页 = 第 3 页 ±1。一份 5 页的谱不会因为看一眼就全渲染
    await screen.findByAltText("第 2 页首部窄带");
    await waitFor(() => expect(h.pagesFetched).toEqual([2, 3, 4]));
    expect(screen.getByAltText("第 3 页首部窄带")).toBeTruthy();
    expect(screen.getByAltText("第 4 页首部窄带")).toBeTruthy();
    expect(screen.getByLabelText("第 3 页（当前边界）")).toBeTruthy();

    // ① 模型的产出与被丢掉的那一条（`evidence` 与 `rawCuts` / `rejected` 都在响应里，
    //    此前前端把它们整个丢掉 —— 「为什么没切」于是无从查起）
    expect(screen.getByText("模型给了 2 个切点，后端留下 1 个")).toBeTruthy();
    expect(
      screen.getByText("第 4 页：evidence-unsupported（模型抄的引文「Oboe I in C」）"),
    ).toBeTruthy();
    // ② 这条边界的引文 + 那一页的窄带文本（同一份 OCR 产物，零成本）
    expect(screen.getByText("第 2 段从第 3 页起")).toBeTruthy();
    expect(screen.getByText("模型引文：「Corno II in F」")).toBeTruthy();
    expect(screen.getByText("这一页的窄带文本：第3页页眉")).toBeTruthy();
    // ③ 全部页的窄带文本
    expect(screen.getByText("全部 5 页的窄带文本：")).toBeTruthy();
    expect(screen.getByText("第 5 页：第5页页眉")).toBeTruthy();

    // 出图只是**渲染**：既没有 OCR、也没有模型调用
    expect(h.invokeTimeouts.length).toBe(base.invokes);
    expect(h.ocr.length).toBe(base.ocr);
    expect(h.bandCalls).toBe(base.bandCalls);
    expect(h.mosaicCalls).toBe(base.mosaicCalls);
    expect(h.llm.length).toBe(base.llm);

    // 挪边界：与用户在输入框里手打一遍走的是同一个入口（`moveSegmentStart`），
    // 页文本与窄带图都已经在手里 ⇒ 不重跑 OCR、不调模型
    fireEvent.click(screen.getByLabelText("把第 2 段的起点挪到第 4 页"));
    await waitFor(() => expect(screen.getByLabelText("第 4 页（当前边界）")).toBeTruthy());
    expect(screen.getByText("第 2 段从第 4 页起")).toBeTruthy();
    // 边界真的动了：段块里的区间跟着变（第 1 段 1–3、第 2 段 4–5），输入框也跟着变
    expect(screen.getByDisplayValue("4")).toBeTruthy();
    expect(screen.getByText("– 第 3 页")).toBeTruthy();
    expect(screen.getByText("– 第 5 页")).toBeTruthy();
    // 挪到第 4 页之后这条边界**没有**引文（`evidence` 只对应模型原来给的第 3 页）：
    // 界面要直说没有，而不是留着上一条的引文、或编一句像样的话
    expect(
      screen.getByText("模型没有为这一页给出引文（这一条边界可能是你手动挪过来的）"),
    ).toBeTruthy();
    expect(screen.queryByText("模型引文：「Corno II in F」")).toBeNull();

    // 新边界要的那一页（第 5 页）才补渲染；手里有的 3、4 不重取
    await waitFor(() => expect(h.pagesFetched).toEqual([2, 3, 4, 5]));
    expect(h.invokeTimeouts.length).toBe(base.invokes);
    expect(h.ocr.length).toBe(base.ocr);
    expect(h.bandCalls).toBe(base.bandCalls);
    expect(h.llm.length).toBe(base.llm);
  });

  it("出图失败：整份打不开 ⇒ 每页说「没渲染出来」，不许永远停在「渲染中…」", async () => {
    // 输入/状态：选中文件之后文件被移走 / pdf.js 资源缺失（`getDocument` 直接抛）。
    // 判据来自 band-render 的 docblock：「请求过却没回来」要说一句，而不是永远转圈。
    await setup();
    h.loadFail = true;
    openPanel();

    await waitFor(() => expect(screen.getByText(/窄带图没能渲染：/)).toBeTruthy());
    // 修前：`thumbs` 停在 `null`，三个候选页全是「渲染中…」，与旁边那句「没能渲染」互相打架
    expect(screen.queryByText("渲染中…")).toBeNull();
    expect(screen.getAllByText("没渲染出来")).toHaveLength(3);
  });

  it("出图失败：只有一页画不出来 ⇒ 那一页说「没渲染出来」，别的页照常出图", async () => {
    await setup();
    h.renderFailPages = [3];
    openPanel();

    await screen.findByAltText("第 2 页首部窄带");
    expect(screen.getByAltText("第 4 页首部窄带")).toBeTruthy();
    expect(screen.queryByAltText("第 3 页首部窄带")).toBeNull();
    expect(screen.getAllByText("没渲染出来")).toHaveLength(1);
    // 单页失败**不是**整份失败：不该冒那句红字
    expect(screen.queryByText(/窄带图没能渲染：/)).toBeNull();
  });
});

describe("核实面板：口径不能对读者说假话（独立渲染）", () => {
  /** 直接给组件一行（不走链路）：这些判据是「界面说了什么」，与哪条业务路径到达无关 */
  function renderRow(f: Record<string, unknown>) {
    return render(
      <SegEvidence
        f={
          {
            file: new File([new Uint8Array([1])], "x.pdf", { type: "application/pdf" }),
            segmentStarts: [1, 3],
            ...f,
          } as unknown as UploadFile
        }
        i={0}
        phase="confirm"
        segBusy={false}
        starts={[1, 3]}
        onSegmentStartRawChange={() => {}}
        onCommitSegmentStart={() => {}}
        onMergeSegment={() => {}}
        onSplitSegment={() => {}}
      />,
    );
  }

  it("有页 OCR 失败 ⇒ 总数报「共 N 页」，不拿取到的页数冒充「全部」", async () => {
    renderRow({
      pageCount: 5,
      // 第 2、4 页 OCR 失败 ⇒ 不在 `pageTexts` 里（这正是要防的那件事）
      pageTexts: [
        { page: 1, text: "第1页页眉" },
        { page: 3, text: "第3页页眉" },
        { page: 5, text: "第5页页眉" },
      ],
      segDiagnostics: { cuts: [], evidence: [], rawCuts: [], rejected: [] },
    });
    openPanel();
    expect(screen.getByText("已取到文本的 3 页（共 5 页）：")).toBeTruthy();
    expect(screen.queryByText("全部 3 页的窄带文本：")).toBeNull();
  });

  it("`cuts` 不是数组而 `rawCuts` 非空 ⇒ 只说模型给了几个，不编「后端留下几个」", async () => {
    renderRow({
      pageCount: 3,
      pageTexts: [{ page: 1, text: "第1页页眉" }],
      // 形状不对的响应（`cuts` 不是数组）：界面不许把 `undefined.length` 说成「留下 0 个」
      segDiagnostics: { cuts: undefined, evidence: [], rawCuts: [3], rejected: [] },
    });
    openPanel();
    expect(screen.getByText("模型给了 1 个切点")).toBeTruthy();
    expect(screen.queryByText(/后端留下/)).toBeNull();
  });
});

describe("核实面板：候选首页（页码 / 理由 / 置信度 / 后端裁决）", () => {
  /** 6 页；cuts=[3]（两段 1–2 / 3–6），两个候选：第 3 页已采纳、第 4 页低置信未采纳。
   *  跑完会自动拆成两行 —— 用「还原为一份」把源行（连同诊断字段）放回来。
   *
   *  ⚠️ 候选页选 **4**（不是段 3..6 的中点 5）：这样「采用为边界」若没把页号传给
   *  `splitSegment`、退回了中点，断言会当场变红（这正是本组用例要钉的那条）。 */
  async function setupCandidates() {
    h.pages = 6;
    h.segmentCuts = [3];
    h.segmentExtra = {
      evidence: ["Corno II in F"],
      rawCuts: [3, 4],
      rejected: [{ page: 4, reason: "low-confidence" }],
      candidates: [
        { page: 3, reason: "标题块与第 1 页同形状", confidence: 0.92, accepted: true },
        {
          page: 4,
          reason: "页眉换成了 Corno II",
          confidence: 0.3,
          accepted: false,
          rejection: "low-confidence",
        },
      ],
    };
    await readyToSegment();
    await startSegmentation();
    fireEvent.click(screen.getAllByText("还原为一份")[0]);
    await waitFor(() => expect(screen.getByText("识别出 2 段 —— 可改分段点")).toBeTruthy());
    // 等段级识别（每段一次 llm-analyze）落地再取基线，否则长尾会让「没调模型」偶发假红
    await waitFor(() => expect(h.llm.length).toBe(3), { timeout: 10000 });
    return {
      ocr: h.ocr.length,
      llm: h.llm.length,
      bandCalls: h.bandCalls,
      mosaicCalls: h.mosaicCalls,
      invokes: h.invokeTimeouts.length,
    };
  }

  it("列出全部候选；低置信整行警告色；「取消这条边界」走合并入口且不重跑 OCR / 模型", async () => {
    const base = await setupCandidates();
    openPanel();

    expect(screen.getByText("第 3 页 · 置信度 92% · 已采纳")).toBeTruthy();
    expect(screen.getByText("第 4 页 · 置信度 30% · 未采纳（low-confidence）")).toBeTruthy();
    expect(screen.getByText("理由：标题块与第 1 页同形状")).toBeTruthy();
    expect(screen.getByText("理由：页眉换成了 Corno II")).toBeTruthy();
    expect(
      screen.getByText("第 4 页 · 置信度 30% · 未采纳（low-confidence）").closest("li"),
    ).toHaveClass("text-warning");

    // 第 3 页当前是边界 ⇒ 「取消」；第 4 页不是 ⇒ 「采用」
    fireEvent.click(screen.getByText("取消这条边界"));
    await waitFor(() => expect(screen.getByText("识别出 1 段")).toBeTruthy());
    // 段数变回 1，边界输入框也随之消失（只有第 1 段，起点恒为第 1 页）
    expect(screen.queryByDisplayValue("3")).toBeNull();

    // 只是改 starts：零 OCR、零模型调用（页文本与诊断都还在手里）
    expect(h.ocr.length).toBe(base.ocr);
    expect(h.llm.length).toBe(base.llm);
    expect(h.bandCalls).toBe(base.bandCalls);
    expect(h.mosaicCalls).toBe(base.mosaicCalls);
    expect(h.invokeTimeouts.length).toBe(base.invokes);
  });

  it("低置信候选「采用为边界」：边界落在**候选页**（不是段中点），只改 starts、不重跑 OCR", async () => {
    const base = await setupCandidates();
    openPanel();

    fireEvent.click(screen.getByText("采用为边界"));
    await waitFor(() => expect(screen.getByText("识别出 3 段 —— 可改分段点")).toBeTruthy());
    // 第 4 页成为边界（段 3..6 的中点是 5 —— 没传页号的实现会在这里插 5）
    expect(screen.getByDisplayValue("4")).toBeTruthy();
    expect(screen.queryByDisplayValue("5")).toBeNull();
    // 区间：1–2 / 3–3 / 4–6
    expect(screen.getByText("– 第 2 页")).toBeTruthy();
    expect(screen.getByText("– 第 3 页")).toBeTruthy();
    expect(screen.getByText("– 第 6 页")).toBeTruthy();

    expect(h.ocr.length).toBe(base.ocr);
    expect(h.llm.length).toBe(base.llm);
    expect(h.bandCalls).toBe(base.bandCalls);
    expect(h.mosaicCalls).toBe(base.mosaicCalls);
    expect(h.invokeTimeouts.length).toBe(base.invokes);
  });
});

describe("核实面板：候选字段『缺失』与『空数组』不许说成同一句话", () => {
  function renderPanel(diag: Record<string, unknown>, starts = [1, 3]) {
    const onMerge = vi.fn();
    const onSplit = vi.fn();
    render(
      <SegEvidence
        f={
          {
            file: new File([new Uint8Array([1])], "x.pdf", { type: "application/pdf" }),
            pageCount: 6,
            pageTexts: [{ page: 1, text: "第1页页眉" }],
            segmentStarts: starts,
            segDiagnostics: { cuts: [3], evidence: [], rawCuts: [3], rejected: [], ...diag },
          } as unknown as UploadFile
        }
        i={0}
        phase="confirm"
        segBusy={false}
        starts={starts}
        onSegmentStartRawChange={() => {}}
        onCommitSegmentStart={() => {}}
        onMergeSegment={onMerge}
        onSplitSegment={onSplit}
      />,
    );
    openPanel();
    return { onMerge, onSplit };
  }

  it("没有 candidates 字段 ⇒ 说「后端还没升级」，**不许**说成「没有候选」", () => {
    renderPanel({});
    expect(screen.getByText("这次响应没有候选字段（后端还没升级）")).toBeTruthy();
    expect(screen.queryByText("这次响应里没有候选首页")).toBeNull();
  });

  it("candidates: [] ⇒ 说「这次响应里没有候选首页」，不许说成「后端还没升级」", () => {
    renderPanel({ candidates: [] });
    expect(screen.getByText("这次响应里没有候选首页")).toBeTruthy();
    expect(screen.queryByText("这次响应没有候选字段（后端还没升级）")).toBeNull();
  });

  it("渲染页码 / 理由 / 置信度百分比 / 采纳状态；理由缺失与置信度缺失直说", () => {
    renderPanel({
      candidates: [
        { page: 3, reason: "标题块与第 1 页同形状", confidence: 0.926, accepted: true },
        {
          page: 4,
          reason: "页眉换成了 Corno II",
          confidence: 0.3,
          accepted: false,
          rejection: "low-confidence",
        },
        { page: 5, reason: null, confidence: null, accepted: false },
      ],
    });
    expect(screen.getByText("第 3 页 · 置信度 93% · 已采纳")).toBeTruthy();
    expect(screen.getByText("第 4 页 · 置信度 30% · 未采纳（low-confidence）")).toBeTruthy();
    expect(screen.getByText("第 5 页 · 置信度未给出 · 未采纳")).toBeTruthy();
    expect(screen.getByText("理由：标题块与第 1 页同形状")).toBeTruthy();
    expect(screen.getByText("理由：页眉换成了 Corno II")).toBeTruthy();
    expect(screen.getByText("理由：（模型没写理由）")).toBeTruthy();
  });

  it("按钮接到**已有的**合并/拆分入口：取消 → onMerge(i, 边界下标)；采用 → onSplit(i, 段下标, 候选页)", () => {
    const { onMerge, onSplit } = renderPanel({
      candidates: [
        { page: 3, reason: "a", confidence: 0.9, accepted: true },
        { page: 4, reason: "b", confidence: 0.3, accepted: false, rejection: "low-confidence" },
      ],
    });
    fireEvent.click(screen.getByText("取消这条边界"));
    expect(onMerge).toHaveBeenCalledWith(0, 1);
    fireEvent.click(screen.getByText("采用为边界"));
    // 第 4 页落在第 1 段（starts=[1,3]）—— 段下标与页号都要传对
    expect(onSplit).toHaveBeenCalledWith(0, 1, 4);
  });

  it("动作按**当前** starts 判断：已采纳的候选若已被用户删掉，给的是「采用」而不是「取消」", () => {
    renderPanel({ candidates: [{ page: 3, reason: "a", confidence: 0.9, accepted: true }] }, [1]);
    expect(screen.getByText("采用为边界")).toBeTruthy();
    expect(screen.queryByText("取消这条边界")).toBeNull();
  });
});
