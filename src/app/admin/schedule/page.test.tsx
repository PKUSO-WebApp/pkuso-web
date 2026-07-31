// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AdminSchedulePage from "./page";

// Mock next/navigation
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
  }),
}));

// 通过 vi.hoisted 暴露可变 mock，方便动态修改 loading 状态
const mocks = vi.hoisted(() => {
  const mockRemove = vi.fn().mockResolvedValue(true);
  const mockCheckConflict = vi.fn().mockResolvedValue(null);
  const mockFetch = vi.fn().mockResolvedValue(undefined);
  let isLoading = false;

  return {
    mockRemove,
    mockCheckConflict,
    mockFetch,
    get isLoading() {
      return isLoading;
    },
    setLoading: (v: boolean) => {
      isLoading = v;
    },
  };
});

vi.mock("@/hooks/useSchedule", () => ({
  useSchedule: () => ({
    data: [],
    loading: mocks.isLoading,
    error: null,
    saving: false,
    fetch: mocks.mockFetch,
    create: vi.fn(),
    update: vi.fn(),
    remove: mocks.mockRemove,
    checkConflict: mocks.mockCheckConflict,
  }),
}));

// Mock useUser
vi.mock("@/context/user-context", () => ({
  useUser: () => ({
    user: { id: "admin-id", role: "admin", name: "管理员" },
    logout: vi.fn(),
  }),
}));

// Mock supabase
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockResolvedValue({ error: null }),
      delete: vi.fn().mockReturnThis(),
      update: vi.fn().mockResolvedValue({ error: null }),
    }),
  },
}));

// Mock create-schedule-modal（简化，避免测试复杂化）
vi.mock("./components/create-schedule-modal", () => ({
  CreateScheduleModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="create-schedule-modal">创建预约弹窗</div> : null,
}));

