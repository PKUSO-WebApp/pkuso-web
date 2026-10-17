/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PDFDocument } from "pdf-lib";
// ⚠️ 只从这里拿组件与夹具：文件第一行的 `import "./upload-modal-mocks"` 保证假依赖先注册。
// 直接 import `../upload-modal` 会让真模块先求值（拿到真 supabase / 真 pdfjs）。
import { h, okReply, runAnalysis, UploadModal } from "./__tests__/upload-modal-harness";

/**
 * **调用点接线类**（#326 §5 + §18 剩余的 disabled 析取项）：钉住「父组件算出来的值
 * 真的接到了叶子组件上」，判据是**可观测的界面行为**（渲染出的数字 / 文案 / 禁用态），
 * 不是「prop 传了没有」—— 后者在「这批 prop 全部错接、全套用例照样全绿」的时代就存在过
 *（#317 §21、§32：`upload-modal.test.tsx` 里的 render 冒烟与纯函数单测都看不见接线）。
 *
 * 每条用例末尾那句 `★ 变异：…` = 把该调用点改成**兄弟值或常量**之后，本用例会变红的那一句；
 * 「抓住」的判据是**串行复跑**后「这条用例名出现在失败列表里」（并行会出假 CAUGHT，见 #326）。
 *
 * ⚠️ 本文件**只补没人钉住的接线点**，不重复覆盖 `upload-modal-walk.test.tsx` 已有的那些
 *（哪些已被既有用例抓住、由哪个变异证明 —— 记在 #326 的收尾评论里，不在这里复述：
 * 那种清单会随两边改动各自腐烂）。
 *
 * ⚠️ 每条负向断言（「灰着」「不出现」）都配一个**正向同伴**，且同伴必须与它**同状态** ——
 * 所在状态里本来就无法失败/成立的断言是空转，它证明不了它名字里声称的那件事。
 * 所以下面一律「先断言能不能点，再动手，再断言灰没灰」。
 */

describe("接线点：FooterBar 的数字与出口（#326 §5）", () => {
  it("一行都没过分析时「确认上传（0/1）」灰着，**不许**改口成「完成（已上传 0 个）」", async () => {
    // 一整行 LLM 失败 = 死胡同行：`instrumentGuess` 恒为 undefined ⇒ 它一个都不算「可上传」，
    // 而 `doneCount` 也是 0 —— 这正是 `allDone` 里 `doneCount > 0` 那一格唯一能被区分出来的状态。
    await runAnalysis({ names: ["坏.pdf"], llmFail: true });

    // 正向同伴：这一行确实还有出路（「重试」能点），不是被永久锁死 ——
    // 没有它，上面那句「灰着」有可能是「整行都没渲染出来」造成的恒真。
    expect((screen.getByText("重试") as HTMLButtonElement).disabled).toBe(false);

    const btn = screen.getByText("确认上传（0/1）") as HTMLButtonElement;
    // ★ 变异：`footer-bar.tsx` 里删掉 `uploadableCount === 0 ||` ⇒ 变红
    expect(btn.disabled).toBe(true);
    // ★ 变异：`allDone={allDone}` → `{uploadableCount === 0}`（丢掉 `doneCount > 0`）
    //   ⇒ 界面变成「完成（已上传 0 个）」：一次都没传成功却告诉用户「完成」。
    expect(screen.queryByText(/^完成（已上传/)).toBeNull();
  });

  it("全部传完之后的出口是「完成（已上传 N 个）」，N 是**真传成功的行数**（不是待传行数）", async () => {
    h.user = { id: "u1" };
    h.llmReplyFor = {
      "圆号.pdf": { ...okReply("圆号", "F调圆号"), subParts: [1] },
      "长笛.pdf": { ...okReply("长笛", "长笛"), subParts: [1] },
    };
    await runAnalysis({ names: ["圆号.pdf", "长笛.pdf"] });

    // 正向同伴（同一个按钮的另一支）：传之前 `allDone` 必须是**假**的，否则下面那句
    // 「完成」可能是在一个恒真的分支里成立。两行都已识别 ⇒ 分子分母都是 2。
    const before = screen.getByText("确认上传（2/2）") as HTMLButtonElement;
    expect(before.disabled).toBe(false);
    fireEvent.click(before);

    const done = (await screen.findByText("完成（已上传 2 个）")) as HTMLButtonElement;
    expect(screen.queryByText(/^确认上传（/)).toBeNull();
    // 正向出口要真的通 —— 它是一个出口，不是一个标签
    fireEvent.click(done);
    expect(h.onClose).toHaveBeenCalled();

    // ★ 变异：`allDone={allDone}` → `{false}` ⇒ 传完仍渲染「确认上传（0/2）」+禁用，
    //   用户没有任何正向出口（这正是 `allDone` 的 docblock 说它要防的那件事）⇒ 变红。
    // ★ 变异：`doneCount={doneCount}` → `{uploadableCount}` ⇒ 文案变成「已上传 0 个」
    //   （传完时 `uploadableCount` 恰为 0）⇒ 变红。
  });
});

