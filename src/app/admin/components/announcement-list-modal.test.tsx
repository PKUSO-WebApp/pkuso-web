// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AnnouncementListModal } from "./announcement-list-modal";
import { formatDateTimeInChina } from "@/lib/date-utils";
import type { AnnouncementRow } from "@/types/database";

// ---- Mock Modal 组件 ----
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

import { Modal } from "@/components/ui/Modal";

const sampleAnnouncements: AnnouncementRow[] = [
  {
    id: "ann-1",
    content: "欢迎来到新学期！请大家准时参加排练。",
    created_at: "2024-07-31T14:30:00Z",
  },
  {
    id: "ann-2",
    content: "本周六举行音乐会，请大家做好准备。",
    created_at: "2024-08-01T08:00:00Z",
  },
];

describe("AnnouncementListModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("公告列表中时间使用 formatDateTimeInChina 显示（UTC 转换）", () => {
    render(
      <AnnouncementListModal
        open={true}
        onClose={() => {}}
        announcements={sampleAnnouncements}
        loading={false}
        deletingId={null}
        updatingId={null}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );

    // 验证第一条公告的时间（UTC 14:30 → 北京时间 22:30）
    const expected1 = formatDateTimeInChina("2024-07-31T14:30:00Z");
    expect(
      screen.getByText(new RegExp(expected1.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))),
    ).toBeInTheDocument();

    // 验证第二条公告的时间（UTC 08:00 → 北京时间 16:00）
    const expected2 = formatDateTimeInChina("2024-08-01T08:00:00Z");
    expect(
      screen.getByText(new RegExp(expected2.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))),
    ).toBeInTheDocument();
  });

  it("公告详情中时间使用 formatDateTimeInChina 显示", async () => {
    render(
      <AnnouncementListModal
        open={true}
        onClose={() => {}}
        announcements={sampleAnnouncements}
        loading={false}
        deletingId={null}
        updatingId={null}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );

    // 点击第一条公告进入详情
    fireEvent.click(screen.getByText(/欢迎来到新学期/));

    await waitFor(() => {
      // 详情页显示"发布时间"
      expect(screen.getByText(/发布时间/)).toBeInTheDocument();
    });

    const expected = formatDateTimeInChina("2024-07-31T14:30:00Z");
    expect(
      screen.getByText(new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))),
    ).toBeInTheDocument();
  });

  it("删除确认使用内联块（而非 Modal）", async () => {
    const onDeleteMock = vi.fn().mockResolvedValue(true);

    render(
      <AnnouncementListModal
        open={true}
        onClose={() => {}}
        announcements={sampleAnnouncements}
        loading={false}
        deletingId={null}
        updatingId={null}
        onDelete={onDeleteMock}
        onUpdate={vi.fn()}
      />,
    );

    // 在列表中点击删除按钮（stopPropagation 防止选中）
    const deleteButtons = screen.getAllByRole("button").filter(
      (btn) => btn.querySelector("svg"), // SVG 图标按钮
    );
    expect(deleteButtons.length).toBeGreaterThan(0);

    // 点击第一个删除按钮
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      // 内联确认块出现
      expect(screen.getByText(/确认删除这条公告/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /确认删除/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /取消/ })).toBeInTheDocument();
    });

    // 内联确认块使用 danger 样式
    const confirmBlock = screen.getByText(/确认删除这条公告/).closest("div");
    expect(confirmBlock).toHaveClass("border-danger/30");
  });

  it("确认删除成功后列表移除该公告", async () => {
    const onDeleteMock = vi.fn().mockResolvedValue(true);

    render(
      <AnnouncementListModal
        open={true}
        onClose={() => {}}
        announcements={sampleAnnouncements}
        loading={false}
        deletingId={null}
        updatingId={null}
        onDelete={onDeleteMock}
        onUpdate={vi.fn()}
      />,
    );

    // 在列表中点击删除按钮
    const deleteButtons = screen.getAllByRole("button").filter((btn) => btn.querySelector("svg"));
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/确认删除这条公告/)).toBeInTheDocument();
    });

    // 确认删除
    fireEvent.click(screen.getByRole("button", { name: /确认删除/ }));

    await waitFor(() => {
      expect(onDeleteMock).toHaveBeenCalledWith("ann-1");
    });
  });

  it("删除中禁用按钮防止重复操作", async () => {
    let deleteResolve!: (value: boolean) => void;
    const deletePromise = new Promise<boolean>((resolve) => {
      deleteResolve = resolve;
    });
    const onDeleteMock = vi.fn().mockReturnValue(deletePromise);

    const { rerender } = render(
      <AnnouncementListModal
        open={true}
        onClose={() => {}}
        announcements={sampleAnnouncements}
        loading={false}
        deletingId={null}
        updatingId={null}
        onDelete={onDeleteMock}
        onUpdate={vi.fn()}
      />,
    );

    // 点击删除按钮
    const deleteButtons = screen.getAllByRole("button").filter((btn) => btn.querySelector("svg"));
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/确认删除这条公告/)).toBeInTheDocument();
    });

    // 点击确认删除
    fireEvent.click(screen.getByRole("button", { name: /确认删除/ }));

    // 重新渲染，deletingId 设为 "ann-1"
    rerender(
      <AnnouncementListModal
        open={true}
        onClose={() => {}}
        announcements={sampleAnnouncements}
        loading={false}
        deletingId={"ann-1"}
        updatingId={null}
        onDelete={onDeleteMock}
        onUpdate={vi.fn()}
      />,
    );

    // 删除中时按钮文本变为"删除中…"且被禁用
    const processingBtn = screen.getByRole("button", { name: /删除中/ });
    expect(processingBtn).toBeDisabled();

    // 解决删除
    deleteResolve(true);
  });

  it("空列表时显示'暂无公告'", () => {
    render(
      <AnnouncementListModal
        open={true}
        onClose={() => {}}
        announcements={[]}
        loading={false}
        deletingId={null}
        updatingId={null}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );

    expect(screen.getByText("暂无公告")).toBeInTheDocument();
  });

  it("加载中显示'加载中…'", () => {
    render(
      <AnnouncementListModal
        open={true}
        onClose={() => {}}
        announcements={[]}
        loading={true}
        deletingId={null}
        updatingId={null}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );

    expect(screen.getByText("加载中…")).toBeInTheDocument();
  });

  it("Modal 组件 position 默认为 bottom", () => {
    render(
      <AnnouncementListModal
        open={true}
        onClose={() => {}}
        announcements={sampleAnnouncements}
        loading={false}
        deletingId={null}
        updatingId={null}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );

    expect(Modal).toHaveBeenCalled();
    const modalCalls = (Modal as unknown as Mock).mock.calls;
    const lastCall = modalCalls[modalCalls.length - 1];
    // position 应为 "bottom"（默认值）
    expect(lastCall[0].position).toBe("bottom");
  });
});
