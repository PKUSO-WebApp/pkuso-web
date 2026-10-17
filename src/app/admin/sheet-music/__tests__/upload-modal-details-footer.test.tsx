/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
// ⚠️ harness 必须**先于** details-panel 求值：harness 体内先注册 `vi.mock("@/lib/supabase")`，
// 而 details-panel → analysis.ts 会先摸到真的 supabase 模块（缺 env 时当场抛）。
// 这个顺序是 harness 头注释里那条纪律，别按「就近/字母」重排。
import { UploadModal, h, okReply, runAnalysis } from "./upload-modal-harness";
import { DetailsPanel } from "../components/details-panel";
import type { UploadFile } from "../upload-modal.types";

/**
 * **展开面板（`details-panel.tsx`）里的 `f.xxx &&` 分支**、**页脚操作行**，
 * 以及一批「已经渲染出来、却一条断言都没有」的文案与颜色（pkuso-web#326 §5「分支枚举类」+ §28）。
 *
 * ## 为什么每条都写「★ 变异」
 *
 * 这个文件里几乎每一条断言针对的都是**一个 `&&` 短路**或**一个 `switch` 的一支** ——
 * 也就是「删掉它，代码照样编译、界面照样能跑」的那一类。所以每条用例末尾都记一句
 * 「把哪一处改掉，这条就红」，改的人照着做一次就知道它是不是空转的。
 *
 * ## 三条纪律（照抄本仓实测的教训）
 *
 * 1. **负向断言必须有同状态的正向同伴**：光断言「没有 X」，在面板根本没渲染时也恒真
 *    （`upload-modal-walk.test.tsx` 里那条「字段缺席」就栽过）。所以凡是「不该出现」，
 *    旁边必有一句「此刻确实渲染出来了」。
 * 2. **面板真的开了**这件事要用**面板里的东西**证明，不能用 toggle 的无障碍名 ——
 *    `收起详情` 只说明 toggle 翻了。
 * 3. **一条用例不独自扛一整片**：每个禁用/负向断言都在它自己那条用例里，配自己的正向同伴。
 *
 * ⚠️ 夹具的默认像素（`makePixels`）会真的裁出标题区（谱线落在页高 28.3%），所以
 * 「送检图像」「裁切说明」这两块在**常态**分析里就有内容 —— 下面几条才有东西可断。
 */

const pdf = (name: string) => new File([new Uint8Array([1])], name, { type: "application/pdf" });

describe("分析页数上界（MAX_PAGES_EXAMINED）：超过才说明「只看了前几页」", () => {
  const row = (over: Partial<UploadFile> = {}): UploadFile => ({
    file: pdf("x.pdf"),
    originalName: "x.pdf",
    status: "analyzed",
    llmResult: "识别结果: 圆号 / F调圆号",
    ...over,
  });

  it("5 页的文件：LLM 结果下面说明只看了前 3 页", () => {
    render(<DetailsPanel f={row({ pageCount: 5 })} />);
    // 正向同伴：结果块确实渲染了，下面那句才不是「面板没开」的假阴性
    expect(screen.getByText("识别结果: 圆号 / F调圆号")).toBeTruthy();
    // 3 取自常量；改大/改小都会让这句对不上
    expect(screen.getByText("分析最多只看前 3 页（共 5 页）")).toBeTruthy();
  });

  it("页数没有超过上界：不出现那句", () => {
    render(<DetailsPanel f={row({ pageCount: 3 })} />);
    expect(screen.getByText("识别结果: 圆号 / F调圆号")).toBeTruthy();
    expect(screen.queryByText(/分析最多只看前/)).toBeNull();
  });

  it("分段行不出现：段级识别只读本段首页，不按页游走", () => {
    render(
      <DetailsPanel
        f={row({
          pageCount: 5,
          splitOf: { groupId: "g", from: 1, to: 5, segIndex: 0, segTotal: 1 },
        })}
      />,
    );
    expect(screen.getByText("识别结果: 圆号 / F调圆号")).toBeTruthy();
    expect(screen.queryByText(/分析最多只看前/)).toBeNull();
  });
});