describe("接线点：「确认上传」的 disabled 析取项（#326 §18 剩下的两条）", () => {
  it("重试在飞时「确认上传」灰着 —— 灰它的理由**只能是** hasAnalyzingFiles", async () => {
    // 未识别（但已分析）的行：`instrumentGuess` 是空串、**不是 undefined**，
    // 所以它算「有待传的行」⇒ 按钮在这一相位本来是能点的。造这个状态是关键：
    // 若用「首次分析就失败」的行（`instrumentGuess === undefined`），按钮会因
    // `uploadableCount === 0` 灰着，于是把 `hasAnalyzingFiles ||` 整条删掉也照样绿。
    h.llmReply = {
      success: true,
      section: "圆号",
      instrument: "",
      subParts: [],
      isFullScore: false,
    };
    await runAnalysis({ names: ["说不清.pdf"] });

    const confirm = () =>
      screen.getByText(/^确认上传（1\/1）/).closest("button") as HTMLButtonElement;
    expect(confirm().disabled).toBe(false);

    // 让重试那一发 LLM 挂住（真实的一次要几秒到几十秒）
    let release: () => void = () => {};
    h.llmGate = new Promise<void>((r) => {
      release = r;
    });
    fireEvent.click(screen.getByText("重试"));

    // ★ 变异：删掉 `hasAnalyzingFiles ||` ⇒ 按钮一直可点 ⇒ 下面这句失败
    await waitFor(() => expect(confirm().disabled).toBe(true));
    // 「灰它的**只能是** `hasAnalyzingFiles`」这句靠**状态构造**成立，不是靠断言：
    // 另外三条析取项这时都够不着 —— `uploadableCount === 0` 被上面那句「可点」排除；
    // `phase` 停在 confirm（这批早就分析完、这一发挂住的是行级重试）；
    // `refiningCount` 只由 `refineSegments` 加，而它只被「确认这 N 段」调用
    //（本用例从头到尾没启动分段）。
    // ⚠️ 别在这里补「文案还是确认上传」之类的断言：那得靠 `getByText` 去找，
    // 而查找本身就是那句断言（同义反复）；`识别各段中` 那种负向断言在
    // `refiningCount` 结构性为 0 的状态里又不可能失败 —— 两条都是文件头那条纪律
    //（负向断言必须有**同状态**的正向同伴）要挡的形状。

    release();
    h.llmGate = null;
    // 放行后恢复（正向同伴：灰的不是「这个按钮坏了」）
    await waitFor(() => expect(confirm().disabled).toBe(false), { timeout: 10000 });
  });

  it("分段飞行窗口：「识别分段」「确认上传」与行上的「重试」三个都灰着，放行后各自恢复", async () => {
    // 一份可分段（已识别、多页）+ 一份分析失败（有「重试」、且不进分段池、也不算可上传行）。
    // 拆出来的两段各给一个不同乐器，免得名字撞上另一条判据（同组重名会整组拦下上传）。
    h.llmFailFor = ["坏.pdf"];
    h.llmReplies = [
      { ...okReply("圆号", "F调圆号"), subParts: [1] }, // 整份分析
      { ...okReply("圆号", "F调圆号"), subParts: [1] }, // 段 1
      { ...okReply("长笛", "长笛"), subParts: [1] }, // 段 2
    ];
    await runAnalysis({ names: ["短笛长笛.pdf", "坏.pdf"] });

    const segBtn = () => screen.getByText(/^识别分段/).closest("button") as HTMLButtonElement;
    const confirm = () =>
      screen.getByText(/^确认上传（1\/2）/).closest("button") as HTMLButtonElement;
    const retry = () => screen.getByText("重试").closest("button") as HTMLButtonElement;

    // ★ 这一段正向同伴是整条用例的地基：三个控件在窗口**之前**都必须能点，
    //   否则下面三句「灰着」可能是环境本来就灰（负向断言在所在状态里无法失败）。
    expect(segBtn().disabled).toBe(false);
    expect(confirm().disabled).toBe(false);
    expect(retry().disabled).toBe(false);

    // 窗口之前：分析那一相位**没有**发生过窄带 OCR（`bandCalls` 那个计数是给分段用的）。
    // 钉住这一条，下面那句「还没有一张回来」才是有内容的（否则两个非零数相等也能过）。
    expect(h.bandCalls).toBe(0);
    const ocrBefore = h.ocrStarted;
    let release: () => void = () => {};
    h.ocrGate = new Promise<void>((r) => {
      release = r;
    });
    fireEvent.click(segBtn());
    await waitFor(() => expect(screen.getByText("识别分段中...")).toBeTruthy());
    // 「识别分段中...」只说明**这一相位开始了**，不说明 OCR 已经发出去 ——
    // 窄带要先渲染、编码，才轮到调用。等到「确实发出去了」再断言：
    await waitFor(() => expect(h.ocrStarted).toBeGreaterThan(ocrBefore));
    // 而**一张都还没回来**（门还挂着）—— 通道不是哑的，只是还没人应答
    expect(h.bandCalls).toBe(0);

    // ★ 变异：`segBusy={segBusy}`（FooterBar）→ `{false}` ⇒ 第一句变红
    expect(segBtn().disabled).toBe(true);
    // ★ 变异：`footer-bar.tsx` 里删掉 `segBusy ||` ⇒ 第二句变红
    expect(confirm().disabled).toBe(true);
    // ★ 变异：`segBusy={segBusy}`（FileRow）→ `{false}` ⇒ 第三句变红
    expect(retry().disabled).toBe(true);

    release();
    h.ocrGate = null;
    // 放行并把这一相位跑干净（不留悬挂的 promise）：自动拆 → 段级识别也落定
    await waitFor(() => expect(screen.getAllByText("还原为一份")).toHaveLength(2), {
      timeout: 10000,
    });
    await waitFor(() => expect(screen.queryByText(/识别各段中/)).toBeNull(), { timeout: 10000 });

    // 正向同伴（放行后恢复）：屏幕上的另两个控件重新能点 ——
    // 「灰着」不是「这两个按钮坏了」。
    expect((screen.getByText(/^确认上传（/).closest("button") as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect((screen.getByText("重试").closest("button") as HTMLButtonElement).disabled).toBe(false);
  });
});

/**
 * 用**真 PDF 字节**跑一次导入并等分析收尾。
 *
 * 为什么不能直接用共享 harness 的 `runAnalysis`：它的夹具是 `new Uint8Array([1])`，
 * 而切分行的「确认上传」会走**真的 pdf-lib**（`openForSplit` → `PDFDocument.load`）——
 * 假字节在那里就抛，「已经传成功的那一段」这个状态也就造不出来。只服务下面那条用例，
 * 其余用例继续用共享 harness（那边的桩更全，也更便宜）。
 */
async function runAnalysisWithRealPdf(pageCount: number, name: string) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage();
  // 拷一份：`doc.save()` 返回的 `Uint8Array<ArrayBufferLike>` 不被 `BlobPart` 接受
  //（缓冲可能是 `SharedArrayBuffer`），`new Uint8Array(typedArray)` 明确给出 ArrayBuffer 支撑的那份
  const bytes = new Uint8Array(await doc.save());
  const { container } = render(
    <UploadModal open onClose={h.onClose} scoreId="score-1" onUploaded={() => {}} />,
  );
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: [new File([bytes], name, { type: "application/pdf" })] },
  });
  await waitFor(() => expect(screen.getByText(name)).toBeTruthy());
  fireEvent.click(screen.getByText(/开始分析/));
  await waitFor(() => expect(screen.queryByText(/取消分析/)).toBeNull(), { timeout: 10000 });
}