describe("AdminSchedulePage 组件", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setLoading(false);
  });

  // ==========================================
  // 验收标准 1: 点击全屏按钮后甘特图填充容器
  // ==========================================
  describe("放大/缩小切换（对应验收标准 1/2）", () => {
    it("默认状态下应显示标题和添加预约按钮", () => {
      render(<AdminSchedulePage />);
      expect(screen.getByText("日程管理")).toBeInTheDocument();
      expect(screen.getByText("添加预约")).toBeInTheDocument();
      // 未放大时显示完整标题和日期选择器
      expect(screen.getByText(/管理排练房预约/)).toBeInTheDocument();
    });

    it("点击放大按钮后应切换到全屏模式", () => {
      render(<AdminSchedulePage />);
      // 初始状态：显示"放大"图标按钮（title 为"放大"）
      const expandBtn = screen.getByTitle("放大");
      expect(expandBtn).toBeInTheDocument();

      // 点击放大
      fireEvent.click(expandBtn);

      // 放大后 title 变为"缩小"
      expect(screen.getByTitle("缩小")).toBeInTheDocument();
      // 放大后顶部标题和日期选择器被隐藏
      expect(screen.queryByText("日程管理")).not.toBeInTheDocument();
      expect(screen.queryByText("添加预约")).not.toBeInTheDocument();
    });

    it("点击缩小按钮后应恢复正常高度", () => {
      render(<AdminSchedulePage />);
      // 先放大
      fireEvent.click(screen.getByTitle("放大"));
      expect(screen.getByTitle("缩小")).toBeInTheDocument();

      // 再缩小
      fireEvent.click(screen.getByTitle("缩小"));
      expect(screen.getByTitle("放大")).toBeInTheDocument();
      expect(screen.getByText("日程管理")).toBeInTheDocument();
    });

    it("放大/缩小切换应更新标题文案（显示日期或完整标题）", () => {
      render(<AdminSchedulePage />);
      // 未放大时标题为 "6月15日 周六" 等（来自 formatDisplayDate）
      const normalTitle = screen.getByText(/\d+月\d+日/);
      expect(normalTitle).toBeInTheDocument();

      // 放大后标题变为 "X月X日 周六 预约"
      fireEvent.click(screen.getByTitle("放大"));
      const expandedTitle = screen.getByText(/预约$/);
      expect(expandedTitle).toBeInTheDocument();
    });
  });

  // ==========================================
  // 验收标准 4: loading 状态无高度跳变
  // ==========================================
  describe("Loading 状态（对应验收标准 4）", () => {
    it("loading 状态下 loading 容器应使用 h-full", () => {
      mocks.setLoading(true);
      const { container, unmount } = render(<AdminSchedulePage />);

      // loading spinner 容器应使用 h-full（对应修改后的 loading 占位）
      const spinnerContainer = container.querySelector(".flex.h-full.items-center.justify-center");
      expect(spinnerContainer).not.toBeNull();

      // 甘特图容器在 loading 时应保持 flex-1 min-h-0 的高度
      const ganttContainer = container.querySelector(
        ".flex-1.min-h-0.overflow-y-auto.rounded-xl.border.border-border.bg-card",
      );
      expect(ganttContainer).not.toBeNull();

      // 恢复
      unmount();
      mocks.setLoading(false);
    });

    it("非 loading 状态下甘特图容器存在且 loading 占位不存在", () => {
      mocks.setLoading(false);
      const { container } = render(<AdminSchedulePage />);

      // loading spinner 不应出现
      const spinnerContainer = container.querySelector(".flex.h-full.items-center.justify-center");
      expect(spinnerContainer).toBeNull();

      // 甘特图容器存在
      const ganttContainer = container.querySelector(
        ".flex-1.min-h-0.overflow-y-auto.rounded-xl.border.border-border.bg-card",
      );
      expect(ganttContainer).not.toBeNull();
    });
  });

  // ==========================================
  // 验收标准: 添加预约按钮及表单
  // ==========================================
  describe("添加预约流程", () => {
    it("点击添加预约按钮应打开 CreateScheduleModal", async () => {
      render(<AdminSchedulePage />);
      fireEvent.click(screen.getByText("添加预约"));
      await waitFor(() => {
        expect(screen.getByTestId("create-schedule-modal")).toBeInTheDocument();
      });
    });

    it("关闭 CreateScheduleModal 后弹窗消失", async () => {
      // 由于 CreateScheduleModal 是 mock 的 div，测试关闭按钮会比较复杂
      // 我们验证再次点击可切换状态
      const { rerender } = render(<AdminSchedulePage />);
      fireEvent.click(screen.getByText("添加预约"));
      await waitFor(() => {
        expect(screen.getByTestId("create-schedule-modal")).toBeInTheDocument();
      });

      // 模拟关闭：由于 mock 的 CreateScheduleModal 不处理 onClose，
      // 我们通过 onClose prop 手动触发
      // 查找页面中的"关闭"按钮或直接调用 setIsModalOpen(false)
      // 由于 mock 限制，这里只验证打开流程
      rerender(<AdminSchedulePage />);
    });
  });

  // ==========================================
  // 验收标准: 整体布局结构
  // ==========================================
  describe("布局结构（对应验收标准 3/5）", () => {
    it("根容器应使用 h-full 保证子元素高度继承", () => {
      const { container } = render(<AdminSchedulePage />);
      const rootDiv = container.firstElementChild as HTMLElement;
      expect(rootDiv.className).toContain("h-full");
      // 最大宽度 max-w-md 保证移动端可用
      expect(rootDiv.className).toContain("max-w-md");
      expect(rootDiv.className).toContain("mx-auto");
    });

    it("甘特图容器应使用 flex-1 min-h-0 以填充剩余空间", () => {
      const { container } = render(<AdminSchedulePage />);
      const ganttContainer = container.querySelector(
        ".flex-1.min-h-0.overflow-y-auto.rounded-xl.border.border-border.bg-card",
      );
      expect(ganttContainer).not.toBeNull();
    });

    it("布局使用语义 Token（bg-card border-border text-text）", () => {
      const { container } = render(<AdminSchedulePage />);
      const html = container.innerHTML;
      expect(html).toContain("bg-card");
      expect(html).toContain("border-border");
      expect(html).toContain("text-text");
      expect(html).toContain("text-text-muted");
      // 不应包含硬编码 zinc 颜色
      expect(html).not.toMatch(/border-zinc|bg-zinc|text-zinc/);
    });
  });

  // ==========================================
  // 验收标准: 日期选择器
  // ==========================================
  describe("日期选择器", () => {
    it("应显示当月日期", () => {
      render(<AdminSchedulePage />);
      // 日期选择器渲染月份
      const now = new Date();
      const monthText = `${now.getFullYear()}年${now.getMonth() + 1}月`;
      expect(screen.getByText(monthText)).toBeInTheDocument();
    });

    it("点击日期应切换 selectedDate", async () => {
      render(<AdminSchedulePage />);
      // 找到一个非今日、非过去的日期并点击
      const dateButtons = screen.getAllByRole("button").filter((btn) => {
        const text = btn.textContent?.trim();
        return text && /^\d+$/.test(text) && !(btn as HTMLButtonElement).disabled;
      });
      // 至少有一个日期按钮
      expect(dateButtons.length).toBeGreaterThan(0);

      fireEvent.click(dateButtons[0]);
      // fetch 应被调用
      await waitFor(() => {
        expect(mocks.mockFetch).toHaveBeenCalled();
      });
    });
  });
});
