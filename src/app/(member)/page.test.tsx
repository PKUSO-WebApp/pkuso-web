/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import React from "react";
import Home from "./page";
import { UserProvider, useUser } from "@/context/user-context";
import { formatLocalISO, parseLocalISO } from "@/lib/date-utils";
import type { RehearsalRow } from "@/types/database";

// Mock hooks
vi.mock("@/hooks/useRehearsals", () => ({
  useRehearsals: vi.fn().mockReturnValue({
    data: [],
    loading: false,
    error: null,
    saving: false,
    fetch: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  }),
}));

vi.mock("@/hooks/useAnnouncements", () => ({
  useAnnouncements: vi.fn().mockReturnValue({
    data: null,
    loading: false,
    error: null,
    publishing: false,
    fetch: vi.fn(),
    publish: vi.fn(),
  }),
}));

// mock useLeaveRequests（Issue #142）：避免触发真实 Supabase 网络请求；
// 测试中默认无申请，卡片不显示请假状态小字；
// cancelOnSignIn 用 hoisted mock 暴露，供覆盖请假签到用例断言（Issue #155）
const leaveRequestsHookMock = vi.hoisted(() => ({
  // cancelOnSignIn 返回可区分结果（返工）：{ ok: true } 或 { ok: false, reason }
  cancelOnSignIn: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@/hooks/useLeaveRequests", () => ({
  useLeaveRequests: vi.fn().mockReturnValue({
    data: [],
    loading: false,
    error: null,
    saving: false,
    fetchMine: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue(true),
    updateReason: vi.fn().mockResolvedValue(true),
    reapply: vi.fn().mockResolvedValue(true),
    withdraw: vi.fn().mockResolvedValue(true),
    cancelRequest: vi.fn().mockResolvedValue(true),
    cancelOnSignIn: leaveRequestsHookMock.cancelOnSignIn,
    uploadAttachment: vi.fn(),
    getSignedUrl: vi.fn(),
  }),
}));

// Toggle mock 按真实组件渲染全部选项按钮（data-testid: toggle-<option>），点击触发对应 onChange；
// 供分排直签（切「分排」）、历史合排（Issue #154）等需要切换 tab 的用例使用
vi.mock("@/components/ui/Toggle", () => ({
  Toggle: vi.fn(
    (props: {
      options: readonly ("full" | "section" | "history")[];
      value: "full" | "section" | "history";
      onChange: (value: "full" | "section" | "history") => void;
      getLabel?: (option: "full" | "section" | "history") => string;
    }) => (
      <div data-testid="toggle">
        {props.options.map((opt) => (
          <button
            key={opt}
            type="button"
            data-testid={`toggle-${opt}`}
            onClick={() => props.onChange(opt)}
          >
            {props.getLabel ? props.getLabel(opt) : opt}
          </button>
        ))}
      </div>
    ),
  ),
}));

// mock useAttendance，避免传入排练数据后触发真实 Supabase 网络请求；
// map 可注入，用于测试签到锁定与出勤状态显示（Issue #141）
vi.mock("@/hooks/useAttendance", () => ({
  useAttendance: vi.fn().mockReturnValue({
    map: {},
    list: [],
    loading: false,
    fetchMyAttendances: vi.fn(),
    fetchByRehearsal: vi.fn(),
    upsert: vi.fn(),
    updateStatus: vi.fn(),
    batchInsert: vi.fn(),
    fetchStats: vi.fn(),
  }),
}));

vi.mock("@/components/ui/Card", () => ({
  Card: vi.fn(({ children, className }) => (
    <div data-testid="card" className={className}>
      {children}
    </div>
  )),
}));

// 导入 mock 的 hooks
import { useRehearsals } from "@/hooks/useRehearsals";
import { useAttendance } from "@/hooks/useAttendance";
import { useLeaveRequests } from "@/hooks/useLeaveRequests";
const mockUseRehearsals = vi.mocked(useRehearsals);
const mockUseAttendance = vi.mocked(useAttendance);
const mockUseLeaveRequests = vi.mocked(useLeaveRequests);

/** useAttendance mock 默认返回值（map 为空：无任何考勤记录） */
const defaultAttendanceMock = {
  map: {},
  list: [],
  loading: false,
  fetchMyAttendances: vi.fn(),
  fetchByRehearsal: vi.fn(),
  upsert: vi.fn(),
  updateStatus: vi.fn(),
  batchInsert: vi.fn(),
  fetchStats: vi.fn(),
};

