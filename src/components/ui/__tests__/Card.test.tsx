// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Card } from "../Card";

describe("Card", () => {
  afterEach(cleanup);
  it("渲染 children", () => {
    render(
      <Card>
        <p>内容</p>
      </Card>,
    );
    expect(screen.getByText("内容")).toBeTruthy();
  });

  it("传入 className 合并", () => {
    const { container } = render(<Card className="custom">x</Card>);
    expect(container.firstElementChild!.className).toContain("custom");
  });

  it("onClick 使卡片可点击", () => {
    const onClick = vi.fn();
    render(<Card onClick={onClick}>可点击</Card>);
    fireEvent.click(screen.getByText("可点击"));
    expect(onClick).toHaveBeenCalled();
  });

  it("无 onClick 时渲染 div", () => {
    const { container } = render(<Card>div</Card>);
    expect(container.firstElementChild!.tagName).toBe("DIV");
  });

  it("有 onClick 时渲染 button", () => {
    const { container } = render(<Card onClick={vi.fn()}>btn</Card>);
    expect(container.firstElementChild!.tagName).toBe("BUTTON");
  });
});
