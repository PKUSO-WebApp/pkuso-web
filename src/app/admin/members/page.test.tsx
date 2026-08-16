// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MembersPage from "./page";

// 通过 vi.hoisted 暴露可变 mock，方便测试内动态配置返回值
const mocks = vi.hoisted(() => {
  const mockFetchByRehearsal = vi.fn();
  const mockUpdateStatus = vi.fn().mockResolvedValue(null);
  const mockWriteFile = vi.fn();

  const mockRehearsals = [
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

  return {
    mockFetchByRehearsal,
    mockUpdateStatus,
    mockWriteFile,
    mockRehearsals,
    mockAttendanceRows,
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

// Mock supabase：导出单场考勤的查询链
vi.mock("@/lib/supabase", () => {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    then: vi.fn((resolve: (v: unknown) => void) =>
      resolve({
        data: [
          {
            profiles: { full_name: "张三", email: "zhangsan@example.com" },
            status: "present",
            sign_in_time: "2026-08-20T19:05:00",
          },
        ],
        error: null,
      }),
    ),
  };
  return {
    supabase: {
      from: vi.fn(() => chain),
    },
  };
});

// Mock xlsx：避免测试真正写文件
vi.mock("xlsx", () => ({
  utils: {
    aoa_to_sheet: vi.fn(),
    book_new: vi.fn(() => ({})),
    book_append_sheet: vi.fn(),
  },
  writeFile: mocks.mockWriteFile,
}));

describe("AdminMembersPage 组件（排练考勤 tab）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockFetchByRehearsal.mockResolvedValue(mocks.mockAttendanceRows);
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
});
