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

describe("RehearsalCard 左右分栏布局（Issue #155）", () => {
  // 固定系统时间 2026-08-15 13:00（本地时区），让「已结束/未开始/进行中」判定与真实运行时刻无关
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 13, 0, 0));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("右侧栏带分隔线与固定宽（border-l border-border pl-3 flex-shrink-0），不挤爆左栏", () => {
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-15T12:00:00", end_time: "2026-08-15T15:00:00" })}
        onSignIn={vi.fn()}
      />,
    );
    // 签到按钮是右侧栏的第一个直接子元素，其父容器即右栏
    const column = screen.getByRole("button", { name: "签到" }).parentElement!;
    expect(column.className).toContain("border-l");
    expect(column.className).toContain("border-border");
    expect(column.className).toContain("pl-3");
    expect(column.className).toContain("flex-shrink-0");
    expect(column.className).toContain("w-32");
  });

  it("右侧顺序：状态 → 申请状态 chip → 操作按钮（DOM 顺序）", () => {
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-15T12:00:00", end_time: "2026-08-15T15:00:00" })}
        onSignIn={vi.fn()}
        onLeaveRequest={vi.fn()}
        leaveRequest={{ status: "pending" }}
      />,
    );
    const overrideBtn = screen.getByRole("button", { name: "覆盖请假" });
    const chip = screen.getByText("待审批");
    const editBtn = screen.getByRole("button", { name: "编辑申请" });
    // 状态（覆盖请假按钮）在 chip 前，chip 在操作按钮前
    expect(
      chip.compareDocumentPosition(overrideBtn) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
    expect(editBtn.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });
});

