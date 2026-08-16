// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { RehearsalDetailModal } from "./rehearsal-detail-modal";
import type { RehearsalRow } from "@/types/database";

// mock Modal 只渲染内容容器（真实 Modal 的 fixed 定位与 jsdom 无关）
vi.mock("@/components/ui/Modal", () => ({
  Modal: ({ open, children }: { open: boolean; children?: React.ReactNode }) =>
    open ? <div data-testid="detail-modal">{children}</div> : null,
}));

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
    updated_fields: null,
    ...overrides,
  };
}

// 固定系统时间 2026-08-15 13:00（本地时区），「未开始/进行中/已结束」判定与真实运行时刻无关
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 15, 13, 0, 0));
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("RehearsalDetailModal 出勤状态五行映射（Issue #173）", () => {
  it("进行中未签到 → 「未签到」", () => {
    render(
      <RehearsalDetailModal
        item={makeRehearsal({ start_time: "2026-08-15T12:00:00", end_time: "2026-08-15T15:00:00" })}
        onClose={vi.fn()}
        onLeaveRequest={vi.fn()}
      />,
    );
    expect(screen.getByText("未签到")).toBeTruthy();
  });

  it("未开始未签到 → 「未签到」", () => {
    render(
      <RehearsalDetailModal
        item={makeRehearsal({ start_time: "2026-08-16T10:00:00", end_time: "2026-08-16T12:00:00" })}
        onClose={vi.fn()}
        onLeaveRequest={vi.fn()}
      />,
    );
    expect(screen.getByText("未签到")).toBeTruthy();
  });

  it("已签到（present）→ 「出席」", () => {
    render(
      <RehearsalDetailModal
        item={makeRehearsal({ start_time: "2026-08-15T12:00:00", end_time: "2026-08-15T15:00:00" })}
        attendance={{ status: "present", sign_in_time: "2026-08-15T12:05:00" }}
        onClose={vi.fn()}
        onLeaveRequest={vi.fn()}
      />,
    );
    expect(screen.getByText("出席")).toBeTruthy();
  });

  it("已签到（late）→ 「迟到」", () => {
    render(
      <RehearsalDetailModal
        item={makeRehearsal({ start_time: "2026-08-15T12:00:00", end_time: "2026-08-15T15:00:00" })}
        attendance={{ status: "late", sign_in_time: "2026-08-15T12:30:00" }}
        onClose={vi.fn()}
        onLeaveRequest={vi.fn()}
      />,
    );
    expect(screen.getByText("迟到")).toBeTruthy();
  });

  it("进行中 + 管理员设置迟到（late，未签到）→ 「迟到」", () => {
    render(
      <RehearsalDetailModal
        item={makeRehearsal({ start_time: "2026-08-15T12:00:00", end_time: "2026-08-15T15:00:00" })}
        attendance={{ status: "late", sign_in_time: null }}
        onClose={vi.fn()}
        onLeaveRequest={vi.fn()}
      />,
    );
    expect(screen.getByText("迟到")).toBeTruthy();
    expect(screen.queryByText("未签到")).toBeNull();
  });

  it("已结束 + 管理员设置出席（present，未签到）→ 「出席」", () => {
    render(
      <RehearsalDetailModal
        item={makeRehearsal({ start_time: "2026-08-15T08:00:00", end_time: "2026-08-15T10:00:00" })}
        attendance={{ status: "present", sign_in_time: null }}
        onClose={vi.fn()}
        onLeaveRequest={vi.fn()}
      />,
    );
    expect(screen.getByText("出席")).toBeTruthy();
    expect(screen.queryByText("缺勤")).toBeNull();
  });

  it("已结束未签到 → 「缺勤」（无考勤记录与默认缺席记录均同）", () => {
    const { rerender } = render(
      <RehearsalDetailModal
        item={makeRehearsal({ start_time: "2026-08-15T08:00:00", end_time: "2026-08-15T10:00:00" })}
        onClose={vi.fn()}
        onLeaveRequest={vi.fn()}
      />,
    );
    expect(screen.getByText("缺勤")).toBeTruthy();

    rerender(
      <RehearsalDetailModal
        item={makeRehearsal({ start_time: "2026-08-15T08:00:00", end_time: "2026-08-15T10:00:00" })}
        attendance={{ status: "absent", sign_in_time: null }}
        onClose={vi.fn()}
        onLeaveRequest={vi.fn()}
      />,
    );
    expect(screen.getByText("缺勤")).toBeTruthy();
  });

  it("出勤为请假（excused，未签到）→ 「请假」", () => {
    render(
      <RehearsalDetailModal
        item={makeRehearsal({ start_time: "2026-08-15T08:00:00", end_time: "2026-08-15T10:00:00" })}
        attendance={{ status: "excused", sign_in_time: null }}
        onClose={vi.fn()}
        onLeaveRequest={vi.fn()}
      />,
    );
    expect(screen.getByText("请假")).toBeTruthy();
  });

  it("考勤加载中：出勤状态行显示占位符（防未签到误判）", () => {
    render(
      <RehearsalDetailModal
        item={makeRehearsal({ start_time: "2026-08-15T12:00:00", end_time: "2026-08-15T15:00:00" })}
        attendanceLoading
        onClose={vi.fn()}
        onLeaveRequest={vi.fn()}
      />,
    );
    expect(screen.getByText("…")).toBeTruthy();
    expect(screen.queryByText("未签到")).toBeNull();
  });

  it("出勤状态行使用较大字体（text-lg font-semibold）", () => {
    render(
      <RehearsalDetailModal
        item={makeRehearsal({ start_time: "2026-08-15T12:00:00", end_time: "2026-08-15T15:00:00" })}
        onClose={vi.fn()}
        onLeaveRequest={vi.fn()}
      />,
    );
    const status = screen.getByText("未签到");
    expect(status.className).toContain("text-lg");
    expect(status.className).toContain("font-semibold");
  });
});

