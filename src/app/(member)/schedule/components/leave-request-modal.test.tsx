// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { LeaveRequestModal } from "./leave-request-modal";
import type { RehearsalRow } from "@/types/database";

// ---- mock 用户上下文 ----
vi.mock("@/context/user-context", () => ({
  useUser: () => ({ user: { id: "u1", name: "张三" } }),
}));

// ---- mock useLeaveRequests hook（可注入 fetchMine 结果与各操作） ----
const hookMock = vi.hoisted(() => ({
  fetchMine: vi.fn(),
  create: vi.fn(),
  updateReason: vi.fn(),
  reapply: vi.fn(),
  withdraw: vi.fn(),
  uploadAttachment: vi.fn(),
  getSignedUrl: vi.fn(),
  saving: false,
}));

vi.mock("@/hooks/useLeaveRequests", () => ({
  useLeaveRequests: () => hookMock,
}));

// ---- mock Modal 捕获 closeOnOverlay ----
vi.mock("@/components/ui/Modal", () => ({
  Modal: vi.fn(({ open, children }: { open: boolean; children?: React.ReactNode }) => {
    if (!open) return null;
    return <div data-testid="leave-modal">{children}</div>;
  }),
}));

import { Modal } from "@/components/ui/Modal";

const rehearsal: RehearsalRow = {
  id: 1,
  date: null,
  end_time: "2026-08-16T16:00:00",
  location: "排练厅",
  repertoire: "排练曲目",
  sign_in_code: null,
  start_time: "2026-08-16T13:00:00",
  target_section: null,
  time: null,
  title: null,
  type: "full",
  created_at: "2026-08-01T00:00:00",
  updated_at: "2026-08-01T00:00:00",
};

