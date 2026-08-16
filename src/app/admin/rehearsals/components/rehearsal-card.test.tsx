// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { AdminRehearsalCard } from "./rehearsal-card";
import type { RehearsalRow } from "@/types/database";

/** 构造排练行（可覆盖字段；默认已更新：updated_at > created_at） */
function makeRehearsal(overrides: Partial<RehearsalRow> = {}): RehearsalRow {
  return {
    id: 1,
    date: null,
    end_time: "2026-08-15T12:00:00",
    location: "排练厅",
    repertoire: "排练曲目",
    sign_in_code: "8848",
    start_time: "2026-08-15T10:00:00",
    target_section: null,
    time: null,
    title: null,
    type: "full",
    created_at: "2026-08-01T00:00:00",
    updated_at: "2026-08-14T00:00:00",
    updated_fields: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("AdminRehearsalCard 展示与更新提示 chip（Issue #171/#173）", () => {
  it("卡片仅展示曲目/时间/地点/更新提示，不渲染任何操作按钮与签到码", () => {
    render(
      <AdminRehearsalCard item={makeRehearsal({ updated_fields: "time" })} onClick={vi.fn()} />,
    );
    expect(screen.getByText("排练曲目")).toBeTruthy();
    // 时间（formatRehearsalRange：8月15日 … 10:00 - 12:00）
    expect(screen.getByText(/8月15日/)).toBeTruthy();
    expect(screen.getByText(/10:00 - 12:00/)).toBeTruthy();
    expect(screen.getByText(/地点：排练厅/)).toBeTruthy();
    expect(screen.getByText("更新排练时间")).toBeTruthy();
    // 无编辑/删除/查看出勤按钮
    expect(screen.queryByRole("button", { name: "编辑" })).toBeNull();
    expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
    expect(screen.queryByRole("button", { name: /查看出勤/ })).toBeNull();
    // 签到码不再展示（移至详情弹窗）
    expect(screen.queryByText("8848")).toBeNull();
    expect(screen.queryByText(/密码/)).toBeNull();
    // 「已结束」小字 chip 移除
    expect(screen.queryByText("已结束")).toBeNull();
  });

  it("点击卡片触发 onClick（打开详情弹窗）", () => {
    const onClick = vi.fn();
    render(<AdminRehearsalCard item={makeRehearsal()} onClick={onClick} />);
    // Card 传入 onClick 时渲染为 button 元素，可访问名含卡片全部文案
    fireEvent.click(screen.getByRole("button", { name: /排练曲目/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("updated_fields=time → 标题下方渲染「更新排练时间」（warning 语义 token）", () => {
    render(
      <AdminRehearsalCard item={makeRehearsal({ updated_fields: "time" })} onClick={vi.fn()} />,
    );
    const chip = screen.getByText("更新排练时间");
    expect(chip.className).toContain("bg-warning-bg");
    expect(chip.className).toContain("text-warning");
  });

  it("多字段按 time/location/repertoire 顺序拼接", () => {
    render(
      <AdminRehearsalCard
        item={makeRehearsal({ updated_fields: "time,location" })}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByText("更新排练时间/地点")).toBeTruthy();
  });

  it("updated_fields 为 null 但已更新（存量数据）→ 兜底全量文案", () => {
    render(<AdminRehearsalCard item={makeRehearsal({ updated_fields: null })} onClick={vi.fn()} />);
    expect(screen.getByText("更新排练时间/地点/曲目")).toBeTruthy();
  });

  it("未更新（updated_at <= created_at）不渲染 chip", () => {
    render(
      <AdminRehearsalCard
        item={makeRehearsal({
          created_at: "2026-08-01T00:00:00",
          updated_at: "2026-08-01T00:00:00",
        })}
        onClick={vi.fn()}
      />,
    );
    expect(screen.queryByText(/更新排练/)).toBeNull();
  });

  it("分排排练展示声部信息（曲目 · 声部 与 针对：声部）", () => {
    render(
      <AdminRehearsalCard
        item={makeRehearsal({ type: "section", target_section: "第一小提琴" })}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByText(/排练曲目 · 第一小提琴/)).toBeTruthy();
    expect(screen.getByText(/针对：第一小提琴/)).toBeTruthy();
  });

  it("无 start_time 时展示「时间未设置」", () => {
    render(
      <AdminRehearsalCard
        item={makeRehearsal({ start_time: null, end_time: null })}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByText("时间未设置")).toBeTruthy();
  });
});