describe("RehearsalDetailModal 排练信息与请假入口（Issue #173）", () => {
  it("展示类型/时间/地点/曲目（完整显示，无缩略）", () => {
    render(
      <RehearsalDetailModal
        item={makeRehearsal({
          start_time: "2026-08-15T12:00:00",
          end_time: "2026-08-15T15:00:00",
          repertoire: "完整的曲目名称".repeat(5),
        })}
        onClose={vi.fn()}
        onLeaveRequest={vi.fn()}
      />,
    );
    expect(screen.getByText("排练类型")).toBeTruthy();
    expect(screen.getByText("合排")).toBeTruthy();
    expect(screen.getByText("时间")).toBeTruthy();
    expect(screen.getByText("地点")).toBeTruthy();
    expect(screen.getByText("排练厅")).toBeTruthy();
    expect(screen.getByText("曲目")).toBeTruthy();
    const repertoire = screen.getByText("完整的曲目名称".repeat(5));
    expect(repertoire.className).not.toContain("line-clamp");
  });

  it("分排排练显示声部（分排 · 小提琴）", () => {
    render(
      <RehearsalDetailModal
        item={makeRehearsal({
          start_time: "2026-08-15T12:00:00",
          end_time: "2026-08-15T15:00:00",
          type: "section",
          target_section: "小提琴",
        })}
        onClose={vi.fn()}
        onLeaveRequest={vi.fn()}
      />,
    );
    expect(screen.getByText("分排 · 小提琴")).toBeTruthy();
    expect(screen.queryByText("合排")).toBeNull();
  });

  it("「我要请假 ＞」为蓝色小字（语义 token text-info，亮/暗双模式）", () => {
    render(
      <RehearsalDetailModal
        item={makeRehearsal({ start_time: "2026-08-15T12:00:00", end_time: "2026-08-15T15:00:00" })}
        onClose={vi.fn()}
        onLeaveRequest={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: /我要请假/ });
    expect(btn.className).toContain("text-info");
  });

  it("点击「我要请假 ＞」触发 onLeaveRequest（打开请假面板）", () => {
    const onLeaveRequest = vi.fn();
    render(
      <RehearsalDetailModal
        item={makeRehearsal({ start_time: "2026-08-15T12:00:00", end_time: "2026-08-15T15:00:00" })}
        onClose={vi.fn()}
        onLeaveRequest={onLeaveRequest}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /我要请假/ }));
    expect(onLeaveRequest).toHaveBeenCalledTimes(1);
  });
});

