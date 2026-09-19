// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import MembersPage from "./page";
import type { ProfileRow } from "@/types/database";
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
  ];
  const mockRehearsals = [...defaultRehearsals];

  const profiles: ProfileRow[] = [];

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
    data: mocks.profiles,
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

describe("AdminMembersPage 花名册 tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.profiles.splice(0, mocks.profiles.length);
    mocks.mockFetchByRehearsal.mockResolvedValue([]);
    mocks.mockFrom.mockReturnValue(mocks.chain);
    mocks.mockRehearsals.splice(0, mocks.mockRehearsals.length, ...mocks.defaultRehearsals);
    mocks.mockThen.mockImplementation((resolve: (v: unknown) => void) => {
      const lastFrom = mocks.mockFrom.mock.calls.at(-1)?.[0];
      if (lastFrom === "profiles_roster") {
        resolve({ data: mocks.mockRosterRows, error: null });
      } else {
        resolve({ data: [], error: null });
      }
    });
  });

  it("花名册 tab 成员列表", async () => {
    mocks.profiles.splice(
      0,
      0,
      {
        id: "u1",
        full_name: "张三",
        instrument: "小提琴",
        role: "member" as const,
        avatar_url: null,
        college: null,
        email: null,
        hide_college: false,
        hide_email: false,
        hide_join_date: false,
        hide_phone: false,
        is_in_orchestra: true,
        is_section_leader: false,
        join_date: null,
        phone_number: null,
        session_started_at: null,
        session_token: null,
        status: null,
        wechat_openid: null,
        created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "u2",
        full_name: "李四",
        instrument: "大提琴",
        role: "member" as const,
        avatar_url: null,
        college: null,
        email: null,
        hide_college: false,
        hide_email: false,
        hide_join_date: false,
        hide_phone: false,
        is_in_orchestra: true,
        is_section_leader: false,
        join_date: null,
        phone_number: null,
        session_started_at: null,
        session_token: null,
        status: null,
        wechat_openid: null,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    );

    renderWithProviders(<MembersPage />);
    fireEvent.click(screen.getByRole("button", { name: "全团成员" }));

    expect(screen.getByText("小提琴 - 张三")).toBeInTheDocument();
    expect(screen.getByText("大提琴 - 李四")).toBeInTheDocument();
  });

  it("花名册 tab 成员在团情况后缀：团员/团友/无后缀", async () => {
    mocks.profiles.splice(
      0,
      0,
      {
        id: "u1",
        full_name: "张小三",
        instrument: "小提琴",
        role: "member" as const,
        is_in_orchestra: true,
        avatar_url: null,
        college: null,
        email: null,
        hide_college: false,
        hide_email: false,
        hide_join_date: false,
        hide_phone: false,
        is_section_leader: false,
        join_date: null,
        phone_number: null,
        session_started_at: null,
        session_token: null,
        status: null,
        wechat_openid: null,
        created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "u2",
        full_name: "李小四",
        instrument: "大提琴",
        role: "member" as const,
        is_in_orchestra: false,
        avatar_url: null,
        college: null,
        email: null,
        hide_college: false,
        hide_email: false,
        hide_join_date: false,
        hide_phone: false,
        is_section_leader: false,
        join_date: null,
        phone_number: null,
        session_started_at: null,
        session_token: null,
        status: null,
        wechat_openid: null,
        created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "u3",
        full_name: "王小五",
        instrument: null,
        role: "member" as const,
        is_in_orchestra: null,
        avatar_url: null,
        college: null,
        email: null,
        hide_college: false,
        hide_email: false,
        hide_join_date: false,
        hide_phone: false,
        is_section_leader: false,
        join_date: null,
        phone_number: null,
        session_started_at: null,
        session_token: null,
        status: null,
        wechat_openid: null,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    );

    renderWithProviders(<MembersPage />);
    fireEvent.click(screen.getByRole("button", { name: "全团成员" }));

    // 张小三 is_in_orchestra=true → 团员
    expect(screen.getByText(/张小三/)).toBeInTheDocument();
    expect(screen.getByText(/团员/)).toBeInTheDocument();
    // 李小四 is_in_orchestra=false → 团友
    expect(screen.getByText(/李小四/)).toBeInTheDocument();
    expect(screen.getByText(/团友/)).toBeInTheDocument();
    // 王小五 is_in_orchestra=null → 无后缀
    expect(screen.getByText(/王小五/)).toBeInTheDocument();
  });
});
