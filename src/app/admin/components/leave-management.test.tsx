// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { LeaveManagement } from "./leave-management";
import type { LeaveRequestWithDetails } from "@/types/database";

// ---- mock useLeaveAdmin hook ----
const adminMock = vi.hoisted(() => ({
  requests: [] as LeaveRequestWithDetails[],
  loading: false,
  error: null as string | null,
  processing: false,
  fetch: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  getSignedUrl: vi.fn(),
}));

vi.mock("@/hooks/useLeaveAdmin", () => ({
  useLeaveAdmin: () => adminMock,
}));

// ---- mock Modal（渲染 children，供弹窗交互） ----
vi.mock("@/components/ui/Modal", () => ({
  Modal: vi.fn(({ open, children }: { open: boolean; children?: React.ReactNode }) => {
    if (!open) return null;
    return <div>{children}</div>;
  }),
}));

// ---- mock 详情弹窗，断言 props ----
vi.mock("./leave-detail-modal", () => ({
  LeaveDetailModal: vi.fn(() => null),
}));

import { LeaveDetailModal } from "./leave-detail-modal";

function makeRequest(overrides: Record<string, unknown> = {}): LeaveRequestWithDetails {
  return {
    id: "lr-1",
    rehearsal_id: 1,
    user_id: "u1",
    reason: "感冒发烧",
    attachment_url: null,
    target_status: "excused",
    status: "pending",
    reject_reason: null,
    created_at: "2026-08-15T10:00:00Z",
    updated_at: "2026-08-15T10:00:00Z",
    profiles: { full_name: "张三", instrument: "第一小提琴" },
    rehearsals: {
      repertoire: "排练曲目",
      title: null,
      start_time: "2026-08-16T13:00:00",
      end_time: "2026-08-16T16:00:00",
      location: "排练厅",
    },
    ...overrides,
  };
}

