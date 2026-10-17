/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { h, readyToSegment, runAnalysis } from "./upload-modal-harness";

/**
 * **段卡片**里本文件负责的那几支 —— 也就是 `.adv-seg/` 那套「沙箱场景」中此前**没有断言**的部分
 * （pkuso-web#326 §5 + pkuso-web#317 §24.2 的清单）。
 *
 * 那套沙箱目录已经不在仓库里了（issue 评论 5 已记），所以这里不是搬运，是**照清单重造**。
 * 清单：未识别 / 识别中 / 失败 / done-1 段 / done-N 段 / 非法原文 / 合并 / 拆分禁用 /
 * `segFailedPages` 两处提示。**哪些此前已有断言、哪个 PR 补的，看 #326 的契约评论**
 * （不在这里抄一份会腐烂的覆盖表）：
 *
 * | 场景 | 本次补的支 |
 * |---|---|
 * | ① 未识别 | 段卡片**自己**那句（带「点右下角」后缀）——此前只有一个 `/未识别（\d+ 页）/` 命中**父组件**的同名文案 |
 * | ② 识别中 | `costOf` 那个**数字**（此前只断言了「识别中…（约」） |
 * | ⑥ 非法原文 | 那格输入框的**红边框**（此前只覆盖了文案） |
 * | ⑨ 失败页 | `slice(0, 10)` 与「超过 10 页给省略号」那条阈值 |
 * | — | 第 1 段为什么没有输入框（`si === 0`） |
 * | — | `segBusy` 窗口里**已经 done 的别的行**的边界框（用户实测反馈的那条） |
 * | ⑧ 拆分禁用 | 上传相位里段卡片上**每个可点的控件**（起点框 / 合并 / 拆分 / 确认这 N 段）—— pkuso-web#317 §22 记过：此前没有任何用例把框置于 uploading |
 *
 * 每条末尾那句「★ 变异」就是它的自检方式：照做一次就该变红。
 */

/** 跑到「一段合订谱识别出 2 段、又还原成一行」（段卡片只在**没拆开**的行上渲染） */
async function twoSegments() {
  h.segmentCuts = [2];
  h.llmReplies = [
    { success: true, section: "圆号", instrument: "F调圆号", subParts: [1, 2], isFullScore: false },
    { success: true, section: "圆号", instrument: "F调圆号", subParts: [1], isFullScore: false },
    { success: true, section: "圆号", instrument: "F调圆号", subParts: [2], isFullScore: false },
  ];
  await runAnalysis({ names: ["短笛长笛.pdf"] });
  await waitFor(() => expect(screen.getByText(/^已识别 → 圆号/)).toBeTruthy(), { timeout: 10000 });
  fireEvent.click(screen.getByText(/^识别分段（/));
  await waitFor(() => expect(screen.getAllByText("还原为一份")).toHaveLength(2), {
    timeout: 10000,
  });
  fireEvent.click(screen.getAllByText("还原为一份")[0]!);
  await waitFor(() => expect(screen.getByText("识别出 2 段 —— 可改分段点")).toBeTruthy(), {
    timeout: 10000,
  });
}

