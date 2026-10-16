/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { h, okReply, UploadModal } from "./upload-modal-harness";

/**
 * 自动分段（#386）的**集成**用例：驱动真组件，钉的是「判据接上了没有」。
 *
 * 判据本体（行级 verdict / 批次闸门 / 目标集）在 `../auto-segment.test.ts` 里，纯函数、可单测
 * —— 这里**不重测它**。这个文件只回答纯单测答不了的三件事：
 *
 * 1. 关着时**真的**一个分段调用都没有（不是「没测」，对照组真跑：勾上之后真的自动点火）；
 * 2. 同一批里混着弃权行时，**真的**没为它烧那 N 次 OCR（能数出来的只有 OCR 调用次数，
 *    「判据说它不进池」是纯单测的事）；
 * 3. 自动那一次失败时**真的**留在行上、且**真的**不自动重试（无界循环），
 *    以及关窗**真的**收手。
 *
 * ⚠️ 组件只从 harness 拿（`UploadModal`）—— **不要**直接 `import "../upload-modal"`：
 * 那会让真模块先于 `vi.mock` 求值（见 `__tests__/upload-modal-mocks.ts` 的说明）。
 */

type SwitchState = "off" | "on";

/**
 * 走一遍「选文件 →（按需勾上「乐谱分段」）→ 开始分析 → 等分析收尾」，返回 render 结果
 * （关窗那条用例要用 `unmount`）。
 */
async function analyze({
  autoSegment,
  names = ["a.pdf"],
}: {
  autoSegment: SwitchState;
  names?: string[];
}) {
  const view = render(
    <UploadModal open onClose={h.onClose} scoreId="score-1" onUploaded={() => {}} />,
  );
  fireEvent.change(view.container.querySelector('input[type="file"]')!, {
    target: {
      files: names.map((n) => new File([new Uint8Array([1])], n, { type: "application/pdf" })),
    },
  });
  for (const n of names) await waitFor(() => expect(screen.getByText(n)).toBeTruthy());

  if (autoSegment === "on") {
    // 前提，不是断言本身：这一条测的是「勾上之后」。（「默认关」由 `../upload-modal.test.tsx`
    // 那条钉住；这里写前提是因为默认值一旦翻回 true，这里的 `click` 会把开关**关掉**，
    // 于是失败信息会指向无辜的自动点火。）
    const sw = screen.getByLabelText("乐谱分段") as HTMLInputElement;
    expect(sw.checked, "前提：默认关").toBe(false);
    fireEvent.click(sw);
    expect(sw.checked, "前提：点一下就该勾上").toBe(true);
  }

  fireEvent.click(screen.getByText(/开始分析/));
  await waitFor(() => expect(screen.queryByText(/取消分析/)).toBeNull(), { timeout: 10000 });
  return view;
}

/** 窄带 OCR 的调用次数 —— 分段那条路独有的开销（分析的 OCR 送的是标题区/整页，不是窄带） */
const bandCalls = () => h.bandCalls;

