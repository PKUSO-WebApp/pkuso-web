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
  cancelRequest: vi.fn(),
  uploadAttachment: vi.fn(),
  getSignedUrl: vi.fn(),
  saving: false,
}));

vi.mock("@/hooks/useLeaveRequests", () => ({
  useLeaveRequests: () => hookMock,
}));

// ---- mock Modal：渲染 children 与 headerExtra（状态 chip 位于标题区，Issue #182） ----
vi.mock("@/components/ui/Modal", () => ({
  Modal: vi.fn(
    ({
      open,
      children,
      headerExtra,
    }: {
      open: boolean;
      children?: React.ReactNode;
      headerExtra?: React.ReactNode;
    }) => {
      if (!open) return null;
      return (
        <div data-testid="leave-modal">
          {headerExtra && <div data-testid="modal-header-extra">{headerExtra}</div>}
          {children}
        </div>
      );
    },
  ),
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
  updated_fields: null,
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
    hookMock.cancelRequest.mockResolvedValue(true);
    hookMock.uploadAttachment.mockResolvedValue({ url: "u1/123-new.jpg" });
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
    // 审计清理：无 resize-none（可拖拽拉长），且未使用 .input 固定高度（否则 rows 失效）
    expect(ta.className).not.toContain("resize-none");
    expect(ta.className).not.toContain("input");
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

  it("pending：只读视图 + 待审批 chip + 底部「状态 chip/编辑申请」进入编辑模式保存调用 updateReason", async () => {
    hookMock.fetchMine.mockResolvedValue([makeRequest()]);
    renderModal();

    await waitFor(() => expect(screen.getByText("待审批")).toBeInTheDocument());
    expect(screen.getByText("感冒发烧")).toBeInTheDocument();
    // 只读视图无提交按钮；底部操作行左侧为状态 chip（非交互 span，替代原「已提交」与
    // 左上角状态区）+ 右侧「编辑申请」后续操作（Issue #173/#175）
    expect(screen.queryByRole("button", { name: "提交申请" })).toBeNull();
    expect(screen.queryByRole("button", { name: "已提交" })).toBeNull();
    expect(screen.queryByRole("button", { name: "待审批" })).toBeNull(); // chip 是 span，非按钮
    expect(screen.getByText(/申请于/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "编辑申请" }));
    // 编辑模式：原因预填
    const ta = screen.getByLabelText(/请假原因/);
    expect(ta).toHaveValue("感冒发烧");
    fireEvent.change(ta, { target: { value: "改成新原因" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() =>
      expect(hookMock.updateReason).toHaveBeenCalledWith("lr-1", {
        reason: "改成新原因",
        attachment_url: null,
        old_attachment_url: null,
      }),
    );
  });

  it("approved：状态 chip 在标题栏右侧，无底部操作行、无撤回/关闭入口（Issue #182）", async () => {
    const onClose = vi.fn();
    hookMock.fetchMine.mockResolvedValue([makeRequest({ status: "approved" })]);
    render(<LeaveRequestModal open rehearsal={rehearsal} onClose={onClose} onSaved={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("已通过")).toBeInTheDocument());
    // 状态 chip 位于标题栏右侧（headerExtra），状态只保留这一处（Issue #175/#182）
    expect(screen.getByTestId("modal-header-extra")).toContainElement(screen.getByText("已通过"));
    expect(screen.queryByRole("button", { name: "已提交" })).toBeNull();
    // 无底部操作行：无「关闭」「编辑申请」「重新申请」「撤回申请」按钮（撤回已下线）
    expect(screen.queryByRole("button", { name: "关闭" })).toBeNull();
    expect(screen.queryByRole("button", { name: "编辑申请" })).toBeNull();
    expect(screen.queryByRole("button", { name: "重新申请" })).toBeNull();
    expect(screen.queryByRole("button", { name: "撤回申请" })).toBeNull();
  });

  it("rejected：已驳回 chip + 驳回原因 + 底部「状态 chip/重新申请」保存调用 reapply", async () => {
    hookMock.fetchMine.mockResolvedValue([
      makeRequest({ status: "rejected", reject_reason: "理由不充分" }),
    ]);
    renderModal();

    await waitFor(() => expect(screen.getByText("已驳回")).toBeInTheDocument());
    expect(screen.getByText("理由不充分")).toBeInTheDocument();
    // 底部操作行（Issue #173/#175）：左侧状态 chip「已驳回」+ 右侧「重新申请」
    expect(screen.getByText("已驳回")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "已提交" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "重新申请" }));
    expect(screen.getByLabelText(/请假原因/)).toHaveValue("感冒发烧");
    fireEvent.click(screen.getByRole("button", { name: "重新提交" }));

    await waitFor(() =>
      expect(hookMock.reapply).toHaveBeenCalledWith("lr-1", {
        reason: "感冒发烧",
        attachment_url: null,
        old_attachment_url: null,
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

  // ---- 编辑模式附件（Issue #149）----

  it("编辑模式：显示当前附件签名 URL 预览 + 更换图片/移除附件入口", async () => {
    hookMock.fetchMine.mockResolvedValue([
      makeRequest({ status: "pending", attachment_url: "u1/1-a.jpg" }),
    ]);
    renderModal();

    await waitFor(() => expect(screen.getByText("待审批")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "编辑申请" }));

    // 编辑模式为旧附件生成签名 URL 预览
    expect(await screen.findByAltText("当前附件")).toBeInTheDocument();
    expect(screen.getByText("更换图片")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移除附件" })).toBeTruthy();
  });

  it("编辑模式更换图片：上传新附件并携带旧附件路径保存（换图删旧附件）", async () => {
    hookMock.fetchMine.mockResolvedValue([
      makeRequest({ status: "pending", attachment_url: "u1/1-a.jpg" }),
    ]);
    const { container } = renderModal();

    await waitFor(() => expect(screen.getByText("待审批")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "编辑申请" }));
    await screen.findByAltText("当前附件");

    // 通过「更换图片」的文件输入选新图（编辑模式仅渲染这一个 file input）
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(fileInput).toBeTruthy();
    fireEvent.change(fileInput, {
      target: { files: [new File([""], "new.jpg", { type: "image/jpeg" })] },
    });
    expect(await screen.findByAltText("附件预览")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() =>
      expect(hookMock.updateReason).toHaveBeenCalledWith("lr-1", {
        reason: "感冒发烧",
        attachment_url: "u1/123-new.jpg",
        old_attachment_url: "u1/1-a.jpg",
      }),
    );
  });

  // ---- 取消请假（Issue #149）----

  it("取消请假：编辑模式底部操作行左侧入口 + 内联确认 → cancelRequest → 关闭弹窗并刷新卡片", async () => {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    hookMock.fetchMine.mockResolvedValue([makeRequest()]);
    render(<LeaveRequestModal open rehearsal={rehearsal} onClose={onClose} onSaved={onSaved} />);

    await waitFor(() => expect(screen.getByText("待审批")).toBeInTheDocument());
    // 只读视图无取消入口，进入编辑模式后出现
    expect(screen.queryByRole("button", { name: "取消请假" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "编辑申请" }));
    expect(screen.getByRole("button", { name: "取消请假" })).toBeTruthy();

    // 内联确认（项目既有撤回确认同款模式）
    fireEvent.click(screen.getByRole("button", { name: "取消请假" }));
    expect(screen.getByText(/确认取消该请假申请/)).toBeInTheDocument();
    // 确认块位于底部操作行上方（Issue #182：先确认、后操作）
    const confirmBlock = screen.getByText(/确认取消该请假申请/).closest("div")!;
    const actionRow = screen.getByRole("button", { name: "保存修改" }).parentElement!;
    expect(
      confirmBlock.compareDocumentPosition(actionRow) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认取消" }));

    await waitFor(() =>
      expect(hookMock.cancelRequest).toHaveBeenCalledWith(
        "lr-1",
        expect.objectContaining({ id: "lr-1", attachment_url: null }),
      ),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("取消请假确认可反悔：点确认块「取消」不调用 cancelRequest", async () => {
    hookMock.fetchMine.mockResolvedValue([makeRequest()]);
    renderModal();

    await waitFor(() => expect(screen.getByText("待审批")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "编辑申请" }));
    fireEvent.click(screen.getByRole("button", { name: "取消请假" }));
    // pending 编辑模式底部操作行左侧已是「取消请假」，确认块内仅剩一个「取消」（反悔）
    const cancelButtons = screen.getAllByRole("button", { name: "取消" });
    expect(cancelButtons).toHaveLength(1);
    fireEvent.click(cancelButtons[0]);

    expect(hookMock.cancelRequest).not.toHaveBeenCalled();
    // 确认块关闭，入口按钮恢复
    expect(screen.getByRole("button", { name: "取消请假" })).toBeTruthy();
  });

  it("取消中防重复提交：按钮禁用并显示取消中，cancelRequest 仅调用一次", async () => {
    let resolveCancel!: (v: boolean) => void;
    hookMock.cancelRequest.mockReturnValue(
      new Promise<boolean>((res) => {
        resolveCancel = res;
      }),
    );
    hookMock.fetchMine.mockResolvedValue([makeRequest()]);
    renderModal();

    await waitFor(() => expect(screen.getByText("待审批")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "编辑申请" }));
    fireEvent.click(screen.getByRole("button", { name: "取消请假" }));
    fireEvent.click(screen.getByRole("button", { name: "确认取消" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "取消中…" })).toBeDisabled());
    expect(hookMock.cancelRequest).toHaveBeenCalledTimes(1);
    // 完成取消，等待异步流程收尾
    resolveCancel(true);
    await waitFor(() => expect(screen.queryByRole("button", { name: "取消中…" })).toBeNull());
  });

  it("已取消的申请：打开即为表单模式（视同无申请，可重新提交）", async () => {
    hookMock.fetchMine.mockResolvedValue([makeRequest({ status: "canceled" })]);
    renderModal();

    await waitFor(() => expect(screen.getByRole("button", { name: "提交申请" })).toBeTruthy());
    expect(screen.queryByText("已取消")).toBeNull();
  });

  // ---- 底部操作行重构（Issue #173）----

  it("无申请表单模式：取消移到右下角与提交同级（取消无底色、提交有底色），点击取消关闭弹窗", async () => {
    const onClose = vi.fn();
    render(<LeaveRequestModal open rehearsal={rehearsal} onClose={onClose} onSaved={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "提交申请" })).toBeTruthy());
    const cancelBtn = screen.getByRole("button", { name: "取消" });
    const submitBtn = screen.getByRole("button", { name: "提交申请" });
    // 同一行且右对齐（右下角，与提交同级；对齐 community 编辑弹窗样式）
    expect(cancelBtn.parentElement!.className).toContain("justify-end");
    // 取消无底色、提交有底色
    expect(cancelBtn.className).not.toContain("bg-primary");
    expect(cancelBtn.className).not.toContain("bg-surface");
    expect(submitBtn.className).toContain("bg-primary");
    fireEvent.click(cancelBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("pending 编辑模式底部为「取消请假 + 保存修改」，无独立整行取消请假按钮", async () => {
    hookMock.fetchMine.mockResolvedValue([makeRequest()]);
    renderModal();
    await waitFor(() => expect(screen.getByText("待审批")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "编辑申请" }));
    // 底部操作行左侧为「取消请假」（无底色、text-danger）；独立整行入口已移除，
    // 「取消请假」按钮全文档仅底部行那一个（Issue #175）
    const cancelLeaveBtn = screen.getByRole("button", { name: "取消请假" });
    expect(cancelLeaveBtn.className).not.toContain("bg-primary");
    expect(cancelLeaveBtn.className).toContain("text-danger");
    expect(screen.getAllByRole("button", { name: "取消请假" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "取消" })).toBeNull();
    expect(screen.getByRole("button", { name: "保存修改" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "返回" })).toBeNull();
  });

  it("rejected 编辑模式底部左侧仍为「取消」（重新申请无取消请假入口）", async () => {
    hookMock.fetchMine.mockResolvedValue([
      makeRequest({ status: "rejected", reject_reason: "理由不充分" }),
    ]);
    renderModal();
    await waitFor(() => expect(screen.getByText("已驳回")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "重新申请" }));
    const cancelBtn = screen.getByRole("button", { name: "取消" });
    expect(cancelBtn.className).not.toContain("bg-primary");
    expect(screen.queryByRole("button", { name: "取消请假" })).toBeNull();
    expect(screen.getByRole("button", { name: "重新提交" })).toBeTruthy();
  });
});

describe("只读视图布局（Issue #175/#182）", () => {
  const cases: { status: string; label: string }[] = [
    { status: "pending", label: "待审批" },
    { status: "approved", label: "已通过" },
    { status: "rejected", label: "已驳回" },
  ];

  it.each(cases)(
    "$label：状态 chip 为 span 且位于标题栏右侧（headerExtra），「申请于」容器右对齐（justify-end）",
    async ({ status, label }) => {
      hookMock.fetchMine.mockResolvedValue([
        makeRequest({ status, reject_reason: status === "rejected" ? "理由不充分" : null }),
      ]);
      renderModal();

      await waitFor(() => expect(screen.getByText(label)).toBeInTheDocument());
      // 无「已提交」chip；状态只保留标题栏右侧这一处（Issue #175）
      expect(screen.queryByRole("button", { name: "已提交" })).toBeNull();

      // 状态 chip 为 span（非交互，非 button），位于标题栏 headerExtra 容器内（Issue #182）
      const chip = screen.getByText(label);
      expect(chip.tagName).toBe("SPAN");
      expect(screen.getByTestId("modal-header-extra")).toContainElement(chip);

      // 「申请于」日期右对齐（flex justify-end），左侧无其他元素
      const appliedAt = screen.getByText(/申请于/);
      expect(appliedAt.parentElement!.className).toContain("justify-end");
    },
  );

  it.each([
    { status: "pending", label: "待审批", action: "编辑申请" },
    { status: "rejected", label: "已驳回", action: "重新申请" },
  ])(
    "$label：底部操作行右对齐（justify-end），仅单个主操作「$action」（Issue #182）",
    async ({ status, action }) => {
      hookMock.fetchMine.mockResolvedValue([
        makeRequest({ status, reject_reason: status === "rejected" ? "理由不充分" : null }),
      ]);
      renderModal();

      await waitFor(() => expect(screen.getByRole("button", { name: action })).toBeInTheDocument());
      const btn = screen.getByRole("button", { name: action });
      // 底部操作行右对齐且只有这一个按钮（状态 chip 已移至标题栏，不占操作行）
      expect(btn.parentElement!.className).toContain("justify-end");
      expect(btn.parentElement!.children).toHaveLength(1);
      // 无其他主操作按钮（approved 才有的「关闭」也不存在）
      expect(screen.queryByRole("button", { name: "关闭" })).toBeNull();
    },
  );
});