/** 打开弹窗、选好文件，但**不点**「开始分析」（停在 `phase: "select"`，行状态是 `pending`） */
function selectFiles(names: string[]) {
  const { container } = render(
    <UploadModal open onClose={h.onClose} scoreId="score-1" onUploaded={() => {}} />,
  );
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: names.map(pdf) },
  });
  return container;
}

/** 一行「正常识别」（圆号 / F调圆号 / 没有分声部号）—— 面板与页脚那几条的共同起点 */
async function analyzed() {
  h.llmReply = okReply("圆号", "F调圆号");
  await runAnalysis({ names: ["圆号.pdf"] });
  await waitFor(() => expect(screen.getByText(/^已识别 → 圆号 \/ F调圆号/)).toBeTruthy(), {
    timeout: 10000,
  });
}

/** 展开第一行（并证明**面板真的开了** —— 见文件头第 2 条纪律） */
function expand() {
  fireEvent.click(screen.getByLabelText("查看详情"));
  expect(screen.getByText("OCR 文本：")).toBeTruthy();
}

describe("展开面板（DetailsPanel）的 f.xxx 分支", () => {
  it("送检图像：渲染缩略图，并标明送的是第几页", async () => {
    await analyzed();
    expand();

    // ★ 变异：删掉 `{f.preview && (…)}` 整块 ⇒ 这句没了 ⇒ 变红。
    // 它排掉的是「排查时看不出到底送了哪张图」——而送错图正是「OCR 读不出」的主症状。
    // ★ 变异：三元 `f.sourcePage ? `（第 ${f.sourcePage} 页）` : ""` 的**「有值」那半边**由这句钉
    //   （把插值换成别的字段、或去掉「第…页」这层 ⇒ 变红）。
    // ⚠️ **「无值时不带」那半边现在没有可达路径**：普通行上 `preview` 与 `sourcePage`
    //   同时写入，而 `splitIntoSegments` 把两者一起继承给第 1 段（见
    //   `upload-modal-segment-branches.test.tsx` 的「拆段后的第 1 段」）。三元留着是防御，
    //   不是还没覆盖的分支。
    expect(screen.getByText("送检图像（第 1 页）：")).toBeTruthy();
    // ★ 变异：`src={f.preview}` → `src={f.llmResult}`（或干脆删掉 `src`）⇒ 变红。
    // 这里同时钉住「写进 preview 的就是即将送出去的那张图」这条不变量 —— 值来自
    // 夹具的 `toDataURL` 桩，全仓只有这一个来源。
    const img = screen.getByAltText("送去 OCR 的图像") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("data:image/jpeg;base64,AAAA");
  });

  it("裁切说明：面板里有这一行自己的说明（它此前一个断言都没有）", async () => {
    await analyzed();
    expand();

    // ★ 变异：删掉 `{f.cropNote && <p>{f.cropNote}</p>}` 那一行 ⇒ 变红。
    // ★ 变异：把 `{f.cropNote}` 换成 `{f.warning}` / `{f.ocrText}` ⇒ 文案对不上 ⇒ 变红。
    // 文案里的 28.3% 是**算出来的**（`cropNoteOf` 读 `crop.staffPct`）：夹具的谱线在
    // y=85、页高 300 —— 把 `staffPct` 换成别的字段（比如 `height`）这句就对不上。
    expect(screen.getByText("已裁至标题区（谱线在页高 28.3%）")).toBeTruthy();
    // 前提：这一行**没有** warning，所以上面那句不可能是别处的同名文案
    expect(screen.queryByText(/渲染失败/)).toBeNull();
  });

  it("OCR 文本：`<pre>` 里放的是 **OCR 原文**，不是 LLM 结果", async () => {
    await analyzed();
    expand();

    // ★ 变异：`{f.ocrText}` → `{f.llmResult}`（两块的正文对调）⇒ 变红。
    // 这两块长得一模一样（都是「标签 + 一段等宽/正文」），此前互换位置全套用例照绿 ——
    // 而它们是排查链的两端：OCR 原文用来判「切错位置」，LLM 结果是用来判「模型读错了」。
    expect(screen.getByText("PMLASIA 出版社 编号")).toBeTruthy();
    // 正向同伴：LLM 那一块此刻**也**在（否则「OCR 原文在」可能只是面板少渲染了别的）
    expect(screen.getByText("识别结果: 圆号 / F调圆号")).toBeTruthy();
  });

  it("LLM 结果：那一块的正文来自 `llmResult`（标签与 OCR 文本那块分开）", async () => {
    await analyzed();
    expand();

    // ★ 变异：删掉 `{f.llmResult && (…)}` 整块 ⇒ 变红。
    // 它排掉的是「模型到底说了什么」不可见 —— 而「需人工确认」那一行**只有**这块能解释。
    // ⚠️ 这里原先还有一句 `expect(label.textContent).toBe("LLM 结果：")`：那是上一句的机械复述
    //   （`getByText` 走 `getNodeText`，拼的就是直接文本子节点，在此与 `textContent` 逐字相同），
    //   任何**单点**变异都改不红它 —— 复核时删掉，成套用例一条都不会红。
    expect(screen.getByText("LLM 结果：")).toBeTruthy();
    expect(screen.getByText("识别结果: 圆号 / F调圆号")).toBeTruthy();
    // 两个标签各一份，不许是同一块渲染了两遍
    expect(screen.getAllByText("OCR 文本：")).toHaveLength(1);
  });

  it("warning 走警示色；同一状态里 preview / cropNote **不**渲染（渲染失败时两个字段本来就空）", async () => {
    // 渲染失败那一页：`walk.contentPage` 为空 ⇒ 这句 warning 既行进状态、又被抄进 OCR 框
    // ⚠️ 走 `runAnalysis({ renderFailPages: [1] })`，**不要**手写 `h.renderFailPages = [1]`：
    // 那个 helper 会用它自己的参数（默认 `[]`）覆盖掉手写的那一行（同下面 llmFail 那条）。
    h.pages = 1;
    await runAnalysis({ names: ["圆号.pdf"], renderFailPages: [1] });
    await waitFor(() => expect(screen.getByLabelText("查看详情")).toBeTruthy(), { timeout: 10000 });
    expand();

    // ⚠️ 这句文案在屏幕上**有两份**（这是有意的：`if (!walk.contentPage && warning)` 会把它
    // 抄进 OCR 文本框 —— 不抄的话那里还挂着「正在提取页面...」那句进度文案，等于在最需要
    // 结果的时候说反话）。所以按**颜色**挑出 warning 那一块，而不是按文案。
    const hits = screen
      .getAllByText(/^第 1 页渲染失败：/)
      .filter((el) => el.classList.contains("text-warning"));
    // ★ 变异：删掉 `{f.warning && <p className="text-warning">{f.warning}</p>}` ⇒ 挑不出 ⇒ 变红。
    // ★ 变异：`text-warning` → `text-text-muted`（把它降级成普通说明）⇒ 同样挑不出 ⇒ 变红。
    expect(hits).toHaveLength(1);

    // 负向：这一份**没有**送检图像、也**没有**裁切说明（两个字段都没写过）
    // ★ 变异：`{f.preview && (` → `{f.warning && (`（条件写错字段）⇒ 长出一张没有 src 的图 ⇒ 变红。
    // ⚠️ 而 `{f.cropNote && …}` 那一处**不是**短路探针：把 `&&` 去掉只会长出一个**空 `<p>`**，
    //   空元素不带文案，文案判据看不见它。它钉的是**写点** —— 渲染失败这条路径上
    //   `cropNote` / `preview` 本来就不该有值（要让它红，得去改 `tryPage` 那个写点，
    //   一个字符串改不动）。两者都留着：一条断言可以同时是「状态前提」和「不变量」。
    expect(screen.queryByAltText("送去 OCR 的图像")).toBeNull();
    expect(screen.queryByText(/已裁至标题区|未裁切/)).toBeNull();
  });
});

