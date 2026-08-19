/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import ProfilePage from "./page";
import { useUser } from "@/context/user-context";
import { ThemeProvider } from "@/context/theme-context";
import { useProfiles } from "@/hooks/useProfiles";
import { usePosts } from "@/hooks/usePosts";
import { supabase } from "@/lib/supabase";
import { formatDateTimeInChina, formatRehearsalRange } from "@/lib/date-utils";
import { summarizeAttendance, type AttendanceSummaryRow } from "@/lib/attendance-summary";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import type { ProfileRow } from "@/types/database";

// 通知上下文 mock（hoisted：未读数可在各用例中动态配置）
const { mockUseNotificationsContext } = vi.hoisted(() => ({
  mockUseNotificationsContext: vi.fn(),
}));

// supabase 查询链 mock（hoisted：信箱/考勤查询走 from → select → eq → (gte/lt) → order → then；
// 反馈提交走 from → insert → await，不链 select（Issue #209））
const { mockFrom, mockSelect, mockEq, mockGte, mockLt, mockOrder, mockThen, mockInsert } =
  vi.hoisted(() => {
    const chain: Record<string, unknown> = {};
    const mockSelect = vi.fn();
    const mockEq = vi.fn();
    const mockGte = vi.fn();
    const mockLt = vi.fn();
    const mockOrder = vi.fn();
    const mockThen = vi.fn();
    const mockInsert = vi.fn();
    const mockFrom = vi.fn();
    chain.select = mockSelect;
    chain.eq = mockEq;
    chain.gte = mockGte;
    chain.lt = mockLt;
    chain.order = mockOrder;
    chain.then = mockThen;
    chain.insert = mockInsert;
    mockSelect.mockReturnValue(chain);
    mockEq.mockReturnValue(chain);
    mockGte.mockReturnValue(chain);
    mockLt.mockReturnValue(chain);
    mockOrder.mockReturnValue(chain);
    // 默认插入成功（vi.clearAllMocks 保留实现，各用例按需覆盖）
    mockInsert.mockResolvedValue({ data: null, error: null });
    mockFrom.mockReturnValue(chain);
    return { mockFrom, mockSelect, mockEq, mockGte, mockLt, mockOrder, mockThen, mockInsert };
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

vi.mock("@/hooks/usePosts", () => ({
  usePosts: vi.fn(),
}));

// PublishModal（编辑弹窗）提交时才用到，避免 jsdom 中加载浏览器模块副作用
vi.mock("browser-image-compression", () => ({
  default: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      updateUser: vi.fn().mockResolvedValue({ error: null }),
      getUser: vi.fn(),
    },
    from: mockFrom,
  },
}));

vi.mock("lucide-react", () => ({
  LogOut: () => <span>LogOut</span>,
}));

// 主题相关用例的 matchMedia mock（jsdom 未实现 matchMedia，Issue #203）
function mockMatchMedia(dark: boolean) {
  const listeners = new Set<(e: { matches: boolean }) => void>();
  const mql = {
    matches: dark,
    media: "(prefers-color-scheme: dark)",
    addEventListener: vi.fn((_type: string, cb: (e: { matches: boolean }) => void) => {
      listeners.add(cb);
    }),
    removeEventListener: vi.fn((_type: string, cb: (e: { matches: boolean }) => void) => {
      listeners.delete(cb);
    }),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => mql),
  );
  return mql;
}

const mockUseUser = vi.mocked(useUser);
const mockUseProfiles = vi.mocked(useProfiles);
const mockUsePosts = vi.mocked(usePosts);

function mockProfile(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    id: "u1",
    college: null,
    created_at: null,
    email: "a@b.com",
    full_name: "张三",
    hide_email: false,
    hide_join_date: false,
    hide_phone: false,
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

// 主题 context 需要 provider 包裹（全站共享，对抗返工 Issue #203）：
// useThemeContext 在 Provider 外抛错，统一渲染入口
function renderPage() {
  return render(
    <ThemeProvider>
      <ProfilePage />
    </ThemeProvider>,
  );
}

/** 构造考勤 join 排练行（仅展示所需字段；overrides 可覆盖任意字段） */
function mockAttendanceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    user_id: "u1",
    rehearsal_id: 10,
    status: "present",
    sign_in_time: "2026-08-10T19:00:00",
    rehearsals: {
      start_time: "2026-08-10T19:00:00",
      end_time: "2026-08-10T21:00:00",
      location: "排练厅",
      repertoire: "贝多芬第五交响曲",
    },
    ...overrides,
  };
}