describe("自动分段接上了没有（#386）", () => {
  it("关着（默认）：分析收尾后零分段调用；页脚按钮照旧在，手点照样跑", async () => {
    h.llmReply = okReply();
    await analyze({ autoSegment: "off" });

    // 前提（也是对照组的地基）：这一行**本来就该**能分段 —— 多页、非总谱、认得出乐器。
    // 没有这个前提，下面那些负向断言会空转（不合格的行本来就不会跑）。
    await waitFor(() => expect(screen.getByText(/^识别分段（/)).toBeTruthy(), { timeout: 10000 });
    expect(h.segmentBody, "关着时不该有 segment-parts 调用").toBeNull();
    expect(bandCalls(), "关着时不该烧窄带 OCR").toBe(0);
    expect(h.mosaicCalls, "关着时不该走拼图那条路").toBe(0);
    expect(screen.queryByText("还原为一份"), "关着时行不该被拆").toBeNull();

    // ★ 变异（接线）：`useAutoSegment` 的 `enabled: autoSegment` 改成 `enabled: true`
    //   → 自动点火 → 上面三处计数全涨、行被拆 ⇒ 这一条变红。
    //
    // 另一半：手点那条路**一字未动** —— 开关不再管按钮的显隐（#386 契约订正 1：关着 =
    // 不自动跑，而不是「不给按钮」）。这一半同时让上面那些负向断言有了对照。
    // ★ 变异：`segPending` 里加回 `autoSegment &&` → 按钮不渲染 → 这一条变红。
    fireEvent.click(screen.getByText(/^识别分段（/));
    await waitFor(() => expect(screen.getAllByText("还原为一份")).toHaveLength(2), {
      timeout: 10000,
    });
  });

  it("勾上之后：分析一收尾就自动点火，**不用点页脚按钮**（3 页 → 拆成 2 段）", async () => {
    h.llmReply = okReply();
    await analyze({ autoSegment: "on" });

    await waitFor(() => expect(screen.getAllByText("还原为一份")).toHaveLength(2), {
      timeout: 10000,
    });
    // 拆完之后这两段都不是候选（切出来的段不再分段）⇒ 按钮消失。这一条顺带证明拆行是
    // **自动**路径干的：全程没有任何一次按钮点击。
    expect(screen.queryByText(/^识别分段（/)).toBeNull();
    expect(bandCalls()).toBe(3);

    // ★ 变异（接线层）：`use-auto-segment.ts` 里那条 layout effect 的依赖数组换成 `[]`
    //   → 只在挂载那一刻评估一次（那时还在选文件阶段）⇒ 永远不点火 ⇒ 这一条变红。
  });

  it("同批混着弃权行：不为它烧 OCR（3 次窄带 = 合格那一行一份）", async () => {
    h.llmReply = okReply(); // 段级识别不带文件名，落到这份上
    h.llmReplyFor = {
      "弃权.pdf": { success: true, section: "", instrument: "", subParts: [], isFullScore: false },
    };
    await analyze({ autoSegment: "on", names: ["弃权.pdf", "合格.pdf"] });

    await waitFor(() => expect(screen.getAllByText("还原为一份")).toHaveLength(2), {
      timeout: 10000,
    });
    // ⚠️ 只有**一行**被跑：3 页 × 1 行 = 3 次。两层判据（自动判据 + `segEligible`）任意一层
    // 单独失效时这里仍是 3（它们读同一个 `isUnidentified`，本模块那层是另一层的严格前缀，
    // 见 `../auto-segment.test.ts` 里那条用例的说明）—— 所以下面这条变异必须**两层一起改**。
    expect(bandCalls(), "弃权行也被带上跑了（6 = 两行份）").toBe(3);
    // 弃权行还在原地，文案是它专属的那句（连「可改分段点」都没有）
    expect(screen.getByText("未识别（3 页）—— 先选定声部，再识别分段")).toBeTruthy();

    // ★ 变异（组合）：删掉 `auto-segment.ts` 的 `isUnidentified` 分支 **加上**
    //   `row-text.ts` 的 `!isUnidentified(f) &&` → 弃权行进目标集 ⇒ 6 次窄带、4 行「还原为一份」⇒ 变红。
  });

  it("自动那一次失败也落在行上（不静默），且**不自动重试**（否则是无界循环）", async () => {
    h.llmReply = okReply();
    // 三页窄带全失败 = `ocrBandsForSegmentation` 抛错那条路：**一页文本都没拿到**，
    // 于是 `pageTexts` 一个字都没落 —— 下次再跑必然重新烧 OCR（这一条正是下面那个计数灵敏的原因）
    h.bandFailFor = [1, 2, 3];
    await analyze({ autoSegment: "on" });

    // 先等一轮跑完（3 页 = 3 次），**再**断言它停在这里：反过来的话，无界循环会让
    // 「行上有那句失败」变成一闪一闪 —— 断言在等一个闪的东西，读起来像超时而不是像循环。
    await waitFor(() => expect(bandCalls()).toBeGreaterThanOrEqual(3), { timeout: 10000 });
    // `segState: "error"` 的行**不该**被自动路径捡起来重跑 —— 捡起来就是
    // 「失败 → 收尾 → 再失败 → …」，而这个循环不会自己停。
    await new Promise((r) => setTimeout(r, 50));
    expect(bandCalls(), "失败的行被自动重试了（无界循环）").toBe(3);

    // 失败不静默：与手点路径**同一句**文案、同一个行内红字
    expect(screen.getByText(/^失败：全部 3 页的窄带 OCR 都失败了/)).toBeTruthy();
    // 重试仍然由人点：按钮还在（手点路径的取数面把 `error` 行当候选，那是**有意的**）
    expect(screen.getByText(/^识别分段（/)).toBeTruthy();

    // ★ 变异：删掉 `auto-segment.ts` 里 `f.segState !== undefined` 那一行 → 失败行重新进池、
    //   计数继续涨（无界循环）⇒ 这一条变红。
  });

  it("自动点火的这一次，关窗后同样收手（与手点共用 cancelledRef）", async () => {
    h.llmReply = okReply();

    // 把**分析**那一次 OCR 挂住：这样才有一个确定的时刻可以说「自动点火已经开始、
    // 第 1 页窄带还在飞」（真实时序里那一拍只有几十毫秒，用 sleep 去卡它必然抖）。
    let releaseAnalysis!: () => void;
    h.ocrGate = new Promise<void>((r) => {
      releaseAnalysis = r;
    });
    const view = render(
      <UploadModal open onClose={h.onClose} scoreId="score-1" onUploaded={() => {}} />,
    );
    fireEvent.change(view.container.querySelector('input[type="file"]')!, {
      target: { files: [new File([new Uint8Array([1])], "a.pdf", { type: "application/pdf" })] },
    });
    await waitFor(() => expect(screen.getByText("a.pdf")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("乐谱分段"));
    fireEvent.click(screen.getByText(/开始分析/));

    await waitFor(() => expect(h.ocrStarted).toBe(1), { timeout: 10000 });
    releaseAnalysis();
    // 在**同一个 tick** 里重新挂上门：分析已经不需要 OCR 了（`okReply` 第一张图就有结论），
    // 所以下一个撞上它的必然是分段那条路的第 1 页窄带。
    let releaseSeg!: () => void;
    h.ocrGate = new Promise<void>((r) => {
      releaseSeg = r;
    });
    await waitFor(() => expect(h.ocrStarted).toBe(2), { timeout: 10000 });
    expect(h.llm, "分析只问了一次 —— 否则第 2 次 OCR 可能还是分析的").toHaveLength(1);
    expect(bandCalls(), "闸门挂住的这一刻半次窄带都还没回来").toBe(0);

    // 关窗：`page.tsx` 的 `onClose` 就是父组件把弹窗卸掉（这里直接卸）
    view.unmount();
    releaseSeg();

    await waitFor(() => expect(bandCalls()).toBeGreaterThan(0), { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 50));
    expect(bandCalls(), "关窗后还在往后跑页（取消点没生效）").toBe(1);
    expect(h.segmentBody, "关窗后还发起了 segment-parts").toBeNull();

    // ★ 变异：把分段那条 `ocrBandsForSegmentation` 的 `isCancelled: () => cancelledRef.current`
    //   换成 `() => false` → 关窗后照旧把 3 页跑完并调 `segment-parts` ⇒ 这一条变红。
  });
});
