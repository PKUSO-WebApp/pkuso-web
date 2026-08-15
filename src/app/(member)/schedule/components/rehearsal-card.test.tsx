// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { RehearsalCard } from "./rehearsal-card";
import type { RehearsalRow } from "@/types/database";

/** 构造排练行（可覆盖字段） */
function makeRehearsal(overrides: Partial<RehearsalRow> = {}): RehearsalRow {
  return {
    id: 1,
    date: null,
    end_time: null,
    location: "排练厅",
    repertoire: "排练曲目",
    sign_in_code: null,
    start_time: null,
    target_section: null,
    time: null,
    title: null,
    type: "full",
    created_at: "2026-08-01T00:00:00",
    updated_at: "2026-08-01T00:00:00",
    ...overrides,
  };
}

describe("RehearsalCard 请假按钮显示条件（Issue #142）", () => {
  // 固定系统时间 2026-08-15 13:00（本地时区），让「已结束/未开始/进行中」判定与真实运行时刻无关
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 13, 0, 0));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("未开始的排练：显示「请假」按钮，不显示「补请假」", () => {
    // 明天 10:00 开始，当前 13:00，距开始远超 30 分钟窗口 → 未开始
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-16T10:00:00", end_time: "2026-08-16T12:00:00" })}
        onLeaveRequest={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "请假" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "补请假" })).toBeNull();
  });

  it("已结束的排练：显示「补请假」按钮", () => {
    // 上午 08:00-10:00，当前 13:00 → 已结束
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-15T08:00:00", end_time: "2026-08-15T10:00:00" })}
        onLeaveRequest={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "补请假" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "请假" })).toBeNull();
  });

  it("进行中的排练：不显示请假按钮（显示签到按钮）", () => {
    // 12:00-15:00，当前 13:00 → 进行中
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-15T12:00:00", end_time: "2026-08-15T15:00:00" })}
        onSignIn={vi.fn()}
        onLeaveRequest={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "请假" })).toBeNull();
    expect(screen.queryByRole("button", { name: "补请假" })).toBeNull();
    expect(screen.getByRole("button", { name: "签到" })).toBeTruthy();
  });

  it("考勤加载中：不渲染请假按钮（防首屏闪错）", () => {
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-16T10:00:00", end_time: "2026-08-16T12:00:00" })}
        attendanceLoading
        onLeaveRequest={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "请假" })).toBeNull();
  });

  it("未传 onLeaveRequest：不渲染请假按钮（其他页面复用卡片不受影响）", () => {
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-16T10:00:00", end_time: "2026-08-16T12:00:00" })}
      />,
    );
    expect(screen.queryByRole("button", { name: "请假" })).toBeNull();
  });

  it("点击请假按钮触发 onLeaveRequest 回调", () => {
    const onLeaveRequest = vi.fn();
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-16T10:00:00", end_time: "2026-08-16T12:00:00" })}
        onLeaveRequest={onLeaveRequest}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "请假" }));
    expect(onLeaveRequest).toHaveBeenCalledTimes(1);
  });

  it("有申请时按钮旁显示申请状态小字（待审批/已通过/已驳回），按钮文案变「编辑申请」", () => {
    const { rerender } = render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-16T10:00:00", end_time: "2026-08-16T12:00:00" })}
        onLeaveRequest={vi.fn()}
        leaveRequest={{ status: "pending" }}
      />,
    );
    expect(screen.getByText("待审批")).toBeTruthy();
    expect(screen.getByRole("button", { name: "编辑申请" })).toBeTruthy();

    rerender(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-16T10:00:00", end_time: "2026-08-16T12:00:00" })}
        onLeaveRequest={vi.fn()}
        leaveRequest={{ status: "approved" }}
      />,
    );
    expect(screen.getByText("已通过")).toBeTruthy();
    expect(screen.getByRole("button", { name: "编辑申请" })).toBeTruthy();

    rerender(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-16T10:00:00", end_time: "2026-08-16T12:00:00" })}
        onLeaveRequest={vi.fn()}
        leaveRequest={{ status: "rejected" }}
      />,
    );
    expect(screen.getByText("已驳回")).toBeTruthy();
    expect(screen.getByRole("button", { name: "编辑申请" })).toBeTruthy();
  });

  it("无申请时按钮旁不显示状态小字", () => {
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-16T10:00:00", end_time: "2026-08-16T12:00:00" })}
        onLeaveRequest={vi.fn()}
        leaveRequest={null}
      />,
    );
    expect(screen.queryByText("待审批")).toBeNull();
    expect(screen.queryByText("已通过")).toBeNull();
    expect(screen.queryByText("已驳回")).toBeNull();
  });
});

describe("RehearsalCard 布局与请假入口（Issue #148）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 13, 0, 0));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("已结束 + 有出勤状态：状态 chip 在「已结束」标签左侧", () => {
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-15T08:00:00", end_time: "2026-08-15T10:00:00" })}
        attendance={{ status: "present", sign_in_time: "2026-08-15T07:55:00" }}
        onLeaveRequest={vi.fn()}
      />,
    );
    // 右上槽内 chip 在「已结束」标签之前（DOM 顺序断言）
    const slot = screen.getByText("已结束").parentElement!;
    expect(slot.children[0].textContent).toContain("出席");
    expect(slot.children[1].textContent).toBe("已结束");
  });

  it("已结束 + 缺勤（无出勤记录）：缺勤 chip 渲染为按钮，点击触发 onLeaveRequest", () => {
    const onLeaveRequest = vi.fn();
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-15T08:00:00", end_time: "2026-08-15T10:00:00" })}
        onLeaveRequest={onLeaveRequest}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /缺勤/ }));
    expect(onLeaveRequest).toHaveBeenCalledTimes(1);
  });

  it("已请假（excused）：chip 不可点击，且不显示补请假/编辑申请按钮", () => {
    const onLeaveRequest = vi.fn();
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-15T08:00:00", end_time: "2026-08-15T10:00:00" })}
        attendance={{ status: "excused", sign_in_time: null }}
        onLeaveRequest={onLeaveRequest}
      />,
    );
    // 请假 chip 存在但为纯展示（非按钮）
    expect(screen.getByText(/⭕\s*请假/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /请假/ })).toBeNull();
    // 已请假不可补请假：无补请假按钮
    expect(screen.queryByRole("button", { name: "补请假" })).toBeNull();
    expect(screen.queryByRole("button", { name: "编辑申请" })).toBeNull();
  });

  it("有申请：审批状态 chip 在按钮左侧，点击「编辑申请」仍触发回调", () => {
    const onLeaveRequest = vi.fn();
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-16T10:00:00", end_time: "2026-08-16T12:00:00" })}
        onLeaveRequest={onLeaveRequest}
        leaveRequest={{ status: "pending" }}
      />,
    );
    expect(screen.getByRole("button", { name: "编辑申请" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "请假" })).toBeNull();
    // 审批状态 chip 在按钮左侧（DOM 顺序断言）
    const chip = screen.getByText("待审批");
    const btn = screen.getByRole("button", { name: "编辑申请" });
    expect(btn.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    // 按钮始终可点打开弹窗
    fireEvent.click(btn);
    expect(onLeaveRequest).toHaveBeenCalledTimes(1);
  });
});
