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
    {
      id: 3,
      rehearsal_id: 2,
      user_id: "u3",
      status: "late",
      sign_in_time: "2026-08-21T14:10:00",
    },
  ];

  const mockSingleAttendanceRows = [
    {
      user_id: "u1",
      status: "present",
      sign_in_time: "2026-08-20T19:05:00",
    },
  ];

  const mockRosterRows = [
    { id: "u1", full_name: "张小三", email: "zhangsan@example.com", is_in_orchestra: true },
    { id: "u2", full_name: "李小四", email: "lisi@example.com", is_in_orchestra: false },
    { id: "u3", full_name: "王小五", email: "wangwu@example.com", is_in_orchestra: null },
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
    mockSingleAttendanceRows,
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

describe("AdminMembersPage 导出功能", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockFetchByRehearsal.mockResolvedValue(mocks.mockAttendanceRows);
    mocks.mockFrom.mockReturnValue(mocks.chain);
    mocks.mockRehearsals.splice(0, mocks.mockRehearsals.length, ...mocks.defaultRehearsals);
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

  it("导出全部：一次 .in 查询拉取全部考勤，不逐场 .eq 查询", async () => {
    renderWithProviders(<MembersPage />);
    fireEvent.click(screen.getByText("📥 导出区间全部考勤（2 场排练）"));

    await waitFor(() => {
      expect(mocks.mockWriteFile).toHaveBeenCalled();
    });
    expect(mocks.mockFrom).toHaveBeenCalledTimes(2);
    expect(mocks.mockFrom).toHaveBeenCalledWith("profiles_roster");
    expect(mocks.mockIn).toHaveBeenCalledWith("rehearsal_id", [2, 1]);
    expect(mocks.mockEq).not.toHaveBeenCalled();
    expect(mocks.mockBookAppendSheet).toHaveBeenCalledTimes(2);
    const sheetNames = mocks.mockBookAppendSheet.mock.calls.map((c) => c[2]);
    expect(sheetNames).toEqual(["莫扎特协奏曲_2026-08-21", "贝多芬第五交响曲_2026-08-20"]);
    expect(mocks.mockWriteFile).toHaveBeenCalledWith(expect.anything(), "考勤记录_全部_全部.xlsx");
  });

  it("导出全部：区间为空时 alert 提示", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    mocks.mockRehearsals.splice(0, mocks.mockRehearsals.length);

    renderWithProviders(<MembersPage />);
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

    renderWithProviders(<MembersPage />);
    fireEvent.click(screen.getByText("📥 导出区间全部考勤（2 场排练）"));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith("该区间暂无出勤记录");
    });
    expect(mocks.mockWriteFile).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it("导出全部：查询失败时 alert 错误信息", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    mocks.mockThen.mockImplementation((_resolve: unknown, reject: (e: Error) => void) =>
      reject(new Error("网络中断")),
    );

    renderWithProviders(<MembersPage />);
    fireEvent.click(screen.getByText("📥 导出区间全部考勤（2 场排练）"));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith("导出失败：网络中断");
    });
    expect(mocks.mockWriteFile).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it("导出单场：姓名/邮箱来自 profiles_roster 补查", async () => {
    renderWithProviders(<MembersPage />);
    fireEvent.click(screen.getAllByText("📥 导出")[0]);

    await waitFor(() => {
      expect(mocks.mockWriteFile).toHaveBeenCalled();
    });
    expect(mocks.mockFrom).toHaveBeenCalledWith("profiles_roster");
    // 单场导出只有 mockSingleAttendanceRows 的 1 条记录（u1 present）
    expect(mocks.mockAoaToSheet).toHaveBeenCalledWith([
      ["姓名", "邮箱", "出勤情况", "在团情况", "签到时间"],
      ["张小三", "zhangsan@example.com", "出席", "在团", "2026-08-20T19:05:00"],
    ]);
    expect(mocks.mockBookAppendSheet).toHaveBeenCalledTimes(1);
    expect(mocks.mockBookAppendSheet.mock.calls[0][2]).toBe("考勤记录");
    expect(mocks.mockWriteFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("考勤记录_莫扎特协奏曲_2026-08-21.xlsx"),
    );
  });

  it("导出全部：sheet 名 = 曲目_日期，文件名区间正确", async () => {
    renderWithProviders(<MembersPage />);
    fireEvent.click(screen.getByText("📥 导出区间全部考勤（2 场排练）"));

    await waitFor(() => {
      expect(mocks.mockWriteFile).toHaveBeenCalled();
    });
    const sheetNames = mocks.mockBookAppendSheet.mock.calls.map((c) => c[2]);
    expect(sheetNames).toEqual(["莫扎特协奏曲_2026-08-21", "贝多芬第五交响曲_2026-08-20"]);
    expect(mocks.mockWriteFile).toHaveBeenCalledWith(expect.anything(), "考勤记录_全部_全部.xlsx");
  });

  it("导出全部：setDateRange 后文件名包含日期区间", async () => {
    renderWithProviders(<MembersPage />);
    fireEvent.click(screen.getByText("📥 导出区间全部考勤（2 场排练）"));

    await waitFor(() => {
      expect(mocks.mockWriteFile).toHaveBeenCalled();
    });
    // 未设置日期区间时文件名区间为「全部」
    expect(mocks.mockWriteFile).toHaveBeenCalledWith(expect.anything(), "考勤记录_全部_全部.xlsx");
  });
});