describe("页脚操作行（FooterBar）：上传飞行中的那一支，与「操作行靠右下角」", () => {
  it("上传飞行中：页脚是**禁用**的「上传中」（带转圈），且这一支里不会长出「确认上传」", async () => {
    h.user = { id: "u1" };
    await analyzed();
    let release!: () => void;
    h.uploadGate = new Promise<void>((r) => {
      release = r;
    });
    fireEvent.click(screen.getByText(/^确认上传（/));

    const label = await screen.findByText("上传中");
    const btn = label.closest("button") as HTMLButtonElement;
    // ★ 变异：删掉 `phase === "uploading" ? (…上传中…) :` 这一支（落回下面的三元）⇒
    //   屏幕上是「确认上传（1/1）」、这句根本找不到 ⇒ 变红。
    expect(btn.disabled).toBe(true);
    // ★ 变异：`disabled` 去掉 ⇒ 变红。上传相位里这个键**必须是死的**：它没有 onClick，
    //   可点等于给用户一个不存在的出口。
    // ★ 变异：删掉这个按钮里那个 `animate-spin` 的转圈 span ⇒ 变红。「上传还在动」这件事
    //   只有这个元素在说（静止的省略号读起来像卡住 —— 用户实测反馈，见 `footer-bar.tsx`）。
    // ⚠️ 这里原先是 `expect(btn.textContent).toContain("上传中")`，那是上一句 `findByText`
    //   的机械复述（`getNodeText` 拼的就是直接文本子节点，在此与 `textContent` 逐字相同），
    //   任何**单点**变异都改不红它 —— 复核时删掉它整套用例一条都不会红。
    expect(btn.querySelector(".animate-spin")).toBeTruthy();

    // ⚠️ 前提：门确实还挂着（一个字节都还没落地）—— 否则下面这条可能只是「已经传完了」
    expect(h.uploaded).toHaveLength(0);
    // 负向 + 同状态正向同伴：这一支里**不许**同时出现「确认上传」
    // （这是「删掉整个 uploading 支、落回下面那个三元」的直接后果，会被它抓住）
    expect(screen.queryByText(/^确认上传（/)).toBeNull();
    // 逃生口仍在，而且是「取消」不是「取消分析」—— 这个相位的出口只有它
    // ⚠️ 这里**不再**写一句 `queryByText("取消分析")`：页脚那个「关闭」键是这一排里唯一的
    //   「取消*」，三元的两个分支不可能同时成立 ⇒ 那句在本状态里无法独立为假（复核实测：
    //   删掉它没有任何单点变异能变红）。跨相位的对照在下面「分析飞行中」那条里（正向断言）。
    expect(screen.getByText("取消")).toBeTruthy();

    release();
    h.uploadGate = null;
    await waitFor(() => expect(screen.queryByText("上传中")).toBeNull(), { timeout: 10000 });
  });

  it("行状态：上传中是「上传中...」，传完变「已上传 → …」（`statusText` 的两支此前零断言）", async () => {
    h.user = { id: "u1" };
    await analyzed();
    let release!: () => void;
    h.uploadGate = new Promise<void>((r) => {
      release = r;
    });
    fireEvent.click(screen.getByText(/^确认上传（/));

    // ★ 变异：`case "uploading": return "上传中..."` 改成别的字（比如「上传中…」用了全角省略号）
    //   ⇒ 变红。它与**页脚那个按钮**上的「上传中」是两句不同的话（不带省略号），
    //   所以这里不能写成 `/上传中/` —— 那样两处会互相顶替。
    await waitFor(() => expect(screen.getByText("上传中...")).toBeTruthy(), { timeout: 10000 });

    release();
    h.uploadGate = null;
    // ★ 变异：`case "done":` 那一支删成 `return "已上传"`（丢掉识别结果）⇒ 变红。
    // 已传完的行要能一眼看出「传上去的是哪一份」，否则用户只能靠文件名回忆。
    await waitFor(() => expect(screen.getByText("已上传 → 圆号 / F调圆号")).toBeTruthy(), {
      timeout: 10000,
    });
    // 同状态正向同伴：全传完时页脚给的是**正向出口**，不是灰着的「确认上传（0/1）」
    expect(screen.getByText("完成（已上传 1 个）")).toBeTruthy();
  });

  it("操作行靠右下角（#182）：页脚这一排是 justify-end", async () => {
    await analyzed();

    const row = (screen.getByText(/^确认上传（/).closest("button") as HTMLElement)
      .parentElement as HTMLElement;
    // ★ 变异：`justify-end` → `justify-start`（或 `justify-between` 做左右两端分布）⇒ 变红。
    // 这是本文件里唯一一条纯样式断言：pkuso-web#182 把「弹窗底部的双交互按钮操作行靠右下角」
    // 写成了**仓库级纪律**（AGENTS.md「前端设计原则」），jsdom 看得见类名，别处看不见 ——
    // 所以这一条不是「测样式」，是测一条被写下来的约定。
    expect(row.classList.contains("justify-end")).toBe(true);
    // 前提：取到的确实是把「取消 + 确认上传」装在一起的那一排（不是页面里别的 flex 行）
    expect(row.contains(screen.getByText("取消"))).toBe(true);
  });
});

