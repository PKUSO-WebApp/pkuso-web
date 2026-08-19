// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { Modal } from "./Modal";

/** 渲染一个带按钮宿主页 + 弹窗 */
function renderWithHost() {
  const onClose = vi.fn();
  const host = render(
    <div>
      <button type="button">宿主按钮</button>
      <Modal open onClose={onClose} title="测试弹窗">
        <input aria-label="输入框" placeholder="输入" />
        <button type="button">面板按钮</button>
      </Modal>
    </div>,
  );
  return { onClose, host };
}

/** 带开关的宿主：验证关闭后焦点还原 */
function FocusRestoreFixture() {
  const [open, setOpen] = React.useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        打开弹窗
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="测试弹窗">
        <button type="button">面板按钮</button>
      </Modal>
    </div>
  );
}

describe("Modal 焦点管理（Issue #186）", () => {
  it("打开时焦点移入面板根", () => {
    renderWithHost();
    const dialog = screen.getByRole("dialog");
    // 面板根（tabIndex=-1 可编程聚焦）；遮罩按钮同为 tabindex=-1 但位于 DOM 前部，
    // 用 div 限定避开它
    const panel = dialog.querySelector('div[tabindex="-1"]');
    expect(document.activeElement).toBe(panel);
  });

  it("Tab 在面板内循环：末尾 Tab 回到第一个可聚焦元素", () => {
    renderWithHost();
    const panelBtn = screen.getByRole("button", { name: "面板按钮" });
    // 面板内可聚焦顺序：关闭按钮（标题栏）→ 输入框 → 面板按钮
    // 聚焦到最后一个（面板按钮）后 Tab → 回到第一个（关闭按钮）
    panelBtn.focus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "关闭" }));
    // 第一个 Shift+Tab → 回到最后一个
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(panelBtn);
  });

  it("关闭时焦点还原到打开前的触发按钮", () => {
    render(<FocusRestoreFixture />);
    const trigger = screen.getByRole("button", { name: "打开弹窗" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeTruthy();
    // 关闭（卸载）后焦点还原到触发按钮
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("遮罩关闭按钮不参与 Tab 顺序（tabIndex=-1）", () => {
    renderWithHost();
    const overlay = screen.getByLabelText("关闭弹窗");
    expect(overlay).toHaveAttribute("tabindex", "-1");
  });

  it("inert 子树内元素不参与 Tab 循环", () => {
    render(
      <div>
        <div inert>
          <button type="button">被隔离按钮</button>
        </div>
        <Modal open onClose={() => {}} title="测试弹窗">
          <button type="button">面板按钮</button>
        </Modal>
      </div>,
    );
    const panelBtn = screen.getByRole("button", { name: "面板按钮" });
    panelBtn.focus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" });
    // 面板内唯一可聚焦是「关闭」与「面板按钮」，被隔离按钮不应获得焦点
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "被隔离按钮" }));
    expect(
      document.activeElement === screen.getByRole("button", { name: "关闭" }) ||
        document.activeElement === panelBtn,
    ).toBe(true);
  });
});
