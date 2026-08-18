/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MembersPage from "./page";
import { useUser } from "@/context/user-context";
import { useProfiles } from "@/hooks/useProfiles";
import { MemberDetailModal } from "./components/member-detail-modal";
import type { ProfileRow } from "@/types/database";

vi.mock("@/context/user-context", () => ({
  useUser: vi.fn(),
}));

vi.mock("@/hooks/useProfiles", () => ({
  useProfiles: vi.fn(),
}));

// Mock 详情弹窗：聚焦页面级接线（搜索→过滤→点击打开），弹窗内容由弹窗自身单测覆盖
vi.mock("./components/member-detail-modal", () => ({
  MemberDetailModal: vi.fn(({ open, user }: { open: boolean; user: ProfileRow | null }) =>
    open ? <div data-testid="member-detail-modal">{user?.full_name ?? "no-user"}</div> : null,
  ),
}));

const mockUseUser = vi.mocked(useUser);
const mockUseProfiles = vi.mocked(useProfiles);
const mockMemberDetailModal = vi.mocked(MemberDetailModal);

function makeProfile(partial: Partial<ProfileRow> & { id: string; full_name: string }): ProfileRow {
  return {
    college: null,
    created_at: null,
    email: null,
    hide_email: false,
    hide_join_date: false,
    hide_phone: false,
    instrument: null,
    is_section_leader: false,
    join_date: null,
    phone_number: null,
    role: "member",
    status: "approved",
    ...partial,
  } as ProfileRow;
}

const SEARCH_PLACEHOLDER = "搜索姓名（支持中文/拼音/首字母）";