/** useLeaveRequests mock 默认返回值（默认无申请；overrides 覆盖 data 等字段，Issue #155） */
function defaultLeaveRequestsMock(overrides: Record<string, unknown> = {}) {
  return {
    data: [],
    loading: false,
    error: null,
    saving: false,
    fetchMine: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue(true),
    updateReason: vi.fn().mockResolvedValue(true),
    reapply: vi.fn().mockResolvedValue(true),
    withdraw: vi.fn().mockResolvedValue(true),
    cancelRequest: vi.fn().mockResolvedValue(true),
    cancelOnSignIn: leaveRequestsHookMock.cancelOnSignIn,
    uploadAttachment: vi.fn(),
    getSignedUrl: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useLeaveRequests>;
}

// 辅助组件：在 UserProvider 内自动登录
function WithLoggedInUser({
  children,
  user,
}: {
  children: React.ReactNode;
  user: Parameters<ReturnType<typeof useUser>["login"]>[0];
}) {
  const { login } = useUser();
  React.useEffect(() => {
    login(user);
  }, [login, user]);
  return children;
}

describe("Home 首页组件", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ============================================================
  // 1. 欢迎语测试
  // ============================================================
  describe("欢迎语", () => {
    it("未登录时不显示欢迎语", () => {
      render(<Home />, { wrapper: UserProvider });
      expect(screen.queryByText(/欢迎/)).toBeNull();
    });

    it("登录后显示带用户名的欢迎语", () => {
      render(
        <UserProvider>
          <WithLoggedInUser
            user={{ id: "test-id", name: "张三", role: "member", section: "小提琴" }}
          >
            <Home />
          </WithLoggedInUser>
        </UserProvider>,
      );
      expect(screen.getByText("欢迎，张三！")).toBeTruthy();
    });

    it("用户名全空白时显示'欢迎！'", () => {
      render(
        <UserProvider>
          <WithLoggedInUser
            user={{ id: "test-id", name: "   ", role: "member", section: "小提琴" }}
          >
            <Home />
          </WithLoggedInUser>
        </UserProvider>,
      );
      expect(screen.getByText("欢迎！")).toBeTruthy();
    });

    it("用户名为空字符串时显示'欢迎！'", () => {
      render(
        <UserProvider>
          <WithLoggedInUser user={{ id: "test-id", name: "", role: "member", section: "小提琴" }}>
            <Home />
          </WithLoggedInUser>
        </UserProvider>,
      );
      expect(screen.getByText("欢迎！")).toBeTruthy();
    });

    it("用户名为undefined时显示'欢迎！'", () => {
      render(
        <UserProvider>
          <WithLoggedInUser
            user={{
              id: "test-id",
              name: undefined as unknown as string,
              role: "member",
              section: "小提琴",
            }}
          >
            <Home />
          </WithLoggedInUser>
        </UserProvider>,
      );
      expect(screen.getByText("欢迎！")).toBeTruthy();
    });
  });

  // ============================================================
  // 1.5 欢迎语 5 秒自动消失（Issue #110）
  // ============================================================
  describe("欢迎语自动消失", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function renderLoggedIn() {
      return render(
        <UserProvider>
          <WithLoggedInUser
            user={{ id: "test-id", name: "张三", role: "member", section: "小提琴" }}
          >
            <Home />
          </WithLoggedInUser>
        </UserProvider>,
      );
    }

    it("5 秒后进入淡出态（opacity-0），5.5 秒后不再渲染", () => {
      renderLoggedIn();
      expect(screen.getByText("欢迎，张三！")).toBeTruthy();

      // 5 秒后：淡出开始，元素仍在但 opacity-0
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      const welcomeEl = screen.getByText("欢迎，张三！");
      expect(welcomeEl.closest("div")).toHaveClass("opacity-0");

      // 再过 500ms（transition 完成）：不再渲染
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(screen.queryByText(/欢迎/)).toBeNull();
    });

    it("组件卸载时清理定时器", () => {
      const { unmount } = renderLoggedIn();
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  // ============================================================
  // 2. Rehearsals 边界测试
  // ============================================================
  describe("rehearsals 边界处理", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      // 默认返回空数组
      mockUseRehearsals.mockReturnValue({
        data: [],
        loading: false,
        error: null,
        saving: false,
        fetch: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      });
    });

    it("rehearsals 为 undefined 时不崩溃", () => {
      mockUseRehearsals.mockReturnValue({
        data: undefined as unknown as ReturnType<typeof useRehearsals>["data"],
        loading: false,
        error: null,
        saving: false,
        fetch: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      });

      expect(() => {
        render(<Home />, { wrapper: UserProvider });
      }).not.toThrow();

      expect(screen.getByText("暂无安排")).toBeTruthy();
    });

    it("rehearsals 为 null 时不崩溃", () => {
      mockUseRehearsals.mockReturnValue({
        data: null as unknown as ReturnType<typeof useRehearsals>["data"],
        loading: false,
        error: null,
        saving: false,
        fetch: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      });

      expect(() => {
        render(<Home />, { wrapper: UserProvider });
      }).not.toThrow();

      expect(screen.getByText("暂无安排")).toBeTruthy();
    });

    it("rehearsals 为空数组时显示'暂无安排'", () => {
      render(<Home />, { wrapper: UserProvider });
      expect(screen.getByText("暂无安排")).toBeTruthy();
    });

    it("rehearsals 加载中显示'加载中…'", () => {
      mockUseRehearsals.mockReturnValue({
        data: [],
        loading: true,
        error: null,
        saving: false,
        fetch: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      });

      render(<Home />, { wrapper: UserProvider });
      expect(screen.getByText("加载中…")).toBeTruthy();
    });
  });

  // ============================================================
  // 3. Toggle 组件测试
  // ============================================================
  describe("Toggle 组件", () => {
    it("渲染 Toggle 组件", () => {
      render(<Home />, { wrapper: UserProvider });
      expect(screen.getByTestId("toggle")).toBeTruthy();
    });
  });

  // ============================================================
  // 4. 页面标题测试
  // ============================================================
  describe("页面标题", () => {
    it("显示'本周排练日程'标题", () => {
      render(<Home />, { wrapper: UserProvider });
      expect(screen.getByText("本周排练日程")).toBeTruthy();
    });

    it("显示副标题", () => {
      render(<Home />, { wrapper: UserProvider });
      expect(screen.getByText("查看乐团合排与分排安排")).toBeTruthy();
    });
  });

  // ============================================================
  // 5. 首页排练时间过滤（Issue #119）：仅显示未来一周内（含今天）
  // ============================================================
  describe("首页排练时间过滤", () => {
    /** 构造相对"今天"偏移 dayOffset 天的排练行（本地时区 20:00-22:00） */
    function makeRehearsal(id: number, dayOffset: number, repertoire: string): RehearsalRow {
      const now = new Date();
      const start = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + dayOffset,
        20,
        0,
        0,
      );
      const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
      return {
        id,
        repertoire,
        type: "full",
        start_time: formatLocalISO(start),
        end_time: formatLocalISO(end),
        location: "排练厅",
        title: null,
        date: null,
        time: null,
        sign_in_code: null,
        target_section: null,
        created_at: null,
        updated_at: "2026-08-14T00:00:00.000Z",
        updated_fields: null,
      };
    }

    function renderWithRehearsals(data: RehearsalRow[]) {
      mockUseRehearsals.mockReturnValue({
        data,
        loading: false,
        error: null,
        saving: false,
        fetch: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      });
      render(<Home />, { wrapper: UserProvider });
    }

    it("只显示今天及未来一周内的排练，已过去和超过一周的隐藏", () => {
      renderWithRehearsals([
        makeRehearsal(1, 0, "今日排练"),
        makeRehearsal(2, 5, "一周内排练"),
        makeRehearsal(3, -2, "已过去排练"),
        makeRehearsal(4, 10, "超期排练"),
      ]);

      expect(screen.getByText("今日排练")).toBeTruthy();
      expect(screen.getByText("一周内排练")).toBeTruthy();
      expect(screen.queryByText("已过去排练")).toBeNull();
      expect(screen.queryByText("超期排练")).toBeNull();
    });

    it("无 start_time 的排练保留显示", () => {
      const rehearsal = makeRehearsal(1, 0, "未设置时间排练");
      rehearsal.start_time = null;
      renderWithRehearsals([rehearsal]);

      expect(screen.getByText("未设置时间排练")).toBeTruthy();
    });

    it("全部被过滤时显示'暂无安排'", () => {
      renderWithRehearsals([makeRehearsal(1, -10, "旧排练"), makeRehearsal(2, 20, "远期排练")]);

      expect(screen.getByText("暂无安排")).toBeTruthy();
    });
  });

  // ============================================================
  // 5.4.5 历史合排 tab（Issue #154）：仅已结束的合排，按结束时刻近 → 远，不限一周窗口
  // ============================================================
  describe("历史合排 tab", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // 固定系统时间 2026-08-15 21:00（本地）：结束判定与排序与真实运行时刻无关
      vi.setSystemTime(new Date(2026, 7, 15, 21, 0, 0));
      // clearAllMocks 不清除 mockReturnValue 实现，显式重置考勤 mock（防上个用例的 map 残留）
      mockUseAttendance.mockReturnValue({ ...defaultAttendanceMock });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /** 构造指定 startISO 的排练行（fake timers 已固定系统时间，硬编码日期安全；opts.endISO 覆盖结束时刻、opts.type 指定类型） */
    function makeRehearsalAt(
      id: number,
      startISO: string,
      repertoire: string,
      opts?: { endISO?: string | null; type?: "full" | "section" },
    ): RehearsalRow {
      const end =
        opts?.endISO ??
        formatLocalISO(new Date(parseLocalISO(startISO).getTime() + 2 * 60 * 60 * 1000));
      return {
        id,
        repertoire,
        type: opts?.type ?? "full",
        start_time: startISO,
        end_time: end,
        location: "排练厅",
        title: null,
        date: null,
        time: null,
        sign_in_code: null,
        target_section: null,
        created_at: null,
        updated_at: "2026-08-14T00:00:00.000Z",
        updated_fields: null,
      };
    }

    function renderWithRehearsals(data: RehearsalRow[]) {
      mockUseRehearsals.mockReturnValue({
        data,
        loading: false,
        error: null,
        saving: false,
        fetch: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      });
      render(<Home />, { wrapper: UserProvider });
    }

    it("Toggle 提供「历史合排」选项，点击后切换并更新标题", () => {
      renderWithRehearsals([]);
      expect(screen.getByTestId("toggle-history")).toBeTruthy();

      fireEvent.click(screen.getByTestId("toggle-history"));
      // 标题从「本周排练日程」切换为「历史合排」（heading 唯一匹配，避免与选项按钮文案冲突）
      expect(screen.getByRole("heading", { name: "历史合排" })).toBeTruthy();
      expect(screen.queryByText("本周排练日程")).toBeNull();
    });

    it("仅显示已结束的合排：分排、进行中的合排、未开始的合排不显示", () => {
      renderWithRehearsals([
        makeRehearsalAt(1, "2026-08-15T08:00:00", "上午合排"), // 已结束（10:00 结束）
        makeRehearsalAt(2, "2026-08-15T08:00:00", "上午分排", { type: "section" }), // 已结束但为分排
        makeRehearsalAt(3, "2026-08-15T20:00:00", "今晚合排"), // 进行中（22:00 结束）
        makeRehearsalAt(4, "2026-08-16T20:00:00", "明天合排"), // 未开始
      ]);
      fireEvent.click(screen.getByTestId("toggle-history"));

      expect(screen.getByText("上午合排")).toBeTruthy();
      expect(screen.queryByText("上午分排")).toBeNull();
      expect(screen.queryByText("今晚合排")).toBeNull();
      expect(screen.queryByText("明天合排")).toBeNull();
    });

    it("end_time 缺失的已结束合排按 start + 3 小时判定", () => {
      // 17:00 开始无 end_time（默认 20:00 结束），now 21:00 已结束
      const rehearsal = makeRehearsalAt(1, "2026-08-15T17:00:00", "默认时长合排");
      rehearsal.end_time = null;
      renderWithRehearsals([rehearsal]);
      fireEvent.click(screen.getByTestId("toggle-history"));

      expect(screen.getByText("默认时长合排")).toBeTruthy();
    });

    it("按结束时刻近 → 远排序（最近结束在前）", () => {
      renderWithRehearsals([
        makeRehearsalAt(1, "2026-08-10T08:00:00", "五天前合排"), // 5 天前结束
        makeRehearsalAt(2, "2026-08-15T08:00:00", "上午合排"), // 11 小时前结束
        makeRehearsalAt(3, "2026-08-15T14:00:00", "下午合排"), // 5 小时前结束
      ]);
      fireEvent.click(screen.getByTestId("toggle-history"));

      const rendered = screen.getAllByText(/(五天前|上午|下午)合排/).map((el) => el.textContent);
      expect(rendered).toEqual(["下午合排", "上午合排", "五天前合排"]);
    });

    it("不限一周窗口：超过一周的已结束合排也显示", () => {
      renderWithRehearsals([
        makeRehearsalAt(1, "2026-07-01T08:00:00", "上个月合排"),
        makeRehearsalAt(2, "2026-06-01T08:00:00", "两个月前合排"),
      ]);
      fireEvent.click(screen.getByTestId("toggle-history"));

      expect(screen.getByText("上个月合排")).toBeTruthy();
      expect(screen.getByText("两个月前合排")).toBeTruthy();
    });

    it("历史 tab 中已结束卡片照常显示状态与「补请假」入口", () => {
      renderWithRehearsals([makeRehearsalAt(1, "2026-08-15T08:00:00", "上午合排")]);
      fireEvent.click(screen.getByTestId("toggle-history"));

      // 「已结束」灰标签已移除（Issue #164）：只显示缺勤状态 chip 与补请假入口
      expect(screen.queryByText("已结束")).toBeNull();
      expect(screen.getByText(/❌\s*缺勤/)).toBeTruthy();
      expect(screen.getByRole("button", { name: "补请假" })).toBeTruthy();
    });

    it("分排 tab 窗口过滤不受影响：已过去/超期的分排仍隐藏（回归）", () => {
      renderWithRehearsals([
        makeRehearsalAt(1, "2026-08-16T20:00:00", "未来分排", { type: "section" }),
        makeRehearsalAt(2, "2026-08-14T20:00:00", "已过去分排", { type: "section" }),
        makeRehearsalAt(3, "2026-08-30T20:00:00", "超期分排", { type: "section" }),
      ]);
      fireEvent.click(screen.getByTestId("toggle-section"));

      expect(screen.getByText("未来分排")).toBeTruthy();
      expect(screen.queryByText("已过去分排")).toBeNull();
      expect(screen.queryByText("超期分排")).toBeNull();
    });

    it("无已结束合排时显示'暂无安排'", () => {
      renderWithRehearsals([makeRehearsalAt(1, "2026-08-15T20:00:00", "今晚合排")]);
      fireEvent.click(screen.getByTestId("toggle-history"));

      expect(screen.getByText("暂无安排")).toBeTruthy();
    });
  });

  // ============================================================
  // 5.5 排练列表排序（Issue #110 对抗返工 + Issue #140 排序规则）
  // ============================================================
  describe("排练列表排序", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // 固定系统时间：保证"今日排练"（20:00-22:00）恒为进行中，
      // 排序三态（进行中/未开始/已结束）判定与真实运行时刻无关
      vi.setSystemTime(new Date(2026, 7, 15, 21, 0, 0));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /**
     * 构造相对"今天"偏移 dayOffset 天的排练行（本地时区 20:00-22:00）。
     * 与"首页排练时间过滤"的 makeRehearsal 同构：页面按本地日期边界过滤
     * （今天 00:00 ～ 今天+7 天 23:59），相对偏移构造保证任意日期运行均落在窗口内。
     */
    function makeRehearsal(id: number, dayOffset: number, repertoire: string): RehearsalRow {
      const now = new Date();
      const start = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + dayOffset,
        20,
        0,
        0,
      );
      const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
      return {
        id,
        repertoire,
        type: "full",
        start_time: formatLocalISO(start),
        end_time: formatLocalISO(end),
        location: "排练厅",
        title: null,
        date: null,
        time: null,
        sign_in_code: null,
        target_section: null,
        created_at: null,
        updated_at: "2026-08-14T00:00:00.000Z",
        updated_fields: null,
      };
    }

    function renderWithRehearsals(data: RehearsalRow[]) {
      mockUseRehearsals.mockReturnValue({
        data,
        loading: false,
        error: null,
        saving: false,
        fetch: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      });
      render(<Home />, { wrapper: UserProvider });
    }

    it("hook 返回降序时，页面按开始时间升序渲染（最近的排练优先）", () => {
      // 模拟 useRehearsals 的降序返回（远 → 近）
      renderWithRehearsals([
        makeRehearsal(1, 5, "五天后排练"),
        makeRehearsal(2, 0, "今日排练"),
        makeRehearsal(3, 2, "两天后排练"),
      ]);

      // getAllByText 按文档顺序返回，验证 DOM 顺序与时间升序一致
      const rendered = screen.getAllByText(/(今日|两天后|五天后)排练/).map((el) => el.textContent);
      expect(rendered).toEqual(["今日排练", "两天后排练", "五天后排练"]);
    });

    it("无 start_time 的排练排最后", () => {
      const noTime = makeRehearsal(1, 1, "无时间排练");
      noTime.start_time = null;
      renderWithRehearsals([
        noTime,
        makeRehearsal(2, 0, "今日排练"),
        makeRehearsal(3, 4, "四天后排练"),
      ]);

      const rendered = screen.getAllByText(/(今日|四天后|无时间)排练/).map((el) => el.textContent);
      expect(rendered).toEqual(["今日排练", "四天后排练", "无时间排练"]);
    });

    /**
     * 构造指定 startISO 的排练行（本地时间字符串；fake timers 已固定系统时间为 2026-08-15 21:00，
     * 硬编码日期安全；opts 可指定 created_at/updated_at 覆盖"已更新"判定）
     */
    function makeRehearsalAt(
      id: number,
      startISO: string,
      repertoire: string,
      opts?: { created?: string | null; updated?: string | null; updatedFields?: string | null },
    ): RehearsalRow {
      const end = new Date(parseLocalISO(startISO).getTime() + 2 * 60 * 60 * 1000);
      return {
        id,
        repertoire,
        type: "full",
        start_time: startISO,
        end_time: formatLocalISO(end),
        location: "排练厅",
        title: null,
        date: null,
        time: null,
        sign_in_code: null,
        target_section: null,
        created_at: opts?.created ?? null,
        updated_at: opts?.updated ?? "2026-08-14T00:00:00.000Z",
        updated_fields: opts?.updatedFields ?? null,
      };
    }

    it("已结束的排练排在底部，最近结束在前（Issue #140）", () => {
      // 固定 now = 2026-08-15 21:00：上午排练 10 点结束（11 小时前）、下午排练 16 点结束（5 小时前）、
      // 明天排练未开始；三者的开始日期都在本周窗口内，全部保留显示
      renderWithRehearsals([
        makeRehearsalAt(1, "2026-08-15T08:00:00", "上午排练"),
        makeRehearsalAt(2, "2026-08-16T20:00:00", "明天排练"),
        makeRehearsalAt(3, "2026-08-15T14:00:00", "下午排练"),
      ]);

      const rendered = screen.getAllByText(/(明天|下午|上午)排练/).map((el) => el.textContent);
      expect(rendered).toEqual(["明天排练", "下午排练", "上午排练"]);
    });

    it("更新过的排练提到最近一次日程之后，并显示更新标识（Issue #140）", () => {
      renderWithRehearsals([
        // 后天排练：编辑过（updated_at > created_at）
        makeRehearsalAt(1, "2026-08-17T20:00:00", "后天排练", {
          created: "2026-08-10T00:00:00.000Z",
          updated: "2026-08-15T12:00:00.000Z",
        }),
        makeRehearsalAt(2, "2026-08-16T20:00:00", "明天排练"), // 最近，保持第一位
        makeRehearsalAt(3, "2026-08-18T20:00:00", "大后天排练"),
      ]);

      // 明天排练（最近）保持第一位，已更新的后天排练提到其后，大后天排练最后
      const rendered = screen.getAllByText(/(明天|后天|大后天)排练/).map((el) => el.textContent);
      expect(rendered).toEqual(["明天排练", "后天排练", "大后天排练"]);
      // 仅已更新的排练渲染「更新」标识（warning 色系语义 token）；
      // 该 fixture updated_fields 为 null（存量数据语义）→ 兜底全量文案
      expect(screen.getByText("更新排练时间/地点/曲目")).toBeTruthy();
    });

    it("更新提示文案按 updated_fields 细分（Issue #171）", () => {
      renderWithRehearsals([
        // 已更新（created < updated）且 updated_fields=time,location → 细分文案
        makeRehearsalAt(1, "2026-08-17T20:00:00", "后天排练", {
          created: "2026-08-10T00:00:00.000Z",
          updated: "2026-08-15T12:00:00.000Z",
          updatedFields: "time,location",
        }),
        makeRehearsalAt(2, "2026-08-16T20:00:00", "明天排练"),
      ]);

      expect(screen.getByText("更新排练时间/地点")).toBeTruthy();
      expect(screen.queryByText("更新排练时间/地点/曲目")).toBeNull();
    });

    it("未编辑过的排练不显示更新标识", () => {
      renderWithRehearsals([makeRehearsalAt(1, "2026-08-16T20:00:00", "明天排练")]);
      expect(screen.queryByText("更新排练时间/地点/曲目")).toBeNull();
    });

    it("已结束且编辑过的排练不显示更新标识（更新标识持续到排练结束，Issue #140）", () => {
      // 上午排练 08:00-10:00，now 21:00 已结束；尽管编辑过（updated_at > created_at）也不显示 chip
      renderWithRehearsals([
        makeRehearsalAt(1, "2026-08-15T08:00:00", "上午排练", {
          created: "2026-08-10T00:00:00.000Z",
          updated: "2026-08-15T12:00:00.000Z",
        }),
      ]);

      expect(screen.getByText("上午排练")).toBeTruthy();
      expect(screen.queryByText("更新排练时间/地点/曲目")).toBeNull();
    });
  });

  // ============================================================
  // 5.6 跨天自动刷新（Issue #110 对抗返工）：分钟级 tick 驱动过滤更新
  // ============================================================
  describe("跨天自动刷新", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // 固定在 2026-08-14 23:59:30（即将跨天），并让 makeRehearsalAt 的时间落在当日
      vi.setSystemTime(new Date(2026, 7, 14, 23, 59, 30));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /** 构造指定 startISO 的排练行（fake timers 已固定系统时间为 2026-08-14，硬编码日期安全；此处内联避免跨 describe 依赖） */
    function makeRehearsalAt(id: number, startISO: string, repertoire: string): RehearsalRow {
      const end = new Date(parseLocalISO(startISO).getTime() + 2 * 60 * 60 * 1000);
      return {
        id,
        repertoire,
        type: "full",
        start_time: startISO,
        end_time: formatLocalISO(end),
        location: "排练厅",
        title: null,
        date: null,
        time: null,
        sign_in_code: null,
        target_section: null,
        created_at: null,
        updated_at: "2026-08-14T00:00:00.000Z",
        updated_fields: null,
      };
    }

    function renderWithRehearsals(data: RehearsalRow[]) {
      mockUseRehearsals.mockReturnValue({
        data,
        loading: false,
        error: null,
        saving: false,
        fetch: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      });
      return render(<Home />, { wrapper: UserProvider });
    }

    it("跨天后下一次 tick 触发，已过期排练被过滤、未过期排练保留", () => {
      renderWithRehearsals([
        // 23:59:59 属于今天，tick 后（00:00:30）已过期
        makeRehearsalAt(1, "2026-08-14T23:59:59", "跨日排练"),
        makeRehearsalAt(2, "2026-08-15T20:00:00", "明天排练"),
      ]);

      // tick 前：跨日排练仍在"今天"窗口内
      expect(screen.getByText("跨日排练")).toBeTruthy();
      expect(screen.getByText("明天排练")).toBeTruthy();

      // 推进 60 秒：interval 触发 → nowTick 变为 8月15日 00:00:30 → 跨日排练被过滤
      act(() => {
        vi.advanceTimersByTime(60 * 1000);
      });

      expect(screen.queryByText("跨日排练")).toBeNull();
      expect(screen.getByText("明天排练")).toBeTruthy();
    });

    it("跨天后 tick 触发，签到按钮从未开始变为可签到（nowTick 驱动卡片重新计算签到窗口）", () => {
      // 排练次日 00:30 开始（签到窗口 00:00 开启），tick 前（23:59:30）处于"未开始"状态
      renderWithRehearsals([makeRehearsalAt(1, "2026-08-15T00:30:00", "凌晨排练")]);

      // tick 前：未到签到窗口，chip1 留空不显示「未开始」（Issue #171），无签到按钮
      expect(screen.queryByText("未开始")).toBeNull();
      expect(screen.queryByRole("button", { name: "签到" })).toBeNull();

      // 推进 60 秒：interval 触发 → nowTick 更新 → RehearsalCard 用最新时间重新判断
      act(() => {
        vi.advanceTimersByTime(60 * 1000);
      });

      // tick 后（00:00:30）：进入签到窗口，显示"签到"按钮
      expect(screen.queryByText("未开始")).toBeNull();
      expect(screen.getByRole("button", { name: "签到" })).toBeTruthy();
    });

    it("组件卸载时清理 interval", () => {
      const { unmount } = renderWithRehearsals([]);
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  // ============================================================
  // 5.7 签到锁定与出勤状态显示（Issue #141）
  // ============================================================
  describe("签到锁定与出勤状态显示", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // 固定系统时间 2026-08-15 21:00：当天 20:00-22:00 排练为"进行中"，上午排练已结束
      vi.setSystemTime(new Date(2026, 7, 15, 21, 0, 0));
      // 默认无考勤记录；每个用例按需覆盖 map
      mockUseAttendance.mockReturnValue({ ...defaultAttendanceMock });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /** 构造指定 startISO 的排练行（fake timers 已固定系统时间，硬编码日期安全；opts.signInCode 可设置签到码） */
    function makeRehearsalAt(
      id: number,
      startISO: string,
      repertoire: string,
      opts?: { signInCode?: string | null },
    ): RehearsalRow {
      const end = new Date(parseLocalISO(startISO).getTime() + 2 * 60 * 60 * 1000);
      return {
        id,
        repertoire,
        type: "full",
        start_time: startISO,
        end_time: formatLocalISO(end),
        location: "排练厅",
        title: null,
        date: null,
        time: null,
        sign_in_code: opts?.signInCode ?? null,
        target_section: null,
        created_at: null,
        updated_at: "2026-08-14T00:00:00.000Z",
        updated_fields: null,
      };
    }

    function renderWithAttendance(
      map: Record<number, { status: string; sign_in_time: string | null }>,
    ) {
      mockUseRehearsals.mockReturnValue({
        data: [makeRehearsalAt(1, "2026-08-15T20:00:00", "今晚排练")],
        loading: false,
        error: null,
        saving: false,
        fetch: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      });
      mockUseAttendance.mockReturnValue({ ...defaultAttendanceMock, map });
      render(<Home />, { wrapper: UserProvider });
    }

    it("签到后管理员改状态为缺席（sign_in_time 非空 + status=absent）：显示缺勤 chip，无签到按钮，不可再签到", () => {
      renderWithAttendance({
        1: { status: "absent", sign_in_time: "2026-08-15T20:05:00" },
      });

      expect(screen.getByText(/缺勤/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "签到" })).toBeNull();
    });

    it("签到后状态为出席：显示出席 chip，无签到按钮", () => {
      renderWithAttendance({
        1: { status: "present", sign_in_time: "2026-08-15T20:05:00" },
      });

      expect(screen.getByText(/出席/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "签到" })).toBeNull();
    });

    it("签到后状态为迟到：显示迟到 chip", () => {
      renderWithAttendance({
        1: { status: "late", sign_in_time: "2026-08-15T20:20:00" },
      });

      expect(screen.getByText(/迟到/)).toBeTruthy();
    });

    it("未签到（无考勤记录）且排练进行中：显示签到按钮", () => {
      renderWithAttendance({});

      expect(screen.getByRole("button", { name: "签到" })).toBeTruthy();
    });

    it("未签到（管理员预生成的默认缺席记录，sign_in_time 为 null）且排练进行中：仍可签到", () => {
      // admin 创建排练时批量预生成 status=absent、sign_in_time=null 的记录，不构成锁定
      renderWithAttendance({
        1: { status: "absent", sign_in_time: null },
      });

      expect(screen.getByRole("button", { name: "签到" })).toBeTruthy();
      expect(screen.queryByText(/缺勤/)).toBeNull();
    });

    it("排练已结束 + 已签到（出席）：只显示出席 chip（「已结束」标签已移除，Issue #164）", () => {
      mockUseRehearsals.mockReturnValue({
        data: [makeRehearsalAt(1, "2026-08-15T08:00:00", "上午排练")],
        loading: false,
        error: null,
        saving: false,
        fetch: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      });
      mockUseAttendance.mockReturnValue({
        ...defaultAttendanceMock,
        map: { 1: { status: "present", sign_in_time: "2026-08-15T07:55:00" } },
      });
      render(<Home />, { wrapper: UserProvider });

      expect(screen.queryByText("已结束")).toBeNull();
      expect(screen.getByText(/出席/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "签到" })).toBeNull();
    });

    it("排练已结束 + 未签到（无考勤记录）：只显示缺勤 chip（「已结束」标签已移除，Issue #164）", () => {
      mockUseRehearsals.mockReturnValue({
        data: [makeRehearsalAt(1, "2026-08-15T08:00:00", "上午排练")],
        loading: false,
        error: null,
        saving: false,
        fetch: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      });
      mockUseAttendance.mockReturnValue({ ...defaultAttendanceMock });
      render(<Home />, { wrapper: UserProvider });

      expect(screen.queryByText("已结束")).toBeNull();
      expect(screen.getByText(/缺勤/)).toBeTruthy();
    });

    it("排练已结束 + 管理员设为请假（未签到）：只显示请假 chip（「已结束」标签已移除，Issue #164）", () => {
      mockUseRehearsals.mockReturnValue({
        data: [makeRehearsalAt(1, "2026-08-15T08:00:00", "上午排练")],
        loading: false,
        error: null,
        saving: false,
        fetch: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      });
      mockUseAttendance.mockReturnValue({
        ...defaultAttendanceMock,
        map: { 1: { status: "excused", sign_in_time: null } },
      });
      render(<Home />, { wrapper: UserProvider });

      expect(screen.queryByText("已结束")).toBeNull();
      // 已请假（excused）不可再补请假（Issue #148）：仅渲染请假 chip，无「补请假」按钮
      expect(screen.getByText(/⭕\s*请假/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "补请假" })).toBeNull();
    });

    it("未签到 + 无请假申请 + 管理员手动设请假（排练进行中）：显示正常「签到」按钮（返工，Issue #159 方案 B）", () => {
      // 无申请时 canOverrideLeave 不成立；但请假未签到 + 无有效申请时成员应可签到覆盖——
      // 修复「撤回已通过申请后无法签到也无法重新申请」的死局（管理员手动设 excused 语义同构：
      // 成员到场可覆盖）；与「有 approved 申请」场景（黄色覆盖按钮）区分，见 5.8.5 覆盖请假签到
      mockUseLeaveRequests.mockReturnValue(defaultLeaveRequestsMock());
      renderWithAttendance({
        1: { status: "excused", sign_in_time: null },
      });

      expect(screen.getByRole("button", { name: "签到" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "覆盖请假" })).toBeNull();
      expect(screen.queryByText(/⭕\s*请假/)).toBeNull();
    });
  });

  // ============================================================
  // 5.8 签到防重复提交 + 首屏考勤加载（Issue #141 对抗返工）
  // ============================================================
  describe("签到防重复提交与首屏考勤加载", () => {
    beforeEach(() => {
      // 固定系统时间 2026-08-15 21:00：当天 20:00-22:00 排练恒为"进行中"（签到窗口判定与真实运行时刻无关）
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 7, 15, 21, 0, 0));
      // jsdom 的 alert 未实现，spy 并吞掉
      vi.spyOn(window, "alert").mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    /** 构造指定 startISO 的排练行（fake timers 已固定系统时间，硬编码日期安全；opts.signInCode 可设置签到码） */
    function makeRehearsalAt(
      id: number,
      startISO: string,
      repertoire: string,
      opts?: { signInCode?: string | null },
    ): RehearsalRow {
      const end = new Date(parseLocalISO(startISO).getTime() + 2 * 60 * 60 * 1000);
      return {
        id,
        repertoire,
        type: "full",
        start_time: startISO,
        end_time: formatLocalISO(end),
        location: "排练厅",
        title: null,
        date: null,
        time: null,
        sign_in_code: opts?.signInCode ?? null,
        target_section: null,
        created_at: null,
        updated_at: "2026-08-14T00:00:00.000Z",
        updated_fields: null,
      };
    }

    it("签到码弹窗内连按 Enter（form submit 两次）只提交一次", async () => {
      mockUseRehearsals.mockReturnValue({
        data: [makeRehearsalAt(1, "2026-08-15T20:00:00", "今晚排练", { signInCode: "8848" })],
        loading: false,
        error: null,
        saving: false,
        fetch: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      });
      const upsert = vi.fn().mockResolvedValue(null);
      mockUseAttendance.mockReturnValue({ ...defaultAttendanceMock, upsert });
      render(
        <UserProvider>
          <WithLoggedInUser
            user={{ id: "test-id", name: "张三", role: "member", section: "小提琴" }}
          >
            <Home />
          </WithLoggedInUser>
        </UserProvider>,
      );

      // 打开签到码弹窗并输入正确签到码
      fireEvent.click(screen.getByRole("button", { name: "签到" }));
      fireEvent.change(screen.getByPlaceholderText("如：8848"), {
        target: { value: "8848" },
      });
      const form = screen.getByRole("dialog").querySelector("form")!;

      // 连按两次 Enter（form 两次 submit）：同步 ref 阻断第二次提交
      await act(async () => {
        fireEvent.submit(form);
        fireEvent.submit(form);
      });
      expect(upsert).toHaveBeenCalledTimes(1);
    });

    it("分排直签连点签到按钮只提交一次", async () => {
      mockUseRehearsals.mockReturnValue({
        data: [
          {
            ...makeRehearsalAt(1, "2026-08-15T20:00:00", "今晚分排"),
            type: "section",
          },
        ],
        loading: false,
        error: null,
        saving: false,
        fetch: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      });
      const upsert = vi.fn().mockResolvedValue(null);
      mockUseAttendance.mockReturnValue({ ...defaultAttendanceMock, upsert });
      render(
        <UserProvider>
          <WithLoggedInUser
            user={{ id: "test-id", name: "张三", role: "member", section: "小提琴" }}
          >
            <Home />
          </WithLoggedInUser>
        </UserProvider>,
      );

      // 切到「分排」tab 后分排排练才会展示
      fireEvent.click(screen.getByTestId("toggle-section"));
      const signInBtn = screen.getByRole("button", { name: "签到" });
      await act(async () => {
        fireEvent.click(signInBtn);
        fireEvent.click(signInBtn);
      });
      expect(upsert).toHaveBeenCalledTimes(1);
    });

    it("考勤加载中（首屏）不渲染状态 chip 与签到按钮，显示占位符", () => {
      mockUseRehearsals.mockReturnValue({
        data: [
          // 进行中、无考勤记录：此前会错误显示签到按钮
          makeRehearsalAt(1, "2026-08-15T20:00:00", "今晚排练"),
          // 已结束、无考勤记录：此前会错误显示缺勤 chip
          makeRehearsalAt(2, "2026-08-15T08:00:00", "上午排练"),
        ],
        loading: false,
        error: null,
        saving: false,
        fetch: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      });
      // map 尚未加载完成（初始 loading 为 true / 刷新间隙）
      mockUseAttendance.mockReturnValue({ ...defaultAttendanceMock, loading: true });
      render(<Home />, { wrapper: UserProvider });

      // 不渲染签到按钮、不出勤状态 chip（「已结束」标签已随 Issue #164 移除）
      expect(screen.queryByRole("button", { name: "签到" })).toBeNull();
      expect(screen.queryByText(/出席|迟到|缺勤|请假/)).toBeNull();
      // 两张卡片均以占位符示意加载中
      expect(screen.getAllByText("…")).toHaveLength(2);
    });

    it("考勤加载完成后（loading=false）恢复正常渲染", () => {
      mockUseRehearsals.mockReturnValue({
        data: [makeRehearsalAt(1, "2026-08-15T20:00:00", "今晚排练")],
        loading: false,
        error: null,
        saving: false,
        fetch: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      });
      mockUseAttendance.mockReturnValue({ ...defaultAttendanceMock, loading: false });
      render(<Home />, { wrapper: UserProvider });

      expect(screen.getByRole("button", { name: "签到" })).toBeTruthy();
      expect(screen.queryByText("…")).toBeNull();
    });
  });

  // ============================================================
  // 5.8.5 覆盖请假签到（Issue #155）：签到成功后撤销 pending/approved 申请
  // ============================================================
  describe("覆盖请假签到（Issue #155）", () => {
    beforeEach(() => {
      // 固定系统时间 2026-08-15 21:00：当天 20:00-22:00 排练恒为"进行中"（签到窗口判定与真实运行时刻无关）
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 7, 15, 21, 0, 0));
      vi.spyOn(window, "alert").mockImplementation(() => {});
      mockUseAttendance.mockReturnValue({
        ...defaultAttendanceMock,
        upsert: vi.fn().mockResolvedValue(null),
      });
      mockUseLeaveRequests.mockReturnValue(defaultLeaveRequestsMock());
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
      // 复位 leave mock 默认值，避免本组用例的 data 覆盖泄漏到后续用例
      mockUseLeaveRequests.mockReturnValue(defaultLeaveRequestsMock());
    });

    function makeOngoingRehearsal(
      opts: { type?: "full" | "section"; signInCode?: string | null } = {},
    ) {
      return {
        id: 1,
        repertoire: "今晚排练",
        type: opts.type ?? "full",
        start_time: "2026-08-15T20:00:00",
        end_time: "2026-08-15T22:00:00",
        location: "排练厅",
        title: null,
        date: null,
        time: null,
        sign_in_code: opts.signInCode ?? null,
        target_section: null,
        created_at: null,
        updated_at: "2026-08-14T00:00:00.000Z",
        updated_fields: null,
      };
    }

    function renderLoggedInWithRehearsal(rehearsal: ReturnType<typeof makeOngoingRehearsal>) {
      mockUseRehearsals.mockReturnValue({
        data: [rehearsal],
        loading: false,
        error: null,
        saving: false,
        fetch: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      });
      return render(
        <UserProvider>
          <WithLoggedInUser
            user={{ id: "test-id", name: "张三", role: "member", section: "小提琴" }}
          >
            <Home />
          </WithLoggedInUser>
        </UserProvider>,
      );
    }

    it("分排直签成功：签到后撤销该排练的 pending/approved 申请（cancelOnSignIn）", async () => {
      renderLoggedInWithRehearsal(makeOngoingRehearsal({ type: "section" }));
      fireEvent.click(screen.getByTestId("toggle-section"));

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "签到" }));
      });
      expect(leaveRequestsHookMock.cancelOnSignIn).toHaveBeenCalledWith(1);
    });

    it("合排签到码提交成功：同样撤销该排练的申请", async () => {
      renderLoggedInWithRehearsal(makeOngoingRehearsal({ signInCode: "8848" }));

      fireEvent.click(screen.getByRole("button", { name: "签到" }));
      fireEvent.change(screen.getByPlaceholderText("如：8848"), {
        target: { value: "8848" },
      });
      await act(async () => {
        fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
      });
      expect(leaveRequestsHookMock.cancelOnSignIn).toHaveBeenCalledWith(1);
    });

    it("签到失败（upsert 返回错误）：不撤销申请", async () => {
      mockUseAttendance.mockReturnValue({
        ...defaultAttendanceMock,
        upsert: vi.fn().mockResolvedValue("签到失败"),
      });
      renderLoggedInWithRehearsal(makeOngoingRehearsal({ type: "section" }));
      fireEvent.click(screen.getByTestId("toggle-section"));

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "签到" }));
      });
      expect(leaveRequestsHookMock.cancelOnSignIn).not.toHaveBeenCalled();
    });

    it("进行中 + 待审批申请：卡片签到按钮变黄「覆盖请假」（warning 色系）", () => {
      mockUseLeaveRequests.mockReturnValue(
        defaultLeaveRequestsMock({
          data: [{ id: "lr-1", rehearsal_id: 1, status: "pending" }] as unknown as ReturnType<
            typeof useLeaveRequests
          >["data"],
        }),
      );
      renderLoggedInWithRehearsal(makeOngoingRehearsal());

      const btn = screen.getByRole("button", { name: "覆盖请假" });
      expect(btn.className).toContain("bg-warning-bg");
      expect(btn.className).toContain("text-warning");
      expect(screen.queryByRole("button", { name: "签到" })).toBeNull();
    });

    it("进行中 + 已通过申请 + 出勤已写请假（excused）：黄色「覆盖请假」按钮替代请假 chip（返工）", () => {
      // 审批通过会把考勤写成 excused（statusChip 命中「请假」chip），但已批准请假的成员
      // 仍应可签到覆盖：页面经 leaveRequestMap 传入 approved 申请，卡片渲染覆盖按钮
      mockUseLeaveRequests.mockReturnValue(
        defaultLeaveRequestsMock({
          data: [{ id: "lr-1", rehearsal_id: 1, status: "approved" }] as unknown as ReturnType<
            typeof useLeaveRequests
          >["data"],
        }),
      );
      mockUseAttendance.mockReturnValue({
        ...defaultAttendanceMock,
        map: { 1: { status: "excused", sign_in_time: null } },
      });
      renderLoggedInWithRehearsal(makeOngoingRehearsal());

      const btn = screen.getByRole("button", { name: "覆盖请假" });
      expect(btn.className).toContain("bg-warning-bg");
      expect(btn.className).toContain("text-warning");
      expect(screen.queryByRole("button", { name: "签到" })).toBeNull();
      // 请假 chip 被覆盖按钮替代，申请状态 chip 仍在下方展示「已通过」
      expect(screen.queryByText(/⭕\s*请假/)).toBeNull();
      expect(screen.getByText("已通过")).toBeTruthy();
    });

    it("签到成功但撤销申请网络失败（reason: network）：提示联系管理员处理（返工）", async () => {
      leaveRequestsHookMock.cancelOnSignIn.mockResolvedValueOnce({
        ok: false,
        reason: "network",
      });
      renderLoggedInWithRehearsal(makeOngoingRehearsal({ type: "section" }));
      fireEvent.click(screen.getByTestId("toggle-section"));

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "签到" }));
      });
      expect(leaveRequestsHookMock.cancelOnSignIn).toHaveBeenCalledWith(1);
      // 签到已成功，仅追加中性提示：approved 申请成员端无手动处理入口，指引联系管理员（返工）
      expect(window.alert).toHaveBeenCalledWith("签到成功，但请假申请取消失败，请联系管理员处理");
    });

    it("签到成功但撤销申请已被管理员并发处理（reason: already-processed）：提示无需取消（返工）", async () => {
      // SELECT 后 UPDATE 前管理员已驳回/审批全部申请 → 0 行更新；申请已不归成员掌控，
      // 无需取消，仅中性告知（不再指引「稍后手动处理」——approved 申请成员端无入口）
      leaveRequestsHookMock.cancelOnSignIn.mockResolvedValueOnce({
        ok: false,
        reason: "already-processed",
      });
      renderLoggedInWithRehearsal(makeOngoingRehearsal({ type: "section" }));
      fireEvent.click(screen.getByTestId("toggle-section"));

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "签到" }));
      });
      expect(leaveRequestsHookMock.cancelOnSignIn).toHaveBeenCalledWith(1);
      expect(window.alert).toHaveBeenCalledWith("签到成功，请假申请已被管理员处理，无需取消");
    });

    it("覆盖请假打开签到码弹窗：显示提醒文案", () => {
      mockUseLeaveRequests.mockReturnValue(
        defaultLeaveRequestsMock({
          data: [{ id: "lr-1", rehearsal_id: 1, status: "approved" }] as unknown as ReturnType<
            typeof useLeaveRequests
          >["data"],
        }),
      );
      renderLoggedInWithRehearsal(makeOngoingRehearsal({ signInCode: "8848" }));

      fireEvent.click(screen.getByRole("button", { name: "覆盖请假" }));
      expect(screen.getByText("请假后签到会覆盖请假状态，并记录实际出勤")).toBeTruthy();
    });
  });

  // ============================================================
  // 5.9 列表滚动容器（Issue #146）：页面固定视口链路下，排练列表需独立滚动
  // ============================================================
  describe("列表滚动容器（Issue #146）", () => {
    it("页面根容器为 flex 列布局且占满视口高度", () => {
      const { container } = render(<Home />, { wrapper: UserProvider });
      const root = container.firstElementChild as HTMLElement;
      expect(root.className).toContain("flex-col");
      expect(root.className).toContain("h-full");
    });

    it("排练列表 section 可独立滚动（flex-1 + overflow-y-auto）", () => {
      const { container } = render(<Home />, { wrapper: UserProvider });
      const section = container.querySelector("section") as HTMLElement | null;
      expect(section).toBeTruthy();
      expect(section!.className).toContain("flex-1");
      expect(section!.className).toContain("overflow-y-auto");
    });
  });
});
