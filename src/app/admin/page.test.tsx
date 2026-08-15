// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
    approve: vi.fn().mockResolvedValue(true),
    reject: vi.fn().mockResolvedValue(true),
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
});
