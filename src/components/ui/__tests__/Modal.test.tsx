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

  it("position=center 渲染居中样式", () => {
    const { container } = render(
      <Modal open onClose={vi.fn()} position="center">
        <p>居中</p>
      </Modal>,
    );
    expect(container.querySelector(".items-center")).toBeTruthy();
  });
});
