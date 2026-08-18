/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import ProfilePage from "./page";
import { useUser } from "@/context/user-context";
import { useProfiles } from "@/hooks/useProfiles";
import { supabase } from "@/lib/supabase";
import { formatDateTimeInChina } from "@/lib/date-utils";
import type { ProfileRow } from "@/types/database";

// 通知上下文 mock（hoisted：未读数可在各用例中动态配置）
const { mockUseNotificationsContext } = vi.hoisted(() => ({
  mockUseNotificationsContext: vi.fn(),
}));

// supabase 查询链 mock（hoisted：信箱消息列表查询走 from → select → eq → order → then）
const { mockFrom, mockSelect, mockEq, mockOrder, mockThen } = vi.hoisted(() => {
  const chain: Record<string, unknown> = {};
  const mockSelect = vi.fn();
  const mockEq = vi.fn();
  const mockOrder = vi.fn();
  const mockThen = vi.fn();
  const mockFrom = vi.fn();
  chain.select = mockSelect;
  chain.eq = mockEq;
  chain.order = mockOrder;
  chain.then = mockThen;
  mockSelect.mockReturnValue(chain);
  mockEq.mockReturnValue(chain);
  mockOrder.mockReturnValue(chain);
  mockFrom.mockReturnValue(chain);
  return { mockFrom, mockSelect, mockEq, mockOrder, mockThen };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/context/user-context", () => ({
  useUser: vi.fn(),
}));

vi.mock("@/context/notification-context", () => ({
  useNotificationsContext: () => mockUseNotificationsContext(),
}));

vi.mock("@/hooks/useProfiles", () => ({
  useProfiles: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { updateUser: vi.fn().mockResolvedValue({ error: null }) },
    from: mockFrom,
  },
}));

vi.mock("lucide-react", () => ({
  LogOut: () => <span>LogOut</span>,
}));

const mockUseUser = vi.mocked(useUser);
const mockUseProfiles = vi.mocked(useProfiles);

function mockProfile(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    id: "u1",
    college: null,
    created_at: null,
    email: "a@b.com",
    full_name: "张三",
    instrument: "小提琴",
    is_section_leader: false,
    join_date: null,
    phone_number: null,
    role: "member",
    status: "approved",
    ...overrides,
  };
}

function mockUseProfilesReturn(data: ProfileRow[]) {
  mockUseProfiles.mockReturnValue({
    data,
    loading: false,
    error: null,
    saving: false,
    fetch: vi.fn(),
    update: vi.fn().mockResolvedValue(true),
  } as never);
}

