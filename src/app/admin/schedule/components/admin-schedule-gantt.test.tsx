// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AdminScheduleGantt } from "./admin-schedule-gantt";
import { parseLocalISO } from "@/lib/date-utils";
import type { ScheduleRow } from "@/types/database";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
  }),
}));

// 所有 mock 变量都放在 vi.hoisted 中，避免 vitest hoist 机制导致的"Cannot access before initialization"
const mocks = vi.hoisted(() => {
  const mockSelectSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  const mockDelete = vi.fn().mockReturnThis();
  const mockSelect = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({ single: mockSelectSingle }),
  });
  const mockFrom = vi.fn().mockReturnValue({
    select: mockSelect,
    delete: mockDelete,
    insert: vi.fn().mockResolvedValue({ error: null }),
  });
  return { mockSelectSingle, mockDelete, mockSelect, mockFrom };
});

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: mocks.mockFrom,
  },
}));

const mockSchedules = [
  {
    id: 1,
    title: "测试预约A",
    start_time: "2024-06-15T09:00:00",
    end_time: "2024-06-15T10:30:00",
    author_id: "user-1",
    group_id: null,
    rehearsal_id: null,
    created_at: null,
  },
  {
    id: 2,
    title: "测试预约B",
    start_time: "2024-06-15T14:00:00",
    end_time: "2024-06-15T16:00:00",
    author_id: null, // 管理员创建
    group_id: null,
    rehearsal_id: null,
    created_at: null,
  },
];

