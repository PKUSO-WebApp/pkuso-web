// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MembersPage from "./page";
import type { ProfileRow } from "@/types/database";

// 固定测试时区为 UTC+8：旧实现 parseLocalISO(...).toISOString().slice(0,10) 在
// UTC+8 下会把凌晨的日期退回前一天（导出文件名/sheet 名日期偏移一天的回归）。
// vitest 4 默认 forks pool，每文件独立子进程，本文件的 TZ 不会泄漏到其他测试。
process.env.TZ = "Asia/Shanghai";

// 通过 vi.hoisted 暴露可变 mock，方便测试内动态配置返回值
const mocks = vi.hoisted(() => {
  const mockFetchByRehearsal = vi.fn();
  const mockUpdateStatus = vi.fn().mockResolvedValue(null);
  const mockWriteFile = vi.fn();
  const mockAoaToSheet = vi.fn();
  const mockBookNew = vi.fn(() => ({}));
  const mockBookAppendSheet = vi.fn();

  const defaultRehearsals = [
    {
      id: 1,
      repertoire: "贝多芬第五交响曲",
      start_time: "2026-08-20T19:00:00",
      end_time: "2026-08-20T21:00:00",
      location: "新太阳活动中心",
    },
    {
      id: 2,
      repertoire: "莫扎特协奏曲",
      start_time: "2026-08-21T14:00:00",
      end_time: "2026-08-21T16:00:00",
      location: "排练厅 201",
    },
  ];
  // 可变副本：空区间测试会清空，beforeEach 中用 defaultRehearsals 恢复
  const mockRehearsals = [...defaultRehearsals];

  // 考勤名单（fetchByRehearsal 返回；姓名取 3 字避免与弹窗头像首字文本重复）
  const mockAttendanceRows = [
    {
      id: 1,
      rehearsal_id: 1,
      user_id: "u1",
      status: "absent",
      sign_in_time: null,
      profiles: { full_name: "张小三", instrument: "小提琴" },
    },
    {
      id: 2,
      rehearsal_id: 1,
      user_id: "u2",
      status: "present",
      sign_in_time: null,
      profiles: { full_name: "李小四", instrument: "大提琴" },
    },
  ];

  // 花名册成员（useProfiles 返回；花名册 tab 用例动态注入）
  const profiles: ProfileRow[] = [];

  // 导出全部：一次 .in 查询返回的全部出勤记录（覆盖两个排练；姓名/邮箱由 profiles_roster 补查）
  const mockAllAttendanceRows = [
    {
      id: 1,
      rehearsal_id: 1,
      user_id: "u1",
      status: "absent",
      sign_in_time: null,
    },
    {
      id: 2,
      rehearsal_id: 1,
      user_id: "u2",
      status: "present",
      sign_in_time: "2026-08-20T19:05:00",
    },
    {
      id: 3,
      rehearsal_id: 2,
      user_id: "u3",
      status: "late",
      sign_in_time: "2026-08-21T14:10:00",
    },
  ];

  // 导出单场：.eq 查询返回
  const mockSingleAttendanceRows = [
    {
      user_id: "u1",
      status: "present",
      sign_in_time: "2026-08-20T19:05:00",
    },
  ];

  // profiles_roster 补查返回（视图无 FK 无法 embed；admin 经 is_admin 拿原值）
  // is_in_orchestra 三态覆盖：在团 / 不在团 / 未设置（—）
  const mockRosterRows = [
    { id: "u1", full_name: "张小三", email: "zhangsan@example.com", is_in_orchestra: true },
    { id: "u2", full_name: "李小四", email: "lisi@example.com", is_in_orchestra: false },
    { id: "u3", full_name: "王小五", email: "wangwu@example.com", is_in_orchestra: null },
  ];

  // supabase 链式 mock：select/eq/in/order/insert 返回链自身，then 由 beforeEach 按查询类型配置返回值
  const mockSelect = vi.fn();
  const mockEq = vi.fn();
  const mockIn = vi.fn();
  const mockOrder = vi.fn();
  const mockInsert = vi.fn();
  const mockThen = vi.fn();
  const mockFrom = vi.fn();
  const chain = {
    select: mockSelect,
    eq: mockEq,
    in: mockIn,
    order: mockOrder,
    insert: mockInsert,
    then: mockThen,
  };
  mockSelect.mockReturnValue(chain);
  mockEq.mockReturnValue(chain);
  mockIn.mockReturnValue(chain);
  mockOrder.mockReturnValue(chain);
  mockInsert.mockReturnValue(chain);

  return {
    mockFetchByRehearsal,
    mockUpdateStatus,
    mockWriteFile,
    mockAoaToSheet,
    mockBookNew,
    mockBookAppendSheet,
    defaultRehearsals,
    mockRehearsals,
    mockAttendanceRows,
    mockAllAttendanceRows,
    mockSingleAttendanceRows,
    profiles,
    mockRosterRows,
    mockSelect,
    mockEq,
    mockIn,
    mockOrder,
    mockInsert,
    mockThen,
    mockFrom,
    chain,
  };
});