describe("ProfilePage 个人信息页", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear(); // 主题用例隔离（Issue #203），不影响既有用例
    document.documentElement.removeAttribute("data-theme");
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
    // profiles.email 同步 effect 的 auth 来源（Issue #199 对抗返工）：默认与 myProfile.email
    // 一致（a@b.com），现有用例不触发补写；差异场景用例按需覆盖
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: "u1", email: "a@b.com" } },
      error: null,
    } as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals(); // 恢复 matchMedia mock（主题用例）
    vi.restoreAllMocks();
  });

  it("profile 未加载完成时点击个人信息给出提示且不打开弹窗", () => {
    mockUseProfilesReturn([]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /个人信息/ }));
    expect(window.alert).toHaveBeenCalledWith("个人信息加载中，请稍候再试");
    // 弹窗标题不出现
    expect(screen.queryByRole("heading", { name: "编辑个人信息" })).toBeNull();
  });

  it("profile 已加载时打开编辑弹窗并预填数据", () => {
    mockUseProfilesReturn([
      mockProfile({ phone_number: "13800138000", college: "信息科学技术学院" }),
    ]);
    renderPage();
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
    renderPage();
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
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /个人信息/ }));

    const collegeInput = screen.getByPlaceholderText("所在学院") as HTMLInputElement;
    fireEvent.change(collegeInput, { target: { value: "光华管理学院" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith("u1", {
        phone_number: "13800138000",
        college: "光华管理学院",
        hide_email: false,
        hide_phone: false,
        hide_join_date: false,
      });
      // 未触碰入团时间：payload 不写 join_date（保留原值，防误清空历史格式数据）
      expect(update.mock.calls[0][1]).not.toHaveProperty("join_date");
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
    renderPage();
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
    renderPage();
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

  // ============================================================
  // Issue #193：编辑弹窗新增入团时间 + 三个隐私开关
  // ============================================================
  it("打开编辑弹窗预填日期输入与三个隐私开关（隐藏/公开），邮箱行仅展示不可编辑", () => {
    mockUseProfilesReturn([
      mockProfile({
        phone_number: "13800138000",
        college: "信息科学技术学院",
        join_date: "2024-09-01",
        hide_email: true,
        hide_phone: false,
        hide_join_date: true,
      }),
    ]);
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /个人信息/ }));

    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    expect(dateInput.value).toBe("2024-09-01");
    // 三个隐私开关共 6 个按钮：邮箱「隐藏」激活、手机号「公开」激活、入团时间「隐藏」激活
    const hiddenButtons = screen.getAllByRole("button", { name: "隐藏" });
    expect(hiddenButtons).toHaveLength(3);
    expect(hiddenButtons[0].className).toContain("bg-primary");
    expect(hiddenButtons[1].className).not.toContain("bg-primary");
    expect(hiddenButtons[2].className).toContain("bg-primary");
    expect(screen.getAllByRole("button", { name: "公开" })[1].className).toContain("bg-primary");
    // 邮箱不可编辑：只读展示当前值
    expect(screen.getByText("a@b.com")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("邮箱")).toBeNull();
  });

  it("切换隐私开关并填写入团时间后保存，payload 包含开关值与 join_date", async () => {
    const update = vi.fn().mockResolvedValue(true);
    // 标准格式原值被改动：按新语义先弹确认，这里同意覆盖
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockUseProfiles.mockReturnValue({
      data: [mockProfile({ phone_number: "13800138000", join_date: "2024-09-01" })],
      loading: false,
      error: null,
      saving: false,
      fetch: vi.fn(),
      update,
    } as never);
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /个人信息/ }));

    // 手机号隐私开关切到「隐藏」（第二个 Toggle）
    fireEvent.click(screen.getAllByRole("button", { name: "隐藏" })[1]);
    // 入团时间改为新日期（touched）
    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2025-03-01" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith("u1", {
        phone_number: "13800138000",
        college: null,
        join_date: "2025-03-01",
        hide_email: false,
        hide_phone: true,
        hide_join_date: false,
      });
    });
  });

  it("历史学期格式入团时间（如「2024秋」）未改动时保存不写 join_date，防误清空", async () => {
    const update = vi.fn().mockResolvedValue(true);
    mockUseProfiles.mockReturnValue({
      data: [mockProfile({ phone_number: "13800138000", join_date: "2024秋" })],
      loading: false,
      error: null,
      saving: false,
      fetch: vi.fn(),
      update,
    } as never);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /个人信息/ }));

    // 原值非日期格式：显示「当前值」只读提示（date input 无法显示学期格式）
    expect(screen.getByText(/当前值：2024秋/)).toBeInTheDocument();
    // 未改动直接保存：不弹确认、不写 join_date
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith("u1", {
        phone_number: "13800138000",
        college: null,
        hide_email: false,
        hide_phone: false,
        hide_join_date: false,
      });
      expect(update.mock.calls[0][1]).not.toHaveProperty("join_date");
    });
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("学期格式原值被改动（手滑覆盖）时先弹确认框：取消则不保存", async () => {
    const update = vi.fn().mockResolvedValue(true);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    mockUseProfiles.mockReturnValue({
      data: [mockProfile({ phone_number: "13800138000", join_date: "2024秋" })],
      loading: false,
      error: null,
      saving: false,
      fetch: vi.fn(),
      update,
    } as never);
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /个人信息/ }));
    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    // 手滑打开日期选择器默认选中今天
    fireEvent.change(dateInput, { target: { value: "2026-08-19" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledWith(
        "保存将把入团时间从「2024秋」变更为「2026-08-19」，确认？",
      );
    });
    // 用户取消：不提交、弹窗保持打开
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "编辑个人信息" })).toBeInTheDocument();
  });

  it("标准格式原值被改动（手滑覆盖）时也先弹确认：取消则不保存", async () => {
    const update = vi.fn().mockResolvedValue(true);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    mockUseProfiles.mockReturnValue({
      data: [mockProfile({ phone_number: "13800138000", join_date: "2024-09-01" })],
      loading: false,
      error: null,
      saving: false,
      fetch: vi.fn(),
      update,
    } as never);
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /个人信息/ }));
    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    // 标准格式原值可正常预填，手滑打开日期选择器默认选中「今天」→ 值变化
    fireEvent.change(dateInput, { target: { value: "2026-08-19" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledWith(
        "保存将把入团时间从「2024-09-01」变更为「2026-08-19」，确认？",
      );
    });
    // 用户取消：不提交、弹窗保持打开
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "编辑个人信息" })).toBeInTheDocument();
  });

  it("原值为空时填写入团时间：确认文案显示「当前为空」，同意后写入", async () => {
    const update = vi.fn().mockResolvedValue(true);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    mockUseProfiles.mockReturnValue({
      data: [mockProfile({ phone_number: "13800138000", join_date: null })],
      loading: false,
      error: null,
      saving: false,
      fetch: vi.fn(),
      update,
    } as never);
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /个人信息/ }));
    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2024-09-01" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledWith(
        "保存将把入团时间从「当前为空」变更为「2024-09-01」，确认？",
      );
      expect(update).toHaveBeenCalledWith("u1", {
        phone_number: "13800138000",
        college: null,
        join_date: "2024-09-01",
        hide_email: false,
        hide_phone: false,
        hide_join_date: false,
      });
    });
  });

  it("学期格式原值确认覆盖后保存：payload 写入新日期", async () => {
    const update = vi.fn().mockResolvedValue(true);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockUseProfiles.mockReturnValue({
      data: [mockProfile({ phone_number: "13800138000", join_date: "2024秋" })],
      loading: false,
      error: null,
      saving: false,
      fetch: vi.fn(),
      update,
    } as never);
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /个人信息/ }));
    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-08-19" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith("u1", {
        phone_number: "13800138000",
        college: null,
        join_date: "2026-08-19",
        hide_email: false,
        hide_phone: false,
        hide_join_date: false,
      });
    });
  });

  it("入团时间值未变化（手滑点到同一天）时不写入 join_date", async () => {
    const update = vi.fn().mockResolvedValue(true);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    mockUseProfiles.mockReturnValue({
      data: [mockProfile({ phone_number: "13800138000", join_date: "2024-09-01" })],
      loading: false,
      error: null,
      saving: false,
      fetch: vi.fn(),
      update,
    } as never);
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /个人信息/ }));
    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    // 手滑打开又选中了同一天：值未变化，不写 join_date 也不弹确认（无论原值格式）
    fireEvent.change(dateInput, { target: { value: "2024-09-01" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith("u1", {
        phone_number: "13800138000",
        college: null,
        hide_email: false,
        hide_phone: false,
        hide_join_date: false,
      });
      expect(update.mock.calls[0][1]).not.toHaveProperty("join_date");
    });
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("渲染通知/设置栏目标题与全部按钮行", () => {
    mockUseProfilesReturn([mockProfile()]);
    renderPage();
    expect(screen.getByRole("heading", { name: "通知" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
    // 通知栏目 3 行
    for (const label of ["考勤与请假", "活动", "系统"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    // 设置栏目全部按钮行（个人信息/账号与密码/考勤/外观/已发布的活动/问题与反馈 Issue #209/退出登录）
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
    renderPage();
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
        // Issue #192 文案：日期 + 曲目 + 类型（合排）
        content: "8月18日《贝多芬第五交响曲》的合排请假申请已通过",
        created_at: "2026-08-18T10:00:00+08:00",
        read_at: null,
      },
    ];
    mockThen.mockImplementation((cb: (v: unknown) => void) => {
      cb({ data: messages, error: null });
      return undefined;
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /考勤与请假/ }));
    // Modal 标题 = 信箱名
    expect(screen.getByRole("heading", { name: "考勤与请假" })).toBeInTheDocument();
    expect(screen.getByText("请假申请已通过")).toBeInTheDocument();
    expect(screen.getByText("8月18日《贝多芬第五交响曲》的合排请假申请已通过")).toBeInTheDocument();
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
    renderPage();
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
    renderPage();
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
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /考勤与请假/ }));
    expect(screen.getByRole("heading", { name: "考勤与请假" })).toBeInTheDocument();
    expect(screen.getByText("加载失败，请稍后重试")).toBeInTheDocument();
    expect(screen.queryByText("暂无消息")).toBeNull();
    // fetch 失败不标已读：用户未看到消息，未读数保持
    expect(markCategoryRead).not.toHaveBeenCalled();
  });

  // ============================================================
  // Issue #209：问题与反馈（匿名提交 + 双重 guard + 不链 select）
  // ============================================================
  it("点击「问题与反馈」打开底部 Modal：渲染说明、textarea 与提交按钮", () => {
    mockUseProfilesReturn([mockProfile()]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "问题与反馈" }));
    expect(screen.getByRole("heading", { name: "问题与反馈" })).toBeInTheDocument();
    expect(screen.getByText("匿名提交，管理员可在后台查看")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("写下你的问题或建议")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交" })).toBeInTheDocument();
    // 关闭后弹窗消失
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("heading", { name: "问题与反馈" })).toBeNull();
  });

  it("空内容提交：alert 提示且不调用 insert", () => {
    mockUseProfilesReturn([mockProfile()]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "问题与反馈" }));
    fireEvent.click(screen.getByRole("button", { name: "提交" }));
    expect(window.alert).toHaveBeenCalledWith("请填写反馈内容");
    expect(mockInsert).not.toHaveBeenCalled();
    // 弹窗保持打开
    expect(screen.getByRole("heading", { name: "问题与反馈" })).toBeInTheDocument();
  });

  it("提交成功：insert 不链 select、alert 提示、清空输入并关闭弹窗", async () => {
    mockUseProfilesReturn([mockProfile()]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "问题与反馈" }));
    // 先捕获 textarea 引用：成功关闭弹窗后元素随 Modal 卸载，无法再按 placeholder 查询
    const textarea = screen.getByPlaceholderText("写下你的问题或建议") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "希望增加曲库功能" } });
    fireEvent.click(screen.getByRole("button", { name: "提交" }));

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith("feedback");
      expect(mockInsert).toHaveBeenCalledWith({ content: "希望增加曲库功能" });
    });
    // 关键约束（DBA 实证）：INSERT 不链 .select()——RETURNING 输出行受 SELECT 策略
    // 约束，成员会 403/42501；默认 insert 即可
    expect(mockSelect).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith("反馈已提交，感谢你的反馈");
    // 成功：弹窗已关闭
    expect(screen.queryByRole("heading", { name: "问题与反馈" })).toBeNull();
    // 输入已清空（feedbackContent 复位）：重新打开弹窗时 textarea 为空
    fireEvent.click(screen.getByRole("button", { name: "问题与反馈" }));
    expect((screen.getByPlaceholderText("写下你的问题或建议") as HTMLTextAreaElement).value).toBe(
      "",
    );
  });

  it("提交失败（insert 返回 error）：alert 错误信息、不清空输入、弹窗保持打开", async () => {
    mockUseProfilesReturn([mockProfile()]);
    mockInsert.mockResolvedValue({ data: null, error: { message: "权限不足" } });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "问题与反馈" }));
    fireEvent.change(screen.getByPlaceholderText("写下你的问题或建议"), {
      target: { value: "测试反馈" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交" }));

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith("权限不足");
    });
    // 失败不清空输入，方便修改重试；弹窗保持打开
    expect((screen.getByPlaceholderText("写下你的问题或建议") as HTMLTextAreaElement).value).toBe(
      "测试反馈",
    );
    expect(screen.getByRole("heading", { name: "问题与反馈" })).toBeInTheDocument();
  });

  it("防重复提交：提交中双击只调用一次 insert，且提交中不可关闭弹窗", async () => {
    mockUseProfilesReturn([mockProfile()]);
    let resolveInsert!: (v: { data: null; error: null }) => void;
    const pending = new Promise<{ data: null; error: null }>((resolve) => {
      resolveInsert = resolve;
    });
    mockInsert.mockReturnValue(pending as never);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "问题与反馈" }));
    fireEvent.change(screen.getByPlaceholderText("写下你的问题或建议"), {
      target: { value: "测试反馈" },
    });
    const submitBtn = screen.getByRole("button", { name: "提交" });
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);
    // ref 同步阻断：双击只发一次请求
    expect(mockInsert).toHaveBeenCalledTimes(1);
    // 提交中按钮进入提交态且禁用，弹窗无法通过守卫关闭
    expect(screen.getByRole("button", { name: "提交中..." })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.getByRole("heading", { name: "问题与反馈" })).toBeInTheDocument();

    await act(async () => {
      resolveInsert({ data: null, error: null });
    });
  });

  // ============================================================
  // Issue #203：外观（亮色 / 暗色 / 跟随系统 主题切换）
  // ============================================================
  it("点击「外观」打开主题弹窗：渲染三个选项与当前模式说明", () => {
    mockMatchMedia(false);
    mockUseProfilesReturn([mockProfile()]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "外观" }));
    expect(screen.getByRole("heading", { name: "外观" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "亮色" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "暗色" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "跟随系统" })).toBeInTheDocument();
    // 默认（无存储）跟随系统；系统为亮色 → 当前亮色，且展示「跟随系统」说明
    expect(
      screen.getByText("当前为「亮色」模式（跟随系统：随设备系统外观自动切换）"),
    ).toBeInTheDocument();
  });

  it("弹窗内点击「暗色」：localStorage 写入 dark + html 设置 data-theme=dark", () => {
    mockMatchMedia(false);
    mockUseProfilesReturn([mockProfile()]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "外观" }));
    fireEvent.click(screen.getByRole("button", { name: "暗色" }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("弹窗内点击「亮色」：localStorage 写入 light + html 移除 data-theme", () => {
    // 系统为暗色，且 html 已有上次会话遗留的 data-theme：切亮色应移除
    mockMatchMedia(true);
    document.documentElement.setAttribute("data-theme", "dark");
    mockUseProfilesReturn([mockProfile()]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "外观" }));
    fireEvent.click(screen.getByRole("button", { name: "亮色" }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("点击退出登录调用 logout", () => {
    const logout = vi.fn();
    mockUseUser.mockReturnValue({
      user: { id: "u1", name: "张三", role: "member", section: "小提琴", email: "a@b.com" },
      login: vi.fn(),
      logout,
    });
    mockUseProfilesReturn([mockProfile()]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /退出登录/ }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("弹窗打开时锁定背景滚动，关闭后恢复", () => {
    mockUseProfilesReturn([mockProfile()]);
    const { container } = renderPage();
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
    renderPage();
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
      renderPage();
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

  // ============================================================
  // Issue #199：换绑邮箱（当前邮箱只读展示 + 新邮箱提交 + profiles.email 同步）
  // ============================================================
  it("换绑成功：调用 updateUser 并提示确认邮件、清空输入", async () => {
    const updateUser = vi.mocked(supabase.auth.updateUser);
    updateUser.mockResolvedValue({ error: null } as never);
    mockUseProfilesReturn([mockProfile()]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "账号与密码" }));
    // 当前邮箱只读展示（弹窗内区块）
    expect(screen.getByText("当前邮箱：a@b.com")).toBeInTheDocument();

    const emailInput = screen.getByPlaceholderText("输入新邮箱") as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: "new@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "发送确认邮件" }));

    await waitFor(() => {
      expect(updateUser).toHaveBeenCalledWith({ email: "new@example.com" });
    });
    expect(window.alert).toHaveBeenCalledWith(
      "确认邮件已发送至新邮箱，请点击邮件内链接完成换绑（未确认前仍使用旧邮箱）",
    );
    // 成功后清空输入；未确认前不关闭弹窗
    expect(emailInput.value).toBe("");
    expect(screen.getByRole("heading", { name: "修改登录密码" })).toBeInTheDocument();
  });

  it("换绑输入为空/格式错误时提示且不调用 updateUser", async () => {
    const updateUser = vi.mocked(supabase.auth.updateUser);
    updateUser.mockResolvedValue({ error: null } as never);
    mockUseProfilesReturn([mockProfile()]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "账号与密码" }));
    const emailInput = screen.getByPlaceholderText("输入新邮箱") as HTMLInputElement;

    // 空输入
    fireEvent.click(screen.getByRole("button", { name: "发送确认邮件" }));
    expect(window.alert).toHaveBeenCalledWith("请输入新邮箱");

    // 格式错误
    fireEvent.change(emailInput, { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "发送确认邮件" }));
    expect(window.alert).toHaveBeenCalledWith("邮箱格式不正确");

    expect(updateUser).not.toHaveBeenCalled();
  });

  it("新邮箱与当前邮箱相同（含大小写差异）时提示且不调用 updateUser", async () => {
    const updateUser = vi.mocked(supabase.auth.updateUser);
    updateUser.mockResolvedValue({ error: null } as never);
    mockUseProfilesReturn([mockProfile()]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "账号与密码" }));
    fireEvent.change(screen.getByPlaceholderText("输入新邮箱"), {
      target: { value: "A@b.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送确认邮件" }));

    expect(window.alert).toHaveBeenCalledWith("新邮箱与当前邮箱相同");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("换绑被拒（updateUser 返回 error）时提示错误信息、不清空输入", async () => {
    const updateUser = vi.mocked(supabase.auth.updateUser);
    updateUser.mockResolvedValue({ error: { message: "邮箱已被占用" } } as never);
    mockUseProfilesReturn([mockProfile()]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "账号与密码" }));
    const emailInput = screen.getByPlaceholderText("输入新邮箱") as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: "taken@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "发送确认邮件" }));

    await waitFor(() => {
      expect(updateUser).toHaveBeenCalledWith({ email: "taken@example.com" });
    });
    expect(window.alert).toHaveBeenCalledWith("邮箱已被占用");
    // 失败不清空，方便用户修改后重试
    expect(emailInput.value).toBe("taken@example.com");
  });

  it("换绑防重复提交：提交中双击只调用一次 updateUser，且提交中不可关闭弹窗", async () => {
    let resolveUpdate!: (v: { error: null }) => void;
    const pending = new Promise<{ error: null }>((resolve) => {
      resolveUpdate = resolve;
    });
    const updateUser = vi.mocked(supabase.auth.updateUser);
    updateUser.mockReturnValue(pending as never);
    mockUseProfilesReturn([mockProfile()]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "账号与密码" }));
    fireEvent.change(screen.getByPlaceholderText("输入新邮箱"), {
      target: { value: "new@example.com" },
    });

    const submitBtn = screen.getByRole("button", { name: "发送确认邮件" });
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);
    // ref 同步阻断：双击只发一次请求
    expect(updateUser).toHaveBeenCalledTimes(1);
    // 提交中按钮进入提交态且禁用，弹窗无法通过守卫关闭
    expect(screen.getByRole("button", { name: "发送中..." })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.getByRole("heading", { name: "修改登录密码" })).toBeInTheDocument();

    await act(async () => {
      resolveUpdate({ error: null });
    });
  });

  it("换绑提交进行中改密成功：ref 守卫下弹窗保持打开（对抗返工 Issue #199）", async () => {
    let resolveRebind!: (v: { error: null }) => void;
    const rebindPending = new Promise<{ error: null }>((resolve) => {
      resolveRebind = resolve;
    });
    const updateUser = vi.mocked(supabase.auth.updateUser);
    // 第 1 次调用（换绑）挂起；第 2 次调用（改密）立即成功
    updateUser
      .mockReturnValueOnce(rebindPending as never)
      .mockResolvedValueOnce({ error: null } as never);
    mockUseProfilesReturn([mockProfile()]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "账号与密码" }));

    // 先提交换绑（pending 飞行中）
    fireEvent.change(screen.getByPlaceholderText("输入新邮箱"), {
      target: { value: "new@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送确认邮件" }));
    expect(updateUser).toHaveBeenCalledTimes(1);

    // 再提交改密并成功——若用 state 闭包守卫会误关弹窗，ref 守卫应保持打开
    fireEvent.change(screen.getByPlaceholderText("至少 6 位"), { target: { value: "123456" } });
    fireEvent.change(screen.getByPlaceholderText("再次输入"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "确认修改" }));
    // 改密成功 alert 在微任务中执行，waitFor 消化后断言
    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith("密码修改成功");
    });
    expect(screen.getByRole("heading", { name: "修改登录密码" })).toBeInTheDocument();

    // 换绑完成（弹窗此刻仍可正常关闭）
    await act(async () => {
      resolveRebind({ error: null });
    });
  });

  it("auth email（getUser）与 myProfile.email 一致时不触发 profiles.email 同步", async () => {
    const update = vi.fn().mockResolvedValue(true);
    mockUseProfiles.mockReturnValue({
      data: [mockProfile({ email: "a@b.com" })],
      loading: false,
      error: null,
      saving: false,
      fetch: vi.fn(),
      update,
    } as never);
    // 真实数据流（对抗返工 Issue #199）：auth 来源（getUser）与 profiles 来源（useProfiles）
    // 双源对比，此处显式声明两源一致；beforeEach 已有同值默认，覆盖写法保持用例自足
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: "u1", email: "a@b.com" } },
      error: null,
    } as never);
    renderPage();
    // flush getUser 微任务后再断言
    await act(async () => {});
    expect(update).not.toHaveBeenCalled();
  });

  it("auth email（getUser）与 myProfile.email 不同（换绑已确认）时补写 profiles.email，且仅同步一次", async () => {
    const update = vi.fn().mockResolvedValue(true);
    mockUseProfiles.mockReturnValue({
      data: [mockProfile({ email: "old@a.com" })],
      loading: false,
      error: null,
      saving: false,
      fetch: vi.fn(),
      update,
    } as never);
    // auth 已更新为新邮箱、profiles 仍为旧值：触发补写
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: "u1", email: "new@a.com" } },
      error: null,
    } as never);
    renderPage();
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith("u1", { email: "new@a.com" });
    });
    // 防循环：effect 仅在依赖变化时触发，值未变不会重跑
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("getUser 失败（reject）时 catch 兜底：跳过同步、不调 update、不产生未捕获异常（对抗观察项 Issue #199）", async () => {
    // effect 链尾有 catch，reject 被吞掉不会成为 unhandledRejection；console.warn 记录后跳过
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const update = vi.fn().mockResolvedValue(true);
    mockUseProfiles.mockReturnValue({
      data: [mockProfile({ email: "old@a.com" })],
      loading: false,
      error: null,
      saving: false,
      fetch: vi.fn(),
      update,
    } as never);
    vi.mocked(supabase.auth.getUser).mockRejectedValue(new Error("auth 网络失败"));
    renderPage();
    // flush getUser 的 reject 微任务（act 内消化，避免 React act 告警）
    await act(async () => {});
    // 跳过同步：update 不被调用
    expect(update).not.toHaveBeenCalled();
    // catch 兜底生效：console.warn 记录一次
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[Profile] 获取 auth 邮箱失败"),
      expect.any(Error),
    );
  });

  // ============================================================
  // Issue #201：考勤查看（起止日期过滤 + 本人考勤列表）
  // ============================================================
  it("打开考勤弹窗：默认（未选区间）查询本人全部考勤并渲染时间/地点/曲目/状态", () => {
    mockUseProfilesReturn([mockProfile()]);
    mockThen.mockImplementation((cb: (v: unknown) => void) => {
      cb({
        data: [
          mockAttendanceRow(),
          mockAttendanceRow({
            id: 2,
            rehearsal_id: 11,
            status: "late",
            rehearsals: {
              start_time: "2026-08-12T19:00:00",
              end_time: "2026-08-12T21:00:00",
              location: "排练厅",
              repertoire: "莫扎特第三十九交响曲",
            },
          }),
        ],
        error: null,
      });
      return undefined;
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "考勤" }));
    // 弹窗打开（底部 Modal，标题「我的考勤」）
    expect(screen.getByRole("heading", { name: "我的考勤" })).toBeInTheDocument();
    // 查询：attendances 表、本人 user_id、join 排练（仅展示列，无 profiles 敏感列）、无日期过滤
    expect(mockFrom).toHaveBeenCalledWith("attendances");
    expect(mockEq).toHaveBeenCalledWith("user_id", "u1");
    expect(mockSelect).toHaveBeenCalledWith(
      "*, rehearsals!inner(start_time, end_time, location, repertoire)",
    );
    expect(mockGte).not.toHaveBeenCalled();
    expect(mockLt).not.toHaveBeenCalled();
    // 排序：按排练开始时间倒序（近 → 远，最近的排练在前）
    expect(mockOrder).toHaveBeenCalledWith("start_time", {
      referencedTable: "rehearsals",
      ascending: false,
    });
    // 行渲染：时间用与页面相同的格式化函数计算期望值，避免时区依赖
    const expectedTime = formatRehearsalRange("2026-08-10T19:00:00", "2026-08-10T21:00:00");
    expect(screen.getByText(expectedTime)).toBeInTheDocument();
    // 两行地点相同：批量断言
    expect(screen.getAllByText("地点：排练厅")).toHaveLength(2);
    expect(screen.getByText("曲目：贝多芬第五交响曲")).toBeInTheDocument();
    expect(screen.getByText("曲目：莫扎特第三十九交响曲")).toBeInTheDocument();
    expect(screen.getByText("出席")).toBeInTheDocument();
    expect(screen.getByText("迟到")).toBeInTheDocument();
  });

  it("选择起止日期后按区间过滤查询（gte 开始日期、lt 结束日期次日，结束当天全天包含）", () => {
    mockUseProfilesReturn([mockProfile()]);
    mockThen.mockImplementation((cb: (v: unknown) => void) => {
      cb({ data: [], error: null });
      return undefined;
    });
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: "考勤" }));
    const dateInputs = container.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[0], { target: { value: "2026-08-01" } });
    fireEvent.change(dateInputs[1], { target: { value: "2026-08-31" } });
    // 区间过滤：开始 ≥ 08-01；结束 < 09-01（次日开区间，结束当天 23:59 开始的排练也包含）
    expect(mockGte).toHaveBeenCalledWith("rehearsals.start_time", "2026-08-01");
    expect(mockLt).toHaveBeenCalledWith("rehearsals.start_time", "2026-09-01");
  });

  it("只填一端时按该端开放过滤（另一端不设界）", () => {
    mockUseProfilesReturn([mockProfile()]);
    mockThen.mockImplementation((cb: (v: unknown) => void) => {
      cb({ data: [], error: null });
      return undefined;
    });
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: "考勤" }));
    const dateInputs = container.querySelectorAll('input[type="date"]');
    // 只填开始日期：仅 gte 开始日期，无 lt
    fireEvent.change(dateInputs[0], { target: { value: "2026-08-05" } });
    expect(mockGte).toHaveBeenCalledWith("rehearsals.start_time", "2026-08-05");
    expect(mockLt).not.toHaveBeenCalled();
    // 补填结束日期：区间完整，lt 结束日期次日（开始 ≥ 08-05 不变）
    fireEvent.change(dateInputs[1], { target: { value: "2026-08-10" } });
    expect(mockLt).toHaveBeenCalledWith("rehearsals.start_time", "2026-08-11");
    // 清空开始日期（只填结束）：仍按 lt 开放过滤，无 gte
    mockGte.mockClear();
    fireEvent.change(dateInputs[0], { target: { value: "" } });
    expect(mockLt).toHaveBeenCalledWith("rehearsals.start_time", "2026-08-11");
    expect(mockGte).not.toHaveBeenCalled();
  });

  it("起 > 止：显示校验提示、不发起查询、不清空已选日期；修正后提示消失并重新查询", () => {
    mockUseProfilesReturn([mockProfile()]);
    mockThen.mockImplementation((cb: (v: unknown) => void) => {
      cb({ data: [], error: null });
      return undefined;
    });
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: "考勤" }));
    const dateInputs = container.querySelectorAll('input[type="date"]');
    // 先填结束日期（合法，开放过滤），清空查询计数后制造起 > 止
    fireEvent.change(dateInputs[1], { target: { value: "2026-08-10" } });
    mockFrom.mockClear();
    fireEvent.change(dateInputs[0], { target: { value: "2026-08-20" } });
    expect(screen.getByText("开始日期不能晚于结束日期")).toBeInTheDocument();
    expect(mockFrom).not.toHaveBeenCalled(); // 非法区间不发起查询
    // 已选日期保留（不清空），等待用户修正
    expect((dateInputs[0] as HTMLInputElement).value).toBe("2026-08-20");
    expect((dateInputs[1] as HTMLInputElement).value).toBe("2026-08-10");
    // 修正为合法区间：提示消失并重新查询
    fireEvent.change(dateInputs[0], { target: { value: "2026-08-01" } });
    expect(screen.queryByText("开始日期不能晚于结束日期")).toBeNull();
    expect(mockFrom).toHaveBeenCalledWith("attendances");
  });

  it("考勤状态未评定（status 为 null）的行显示「—」且无状态色", () => {
    mockUseProfilesReturn([mockProfile()]);
    mockThen.mockImplementation((cb: (v: unknown) => void) => {
      cb({
        data: [
          mockAttendanceRow({
            id: 2,
            status: null,
            sign_in_time: null,
            rehearsals: {
              start_time: "2026-08-12T19:00:00",
              end_time: "2026-08-12T21:00:00",
              location: "排练厅",
              repertoire: "莫扎特第三十九交响曲",
            },
          }),
        ],
        error: null,
      });
      return undefined;
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "考勤" }));
    // 按行锚定断言（O3 加固）：页面其他位置（如邮箱为 null 时）也有「—」兜底，
    // 全局 getByText("—") 依赖"mock 无其他「—」"隐含前提；锚定到该行卡片内避免脆弱。
    const card = screen.getByText("曲目：莫扎特第三十九交响曲").closest("div") as HTMLElement;
    const dash = within(card).getByText("—");
    expect(dash.className).toContain("text-text-muted");
  });

  it("列表为空时显示「该区间暂无考勤记录」", () => {
    mockUseProfilesReturn([mockProfile()]);
    mockThen.mockImplementation((cb: (v: unknown) => void) => {
      cb({ data: [], error: null });
      return undefined;
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "考勤" }));
    expect(screen.getByText("该区间暂无考勤记录")).toBeInTheDocument();
  });

  it("查询失败时显示「加载失败」提示", () => {
    mockUseProfilesReturn([mockProfile()]);
    mockThen.mockImplementation((cb: (v: unknown) => void) => {
      cb({ data: null, error: { message: "网络错误" } });
      return undefined;
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "考勤" }));
    expect(screen.getByText("加载失败，请稍后重试")).toBeInTheDocument();
    expect(screen.queryByText("该区间暂无考勤记录")).toBeNull();
  });

  it("竞态守卫：快速切换区间时过期响应不覆盖最新结果（递增序号范式）", async () => {
    mockUseProfilesReturn([mockProfile()]);
    const cbs: ((v: unknown) => void)[] = [];
    mockThen.mockImplementation((cb: (v: unknown) => void) => {
      cbs.push(cb);
      return undefined;
    });
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: "考勤" })); // 查询 1（打开，全部）
    const dateInputs = container.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[0], { target: { value: "2026-08-01" } }); // 查询 2
    fireEvent.change(dateInputs[1], { target: { value: "2026-08-10" } }); // 查询 3（最新区间）
    expect(cbs).toHaveLength(3);

    // 乱序返回：查询 3 先返回，查询 2 后返回（过期，应被丢弃）
    await act(async () => {
      cbs[2]({
        data: [
          mockAttendanceRow({
            id: 2,
            rehearsals: {
              start_time: "2026-08-09T19:00:00",
              end_time: "2026-08-09T21:00:00",
              location: "排练厅",
              repertoire: "区间内曲目",
            },
          }),
        ],
        error: null,
      });
    });
    await act(async () => {
      cbs[1]({
        data: [
          mockAttendanceRow({
            id: 3,
            rehearsals: {
              start_time: "2026-07-01T19:00:00",
              end_time: "2026-07-01T21:00:00",
              location: "排练厅",
              repertoire: "过期响应曲目",
            },
          }),
        ],
        error: null,
      });
    });
    // 展示最新查询结果，过期响应被丢弃
    expect(screen.getByText("曲目：区间内曲目")).toBeInTheDocument();
    expect(screen.queryByText("曲目：过期响应曲目")).toBeNull();
  });

  it("存储缺勤是占位：排练未结束时显示「未签到」，已结束才显示「缺勤」（与详情弹窗语义一致）", () => {
    // 固定系统时间，避免判定依赖真实运行时刻（与详情弹窗测试同模式）
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 13, 0, 0));
    mockUseProfilesReturn([mockProfile()]);
    mockThen.mockImplementation((cb: (v: unknown) => void) => {
      cb({
        data: [
          // 未来排练（未结束）：absent 是新建排练的默认占位 → 未签到
          mockAttendanceRow({
            id: 1,
            status: "absent",
            sign_in_time: null,
            rehearsals: {
              start_time: "2026-08-16T19:00:00",
              end_time: "2026-08-16T21:00:00",
              location: "排练厅",
              repertoire: "未来曲目",
            },
          }),
          // 已结束排练 → 缺勤
          mockAttendanceRow({
            id: 2,
            status: "absent",
            sign_in_time: null,
            rehearsals: {
              start_time: "2026-08-01T19:00:00",
              end_time: "2026-08-01T21:00:00",
              location: "排练厅",
              repertoire: "已结束曲目",
            },
          }),
        ],
        error: null,
      });
      return undefined;
    });
    try {
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: "考勤" }));
      expect(screen.getByText("未签到")).toBeInTheDocument();
      expect(screen.getByText("缺勤")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // ============================================================
  // Issue #213：考勤区间统计摘要（与列表同源派生，无额外查询）
  // 口径（需求修订后）：四类按展示口径计——未结束且未签到的 absent 占位行
  // （列表「未签到」）与 status null 行（列表「—」）不计入任何栏目，仅计入
  // total（区间内总排练数，可能大于四类之和）
  // ============================================================
  describe("summarizeAttendance 统计口径（Issue #213 需求修订后）", () => {
    // 固定判定时间：08-10 排练已结束、08-16 排练未结束（与列表占位用例同模式）
    const now = new Date(2026, 7, 15, 13, 0, 0);
    /** 便捷构造统计行（默认：已签到 present 行，排练 08-10 已结束） */
    const row = (overrides: Partial<AttendanceSummaryRow> = {}): AttendanceSummaryRow => ({
      status: "present",
      sign_in_time: "2026-08-10T19:00:00",
      rehearsals: { start_time: "2026-08-10T19:00:00", end_time: "2026-08-10T21:00:00" },
      ...overrides,
    });

    it("混合状态：四类按展示口径计数，占位行/null 行不计入任何栏目", () => {
      const rows: AttendanceSummaryRow[] = [
        row(), // present
        row({ status: "late" }),
        row({ status: "excused" }),
        // 已结束排练的 absent（未签到但排练已结束）：占位解除 → 缺勤
        row({ status: "absent", sign_in_time: null }),
        // 未结束排练的 absent 占位行（列表「未签到」）：不计入任何栏目
        row({
          status: "absent",
          sign_in_time: null,
          rehearsals: { start_time: "2026-08-16T19:00:00", end_time: "2026-08-16T21:00:00" },
        }),
        // status null（未评定，列表「—」）：不计入任何栏目
        row({ status: null, sign_in_time: null, rehearsals: null }),
      ];
      expect(summarizeAttendance(rows, now)).toEqual({
        total: 6, // 区间内全部行数（含未签到/未评定行）
        present: 1,
        late: 1,
        excused: 1,
        absent: 1,
      });
    });

    it("total 语义：区间内全部行数，可能大于四类之和（未签到/未评定不参与分类）", () => {
      const rows: AttendanceSummaryRow[] = [
        row(), // present
        // 未结束排练的 absent 占位行：只进 total
        row({
          status: "absent",
          sign_in_time: null,
          rehearsals: { start_time: "2026-08-16T19:00:00", end_time: "2026-08-16T21:00:00" },
        }),
        // status null：只进 total
        row({ status: null, sign_in_time: null, rehearsals: null }),
      ];
      const summary = summarizeAttendance(rows, now);
      expect(summary.total).toBe(3);
      expect(summary.present + summary.late + summary.excused + summary.absent).toBe(1);
    });

    it("空区间：全 0", () => {
      expect(summarizeAttendance([], now)).toEqual({
        total: 0,
        present: 0,
        late: 0,
        excused: 0,
        absent: 0,
      });
    });

    it("仅未评定（null）行：计入 total，四类全 0", () => {
      const rows: AttendanceSummaryRow[] = [
        row({ status: null, sign_in_time: null, rehearsals: null }),
        row({ status: null, sign_in_time: null, rehearsals: null }),
      ];
      expect(summarizeAttendance(rows, now)).toEqual({
        total: 2,
        present: 0,
        late: 0,
        excused: 0,
        absent: 0,
      });
    });

    it("占位判定随排练是否结束变化：未结束不计缺勤、已结束计缺勤（与展示同源）", () => {
      const placeholderRow: AttendanceSummaryRow = {
        status: "absent",
        sign_in_time: null,
        rehearsals: { start_time: "2026-08-16T19:00:00", end_time: "2026-08-16T21:00:00" },
      };
      // 排练未结束（now 08-15 < 08-16）：占位 → 不计入缺勤
      expect(summarizeAttendance([placeholderRow], new Date(2026, 7, 15, 13, 0, 0)).absent).toBe(0);
      // 排练已结束（now 08-19 > 08-16）：占位解除 → 缺勤
      expect(summarizeAttendance([placeholderRow], new Date(2026, 7, 19, 13, 0, 0)).absent).toBe(1);
    });
  });

  it("考勤弹窗显示区间统计：混合状态一行排版 + 语义色与状态标签一致", () => {
    // 固定判定时间：08-10 排练已结束、08-16 排练未结束（占位判定依赖当前时间）
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 13, 0, 0));
    mockUseProfilesReturn([mockProfile()]);
    mockThen.mockImplementation((cb: (v: unknown) => void) => {
      cb({
        data: [
          mockAttendanceRow(), // present（已签到）
          mockAttendanceRow({ id: 2, status: "late" }),
          mockAttendanceRow({ id: 3, status: "excused" }),
          // 已结束排练的 absent：占位解除 → 缺勤
          mockAttendanceRow({ id: 4, status: "absent", sign_in_time: null }),
          // 未结束排练的 absent 占位行：列表显示「未签到」，统计不计入任何栏目
          mockAttendanceRow({
            id: 5,
            status: "absent",
            sign_in_time: null,
            rehearsals: {
              start_time: "2026-08-16T19:00:00",
              end_time: "2026-08-16T21:00:00",
              location: "排练厅",
              repertoire: "未来排练曲目",
            },
          }),
        ],
        error: null,
      });
      return undefined;
    });
    try {
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: "考勤" }));
      // 统计行：共 5 次排练（total 含占位行），四类各 1；无「未签到」栏目
      expect(screen.getByText("共 5 次排练")).toBeInTheDocument();
      expect(screen.getByText("出席 1")).toBeInTheDocument();
      expect(screen.getByText("迟到 1")).toBeInTheDocument();
      expect(screen.getByText("请假 1")).toBeInTheDocument();
      expect(screen.getByText("缺勤 1")).toBeInTheDocument();
      expect(screen.queryByText("未签到 1")).toBeNull();
      // 语义色与 STATUS_TEXT_COLOR 一致：出席成功 / 迟到警告 / 请假信息 / 缺勤危险
      expect(screen.getByText("出席 1").className).toContain("text-success");
      expect(screen.getByText("迟到 1").className).toContain("text-warning");
      expect(screen.getByText("请假 1").className).toContain("text-info");
      expect(screen.getByText("缺勤 1").className).toContain("text-danger");
    } finally {
      vi.useRealTimers();
    }
  });

  it("空区间：统计显示全 0（列表显示暂无记录）", () => {
    mockUseProfilesReturn([mockProfile()]);
    mockThen.mockImplementation((cb: (v: unknown) => void) => {
      cb({ data: [], error: null });
      return undefined;
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "考勤" }));
    expect(screen.getByText("该区间暂无考勤记录")).toBeInTheDocument();
    expect(screen.getByText("共 0 次排练")).toBeInTheDocument();
    expect(screen.getByText("出席 0")).toBeInTheDocument();
    expect(screen.getByText("迟到 0")).toBeInTheDocument();
    expect(screen.getByText("请假 0")).toBeInTheDocument();
    expect(screen.getByText("缺勤 0")).toBeInTheDocument();
    expect(screen.queryByText("未签到 0")).toBeNull();
  });

  it("区间变更：统计随新列表同步刷新（派生计算自动，无额外查询）", () => {
    // 固定判定时间：08-16 排练未结束（占位判定不依赖真实运行时刻）
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 13, 0, 0));
    mockUseProfilesReturn([mockProfile()]);
    mockThen
      .mockImplementationOnce((cb: (v: unknown) => void) => {
        cb({
          data: [
            mockAttendanceRow(), // present
            mockAttendanceRow({ id: 2, status: "late" }),
          ],
          error: null,
        });
        return undefined;
      })
      .mockImplementationOnce((cb: (v: unknown) => void) => {
        cb({
          data: [
            mockAttendanceRow({
              id: 3,
              status: "absent",
              sign_in_time: null,
              rehearsals: {
                start_time: "2026-08-16T19:00:00",
                end_time: "2026-08-16T21:00:00",
                location: "排练厅",
                repertoire: "区间内未来排练",
              },
            }),
          ],
          error: null,
        });
        return undefined;
      });
    const { container } = renderPage();
    try {
      fireEvent.click(screen.getByRole("button", { name: "考勤" }));
      // 第一次（打开默认查全部）：2 行统计
      expect(screen.getByText("共 2 次排练")).toBeInTheDocument();
      expect(screen.getByText("出席 1")).toBeInTheDocument();
      expect(screen.getByText("迟到 1")).toBeInTheDocument();
      // 切换区间：新列表驱动统计同步刷新——占位行只进 total，四类全 0
      const dateInputs = container.querySelectorAll('input[type="date"]');
      fireEvent.change(dateInputs[0], { target: { value: "2026-08-01" } });
      expect(screen.getByText("共 1 次排练")).toBeInTheDocument();
      expect(screen.getByText("出席 0")).toBeInTheDocument();
      expect(screen.getByText("缺勤 0")).toBeInTheDocument();
      expect(screen.queryByText("出席 1")).toBeNull();
      expect(screen.queryByText("迟到 1")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("排练跨过结束时刻：统计与列表同步翻转（渲染期求值，无旧 now 缓存）", () => {
    // 复现对抗场景：fake time 20:58 打开弹窗（排练 19:00-21:00 未结束，占位）；
    // 21:05 排练结束，期间一次不更新 attendanceRows 的 re-render（rerender 同树
    // 保留 state，仅重跑渲染函数读取新时钟）——统计必须与列表同步翻转为缺勤
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 20, 58, 0));
    mockUseProfilesReturn([mockProfile()]);
    mockThen.mockImplementation((cb: (v: unknown) => void) => {
      cb({
        data: [
          mockAttendanceRow({
            id: 1,
            status: "absent",
            sign_in_time: null,
            rehearsals: {
              start_time: "2026-08-15T19:00:00",
              end_time: "2026-08-15T21:00:00",
              location: "排练厅",
              repertoire: "跨时刻排练",
            },
          }),
        ],
        error: null,
      });
      return undefined;
    });
    const { rerender } = renderPage();
    try {
      fireEvent.click(screen.getByRole("button", { name: "考勤" }));
      // 排练未结束：列表「未签到」，统计不计缺勤（四类全 0）
      expect(screen.getByText("未签到")).toBeInTheDocument();
      expect(screen.getByText("缺勤 0")).toBeInTheDocument();

      // 推进时钟越过结束时刻，同树重渲染（attendanceRows 不变，模拟通知未读数等
      // 无关 re-render）——列表与统计同帧读取新时钟
      vi.setSystemTime(new Date(2026, 7, 15, 21, 5, 0));
      rerender(
        <ThemeProvider>
          <ProfilePage />
        </ThemeProvider>,
      );
      // 同屏同步翻转：列表「缺勤」与统计「缺勤 1」一致（无旧 now 缓存分歧）
      expect(screen.getByText("缺勤")).toBeInTheDocument();
      expect(screen.getByText("缺勤 1")).toBeInTheDocument();
      expect(screen.getByText("共 1 次排练")).toBeInTheDocument();
      expect(screen.queryByText("未签到")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("加载中/查询失败：统计区隐藏（不展示误导性旧统计）", async () => {
    mockUseProfilesReturn([mockProfile()]);
    const cbs: ((v: unknown) => void)[] = [];
    mockThen.mockImplementation((cb: (v: unknown) => void) => {
      cbs.push(cb);
      return undefined;
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "考勤" }));
    // 加载中：列表显示加载中，统计区不渲染
    expect(screen.getByText("加载中…")).toBeInTheDocument();
    expect(screen.queryByText(/次排练/)).toBeNull();
    // 查询失败：统计区同样隐藏
    await act(async () => {
      cbs[0]({ data: null, error: { message: "网络错误" } });
    });
    expect(screen.getByText("加载失败，请稍后重试")).toBeInTheDocument();
    expect(screen.queryByText(/次排练/)).toBeNull();
  });

  // ============================================================
  // Issue #205：已发布的活动（本人公告管理，含锁定帖）
  // Issue #212：成员面板移除锁定/解锁入口（非 admin 改 is_locked 被 DBA 触发器拒绝），
  //            锁定帖仅只读展示 🔒 徽章，锁定操作收敛到 admin 端
  // ============================================================
  describe("已发布的活动（Issue #205 / #212）", () => {
    type UpdateFn = (id: string, payload: Record<string, unknown>) => Promise<boolean>;
    type RemoveFn = (id: string) => Promise<boolean>;

    type PostsApi = {
      update: Mock<UpdateFn>;
      remove: Mock<RemoveFn>;
      fetch: Mock<() => Promise<void>>;
    };

    function makePost(overrides: Record<string, unknown> = {}) {
      return {
        id: "p1",
        title: "重奏招募",
        content: "招募长笛",
        type: "ensemble",
        contact_info: "wx123",
        current_sections: null,
        missing_sections: null,
        image_url: null,
        author_id: "u1",
        created_at: "2026-08-01T10:00:00",
        is_locked: false,
        ...overrides,
      };
    }

    /**
     * 注入 usePosts mock。用 mockImplementation 每次渲染返回闭包持有的最新列表，
     * 模拟真实 usePosts 的乐观更新：update/remove 成功后 data 引用变化，
     * 驱动列表/面板派生重算（与 admin community 测试同模式）。
     */
    function mockPublishedPosts(
      initialData: unknown[] = [],
      hooks: Partial<PostsApi> = {},
    ): PostsApi {
      let data: unknown[] = initialData;
      const update =
        hooks.update ??
        vi.fn<UpdateFn>().mockImplementation(async (id, payload) => {
          // 乐观更新：原地合并修改内容（同 usePosts.update）
          data = data.map((p) =>
            (p as { id?: string })?.id === id
              ? { ...(p as Record<string, unknown>), ...payload }
              : p,
          );
          return true;
        });
      const remove =
        hooks.remove ??
        vi.fn<RemoveFn>().mockImplementation(async (id) => {
          // 乐观移除：从本地列表剔除（同 usePosts.remove）
          data = data.filter((p) => (p as { id?: string })?.id !== id);
          return true;
        });
      const fetch = hooks.fetch ?? vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
      mockUsePosts.mockImplementation(() => ({
        data,
        loading: false,
        error: null,
        saving: false,
        fetch,
        create: vi.fn().mockResolvedValue(true),
        update,
        remove,
        uploadImage: vi.fn().mockResolvedValue({ url: "http://img/new.png" }),
      }));
      return { update, remove, fetch };
    }

    /** 打开「已发布的活动」弹窗（默认一条本人帖子） */
    function openPublishedPosts(posts: unknown[] = [makePost()]) {
      mockPublishedPosts(posts);
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: "已发布的活动" }));
    }

    beforeEach(() => {
      mockUseProfilesReturn([mockProfile()]);
      // 兜底默认（各用例通过 mockPublishedPosts 覆盖）
      mockUsePosts.mockReturnValue({
        data: [],
        loading: false,
        error: null,
        saving: false,
        fetch: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
        uploadImage: vi.fn(),
      });
    });

    it("空态：本人无帖子时显示「暂无已发布的活动」，查询含锁定帖且限本人（includeLocked + authorId）", () => {
      openPublishedPosts([]);
      expect(screen.getByRole("heading", { name: "已发布的活动" })).toBeInTheDocument();
      expect(screen.getByText("暂无已发布的活动")).toBeInTheDocument();
      expect(mockUsePosts).toHaveBeenCalledWith({ includeLocked: true, authorId: "u1" });
    });

    it("列表渲染本人帖子：标题/类型中文标签/发布时间/锁定徽章（锁定帖仍可见）", () => {
      openPublishedPosts([
        makePost(),
        makePost({ id: "p2", title: "团建活动", type: "gathering", is_locked: true }),
      ]);
      expect(screen.getByText("重奏招募")).toBeInTheDocument();
      expect(screen.getByText("团建活动")).toBeInTheDocument();
      // 类型标签 + 发布时间（与页面同函数计算期望值，避免时区依赖）
      const expectedTime = formatDateTimeInChina("2026-08-01T10:00:00");
      expect(screen.getByText(`重奏 · ${expectedTime}`)).toBeInTheDocument();
      expect(screen.getByText(`团建 · ${expectedTime}`)).toBeInTheDocument();
      // 锁定帖带 🔒 徽章，未锁定帖无徽章
      expect(screen.getAllByText("🔒 已锁定")).toHaveLength(1);
    });

    it("点帖子进入管理面板：标题入标题栏、类型/发布时间展示、操作行编辑/删除双按钮右下角", () => {
      openPublishedPosts();
      fireEvent.click(screen.getByText("重奏招募")); // 点帖子
      // 面板标题 = 帖子标题，类型徽章 + 发布时间
      expect(screen.getByRole("heading", { name: "重奏招募" })).toBeInTheDocument();
      expect(screen.getByText("重奏")).toBeInTheDocument();
      const expectedTime = formatDateTimeInChina("2026-08-01T10:00:00");
      expect(screen.getByText(`发布时间：${expectedTime}`)).toBeInTheDocument();
      // 操作行：编辑 / 删除 双按钮（Issue #212：锁定收敛到 admin 端，成员面板不渲染锁定入口）
      expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "锁定" })).toBeNull();
      expect(screen.queryByRole("button", { name: "解锁" })).toBeNull();
      // 双按钮操作行右下角（justify-end，Issue #182）
      expect(screen.getByRole("button", { name: "删除" }).parentElement!.className).toContain(
        "justify-end",
      );
    });

    it("锁定帖进入面板：标题栏带 🔒 徽章（headerExtra 只读展示），无锁定/解锁按钮", () => {
      mockPublishedPosts([makePost({ is_locked: true })]);
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: "已发布的活动" }));
      fireEvent.click(screen.getByText("重奏招募")); // 进入面板
      // 只读状态入标题（headerExtra），内容区不重复展示
      expect(screen.getByText("🔒 已锁定")).toBeInTheDocument();
      // Issue #212：成员无锁定操作入口（数据层由 DBA 触发器保障，前端无锁定失败路径）
      expect(screen.queryByRole("button", { name: "锁定" })).toBeNull();
      expect(screen.queryByRole("button", { name: "解锁" })).toBeNull();
    });

    it("点「删除」：confirm 后调用 remove，面板关闭回列表、帖子移除（空态）", async () => {
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
      const { remove } = mockPublishedPosts([makePost()]);
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: "已发布的活动" }));
      fireEvent.click(screen.getByText("重奏招募")); // 进入面板
      fireEvent.click(screen.getByRole("button", { name: "删除" }));
      expect(confirmSpy).toHaveBeenCalledWith("确定要删除这条公告吗？");
      await waitFor(() => {
        expect(remove).toHaveBeenCalledWith("p1");
      });
      // 回列表视图（标题变回「已发布的活动」），帖子已移除 → 空态
      await waitFor(() => {
        expect(screen.getByRole("heading", { name: "已发布的活动" })).toBeInTheDocument();
      });
      expect(screen.getByText("暂无已发布的活动")).toBeInTheDocument();
      expect(window.alert).toHaveBeenCalledWith("已删除。");
    });

    it("删除 confirm 取消：不调用 remove，面板保持打开", () => {
      vi.spyOn(window, "confirm").mockReturnValue(false);
      const remove = vi.fn<RemoveFn>();
      mockPublishedPosts([makePost()], { remove });
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: "已发布的活动" }));
      fireEvent.click(screen.getByText("重奏招募")); // 进入面板
      fireEvent.click(screen.getByRole("button", { name: "删除" }));
      expect(remove).not.toHaveBeenCalled();
      expect(screen.getByRole("heading", { name: "重奏招募" })).toBeInTheDocument();
    });

    it("删除进行中：操作行双按钮互斥禁用、弹窗关闭被拦截，完成后回列表", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      let resolveRemove!: (ok: boolean) => void;
      const removeMock = vi.fn<RemoveFn>().mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            resolveRemove = resolve;
          }),
      );
      mockPublishedPosts([makePost()], { remove: removeMock });
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: "已发布的活动" }));
      fireEvent.click(screen.getByText("重奏招募")); // 进入面板
      fireEvent.click(screen.getByRole("button", { name: "删除" }));
      // busy：删除按钮显示「删除中…」并禁用，编辑同步禁用（防操作已删帖子）
      expect((screen.getByText("删除中…") as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByText("编辑") as HTMLButtonElement).disabled).toBe(true);
      // busy：遮罩关闭按钮不渲染，标题栏「关闭」点击被守卫拦截
      expect(screen.queryByLabelText("关闭弹窗")).toBeNull();
      fireEvent.click(screen.getByText("关闭"));
      expect(screen.getByRole("heading", { name: "重奏招募" })).toBeInTheDocument();
      // 完成后删除成功，回列表视图
      await act(async () => {
        resolveRemove(true);
      });
      await waitFor(() => {
        expect(screen.getByRole("heading", { name: "已发布的活动" })).toBeInTheDocument();
      });
    });

    it("点「编辑」：打开共用编辑弹窗预填，保存后 update 调用并回列表显示新标题", async () => {
      const { update } = mockPublishedPosts([makePost()]);
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: "已发布的活动" }));
      fireEvent.click(screen.getByText("重奏招募")); // 进入面板
      fireEvent.click(screen.getByRole("button", { name: "编辑" }));
      // 复用社区 PublishModal：编辑模式预填标题/内容
      expect(screen.getByRole("heading", { name: "编辑公告" })).toBeInTheDocument();
      expect((screen.getByPlaceholderText("请输入标题") as HTMLInputElement).value).toBe(
        "重奏招募",
      );
      expect((screen.getByPlaceholderText("请输入内容") as HTMLTextAreaElement).value).toBe(
        "招募长笛",
      );
      // 修改标题并保存
      fireEvent.change(screen.getByPlaceholderText("请输入标题"), {
        target: { value: "重奏招募（改）" },
      });
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      await waitFor(() => {
        expect(update).toHaveBeenCalledWith(
          "p1",
          expect.objectContaining({ title: "重奏招募（改）" }),
        );
      });
      // 保存成功：编辑弹窗关闭回列表，乐观更新显示新标题。
      // 注意：inert 方案下底层 Modal 编辑期间始终挂载，「已发布的活动」标题一直在 DOM，
      // 不能以它出现为完成信号——以编辑弹窗消失（「编辑公告」heading 移除）为准
      await waitFor(() => {
        expect(screen.queryByRole("heading", { name: "编辑公告" })).toBeNull();
      });
      expect(screen.getByText("重奏招募（改）")).toBeInTheDocument();
    });

    it("编辑打开时底层 Modal 加 inert 隔离（Tab 无法逃逸误触「关闭」丢编辑内容），取消后解除", () => {
      openPublishedPosts();
      fireEvent.click(screen.getByText("重奏招募")); // 进入面板
      fireEvent.click(screen.getByRole("button", { name: "编辑" }));
      // 双层弹窗同时在 DOM：底层 Modal（列表视图）+ PublishModal（编辑），读屏器只见编辑弹窗
      const dialogs = screen.getAllByRole("dialog");
      expect(dialogs).toHaveLength(2);
      // 底层 dialog 的父容器带 inert（编辑期间 Tab/点击无法逃逸），编辑弹窗无 inert
      expect(dialogs[0].parentElement).toHaveAttribute("inert");
      expect(dialogs[1].parentElement).not.toHaveAttribute("inert");
      // 取消编辑：编辑弹窗卸载，底层 Modal 恢复可交互（inert 移除）
      fireEvent.click(screen.getByRole("button", { name: "取消" }));
      expect(screen.queryByRole("heading", { name: "编辑公告" })).toBeNull();
      expect(screen.getByRole("dialog").parentElement).not.toHaveAttribute("inert");
    });

    it("删除 0 行（帖子已被并发删除）：提示兼容文案、刷新列表并回列表视图（不假成功）", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const remove = vi.fn<RemoveFn>().mockResolvedValue(false);
      const { fetch } = mockPublishedPosts([makePost()], { remove });
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: "已发布的活动" }));
      fireEvent.click(screen.getByText("重奏招募")); // 进入面板
      fireEvent.click(screen.getByRole("button", { name: "删除" }));
      await waitFor(() => {
        expect(remove).toHaveBeenCalledWith("p1");
      });
      // 0 行与真实失败不区分（usePosts.remove 只返回 boolean）：刷新列表同步真实状态 + 兼容提示
      expect(fetch).toHaveBeenCalled();
      await waitFor(() => {
        expect(window.alert).toHaveBeenCalledWith("删除失败（帖子可能已被删除）");
      });
      // 回列表视图；mock 数据未被移除（真实 fetch 后以 DB 为准），帖子仍在可重试
      await waitFor(() => {
        expect(screen.getByRole("heading", { name: "已发布的活动" })).toBeInTheDocument();
      });
      expect(screen.getByText("重奏招募")).toBeInTheDocument();
    });

    it("编辑保存失败（update 0 行返回 false）：alert 更新失败、编辑弹窗保持打开", async () => {
      const update = vi.fn<UpdateFn>().mockResolvedValue(false);
      mockPublishedPosts([makePost()], { update });
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: "已发布的活动" }));
      fireEvent.click(screen.getByText("重奏招募")); // 进入面板
      fireEvent.click(screen.getByRole("button", { name: "编辑" }));
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      await waitFor(() => {
        expect(update).toHaveBeenCalledWith("p1", expect.objectContaining({ title: "重奏招募" }));
      });
      // 0 行更新返回 false → 提示更新失败，不假成功
      await waitFor(() => {
        expect(window.alert).toHaveBeenCalledWith("更新失败");
      });
      expect(screen.getByRole("heading", { name: "编辑公告" })).toBeInTheDocument();
    });
  });
});
