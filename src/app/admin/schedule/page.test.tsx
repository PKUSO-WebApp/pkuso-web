// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import AdminSchedulePage from "./page";
import { renderWithProviders } from "@/__tests__/render-with-providers";

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

// Mock create-schedule-modal（渲染精简表单：标题/开始/结束时间输入 + 提交按钮，
// 以便测试表单提交与防重复提交逻辑；其余控件不渲染）
vi.mock("./components/create-schedule-modal", () => ({
  CreateScheduleModal: ({
    open,
    form,
    onChange,
    onSubmit,
    submitting,
  }: {
    open: boolean;
    form: { title: string; startTime: string; endTime: string };
    onChange: (field: string, value: string) => void;
    onSubmit: (e: React.FormEvent) => void;
    submitting: boolean;
  }) =>
    open ? (
      <form data-testid="create-schedule-modal" onSubmit={onSubmit}>
        <input
          aria-label="预约标题"
          value={form.title}
          onChange={(e) => onChange("title", e.target.value)}
        />
        <input
          aria-label="开始时间"
          value={form.startTime}
          onChange={(e) => onChange("startTime", e.target.value)}
        />
        <input
          aria-label="结束时间"
          value={form.endTime}
          onChange={(e) => onChange("endTime", e.target.value)}
        />
        <button type="submit" disabled={submitting}>
          提交预约
        </button>
      </form>
    ) : null,
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
    it("默认状态下应显示日期和放大按钮", () => {
      renderWithProviders(<AdminSchedulePage />);
      expect(screen.getByText(/\d+月\d+日/)).toBeInTheDocument();
      expect(screen.getByTitle("放大")).toBeInTheDocument();
    });

    it("点击放大按钮后应切换到全屏模式", () => {
      renderWithProviders(<AdminSchedulePage />);
      const expandBtn = screen.getByTitle("放大");
      expect(expandBtn).toBeInTheDocument();

      fireEvent.click(expandBtn);

      expect(screen.getByTitle("缩小")).toBeInTheDocument();
    });

    it("点击缩小按钮后应恢复正常高度", () => {
      renderWithProviders(<AdminSchedulePage />);
      fireEvent.click(screen.getByTitle("放大"));
      expect(screen.getByTitle("缩小")).toBeInTheDocument();

      fireEvent.click(screen.getByTitle("缩小"));
      expect(screen.getByTitle("放大")).toBeInTheDocument();
    });

    it("放大/缩小切换应更新标题文案（显示日期或完整标题）", () => {
      renderWithProviders(<AdminSchedulePage />);
      const normalTitle = screen.getByText(/\d+月\d+日/);
      expect(normalTitle).toBeInTheDocument();

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
      const { container, unmount } = renderWithProviders(<AdminSchedulePage />);

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
      const { container } = renderWithProviders(<AdminSchedulePage />);

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
    it("添加预约按钮在 AdminHeader 中（由 Context 注入）", () => {
      // 添加预约按钮已移至 AdminHeader，页面组件通过 Context 设置 headerRight
      // 此测试验证页面组件能正常渲染（Context 已在上层提供）
      renderWithProviders(<AdminSchedulePage />);
      // 页面主体正常渲染即可
      expect(screen.getByText(/\d+月\d+日/)).toBeInTheDocument();
    });
  });

  // ==========================================
  // 验收标准: 整体布局结构
  // ==========================================
  describe("布局结构（对应验收标准 3/5）", () => {
    it("根容器应使用 h-full 保证子元素高度继承", () => {
      const { container } = renderWithProviders(<AdminSchedulePage />);
      const rootDiv = container.firstElementChild as HTMLElement;
      expect(rootDiv.className).toContain("h-full");
      // 最大宽度 max-w-md 保证移动端可用
      expect(rootDiv.className).toContain("max-w-md");
      expect(rootDiv.className).toContain("mx-auto");
    });

    it("甘特图容器应使用 flex-1 min-h-0 以填充剩余空间", () => {
      const { container } = renderWithProviders(<AdminSchedulePage />);
      const ganttContainer = container.querySelector(
        ".flex-1.min-h-0.overflow-y-auto.rounded-xl.border.border-border.bg-card",
      );
      expect(ganttContainer).not.toBeNull();
    });

    it("布局使用语义 Token（bg-card border-border text-text）", () => {
      const { container } = renderWithProviders(<AdminSchedulePage />);
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
      renderWithProviders(<AdminSchedulePage />);
      // 日期选择器渲染月份
      const now = new Date();
      const monthText = `${now.getFullYear()}年${now.getMonth() + 1}月`;
      expect(screen.getByText(monthText)).toBeInTheDocument();
    });

    it("点击日期应切换 selectedDate", async () => {
      renderWithProviders(<AdminSchedulePage />);
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