// Mock useRehearsals（考勤 tab 的排练列表）
vi.mock("@/hooks/useRehearsals", () => ({
  useRehearsals: () => ({
    data: mocks.mockRehearsals,
    loading: false,
    error: null,
    saving: false,
    fetch: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  }),
}));

// Mock useProfiles（花名册 tab）：data 引用不变、内容可变，测试内动态注入
vi.mock("@/hooks/useProfiles", () => ({
  useProfiles: () => ({
    data: mocks.profiles,
    loading: false,
    error: null,
    saving: false,
    fetch: vi.fn(),
    update: vi.fn().mockResolvedValue(true),
    remove: vi.fn(),
  }),
}));

// Mock useAttendance：useAttendanceEditor 真实运行，仅替换数据层
vi.mock("@/hooks/useAttendance", () => ({
  useAttendance: () => ({
    map: {},
    list: [],
    loading: false,
    fetchMyAttendances: vi.fn(),
    fetchByRehearsal: mocks.mockFetchByRehearsal,
    upsert: vi.fn(),
    updateStatus: mocks.mockUpdateStatus,
    batchInsert: vi.fn(),
    fetchStats: vi.fn(),
  }),
}));

// Mock supabase：链式查询，then 的返回值由 beforeEach 配置
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: mocks.mockFrom,
  },
}));

// Mock xlsx：避免测试真正写文件
vi.mock("xlsx", () => ({
  utils: {
    aoa_to_sheet: mocks.mockAoaToSheet,
    book_new: mocks.mockBookNew,
    book_append_sheet: mocks.mockBookAppendSheet,
  },
  writeFile: mocks.mockWriteFile,
}));