describe("ProfilePage 个人信息页", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseUser.mockReturnValue({
      user: { id: "u1", name: "张三", role: "member", section: "小提琴", email: "a@b.com" },
      login: vi.fn(),
      logout: vi.fn(),
    });
    // 通知上下文默认：全 0 未读（各用例按需覆盖）
    mockUseNotificationsContext.mockReturnValue({
      unreadCounts: { attendance: 0, activity: 0, system: 0 },
      totalUnread: 0,
      loading: false,
      refresh: vi.fn(),
      markCategoryRead: vi.fn().mockResolvedValue(true),
    });
    // 信箱消息列表查询默认返回空列表
    mockThen.mockImplementation((cb: (v: unknown) => void) => {
      cb({ data: [], error: null });
      return undefined;
    });
    // jsdom 的 alert 未实现，spy 并吞掉，用于断言提示
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("profile 未加载完成时点击个人信息给出提示且不打开弹窗", () => {
    mockUseProfilesReturn([]);
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /个人信息/ }));
    expect(window.alert).toHaveBeenCalledWith("个人信息加载中，请稍候再试");
    // 弹窗标题不出现
    expect(screen.queryByRole("heading", { name: "编辑个人信息" })).toBeNull();
  });

  it("profile 已加载时打开编辑弹窗并预填数据", () => {
    mockUseProfilesReturn([
      mockProfile({ phone_number: "13800138000", college: "信息科学技术学院" }),
    ]);
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /个人信息/ }));
    expect((screen.getByPlaceholderText("11 位手机号") as HTMLInputElement).value).toBe(
      "13800138000",
    );
    expect((screen.getByPlaceholderText("所在学院") as HTMLInputElement).value).toBe(
      "信息科学技术学院",
    );
  });

  it("手机号格式错误时提示错误且不调用 update", async () => {
    const update = vi.fn().mockResolvedValue(true);
    mockUseProfiles.mockReturnValue({
      data: [mockProfile({ phone_number: "13800138000" })],
      loading: false,
      error: null,
      saving: false,
      fetch: vi.fn(),
      update,
    } as never);
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /个人信息/ }));

    const phoneInput = screen.getByPlaceholderText("11 位手机号") as HTMLInputElement;
    fireEvent.change(phoneInput, { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText(/手机号格式不正确/)).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
    // 弹窗保持打开
    expect(screen.getByRole("heading", { name: "编辑个人信息" })).toBeInTheDocument();
  });

  it("保存成功时调用 update 并关闭弹窗、提示已更新", async () => {
    const update = vi.fn().mockResolvedValue(true);
    mockUseProfiles.mockReturnValue({
      data: [mockProfile({ phone_number: "13800138000" })],
      loading: false,
      error: null,
      saving: false,
      fetch: vi.fn(),
      update,
    } as never);
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /个人信息/ }));

    const collegeInput = screen.getByPlaceholderText("所在学院") as HTMLInputElement;
    fireEvent.change(collegeInput, { target: { value: "光华管理学院" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith("u1", {
        phone_number: "13800138000",
        college: "光华管理学院",
      });
    });
    expect(window.alert).toHaveBeenCalledWith("个人信息已更新");
    // 弹窗关闭
    expect(screen.queryByRole("heading", { name: "编辑个人信息" })).toBeNull();
  });

  it("保存失败时提示错误且不关闭弹窗", async () => {
    mockUseProfiles.mockReturnValue({
      data: [mockProfile()],
      loading: false,
      error: null,
      saving: false,
      fetch: vi.fn(),
      update: vi.fn().mockResolvedValue(false),
    } as never);
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /个人信息/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText("保存失败，请重试")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "编辑个人信息" })).toBeInTheDocument();
  });

  it("防重复提交：保存进行中双击只调用一次 update", async () => {
    let resolveUpdate!: (v: boolean) => void;
    const pending = new Promise<boolean>((resolve) => {
      resolveUpdate = resolve;
    });
    const update = vi.fn().mockReturnValue(pending);
    mockUseProfiles.mockReturnValue({
      data: [mockProfile()],
      loading: false,
      error: null,
      saving: false,
      fetch: vi.fn(),
      update,
    } as never);
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /个人信息/ }));

    const saveBtn = screen.getByRole("button", { name: "保存" });
    fireEvent.click(saveBtn);
    fireEvent.click(saveBtn);
    expect(update).toHaveBeenCalledTimes(1);

    // 保存中按钮进入提交态
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "保存中..." })).toBeDisabled();
    });

    await act(async () => {
      resolveUpdate(true);
    });
  });

  it("渲染通知/设置栏目标题与全部按钮行", () => {
    mockUseProfilesReturn([mockProfile()]);
    render(<ProfilePage />);
    expect(screen.getByRole("heading", { name: "通知" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
    // 通知栏目 3 行
    for (const label of ["考勤与请假", "活动", "系统"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    // 设置栏目 7 行（含占位项与已接线的个人信息/账号与密码/退出登录）
    for (const label of ["个人信息", "账号与密码", "考勤", "外观", "已发布的活动", "问题与反馈"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /退出登录/ })).toBeInTheDocument();
  });

  // ============================================================
  // Issue #188：通知信箱（未读徽章 / 消息列表 / 打开即已读）
  // ============================================================
  it("未读徽章：>0 时按钮右侧红色数字，0 时隐藏", () => {
    mockUseProfilesReturn([mockProfile()]);
    mockUseNotificationsContext.mockReturnValue({
      unreadCounts: { attendance: 2, activity: 0, system: 1 },
      totalUnread: 3,
      loading: false,
      refresh: vi.fn(),
      markCategoryRead: vi.fn().mockResolvedValue(true),
    });
    render(<ProfilePage />);
    // 考勤与请假 2、系统 1：红色数字徽章（语义 Token）
    const badge2 = screen.getByText("2");
    expect(badge2.className).toContain("bg-danger");
    expect(badge2.className).toContain("text-danger-foreground");
    // 锚定正则匹配：徽章数字并入按钮可访问名（如「系统 1」），并避免与设置栏「已发布的活动」混淆
    expect(screen.getByRole("button", { name: /^系统/ }).textContent).toContain("1");
    // 活动 0 未读：无数字徽章
    expect(screen.getByRole("button", { name: /^活动/ }).textContent).not.toMatch(/\d/);
  });

  it("点击信箱打开 Modal：渲染消息标题/内容/时间，查询仅限该分类且倒序", async () => {
    mockUseProfilesReturn([mockProfile()]);
    const messages = [
      {
        id: "n1",
        user_id: "u1",
        category: "attendance",
        title: "请假申请已通过",
        content: "《贝多芬第五交响曲》排练的请假申请已通过",
        created_at: "2026-08-18T10:00:00+08:00",
        read_at: null,
      },
    ];
    mockThen.mockImplementation((cb: (v: unknown) => void) => {
      cb({ data: messages, error: null });
      return undefined;
    });
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /考勤与请假/ }));
    // Modal 标题 = 信箱名
    expect(screen.getByRole("heading", { name: "考勤与请假" })).toBeInTheDocument();
    expect(screen.getByText("请假申请已通过")).toBeInTheDocument();
    expect(screen.getByText("《贝多芬第五交响曲》排练的请假申请已通过")).toBeInTheDocument();
    // 时间用与页面相同的格式化函数计算期望值，避免时区依赖
    const expectedTime = formatDateTimeInChina("2026-08-18T10:00:00+08:00");
    expect(screen.getByText(expectedTime)).toBeInTheDocument();
    // 查询条件：notifications 表、只查该分类、created_at 倒序
    expect(mockFrom).toHaveBeenCalledWith("notifications");
    expect(mockSelect).toHaveBeenCalledWith("*");
    expect(mockEq).toHaveBeenCalledWith("category", "attendance");
    expect(mockOrder).toHaveBeenCalledWith("created_at", { ascending: false });
  });

  it("信箱空列表显示「暂无消息」（系统信箱可正常打开），已读调用传空 ids", async () => {
    const markCategoryRead = vi.fn().mockResolvedValue(true);
    mockUseNotificationsContext.mockReturnValue({
      unreadCounts: { attendance: 0, activity: 0, system: 0 },
      totalUnread: 0,
      loading: false,
      refresh: vi.fn(),
      markCategoryRead,
    });
    mockUseProfilesReturn([mockProfile()]);
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /系统/ }));
    expect(screen.getByRole("heading", { name: "系统" })).toBeInTheDocument();
    expect(screen.getByText("暂无消息")).toBeInTheDocument();
    // 该分类本无未读：跳过 update 直接归零（空 ids 语义）
    await waitFor(() => {
      expect(markCategoryRead).toHaveBeenCalledWith("system", []);
    });
  });

  it("打开信箱即标记已读：只传本次 fetch 到的未读消息 id（已读行不重复标记）", async () => {
    const markCategoryRead = vi.fn().mockResolvedValue(true);
    mockUseNotificationsContext.mockReturnValue({
      unreadCounts: { attendance: 3, activity: 0, system: 0 },
      totalUnread: 3,
      loading: false,
      refresh: vi.fn(),
      markCategoryRead,
    });
    mockUseProfilesReturn([mockProfile()]);
    mockThen.mockImplementation((cb: (v: unknown) => void) => {
      cb({
        data: [
          { id: "n1", read_at: null },
          { id: "n2", read_at: "2026-08-18T10:00:00+08:00" },
        ],
        error: null,
      });
      return undefined;
    });
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /考勤与请假/ }));
    await waitFor(() => {
      expect(markCategoryRead).toHaveBeenCalledWith("attendance", ["n1"]);
    });
  });

  it("消息查询失败：显示「加载失败」且不标已读（markCategoryRead 不被调用）", async () => {
    const markCategoryRead = vi.fn().mockResolvedValue(true);
    mockUseNotificationsContext.mockReturnValue({
      unreadCounts: { attendance: 3, activity: 0, system: 0 },
      totalUnread: 3,
      loading: false,
      refresh: vi.fn(),
      markCategoryRead,
    });
    mockUseProfilesReturn([mockProfile()]);
    mockThen.mockImplementation((cb: (v: unknown) => void) => {
      cb({ data: null, error: { message: "网络错误" } });
      return undefined;
    });
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /考勤与请假/ }));
    expect(screen.getByRole("heading", { name: "考勤与请假" })).toBeInTheDocument();
    expect(screen.getByText("加载失败，请稍后重试")).toBeInTheDocument();
    expect(screen.queryByText("暂无消息")).toBeNull();
    // fetch 失败不标已读：用户未看到消息，未读数保持
    expect(markCategoryRead).not.toHaveBeenCalled();
  });

  it("点击占位按钮弹出底部 Modal：标题为按钮名，内容为功能开发中", () => {
    mockUseProfilesReturn([mockProfile()]);
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: "外观" }));
    expect(screen.getByRole("heading", { name: "外观" })).toBeInTheDocument();
    expect(screen.getByText("功能开发中")).toBeInTheDocument();
    // 关闭后占位弹窗消失
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("heading", { name: "外观" })).toBeNull();
  });

  it("点击退出登录调用 logout", () => {
    const logout = vi.fn();
    mockUseUser.mockReturnValue({
      user: { id: "u1", name: "张三", role: "member", section: "小提琴", email: "a@b.com" },
      login: vi.fn(),
      logout,
    });
    mockUseProfilesReturn([mockProfile()]);
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /退出登录/ }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("弹窗打开时锁定背景滚动，关闭后恢复", () => {
    mockUseProfilesReturn([mockProfile()]);
    const { container } = render(<ProfilePage />);
    // 页面根节点是滚动容器（整页滚动豁免）
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("overflow-y-auto");
    // 打开弹窗后根节点切为 overflow-hidden（防滚动穿透）
    fireEvent.click(screen.getByRole("button", { name: "外观" }));
    expect(root.className).toContain("overflow-hidden");
    expect(root.className).not.toContain("overflow-y-auto");
    // 关闭弹窗后恢复滚动
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(root.className).toContain("overflow-y-auto");
    expect(root.className).not.toContain("overflow-hidden");
  });

  it("改密防重复提交：提交中双击只调用一次 updateUser，完成后弹窗关闭", async () => {
    let resolveUpdate!: (v: { error: null }) => void;
    const pending = new Promise<{ error: null }>((resolve) => {
      resolveUpdate = resolve;
    });
    const updateUser = vi.mocked(supabase.auth.updateUser);
    updateUser.mockReturnValue(pending as never);
    mockUseProfilesReturn([mockProfile()]);
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: "账号与密码" }));
    fireEvent.change(screen.getByPlaceholderText("至少 6 位"), { target: { value: "123456" } });
    fireEvent.change(screen.getByPlaceholderText("再次输入"), { target: { value: "123456" } });

    const submitBtn = screen.getByRole("button", { name: "确认修改" });
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);
    // ref 同步阻断：双击只发一次请求
    expect(updateUser).toHaveBeenCalledTimes(1);
    // 提交中按钮进入提交态且禁用，弹窗无法通过守卫关闭
    expect(screen.getByRole("button", { name: "提交中..." })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.getByRole("heading", { name: "修改登录密码" })).toBeInTheDocument();

    // 提交完成后（finally 复位）弹窗正常关闭
    await act(async () => {
      resolveUpdate({ error: null });
    });
    expect(screen.queryByRole("heading", { name: "修改登录密码" })).toBeNull();
  });

  it("改密失败(reject)时 finally 复位：弹窗不锁死、可正常关闭", async () => {
    // 实现无 catch（与编辑弹窗同模式），updateUser reject 会冒泡为 unhandled rejection。
    // vitest 4 语义：process 上存在其他 unhandledRejection 监听器时视为用户代码已处理、
    // 不判测试失败（见 node_modules/vitest init.k9zZ9sLh.js catchError 的 listeners 长度检查），
    // 此处挂一个监听器静默捕获并断言 reject 确实发生。测试结束时务必移除。
    const onUnhandledRejection = vi.fn();
    process.on("unhandledRejection", onUnhandledRejection);
    try {
      // afterEach 的 vi.restoreAllMocks() 已抹掉 vi.mock 工厂默认实现，
      // 每个用例需自设 updateUser 的返回值（下同，reject 路径用 mockRejectedValue）
      const updateUser = vi.mocked(supabase.auth.updateUser);
      updateUser.mockRejectedValue(new Error("network error"));
      mockUseProfilesReturn([mockProfile()]);
      render(<ProfilePage />);
      fireEvent.click(screen.getByRole("button", { name: "账号与密码" }));
      fireEvent.change(screen.getByPlaceholderText("至少 6 位"), { target: { value: "123456" } });
      fireEvent.change(screen.getByPlaceholderText("再次输入"), { target: { value: "123456" } });

      // act 内触发提交，让 reject 微任务在 act 内消化，避免 React act 告警
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "确认修改" }));
      });
      expect(updateUser).toHaveBeenCalledTimes(1);
      // reject 确实发生（被上面的监听器静默捕获）
      await waitFor(() => {
        expect(onUnhandledRejection).toHaveBeenCalled();
      });

      // finally 已复位：按钮回到「确认修改」且可用，弹窗未被守卫锁死
      expect(screen.getByRole("button", { name: "确认修改" })).not.toBeDisabled();
      // reject 路径不弹任何提示
      expect(window.alert).not.toHaveBeenCalled();
      // 关闭按钮可用，能正常关窗
      const closeBtn = screen.getByRole("button", { name: "关闭" });
      expect(closeBtn).not.toBeDisabled();
      fireEvent.click(closeBtn);
      expect(screen.queryByRole("heading", { name: "修改登录密码" })).toBeNull();
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });
});
