// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { LeaveDetailModal } from "./leave-detail-modal";
import type { LeaveRequestWithDetails } from "@/types/database";

// ---- mock Modal 捕获 closeOnOverlay ----
vi.mock("@/components/ui/Modal", () => ({
  Modal: vi.fn(({ open, children }: { open: boolean; children?: React.ReactNode }) => {
    if (!open) return null;
    return <div data-testid="detail-modal">{children}</div>;
  }),
}));

import { Modal } from "@/components/ui/Modal";

function makeRequest(overrides: Record<string, unknown> = {}): LeaveRequestWithDetails {
  return {
    id: "lr-1",
    rehearsal_id: 1,
    user_id: "u1",
    reason: "感冒发烧，无法参加排练",
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

type DetailModalProps = {
  request: LeaveRequestWithDetails | null;
  onClose: () => void;
  onApprove: (id: string) => Promise<boolean>;
  onReject: (id: string, reason: string) => Promise<boolean>;
  getSignedUrl: (path: string) => Promise<string | null>;
  processing?: boolean;
};

function renderModal(props: Partial<DetailModalProps> = {}) {
  const defaults: DetailModalProps = {
    request: makeRequest(),
    onClose: vi.fn(),
    onApprove: vi.fn().mockResolvedValue(true),
    onReject: vi.fn().mockResolvedValue(true),
    getSignedUrl: vi.fn().mockResolvedValue("https://x/signed.jpg"),
    processing: false,
  };
  return render(<LeaveDetailModal {...defaults} {...props} />);
}

describe("LeaveDetailModal 请假详情弹窗（管理端）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("pending：展示成员/排练/原因，底部有通过与驳回按钮", () => {
    renderModal();
    expect(screen.getByText("张三")).toBeInTheDocument();
    expect(screen.getByText("第一小提琴")).toBeInTheDocument();
    expect(screen.getByText("排练曲目")).toBeInTheDocument();
    expect(screen.getByText("感冒发烧，无法参加排练")).toBeInTheDocument();
    expect(screen.getByText("待审批")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "通过" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "驳回" })).toBeTruthy();
  });

  it("点击通过 → onApprove 以该申请 id 调用", async () => {
    const onApprove = vi.fn().mockResolvedValue(true);
    renderModal({ onApprove });
    fireEvent.click(screen.getByRole("button", { name: "通过" }));
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith("lr-1"));
  });

  it("驳回：原因必填，空原因提交被拦截，填写后调用 onReject", async () => {
    const onReject = vi.fn().mockResolvedValue(true);
    renderModal({ onReject });

    fireEvent.click(screen.getByRole("button", { name: "驳回" }));
    const ta = await screen.findByLabelText(/驳回原因/);
    fireEvent.click(screen.getByRole("button", { name: "确认驳回" }));
    expect(await screen.findByText("请填写驳回原因")).toBeInTheDocument();
    expect(onReject).not.toHaveBeenCalled();

    fireEvent.change(ta, { target: { value: "理由不充分" } });
    fireEvent.click(screen.getByRole("button", { name: "确认驳回" }));
    await waitFor(() => expect(onReject).toHaveBeenCalledWith("lr-1", "理由不充分"));
  });

  it("approved：无通过/驳回按钮，显示已通过 chip", () => {
    renderModal({ request: makeRequest({ status: "approved" }) });
    expect(screen.getByText("已通过")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "通过" })).toBeNull();
    expect(screen.queryByRole("button", { name: "驳回" })).toBeNull();
  });

  it("rejected：显示驳回原因", () => {
    renderModal({
      request: makeRequest({ status: "rejected", reject_reason: "信息不完整" }),
    });
    expect(screen.getByText("已驳回")).toBeInTheDocument();
    expect(screen.getByText("信息不完整")).toBeInTheDocument();
  });

  it("带附件：getSignedUrl 换取签名链接并展示图片", async () => {
    const getSignedUrl = vi.fn().mockResolvedValue("https://x/signed.jpg");
    renderModal({
      request: makeRequest({ attachment_url: "u1/1-a.jpg" }),
      getSignedUrl,
    });
    await waitFor(() => expect(getSignedUrl).toHaveBeenCalledWith("u1/1-a.jpg"));
    expect(await screen.findByAltText("请假附件")).toBeInTheDocument();
  });

  it("审批中禁关闭（closeOnOverlay=false）", async () => {
    let resolveApprove!: (v: boolean) => void;
    const onApprove = vi.fn(
      () =>
        new Promise<boolean>((res) => {
          resolveApprove = res;
        }),
    );
    renderModal({ onApprove });
    fireEvent.click(screen.getByRole("button", { name: "通过" }));
    await waitFor(() => expect(onApprove).toHaveBeenCalled());

    const calls = (Modal as unknown as Mock).mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0].closeOnOverlay).toBe(false);

    resolveApprove(true);
    // 等待父级移除行（request 变 null 关闭）后的异步收尾
    await waitFor(() => expect((Modal as unknown as Mock).mock.calls.length).toBeGreaterThan(0));
  });
});
