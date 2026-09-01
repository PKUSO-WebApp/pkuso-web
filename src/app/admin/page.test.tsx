// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import AdminPage from "./page";
import { formatDateTimeInChina } from "@/lib/date-utils";

// ---- Mock Modal 组件以检查 position prop ----
vi.mock("@/components/ui/Modal", () => ({
  Modal: vi.fn(
    ({
      open,
      title,
      children,
      position,
    }: {
      open: boolean;
      title?: string;
      children?: React.ReactNode;
      position?: string;
    }) => {
      if (!open) return null;
      return (
        <div data-testid={`modal-${title ?? "untitled"}`} data-position={position}>
          {title && <h2>{title}</h2>}
          {children}
        </div>
      );
    },
  ),
}));

// ---- Mock AnnouncementListModal ----
vi.mock("./components/announcement-list-modal", () => ({
  AnnouncementListModal: vi.fn(() => null),
}));

// ---- Mock useProfiles hook ----
vi.mock("@/hooks/useProfiles", () => ({
  useProfiles: vi.fn(),
}));

// ---- Mock useAnnouncements hook ----
vi.mock("@/hooks/useAnnouncements", () => ({
  useAnnouncements: vi.fn(),
}));

// ---- Mock useLeaveAdmin hook（请假审批区块，Issue #142）----
vi.mock("@/hooks/useLeaveAdmin", () => ({
  useLeaveAdmin: vi.fn(),
}));

import { useProfiles } from "@/hooks/useProfiles";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import { useLeaveAdmin } from "@/hooks/useLeaveAdmin";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Modal } from "@/components/ui/Modal";

const mockProfiles = (overrides: Record<string, unknown> = {}) => {
  const defaultReturn = {
    data: [
      {
        id: "user-1",
        full_name: "张三",
        instrument: "第一小提琴",
        email: "zhangsan@example.com",
        created_at: "2024-07-31T14:30:00Z",
        status: "pending",
      },
    ],
    loading: false,
    saving: false,
    error: null,
    approve: vi.fn().mockResolvedValue(true),
    reject: vi.fn().mockResolvedValue(true),
    approveAll: vi.fn().mockResolvedValue(true),
    rejectAll: vi.fn().mockResolvedValue(true),
    fetch: vi.fn(),
  };
  (useProfiles as unknown as Mock).mockReturnValue({ ...defaultReturn, ...overrides });
};

const mockAnnouncements = (overrides: Record<string, unknown> = {}) => {
  const defaultReturn = {
    data: null,
    allData: [],
    loading: true,
    loadingAll: false,
    error: null,
    publishing: false,
    deletingId: null,
    updatingId: null,
    fetch: vi.fn(),
    fetchAll: vi.fn(),
    getActive: vi.fn().mockResolvedValue(null),
    publish: vi.fn().mockResolvedValue(true),
    remove: vi.fn().mockResolvedValue(true),
    update: vi.fn().mockResolvedValue(true),
  };
  (useAnnouncements as unknown as Mock).mockReturnValue({ ...defaultReturn, ...overrides });
};

const mockLeaveAdmin = (overrides: Record<string, unknown> = {}) => {
  const defaultReturn = {
    requests: [],
    loading: false,
    error: null,
    processing: false,
    fetch: vi.fn(),
    // approve/reject 返回值形态：{ ok, warnings }（Issue #159 返工 / #190 对抗）
    approve: vi.fn().mockResolvedValue({ ok: true, warnings: [] }),
    reject: vi.fn().mockResolvedValue({ ok: true, warnings: [] }),
    getSignedUrl: vi.fn().mockResolvedValue(null),
  };
  (useLeaveAdmin as unknown as Mock).mockReturnValue({ ...defaultReturn, ...overrides });
};