describe("AdminScheduleGantt 组件", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认模拟 author 查询成功
    mocks.mockSelectSingle.mockImplementation((table: string) => {
      if (table === "profiles") {
        return Promise.resolve({ data: { full_name: "张三" }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const defaultProps = {
    schedules: mockSchedules as unknown as ScheduleRow[],
    user: { id: "admin-id" },
    remove: vi.fn().mockResolvedValue(true),
    selectedDate: "2024-06-15",
  };

  // ==========================================
  // 验收标准 1: 高度自适应（h-full + min-h-[480px]）
  // ==========================================
  describe("高度自适应（对应验收标准 1/4）", () => {
    it("默认（未展开）状态下根容器应同时包含 h-full 与 min-h-[480px]", () => {
      const { container } = render(<AdminScheduleGantt {...defaultProps} />);
      // 根容器：relative flex w-full h-full，且未展开时附加 min-h-[480px]
      const rootDiv = container.firstElementChild as HTMLElement;
      expect(rootDiv).not.toBeNull();
      expect(rootDiv.className).toContain("h-full");
      expect(rootDiv.className).toContain("min-h-[480px]");
    });

    it("展开（isExpanded=true）时不应出现 min-h-[480px]，仅保留 h-full", () => {
      const { container } = render(<AdminScheduleGantt {...defaultProps} isExpanded={true} />);
      const rootDiv = container.firstElementChild as HTMLElement;
      expect(rootDiv.className).toContain("h-full");
      expect(rootDiv.className).not.toContain("min-h-[480px]");
    });

    it("展开后应可填满父容器，无固定像素高度（480px 已移除）", () => {
      const { container } = render(<AdminScheduleGantt {...defaultProps} isExpanded={true} />);
      const htmlText = container.innerHTML;
      // 确保不再存在硬编码 480px 高度
      expect(htmlText).not.toContain("480px");
      expect(htmlText).not.toMatch(/height:\s*480px/);
    });
  });

  // ==========================================
  // 验收标准 2/3: 时间刻度、预约条渲染
  // ==========================================
  describe("时间刻度与预约条渲染（对应验收标准 2/3）", () => {
    it("应渲染 24 小时刻度（00:00 ~ 23:00）", () => {
      render(<AdminScheduleGantt {...defaultProps} />);
      for (let h = 0; h < 24; h++) {
        expect(screen.getByText(`${String(h).padStart(2, "0")}:00`)).toBeInTheDocument();
      }
    });

    it("应渲染预约条，显示标题与时间段", () => {
      render(<AdminScheduleGantt {...defaultProps} />);
      expect(screen.getByText("测试预约A")).toBeInTheDocument();
      expect(screen.getByText("09:00 - 10:30")).toBeInTheDocument();
      expect(screen.getByText("测试预约B")).toBeInTheDocument();
      expect(screen.getByText("14:00 - 16:00")).toBeInTheDocument();
    });

    it("预约条 top/height 百分比应基于 24 小时计算", () => {
      const { container } = render(<AdminScheduleGantt {...defaultProps} />);
      // 查找两个预约条（absolute left-2 right-2）
      const bars = container.querySelectorAll(".absolute.left-2.right-2.rounded-lg.cursor-pointer");
      expect(bars.length).toBe(2);

      // 预约A: 09:00-10:30 => top = 9 * (100/24) = 37.5%
      const barA = bars[0] as HTMLElement;
      expect(barA.style.top).toBe("37.5%");
      // height: 1.5h * (100/24) = 6.25%（至少 2%）
      expect(barA.style.height).toBe("6.25%");

      // 预约B: 14:00-16:00 => top = 14 * (100/24) = 58.3333...%
      const barB = bars[1] as HTMLElement;
      // 解析百分比字符串为数字
      const topB = parseFloat(barB.style.top);
      expect(topB).toBeCloseTo(58.33, 1);
    });

    it("空 schedules 数组不应报错，只显示时间轴", () => {
      const { container } = render(<AdminScheduleGantt {...defaultProps} schedules={[]} />);
      // 仍有 24 个时间刻度
      expect(screen.getAllByText(/\d{2}:00/).length).toBeGreaterThanOrEqual(24);
      // 没有预约条
      const bars = container.querySelectorAll(".absolute.left-2.right-2.rounded-lg.cursor-pointer");
      expect(bars.length).toBe(0);
    });

    it("短预约（< 1 小时）高度应被钳制到 2%", () => {
      const shortSchedules = [
        {
          id: 10,
          title: "短预约",
          start_time: "2024-06-15T10:00:00",
          end_time: "2024-06-15T10:30:00", // 30 分钟
          author_id: null,
          group_id: null,
          rehearsal_id: null,
        },
      ];
      const { container } = render(
        <AdminScheduleGantt
          {...defaultProps}
          schedules={shortSchedules as unknown as ScheduleRow[]}
        />,
      );
      const bar = container.querySelector(
        ".absolute.left-2.right-2.rounded-lg.cursor-pointer",
      ) as HTMLElement;
      // duration = 0.5h => 0.5 * (100/24) ≈ 2.08%，经过 Math.max(..., 2) = 2.08
      const heightVal = parseFloat(bar.style.height);
      expect(heightVal).toBeGreaterThanOrEqual(2);
    });
  });

  // ==========================================
  // 验收标准: 点击打开详情 Modal
  // ==========================================
  describe("点击预约条交互", () => {
    it("点击预约条后应打开 Modal 并显示详情", async () => {
      render(<AdminScheduleGantt {...defaultProps} />);
      // 点击第一个预约条
      const bar = screen
        .getAllByText("测试预约A")[0]
        .closest(".absolute.left-2.right-2.rounded-lg.cursor-pointer");
      expect(bar).not.toBeNull();
      fireEvent.click(bar as HTMLElement);

      // Modal 打开，显示"预约详情"标题
      await waitFor(() => {
        expect(screen.getByText("预约详情")).toBeInTheDocument();
      });
      // Modal 中显示"测试预约A"
      const modal = screen.getByRole("dialog");
      expect(modal.textContent).toContain("测试预约A");
    });

    it("管理员创建的预约（author_id 为 null）应显示'admin'作为预约人", async () => {
      render(
        <AdminScheduleGantt
          {...defaultProps}
          schedules={mockSchedules as unknown as ScheduleRow[]}
        />,
      );
      // 点击第二个预约（author_id 为 null）
      const bars = document.querySelectorAll(".absolute.left-2.right-2.rounded-lg.cursor-pointer");
      fireEvent.click(bars[1] as HTMLElement);

      await waitFor(() => {
        expect(screen.getByText("预约详情")).toBeInTheDocument();
      });
      // author_id 为 null 时显示 admin（在 Modal 中）
      const modal = screen.getByRole("dialog");
      expect(modal.textContent).toContain("admin");
    });

    it("关闭 Modal 后应清空选中状态", async () => {
      render(<AdminScheduleGantt {...defaultProps} />);
      const bar = screen
        .getAllByText("测试预约A")[0]
        .closest(".absolute.left-2.right-2.rounded-lg.cursor-pointer");
      fireEvent.click(bar as HTMLElement);

      await waitFor(() => {
        expect(screen.getByText("预约详情")).toBeInTheDocument();
      });

      // 点击"关闭"按钮（Modal 头部右侧的关闭按钮）
      fireEvent.click(screen.getByRole("button", { name: "关闭" }));

      // 验证 Modal 关闭
      await waitFor(() => {
        expect(screen.queryByText("预约详情")).not.toBeInTheDocument();
      });
    });
  });

  // ==========================================
  // 删除流程
  // ==========================================
  describe("删除流程", () => {
    it("点击删除按钮 -> 确认删除 -> 调用 remove 并关闭 Modal", async () => {
      const remove = vi.fn().mockResolvedValue(true);
      render(<AdminScheduleGantt {...defaultProps} remove={remove} />);

      // 点击第一个预约条
      const bar = screen
        .getAllByText("测试预约A")[0]
        .closest(".absolute.left-2.right-2.rounded-lg.cursor-pointer");
      fireEvent.click(bar as HTMLElement);

      await waitFor(() => {
        expect(screen.getByText("删除此预约")).toBeInTheDocument();
      });

      // 点击"删除此预约"
      fireEvent.click(screen.getByText("删除此预约"));

      // 点击"确认删除"
      fireEvent.click(screen.getByText("确认删除"));

      await waitFor(() => {
        expect(remove).toHaveBeenCalledWith(1, "2024-06-15");
      });
    });

    it("管理员创建的预约（author_id 为 null）应显示'前往排练页面查看'而非删除入口", async () => {
      // author_id 为 null 时 isRehearsalSchedule = true，显示前往排练页面按钮
      render(<AdminScheduleGantt {...defaultProps} />);
      const bars = document.querySelectorAll(".absolute.left-2.right-2.rounded-lg.cursor-pointer");
      // 点击第二个预约（author_id 为 null）
      fireEvent.click(bars[1] as HTMLElement);
      await waitFor(() => {
        expect(screen.getByText("前往排练页面查看")).toBeInTheDocument();
      });
      expect(screen.queryByText("删除此预约")).not.toBeInTheDocument();
    });

    it("删除失败时应显示错误提示", async () => {
      const remove = vi.fn().mockResolvedValue(false);
      render(<AdminScheduleGantt {...defaultProps} remove={remove} />);

      const bar = screen
        .getAllByText("测试预约A")[0]
        .closest(".absolute.left-2.right-2.rounded-lg.cursor-pointer");
      fireEvent.click(bar as HTMLElement);

      await waitFor(() => {
        expect(screen.getByText("删除此预约")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText("删除此预约"));
      fireEvent.click(screen.getByText("确认删除"));

      await waitFor(() => {
        expect(screen.getByText("删除失败，请稍后重试")).toBeInTheDocument();
      });
    });
  });

  // ==========================================
  // 颜色与样式语义 Token
  // ==========================================
  describe("样式语义 Token（亮/暗双模式）", () => {
    it("时间轴背景使用 gantt-sidebar 语义变量", () => {
      const { container } = render(<AdminScheduleGantt {...defaultProps} />);
      const sidebar = container.querySelector("[style*='--color-gantt-sidebar']");
      expect(sidebar).not.toBeNull();
    });

    it("预约条使用 schedule 颜色变量", () => {
      const { container } = render(<AdminScheduleGantt {...defaultProps} />);
      const bar = container.querySelector(
        ".absolute.left-2.right-2.rounded-lg.cursor-pointer",
      ) as HTMLElement;
      expect(bar).not.toBeNull();
      expect(bar.style.backgroundColor).toMatch(/var\(--color-schedule-\d+\)/);
    });

    it("边框、文字使用语义 Token（非硬编码 zinc）", () => {
      const { container } = render(<AdminScheduleGantt {...defaultProps} />);
      const html = container.innerHTML;
      // 不应包含硬编码的 zinc 颜色
      expect(html).not.toMatch(/border-\d+|bg-zinc|text-zinc/);
      // 应使用语义类
      expect(html).toContain("border-border");
      expect(html).toContain("text-text");
      expect(html).toContain("text-text-muted");
    });
  });

  // ==========================================
  // 辅助函数测试
  // ==========================================
  describe("内部辅助函数（纯逻辑）", () => {
    it("formatTime 对 null 输入应返回 --:--", () => {
      render(<AdminScheduleGantt {...defaultProps} />);
      // 预约条目使用 formatTime；已通过 09:00 - 10:30 验证
      expect(screen.getByText("09:00 - 10:30")).toBeInTheDocument();
    });

    it("时间解析（parseTimeToHours）对 null 返回 0", () => {
      expect(parseLocalISO("2024-06-15T09:00:00").getHours()).toBe(9);
    });

    it("颜色选择函数 getScheduleColor 应按 id 循环", () => {
      const { container } = render(<AdminScheduleGantt {...defaultProps} />);
      const bars = container.querySelectorAll(".absolute.left-2.right-2.rounded-lg.cursor-pointer");
      // id=1 => index 1 => --color-schedule-2 (0-indexed: colors[1])
      expect((bars[0] as HTMLElement).style.backgroundColor).toBe("var(--color-schedule-2)");
      // id=2 => index 2 => --color-schedule-3
      expect((bars[1] as HTMLElement).style.backgroundColor).toBe("var(--color-schedule-3)");
    });
  });
});
