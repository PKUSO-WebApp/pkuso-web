// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import AttendanceRequestsPage from "./page";
import { renderWithProviders } from "@/__tests__/render-with-providers";
import type { AttendanceChangeRequestWithDetails } from "@/types/database";

const h = vi.hoisted(() => ({
  requests: [] as AttendanceChangeRequestWithDetails[],
  loading: false,
  error: null as string | null,
  processing: false,
  fetch: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
}));

vi.mock("@/hooks/useAttendanceChangeRequests", () => ({
  useAttendanceChangeRequests: () => h,
}));

vi.mock("@/components/ui/Modal", () => ({
  Modal: ({
    open,
    title,
    children,
  }: {
    open: boolean;
    title?: string;
    children?: React.ReactNode;
  }) => (open ? <div data-testid={`modal-${title}`}>{children}</div> : null),
}));

function makeRequest(
  overrides: Partial<AttendanceChangeRequestWithDetails> = {},
): AttendanceChangeRequestWithDetails {
  return {
    id: "req-1",
    rehearsal_id: 1,
    target_user_id: "u1",
    requested_by: "u2",
    from_status: "absent",
    to_status: "present",
    reason: "临时请假",
    status: "pending",
    decided_by: null,
    decided_at: null,
    reject_reason: null,
    created_at: "2026-10-24T10:00:00Z",
    updated_at: "2026-10-24T10:00:00Z",
    target: { full_name: "张三", instrument: "第一小提琴" },
    requester: { full_name: "李四", instrument: "中提琴" },
    rehearsals: {
      repertoire: "贝多芬第五交响曲",
      title: null,
      start_time: "2026-10-24T19:00:00",
      end_time: null,
      type: "full",
      target_section: null,
    },
    ...overrides,
  };
}

describe("考勤修改申请审批页（P4'）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.requests = [];
    h.loading = false;
    h.error = null;
    h.processing = false;
    h.approve.mockResolvedValue({
      ok: true,
      results: [{ id: "req-1", ok: true, status: "approved" }],
    });
    h.reject.mockResolvedValue({
      ok: true,
      results: [{ id: "req-1", ok: true, status: "rejected" }],
    });
  });

  afterEach(cleanup);

  it("待审批列表显示成员、排练、状态变化与理由", () => {
    h.requests = [makeRequest()];
    renderWithProviders(<AttendanceRequestsPage />);

    expect(screen.getByText("张三（第一小提琴）")).toBeInTheDocument();
    expect(screen.getByText(/贝多芬第五交响曲/)).toBeInTheDocument();
    expect(screen.getByText("缺勤 → 出席")).toBeInTheDocument();
    expect(screen.getByText("理由：临时请假")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "待审批 (1)" })).toBeInTheDocument();
  });

  it("勾选后批量通过：确认弹窗 → 调 approve(ids, false)", async () => {
    h.requests = [makeRequest()];
    renderWithProviders(<AttendanceRequestsPage />);

    fireEvent.click(screen.getByRole("checkbox", { name: /选择 张三/ }));
    fireEvent.click(screen.getByRole("button", { name: "批量通过" }));
    fireEvent.click(screen.getByRole("button", { name: "确认通过" }));

    await waitFor(() => {
      expect(h.approve).toHaveBeenCalledWith(["req-1"], false);
    });
  });

  it("stale 时弹窗列出当前状态，强制通过才带 force=true", async () => {
    h.requests = [makeRequest()];
    h.approve
      .mockResolvedValueOnce({
        ok: true,
        results: [{ id: "req-1", ok: false, code: "stale", currentStatus: "present" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        results: [{ id: "req-1", ok: true, status: "approved" }],
      });
    renderWithProviders(<AttendanceRequestsPage />);

    fireEvent.click(screen.getByRole("checkbox", { name: /选择 张三/ }));
    fireEvent.click(screen.getByRole("button", { name: "批量通过" }));
    fireEvent.click(screen.getByRole("button", { name: "确认通过" }));

    expect(await screen.findByText(/当前 出席/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "强制通过 1 条" }));

    await waitFor(() => {
      expect(h.approve).toHaveBeenNthCalledWith(2, ["req-1"], true);
    });
  });

  it("批量驳回：原因必填，提交同一原因", async () => {
    h.requests = [makeRequest()];
    renderWithProviders(<AttendanceRequestsPage />);

    fireEvent.click(screen.getByRole("checkbox", { name: /选择 张三/ }));
    fireEvent.click(screen.getByRole("button", { name: "批量驳回" }));
    fireEvent.click(screen.getByRole("button", { name: "确认驳回" }));

    expect(screen.getByText("请填写驳回原因")).toBeInTheDocument();
    expect(h.reject).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText("请填写驳回原因"), {
      target: { value: "材料不全" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认驳回" }));

    await waitFor(() => {
      expect(h.reject).toHaveBeenCalledWith(["req-1"], "材料不全");
    });
  });

  it("已处理 tab 只显示审批结果，不显示勾选框", () => {
    h.requests = [
      makeRequest({
        status: "rejected",
        reject_reason: "材料不全",
        decided_by: "admin-1",
        decided_at: "2026-10-24T11:00:00Z",
        decider: { full_name: "管理员" },
      }),
      makeRequest({ id: "req-2", status: "canceled" }),
    ];
    renderWithProviders(<AttendanceRequestsPage />);

    fireEvent.click(screen.getByRole("button", { name: "已处理 (1)" }));

    expect(screen.getByText("已驳回")).toBeInTheDocument();
    expect(screen.getByText("驳回原因：材料不全")).toBeInTheDocument();
    expect(screen.getByText(/审批人：管理员/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