describe("§28：已经渲染出来、却零断言的文案与颜色", () => {
  it("刚选完文件、还没点「开始分析」：状态行是「待分析」（muted —— 不是绿的，也还没到红的）", async () => {
    selectFiles(["圆号.pdf"]);
    await waitFor(() => expect(screen.getByText("圆号.pdf")).toBeTruthy());

    const line = screen.getByText("待分析");
    // ★ 变异：`case "pending": return "待分析"` 删掉 ⇒ `statusText` 返回 undefined ⇒ 这行没了 ⇒ 变红。
    // ★ 变异：`statusColor` 的 `case "pending"` 改成 `"text-success"` ⇒ 变红。
    // 两个 `switch` 的**同一支**在这里被一起钉住：pending 既要有话、又要是灰的。
    // ⚠️ 用 `classList.contains` 而不是 `className.includes`：后者会把 `text-danger-bg`
    // 这类**别的 token** 一并认下（断言说的是「灰的」而实际拿到的是别的类）。
    expect(line.classList.contains("text-text-muted")).toBe(true);
  });

  it("分析飞行中：状态行是「分析中...」，页脚给的是「取消分析」", async () => {
    selectFiles(["圆号.pdf"]);
    await waitFor(() => expect(screen.getByText("待分析")).toBeTruthy());

    let release!: () => void;
    h.llmGate = new Promise<void>((r) => {
      release = r;
    });
    fireEvent.click(screen.getByText(/开始分析/));

    // ★ 变异：`case "analyzing": return "分析中..."` 改成别的字 ⇒ 变红。
    await waitFor(() => expect(screen.getByText("分析中...")).toBeTruthy(), { timeout: 10000 });
    // 同状态正向同伴：分析相位里页脚那句话**必须**是「取消分析」——它是这个相位的出口，
    // 而上面那句只有在相位真的进了 analyzing 之后才可能对。
    // ⚠️ 这里**不再**配一句 `queryByText("取消")`（同样在三元的两个分支下无法独立为假，
    //   复核实测：删掉它没有任何单点变异能变红）；与 uploading 那条的正向断言互为跨相位对照。
    expect(screen.getByText("取消分析")).toBeTruthy();

    release();
    h.llmGate = null;
    await waitFor(() => expect(screen.queryByText("分析中...")).toBeNull(), { timeout: 10000 });
  });

  it("没认出乐器时，路径那一格是「填写乐器名后显示」（`previewPath` 的第一个早返回）", async () => {
    // ⚠️ 夹具必须**声部有值、乐器空**。默认那位（`section: ""`）会让这条用例**空转**：
    // `fileTargetsOf` 对空声部返回 `[]`，join 出来也是空串 —— 把那个早返回整个删掉，
    // 屏幕上**照样**是「填写乐器名后显示」（本轮变异实测 MISSED，才改成现在这个夹具）。
    // 声部有值时早返回才是承重的：删掉它这里会显示 `其他 / .pdf`。
    // 这个形态也是真的 —— 后端答「其他」而说不出乐器名，正是它最常见的弃权方式。
    h.llmReply = {
      success: true,
      section: "其他",
      instrument: "",
      subParts: [],
      isFullScore: false,
    };
    await runAnalysis({ names: ["圆号.pdf"] });
    await waitFor(() => expect(screen.getByText("需人工确认")).toBeTruthy(), { timeout: 10000 });

    // ★ 变异：`if (!instrument) return ""` 这个早返回删掉 ⇒ 这里会显示
    //   `其他 / .pdf` —— 一条**传不上去**的行却报了一个像样的路径 ⇒ 变红。
    //   它守的是「别让用户以为存的就是它」。
    expect(screen.getByText("填写乐器名后显示")).toBeTruthy();
    // ⚠️ 这里**不再**断言旁边那句「路径：」——它是 `previewPath` 两个分支**共用的外层标签**，
    //   两个早返回各删一个都不动它，与这条用例的目标无关。
    //   代价是：那个共用标签**从此没有用例盯着**了（它是装饰性的一行说明，不属于任何契约条目）。
  });

  it("号没读懂时，路径那一格是「… / （分声部号待确认）」（第二个早返回）", async () => {
    h.llmReply = {
      success: true,
      section: "圆号",
      instrument: "F调圆号",
      subParts: [],
      isFullScore: false,
      // 模型给了号、但后端没读懂 —— 号为空 + 原文在，正是 `subPartsUnread` 的形态
      subPartsRaw: "一二",
    };
    await runAnalysis({ names: ["圆号.pdf"] });
    await waitFor(() => expect(screen.getByText(/^已识别 → 圆号/)).toBeTruthy(), {
      timeout: 10000,
    });

    // ★ 变异：`if (subPartsInvalid || subPartsUnread) return `${section} / （分声部号待确认）``
    //   删掉 ⇒ 这里会显示 `圆号 / 圆号.pdf`（一条**传不上去**的行却报了一个像样的名字）⇒ 变红。
    expect(screen.getByText("圆号 / （分声部号待确认）")).toBeTruthy();
    // 同状态正向同伴：这个状态下真的要传就会被拦，界面得有一句话解释（否则「待确认」三个字没有对象）
    expect(screen.getByText(/没读懂/)).toBeTruthy();
  });

  it("整行失败时状态行是 `失败: …` 且是**危险色**（`statusColor` 的 error 支此前零断言）", async () => {
    // ⚠️ 走 `runAnalysis({ llmFail: true })`，**不要**手写 `h.llmFail = true`：那个 helper
    // 自己会把 `h.llmFail` 设成它的参数（默认 `false`），手写的那一行会被它覆盖掉。
    await runAnalysis({ names: ["圆号.pdf"], llmFail: true });
    await waitFor(() => expect(screen.getByText(/^失败: /)).toBeTruthy(), { timeout: 10000 });

    // ⚠️ 用**半角**冒号：`statusText` 的失败行是 `失败: …`，而分段块那句是 `失败：…`（全角）——
    // 两者在同一屏上可能并存，写成 `/失败/` 会让它们互相顶替。
    const line = screen.getByText(/^失败: /);
    // ★ 变异：`statusColor` 的 `case "error"` → `"text-primary"`（或删掉这一支）⇒ 变红。
    // 「整行失败」不是中性事件，颜色是它唯一的外显信号。
    expect(line.classList.contains("text-danger")).toBe(true);
  });

  it("引文是空串时那句「依据」也要走警示色（`evidenceWarn` 的**第二个**半边）", async () => {
    h.llmReply = {
      success: true,
      section: "圆号",
      instrument: "F调圆号",
      subParts: [],
      isFullScore: false,
      // 字段**在**、但值是空串 —— 与「字段缺席」（`undefined` 不显示任何东西）是两件事
      evidence: "",
    };
    await runAnalysis({ names: ["圆号.pdf"] });
    await waitFor(() => expect(screen.getByText(/^已识别 → 圆号/)).toBeTruthy(), {
      timeout: 10000,
    });

    const line = screen.getByText("依据：（模型没给引文，请核对）");
    // ★ 变异：`evidenceWarn` 的 `!(f.evidence ?? "").trim()` → `false` ⇒ 这里变成 muted ⇒ 变红。
    // 既有的那条用例只断言了**文案**（`walk` 里那条），所以把颜色降级成普通说明是**静默**的 ——
    // 而这句话是后端那批改动留给用户的唯一补偿信号，「没给引文」与「给了引文」同色就等于没说。
    // 第一个半边（`evidenceFound === false`）另有既有用例钉着，这里不重复。
    expect(line.classList.contains("text-warning")).toBe(true);
  });
});
