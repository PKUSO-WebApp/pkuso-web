// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import AdminSchedulePage from "./page";
import { renderWithProviders } from "@/__tests__/render-with-providers";
import { useAdminPageHeader } from "@/context/admin-page-header-context";
import { getLocalDateString } from "@/lib/date-utils";

/**
 * 「添加预约」按钮住在 `admin/layout.tsx` 的 AdminHeader 里，本页只把它塞进 Context。
 * 少了这一步，弹窗在测试里**根本打不开**（下面那组回滚用例需要它）。
 */
function HeaderProbe() {
  const { headerRight } = useAdminPageHeader();
  return <div data-testid="header-right">{headerRight}</div>;
}

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
  /** hook 的同步错误出口：页面要把它当 `removeError` 传进甘特图（Issue #368 第 7 条） */
  const mockGetLastError = vi.fn().mockReturnValue(null);
  /** 甘特图渲染的行；按 `selectedDate` 过滤，所以用例要填**今天**的**
   *  （页面的 `filteredSchedules` 只留 selectedDate 当天的） */
  const data: unknown[] = [];
  let isLoading = false;

  return {
    mockRemove,
    mockCheckConflict,
    mockFetch,
    mockGetLastError,
    data,
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
    data: mocks.data,
    loading: mocks.isLoading,
    error: null,
    saving: false,
    fetch: mocks.mockFetch,
    create: vi.fn(),
    update: vi.fn(),
    remove: mocks.mockRemove,
    checkConflict: mocks.mockCheckConflict,
    getLastError: mocks.mockGetLastError,
  }),
}));

// Mock useUser
vi.mock("@/context/user-context", () => ({
  useUser: () => ({
    user: { id: "admin-id", role: "admin", name: "管理员" },
    logout: vi.fn(),
  }),
}));

/**
 * supabase 桩（Issue #368 的回滚路径要能分别控制「写」与「回滚删」的结果）。
 * 桩按真实语义建模：写链上没接 `.select(...)` 就返回 `{ data: null }`。
 */
const db = vi.hoisted(() => ({
  /** `schedules.insert(payloads)` 的返回（用例内改） */
  scheduleInsert: { error: null } as { error: unknown },
  /** `schedule_groups.delete().eq().select("id")` 的返回（用例内改） */
  groupDelete: { data: [{ id: "g1" }], error: null } as { data: unknown; error: unknown },
  deletes: [] as { table: string; selected: boolean }[],
}));

