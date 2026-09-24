/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UploadModal } from "./upload-modal";

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