describe("AdminPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProfiles();
    mockAnnouncements();
    mockLeaveAdmin();
  });

  it("注册时间使用 formatDateTimeInChina 显示（时区转换）", () => {
    const created_at = "2024-07-31T14:30:00Z"; // UTC 14:30 = 北京时间 22:30
    mockProfiles({
      data: [
        {
          id: "user-1",
          full_name: "张三",
          instrument: "第一小提琴",
          email: "zhangsan@example.com",
          created_at,
          status: "pending",
        },
      ],
    });

    render(<AdminPage />);

    // 验证时间显示为中国时区
    const expected = formatDateTimeInChina(created_at);
    expect(
      screen.getByText(new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))),
    ).toBeInTheDocument();
  });

  it("注册时间显示跨日边界（UTC 23:30 → 中国次日）", () => {
    const created_at = "2024-07-31T23:30:00Z"; // UTC 23:30 = 北京时间次日 07:30
    mockProfiles({
      data: [
        {
          id: "user-1",
          full_name: "张三",
          instrument: "第一小提琴",
          email: "zhangsan@example.com",
          created_at,
          status: "pending",
        },
      ],
    });

    render(<AdminPage />);

    const expected = formatDateTimeInChina(created_at);
    expect(
      screen.getByText(new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))),
    ).toBeInTheDocument();
  });

  it("确认拒绝弹窗使用底部弹出（position=bottom）", async () => {
    render(<AdminPage />);

    // 点击"❌ 拒绝"按钮（单个用户的拒绝按钮，区别于"全部拒绝"）
    fireEvent.click(screen.getByRole("button", { name: /❌\s*拒绝/ }));

    // 等待 Modal 出现
    const modal = await screen.findByTestId("modal-untitled");
    // position 应为 "bottom"
    expect(modal).toHaveAttribute("data-position", "bottom");
  });

  it("批量操作确认弹窗使用底部弹出", async () => {
    render(<AdminPage />);

    // 点击"全部批准"按钮
    fireEvent.click(screen.getByRole("button", { name: /全部批准/ }));

    // 等待 Modal 出现
    const modal = await screen.findByTestId("modal-untitled");
    expect(modal).toHaveAttribute("data-position", "bottom");
    // 确认弹窗内容
    expect(modal).toHaveTextContent("确认全部批准");
  });

  it("批量拒绝确认弹窗使用底部弹出", async () => {
    render(<AdminPage />);

    // 点击"全部拒绝"按钮
    fireEvent.click(screen.getByRole("button", { name: /全部拒绝/ }));

    // 等待 Modal 出现
    const modal = await screen.findByTestId("modal-untitled");
    expect(modal).toHaveAttribute("data-position", "bottom");
    // 确认弹窗内容
    expect(modal).toHaveTextContent("确认全部拒绝");
  });

  it("批量操作期间防止重复提交", async () => {
    let batchApproveResolve!: (value: boolean) => void;
    const batchApprovePromise = new Promise<boolean>((resolve) => {
      batchApproveResolve = resolve;
    });
    const approveAllMock = vi.fn().mockReturnValue(batchApprovePromise);
    mockProfiles({ approveAll: approveAllMock });

    render(<AdminPage />);

    // 点击"全部批准"
    fireEvent.click(screen.getByRole("button", { name: /全部批准/ }));

    // 在确认弹窗中点击"确认"
    fireEvent.click(await screen.findByRole("button", { name: /^确认$/ }));

    // 此时 isBatchSubmitting 为 true，按钮文本变为"处理中…"且被禁用
    const processingBtn = await screen.findByRole("button", { name: /处理中/ });
    expect(processingBtn).toBeDisabled();

    // 再次点击应无效（不会重复调用 approveAll）
    fireEvent.click(processingBtn);

    // 解决 Promise
    batchApproveResolve(true);

    await waitFor(() => {
      expect(approveAllMock).toHaveBeenCalledTimes(1);
    });
  });

  it("单个审批防止重复提交", async () => {
    let approveResolve!: (value: boolean) => void;
    const approvePromise = new Promise<boolean>((resolve) => {
      approveResolve = resolve;
    });
    const approveMock = vi.fn().mockReturnValue(approvePromise);
    mockProfiles({ approve: approveMock });

    render(<AdminPage />);

    // 查询批准按钮（单个用户）
    const approveBtn = screen.getByRole("button", { name: /✅\s*批准/ });

    // 第一次点击
    fireEvent.click(approveBtn);

    // 按钮文本应变为"处理中…"且被禁用
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /处理中/ })).toBeDisabled();
    });

    // 再次点击（通过变量引用，避免因文本变更找不到元素）
    fireEvent.click(approveBtn);

    // 解决 Promise
    approveResolve(true);

    await waitFor(() => {
      expect(approveMock).toHaveBeenCalledTimes(1);
    });
  });

  it("发布公告防止重复提交（双击只发布一次）", async () => {
    let publishResolve!: (value: boolean) => void;
    const publishPromise = new Promise<boolean>((resolve) => {
      publishResolve = resolve;
    });
    const publishMock = vi.fn().mockReturnValue(publishPromise);
    mockAnnouncements({ publish: publishMock });

    const { container } = render(<AdminPage />);

    // 切到公告 tab，填写标题 / 结束日期 / 内容
    fireEvent.click(screen.getByRole("tab", { name: /^公告$/ }));
    fireEvent.change(screen.getByPlaceholderText(/新学期排练安排/), {
      target: { value: "测试标题" },
    });
    fireEvent.change(container.querySelector('input[type="date"]')!, {
      target: { value: "2026-09-01" },
    });
    fireEvent.change(container.querySelector('input[type="time"]')!, {
      target: { value: "14:30" },
    });
    fireEvent.change(screen.getByPlaceholderText(/输入公告内容/), {
      target: { value: "测试公告" },
    });

    // 双击发布按钮（无 await 间隔，state 未更新，仅 ref 同步 guard 生效）
    const publishBtn = screen.getByRole("button", { name: /^发布$/ });
    fireEvent.click(publishBtn);
    fireEvent.click(publishBtn);

    // 解决 Promise
    publishResolve(true);

    await waitFor(() => {
      expect(publishMock).toHaveBeenCalledTimes(1);
    });
    // 结束时间包含所选时分
    expect(publishMock.mock.calls[0][2]).toMatch(/2026-09-01T14:30/);
  });

  it("存在未结束公告时，发布需先确认提前结束（弹出确认且不立即发布）", async () => {
    const activeAnnouncement = {
      id: "old-1",
      title: "旧公告标题",
      content: "旧公告内容",
      created_at: "2026-08-01T10:00:00Z",
      end_time: "2026-09-01T23:59:59",
    };
    const getActiveMock = vi.fn().mockResolvedValue(activeAnnouncement);
    const publishMock = vi.fn().mockResolvedValue(true);
    const updateMock = vi.fn().mockResolvedValue(true);
    mockAnnouncements({ getActive: getActiveMock, publish: publishMock, update: updateMock });

    const { container } = render(<AdminPage />);

    fireEvent.click(screen.getByRole("tab", { name: /^公告$/ }));
    fireEvent.change(screen.getByPlaceholderText(/新学期排练安排/), {
      target: { value: "新公告标题" },
    });
    fireEvent.change(container.querySelector('input[type="date"]')!, {
      target: { value: "2026-09-10" },
    });
    fireEvent.change(screen.getByPlaceholderText(/输入公告内容/), {
      target: { value: "新公告内容" },
    });

    fireEvent.click(screen.getByRole("button", { name: /^发布$/ }));

    // 弹出确认：是否提前结束被覆盖公告
    await waitFor(() => {
      expect(screen.getByText(/是否要提前结束公告「旧公告标题」/)).toBeInTheDocument();
    });
    // 尚未发布
    expect(publishMock).not.toHaveBeenCalled();

    // 点击确认
    fireEvent.click(screen.getByRole("button", { name: /^确认$/ }));

    await waitFor(() => {
      // 先提前结束旧公告（end_time 改为现在）
      expect(updateMock).toHaveBeenCalledTimes(1);
      expect(updateMock).toHaveBeenCalledWith(
        "old-1",
        "旧公告标题",
        "旧公告内容",
        expect.any(String),
      );
      // 再发布新公告
      expect(publishMock).toHaveBeenCalledTimes(1);
      expect(publishMock).toHaveBeenCalledWith("新公告标题", "新公告内容", expect.any(String));
    });
  });

  it("存在未结束公告时，取消确认则不发布", async () => {
    const activeAnnouncement = {
      id: "old-1",
      title: "旧公告标题",
      content: "旧公告内容",
      created_at: "2026-08-01T10:00:00Z",
      end_time: "2026-09-01T23:59:59",
    };
    const getActiveMock = vi.fn().mockResolvedValue(activeAnnouncement);
    const publishMock = vi.fn().mockResolvedValue(true);
    mockAnnouncements({ getActive: getActiveMock, publish: publishMock });

    const { container } = render(<AdminPage />);

    fireEvent.click(screen.getByRole("tab", { name: /^公告$/ }));
    fireEvent.change(screen.getByPlaceholderText(/新学期排练安排/), {
      target: { value: "新公告标题" },
    });
    fireEvent.change(container.querySelector('input[type="date"]')!, {
      target: { value: "2026-09-10" },
    });
    fireEvent.change(screen.getByPlaceholderText(/输入公告内容/), {
      target: { value: "新公告内容" },
    });

    fireEvent.click(screen.getByRole("button", { name: /^发布$/ }));

    await waitFor(() => {
      expect(screen.getByText(/是否要提前结束公告「旧公告标题」/)).toBeInTheDocument();
    });

    // 点击取消
    fireEvent.click(screen.getByRole("button", { name: /^取消$/ }));

    await waitFor(() => {
      expect(screen.queryByText(/是否要提前结束公告/)).toBeNull();
    });
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("tab 切换：aria-selected 随点击变化（Issue #150）", () => {
    render(<AdminPage />);

    // 默认 mock 有 1 个 pending 用户 → 入团审批 tab 带红点徽章 "1"，用宽松正则匹配
    const approvalTab = screen.getByRole("tab", { name: /入团审批/ });
    const leaveTab = screen.getByRole("tab", { name: /请假审批/ });
    const announcementTab = screen.getByRole("tab", { name: /^公告$/ });

    // 初始：入团审批为活动 tab
    expect(approvalTab).toHaveAttribute("aria-selected", "true");
    expect(leaveTab).toHaveAttribute("aria-selected", "false");
    expect(announcementTab).toHaveAttribute("aria-selected", "false");

    // 切到请假审批：aria-selected 转移
    fireEvent.click(leaveTab);
    expect(approvalTab).toHaveAttribute("aria-selected", "false");
    expect(leaveTab).toHaveAttribute("aria-selected", "true");
    expect(announcementTab).toHaveAttribute("aria-selected", "false");

    // 切到公告
    fireEvent.click(announcementTab);
    expect(approvalTab).toHaveAttribute("aria-selected", "false");
    expect(leaveTab).toHaveAttribute("aria-selected", "false");
    expect(announcementTab).toHaveAttribute("aria-selected", "true");

    // 切回入团审批
    fireEvent.click(approvalTab);
    expect(approvalTab).toHaveAttribute("aria-selected", "true");
    expect(leaveTab).toHaveAttribute("aria-selected", "false");
    expect(announcementTab).toHaveAttribute("aria-selected", "false");
  });

  it("tab 切换：非活动面板容器带 hidden 类，切换后转移（Issue #150）", () => {
    render(<AdminPage />);

    // 三面板常驻挂载（hidden 仅由 className 控制，@testing-library 不过滤 display:none，
    // 因此必须断言 hidden 类本身，而非文本是否存在于 DOM）
    const approvalPanel = screen
      .getByRole("heading", { name: /入团审批 · 待处理/ })
      .closest("section")!;
    // 请假区块的 hidden 容器是 LeaveManagement 根 section 的外层 div
    const leavePanel = screen
      .getByRole("heading", { name: /^请假审批$/ })
      .closest("section")!.parentElement!;
    const announcementPanel = screen
      .getByRole("heading", { name: /^发布全团公告$/ })
      .closest("section")!;

    // 初始：仅入团审批面板不带 hidden
    expect(approvalPanel).not.toHaveClass("hidden");
    expect(leavePanel).toHaveClass("hidden");
    expect(announcementPanel).toHaveClass("hidden");
    expect(approvalPanel).toHaveTextContent(/入团审批 · 待处理/);

    // 切到请假审批：hidden 从请假面板移除，转移到入团审批面板
    fireEvent.click(screen.getByRole("tab", { name: /请假审批/ }));
    expect(approvalPanel).toHaveClass("hidden");
    expect(leavePanel).not.toHaveClass("hidden");
    expect(announcementPanel).toHaveClass("hidden");
    // 请假列表空态（默认 mock 无申请）
    expect(screen.getByText("暂无待审批申请")).toBeInTheDocument();

    // 切到公告：hidden 转移到请假面板，公告面板显示发布表单
    fireEvent.click(screen.getByRole("tab", { name: /^公告$/ }));
    expect(approvalPanel).toHaveClass("hidden");
    expect(leavePanel).toHaveClass("hidden");
    expect(announcementPanel).not.toHaveClass("hidden");
    expect(screen.getByPlaceholderText(/输入公告内容/)).toBeInTheDocument();

    // 切回入团审批：hidden 再次转移
    fireEvent.click(screen.getByRole("tab", { name: /入团审批/ }));
    expect(approvalPanel).not.toHaveClass("hidden");
    expect(leavePanel).toHaveClass("hidden");
    expect(announcementPanel).toHaveClass("hidden");
  });

  it("入团审批 tab 红点：pending>0 显示数字，=0 不显示（Issue #150）", () => {
    mockProfiles({
      data: [
        {
          id: "user-1",
          full_name: "张三",
          instrument: "第一小提琴",
          email: "zhangsan@example.com",
          created_at: "2024-07-31T14:30:00Z",
          status: "pending",
        },
        {
          id: "user-2",
          full_name: "李四",
          instrument: "第二小提琴",
          email: "lisi@example.com",
          created_at: "2024-07-31T14:30:00Z",
          status: "pending",
        },
      ],
    });
    const { unmount } = render(<AdminPage />);

    const approvalTab = screen.getByRole("tab", { name: /入团审批/ });
    expect(within(approvalTab).getByText("2")).toBeInTheDocument();

    // pending = 0 时红点不显示
    unmount();
    mockProfiles({ data: [] });
    render(<AdminPage />);
    const approvalTabEmpty = screen.getByRole("tab", { name: /^入团审批$/ });
    expect(within(approvalTabEmpty).queryByText(/^\d+$/)).toBeNull();
  });

  it("请假审批 tab 红点显示待审批申请数（Issue #150）", async () => {
    mockLeaveAdmin({
      requests: [
        {
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
        },
      ],
    });
    render(<AdminPage />);

    const leaveTab = await screen.findByRole("tab", { name: /请假审批/ });
    // 待审批数经 onPendingCountChange 回调实时上报
    expect(within(leaveTab).getByText("1")).toBeInTheDocument();
  });

  it("控制台三个可滚动容器统一 max-h-[400px]（Issue #156）", () => {
    const { container } = render(<AdminPage />);

    // 入团审批列表：max-h-[400px] 封顶 + overflow-y-auto，无固定高度
    // （leave 区块列表在同组件测试内断言；此处 mock 无申请不渲染，selector 唯一命中入团审批）
    const approvalBox = container.querySelector("section div.max-h-\\[400px\\]") as HTMLElement;
    expect(approvalBox).not.toBeNull();
    expect(approvalBox.className).toContain("overflow-y-auto");
    expect(approvalBox.className.split(" ")).not.toContain("h-[400px]");

    // 公告撰写输入框：textarea 同样 max-h-[400px] 封顶
    const announcementTextarea = container.querySelector(
      "textarea.max-h-\\[400px\\]",
    ) as HTMLElement;
    expect(announcementTextarea).not.toBeNull();
    // 审计清理：无 resize-none（可拖拽拉长，max-h 内部滚动可共存）
    expect(announcementTextarea.className).not.toContain("resize-none");
  });

  it("根容器 flex 化（矮屏布局）：头部固定、tab 栏 + 面板整体独立滚动（审计批次 3）", () => {
    const { container } = render(<AdminPage />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("h-full");
    expect(root.className).toContain("flex-col");
    // tab 栏 + 三个面板所在的滚动容器
    const scrollArea = container.querySelector(
      "div.flex-1.min-h-0.overflow-y-auto",
    ) as HTMLElement | null;
    expect(scrollArea).not.toBeNull();
  });
});