describe("接线点：段行上的两个函数 prop（#326 §5）", () => {
  it("「识别分段」按钮上写份数（管理员不需要看到 OCR 次数）", async () => {
    h.pages = 25;
    h.llmReplyFor = {
      "圆号.pdf": { ...okReply("圆号", "F调圆号"), subParts: [1] },
      "长笛.pdf": { ...okReply("长笛", "长笛"), subParts: [1] },
    };
    await runAnalysis({ names: ["圆号.pdf", "长笛.pdf"] });

    // ★ 变异：把份数写死或写成 OCR 次数 ⇒ 变红。
    expect(screen.getByText("识别分段（2 份）")).toBeTruthy();
  });

  it("同组里已有一段上传成功 ⇒「还原为一份」灰着并用 title 说明；同组不重名时那句提示**不出现**", async () => {
    h.user = { id: "u1" };
    h.llmReplies = [
      // 整份：两个号
      { ...okReply("圆号", "F调圆号"), subParts: [1, 2] },
      // 第 1 段：认出来了、有号 ⇒ 这一行传得出去
      { ...okReply("圆号", "F调圆号"), subParts: [1] },
      // 第 2 段：乐器认得出、但号「模型给了没读懂」（`subPartsRaw`）⇒ 被 `uploadBlocker`
      // 拦下留在 analyzed。它**不参与补号**（见 `fillMissingSubParts`），所以名字里没有号，
      // 与第 1 段不同名 —— 于是这一组不会走「同组重名」那条整组拦截。
      {
        ...okReply("圆号", "F调圆号"),
        subParts: [],
        subPartsRaw: "一二",
      },
    ];
    // ⚠️ 这一条必须给**真 PDF**：下面要真的把第 1 段传出去（见 `runAnalysisWithRealPdf`）
    h.pages = 3;
    await runAnalysisWithRealPdf(3, "短笛长笛.pdf");
    await waitFor(() => expect(screen.getByText(/^已识别 → 圆号/)).toBeTruthy());
    fireEvent.click(screen.getByText(/^识别分段/));
    await waitFor(() => expect(screen.getAllByText("还原为一份")).toHaveLength(2), {
      timeout: 10000,
    });

    // 正向同伴：还没传任何一段时，两段都能还原；且这一组的名字不重 ⇒ 那句红字不出现
    expect(screen.getAllByText("还原为一份").every((b) => !(b as HTMLButtonElement).disabled)).toBe(
      true,
    );
    //（这一块**是**渲染着的：下面那句「重名」要能在同一状态里成立才算被钉住）
    expect(screen.queryByText(/与同组的其他段重名/)).toBeNull();

    fireEvent.click(screen.getByText("确认上传（2/2）"));
    // 第 1 段传成功 ⇒ 只剩第 2 段还在屏幕上（done 的行不再渲染这一段 chip 区）
    await waitFor(() => expect(screen.getAllByText("还原为一份")).toHaveLength(1), {
      timeout: 10000,
    });

    const btn = screen.getByText("还原为一份") as HTMLButtonElement;
    // ★ 变异：`canUnsplit={canUnsplit}` → `{() => true}` ⇒ `disabled` 与 `title` 两句一起变红。
    //   这条不是体验问题：已上传的段不会跟着撤销，还原后用户再传一次整本，
    //   库里就有「段 + 整本」两份，而先前那些对象再没有任何界面入口能删。
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe("这一组已有段上传成功，无法还原（已传的文件不会跟着撤销）");
  });

  it("同组两段重名时，**两段都**出提示（上传会被整组拦下，得让用户先看见为什么）", async () => {
    h.llmReplies = [
      { ...okReply("圆号", "F调圆号"), subParts: [1, 2] },
      // 两段都认不出乐器 ⇒ 两段主名都退化成同一个，`duplicatedInGroup` 判重名
      { success: true, section: "圆号", instrument: "", subParts: [], isFullScore: false },
      { success: true, section: "圆号", instrument: "", subParts: [], isFullScore: false },
    ];
    await runAnalysis({ names: ["短笛长笛.pdf"] });
    await waitFor(() => expect(screen.getByText(/^已识别 → 圆号/)).toBeTruthy());
    fireEvent.click(screen.getByText(/^识别分段/));

    // 正向同伴：两段确实都在屏幕上（否则「两行都有提示」无从谈起）
    await waitFor(() => expect(screen.getAllByText("还原为一份")).toHaveLength(2), {
      timeout: 10000,
    });
    // ★ 变异：`duplicatedInGroup={duplicatedInGroup}` → `{() => new Set()}` ⇒ 那句永不出现 ⇒ 变红。
    // ⚠️ 是 **2** 行：界面提示要**对称** —— 只标后出现的那一份，用户会以为第一份没问题
    //   （`allDuplicateNames` 与 `duplicateNames` 的区别就在这儿）。
    await waitFor(
      () =>
        expect(screen.getAllByText("与同组的其他段重名 —— 请改乐器名或分声部号")).toHaveLength(2),
      { timeout: 10000 },
    );
  });
});

