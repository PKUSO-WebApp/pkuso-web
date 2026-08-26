// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, createEvent, cleanup } from "@testing-library/react";
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
    checkin_lat: null,
    checkin_lng: null,
    checkin_radius_m: null,
    sign_in_code: null,
    start_time: null,
    target_section: null,
    time: null,
    title: null,
    type: "full",
    created_at: "2026-08-01T00:00:00",
    updated_at: "2026-08-01T00:00:00",
    updated_fields: null,
    ...overrides,
  };
}

// 固定系统时间 2026-08-15 13:00（本地时区），让「已结束/未开始/进行中」判定与真实运行时刻无关
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 15, 13, 0, 0));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("RehearsalCard 卡片可点击与缩略展示（Issue #173）", () => {
  it("点击整卡触发 onClick 回调（打开详情弹窗）", () => {
    const onClick = vi.fn();
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-16T10:00:00", end_time: "2026-08-16T12:00:00" })}
        onClick={onClick}
      />,
    );
    // 整卡以 role="button" 承载点击（可访问名 = 卡内全部文本）
    fireEvent.click(screen.getByRole("button", { name: /排练曲目/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("键盘 Enter 同样触发 onClick（可访问性）", () => {
    const onClick = vi.fn();
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-16T10:00:00", end_time: "2026-08-16T12:00:00" })}
        onClick={onClick}
      />,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: /排练曲目/ }), { key: "Enter" });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("键盘 Space 同样触发 onClick（可访问性）", () => {
    const onClick = vi.fn();
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-16T10:00:00", end_time: "2026-08-16T12:00:00" })}
        onClick={onClick}
      />,
    );
    // 整卡 onKeyDown 对 Space 与 Enter 一视同仁（preventDefault + onClick）
    fireEvent.keyDown(screen.getByRole("button", { name: /排练曲目/ }), { key: " " });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("曲目过长时用 line-clamp-1 缩略展示（详情弹窗展示完整曲目）", () => {
    render(
      <RehearsalCard
        item={makeRehearsal({
          start_time: "2026-08-16T10:00:00",
          end_time: "2026-08-16T12:00:00",
          repertoire: "很长的曲目名".repeat(20),
        })}
        onClick={vi.fn()}
      />,
    );
    const repertoire = screen.getByText(/很长的曲目名/);
    expect(repertoire.className).toContain("line-clamp-1");
  });

  it("点击签到按钮触发 onSignIn 且不触发整卡 onClick（阻断冒泡）", () => {
    const onClick = vi.fn();
    const onSignIn = vi.fn();
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-15T12:00:00", end_time: "2026-08-15T15:00:00" })}
        onClick={onClick}
        onSignIn={onSignIn}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "签到" }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("键盘 Enter 按签到按钮只触发 onSignIn、不误开详情弹窗（keydown 不冒泡，对抗返工）", () => {
    const onClick = vi.fn();
    const onSignIn = vi.fn();
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-15T12:00:00", end_time: "2026-08-15T15:00:00" })}
        onClick={onClick}
        onSignIn={onSignIn}
      />,
    );
    const btn = screen.getByRole("button", { name: "签到" });
    // jsdom 合成事件不执行「Enter 激活按钮」的浏览器默认动作（不派发 click），需手动模拟：
    // 真实浏览器中 keydown 未被 preventDefault 时按钮被激活并派发 click。
    // 回归点：keydown 若不阻断冒泡，会冒泡到整卡 onKeyDown 被 preventDefault——
    // 取消激活（签到不触发）且误开详情弹窗（onClick 被调用）
    const keydown = createEvent.keyDown(btn, { key: "Enter" });
    fireEvent(btn, keydown);
    if (!keydown.defaultPrevented) {
      fireEvent.click(btn);
    }
    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("键盘 Space 按签到按钮只触发 onSignIn、不误开详情弹窗（keydown 不冒泡，对抗返工）", () => {
    const onClick = vi.fn();
    const onSignIn = vi.fn();
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-15T12:00:00", end_time: "2026-08-15T15:00:00" })}
        onClick={onClick}
        onSignIn={onSignIn}
      />,
    );
    const btn = screen.getByRole("button", { name: "签到" });
    // jsdom 合成事件不执行「Space 激活按钮」的浏览器默认动作（不派发 click），需手动模拟：
    // 真实浏览器中 keydown 未被 preventDefault 时按钮被激活并派发 click。
    // 回归点：keydown 若不阻断冒泡，会冒泡到整卡 onKeyDown 被 preventDefault——
    // 取消激活（签到不触发）且误开详情弹窗（onClick 被调用）
    const keydown = createEvent.keyDown(btn, { key: " " });
    fireEvent(btn, keydown);
    if (!keydown.defaultPrevented) {
      fireEvent.click(btn);
    }
    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("RehearsalCard 签到按钮显示条件（Issue #173）", () => {
  /** 进行中排练（签到窗口内） */
  const ongoing = () =>
    makeRehearsal({ start_time: "2026-08-15T12:00:00", end_time: "2026-08-15T15:00:00" });

  it("进行中 + 无考勤记录：显示「签到」按钮", () => {
    render(<RehearsalCard item={ongoing()} onSignIn={vi.fn()} onClick={vi.fn()} />);
    expect(screen.getByRole("button", { name: "签到" })).toBeTruthy();
  });

  it("进行中 + 默认缺席记录（sign_in_time 为 null）：仍显示「签到」按钮", () => {
    render(
      <RehearsalCard
        item={ongoing()}
        attendance={{ status: "absent", sign_in_time: null }}
        onSignIn={vi.fn()}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "签到" })).toBeTruthy();
  });

  it("未开始：不显示签到按钮，也不渲染任何 chip（chip1 位置留空）", () => {
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-16T10:00:00", end_time: "2026-08-16T12:00:00" })}
        onSignIn={vi.fn()}
        onClick={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "签到" })).toBeNull();
    expect(screen.queryByRole("button", { name: "覆盖请假" })).toBeNull();
  });

  it("已结束：不显示签到按钮，也不渲染任何 chip（出勤状态收敛到详情弹窗）", () => {
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-15T08:00:00", end_time: "2026-08-15T10:00:00" })}
        onSignIn={vi.fn()}
        onClick={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "签到" })).toBeNull();
    expect(screen.queryByText(/缺勤|出席|迟到|请假/)).toBeNull();
  });

  it("已签到（锁定）：不显示签到按钮（无论时间窗口）", () => {
    render(
      <RehearsalCard
        item={ongoing()}
        attendance={{ status: "present", sign_in_time: "2026-08-15T12:05:00" }}
        onSignIn={vi.fn()}
        onClick={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "签到" })).toBeNull();
    expect(screen.queryByRole("button", { name: "覆盖请假" })).toBeNull();
  });

  it("进行中 + 待审批申请：签到按钮变黄「覆盖请假」（warning 色系）", () => {
    render(
      <RehearsalCard
        item={ongoing()}
        onSignIn={vi.fn()}
        onClick={vi.fn()}
        leaveRequest={{ status: "pending" }}
      />,
    );
    const btn = screen.getByRole("button", { name: "覆盖请假" });
    expect(btn.className).toContain("bg-warning-bg");
    expect(btn.className).toContain("text-warning");
    expect(screen.queryByRole("button", { name: "签到" })).toBeNull();
  });

  it("进行中 + 已通过申请：同样变黄「覆盖请假」", () => {
    render(
      <RehearsalCard
        item={ongoing()}
        onSignIn={vi.fn()}
        onClick={vi.fn()}
        leaveRequest={{ status: "approved" }}
      />,
    );
    expect(screen.getByRole("button", { name: "覆盖请假" })).toBeTruthy();
  });

  it("进行中 + excused 未签到 + 无申请：显示正常「签到」按钮（覆盖签到，Issue #159 方案 B）", () => {
    render(
      <RehearsalCard
        item={ongoing()}
        attendance={{ status: "excused", sign_in_time: null }}
        onSignIn={vi.fn()}
        onClick={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: "签到" });
    expect(btn.className).not.toContain("bg-warning-bg");
  });

  it("进行中 + excused 未签到 + 待审批申请：黄色「覆盖请假」（优先级高于普通签到）", () => {
    render(
      <RehearsalCard
        item={ongoing()}
        attendance={{ status: "excused", sign_in_time: null }}
        onSignIn={vi.fn()}
        onClick={vi.fn()}
        leaveRequest={{ status: "pending" }}
      />,
    );
    expect(screen.getByRole("button", { name: "覆盖请假" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "签到" })).toBeNull();
  });

  it("未开始/已结束 + 待审批申请：签到窗口外无任何按钮（覆盖请假仅窗口内）", () => {
    const { rerender } = render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-16T10:00:00", end_time: "2026-08-16T12:00:00" })}
        onSignIn={vi.fn()}
        onClick={vi.fn()}
        leaveRequest={{ status: "pending" }}
      />,
    );
    expect(screen.queryByRole("button", { name: "覆盖请假" })).toBeNull();
    expect(screen.queryByRole("button", { name: "签到" })).toBeNull();

    rerender(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-15T08:00:00", end_time: "2026-08-15T10:00:00" })}
        onSignIn={vi.fn()}
        onClick={vi.fn()}
        leaveRequest={{ status: "pending" }}
      />,
    );
    expect(screen.queryByRole("button", { name: "覆盖请假" })).toBeNull();
    expect(screen.queryByRole("button", { name: "签到" })).toBeNull();
  });

  it("进行中 + 已驳回申请：显示普通「签到」按钮（已驳回不拦截签到）", () => {
    render(
      <RehearsalCard
        item={ongoing()}
        onSignIn={vi.fn()}
        onClick={vi.fn()}
        leaveRequest={{ status: "rejected" }}
      />,
    );
    const btn = screen.getByRole("button", { name: "签到" });
    expect(btn.className).not.toContain("bg-warning-bg");
  });

  it("考勤加载中：不渲染签到按钮，显示占位符（防首屏闪错）", () => {
    render(<RehearsalCard item={ongoing()} attendanceLoading onClick={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "签到" })).toBeNull();
    const placeholder = screen.getByText("…");
    expect(placeholder.className).toContain("w-full");
    expect(placeholder.className).toContain("h-8");
  });

  it("未传 onSignIn：不渲染签到按钮（其他场景复用卡片不受影响）", () => {
    render(<RehearsalCard item={ongoing()} onClick={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "签到" })).toBeNull();
  });
});

