// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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
    sign_in_code: null,
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

describe("AdminRehearsalCard 更新提示 chip（Issue #171）", () => {
  it("updated_fields=time → 标题下方渲染「更新排练时间」（warning 语义 token）", () => {
    render(<AdminRehearsalCard item={makeRehearsal({ updated_fields: "time" })} />);
    const chip = screen.getByText("更新排练时间");
    expect(chip.className).toContain("bg-warning-bg");
    expect(chip.className).toContain("text-warning");
  });

  it("多字段按 time/location/repertoire 顺序拼接", () => {
    render(<AdminRehearsalCard item={makeRehearsal({ updated_fields: "time,location" })} />);
    expect(screen.getByText("更新排练时间/地点")).toBeTruthy();
  });

  it("updated_fields 为 null 但已更新（存量数据）→ 兜底全量文案", () => {
    render(<AdminRehearsalCard item={makeRehearsal({ updated_fields: null })} />);
    expect(screen.getByText("更新排练时间/地点/曲目")).toBeTruthy();
  });

  it("未更新（updated_at <= created_at）不渲染 chip", () => {
    render(
      <AdminRehearsalCard
        item={makeRehearsal({
          created_at: "2026-08-01T00:00:00",
          updated_at: "2026-08-01T00:00:00",
        })}
      />,
    );
    expect(screen.queryByText(/更新排练/)).toBeNull();
  });

  it("正常渲染其余信息与操作按钮（回归：chip 不影响原有布局）", () => {
    render(
      <AdminRehearsalCard
        item={makeRehearsal({ updated_fields: "location" })}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onViewAttendance={vi.fn()}
      />,
    );
    expect(screen.getByText("排练曲目")).toBeTruthy();
    expect(screen.getByText("更新排练地点")).toBeTruthy();
    expect(screen.getByRole("button", { name: "编辑" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "删除" })).toBeTruthy();
  });
});