describe("段卡片剩下的那几支（pkuso-web#317 §24.2 沙箱场景里本文件负责的部分）", () => {
  it("场景①未识别：段卡片**自己**那句带「点右下角」后缀（同名文案在父组件里还有一份）", async () => {
    // 分完段**还没点**「识别分段」的那一刻：这一行多页、非总谱、已识别 ⇒ 段卡片在，`segState` 还是 undefined
    await readyToSegment();

    // ★ 变异：删掉 `{f.segState === undefined && (…)}` 那一块 ⇒ 变红。
    // ⚠️ 必须断言**整句**（含「—— 点右下角「识别分段」」）：本仓既有那条 `/未识别（\d+ 页）/`
    // 命中的是**父组件**那份同名文案（`!segEligible(f) && isUnidentified(f) && …`）——
    // 只断言前半截的话，段卡片这一块整块删掉它也照样绿。
    expect(screen.getByText("未识别（3 页）—— 点右下角「识别分段」")).toBeTruthy();
    // 负向同伴：父组件那句后缀不同（它在**不可分段**的未识别行上），此刻不该出现 ——
    // 它同时证明上面那条不是命中了另一句同名文案
    expect(screen.queryByText(/—— 先选定声部，再识别分段/)).toBeNull();
  });

  it("第 1 段没有输入框（起点恒为第 1 页）：`si === 0` 那一支渲染的是「第 1 页起」", async () => {
    await twoSegments();

    // ★ 变异：`si === 0 ?` → `si < 0 ?`（第 1 段也长出输入框）⇒ 下面 `querySelector("input")`
    //   不为空 ⇒ 变红。
    // ★ 变异：`si === 0` → `si > 0`（写反）⇒ 第 1 段也长出输入框 ⇒ 同样变红。
    // 这一支此前零断言：把「第 1 页起」整块删掉、或让它渲染一个可编辑的框（那个框改了也没用 ——
    // 第 1 段的起点是**定义**上恒为 1），全套用例都不红。
    const li0 = screen.getByText("第 1 段").closest("li") as HTMLLIElement;
    expect(li0.textContent).toContain("第 1 页起");
    expect(li0.querySelector("input")).toBeNull();
    // 正向同伴：第 2 段**有**输入框，而且里面是它的起点原文（否则「第 1 段没有」可能只是整块没渲染）
    const li1 = screen.getByText("第 2 段").closest("li") as HTMLLIElement;
    const box = li1.querySelector("input") as HTMLInputElement;
    expect(box).not.toBeNull();
    expect(box.value).toBe("2");
  });

  it("场景⑥非法原文：那一格**整格标红**，改回合法值就不红（颜色此前零断言）", async () => {
    await twoSegments();
    const box = screen.getByDisplayValue("2") as HTMLInputElement;

    // ⚠️ 用 `classList.contains` 而不是 `className.includes`：后者是**子串**匹配，会把
    // 将来多出一截的 token（例如 `border-danger` 之于 `border-danger-strong`）一并认下或一并排除。
    // 前提：合法值这一刻不是红的
    expect(box.classList.contains("border-border")).toBe(true);
    expect(box.classList.contains("border-danger")).toBe(false);

    // ★ 变异：`bad ? "border-danger text-danger" : "border-border"` → 两边都写 `border-border`
    //   ⇒ 变红。既有那条用例只钉了文案（「起点要填 2–3」），所以**把红框降级成普通框是静默的** ——
    //   而这一格里填错是最容易发生的事，只给一句话、框本身看不出异样，用户会以为已经生效。
    fireEvent.change(box, { target: { value: "9" } });
    await waitFor(() => expect(screen.getByText("起点要填 2–3")).toBeTruthy());
    expect(box.classList.contains("border-danger")).toBe(true);
    expect(box.classList.contains("border-border")).toBe(false);

    // ★ 变异：`bad` 判据改成恒真（无条件标红）⇒ 上面那两条前提断言变红 —— 常红与常绿一样是坏的
    fireEvent.change(box, { target: { value: "3" } });
    await waitFor(() => expect(screen.getByText("– 第 3 页")).toBeTruthy());
    expect(box.classList.contains("border-border")).toBe(true);
  });

  it("场景⑨失败页：11 页没取到文本时只列**前 10 页**并带一个省略号", async () => {
    // 12 页、前 11 页窄带 OCR 失败、第 12 页成功（全部失败会走「必须报错」那条守卫，见下一条的说明）
    h.pages = 12;
    h.bandFailFor = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    // 只有一段 ⇒ **不自动拆行**，段卡片就留在这一行上（拆完源行就没了）
    h.segmentCuts = [];
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
    fireEvent.click(screen.getByText(/^识别分段（/));

    // 前提：真的跑到 done 且页数对得上（失败页数对不上会连带下面的文案一起变，前提先钉死）。
    // ⚠️ 这里只能用**前缀正则**：同一个 `<span>` 里紧跟着「（其中 N 页 OCR 失败…）」，
    // 而字符串匹配是整串相等 —— 写死整句会把两处判据焊在一起，改任一处都让这条红。
    await waitFor(() => expect(screen.getByText(/^识别出 1 段/)).toBeTruthy(), { timeout: 10000 });

    // ★ 变异：`f.segFailedPages!.slice(0, 10)` → `slice(0, 3)` ⇒ 变红。
    // ★ 变异：`f.segFailedPages!.length > 10 ? "…" : ""` 删掉 ⇒ 变红。
    // 页数一多就必须截断：这行字是**排查用**的，20 页全列出来会把整张卡片撑爆，
    // 而它旁边那句「其中 N 页 OCR 失败」已经给了完整条数。
    expect(
      screen.getByText(
        "第 1、2、3、4、5、6、7、8、9、10… 页没取到文本（OCR 失败）—— 这几页上不会有边界",
      ),
    ).toBeTruthy();
  });

  it("场景⑨失败页：只有 5 页时**不**给省略号（否则阈值被写小也看不出来）", async () => {
    // 6 页、5 页失败、1 页成功。这条与上一条合起来才钉得住那个 `> 10` 的**阈值**：
    // 上一条（11 页）对 `> 3` / `> 1` 这类写法无感（照样给省略号），只有 4–10 页这个区间能分开。
    h.pages = 6;
    h.bandFailFor = [1, 2, 3, 4, 5];
    h.segmentCuts = [];
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
    fireEvent.click(screen.getByText(/^识别分段（/));
    await waitFor(() => expect(screen.getByText(/^识别出 1 段/)).toBeTruthy(), { timeout: 10000 });

    // ★ 变异：`f.segFailedPages!.length > 10` → `> 3`（阈值写小）⇒ 这里会多出一个「…」⇒ 变红。
    //   ⚠️ 上面那片（11 页）**抓不到**这个变异 —— 阈值写小只有 4–10 页这一段分得开，
    //   所以本文件里 5 / 10 / 11 三条各钉一段区间（三条合起来才把 `> 10` 夹死，去掉任一条都有漏窗）。
    expect(
      screen.getByText("第 1、2、3、4、5 页没取到文本（OCR 失败）—— 这几页上不会有边界"),
    ).toBeTruthy();
  });

  it("场景⑨失败页：**正好 10 页**时同样不给省略号（阈值钉在第 10 页上）", async () => {
    // 11 页、前 10 页失败、第 11 页成功。
    // ⚠️ 这条是**复核实测**补的：只有 5 页与 11 页那两条时，阈值只被夹在 [5, 10] 之间 ——
    // `> 6` … `> 10` 这些写法**一条都不红**（11 页那条照样给省略号）。正好 10 页才把它钉在点上：
    // `length > 10` 在这里为假 ⇒ 10 个页号全部列出、结尾没有「…」。
    h.pages = 11;
    h.bandFailFor = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    h.segmentCuts = [];
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
    fireEvent.click(screen.getByText(/^识别分段（/));
    await waitFor(() => expect(screen.getByText(/^识别出 1 段/)).toBeTruthy(), { timeout: 10000 });

    // ★ 变异：阈值 `> 10` → `> 9`（或 `>= 10`）⇒ 这里多出一个「…」⇒ 变红。
    //   ⚠️ 这一格也是 `slice(0, 10)` 的**上界**：10 页刚好是「列满」的边界，写成 `slice(0, 3)`
    //   会让这句少 7 个页号 —— 那条由本句和上面 11 页那句一起钉。
    expect(
      screen.getByText(
        "第 1、2、3、4、5、6、7、8、9、10 页没取到文本（OCR 失败）—— 这几页上不会有边界",
      ),
    ).toBeTruthy();
  });

  it("场景②识别中：那个数字是**算出来的**（12 页 ⇒ 约 2 次；按钮上写的是同一个判据）", async () => {
    // 12 页：`estimateOcrCalls` 按「一张拼图装 10 页」估 ⇒ ceil(12/10) = 2（3 页时是 1，分辨不出来）
    h.pages = 12;
    await readyToSegment();

    // 前提：导入前那个数先对（`segCost` 与 `costOf` 是同一个 `estimateOcrCalls`）
    expect(screen.getByText("识别分段（1 份，约 2 次 OCR）")).toBeTruthy();

    let release!: () => void;
    h.ocrGate = new Promise<void>((r) => {
      release = r;
    });
    fireEvent.click(screen.getByText(/^识别分段（/));

    // ★ 变异：`costOf(f)` → 常量 1（或 `estimateOcrCalls` 的 `Math.ceil` → `Math.floor`）⇒ 变红。
    // 既有那条只断言了「识别中…（约」——**数字是几都绿**，而这句话的全部意义就是那个数字
    //（#290 的验收标准：调用次数在导入前可见，而配额是 500 次/天）。
    await waitFor(() => expect(screen.getByText("识别中…（约 2 次 OCR）")).toBeTruthy(), {
      timeout: 10000,
    });

    release();
    h.ocrGate = null;
    await waitFor(() => expect(screen.getAllByText("还原为一份")).toHaveLength(2), {
      timeout: 10000,
    });
  });

  it("分段池还在跑时：**已经 done 的别的行**的边界框禁掉，手动拆分入口也收起来", async () => {
    // 两行：甲 先跑完分段并「还原为一份」退回一行（`done` + 2 段），乙 这一刻还没资格分段
    h.segmentCuts = [2];
    // ⚠️ 甲 的整份识别按**文件名**给：`llmReplies` 那个队列按调用顺序取，而两份文件谁先跑完
    // OCR 是不受控的 —— 用队列会变成偶发（见 `llmReplyFor` 的说明）。
    h.llmReplyFor = {
      "甲.pdf": {
        success: true,
        section: "圆号",
        instrument: "F调圆号",
        subParts: [1, 2],
        isFullScore: false,
      },
    };
    // 乙 走默认夹具（未识别）⇒ 它此刻不在 `segTargets` 里，池子里只有甲
    await runAnalysis({ names: ["甲.pdf", "乙.pdf"] });
    await waitFor(() => expect(screen.getByText(/^已识别 → 圆号/)).toBeTruthy(), {
      timeout: 10000,
    });
    await waitFor(() => expect(screen.getByText("需人工确认")).toBeTruthy(), { timeout: 10000 });

    fireEvent.click(screen.getByText(/^识别分段（/));
    await waitFor(() => expect(screen.getAllByText("还原为一份")).toHaveLength(2), {
      timeout: 10000,
    });
    fireEvent.click(screen.getAllByText("还原为一份")[0]!);
    await waitFor(() => expect(screen.getByText("识别出 2 段 —— 可改分段点")).toBeTruthy(), {
      timeout: 10000,
    });

    // 给乙填上乐器名 ⇒ 它成为**唯一**待分段的行（甲是 done，不进 `segTargets`）
    fireEvent.change(screen.getAllByPlaceholderText("乐器名")[1]!, { target: { value: "圆号" } });
    await waitFor(() => expect(screen.getByText(/^识别分段（1 份/)).toBeTruthy());

    // 前提：这一刻甲的边界框**是**可编辑的（否则下面那条禁用态可能只是永久禁用）
    const startBox = screen.getByDisplayValue("2") as HTMLInputElement;
    expect(startBox.disabled).toBe(false);
    // 前提：甲的「确认这 2 段」此刻在（它是同一个 `segBusy` 的另一个出口，下面要一起钉）
    expect(screen.getByText(/^确认这 2 段/)).toBeTruthy();

    let release!: () => void;
    h.ocrGate = new Promise<void>((r) => {
      release = r;
    });
    fireEvent.click(screen.getByText(/^识别分段（/));
    await waitFor(() => expect(screen.getByText(/^识别中…/)).toBeTruthy(), { timeout: 10000 });

    // ★ 变异：`disabled={phase === "uploading" || segBusy}` 里删掉 `|| segBusy` ⇒ 变红。
    // 用户实测反馈的那条：切点判出后自动拆要用**这次分段算出来的** starts，而池子里还有别的
    // 文件在跑时这一行已经 done、框是可编辑的 —— 用户在这儿改的边界会被随后的自动拆按旧快照推翻。
    // 「收了再丢」比直接禁掉更糟。
    expect(startBox.disabled).toBe(true);
    // ★ 变异：`{unsplitSegments(f) && !segBusy && (` 里删掉 `&& !segBusy` ⇒ 变红。
    // 那是「一闪而过且点不了」的按钮：自动拆要等整个池子跑完，先跑完的行在这几秒里会挂着一个
    // 自己禁用的按钮，用户只会以为功能坏了。
    expect(screen.queryByText(/^确认这 2 段/)).toBeNull();

    release();
    h.ocrGate = null;
    // 放行后必须**恢复可编辑**：禁掉之后不回来也是一种坏法
    await waitFor(() => expect(startBox.disabled).toBe(false), { timeout: 10000 });
  });

  it("上传相位里，段卡片上每个可点的控件都禁掉（pkuso-web#317 §22 记过：此前没有用例把框置于 uploading）", async () => {
    // 两份：甲 跑完分段后「还原为一份」（留在 analyzed、2 段没拆），乙 可上传 ——
    // 乙 的 `storage.upload` 挂在门上，相位才会停在 uploading。
    // ⚠️ **为什么必须两份**：`uploadOne` 里「分了段却没拆」那一拦是**逐行**判的 ——
    // 甲 被拦下、留在 analyzed（段卡片还在屏幕上），乙 飞在天上撑着相位。
    // 段卡片在 `status: "uploading"` 的行上根本不渲染（编辑器那道门是 `analyzed || error`），
    // 所以「上传相位里段卡片禁没禁用」只可能落在**别的行**上。
    h.user = { id: "u1" };
    h.segmentCuts = [2];
    // ⚠️ 甲 按**文件名**给（`llmReplies` 那个队列按调用顺序取，谁先跑完 OCR 不受控）；
    // 乙 保持**未识别**（`section: "其他"` + 乐器空）—— 这样它这一刻不进分段池，
    // 池子里只有甲，`还原为一份` 恰好两个（`h.segmentCuts` 是**全局**的，两份一起分段
    // 会变成四个，第一版就这么失败过）。乙 的乐器名在分段之后才填。
    h.llmReplyFor = {
      "甲.pdf": {
        success: true,
        section: "圆号",
        instrument: "F调圆号",
        subParts: [1, 2],
        isFullScore: false,
      },
      "乙.pdf": {
        success: true,
        section: "其他",
        instrument: "",
        subParts: [],
        isFullScore: false,
      },
    };
    await runAnalysis({ names: ["甲.pdf", "乙.pdf"] });
    await waitFor(() => expect(screen.getByText(/^已识别 → 圆号/)).toBeTruthy(), {
      timeout: 10000,
    });
    await waitFor(() => expect(screen.getByText("需人工确认")).toBeTruthy(), { timeout: 10000 });

    fireEvent.click(screen.getByText(/^识别分段（/));
    await waitFor(() => expect(screen.getAllByText("还原为一份")).toHaveLength(2), {
      timeout: 10000,
    });
    fireEvent.click(screen.getAllByText("还原为一份")[0]!);
    await waitFor(() => expect(screen.getByText("识别出 2 段 —— 可改分段点")).toBeTruthy(), {
      timeout: 10000,
    });

    // 现在把乙的乐器名填上 ⇒ 它可上传、且**没有分段**（它才不会在「分了段却没拆」那一拦
    // 被挡下 —— 需要有一份真的飞在天上撑着 uploading 相位）
    fireEvent.change(screen.getAllByPlaceholderText("乐器名")[1]!, { target: { value: "圆号" } });
    await waitFor(() => expect(screen.getByText("已识别 → 其他 / 圆号")).toBeTruthy(), {
      timeout: 10000,
    });

    // 前提：四个控件这一刻**都**可用（否则下面的禁用态可能只是永久禁用）。
    // ⚠️ 四个都取**甲那一段的**（用边界框所在的 `<li>` 做锚）：屏幕上还有乙的
    // 「拆分」（它那一段 `to - from = 2`、本来就可用），而甲第 1 段的那个是
    // `seg.to - seg.from < 1` 永久禁掉的 —— `getAllByText` 那套数法分不出谁是谁。
    const box = screen.getByDisplayValue("2") as HTMLInputElement;
    const li1 = box.closest("li") as HTMLLIElement;
    const split = [...li1.querySelectorAll("button")].find(
      (b) => b.textContent === "拆分",
    ) as HTMLButtonElement;
    const merge = screen.getByText("合并").closest("button") as HTMLButtonElement;
    const confirmSeg = screen.getByText(/^确认这 2 段/) as HTMLButtonElement;
    for (const el of [box, merge, split, confirmSeg]) expect(el.disabled).toBe(false);

    let release!: () => void;
    h.uploadGate = new Promise<void>((r) => {
      release = r;
    });
    fireEvent.click(screen.getByText(/^确认上传（/));

    // ⚠️ 等的是**禁用态本身**，不是「上传中」那三个字：相位在 `finally` 里会被打回 confirm，
    // 只等文案可能恰好命中退回之后的那一刻（本仓另一条上传相位的用例第一版就这么栽过）。
    // ★ 变异：这四处各自的 `disabled={phase === "uploading" || …}` 里删掉
    //   `phase === "uploading"` ⇒ 对应那条断言变红（四处各一次，已逐条跑过）。
    await waitFor(() => expect(box.disabled).toBe(true), { timeout: 10000 });
    expect(merge.disabled).toBe(true);
    expect(split.disabled).toBe(true);
    expect(confirmSeg.disabled).toBe(true);
    // 门确实还挂着（一个字节都还没落地）：证明「禁用」是这个相位驱动的，不是别的巧合
    expect(h.uploaded).toHaveLength(0);

    release();
    h.uploadGate = null;
    await waitFor(() => expect(box.disabled).toBe(false), { timeout: 10000 });
  });
});