function makeRequest(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

function renderModal() {
  return render(
    <LeaveRequestModal open rehearsal={rehearsal} onClose={vi.fn()} onSaved={vi.fn()} />,
  );
}

describe("LeaveRequestModal 请假申请弹窗（Issue #142）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookMock.fetchMine.mockResolvedValue([]);
    hookMock.create.mockResolvedValue(true);
    hookMock.updateReason.mockResolvedValue(true);
    hookMock.reapply.mockResolvedValue(true);
    hookMock.withdraw.mockResolvedValue(true);
    hookMock.getSignedUrl.mockResolvedValue({ url: "https://x/signed.jpg" });
  });

  afterEach(() => {
    cleanup();
  });

  it("无申请：表单模式，原因输入框高度翻倍（rows=8，Issue #148）", async () => {
    renderModal();
    await waitFor(() => expect(screen.getByRole("button", { name: "提交申请" })).toBeTruthy());
    const ta = screen.getByLabelText(/请假原因/) as HTMLTextAreaElement;
    expect(ta.rows).toBe(8);
  });

  it("无申请：表单模式，空原因提交被拦截，create 不调用", async () => {
    renderModal();
    // 等待 fetchMine 完成进入表单模式
    await waitFor(() => expect(screen.getByRole("button", { name: "提交申请" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "提交申请" }));
    expect(await screen.findByText("请填写请假原因")).toBeInTheDocument();
    expect(hookMock.create).not.toHaveBeenCalled();
  });

  it("无申请：填写原因提交成功，create 携带 excused 目标状态", async () => {
    renderModal();
    await waitFor(() => expect(screen.getByRole("button", { name: "提交申请" })).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/请假原因/), { target: { value: "家中有事" } });
    fireEvent.click(screen.getByRole("button", { name: "提交申请" }));

    await waitFor(() =>
      expect(hookMock.create).toHaveBeenCalledWith({
        rehearsal_id: 1,
        user_id: "u1",
        reason: "家中有事",
        attachment_url: null,
        target_status: "excused",
      }),
    );
  });

  it("pending：只读视图 + 待审批 chip + 修改后保存调用 updateReason", async () => {
    hookMock.fetchMine.mockResolvedValue([makeRequest()]);
    renderModal();

    await waitFor(() => expect(screen.getByText("待审批")).toBeInTheDocument());
    expect(screen.getByText("感冒发烧")).toBeInTheDocument();
    // 只读视图无提交按钮
    expect(screen.queryByRole("button", { name: "提交申请" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "修改申请" }));
    // 编辑模式：原因预填
    const ta = screen.getByLabelText(/请假原因/);
    expect(ta).toHaveValue("感冒发烧");
    fireEvent.change(ta, { target: { value: "改成新原因" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() =>
      expect(hookMock.updateReason).toHaveBeenCalledWith("lr-1", {
        reason: "改成新原因",
        attachment_url: null,
      }),
    );
  });

  it("approved：撤回 → 确认后进入新申请模式，选择目标状态提交 create（target_status 生效）", async () => {
    hookMock.fetchMine.mockResolvedValue([makeRequest({ status: "approved" })]);
    renderModal();

    await waitFor(() => expect(screen.getByText("已通过")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "撤回申请" }));
    // 撤回提示文案：考勤还原语义（未签到时恢复缺勤，已签到不受影响）
    expect(
      screen.getByText(/撤回后考勤恢复为缺勤（未签到时），已签到状态不受影响/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认撤回" }));
    // withdraw 携带被撤回的申请行（hook 据此联动还原考勤）
    await waitFor(() =>
      expect(hookMock.withdraw).toHaveBeenCalledWith(
        "lr-1",
        expect.objectContaining({ rehearsal_id: 1, user_id: "u1", target_status: "excused" }),
      ),
    );

    // 撤回后进入新申请模式：目标状态单选出现
    expect(await screen.findByText(/目标出勤状态/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "缺勤" }));
    fireEvent.change(screen.getByLabelText(/请假原因/), { target: { value: "改为缺勤" } });
    fireEvent.click(screen.getByRole("button", { name: "提交申请" }));

    await waitFor(() =>
      expect(hookMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          target_status: "absent",
          reason: "改为缺勤",
        }),
      ),
    );
  });

  it("approved 撤回后未选目标状态提交被拦截", async () => {
    hookMock.fetchMine.mockResolvedValue([makeRequest({ status: "approved" })]);
    renderModal();

    await waitFor(() => expect(screen.getByText("已通过")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "撤回申请" }));
    fireEvent.click(screen.getByRole("button", { name: "确认撤回" }));
    await waitFor(() => expect(hookMock.withdraw).toHaveBeenCalled());

    fireEvent.change(await screen.findByLabelText(/请假原因/), {
      target: { value: "想正常出勤" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交申请" }));

    expect(await screen.findByText("请选择目标出勤状态")).toBeInTheDocument();
    expect(hookMock.create).not.toHaveBeenCalled();
  });

  it("rejected：已驳回 chip + 驳回原因 + 重新申请保存调用 reapply", async () => {
    hookMock.fetchMine.mockResolvedValue([
      makeRequest({ status: "rejected", reject_reason: "理由不充分" }),
    ]);
    renderModal();

    await waitFor(() => expect(screen.getByText("已驳回")).toBeInTheDocument());
    expect(screen.getByText("理由不充分")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重新申请" }));
    expect(screen.getByLabelText(/请假原因/)).toHaveValue("感冒发烧");
    fireEvent.click(screen.getByRole("button", { name: "重新提交" }));

    await waitFor(() =>
      expect(hookMock.reapply).toHaveBeenCalledWith("lr-1", {
        reason: "感冒发烧",
        attachment_url: null,
      }),
    );
  });

  it("approved 带附件：getSignedUrl 换取签名链接并展示图片", async () => {
    hookMock.fetchMine.mockResolvedValue([
      makeRequest({ status: "approved", attachment_url: "u1/1-a.jpg" }),
    ]);
    renderModal();

    await waitFor(() => expect(hookMock.getSignedUrl).toHaveBeenCalledWith("u1/1-a.jpg"));
    expect(await screen.findByAltText("请假附件")).toBeInTheDocument();
  });

  it("提交中禁关闭（closeOnOverlay=false）", async () => {
    let resolveCreate!: (v: boolean) => void;
    hookMock.create.mockReturnValue(
      new Promise<boolean>((res) => {
        resolveCreate = res;
      }),
    );
    renderModal();
    await waitFor(() => expect(screen.getByRole("button", { name: "提交申请" })).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/请假原因/), { target: { value: "提交中" } });
    fireEvent.click(screen.getByRole("button", { name: "提交申请" }));
    await waitFor(() => expect(hookMock.create).toHaveBeenCalled());

    const calls = (Modal as unknown as Mock).mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0].closeOnOverlay).toBe(false);

    // 完成提交，等待异步流程收尾（避免卸载后 setState 警告）
    resolveCreate(true);
    await waitFor(() => expect(screen.queryByRole("button", { name: "提交中…" })).toBeNull());
  });

  it("提交中按钮文案变为提交中且禁用", async () => {
    let resolveCreate!: (v: boolean) => void;
    hookMock.create.mockReturnValue(
      new Promise<boolean>((res) => {
        resolveCreate = res;
      }),
    );
    renderModal();
    await waitFor(() => expect(screen.getByRole("button", { name: "提交申请" })).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/请假原因/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "提交申请" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "提交中…" })).toBeDisabled());
    resolveCreate(true);
    await waitFor(() => expect(screen.queryByRole("button", { name: "提交中…" })).toBeNull());
  });
});