describe("LeaveManagement 请假审批区块（管理端）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adminMock.requests = [];
    adminMock.loading = false;
    adminMock.error = null;
    adminMock.processing = false;
    // approve/reject 返回值形态：{ ok, warnings }（Issue #159 返工 / #190 对抗）
    adminMock.approve.mockResolvedValue({ ok: true, warnings: [] });
    adminMock.reject.mockResolvedValue({ ok: true, warnings: [] });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("待审批列表显示成员姓名+乐器、排练曲目+时间、原因摘要", () => {
    adminMock.requests = [
      makeRequest({
        reason: "感冒发烧需要休息一下，很长很长的原因摘要只会显示一行",
      }),
    ];
    render(<LeaveManagement />);

    expect(screen.getByText("张三")).toBeInTheDocument();
    expect(screen.getByText("第一小提琴")).toBeInTheDocument();
    expect(screen.getByText(/排练曲目/)).toBeInTheDocument();
    expect(screen.getByText(/感冒发烧/)).toBeInTheDocument();
    expect(screen.getByText(/待审批\(1\)/)).toBeInTheDocument();
  });

  it("勾选单项出现批量操作栏；全选选中全部", () => {
    adminMock.requests = [
      makeRequest({ id: "lr-1" }),
      makeRequest({ id: "lr-2", reason: "另一条" }),
    ];
    render(<LeaveManagement />);

    // 初始无批量操作栏
    expect(screen.queryByRole("button", { name: "批量通过" })).toBeNull();

    // 勾选列表第一项（checkboxes[0] 是「全选」，[1] 起才是列表项）
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]);
    expect(screen.getByRole("button", { name: "批量通过" })).toBeTruthy();
    expect(screen.getByText(/全选（1\/2）/)).toBeTruthy();

    // 全选
    fireEvent.click(screen.getByRole("checkbox", { name: /全选/ }));
    expect(screen.getByText(/全选（2\/2）/)).toBeTruthy();
  });

  it("批量通过：二次确认后调用 approve（全部勾选 id）", async () => {
    adminMock.requests = [makeRequest({ id: "lr-1" }), makeRequest({ id: "lr-2" })];
    render(<LeaveManagement />);

    fireEvent.click(screen.getByRole("checkbox", { name: /全选/ }));
    fireEvent.click(screen.getByRole("button", { name: "批量通过" }));

    expect(await screen.findByText("确认批量通过")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认通过" }));

    await waitFor(() => expect(adminMock.approve).toHaveBeenCalledWith(["lr-1", "lr-2"]));
    // 确认弹窗关闭
    await waitFor(() => expect(screen.queryByText("确认批量通过")).toBeNull());
  });

  it("批量通过返回 warnings：alert 逐条展示（成员已实际签到、考勤未联动，Issue #159 返工）", async () => {
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    adminMock.approve.mockResolvedValue({
      ok: true,
      warnings: ["张三已实际签到，考勤未联动", "李四已实际签到，考勤未联动"],
    });
    adminMock.requests = [makeRequest({ id: "lr-1" }), makeRequest({ id: "lr-2" })];
    render(<LeaveManagement />);

    fireEvent.click(screen.getByRole("checkbox", { name: /全选/ }));
    fireEvent.click(screen.getByRole("button", { name: "批量通过" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认通过" }));

    // warnings 逐条用换行连接展示
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(
        "张三已实际签到，考勤未联动\n李四已实际签到，考勤未联动",
      ),
    );
  });

  it("批量通过无 warnings：不弹 alert（普通成功路径）", async () => {
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    adminMock.requests = [makeRequest({ id: "lr-1" })];
    render(<LeaveManagement />);

    fireEvent.click(screen.getByRole("checkbox", { name: /全选/ }));
    fireEvent.click(screen.getByRole("button", { name: "批量通过" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认通过" }));

    await waitFor(() => expect(adminMock.approve).toHaveBeenCalledWith(["lr-1"]));
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("详情弹窗 onApprove 透传 approve 结果（含 warnings，Issue #159 返工）", async () => {
    adminMock.approve.mockResolvedValue({
      ok: true,
      warnings: ["成员已实际签到，考勤未联动"],
    });
    adminMock.requests = [makeRequest({ id: "lr-1" })];
    render(<LeaveManagement />);

    fireEvent.click(screen.getByText("张三"));

    await waitFor(async () => {
      const calls = (LeaveDetailModal as unknown as Mock).mock.calls;
      const lastCall = calls[calls.length - 1];
      const onApprove = lastCall[0].onApprove as (id: string) => Promise<unknown>;
      const res = await onApprove("lr-1");
      expect(res).toEqual({ ok: true, warnings: ["成员已实际签到，考勤未联动"] });
    });
  });

  it("批量驳回：原因必填，空原因拦截，填写后调用 reject（同一原因应用到全部）", async () => {
    adminMock.requests = [makeRequest({ id: "lr-1" }), makeRequest({ id: "lr-2" })];
    render(<LeaveManagement />);

    fireEvent.click(screen.getByRole("checkbox", { name: /全选/ }));
    fireEvent.click(screen.getByRole("button", { name: "批量驳回" }));

    const ta = await screen.findByPlaceholderText(/驳回原因/);
    // 审计清理：无 resize-none（可拖拽拉长），且未使用 .input 固定高度（否则 rows 失效）
    expect(ta.className).not.toContain("resize-none");
    expect(ta.className).not.toContain("input");
    // 空原因时确认按钮禁用
    expect(screen.getByRole("button", { name: "确认驳回" })).toBeDisabled();

    fireEvent.change(ta, { target: { value: "已另行安排" } });
    fireEvent.click(screen.getByRole("button", { name: "确认驳回" }));

    await waitFor(() =>
      expect(adminMock.reject).toHaveBeenCalledWith(["lr-1", "lr-2"], "已另行安排"),
    );
  });

  it("批量驳回返回 warnings（failed 未处理项等）：alert 逐条展示（Issue #190 对抗）", async () => {
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    adminMock.reject.mockResolvedValue({
      ok: true,
      warnings: ["有 1 条申请未被处理：李四（申请不存在或已处理）"],
    });
    adminMock.requests = [makeRequest({ id: "lr-1" })];
    render(<LeaveManagement />);

    fireEvent.click(screen.getByRole("checkbox", { name: /全选/ }));
    fireEvent.click(screen.getByRole("button", { name: "批量驳回" }));
    const ta = await screen.findByPlaceholderText(/驳回原因/);
    fireEvent.change(ta, { target: { value: "已另行安排" } });
    fireEvent.click(screen.getByRole("button", { name: "确认驳回" }));

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith("有 1 条申请未被处理：李四（申请不存在或已处理）"),
    );
  });

  it("详情弹窗审批后行保留：重拉后弹窗保持打开并展示已通过 chip（Issue #190）", () => {
    adminMock.approve.mockResolvedValue({ ok: true, warnings: [] });
    adminMock.requests = [makeRequest({ id: "lr-1" })];
    const { rerender } = render(<LeaveManagement />);

    fireEvent.click(screen.getByText("张三"));
    let calls = (LeaveDetailModal as unknown as Mock).mock.calls;
    expect(calls[calls.length - 1][0].request).toMatchObject({ id: "lr-1", status: "pending" });

    // 审批成功后父级重拉列表：行保留（不再移除），状态更新为已通过
    adminMock.requests = [makeRequest({ id: "lr-1", status: "approved" })];
    rerender(<LeaveManagement />);

    calls = (LeaveDetailModal as unknown as Mock).mock.calls;
    const lastCall = calls[calls.length - 1];
    // 弹窗保持打开（request 非 null）且展示最新状态 chip
    expect(lastCall[0].request).toMatchObject({ id: "lr-1", status: "approved" });
  });

  it("点击列表项打开详情弹窗（传递该申请）", async () => {
    adminMock.requests = [makeRequest({ id: "lr-1" })];
    render(<LeaveManagement />);

    fireEvent.click(screen.getByText("张三"));

    await waitFor(() => {
      const calls = (LeaveDetailModal as unknown as Mock).mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall[0].request).toMatchObject({ id: "lr-1" });
      expect(lastCall[0].open === undefined || lastCall[0].open === true).toBe(true);
    });
  });

  it("切换到已处理 tab：显示已处理列表与状态 chip，无勾选与批量操作栏", () => {
    adminMock.requests = [
      makeRequest({ id: "lr-1", status: "approved" }),
      makeRequest({ id: "lr-2", status: "rejected" }),
    ];
    render(<LeaveManagement />);

    // 待审批 tab 为空
    expect(screen.getByText("暂无待审批申请")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "已处理" }));
    expect(screen.getByText("已通过")).toBeInTheDocument();
    expect(screen.getByText("已驳回")).toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "批量通过" })).toBeNull();
  });

  it("已处理列表仅含 approved/rejected，不含 withdrawn/canceled（Issue #190）", () => {
    adminMock.requests = [
      makeRequest({ id: "lr-1", status: "approved" }),
      makeRequest({ id: "lr-2", status: "rejected" }),
      makeRequest({ id: "lr-3", status: "canceled", reason: "临时有事去不了" }),
      makeRequest({ id: "lr-4", status: "withdrawn", reason: "改期了" }),
    ];
    render(<LeaveManagement />);

    fireEvent.click(screen.getByRole("button", { name: "已处理" }));

    // 已通过/已驳回正常展示；撤回/取消的申请不进入已处理列表（不显示中文标签与枚举原文）
    expect(screen.getByText("已通过")).toBeInTheDocument();
    expect(screen.getByText("已驳回")).toBeInTheDocument();
    expect(screen.queryByText("已取消")).toBeNull();
    expect(screen.queryByText("已撤回")).toBeNull();
    expect(screen.queryByText(/canceled/)).toBeNull();
    expect(screen.queryByText(/withdrawn/)).toBeNull();
  });

  it("withdrawn/canceled 行不显示在任何 tab（待审批/已处理都无，Issue #190）", () => {
    adminMock.requests = [
      makeRequest({ id: "lr-1", status: "canceled" }),
      makeRequest({ id: "lr-2", status: "withdrawn" }),
    ];
    render(<LeaveManagement />);

    // 待审批 tab：无 pending 行
    expect(screen.getByText("暂无待审批申请")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "已处理" }));
    expect(screen.getByText("暂无已处理申请")).toBeInTheDocument();
  });

  it("加载失败显示错误横幅", () => {
    adminMock.requests = [];
    adminMock.error = "网络错误";
    render(<LeaveManagement />);
    expect(screen.getByText("网络错误")).toBeInTheDocument();
  });

  it("列表高度自适应：max-h-[400px] 封顶 + overflow-y-auto，无固定高度（Issue #156）", () => {
    adminMock.requests = [makeRequest({ id: "lr-1" })];
    const { container } = render(<LeaveManagement />);

    const scrollBox = container.querySelector("div.max-h-\\[400px\\]") as HTMLElement;
    expect(scrollBox).not.toBeNull();
    expect(scrollBox.className).toContain("overflow-y-auto");
    expect(scrollBox.className.split(" ")).not.toContain("h-[400px]");
  });

  it("待审批数变化时回调 onPendingCountChange（供控制台 tab 红点计数，Issue #150）", () => {
    adminMock.requests = [
      makeRequest({ id: "lr-1" }),
      makeRequest({ id: "lr-2", status: "approved" }),
    ];
    const onChange = vi.fn();
    render(<LeaveManagement onPendingCountChange={onChange} />);

    // 只有 pending 状态计入
    expect(onChange).toHaveBeenCalledWith(1);
  });

  // ---- 请假/补请假分类筛选（Issue #156） ----
  // 排练时间用相对 now 的时间戳构造，避免测试随运行日期漂移

  it("分类筛选：未结束排练的申请=请假、已结束排练=补请假，全部/请假/补请假正确分组", () => {
    const futureEnd = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const pastEnd = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    adminMock.requests = [
      makeRequest({
        id: "lr-1",
        reason: "未来排练请假",
        rehearsals: {
          repertoire: "未来曲目",
          title: null,
          start_time: futureEnd,
          end_time: futureEnd,
          location: "排练厅",
        },
      }),
      makeRequest({
        id: "lr-2",
        reason: "已结束排练补请",
        rehearsals: {
          repertoire: "历史曲目",
          title: null,
          start_time: pastEnd,
          end_time: pastEnd,
          location: "排练厅",
        },
      }),
    ];
    render(<LeaveManagement />);

    // 默认「全部」：两条都显示
    expect(screen.getByText(/未来排练请假/)).toBeInTheDocument();
    expect(screen.getByText(/已结束排练补请/)).toBeInTheDocument();

    // 「补请假」：只剩已结束排练的申请
    fireEvent.click(screen.getByRole("button", { name: "补请假" }));
    expect(screen.queryByText(/未来排练请假/)).toBeNull();
    expect(screen.getByText(/已结束排练补请/)).toBeInTheDocument();

    // 「请假」：只剩未结束排练的申请
    fireEvent.click(screen.getByRole("button", { name: "请假" }));
    expect(screen.getByText(/未来排练请假/)).toBeInTheDocument();
    expect(screen.queryByText(/已结束排练补请/)).toBeNull();

    // 切回「全部」：两条都显示
    fireEvent.click(screen.getByRole("button", { name: "全部" }));
    expect(screen.getByText(/未来排练请假/)).toBeInTheDocument();
    expect(screen.getByText(/已结束排练补请/)).toBeInTheDocument();
  });

  it("end_time 缺失时按 start_time+3h 兜底判断分类", () => {
    // 5 小时前开始、无 end_time → start+3h 已过 → 补请假
    const olderStart = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    // 1 小时前开始、无 end_time → start+3h 未到 → 请假
    const recentStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    adminMock.requests = [
      makeRequest({
        id: "lr-1",
        reason: "较早开始",
        rehearsals: {
          repertoire: "曲目A",
          title: null,
          start_time: olderStart,
          end_time: null,
          location: "排练厅",
        },
      }),
      makeRequest({
        id: "lr-2",
        reason: "较晚开始",
        rehearsals: {
          repertoire: "曲目B",
          title: null,
          start_time: recentStart,
          end_time: null,
          location: "排练厅",
        },
      }),
    ];
    render(<LeaveManagement />);

    fireEvent.click(screen.getByRole("button", { name: "补请假" }));
    expect(screen.getByText(/较早开始/)).toBeInTheDocument();
    expect(screen.queryByText(/较晚开始/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "请假" }));
    expect(screen.queryByText(/较早开始/)).toBeNull();
    expect(screen.getByText(/较晚开始/)).toBeInTheDocument();
  });

  it("每条申请显示分类 chip：未结束=请假、已结束=补请假", () => {
    const futureEnd = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const pastEnd = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    adminMock.requests = [
      makeRequest({
        id: "lr-1",
        rehearsals: {
          repertoire: "曲目A",
          title: null,
          start_time: futureEnd,
          end_time: futureEnd,
          location: "排练厅",
        },
      }),
      makeRequest({
        id: "lr-2",
        rehearsals: {
          repertoire: "曲目B",
          title: null,
          start_time: pastEnd,
          end_time: pastEnd,
          location: "排练厅",
        },
      }),
    ];
    render(<LeaveManagement />);

    // checkboxes[0] 是「全选」，[1]/[2] 是列表行；行内应含对应分类 chip
    const checkboxes = screen.getAllByRole("checkbox");
    const futureRow = checkboxes[1].closest("div") as HTMLElement;
    const pastRow = checkboxes[2].closest("div") as HTMLElement;
    expect(within(futureRow).getByText("请假")).toBeInTheDocument();
    expect(within(pastRow).getByText("补请假")).toBeInTheDocument();
  });

  it("切换分类筛选清空勾选；全选仅选中当前筛选下的行", () => {
    const futureEnd = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const pastEnd = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    adminMock.requests = [
      makeRequest({
        id: "lr-1",
        rehearsals: {
          repertoire: "曲目A",
          title: null,
          start_time: futureEnd,
          end_time: futureEnd,
          location: "排练厅",
        },
      }),
      makeRequest({
        id: "lr-2",
        rehearsals: {
          repertoire: "曲目B",
          title: null,
          start_time: pastEnd,
          end_time: pastEnd,
          location: "排练厅",
        },
      }),
    ];
    render(<LeaveManagement />);

    // 勾选第一行 → 批量操作栏出现
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]);
    expect(screen.getByRole("button", { name: "批量通过" })).toBeTruthy();

    // 切换分类 → 勾选清空（批量操作栏消失）
    fireEvent.click(screen.getByRole("button", { name: "补请假" }));
    expect(screen.queryByRole("button", { name: "批量通过" })).toBeNull();

    // 「补请假」下全选 → 只选中该分类下的 1 行
    fireEvent.click(screen.getByRole("checkbox", { name: /全选/ }));
    expect(screen.getByText(/全选（1\/1）/)).toBeTruthy();
  });

  it("分类筛选无匹配时提示「该分类下暂无申请」", () => {
    const pastEnd = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    adminMock.requests = [
      makeRequest({
        id: "lr-1",
        rehearsals: {
          repertoire: "曲目A",
          title: null,
          start_time: pastEnd,
          end_time: pastEnd,
          location: "排练厅",
        },
      }),
    ];
    render(<LeaveManagement />);

    // 「请假」分类下无匹配（只有补请假），提示区别于「暂无待审批申请」
    fireEvent.click(screen.getByRole("button", { name: "请假" }));
    expect(screen.getByText("该分类下暂无申请")).toBeInTheDocument();
    expect(screen.queryByText("暂无待审批申请")).toBeNull();
  });
});