describe("RehearsalCard 操作按钮显示条件矩阵（Issue #155）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 13, 0, 0));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // ---- 无申请：按时间与出勤分派 ----

  it("未开始的排练：显示「请假」按钮，不显示「补请假」", () => {
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-16T10:00:00", end_time: "2026-08-16T12:00:00" })}
        onLeaveRequest={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "请假" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "补请假" })).toBeNull();
    expect(screen.getByText("未开始")).toBeTruthy();
  });

  it("进行中的排练（结束前）：显示「签到」与「请假」两个按钮", () => {
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-15T12:00:00", end_time: "2026-08-15T15:00:00" })}
        onSignIn={vi.fn()}
        onLeaveRequest={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "签到" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "请假" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "补请假" })).toBeNull();
  });

  it("已结束 + 无考勤记录（默认缺席）：显示「补请假」", () => {
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-15T08:00:00", end_time: "2026-08-15T10:00:00" })}
        onLeaveRequest={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "补请假" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "请假" })).toBeNull();
  });

  it("已结束 + 出勤缺席：显示「补请假」", () => {
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-15T08:00:00", end_time: "2026-08-15T10:00:00" })}
        attendance={{ status: "absent", sign_in_time: null }}
        onLeaveRequest={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "补请假" })).toBeTruthy();
  });

  it("已结束 + 出席/迟到：不显示请假/补请假（补请假仅缺席，Issue #155）", () => {
    const { rerender } = render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-15T08:00:00", end_time: "2026-08-15T10:00:00" })}
        attendance={{ status: "present", sign_in_time: "2026-08-15T07:55:00" }}
        onLeaveRequest={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "请假" })).toBeNull();
    expect(screen.queryByRole("button", { name: "补请假" })).toBeNull();

    rerender(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-15T08:00:00", end_time: "2026-08-15T10:00:00" })}
        attendance={{ status: "late", sign_in_time: "2026-08-15T09:00:00" }}
        onLeaveRequest={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "请假" })).toBeNull();
    expect(screen.queryByRole("button", { name: "补请假" })).toBeNull();
  });

  it("已结束 + 已请假（excused）：不显示操作按钮，请假 chip 为纯展示（非按钮）", () => {
    const onLeaveRequest = vi.fn();
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-15T08:00:00", end_time: "2026-08-15T10:00:00" })}
        attendance={{ status: "excused", sign_in_time: null }}
        onLeaveRequest={onLeaveRequest}
      />,
    );
    expect(screen.getByText(/⭕\s*请假/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /请假/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /补请假/ })).toBeNull();
  });

  it("缺勤 chip 不再可点击（补请假按钮承担入口，Issue #155）", () => {
    const onLeaveRequest = vi.fn();
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-15T08:00:00", end_time: "2026-08-15T10:00:00" })}
        onLeaveRequest={onLeaveRequest}
      />,
    );
    // 缺勤 chip 是纯展示元素
    expect(screen.queryByRole("button", { name: /缺勤/ })).toBeNull();
    expect(screen.getByText(/❌\s*缺勤/)).toBeTruthy();
    // 入口是「补请假」按钮
    fireEvent.click(screen.getByRole("button", { name: "补请假" }));
    expect(onLeaveRequest).toHaveBeenCalledTimes(1);
  });

  // ---- 有有效申请：按申请状态分派 ----

  it("待审批：显示「待审批」chip + 「编辑申请」按钮（不论时间窗口）", () => {
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-15T08:00:00", end_time: "2026-08-15T10:00:00" })}
        onLeaveRequest={vi.fn()}
        leaveRequest={{ status: "pending" }}
      />,
    );
    expect(screen.getByText("待审批")).toBeTruthy();
    expect(screen.getByRole("button", { name: "编辑申请" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "请假" })).toBeNull();
    expect(screen.queryByRole("button", { name: "补请假" })).toBeNull();
  });

  it("已通过：显示「已通过」chip，不显示操作按钮（已通过不显示操作按钮，Issue #155）", () => {
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-16T10:00:00", end_time: "2026-08-16T12:00:00" })}
        onLeaveRequest={vi.fn()}
        leaveRequest={{ status: "approved" }}
      />,
    );
    expect(screen.getByText("已通过")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "请假" })).toBeNull();
    expect(screen.queryByRole("button", { name: "补请假" })).toBeNull();
    expect(screen.queryByRole("button", { name: "编辑申请" })).toBeNull();
    expect(screen.queryByRole("button", { name: "重新申请" })).toBeNull();
  });

  it("已驳回：显示「已驳回」chip + 「重新申请」按钮", () => {
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-16T10:00:00", end_time: "2026-08-16T12:00:00" })}
        onLeaveRequest={vi.fn()}
        leaveRequest={{ status: "rejected" }}
      />,
    );
    expect(screen.getByText("已驳回")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重新申请" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "编辑申请" })).toBeNull();
  });

  it("已签到（锁定）+ 已驳回：无「重新申请」按钮，申请状态 chip 仍展示（返工）", () => {
    // 此前 !signedIn 只拦无申请分支：已签到 + 已驳回仍显示「重新申请」，点击提交后审批通过会
    // 覆盖考勤为 excused，造成「已签到但请假」不可恢复矛盾（signedIn 锁定不能重签、approved
    // 无按钮不能撤回）——返工后已签到统一不显示请假入口
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-16T10:00:00", end_time: "2026-08-16T12:00:00" })}
        attendance={{ status: "present", sign_in_time: "2026-08-15T12:05:00" }}
        onLeaveRequest={vi.fn()}
        leaveRequest={{ status: "rejected" }}
      />,
    );
    expect(screen.getByText("已驳回")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "重新申请" })).toBeNull();
    expect(screen.queryByRole("button", { name: "编辑申请" })).toBeNull();
  });

  it("已签到（锁定）+ 待审批：无「编辑申请」按钮，申请状态 chip 仍展示（返工）", () => {
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-16T10:00:00", end_time: "2026-08-16T12:00:00" })}
        attendance={{ status: "present", sign_in_time: "2026-08-15T12:05:00" }}
        onLeaveRequest={vi.fn()}
        leaveRequest={{ status: "pending" }}
      />,
    );
    expect(screen.getByText("待审批")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "编辑申请" })).toBeNull();
    expect(screen.queryByRole("button", { name: "重新申请" })).toBeNull();
  });

  it("已取消的申请：视同无申请，按时间显示「请假」，无状态 chip", () => {
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-16T10:00:00", end_time: "2026-08-16T12:00:00" })}
        onLeaveRequest={vi.fn()}
        leaveRequest={{ status: "canceled" }}
      />,
    );
    expect(screen.queryByText("已取消")).toBeNull();
    expect(screen.getByRole("button", { name: "请假" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "编辑申请" })).toBeNull();
  });

  // ---- 边界：加载中 / 无回调 ----

  it("考勤加载中：不渲染操作按钮（防首屏闪错）", () => {
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-16T10:00:00", end_time: "2026-08-16T12:00:00" })}
        attendanceLoading
        onLeaveRequest={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "请假" })).toBeNull();
    expect(screen.queryByRole("button", { name: "补请假" })).toBeNull();
  });

  it("未传 onLeaveRequest：不渲染操作按钮（其他页面复用卡片不受影响）", () => {
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
});