describe("AdminMembersPage 组件（排练考勤 tab）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockFetchByRehearsal.mockResolvedValue(mocks.mockAttendanceRows);
    mocks.mockFrom.mockReturnValue(mocks.chain);
    // 恢复排练列表（空区间测试会清空）
    mocks.mockRehearsals.splice(0, mocks.mockRehearsals.length, ...mocks.defaultRehearsals);
    // 默认按查询类型返回数据：profiles_roster 补查 → 花名册行；.in → 全部考勤；.eq → 单场考勤
    mocks.mockThen.mockImplementation((resolve: (v: unknown) => void) => {
      const lastFrom = mocks.mockFrom.mock.calls.at(-1)?.[0];
      if (lastFrom === "profiles_roster") {
        resolve({ data: mocks.mockRosterRows, error: null });
      } else if (mocks.mockIn.mock.calls.length > 0) {
        resolve({ data: mocks.mockAllAttendanceRows, error: null });
      } else if (mocks.mockEq.mock.calls.length > 0) {
        resolve({ data: mocks.mockSingleAttendanceRows, error: null });
      } else {
        resolve({ data: [], error: null });
      }
    });
  });

  // ==========================================
  // 验收标准 1: 排练列表展示（曲目/时间/地点）
  // ==========================================
  it("考勤 tab 默认展示排练列表（曲目/时间/地点）", () => {
    render(<MembersPage />);
    expect(screen.getByText("贝多芬第五交响曲")).toBeInTheDocument();
    expect(screen.getByText("莫扎特协奏曲")).toBeInTheDocument();
    expect(screen.getByText("2026-08-20 · 19:00 - 21:00")).toBeInTheDocument();
    expect(screen.getByText("📍 新太阳活动中心")).toBeInTheDocument();
    expect(screen.getByText("📥 导出区间全部考勤（2 场排练）")).toBeInTheDocument();
  });

  it("根容器 flex 化（矮屏布局）：头部固定、外层无嵌套滚动（审计批次 3 + Issue #171）", () => {
    const { container } = render(<MembersPage />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("h-full");
    expect(root.className).toContain("flex-col");
    // 外层不再带 overflow-y-auto（消除嵌套滚动），滚动下沉到内层列表（max-h + overflow-y-auto）
    const outer = root.querySelector("div.flex-1.min-h-0") as HTMLElement | null;
    expect(outer).not.toBeNull();
    expect(outer!.className).not.toContain("overflow-y-auto");
    // 内层考勤列表保留自己的滚动容器（默认视图为考勤 tab）
    const innerList = root.querySelector("section div.max-h-\\[400px\\]") as HTMLElement | null;
    expect(innerList).not.toBeNull();
    expect(innerList!.className).toContain("overflow-y-auto");
  });

  // ==========================================
  // 验收标准 2: 点击排练行打开考勤弹窗
  // ==========================================
  it("点击排练行打开该排练的考勤弹窗（可编辑）", async () => {
    render(<MembersPage />);
    fireEvent.click(screen.getByText("贝多芬第五交响曲"));

    await waitFor(() => {
      expect(screen.getByText("出勤名单")).toBeInTheDocument();
    });
    expect(screen.getByText(/排练：贝多芬第五交响曲/)).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.mockFetchByRehearsal).toHaveBeenCalledWith(1);
    });
    // 名单渲染（含声部）
    await waitFor(() => {
      expect(screen.getByText("张小三")).toBeInTheDocument();
      expect(screen.getByText("李小四")).toBeInTheDocument();
      expect(screen.getByText("小提琴")).toBeInTheDocument();
    });
    // 可编辑：存在状态下拉框与保存按钮
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
    expect(screen.getByText("保存修改")).toBeInTheDocument();
  });

  // ==========================================
  // 验收标准 3: 考勤编辑保存
  // ==========================================
  it("修改成员状态后点击保存，调用 updateStatus 并刷新名单", async () => {
    render(<MembersPage />);
    fireEvent.click(screen.getByText("贝多芬第五交响曲"));
    await waitFor(() => {
      expect(screen.getByText("出勤名单")).toBeInTheDocument();
    });

    // 第一行（张三，默认缺席）改为出席
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "present" } });
    fireEvent.click(screen.getByText("保存修改"));

    await waitFor(() => {
      expect(mocks.mockUpdateStatus).toHaveBeenCalledWith(1, "u1", "present");
    });
    // 保存后刷新名单（fetchByRehearsal 共调用 2 次：打开 1 次 + 保存后 1 次）
    expect(mocks.mockFetchByRehearsal).toHaveBeenCalledTimes(2);
  });

  it("保存考勤修改成功 → 向该成员插 attendance 通知（文案含排练曲目与状态中文名）", async () => {
    render(<MembersPage />);
    fireEvent.click(screen.getByText("贝多芬第五交响曲"));
    await waitFor(() => {
      expect(screen.getByText("出勤名单")).toBeInTheDocument();
    });

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "present" } });
    fireEvent.click(screen.getByText("保存修改"));

    await waitFor(() => {
      expect(mocks.mockInsert).toHaveBeenCalledWith({
        user_id: "u1",
        category: "attendance",
        title: "考勤状态已更新",
        content: "《贝多芬第五交响曲》排练的考勤状态已更新为「出席」",
      });
    });
  });

  it("考勤更新失败时不插通知（best-effort 只在成功后发）", async () => {
    mocks.mockUpdateStatus.mockResolvedValueOnce("update failed");
    render(<MembersPage />);
    fireEvent.click(screen.getByText("贝多芬第五交响曲"));
    await waitFor(() => {
      expect(screen.getByText("出勤名单")).toBeInTheDocument();
    });

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "present" } });
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    fireEvent.click(screen.getByText("保存修改"));

    await waitFor(() => {
      expect(mocks.mockUpdateStatus).toHaveBeenCalledWith(1, "u1", "present");
    });
    expect(alertSpy).toHaveBeenCalledWith("部分出勤更新失败，请刷新后重试");
    expect(mocks.mockInsert).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it("updateStatus 0 行（考勤行被级联删除/RLS 静默失败）→ 视为失败不插通知", async () => {
    // 0 行无 error 的假成功：updateStatus 返回错误语义（useAttendance.updateStatus .select("id") 检测）
    mocks.mockUpdateStatus.mockResolvedValueOnce("考勤行不存在或已被删除，更新未生效");
    render(<MembersPage />);
    fireEvent.click(screen.getByText("贝多芬第五交响曲"));
    await waitFor(() => {
      expect(screen.getByText("出勤名单")).toBeInTheDocument();
    });

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "present" } });
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    fireEvent.click(screen.getByText("保存修改"));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith("部分出勤更新失败，请刷新后重试");
    });
    expect(mocks.mockInsert).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it("改回原值（present→absent 原值）保存：不调用 updateStatus、不插通知", async () => {
    render(<MembersPage />);
    fireEvent.click(screen.getByText("贝多芬第五交响曲"));
    await waitFor(() => {
      expect(screen.getByText("出勤名单")).toBeInTheDocument();
    });

    // 张小三默认 absent：先改 present 再改回 absent（最终值 = 行原值，无实际变更）
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "present" } });
    fireEvent.change(selects[0], { target: { value: "absent" } });
    fireEvent.click(screen.getByText("保存修改"));

    await waitFor(() => {
      expect(screen.getByText("保存修改")).toBeInTheDocument();
    });
    expect(mocks.mockUpdateStatus).not.toHaveBeenCalled();
    expect(mocks.mockInsert).not.toHaveBeenCalled();
  });

  it("无改动时点击保存不调用 updateStatus", async () => {
    render(<MembersPage />);
    fireEvent.click(screen.getByText("贝多芬第五交响曲"));
    await waitFor(() => {
      expect(screen.getByText("出勤名单")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("保存修改"));
    await waitFor(() => {
      expect(mocks.mockUpdateStatus).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // 验收标准 4: 导出按钮不触发行处理器
  // ==========================================
  it("点击导出按钮不打开考勤弹窗", async () => {
    render(<MembersPage />);
    fireEvent.click(screen.getAllByText("📥 导出")[0]);

    await waitFor(() => {
      expect(mocks.mockWriteFile).toHaveBeenCalled();
    });
    expect(screen.queryByText("出勤名单")).not.toBeInTheDocument();
    expect(mocks.mockFetchByRehearsal).not.toHaveBeenCalled();
  });

  // ==========================================
  // 验收标准 4b: 键盘操作导出按钮不被行处理器劫持（返工回归）
  // ==========================================
  it("键盘 Enter 操作导出按钮不打开考勤弹窗，且正常触发导出", async () => {
    render(<MembersPage />);
    const exportBtn = screen.getAllByText("📥 导出")[0];
    exportBtn.focus();
    // 真实浏览器中聚焦 button 后按 Enter 会合成原生 click；jsdom 不自动合成，需手动补发
    fireEvent.keyDown(exportBtn, { key: "Enter" });
    // 行容器目标守卫生效：导出按钮的键盘事件不被劫持，弹窗不打开
    expect(screen.queryByText("出勤名单")).not.toBeInTheDocument();
    expect(mocks.mockFetchByRehearsal).not.toHaveBeenCalled();

    fireEvent.click(exportBtn);
    await waitFor(() => {
      expect(mocks.mockWriteFile).toHaveBeenCalled();
    });
    expect(screen.queryByText("出勤名单")).not.toBeInTheDocument();
  });

  // ==========================================
  // 验收标准 5: 关闭后再次点击其他排练行
  // ==========================================
  it("关闭弹窗后点击另一排练行，按新排练 id 拉取名单", async () => {
    render(<MembersPage />);
    fireEvent.click(screen.getByText("贝多芬第五交响曲"));
    await waitFor(() => {
      expect(screen.getByText("出勤名单")).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText("关闭")[0]);
    await waitFor(() => {
      expect(screen.queryByText("出勤名单")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("莫扎特协奏曲"));
    await waitFor(() => {
      expect(mocks.mockFetchByRehearsal).toHaveBeenCalledWith(2);
    });
    expect(screen.getByText("出勤名单")).toBeInTheDocument();
  });

  // ==========================================
  // 验收标准 6: 语义 Token
  // ==========================================
  it("布局使用语义 Token，不硬编码 zinc 颜色", () => {
    const { container } = render(<MembersPage />);
    const html = container.innerHTML;
    expect(html).toContain("bg-card");
    expect(html).toContain("border-border");
    expect(html).toContain("text-text");
    expect(html).toContain("text-text-muted");
    expect(html).not.toMatch(/border-zinc|bg-zinc|text-zinc/);
  });

  // ==========================================
  // Issue #169: 导出全部考勤在微信浏览器无效
  // ==========================================
  it("导出全部：一次 .in 查询拉取全部考勤，不逐场 .eq 查询", async () => {
    render(<MembersPage />);
    fireEvent.click(screen.getByText("📥 导出区间全部考勤（2 场排练）"));

    await waitFor(() => {
      expect(mocks.mockWriteFile).toHaveBeenCalled();
    });
    // 只发两次查询：attendances 一次 .in（携带全部排练 id，按开始时间倒序，无逐场查询）
    // + profiles_roster 一次补查（视图无 FK 无法 embed，Issue #193）
    expect(mocks.mockFrom).toHaveBeenCalledTimes(2);
    expect(mocks.mockFrom).toHaveBeenCalledWith("profiles_roster");
    expect(mocks.mockIn).toHaveBeenCalledWith("rehearsal_id", [2, 1]);
    expect(mocks.mockEq).not.toHaveBeenCalled();
    // 每个排练一个 sheet，sheet 名为 曲目_日期（按列表顺序：8-21 在 8-20 之前）
    expect(mocks.mockBookAppendSheet).toHaveBeenCalledTimes(2);
    const sheetNames = mocks.mockBookAppendSheet.mock.calls.map((c) => c[2]);
    expect(sheetNames).toEqual(["莫扎特协奏曲_2026-08-21", "贝多芬第五交响曲_2026-08-20"]);
    // 无日期筛选时文件名区间为「全部」
    expect(mocks.mockWriteFile).toHaveBeenCalledWith(expect.anything(), "考勤记录_全部_全部.xlsx");
  });

  it("导出全部：区间为空时 alert 提示（不再静默 return）", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    mocks.mockRehearsals.splice(0, mocks.mockRehearsals.length);

    render(<MembersPage />);
    fireEvent.click(screen.getByText("📥 导出区间全部考勤（0 场排练）"));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith("当前区间暂无排练可导出");
    });
    expect(mocks.mockWriteFile).not.toHaveBeenCalled();
    expect(mocks.mockFrom).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it("导出全部：区间内全部排练无出勤记录时 alert 提示", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    mocks.mockThen.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null }),
    );

    render(<MembersPage />);
    fireEvent.click(screen.getByText("📥 导出区间全部考勤（2 场排练）"));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith("该区间暂无出勤记录");
    });
    expect(mocks.mockWriteFile).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it("导出全部：查询失败时 alert 错误信息（微信 XWeb 静默防护）", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    mocks.mockThen.mockImplementation((_resolve: unknown, reject: (e: Error) => void) =>
      reject(new Error("网络中断")),
    );

    render(<MembersPage />);
    fireEvent.click(screen.getByText("📥 导出区间全部考勤（2 场排练）"));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith("导出失败：网络中断");
    });
    expect(mocks.mockWriteFile).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  // ==========================================
  // Issue #193：导出姓名/邮箱改由 profiles_roster 补查（原 join embed 因视图无 FK 失效）
  // ==========================================
  it("导出单场：姓名/邮箱来自 profiles_roster 补查（admin 经视图拿原值）", async () => {
    render(<MembersPage />);
    fireEvent.click(screen.getAllByText("📥 导出")[0]);

    await waitFor(() => {
      expect(mocks.mockWriteFile).toHaveBeenCalled();
    });
    expect(mocks.mockFrom).toHaveBeenCalledWith("profiles_roster");
    expect(mocks.mockAoaToSheet).toHaveBeenCalledWith([
      ["姓名", "邮箱", "出勤情况", "在团情况", "签到时间"],
      ["张小三", "zhangsan@example.com", "出席", "在团", "2026-08-20T19:05:00"],
    ]);
  });

  it("导出全部：每行姓名/邮箱均来自 profiles_roster 补查，无补查记录显示 —", async () => {
    render(<MembersPage />);
    fireEvent.click(screen.getByText("📥 导出区间全部考勤（2 场排练）"));

    await waitFor(() => {
      expect(mocks.mockWriteFile).toHaveBeenCalled();
    });
    // 排练按开始时间倒序：第一张 sheet（莫扎特，rehearsal_id=2）一行：王小五 迟到（未设置在团 → —）
    expect(mocks.mockAoaToSheet.mock.calls[0][0]).toEqual([
      ["姓名", "邮箱", "出勤情况", "在团情况", "签到时间"],
      ["王小五", "wangwu@example.com", "迟到", "—", "2026-08-21T14:10:00"],
    ]);
    // 第二张 sheet（贝多芬，rehearsal_id=1）两行：张小三(在团)/李小四(不在团)
    expect(mocks.mockAoaToSheet.mock.calls[1][0]).toEqual([
      ["姓名", "邮箱", "出勤情况", "在团情况", "签到时间"],
      ["张小三", "zhangsan@example.com", "缺席", "在团", "—"],
      ["李小四", "lisi@example.com", "出席", "不在团", "2026-08-20T19:05:00"],
    ]);
  });

  it("导出单场：查询失败时 alert 错误信息（与导出全部对称）", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    mocks.mockThen.mockImplementation((_resolve: unknown, reject: (e: Error) => void) =>
      reject(new Error("网络中断")),
    );

    render(<MembersPage />);
    fireEvent.click(screen.getAllByText("📥 导出")[0]);

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith("导出失败：网络中断");
    });
    expect(mocks.mockWriteFile).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it("导出全部：sheet 名重名时追加序号（曲目_日期 去重）", async () => {
    // 两场排练同曲目同日期 → sheet 名相同 → 第二个追加 (2)
    mocks.mockRehearsals.splice(
      0,
      mocks.mockRehearsals.length,
      {
        id: 1,
        repertoire: "贝多芬第五交响曲",
        start_time: "2026-08-20T19:00:00",
        end_time: "2026-08-20T21:00:00",
        location: "新太阳活动中心",
      },
      {
        id: 2,
        repertoire: "贝多芬第五交响曲",
        start_time: "2026-08-20T09:00:00",
        end_time: "2026-08-20T11:00:00",
        location: "排练厅 201",
      },
    );

    render(<MembersPage />);
    fireEvent.click(screen.getByText("📥 导出区间全部考勤（2 场排练）"));

    await waitFor(() => {
      expect(mocks.mockWriteFile).toHaveBeenCalled();
    });
    const sheetNames = mocks.mockBookAppendSheet.mock.calls.map((c) => c[2]);
    expect(sheetNames).toEqual(["贝多芬第五交响曲_2026-08-20", "贝多芬第五交响曲_2026-08-20(2)"]);
  });

  // ==========================================
  // 导出文件名/sheet 名日期偏移回归（UTC+8 下 toISOString 退回前一天）
  // 测试时区已固定为 Asia/Shanghai：凌晨开始的排练，旧实现会输出前一天日期
  // ==========================================
  it("导出单场：文件名日期使用本地日期（UTC+8 不偏移一天）", async () => {
    mocks.mockRehearsals.splice(0, mocks.mockRehearsals.length, {
      id: 1,
      repertoire: "贝多芬第五交响曲",
      start_time: "2026-08-20T01:00:00",
      end_time: "2026-08-20T03:00:00",
      location: "新太阳活动中心",
    });

    render(<MembersPage />);
    fireEvent.click(screen.getAllByText("📥 导出")[0]);

    await waitFor(() => {
      expect(mocks.mockWriteFile).toHaveBeenCalledWith(
        expect.anything(),
        "考勤记录_贝多芬第五交响曲_2026-08-20.xlsx",
      );
    });
  });

  it("导出全部：sheet 名日期使用本地日期（凌晨排练不退回前一天）", async () => {
    mocks.mockRehearsals.splice(
      0,
      mocks.mockRehearsals.length,
      {
        id: 1,
        repertoire: "贝多芬第五交响曲",
        start_time: "2026-08-20T01:00:00",
        end_time: "2026-08-20T03:00:00",
        location: "新太阳活动中心",
      },
      {
        id: 2,
        repertoire: "莫扎特协奏曲",
        start_time: "2026-08-21T14:00:00",
        end_time: "2026-08-21T16:00:00",
        location: "排练厅 201",
      },
    );

    render(<MembersPage />);
    fireEvent.click(screen.getByText("📥 导出区间全部考勤（2 场排练）"));

    await waitFor(() => {
      expect(mocks.mockWriteFile).toHaveBeenCalled();
    });
    const sheetNames = mocks.mockBookAppendSheet.mock.calls.map((c) => c[2]);
    expect(sheetNames).toEqual(["莫扎特协奏曲_2026-08-21", "贝多芬第五交响曲_2026-08-20"]);
  });

  it("导出全部：文件名区间日期使用本地日期（选中日期筛选后不偏移）", async () => {
    render(<MembersPage />);
    const dateInputs = screen.getAllByPlaceholderText("选择日期");
    fireEvent.change(dateInputs[0], { target: { value: "2026-08-20" } });
    fireEvent.change(dateInputs[1], { target: { value: "2026-08-21" } });

    // 日期筛选后两场排练仍都在区间内
    fireEvent.click(screen.getByText("📥 导出区间全部考勤（2 场排练）"));

    await waitFor(() => {
      expect(mocks.mockWriteFile).toHaveBeenCalledWith(
        expect.anything(),
        "考勤记录_2026-08-20_2026-08-21.xlsx",
      );
    });
  });
});