describe("RehearsalDetailModal 红点机制（Issue #173）", () => {
  /** 已通过申请 */
  const approved = { id: "lr-1", status: "approved" };
  /** 进行中排练 */
  const ongoing = () =>
    makeRehearsal({ start_time: "2026-08-15T12:00:00", end_time: "2026-08-15T15:00:00" });

  it("已通过申请且未查看：显示红点", () => {
    render(
      <RehearsalDetailModal
        item={ongoing()}
        leaveRequest={approved}
        onClose={vi.fn()}
        onLeaveRequest={vi.fn()}
      />,
    );
    const dot = screen.getByTestId("leave-dot");
    expect(dot.className).toContain("bg-danger");
  });

  it("已驳回申请且未查看：同样显示红点", () => {
    render(
      <RehearsalDetailModal
        item={ongoing()}
        leaveRequest={{ id: "lr-1", status: "rejected" }}
        onClose={vi.fn()}
        onLeaveRequest={vi.fn()}
      />,
    );
    expect(screen.getByTestId("leave-dot")).toBeTruthy();
  });

  it("待审批申请：不显示红点", () => {
    render(
      <RehearsalDetailModal
        item={ongoing()}
        leaveRequest={{ id: "lr-1", status: "pending" }}
        onClose={vi.fn()}
        onLeaveRequest={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("leave-dot")).toBeNull();
  });

  it("无请假申请：不显示红点", () => {
    render(<RehearsalDetailModal item={ongoing()} onClose={vi.fn()} onLeaveRequest={vi.fn()} />);
    expect(screen.queryByTestId("leave-dot")).toBeNull();
  });

  it("已查看（localStorage 已记录 leaveSeen_<id>）：不显示红点", () => {
    window.localStorage.setItem("leaveSeen_lr-1", "1");
    render(
      <RehearsalDetailModal
        item={ongoing()}
        leaveRequest={approved}
        onClose={vi.fn()}
        onLeaveRequest={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("leave-dot")).toBeNull();
  });

  it("点击「我要请假 ＞」查看已通过申请：写入 localStorage 且红点消失", () => {
    const onLeaveRequest = vi.fn();
    const { rerender } = render(
      <RehearsalDetailModal
        item={ongoing()}
        leaveRequest={approved}
        onClose={vi.fn()}
        onLeaveRequest={onLeaveRequest}
      />,
    );
    expect(screen.getByTestId("leave-dot")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /我要请假/ }));
    expect(onLeaveRequest).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem("leaveSeen_lr-1")).toBe("1");

    // 模拟父级重开弹窗（同申请）：红点不再出现
    rerender(
      <RehearsalDetailModal
        item={ongoing()}
        leaveRequest={approved}
        onClose={vi.fn()}
        onLeaveRequest={onLeaveRequest}
      />,
    );
    expect(screen.queryByTestId("leave-dot")).toBeNull();
  });

  it("点击「我要请假 ＞」查看待审批申请：不写入已查看记录（待审批无红点，无需标记）", () => {
    window.localStorage.setItem("leaveSeen_lr-1", "0"); // 任意非 "1" 值，模拟未查看
    render(
      <RehearsalDetailModal
        item={ongoing()}
        leaveRequest={{ id: "lr-1", status: "pending" }}
        onClose={vi.fn()}
        onLeaveRequest={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /我要请假/ }));
    expect(window.localStorage.getItem("leaveSeen_lr-1")).toBe("0");
  });
});