describe("RehearsalCard 覆盖请假签到按钮（Issue #155）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 13, 0, 0));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  /** 进行中排练（签到窗口内） */
  const ongoing = () =>
    makeRehearsal({ start_time: "2026-08-15T12:00:00", end_time: "2026-08-15T15:00:00" });

  it("进行中 + 待审批申请：签到按钮变黄「覆盖请假」（warning 色系）", () => {
    render(
      <RehearsalCard item={ongoing()} onSignIn={vi.fn()} leaveRequest={{ status: "pending" }} />,
    );
    const btn = screen.getByRole("button", { name: "覆盖请假" });
    expect(btn.className).toContain("bg-warning-bg");
    expect(btn.className).toContain("text-warning");
    expect(screen.queryByRole("button", { name: "签到" })).toBeNull();
  });

  it("进行中 + 已通过申请：同样变黄「覆盖请假」", () => {
    render(
      <RehearsalCard item={ongoing()} onSignIn={vi.fn()} leaveRequest={{ status: "approved" }} />,
    );
    expect(screen.getByRole("button", { name: "覆盖请假" })).toBeTruthy();
  });

  it("进行中 + 待审批申请 + 出勤已写请假（excused）：黄色「覆盖请假」按钮替代请假 chip（返工）", () => {
    // 审批通过会写 attendance.status=excused 使 statusChip 命中，此前只会渲染「⭕请假」chip，
    // 黄色覆盖按钮分支不可达；返工后 statusChip 分支优先处理 canOverrideLeave
    render(
      <RehearsalCard
        item={ongoing()}
        attendance={{ status: "excused", sign_in_time: null }}
        onSignIn={vi.fn()}
        leaveRequest={{ status: "pending" }}
      />,
    );
    const btn = screen.getByRole("button", { name: "覆盖请假" });
    expect(btn.className).toContain("bg-warning-bg");
    expect(btn.className).toContain("text-warning");
    // 请假 chip 被覆盖按钮替代，无普通「签到」按钮
    expect(screen.queryByText(/⭕\s*请假/)).toBeNull();
    expect(screen.queryByRole("button", { name: "签到" })).toBeNull();
  });

  it("进行中 + 已通过申请 + 出勤已写请假（excused）：黄色「覆盖请假」按钮替代请假 chip（返工）", () => {
    render(
      <RehearsalCard
        item={ongoing()}
        attendance={{ status: "excused", sign_in_time: null }}
        onSignIn={vi.fn()}
        leaveRequest={{ status: "approved" }}
      />,
    );
    const btn = screen.getByRole("button", { name: "覆盖请假" });
    expect(btn.className).toContain("bg-warning-bg");
    expect(btn.className).toContain("text-warning");
    // 申请状态 chip 仍在下栏展示「已通过」，请假 chip 被覆盖按钮替代
    expect(screen.getByText("已通过")).toBeTruthy();
    expect(screen.queryByText(/⭕\s*请假/)).toBeNull();
    expect(screen.queryByRole("button", { name: "签到" })).toBeNull();
  });

  it("进行中 + 无申请 + 管理员手动设请假（excused 未签到）：显示正常「签到」按钮（返工，Issue #159 方案 B）", () => {
    // 无申请时 canOverrideLeave 不成立；但请假未签到 + 无进行中申请时成员应可签到覆盖——
    // 修复「撤回已通过申请后无法签到也无法重新申请」的死局（管理员手动设 excused 语义同构：
    // 成员到场可覆盖，与需求方确认）
    render(
      <RehearsalCard
        item={ongoing()}
        attendance={{ status: "excused", sign_in_time: null }}
        onSignIn={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: "签到" });
    // 普通签到样式（非黄色覆盖按钮）
    expect(btn.className).not.toContain("bg-warning-bg");
    expect(screen.queryByRole("button", { name: "覆盖请假" })).toBeNull();
    expect(screen.queryByText(/⭕\s*请假/)).toBeNull();
  });

  it("进行中 + excused 未签到 + 已撤回申请（死局场景）：显示正常「签到」按钮（Issue #159 方案 B）", () => {
    // 撤回已通过申请后：考勤 excused、sign_in_time 空、无有效申请——此前无法签到
    // （canOverrideLeave 需 pending/approved）也无法重新申请（请假入口被 excused 抑制），
    // 返工后签到窗口内显示正常「签到」按钮
    render(
      <RehearsalCard
        item={ongoing()}
        attendance={{ status: "excused", sign_in_time: null }}
        onSignIn={vi.fn()}
        onLeaveRequest={vi.fn()}
        leaveRequest={{ status: "withdrawn" }}
      />,
    );
    const btn = screen.getByRole("button", { name: "签到" });
    expect(btn.className).not.toContain("bg-warning-bg");
    expect(screen.queryByRole("button", { name: "覆盖请假" })).toBeNull();
    expect(screen.queryByText(/⭕\s*请假/)).toBeNull();
  });

  it("已结束 + excused 未签到：保留纯请假 chip，无签到按钮（窗口外不可签，Issue #159 方案 B）", () => {
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-15T08:00:00", end_time: "2026-08-15T10:00:00" })}
        attendance={{ status: "excused", sign_in_time: null }}
        onSignIn={vi.fn()}
      />,
    );
    expect(screen.getByText(/⭕\s*请假/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "签到" })).toBeNull();
    expect(screen.queryByRole("button", { name: "覆盖请假" })).toBeNull();
  });

  it("未开始 + excused 未签到：保留纯请假 chip，无签到按钮（窗口外不可签，Issue #159 方案 B）", () => {
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-16T10:00:00", end_time: "2026-08-16T12:00:00" })}
        attendance={{ status: "excused", sign_in_time: null }}
        onSignIn={vi.fn()}
      />,
    );
    expect(screen.getByText(/⭕\s*请假/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "签到" })).toBeNull();
  });

  it("excused 已签到（锁定）：chip 固定展示，无签到/覆盖按钮（不变）", () => {
    render(
      <RehearsalCard
        item={ongoing()}
        attendance={{ status: "excused", sign_in_time: "2026-08-15T12:05:00" }}
        onSignIn={vi.fn()}
      />,
    );
    expect(screen.getByText(/⭕\s*请假/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "签到" })).toBeNull();
    expect(screen.queryByRole("button", { name: "覆盖请假" })).toBeNull();
  });

  it("进行中 + 已驳回申请：签到按钮不变黄（已驳回维持不变，签到不覆盖）", () => {
    render(
      <RehearsalCard item={ongoing()} onSignIn={vi.fn()} leaveRequest={{ status: "rejected" }} />,
    );
    const btn = screen.getByRole("button", { name: "签到" });
    expect(btn.className).not.toContain("bg-warning-bg");
    expect(screen.queryByRole("button", { name: "覆盖请假" })).toBeNull();
  });

  it("进行中 + 无申请：普通「签到」按钮", () => {
    render(<RehearsalCard item={ongoing()} onSignIn={vi.fn()} />);
    expect(screen.getByRole("button", { name: "签到" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "覆盖请假" })).toBeNull();
  });

  it("未开始 + 待审批：不在签到窗口，无黄色按钮（显示「未开始」）", () => {
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-16T10:00:00", end_time: "2026-08-16T12:00:00" })}
        onSignIn={vi.fn()}
        leaveRequest={{ status: "pending" }}
      />,
    );
    expect(screen.queryByRole("button", { name: "覆盖请假" })).toBeNull();
    expect(screen.queryByRole("button", { name: "签到" })).toBeNull();
    expect(screen.getByText("未开始")).toBeTruthy();
  });

  it("已结束 + 待审批：无黄色按钮（已结束不可签）", () => {
    render(
      <RehearsalCard
        item={makeRehearsal({ start_time: "2026-08-15T08:00:00", end_time: "2026-08-15T10:00:00" })}
        onSignIn={vi.fn()}
        leaveRequest={{ status: "pending" }}
      />,
    );
    expect(screen.queryByRole("button", { name: "覆盖请假" })).toBeNull();
    expect(screen.queryByRole("button", { name: "签到" })).toBeNull();
  });

  it("已签到（锁定）+ 待审批：显示状态 chip，无签到/覆盖按钮", () => {
    render(
      <RehearsalCard
        item={ongoing()}
        attendance={{ status: "present", sign_in_time: "2026-08-15T12:05:00" }}
        onSignIn={vi.fn()}
        leaveRequest={{ status: "pending" }}
      />,
    );
    expect(screen.queryByRole("button", { name: "覆盖请假" })).toBeNull();
    expect(screen.queryByRole("button", { name: "签到" })).toBeNull();
    expect(screen.getByText(/✅\s*出席/)).toBeTruthy();
  });

  it("已签到（锁定）+ 无申请 + 进行中：不显示请假按钮（已签到不可再请假，返工）", () => {
    // 无申请分支此前只拦 ended 后的补请假（补请假仅缺席）；进行中 + 已签到仍显示「请假」，
    // 提交后审批通过会覆盖考勤为 excused，造成「已签到但请假」不可恢复矛盾（signedIn 锁定
    // 不能重签、approved 无按钮不能撤回）——返工后已签到不显示任何请假入口
    render(
      <RehearsalCard
        item={ongoing()}
        attendance={{ status: "present", sign_in_time: "2026-08-15T12:05:00" }}
        onSignIn={vi.fn()}
        onLeaveRequest={vi.fn()}
      />,
    );
    expect(screen.getByText(/✅\s*出席/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "请假" })).toBeNull();
    expect(screen.queryByRole("button", { name: "补请假" })).toBeNull();
  });
});
