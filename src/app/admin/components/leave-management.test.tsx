// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
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
    adminMock.approve.mockResolvedValue(true);
    adminMock.reject.mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
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

  it("批量驳回：原因必填，空原因拦截，填写后调用 reject（同一原因应用到全部）", async () => {
    adminMock.requests = [makeRequest({ id: "lr-1" }), makeRequest({ id: "lr-2" })];
    render(<LeaveManagement />);

    fireEvent.click(screen.getByRole("checkbox", { name: /全选/ }));
    fireEvent.click(screen.getByRole("button", { name: "批量驳回" }));

    const ta = await screen.findByPlaceholderText(/驳回原因/);
    // 空原因时确认按钮禁用
    expect(screen.getByRole("button", { name: "确认驳回" })).toBeDisabled();

    fireEvent.change(ta, { target: { value: "已另行安排" } });
    fireEvent.click(screen.getByRole("button", { name: "确认驳回" }));

    await waitFor(() =>
      expect(adminMock.reject).toHaveBeenCalledWith(["lr-1", "lr-2"], "已另行安排"),
    );
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

  it("已处理 tab：成员取消的申请显示「已取消」chip（Issue #149 保留历史）", () => {
    adminMock.requests = [
      makeRequest({ id: "lr-1", status: "approved" }),
      makeRequest({ id: "lr-2", status: "canceled", reason: "临时有事去不了" }),
    ];
    render(<LeaveManagement />);

    fireEvent.click(screen.getByRole("button", { name: "已处理" }));
    expect(screen.getByText("已取消")).toBeInTheDocument();
    // canceled 行不出现英文枚举值
    expect(screen.queryByText(/canceled/)).toBeNull();
  });

  it("加载失败显示错误横幅", () => {
    adminMock.requests = [];
    adminMock.error = "网络错误";
    render(<LeaveManagement />);
    expect(screen.getByText("网络错误")).toBeInTheDocument();
  });

  it("列表高度自适应：max-h 封顶 + overflow-y-auto，无固定高度（Issue #150）", () => {
    adminMock.requests = [makeRequest({ id: "lr-1" })];
    const { container } = render(<LeaveManagement />);

    const scrollBox = container.querySelector("div.max-h-\\[240px\\]") as HTMLElement;
    expect(scrollBox).not.toBeNull();
    expect(scrollBox.className).toContain("overflow-y-auto");
    expect(scrollBox.className.split(" ")).not.toContain("h-[240px]");
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
});
