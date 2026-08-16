// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MembersPage from "./page";

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

  // 导出全部：一次 .in 查询返回的全部出勤记录（覆盖两个排练）
  const mockAllAttendanceRows = [
    {
      id: 1,
      rehearsal_id: 1,
      user_id: "u1",
      status: "absent",
      sign_in_time: null,
      profiles: { full_name: "张小三", instrument: "小提琴", email: "zhangsan@example.com" },
    },
    {
      id: 2,
      rehearsal_id: 1,
      user_id: "u2",
      status: "present",
      sign_in_time: "2026-08-20T19:05:00",
      profiles: { full_name: "李小四", instrument: "大提琴", email: "lisi@example.com" },
    },
    {
      id: 3,
      rehearsal_id: 2,
      user_id: "u3",
      status: "late",
      sign_in_time: "2026-08-21T14:10:00",
      profiles: { full_name: "王小五", instrument: "长笛", email: "wangwu@example.com" },
    },
  ];

  // 导出单场：.eq 查询返回
  const mockSingleAttendanceRows = [
    {
      profiles: { full_name: "张三", email: "zhangsan@example.com" },
      status: "present",
      sign_in_time: "2026-08-20T19:05:00",
    },
  ];

  // supabase 链式 mock：select/eq/in/order 返回链自身，then 由 beforeEach 按查询类型配置返回值
  const mockSelect = vi.fn();
  const mockEq = vi.fn();
  const mockIn = vi.fn();
  const mockOrder = vi.fn();
  const mockThen = vi.fn();
  const mockFrom = vi.fn();
  const chain = {
    select: mockSelect,
    eq: mockEq,
    in: mockIn,
    order: mockOrder,
    then: mockThen,
  };
  mockSelect.mockReturnValue(chain);
  mockEq.mockReturnValue(chain);
  mockIn.mockReturnValue(chain);
  mockOrder.mockReturnValue(chain);

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
    mockSelect,
    mockEq,
    mockIn,
    mockOrder,
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

// Mock useProfiles（花名册 tab）
vi.mock("@/hooks/useProfiles", () => ({
  useProfiles: () => ({
    data: [],
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
    // 默认按查询类型返回数据：.in → 全部考勤；.eq → 单场考勤
    mocks.mockThen.mockImplementation((resolve: (v: unknown) => void) => {
      if (mocks.mockIn.mock.calls.length > 0) {
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

  it("根容器 flex 化（矮屏布局）：头部固定、筛选控件 + 列表整体独立滚动（审计批次 3）", () => {
    const { container } = render(<MembersPage />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("h-full");
    expect(root.className).toContain("flex-col");
    // Toggle + 考勤/花名册区块所在的滚动容器
    const scrollArea = root.querySelector(
      "div.flex-1.min-h-0.overflow-y-auto",
    ) as HTMLElement | null;
    expect(scrollArea).not.toBeNull();
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
    // 只发一次查询：.in 携带全部排练 id（按开始时间倒序），无逐场查询
    expect(mocks.mockFrom).toHaveBeenCalledTimes(1);
    expect(mocks.mockIn).toHaveBeenCalledTimes(1);
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