describe("接线点：「确认这 N 段」的手动入口（#326 §5 同类）", () => {
  it("「还原为一份」之后回来的「确认这 N 段」真能拆：点一下行数就变回去", async () => {
    h.llmReplies = [
      { ...okReply("圆号", "F调圆号"), subParts: [1] }, // 整份
      { ...okReply("圆号", "F调圆号"), subParts: [1] }, // 段 1
      { ...okReply("长笛", "长笛"), subParts: [1] }, // 段 2
    ];
    await runAnalysis({ names: ["短笛长笛.pdf"] });
    fireEvent.click(screen.getByText(/^识别分段/));
    await waitFor(() => expect(screen.getAllByText("还原为一份")).toHaveLength(2), {
      timeout: 10000,
    });

    // 还原：这一组并回一行，屏幕上换出「确认这 N 段」。它会停在原地 ——
    // 自动拆是**事件驱动**的（放在 `startSegmentation` 末尾），不是渲染期效果，
    // 否则这里会被立刻重拆，用户永远退不回去。
    fireEvent.click(screen.getAllByText("还原为一份")[0]!);
    const back = (await screen.findByText(/^确认这 \d+ 段$/)) as HTMLButtonElement;

    // 正向同伴：这一刻它**可点**。没有这句，「点了拆不动」与「按钮被别的理由禁用」
    // 在报告里长得一样，而这两件事要修的地方完全不同。
    expect(back.disabled).toBe(false);

    // ★ 变异：`onSplitIntoSegments={splitIntoSegments}` → `{() => {}}` ⇒ 点了没反应，
    //   屏幕停在还原之后的状态 ⇒ 下面那句 `toHaveLength(2)` 等不到而变红。
    //   这条按钮是 `upload-modal.tsx` 里写明的**必经之路**：不点它上传会被 `splitRefusal`
    //   拦下（`segment-block.tsx` 那段 docblock）。
    //   「按钮在不在、灰不灰」与「点了算不算数」是两件事 —— 后者只有真点一下才验得到，
    //   而接线断掉的表现正是「点了没反应、也不报错」，不会体现在任何渲染结果里。
    fireEvent.click(back);
    await waitFor(() => expect(screen.getAllByText("还原为一份")).toHaveLength(2), {
      timeout: 10000,
    });
  });
});