// ⚠️ 这一段钉的是 `splitIntoSegments` 的 k === 0 继承清单：第 1 段继承源行的
// `preview`，而送检图就是源文件的那一页 —— **`sourcePage` 必须一起继承**，否则面板
// 会指着同一张图却不说是第几页（用户没法把图和谱子对上）。
describe("拆段后的第 1 段：继承 `preview` 与 `sourcePage`", () => {
  it("第 1 段的面板上「送检图像」仍带源图的页号（与源行一致）", async () => {
    h.segmentCuts = [2];
    h.llmReplies = [
      {
        success: true,
        section: "圆号",
        instrument: "F调圆号",
        subParts: [1, 2],
        isFullScore: false,
      },
      { success: true, section: "圆号", instrument: "F调圆号", subParts: [1], isFullScore: false },
      { success: true, section: "圆号", instrument: "F调圆号", subParts: [2], isFullScore: false },
    ];
    await runAnalysis({ names: ["短笛长笛.pdf"] });
    await waitFor(() => expect(screen.getByText(/^已识别 → 圆号/)).toBeTruthy(), {
      timeout: 10000,
    });

    // 对照组：**源行**这一刻是带页号的（下面那句「不带」才有鉴别力 —— 否则可能只是面板没渲染）
    fireEvent.click(screen.getByLabelText("查看详情"));
    expect(screen.getByText("送检图像（第 1 页）：")).toBeTruthy();

    fireEvent.click(screen.getByText(/^识别分段（/));
    await waitFor(() => expect(screen.getAllByText("还原为一份")).toHaveLength(2), {
      timeout: 10000,
    });
    // 同步点：两段各自的识别落地（`expandedIdx` 留在第 0 位上，面板跟着落到新的第 1 段）
    await waitFor(() => expect(screen.getAllByText(/已识别/)).toHaveLength(2), { timeout: 10000 });

    // 第 1 段继承了 `preview`/`sourcePage`/`ocrText`/`cropNote`（k === 0 那一份）。
    // ★ 变异：从继承对象里删掉 `sourcePage` ⇒ 标签退化成「送检图像：」⇒ 变红。
    // ★ 变异：`{f.preview && (…)}` 整块删掉 ⇒ 这句跟着没 ⇒ 变红（与源行那条同一个探针）。
    expect(screen.getByText("送检图像（第 1 页）：")).toBeTruthy();
  });
});

