// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AnnouncementListModal } from "./announcement-list-modal";
import { formatDisplayDateTime } from "@/lib/date-utils";
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
    title: "新学期排练通知",
    content: "欢迎来到新学期！请大家准时参加排练。",
    created_at: "2024-07-31T14:30:00Z",
    end_time: "2024-08-31T14:30:00Z",
  },
  {
    id: "ann-2",
    title: "音乐会预告",
    content: "本周六举行音乐会，请大家做好准备。",
    created_at: "2024-08-01T08:00:00Z",
    end_time: "2024-08-03T08:00:00Z",
  },
];

describe("AnnouncementListModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("公告列表中结束时间使用 formatDisplayDateTime 显示（含时分）", () => {
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

    const expected1 = formatDisplayDateTime("2024-08-31T14:30:00Z");
    expect(
      screen.getByText(new RegExp(expected1.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))),
    ).toBeInTheDocument();

    const expected2 = formatDisplayDateTime("2024-08-03T08:00:00Z");
    expect(
      screen.getByText(new RegExp(expected2.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))),
    ).toBeInTheDocument();
  });

  it("公告详情中结束时间使用 formatDisplayDateTime 显示", async () => {
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
      // 详情页显示"结束时间"
      expect(screen.getByText(/结束时间/)).toBeInTheDocument();
    });

    const expected = formatDisplayDateTime("2024-08-31T14:30:00Z");
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

    // 进入 ann-1 详情后点「删除公告」展开确认块（确认块已移入查看模式 Issue #182）
    fireEvent.click(screen.getByText(/欢迎来到新学期/));
    fireEvent.click(screen.getByRole("button", { name: /删除公告/ }));

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

  it("查看模式：删除确认块位于内容框之后、按钮行之前（Issue #182）", async () => {
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

    // 进入详情后点「删除公告」展开确认块
    fireEvent.click(screen.getByText(/欢迎来到新学期/));
    fireEvent.click(screen.getByRole("button", { name: /删除公告/ }));

    await waitFor(() => {
      expect(screen.getByText(/确认删除这条公告/)).toBeInTheDocument();
    });

    // DOM 顺序：内容框 → 确认块 → 按钮行（返回列表/修改公告/删除公告）
    const contentBox = screen.getByText(/欢迎来到新学期/).closest("div")!;
    const confirmBlock = screen.getByText(/确认删除这条公告/).closest("div")!;
    const actionRow = screen.getByRole("button", { name: /返回列表/ }).parentElement!;
    expect(
      contentBox.compareDocumentPosition(confirmBlock) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      confirmBlock.compareDocumentPosition(actionRow) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("确认块与选中项绑定：A 行确认块未确认时返回列表再进 B，不显示 A 的确认块（对抗返工）", async () => {
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

    // 进入 A 行（ann-1）详情 → 点「删除公告」展开确认块
    fireEvent.click(screen.getByText(/欢迎来到新学期/));
    fireEvent.click(screen.getByRole("button", { name: /删除公告/ }));
    await waitFor(() => expect(screen.getByText(/确认删除这条公告/)).toBeInTheDocument());

    // 返回列表：确认块随之消失（返回列表同时清除确认状态）
    fireEvent.click(screen.getByRole("button", { name: /返回列表/ }));
    expect(screen.queryByText(/确认删除这条公告/)).toBeNull();

    // 进入 B 行（ann-2）详情：不显示 A 的确认块
    fireEvent.click(screen.getByText(/本周六举行音乐会/));
    expect(screen.getByText(/结束时间/)).toBeInTheDocument();
    expect(screen.queryByText(/确认删除这条公告/)).toBeNull();
  });

  it("详情删除确认块：进入编辑模式后保存回查看模式，确认块不重现（对抗返工）", async () => {
    const onUpdateMock = vi.fn().mockResolvedValue(true);
    render(
      <AnnouncementListModal
        open={true}
        onClose={() => {}}
        announcements={sampleAnnouncements}
        loading={false}
        deletingId={null}
        updatingId={null}
        onDelete={vi.fn()}
        onUpdate={onUpdateMock}
      />,
    );

    fireEvent.click(screen.getByText(/欢迎来到新学期/));
    fireEvent.click(screen.getByRole("button", { name: /删除公告/ }));
    await waitFor(() => expect(screen.getByText(/确认删除这条公告/)).toBeInTheDocument());

    // 修改公告 → 编辑模式（确认块消失）
    fireEvent.click(screen.getByRole("button", { name: /修改公告/ }));
    expect(screen.queryByText(/确认删除这条公告/)).toBeNull();

    // 保存成功 → 回查看模式，确认块不重现
    fireEvent.change(screen.getByPlaceholderText(/输入公告内容/), {
      target: { value: "新内容" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onUpdateMock).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /返回列表/ })).toBeTruthy();
    expect(screen.queryByText(/确认删除这条公告/)).toBeNull();
  });

  it("详情删除确认块：进入编辑模式后取消回查看模式，确认块不重现（对抗返工）", async () => {
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

    fireEvent.click(screen.getByText(/欢迎来到新学期/));
    fireEvent.click(screen.getByRole("button", { name: /删除公告/ }));
    await waitFor(() => expect(screen.getByText(/确认删除这条公告/)).toBeInTheDocument());

    // 修改公告 → 编辑模式（确认块消失）
    fireEvent.click(screen.getByRole("button", { name: /修改公告/ }));
    expect(screen.queryByText(/确认删除这条公告/)).toBeNull();

    // 取消编辑 → 回查看模式，确认块不重现
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByRole("button", { name: /返回列表/ })).toBeTruthy();
    expect(screen.queryByText(/确认删除这条公告/)).toBeNull();
  });

  it("编辑模式：[取消][保存] 并列右下角（justify-end，Issue #182）", async () => {
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

    fireEvent.click(screen.getByText(/欢迎来到新学期/));
    fireEvent.click(screen.getByRole("button", { name: /修改公告/ }));
    await screen.findByPlaceholderText(/输入公告内容/);

    // 取消在前、保存在后，同一行右对齐（右下角）
    const cancelBtn = screen.getByRole("button", { name: "取消" });
    const saveBtn = screen.getByRole("button", { name: "保存" });
    expect(saveBtn.parentElement).toBe(cancelBtn.parentElement);
    expect(cancelBtn.parentElement!.className).toContain("justify-end");
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

    // 进入 ann-1 详情后点「删除公告」展开确认块
    fireEvent.click(screen.getByText(/欢迎来到新学期/));
    fireEvent.click(screen.getByRole("button", { name: /删除公告/ }));

    await waitFor(() => {
      expect(screen.getByText(/确认删除这条公告/)).toBeInTheDocument();
    });

    // 确认删除
    fireEvent.click(screen.getByRole("button", { name: /确认删除/ }));

    await waitFor(() => {
      expect(onDeleteMock).toHaveBeenCalledWith("ann-1");
    });

    // 删除成功（resolve true）后：确认块消失
    await waitFor(() => {
      expect(screen.queryByText(/确认删除这条公告/)).toBeNull();
    });

    // UI 回到列表视图：详情视图不渲染（无"发布时间"），列表项可见
    expect(screen.queryByText(/发布时间/)).toBeNull();
    expect(screen.getByText(/欢迎来到新学期/)).toBeInTheDocument();
    expect(screen.getByText(/本周六举行音乐会/)).toBeInTheDocument();
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

    // 进入 ann-1 详情后点「删除公告」展开确认块
    fireEvent.click(screen.getByText(/欢迎来到新学期/));
    fireEvent.click(screen.getByRole("button", { name: /删除公告/ }));

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

  it("编辑模式下公告 textarea 无 resize-none（可拖拽拉长，审计清理）", async () => {
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

    // 进入详情后点「修改公告」进入编辑模式
    fireEvent.click(screen.getByText(/欢迎来到新学期/));
    fireEvent.click(screen.getByRole("button", { name: /修改公告/ }));

    const ta = (await screen.findByPlaceholderText(/输入公告内容/)) as HTMLTextAreaElement;
    expect(ta).toBeTruthy();
    expect(ta.className).not.toContain("resize-none");
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
