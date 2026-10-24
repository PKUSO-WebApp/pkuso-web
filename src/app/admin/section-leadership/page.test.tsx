// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import SectionLeadershipPage from "./page";
import { renderWithProviders } from "@/__tests__/render-with-providers";
import type {
  ProfileRosterRow,
  SectionGroupMemberRow,
  SectionLeaderRow,
  SectionRow,
} from "@/types/database";

const h = vi.hoisted(() => {
  const sections: SectionRow[] = [
    {
      name: "第一小提琴",
      kind: "instrument",
      sort_order: 10,
      can_lead: true,
      can_principal: true,
      created_at: "2026-10-01T00:00:00Z",
    },
    {
      name: "长笛",
      kind: "instrument",
      sort_order: 20,
      can_lead: true,
      can_principal: true,
      created_at: "2026-10-01T00:00:00Z",
    },
    {
      name: "木管",
      kind: "group",
      sort_order: 30,
      can_lead: true,
      can_principal: false,
      created_at: "2026-10-01T00:00:00Z",
    },
  ];
  const groupMembers: SectionGroupMemberRow[] = [
    { group_name: "木管", member_name: "长笛", sort_order: 10 },
  ];
  const roster: ProfileRosterRow[] = [
    {
      id: "u1",
      full_name: "张三",
      instrument: "第一小提琴",
      status: "approved",
      role: "member",
      avatar_url: null,
      college: null,
      created_at: null,
      email: null,
      hide_college: null,
      hide_email: null,
      hide_join_date: null,
      hide_phone: null,
      is_in_orchestra: true,
      is_principal: false,
      is_section_leader: false,
      join_date: null,
      phone_number: null,
    },
    {
      id: "u2",
      full_name: "李四",
      instrument: "第一小提琴",
      status: "approved",
      role: "member",
      avatar_url: null,
      college: null,
      created_at: null,
      email: null,
      hide_college: null,
      hide_email: null,
      hide_join_date: null,
      hide_phone: null,
      is_in_orchestra: true,
      is_principal: false,
      is_section_leader: false,
      join_date: null,
      phone_number: null,
    },
  ];
  return {
    sections,
    groupMembers,
    roster,
    leaders: [] as SectionLeaderRow[],
    fetchMock: vi.fn(),
  };
});

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: "token" } },
      }),
    },
    from: (table: string) => ({
      select: () => {
        if (table === "sections") {
          return { order: () => Promise.resolve({ data: h.sections, error: null }) };
        }
        if (table === "section_group_members") {
          return { order: () => Promise.resolve({ data: h.groupMembers, error: null }) };
        }
        if (table === "section_leaders") {
          return Promise.resolve({ data: h.leaders, error: null });
        }
        if (table === "instrument_principals") {
          return Promise.resolve({ data: [], error: null });
        }
        return Promise.resolve({ data: h.roster, error: null });
      },
    }),
  },
}));

describe("角色任命页（P0c）", () => {
  beforeEach(() => {
    h.leaders = [];
    h.fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        action: string;
        section: string;
        userId: string;
      };
      if (body.action === "set_section_leader") {
        h.leaders = [
          {
            section: body.section,
            leader_id: body.userId,
            assigned_by: null,
            assigned_at: "2026-10-01T00:00:00Z",
          },
        ];
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });
    vi.stubGlobal("fetch", h.fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("按作用域列出声部长候选人，任命后显示现任", async () => {
    renderWithProviders(<SectionLeadershipPage />);

    expect(await screen.findByText("第一小提琴")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "任命声部长" })[0]);

    fireEvent.click(screen.getByRole("radio", { name: /张三/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(h.fetchMock).toHaveBeenCalledWith(
        "/api/admin/section-leadership",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            action: "set_section_leader",
            section: "第一小提琴",
            userId: "u1",
          }),
        }),
      );
    });

    expect(await screen.findByText(/现任：张三（第一小提琴）/)).toBeInTheDocument();
  });

  it("首席 tab 只列 can_principal 的乐器", async () => {
    renderWithProviders(<SectionLeadershipPage />);
    await screen.findByText("第一小提琴");

    fireEvent.click(screen.getByRole("button", { name: "首席" }));

    expect(screen.getByText("长笛")).toBeInTheDocument();
    expect(screen.queryByText("木管")).not.toBeInTheDocument();
  });

  it("搜索把已选成员过滤掉后，保存按钮失效（不能提交不可见的人）", async () => {
    renderWithProviders(<SectionLeadershipPage />);
    await screen.findByText("第一小提琴");
    fireEvent.click(screen.getAllByRole("button", { name: "任命声部长" })[0]);

    fireEvent.click(screen.getByRole("radio", { name: /张三/ }));
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();

    fireEvent.change(screen.getByPlaceholderText("搜索姓名"), {
      target: { value: "李四" },
    });
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });
});