vi.mock("@/lib/supabase", () => {
  const builder = (table: string) => {
    let op = "select";
    let selected = false;
    const o: Record<string, unknown> = {};
    const passthrough = () => o;
    Object.assign(o, {
      eq: passthrough,
      order: passthrough,
      gte: passthrough,
      lte: passthrough,
      neq: passthrough,
      is: passthrough,
      select: () => {
        if (op !== "select") selected = true;
        return o;
      },
      single: () => Promise.resolve({ data: null, error: null }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      insert: () => {
        op = "insert";
        return o;
      },
      update: () => {
        op = "update";
        return o;
      },
      delete: () => {
        op = "delete";
        return o;
      },
      then: (resolve: (v: unknown) => void) => {
        if (op === "insert") {
          return resolve(table === "schedules" ? db.scheduleInsert : { error: null });
        }
        if (op === "delete") {
          db.deletes.push({ table, selected });
          return resolve(selected ? db.groupDelete : { data: null, error: null });
        }
        return resolve({ data: null, error: null });
      },
    });
    return o;
  };
  return { supabase: { from: (table: string) => builder(table) } };
});

// Mock create-schedule-modal（渲染精简表单：标题/开始/结束/重复模式 + 提交按钮 + 错误行，
// 以便测试表单提交与防重复提交逻辑；其余控件不渲染）
vi.mock("./components/create-schedule-modal", () => ({
  CreateScheduleModal: ({
    open,
    form,
    onChange,
    onSubmit,
    submitting,
    error,
  }: {
    open: boolean;
    form: {
      title: string;
      startTime: string;
      endTime: string;
      repeatMode: "single" | "weekly" | "monthly";
      weeklyStartDate: string;
      weeklyEndDate: string;
    };
    onChange: (field: string, value: string) => void;
    onSubmit: (e: React.FormEvent) => void;
    submitting: boolean;
    error: string | null;
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
        <select
          aria-label="重复模式"
          value={form.repeatMode}
          onChange={(e) => onChange("repeatMode", e.target.value)}
        >
          <option value="single">不重复</option>
          <option value="weekly">每周</option>
          <option value="monthly">每月</option>
        </select>
        {form.repeatMode === "weekly" && (
          <>
            <input
              aria-label="每周开始日期"
              value={form.weeklyStartDate}
              onChange={(e) => onChange("weeklyStartDate", e.target.value)}
            />
            <input
              aria-label="每周结束日期"
              value={form.weeklyEndDate}
              onChange={(e) => onChange("weeklyEndDate", e.target.value)}
            />
          </>
        )}
        <button type="submit" disabled={submitting}>
          提交预约
        </button>
        {error ? <div data-testid="form-error">{error}</div> : null}
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

  // ==========================================
  // 单条删除失败：hook 的具体原因要真的走到界面上（Issue #368 第 7 条）
  // ==========================================
  describe("单条删除失败时的文案（接线：removeError 必须传下去）", () => {
    const today = getLocalDateString();

    beforeEach(() => {
      mocks.mockGetLastError.mockReturnValue(null);
      mocks.mockRemove.mockResolvedValue(true);
      mocks.data.splice(0, mocks.data.length, {
        id: 7,
        title: "今天有排练房",
        start_time: `${today}T09:00:00`,
        end_time: `${today}T10:30:00`,
        author_id: "admin-id",
        group_id: null,
        rehearsal_id: null,
        created_at: null,
      });
    });

    afterEach(() => {
      mocks.data.length = 0;
    });

    /** 点开第一条预约 -> 删除此预约 -> 确认删除 */
    function clickDeleteOnFirstSchedule() {
      renderWithProviders(
        <>
          <AdminSchedulePage />
          <HeaderProbe />
        </>,
      );
      const bar = screen
        .getAllByText("今天有排练房")[0]
        .closest(".absolute.left-2.right-2.rounded-lg.cursor-pointer");
      fireEvent.click(bar as HTMLElement);
      return waitFor(() => expect(screen.getByText("删除此预约")).toBeInTheDocument())
        .then(() => fireEvent.click(screen.getByText("删除此预约")))
        .then(() => fireEvent.click(screen.getByText("确认删除")));
    }

    it("失败时显示 hook 报的具体原因（页面把 getLastError 传成了 removeError）", async () => {
      mocks.mockRemove.mockResolvedValue(false);
      mocks.mockGetLastError.mockReturnValue("没有匹配的记录，预约可能已被删除");

      await clickDeleteOnFirstSchedule();

      // 这条钉的是**页面到甘特图那段接线**：只测甘特图自己的话，
      // 把 `removeError={getLastError}` 删掉没有任何用例会红。
      await waitFor(() =>
        expect(screen.getByText("没有匹配的记录，预约可能已被删除")).toBeInTheDocument(),
      );
      expect(screen.queryByText("删除失败，请稍后重试")).not.toBeInTheDocument();
    });

    it("hook 没给原因时回落通用文案（不回归）", async () => {
      mocks.mockRemove.mockResolvedValue(false);

      await clickDeleteOnFirstSchedule();

      await waitFor(() => expect(screen.getByText("删除失败，请稍后重试")).toBeInTheDocument());
    });
  });

  // ==========================================
  // 插入失败后的回滚：0 行检测（Issue #368）
  // ==========================================
  describe("添加预约失败后的回滚（0 行检测）", () => {
    const today = getLocalDateString();

    beforeEach(() => {
      db.scheduleInsert = { error: null };
      db.groupDelete = { data: [{ id: "g1" }], error: null };
      db.deletes = [];
    });

    /** 走完「打开弹窗 -> 填每周重复 -> 提交」，返回渲染出的表单错误行 */
    async function submitWeeklyRepeat() {
      renderWithProviders(
        <>
          <AdminSchedulePage />
          <HeaderProbe />
        </>,
      );
      fireEvent.click(screen.getByText("添加预约"));
      await waitFor(() => expect(screen.getByTestId("create-schedule-modal")).toBeInTheDocument());

      fireEvent.change(screen.getByLabelText("预约标题"), { target: { value: "例会" } });
      fireEvent.change(screen.getByLabelText("开始时间"), { target: { value: "10:00" } });
      fireEvent.change(screen.getByLabelText("结束时间"), { target: { value: "12:00" } });
      fireEvent.change(screen.getByLabelText("重复模式"), { target: { value: "weekly" } });
      fireEvent.change(screen.getByLabelText("每周开始日期"), { target: { value: today } });
      fireEvent.change(screen.getByLabelText("每周结束日期"), { target: { value: today } });

      // 第二次插入（schedules）失败 ⇒ 触发回滚（删刚建的 schedule_groups）
      db.scheduleInsert.error = { message: "insert denied" };
      fireEvent.submit(screen.getByTestId("create-schedule-modal"));
      return screen.findByTestId("form-error");
    }

    it("回滚命中 1 行 → 原文案「添加预约失败，请重试」，且写链接了 .select(...)", async () => {
      db.groupDelete.data = [{ id: "g1" }];

      const err = await submitWeeklyRepeat();

      expect(err.textContent).toBe("添加预约失败，请重试");
      // 契约第 1 条：回滚那次删除也要能拿回被影响的行
      expect(db.deletes).toEqual([{ table: "schedule_groups", selected: true }]);
    });

    it("回滚命中 0 行 → 说清可能残留空的重复预约组（不按成功处理）", async () => {
      db.groupDelete.data = [];

      const err = await submitWeeklyRepeat();

      // 0 行 = 回滚没生效，刚建的 group 成了没有预约的空壳 —— 得让用户知道去清掉
      expect(err.textContent).toContain("回滚未生效");
      expect(err.textContent).toContain("残留");
    });

    it("回滚报错 → 同样说清可能残留（错误路径不静默）", async () => {
      db.groupDelete = { data: null, error: { message: "delete denied" } };

      const err = await submitWeeklyRepeat();

      expect(err.textContent).toContain("回滚未生效");
    });
  });
});