describe("MembersPage 成员花名册页", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认查看者：id=me 的成员，与花名册成员（id=1/2/3）不同（他人视角）
    mockUseUser.mockReturnValue({
      user: { id: "me", name: "我", role: "member", section: "小提琴" },
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockUseProfiles.mockReturnValue({
      data: [
        makeProfile({ id: "1", full_name: "王梓萱", instrument: "第一小提琴" }),
        makeProfile({ id: "2", full_name: "张三丰", instrument: "大提琴" }),
        makeProfile({ id: "3", full_name: "管理员", role: "admin" }),
      ],
      loading: false,
      error: null,
      saving: false,
      fetch: vi.fn(),
      update: vi.fn(),
    } as never);
  });

  it("按声部分组渲染成员，排除 admin 角色", () => {
    render(<MembersPage />);
    expect(screen.getByText("第一小提琴")).toBeInTheDocument();
    expect(screen.getByText("大提琴")).toBeInTheDocument();
    expect(screen.getByText(/王梓萱/)).toBeInTheDocument();
    expect(screen.getByText(/张三丰/)).toBeInTheDocument();
    // admin 被排除，不渲染
    expect(screen.queryByText(/管理员/)).toBeNull();
  });

  it("根容器 flex 化（矮屏布局）：头部固定、搜索框 + 列表整体独立滚动（审计批次 3）", () => {
    const { container } = render(<MembersPage />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("h-full");
    expect(root.className).toContain("flex-col");
    // 搜索框 + 列表所在的滚动容器
    const scrollArea = root.querySelector(
      "div.flex-1.min-h-0.overflow-y-auto",
    ) as HTMLElement | null;
    expect(scrollArea).not.toBeNull();
  });

  it("声部长成员显示 🏅 徽章", () => {
    mockUseProfiles.mockReturnValue({
      data: [
        makeProfile({
          id: "1",
          full_name: "王梓萱",
          instrument: "第一小提琴",
          is_section_leader: true,
        }),
      ],
      loading: false,
      error: null,
      saving: false,
      fetch: vi.fn(),
      update: vi.fn(),
    } as never);
    render(<MembersPage />);
    expect(screen.getByText("🏅 声部长")).toBeInTheDocument();
  });

  it("拼音搜索过滤成员", () => {
    render(<MembersPage />);
    fireEvent.change(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), {
      target: { value: "wang" },
    });
    expect(screen.getByText(/王梓萱/)).toBeInTheDocument();
    expect(screen.queryByText(/张三丰/)).toBeNull();
  });

  it("中文搜索过滤成员", () => {
    render(<MembersPage />);
    fireEvent.change(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), {
      target: { value: "张" },
    });
    expect(screen.getByText(/张三丰/)).toBeInTheDocument();
    expect(screen.queryByText(/王梓萱/)).toBeNull();
  });

  it("无匹配结果时显示「未找到匹配的成员」", () => {
    render(<MembersPage />);
    fireEvent.change(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), {
      target: { value: "zzzz" },
    });
    expect(screen.getByText("未找到匹配的成员")).toBeInTheDocument();
  });

  it("点击成员行打开详情弹窗并传入该成员", () => {
    render(<MembersPage />);
    fireEvent.click(screen.getByText(/王梓萱/));
    expect(mockMemberDetailModal).toHaveBeenLastCalledWith(
      expect.objectContaining({
        open: true,
        user: expect.objectContaining({ id: "1", full_name: "王梓萱" }),
      }),
      undefined,
    );
  });

  // ============================================================
  // Issue #193：他人开启隐私隐藏时列表掩码显示「（被隐藏）」，查看自己显示原值
  // ============================================================
  it("他人开启隐藏时列表邮箱/入团时间显示「（被隐藏）」，不显示原值", () => {
    mockUseProfiles.mockReturnValue({
      data: [
        makeProfile({
          id: "1",
          full_name: "王梓萱",
          instrument: "第一小提琴",
          email: "wang@example.com",
          join_date: "2024-09-01",
          hide_email: true,
          hide_join_date: true,
        }),
      ],
      loading: false,
      error: null,
      saving: false,
      fetch: vi.fn(),
      update: vi.fn(),
    } as never);
    render(<MembersPage />);
    // 邮箱行 + 入团时间行各一个「（被隐藏）」（文本节点与标签拼接，用部分匹配）
    expect(screen.getAllByText(/（被隐藏）/)).toHaveLength(2);
    expect(screen.queryByText(/wang@example\.com/)).toBeNull();
    expect(screen.queryByText(/2024-09-01/)).toBeNull();
  });

  it("查看自己时隐私开关不生效，列表显示原值", () => {
    mockUseUser.mockReturnValue({
      user: { id: "1", name: "王梓萱", role: "member", section: "第一小提琴" },
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockUseProfiles.mockReturnValue({
      data: [
        makeProfile({
          id: "1",
          full_name: "王梓萱",
          instrument: "第一小提琴",
          email: "wang@example.com",
          join_date: "2024-09-01",
          hide_email: true,
          hide_join_date: true,
        }),
      ],
      loading: false,
      error: null,
      saving: false,
      fetch: vi.fn(),
      update: vi.fn(),
    } as never);
    render(<MembersPage />);
    expect(screen.getByText(/wang@example\.com/)).toBeInTheDocument();
    expect(screen.getByText(/2024-09-01/)).toBeInTheDocument();
    expect(screen.queryByText(/（被隐藏）/)).toBeNull();
  });

  it("加载中显示加载提示", () => {
    mockUseProfiles.mockReturnValue({
      data: [],
      loading: true,
      error: null,
      saving: false,
      fetch: vi.fn(),
      update: vi.fn(),
    } as never);
    render(<MembersPage />);
    expect(screen.getByText("加载中…")).toBeInTheDocument();
  });

  it("无已通过成员时显示「暂无已通过成员」", () => {
    mockUseProfiles.mockReturnValue({
      data: [],
      loading: false,
      error: null,
      saving: false,
      fetch: vi.fn(),
      update: vi.fn(),
    } as never);
    render(<MembersPage />);
    expect(screen.getByText("暂无已通过成员")).toBeInTheDocument();
  });

  it("加载失败时显示错误信息", () => {
    mockUseProfiles.mockReturnValue({
      data: [],
      loading: false,
      error: "查询失败",
      saving: false,
      fetch: vi.fn(),
      update: vi.fn(),
    } as never);
    render(<MembersPage />);
    expect(screen.getByText("查询失败")).toBeInTheDocument();
  });
});
