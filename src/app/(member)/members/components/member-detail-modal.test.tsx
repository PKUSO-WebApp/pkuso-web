/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemberDetailModal } from "./member-detail-modal";
import type { ProfileRow } from "@/types/database";

// Mock Modal 组件，聚焦弹窗内容渲染
vi.mock("@/components/ui/Modal", () => ({
  Modal: vi.fn(
    ({ open, title, children }: { open: boolean; title?: string; children?: React.ReactNode }) => {
      if (!open) return null;
      return (
        <div data-testid={`modal-${title}`}>
          {title && <h2>{title}</h2>}
          {children}
        </div>
      );
    },
  ),
}));

const baseUser: ProfileRow = {
  id: "user-1",
  college: "信息科学技术学院",
  created_at: null,
  email: "zhangsan@example.com",
  full_name: "张三",
  instrument: "第一小提琴",
  is_section_leader: false,
  join_date: "2024-09-01",
  phone_number: "13800138000",
  role: "member",
  status: "approved",
};

describe("MemberDetailModal（用户侧只读详情）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("展示全部字段：姓名、乐器、学院、邮箱、联系方式、入团时间", () => {
    render(<MemberDetailModal open user={baseUser} onClose={() => {}} />);
    expect(screen.getByText("张三")).toBeInTheDocument();
    expect(screen.getByText("第一小提琴")).toBeInTheDocument();
    expect(screen.getByText("信息科学技术学院")).toBeInTheDocument();
    expect(screen.getByText("zhangsan@example.com")).toBeInTheDocument();
    expect(screen.getByText("13800138000")).toBeInTheDocument();
    expect(screen.getByText("2024-09-01")).toBeInTheDocument();
  });

  it("声部长显示 🏅 声部长 徽章", () => {
    render(
      <MemberDetailModal open user={{ ...baseUser, is_section_leader: true }} onClose={() => {}} />,
    );
    expect(screen.getByText("🏅 声部长")).toBeInTheDocument();
  });

  it("非声部长不显示徽章", () => {
    render(<MemberDetailModal open user={baseUser} onClose={() => {}} />);
    expect(screen.queryByText(/声部长/)).toBeNull();
  });

  it("空字段显示 —", () => {
    render(
      <MemberDetailModal
        open
        user={{ ...baseUser, college: null, phone_number: null }}
        onClose={() => {}}
      />,
    );
    const dashes = screen.getAllByText("—");
    // 学院 + 联系方式 两个空字段
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  it("user 为 null 时不崩溃", () => {
    render(<MemberDetailModal open user={null} onClose={() => {}} />);
    expect(screen.queryByText("张三")).toBeNull();
  });
});
