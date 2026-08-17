// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Modal } from "../Modal";

describe("Modal", () => {
  afterEach(cleanup);
  it("open=false 不渲染", () => {
    render(
      <Modal open={false} onClose={vi.fn()}>
        <p>内容</p>
      </Modal>,
    );
    expect(screen.queryByText("内容")).toBeNull();
  });

  it("open=true 渲染内容", () => {
    render(
      <Modal open onClose={vi.fn()}>
        <p>内容</p>
      </Modal>,
    );
    expect(screen.getByText("内容")).toBeTruthy();
  });

  it("点击遮罩触发 onClose", () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("关闭弹窗"));
    expect(onClose).toHaveBeenCalled();
  });

  it("closeOnOverlay=false 不渲染遮罩按钮", () => {
    render(
      <Modal open onClose={vi.fn()} closeOnOverlay={false}>
        <p>内容</p>
      </Modal>,
    );
    expect(screen.queryByLabelText("关闭弹窗")).toBeNull();
  });

  it("有 title 时渲染标题栏", () => {
    render(
      <Modal open onClose={vi.fn()} title="排练考勤">
        <p>内容</p>
      </Modal>,
    );
    expect(screen.getByText("排练考勤")).toBeTruthy();
  });

  it("headerExtra 渲染在标题与「关闭」按钮之间（Issue #182）", () => {
    render(
      <Modal open onClose={vi.fn()} title="请假申请" headerExtra={<span>待审批</span>}>
        <p>内容</p>
      </Modal>,
    );
    const title = screen.getByText("请假申请");
    const extra = screen.getByText("待审批");
    const close = screen.getByRole("button", { name: "关闭" });
    // DOM 顺序：标题 → headerExtra → 关闭
    expect(title.compareDocumentPosition(extra) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(extra.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("不传 headerExtra：标题栏行为与现状一致（标题 + 关闭，无额外容器）", () => {
    const { container } = render(
      <Modal open onClose={vi.fn()} title="排练考勤">
        <p>内容</p>
      </Modal>,
    );
    expect(screen.getByText("排练考勤")).toBeTruthy();
    expect(screen.getByRole("button", { name: "关闭" })).toBeTruthy();
    // 标题行只有标题与关闭两个子元素（不渲染空 headerExtra 容器）
    const headerRow = container.querySelector(".justify-between")!;
    expect(headerRow.children).toHaveLength(2);
  });

  it("position=center 渲染居中样式", () => {
    const { container } = render(
      <Modal open onClose={vi.fn()} position="center">
        <p>居中</p>
      </Modal>,
    );
    expect(container.querySelector(".items-center")).toBeTruthy();
  });
});