describe("RehearsalCard 卡片去按钮化（Issue #173）", () => {
  it("右栏带分隔线与固定宽（border-l border-border pl-3 flex-shrink-0），不挤爆左栏", () => {
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-15T12:00:00", end_time: "2026-08-15T15:00:00" })}
        onSignIn={vi.fn()}
        onClick={vi.fn()}
      />,
    );
    const column = screen.getByRole("button", { name: "签到" }).parentElement!;
    expect(column.className).toContain("border-l");
    expect(column.className).toContain("border-border");
    expect(column.className).toContain("pl-3");
    expect(column.className).toContain("flex-shrink-0");
    expect(column.className).toContain("w-32");
  });

  it("签到按钮统一 w-full + h-8 + 居中（样式保持 Issue #164）", () => {
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-15T12:00:00", end_time: "2026-08-15T15:00:00" })}
        onSignIn={vi.fn()}
        onClick={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: "签到" });
    expect(btn.className).toContain("w-full");
    expect(btn.className).toContain("h-8");
    expect(btn.className).toContain("justify-center");
  });

  it("请假操作按钮已移除：请假/补请假/编辑申请/重新申请均不出现（入口收敛到详情弹窗）", () => {
    const { rerender } = render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-16T10:00:00", end_time: "2026-08-16T12:00:00" })}
        onClick={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "请假" })).toBeNull();
    expect(screen.queryByRole("button", { name: "补请假" })).toBeNull();

    rerender(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-15T08:00:00", end_time: "2026-08-15T10:00:00" })}
        onClick={vi.fn()}
        leaveRequest={{ status: "pending" }}
      />,
    );
    expect(screen.queryByRole("button", { name: "编辑申请" })).toBeNull();

    rerender(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-16T10:00:00", end_time: "2026-08-16T12:00:00" })}
        onClick={vi.fn()}
        leaveRequest={{ status: "rejected" }}
      />,
    );
    expect(screen.queryByRole("button", { name: "重新申请" })).toBeNull();
  });

  it("申请状态 chip 与出勤状态 chip 已移除（展示收敛到详情弹窗/请假面板）", () => {
    const { rerender } = render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-15T12:00:00", end_time: "2026-08-15T15:00:00" })}
        attendance={{ status: "present", sign_in_time: "2026-08-15T12:05:00" }}
        onClick={vi.fn()}
        leaveRequest={{ status: "approved" }}
      />,
    );
    expect(screen.queryByText(/出席|迟到|缺勤|请假/)).toBeNull();
    expect(screen.queryByText(/待审批|已通过|已驳回/)).toBeNull();

    rerender(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-16T10:00:00", end_time: "2026-08-16T12:00:00" })}
        onClick={vi.fn()}
        leaveRequest={{ status: "pending" }}
      />,
    );
    expect(screen.queryByText(/待审批|已通过|已驳回/)).toBeNull();
  });

  it("更新提示 chip 仍在卡片展示（Issue #171 不回归）", () => {
    render(
      <RehearsalCard
        item={makeRehearsal({
          start_time: "2026-08-15T12:00:00",
          end_time: "2026-08-15T15:00:00",
          created_at: "2026-08-01T00:00:00",
          updated_at: "2026-08-14T00:00:00",
          updated_fields: "time",
        })}
        isUpdated
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByText("更新排练时间")).toBeTruthy();
  });
});
