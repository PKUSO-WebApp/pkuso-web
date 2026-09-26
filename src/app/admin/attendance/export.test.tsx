// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import AttendancePage from "./page";
import { renderWithProviders } from "@/__tests__/render-with-providers";

process.env.TZ = "Asia/Shanghai";

const mocks = vi.hoisted(() => {
  const mockAoaToSheet = vi.fn();
  const mockBookNew = vi.fn(() => ({}));
  const mockBookAppendSheet = vi.fn();
  const mockWriteFile = vi.fn();
  const mockFrom = vi.fn();

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
  const mockRosterRows = [
    { id: "u1", full_name: "张小三", email: "zhangsan@example.com", is_in_orchestra: true },
    { id: "u2", full_name: "李小四", email: "lisi@example.com", is_in_orchestra: false },
  ];
  // u2 为 exempt：导出必须显示中文「无需出勤」，而不是裸英文值
  const mockAttendanceRows = [
    {
      id: 1,
      rehearsal_id: 1,
      user_id: "u1",
      status: "present",
      sign_in_time: "2026-08-20T19:05:00",
    },
    { id: 2, rehearsal_id: 1, user_id: "u2", status: "exempt", sign_in_time: null },
  ];

  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.then = vi.fn((resolve: (v: unknown) => void) => {
    const table = mockFrom.mock.calls.at(-1)?.[0];
    resolve({
      data: table === "profiles_roster" ? mockRosterRows : mockAttendanceRows,
      error: null,
    });
  });

  return {
    mockAoaToSheet,
    mockBookNew,
    mockBookAppendSheet,
    mockWriteFile,
    mockFrom,
    mockRehearsals,
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

vi.mock("@/hooks/useAttendanceEditor", () => ({
  useAttendanceEditor: () => ({
    attendanceRehearsal: null,
    attendanceLoading: false,
    attendanceList: [],
    attendanceSaving: false,
    openAttendance: vi.fn(),
    closeAttendance: vi.fn(),
    onAttendanceStatusChange: vi.fn(),
    saveAttendance: vi.fn(),
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { from: mocks.mockFrom },
}));

vi.mock("xlsx", () => ({
  utils: {
    aoa_to_sheet: mocks.mockAoaToSheet,
    book_new: mocks.mockBookNew,
    book_append_sheet: mocks.mockBookAppendSheet,
  },
  writeFile: mocks.mockWriteFile,
}));

describe("AdminAttendancePage 导出功能", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockFrom.mockReturnValue(mocks.chain);
  });

  it("单场导出：exempt 显示「无需出勤」而非裸英文", async () => {
    renderWithProviders(<AttendancePage />);
    fireEvent.click(screen.getAllByText("📥 导出")[0]);

    await waitFor(() => {
      expect(mocks.mockWriteFile).toHaveBeenCalled();
    });
    // 验收标准第 3 项：本页导出映射漏加 exempt 时本条会红
    expect(mocks.mockAoaToSheet).toHaveBeenCalledWith([
      ["姓名", "邮箱", "出勤情况", "在团情况", "签到时间"],
      ["张小三", "zhangsan@example.com", "出席", "在团", "2026-08-20T19:05:00"],
      ["李小四", "lisi@example.com", "无需出勤", "不在团", "—"],
    ]);
    expect(mocks.mockBookAppendSheet).toHaveBeenCalledTimes(1);
    expect(mocks.mockBookAppendSheet.mock.calls[0][2]).toBe("考勤记录");
  });

  it("导出区间全部：exempt 同样显示「无需出勤」（与单场导出是两条独立路径）", async () => {
    renderWithProviders(<AttendancePage />);
    fireEvent.click(screen.getByText("📥 导出区间全部考勤（2 场排练）"));

    await waitFor(() => {
      expect(mocks.mockWriteFile).toHaveBeenCalled();
    });
    expect(mocks.mockAoaToSheet).toHaveBeenCalledWith([
      ["姓名", "邮箱", "出勤情况", "在团情况", "签到时间"],
      ["张小三", "zhangsan@example.com", "出席", "在团", "2026-08-20T19:05:00"],
      ["李小四", "lisi@example.com", "无需出勤", "不在团", "—"],
    ]);
  });

  it("导出区间全部：设置日期区间后只导出区间内的排练，文件名含区间", async () => {
    // 再添一场落在区间之前的排练：区间取中间那天，两端边界才各自承重（对抗返工）
    mocks.mockRehearsals.push({
      id: 3,
      repertoire: "勃拉姆斯第四交响曲",
      start_time: "2026-08-19T19:00:00",
      end_time: "2026-08-19T21:00:00",
      location: "新太阳活动中心",
    });

    renderWithProviders(<AttendancePage />);
    const [startInput, endInput] = screen.getAllByPlaceholderText("选择日期");
    // 区间取中间的 2026-08-20：19 日要靠开始边界挡、21 日要靠结束边界挡
    fireEvent.change(startInput, { target: { value: "2026-08-20" } });
    fireEvent.keyDown(startInput, { key: "Enter" });
    fireEvent.change(endInput, { target: { value: "2026-08-20" } });
    fireEvent.keyDown(endInput, { key: "Enter" });

    fireEvent.click(await screen.findByText("📥 导出区间全部考勤（1 场排练）"));

    await waitFor(() => {
      expect(mocks.mockWriteFile).toHaveBeenCalled();
    });
    expect(mocks.mockBookAppendSheet).toHaveBeenCalledTimes(1);
    expect(mocks.mockBookAppendSheet.mock.calls[0][2]).toBe("贝多芬第五交响曲_2026-08-20");
    expect(mocks.mockWriteFile).toHaveBeenCalledWith(
      expect.anything(),
      "考勤记录_2026-08-20_2026-08-20.xlsx",
    );
  });
});
