// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import MembersPage from "./page";
import { renderWithProviders } from "@/__tests__/render-with-providers";

process.env.TZ = "Asia/Shanghai";

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
  const mockRehearsals = [...defaultRehearsals];

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
  ];

  const mockRosterRows = [
    { id: "u1", full_name: "张小三", email: "zhangsan@example.com", is_in_orchestra: true },
    { id: "u2", full_name: "李小四", email: "lisi@example.com", is_in_orchestra: false },
  ];

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

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: mocks.mockFrom,
  },
}));

vi.mock("xlsx", () => ({
  utils: {
    aoa_to_sheet: mocks.mockAoaToSheet,
    book_new: mocks.mockBookNew,
    book_append_sheet: mocks.mockBookAppendSheet,
  },
  writeFile: mocks.mockWriteFile,
}));

describe("AdminMembersPage 考勤 tab 核心功能", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockFetchByRehearsal.mockResolvedValue(mocks.mockAttendanceRows);
    mocks.mockFrom.mockReturnValue(mocks.chain);
    mocks.mockRehearsals.splice(0, mocks.mockRehearsals.length, ...mocks.defaultRehearsals);
    mocks.mockThen.mockImplementation((resolve: (v: unknown) => void) => {
      const lastFrom = mocks.mockFrom.mock.calls.at(-1)?.[0];
      if (lastFrom === "profiles_roster") {
        resolve({ data: mocks.mockRosterRows, error: null });
      } else if (mocks.mockEq.mock.calls.length > 0) {
        resolve({ data: mocks.mockAllAttendanceRows, error: null });
      } else if (mocks.mockIn.mock.calls.length > 0) {
        resolve({ data: mocks.mockAllAttendanceRows, error: null });
      } else {
        resolve({ data: [], error: null });
      }
    });
  });

  it("考勤 tab 默认展示排练列表（曲目/时间/地点）", () => {
    renderWithProviders(<MembersPage />);
    expect(screen.getByText("贝多芬第五交响曲")).toBeInTheDocument();
    expect(screen.getByText("莫扎特协奏曲")).toBeInTheDocument();
    expect(screen.getByText("2026-08-20 · 19:00 - 21:00")).toBeInTheDocument();
    expect(screen.getByText("📍 新太阳活动中心")).toBeInTheDocument();
    expect(screen.getByText("📥 导出区间全部考勤（2 场排练）")).toBeInTheDocument();
  });

  it("根容器 flex 化（矮屏布局）：头部固定、外层无嵌套滚动", () => {
    const { container } = renderWithProviders(<MembersPage />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("h-full");
    expect(root.className).toContain("flex-col");
    const outer = root.querySelector("div.flex-1.min-h-0") as HTMLElement | null;
    expect(outer).not.toBeNull();
    expect(outer!.className).not.toContain("overflow-y-auto");
    const innerList = root.querySelector("section div.max-h-\\[400px\\]") as HTMLElement | null;
    expect(innerList).not.toBeNull();
    expect(innerList!.className).toContain("overflow-y-auto");
  });

  it("点击排练行打开该排练的考勤弹窗（可编辑）", async () => {
    renderWithProviders(<MembersPage />);
    fireEvent.click(screen.getByText("贝多芬第五交响曲"));

    await waitFor(() => {
      expect(screen.getByText("出勤名单")).toBeInTheDocument();
    });
    expect(screen.getByText(/排练：贝多芬第五交响曲/)).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.mockFetchByRehearsal).toHaveBeenCalledWith(1);
    });
    await waitFor(() => {
      expect(screen.getByText("张小三")).toBeInTheDocument();
      expect(screen.getByText("李小四")).toBeInTheDocument();
      expect(screen.getByText("小提琴")).toBeInTheDocument();
    });
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
    expect(screen.getByText("保存修改")).toBeInTheDocument();
  });

  it("修改成员状态后点击保存，调用 updateStatus 并刷新名单", async () => {
    renderWithProviders(<MembersPage />);
    fireEvent.click(screen.getByText("贝多芬第五交响曲"));
    await waitFor(() => {
      expect(screen.getByText("出勤名单")).toBeInTheDocument();
    });

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "present" } });
    fireEvent.click(screen.getByText("保存修改"));

    await waitFor(() => {
      expect(mocks.mockUpdateStatus).toHaveBeenCalledWith(1, "u1", "present");
    });
    expect(mocks.mockFetchByRehearsal).toHaveBeenCalledTimes(2);
  });

  it("保存考勤修改成功 → 向该成员插 attendance 通知", async () => {
    renderWithProviders(<MembersPage />);
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

  it("考勤更新失败时不插通知", async () => {
    mocks.mockUpdateStatus.mockResolvedValueOnce("update failed");
    renderWithProviders(<MembersPage />);
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

  it("updateStatus 0 行 → 视为失败不插通知", async () => {
    mocks.mockUpdateStatus.mockResolvedValueOnce("考勤行不存在或已被删除，更新未生效");
    renderWithProviders(<MembersPage />);
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

  it("改回原值保存：不调用 updateStatus、不插通知", async () => {
    renderWithProviders(<MembersPage />);
    fireEvent.click(screen.getByText("贝多芬第五交响曲"));
    await waitFor(() => {
      expect(screen.getByText("出勤名单")).toBeInTheDocument();
    });

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
    renderWithProviders(<MembersPage />);
    fireEvent.click(screen.getByText("贝多芬第五交响曲"));
    await waitFor(() => {
      expect(screen.getByText("出勤名单")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("保存修改"));
    await waitFor(() => {
      expect(mocks.mockUpdateStatus).not.toHaveBeenCalled();
    });
  });

  it("点击导出按钮不打开考勤弹窗", async () => {
    renderWithProviders(<MembersPage />);
    fireEvent.click(screen.getAllByText("📥 导出")[0]);

    await waitFor(() => {
      expect(mocks.mockWriteFile).toHaveBeenCalled();
    });
    expect(screen.queryByText("出勤名单")).not.toBeInTheDocument();
    expect(mocks.mockFetchByRehearsal).not.toHaveBeenCalled();
  });

  it("键盘 Enter 操作导出按钮不打开考勤弹窗", async () => {
    renderWithProviders(<MembersPage />);
    const exportBtn = screen.getAllByText("📥 导出")[0];
    exportBtn.focus();
    fireEvent.keyDown(exportBtn, { key: "Enter" });
    expect(screen.queryByText("出勤名单")).not.toBeInTheDocument();
    expect(mocks.mockFetchByRehearsal).not.toHaveBeenCalled();

    fireEvent.click(exportBtn);
    await waitFor(() => {
      expect(mocks.mockWriteFile).toHaveBeenCalled();
    });
    expect(screen.queryByText("出勤名单")).not.toBeInTheDocument();
  });

  it("关闭弹窗后点击另一排练行，按新排练 id 拉取名单", async () => {
    renderWithProviders(<MembersPage />);
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

  it("布局使用语义 Token，不硬编码 zinc 颜色", () => {
    const { container } = renderWithProviders(<MembersPage />);
    const html = container.innerHTML;
    expect(html).toContain("bg-card");
    expect(html).toContain("border-border");
    expect(html).toContain("text-text");
    expect(html).toContain("text-text-muted");
    expect(html).not.toMatch(/border-zinc|bg-zinc|text-zinc/);
  });
});