// ============================================================
// 花名册 tab：入团时间行尾在团情况后缀（true → 团员 / false → 团友 / NULL → 无后缀）
// ============================================================
describe("AdminMembersPage 花名册 tab（在团情况后缀）", () => {
  /** 构造花名册成员（字段齐全，满足 ProfileRow） */
  function makeProfile(overrides: Partial<ProfileRow> = {}): ProfileRow {
    return {
      id: "m1",
      avatar_url: null,
      college: "信息科学技术学院",
      created_at: null,
      email: "zhangsan@example.com",
      full_name: "张三",
      hide_email: false,
      hide_join_date: false,
      hide_phone: false,
      hide_college: false,
      session_started_at: null,
      session_token: null,
      wechat_openid: null,
      instrument: "第一小提琴",
      is_section_leader: false,
      is_in_orchestra: true,
      join_date: "2024-09-01",
      phone_number: "13800138000",
      role: "member",
      status: "approved",
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.profiles.splice(0, mocks.profiles.length);
  });

  it("在团成员：入团时间后缀「团员」", () => {
    mocks.profiles.push(makeProfile({ is_in_orchestra: true }));
    render(<MembersPage />);
    fireEvent.click(screen.getByRole("button", { name: "全团成员" }));
    expect(screen.getByText(/入团时间：2024-09-01 团员/)).toBeInTheDocument();
  });

  it("不在团成员：入团时间后缀「团友」", () => {
    mocks.profiles.push(
      makeProfile({ id: "m2", full_name: "李四", is_in_orchestra: false, join_date: "2022秋" }),
    );
    render(<MembersPage />);
    fireEvent.click(screen.getByRole("button", { name: "全团成员" }));
    expect(screen.getByText(/入团时间：2022秋 团友/)).toBeInTheDocument();
  });

  it("未设置（NULL）：无后缀", () => {
    mocks.profiles.push(makeProfile({ id: "m3", full_name: "王五", is_in_orchestra: null }));
    render(<MembersPage />);
    fireEvent.click(screen.getByRole("button", { name: "全团成员" }));
    const line = screen.getByText(/入团时间：2024-09-01/);
    expect(line.textContent).not.toContain("团员");
    expect(line.textContent).not.toContain("团友");
  });
});
