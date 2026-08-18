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
  /** 通过回调返回 { ok, warnings }（Issue #159 返工） */
  onApprove: (id: string) => Promise<{ ok: boolean; warnings: string[] }>;
  /** 驳回回调返回 { ok, warnings }（与通过同构，Issue #190 对抗） */
  onReject: (id: string, reason: string) => Promise<{ ok: boolean; warnings: string[] }>;
  getSignedUrl: (path: string) => Promise<string | null>;
  processing?: boolean;
};

function renderModal(props: Partial<DetailModalProps> = {}) {
  const defaults: DetailModalProps = {
    request: makeRequest(),
    onClose: vi.fn(),
    onApprove: vi.fn().mockResolvedValue({ ok: true, warnings: [] }),
    onReject: vi.fn().mockResolvedValue({ ok: true, warnings: [] }),
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
    vi.unstubAllGlobals();
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
    const onApprove = vi.fn().mockResolvedValue({ ok: true, warnings: [] });
    renderModal({ onApprove });
    fireEvent.click(screen.getByRole("button", { name: "通过" }));
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith("lr-1"));
  });

  it("通过返回 warnings：alert 逐条展示（成员已实际签到、考勤未联动，Issue #159 返工）", async () => {
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    const onApprove = vi.fn().mockResolvedValue({
      ok: true,
      warnings: ["张三已实际签到，考勤未联动", "李四已实际签到，考勤未联动"],
    });
    renderModal({ onApprove });
    fireEvent.click(screen.getByRole("button", { name: "通过" }));
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(
        "张三已实际签到，考勤未联动\n李四已实际签到，考勤未联动",
      ),
    );
  });

  it("通过无 warnings：不弹 alert（普通成功路径）", async () => {
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    const onApprove = vi.fn().mockResolvedValue({ ok: true, warnings: [] });
    renderModal({ onApprove });
    fireEvent.click(screen.getByRole("button", { name: "通过" }));
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith("lr-1"));
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("驳回：原因必填，空原因提交被拦截，填写后调用 onReject", async () => {
    const onReject = vi.fn().mockResolvedValue({ ok: true, warnings: [] });
    renderModal({ onReject });

    fireEvent.click(screen.getByRole("button", { name: "驳回" }));
    const ta = await screen.findByLabelText(/驳回原因/);
    // 审计清理：无 resize-none（可拖拽拉长），且未使用 .input 固定高度（否则 rows 失效）
    expect(ta.className).not.toContain("resize-none");
    expect(ta.className).not.toContain("input");
    fireEvent.click(screen.getByRole("button", { name: "确认驳回" }));
    expect(await screen.findByText("请填写驳回原因")).toBeInTheDocument();
    expect(onReject).not.toHaveBeenCalled();

    fireEvent.change(ta, { target: { value: "理由不充分" } });
    fireEvent.click(screen.getByRole("button", { name: "确认驳回" }));
    await waitFor(() => expect(onReject).toHaveBeenCalledWith("lr-1", "理由不充分"));
  });

  it("驳回返回 warnings（failed 未处理项等）：alert 逐条展示（Issue #190 对抗）", async () => {
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    const onReject = vi.fn().mockResolvedValue({
      ok: true,
      warnings: ["有 1 条申请未被处理：李四（申请不存在或已处理）"],
    });
    renderModal({ onReject });

    fireEvent.click(screen.getByRole("button", { name: "驳回" }));
    const ta = await screen.findByLabelText(/驳回原因/);
    fireEvent.change(ta, { target: { value: "理由不充分" } });
    fireEvent.click(screen.getByRole("button", { name: "确认驳回" }));

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith("有 1 条申请未被处理：李四（申请不存在或已处理）"),
    );
  });

  it("驳回失败（ok=false）：不弹 alert、输入框关闭且原因清空（固化既有行为，Issue #190 对抗遗留）", async () => {
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    const onReject = vi.fn().mockResolvedValue({ ok: false, warnings: [] });
    renderModal({ onReject });

    fireEvent.click(screen.getByRole("button", { name: "驳回" }));
    const ta = await screen.findByLabelText(/驳回原因/);
    fireEvent.change(ta, { target: { value: "理由不充分" } });
    fireEvent.click(screen.getByRole("button", { name: "确认驳回" }));

    await waitFor(() => expect(onReject).toHaveBeenCalledWith("lr-1", "理由不充分"));
    // warnings 仅在 ok 时弹 alert，失败不弹
    expect(alertSpy).not.toHaveBeenCalled();
    // 固化既有行为：失败也关闭输入块并清空原因（非本次回归引入；若后续 issue 要修，需同步更新此断言）
    expect(screen.queryByLabelText(/驳回原因/)).toBeNull();
    expect(screen.getByRole("button", { name: "驳回" })).toBeTruthy();
    // 重新打开输入块：原因已被清空（setRejectReason("") 生效）
    fireEvent.click(screen.getByRole("button", { name: "驳回" }));
    const reopened = await screen.findByLabelText(/驳回原因/);
    expect((reopened as HTMLTextAreaElement).value).toBe("");
  });

  it("驳回输入展开时：底部通过/驳回按钮隐藏，关闭输入后恢复（Issue #182）", async () => {
    renderModal();
    expect(screen.getByRole("button", { name: "通过" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "驳回" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "驳回" }));
    await screen.findByLabelText(/驳回原因/);
    // 底部操作行隐藏（避免与输入块内的取消/确认驳回重复）
    expect(screen.queryByRole("button", { name: "通过" })).toBeNull();
    expect(screen.queryByRole("button", { name: "驳回" })).toBeNull();

    // 取消驳回输入 → 底部操作行恢复
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByRole("button", { name: "通过" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "驳回" })).toBeTruthy();
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
    let resolveApprove!: (v: { ok: boolean; warnings: string[] }) => void;
    const onApprove = vi.fn(
      () =>
        new Promise<{ ok: boolean; warnings: string[] }>((res) => {
          resolveApprove = res;
        }),
    );
    renderModal({ onApprove });
    fireEvent.click(screen.getByRole("button", { name: "通过" }));
    await waitFor(() => expect(onApprove).toHaveBeenCalled());

    const calls = (Modal as unknown as Mock).mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0].closeOnOverlay).toBe(false);

    resolveApprove({ ok: true, warnings: [] });
    // 审批成功后父级重拉列表、本行保留（Issue #190 行不再移除，弹窗不自动关闭），
    // 弹窗保持打开渲染；此处仅收尾 resolve 后的异步状态
    await waitFor(() => expect(screen.getByTestId("detail-modal")).toBeInTheDocument());
  });
});
