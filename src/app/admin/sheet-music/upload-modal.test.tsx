/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { analysisSettled, pageAttempts, UploadModal } from "./upload-modal";

/**
 * 渲染冒烟测试。**存在的理由是两次真实的漏网**：
 *
 * 1. `isFullScoreRow` 曾被放进组件体、声明在使用点之后 —— `const` 的 TDZ 让
 *    **选完文件整个弹窗就崩**（`segTargets` 是渲染期立即求值的语句，会走到它）。
 *    `tsc` 报不出来（嵌套闭包里的调用序它不判），而本目录此前**只有纯模块测试**，
 *    831 条全绿也覆盖不到。
 * 2. 「确认这 N 段」按钮的显示条件与上传时的拦截判据不同源，造出一个死胡同 ——
 *    那也是纯模块测试看不见的（要渲染出那一行才会发现按钮不在屏幕上）。
 *
 * 所以这一个测试不测业务，它只保证**组件能渲染、能接住一份文件**。
 * 别把它扩成业务测试：那一层归 `segmentation.test.ts` / `split-pdf.test.ts` 那些纯函数。
 */
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
    from: vi.fn(),
    storage: { from: vi.fn() },
    functions: { invoke: vi.fn() },
  },
}));

afterEach(cleanup);

const pdf = (name: string) =>
  new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: "application/pdf" });

describe("上传弹窗的渲染冒烟", () => {
  it("选一份 PDF 后不崩，且文件名出现在列表里", async () => {
    const { container } = render(
      <UploadModal open onClose={() => {}} scoreId="score-1" onUploaded={() => {}} />,
    );
    const input = container.querySelector('input[type="file"]');
    expect(input, "选文件的入口应该在").toBeTruthy();

    // 这一下会触发 handleFileSelect → setFiles → 重渲染，
    // 于是组件体里所有**渲染期求值**的语句（含 segTargets 那条）都会跑到
    fireEvent.change(input!, { target: { files: [pdf("圆号1,2.pdf")] } });

    await waitFor(() => expect(screen.getByText("圆号1,2.pdf")).toBeTruthy());
  });
});

/** 打开弹窗并选一份文件，停在 select 阶段（还没点「开始分析」） */
async function selectOne(name = "圆号1,2.pdf") {
  const { container } = render(
    <UploadModal open onClose={() => {}} scoreId="score-1" onUploaded={() => {}} />,
  );
  const input = container.querySelector('input[type="file"]');
  fireEvent.change(input!, { target: { files: [pdf(name)] } });
  await waitFor(() => expect(screen.getByText(name)).toBeTruthy());
}

/**
 * 这两个开关**必须在屏幕上** —— 用户上一轮报的就是「没看到 checkbox」。
 * 纯模块测试测不到「控件在不在页面上」，所以这条只能长在渲染测试里。
 */
describe("select 阶段左下角的两个开关（#297）", () => {
  it("两个开关都在，且默认是「总谱关、分段开」", async () => {
    await selectOne();
    const fullScore = screen.getByLabelText("分析总谱") as HTMLInputElement;
    const segment = screen.getByLabelText("乐谱分段") as HTMLInputElement;
    expect(fullScore.checked, "「分析总谱」默认关 —— 开着是让所有导入替总谱付账").toBe(false);
    expect(segment.checked, "「乐谱分段」默认开").toBe(true);
  });

  it("勾上「分析总谱」后成本数字跟着变（不跟着变，那个数就是假的）", async () => {
    await selectOne(); // 1 份文件
    const cost = () => screen.getByTestId("analysis-ocr-cost").textContent;
    expect(cost()).toBe("分析最多 2 次 OCR");
    fireEvent.click(screen.getByLabelText("分析总谱"));
    expect(cost()).toBe("分析最多 6 次 OCR（多数文件 1 次）");
  });
});

describe("升级链：一页试哪几张图（顺序就是成本）", () => {
  const aPage = (over: Partial<Parameters<typeof pageAttempts>[0]> = {}) => ({
    base64: "TITLE",
    fullBase64: "FULL",
    cropped: true,
    cropNote: "已裁至标题区（谱线在页高 12.0%）",
    ...over,
  });

  it("裁出来了：先标题区、后整页", () => {
    expect(pageAttempts(aPage()).map((a) => [a.base64, a.full])).toEqual([
      ["TITLE", false],
      ["FULL", true],
    ]);
  });

  it("**没裁**：只试一次 —— 未裁切时两张图是同一张，试第二遍是白烧一次配额", () => {
    const attempts = pageAttempts(aPage({ cropped: false, cropNote: "未裁切（未检测到谱线）" }));
    expect(attempts.map((a) => a.base64)).toEqual(["TITLE"]);
  });

  it("base64 为空（渲染失败 / 拿不到 2D 上下文）：一张都不试", () => {
    expect(pageAttempts(aPage({ base64: "" }))).toEqual([]);
  });

  it("回退项的说明必须写明「改用整页」—— 那行字就是用来排查切错位置的", () => {
    expect(pageAttempts(aPage())[1].note).toContain("改用整页");
  });
});

describe("升级链的闸门：什么算「定了」", () => {
  it("给出乐器 = 定了（绝大多数分谱停在这里，成本 1 次 OCR）", () => {
    expect(analysisSettled({ instrument: "双簧管", isFullScore: false })).toBe(true);
  });

  it("判出总谱 = 定了，**且不能只靠 instrument**", () => {
    expect(analysisSettled({ instrument: "总谱", isFullScore: true })).toBe(true);
    // 后端今天同时写 instrument，但万一将来只置 isFullScore 不填它，
    // 这一条不成立就意味着升级链会一路走到最后一页、白烧 6 次配额
    expect(analysisSettled({ instrument: "", isFullScore: true })).toBe(true);
  });

  it("**没给出乐器 = 没定** —— 这是升级链继续往下走的唯一理由", () => {
    expect(analysisSettled({ instrument: "", isFullScore: false })).toBe(false);
  });
});