describe("组级推算补出来的号：行上必须标出是推算的", () => {
  it("补出来的那一段出现标记，自己读出号的那一段没有", async () => {
    h.segmentCuts = [2];
    h.llmReplies = [
      {
        success: true,
        section: "圆号",
        instrument: "F调圆号",
        subParts: [1, 2],
        isFullScore: false,
      },
      { success: true, section: "圆号", instrument: "F调圆号", subParts: [1], isFullScore: false },
      { success: true, section: "圆号", instrument: "F调圆号", subParts: [], isFullScore: false },
    ];
    await runAnalysis({ names: ["短笛长笛.pdf"] });
    await waitFor(() => expect(screen.getByText(/^已识别 → 圆号/)).toBeTruthy(), {
      timeout: 10000,
    });

    fireEvent.click(screen.getByText(/^识别分段（/));
    await waitFor(() => expect(screen.getAllByText("还原为一份")).toHaveLength(2), {
      timeout: 10000,
    });
    // 同步点：两段各自的识别都已落地；补号发生在那之后
    await waitFor(() => expect(screen.getAllByText(/已识别/)).toHaveLength(2), { timeout: 10000 });

    // ★ 变异：补号时不写 `subPartsAutoFilled: true` ⇒ 这句永不出现 ⇒ 变红。
    // 标出来的只有被补的那一段：另一段自己读出了 [1]，不该跟着挂「请核对」。
    await waitFor(
      () =>
        expect(
          screen.getAllByText("分声部号是按其它段推算补上的（这一段没读出号）—— 请核对"),
        ).toHaveLength(1),
      { timeout: 10000 },
    );
    // 正向同伴：两段仍都在屏幕上（那句不是「整组都挂」）
    expect(screen.getAllByText("还原为一份")).toHaveLength(2);
  });
});
