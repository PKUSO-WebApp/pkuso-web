/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AdminMemberDetailModal } from "./member-detail-modal";
import { Modal } from "@/components/ui/Modal";
import type { ProfileRow } from "@/types/database";
import type { ProfileUpdatePayload } from "@/hooks/useProfiles";

const mockModal = vi.mocked(Modal);

// Mock Modal 组件：聚焦表单内容渲染，同时暴露 closeOnOverlay 与标题栏关闭按钮
vi.mock("@/components/ui/Modal", () => ({
  Modal: vi.fn(
    ({
      open,
      title,
      children,
      onClose,
      closeOnOverlay,
    }: {
      open: boolean;
      title?: string;
      children?: React.ReactNode;
      onClose?: () => void;
      closeOnOverlay?: boolean;
    }) => {
      if (!open) return null;
      return (
        <div data-testid={`modal-${title}`}>
          {title && <h2>{title}</h2>}
          {title && (
            <button type="button" onClick={onClose}>
              关闭
            </button>
          )}
          <div
            data-testid={`modal-overlay-${title}`}
            data-close-on-overlay={String(closeOnOverlay)}
          />
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

function renderModal(props?: {
  user?: ProfileRow | null;
  onSave?: (id: string, payload: ProfileUpdatePayload) => Promise<boolean>;
}) {
  const onSave = props?.onSave ?? vi.fn().mockResolvedValue(true);
  const onClose = vi.fn();
  render(
    <AdminMemberDetailModal
      open
      user={props?.user === undefined ? baseUser : (props.user ?? null)}
      onClose={onClose}
      onSave={onSave}
    />,
  );
  return { onSave, onClose };
}

describe("AdminMemberDetailModal（admin 可编辑详情）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("表单用成员数据预填全部字段", () => {
    renderModal();
    expect((screen.getByPlaceholderText("姓名") as HTMLInputElement).value).toBe("张三");
    expect((screen.getByPlaceholderText("学院") as HTMLInputElement).value).toBe(
      "信息科学技术学院",
    );
    expect((screen.getByPlaceholderText("邮箱") as HTMLInputElement).value).toBe(
      "zhangsan@example.com",
    );
    expect((screen.getByPlaceholderText("11 位手机号") as HTMLInputElement).value).toBe(
      "13800138000",
    );
    expect((screen.getByPlaceholderText("如：2024-09-01") as HTMLInputElement).value).toBe(
      "2024-09-01",
    );
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("第一小提琴");
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  });

  it("声部长成员勾选声部长 checkbox", () => {
    renderModal({ user: { ...baseUser, is_section_leader: true } });
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("🏅 声部长")).toBeInTheDocument();
  });

  it("手机号格式错误时提示错误且不保存", async () => {
    const { onSave } = renderModal();
    const phoneInput = screen.getByPlaceholderText("11 位手机号") as HTMLInputElement;
    fireEvent.change(phoneInput, { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(screen.getByText(/手机号格式不正确/)).toBeInTheDocument();
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("带横杠的手机号视为不合法", async () => {
    const { onSave } = renderModal();
    const phoneInput = screen.getByPlaceholderText("11 位手机号") as HTMLInputElement;
    fireEvent.change(phoneInput, { target: { value: "138-0013-8000" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(screen.getByText(/手机号格式不正确/)).toBeInTheDocument();
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("姓名清空时提示错误且不保存", async () => {
    const { onSave } = renderModal();
    const nameInput = screen.getByPlaceholderText("姓名") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(screen.getByText("姓名不能为空")).toBeInTheDocument();
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("保存成功时调用 onSave 并传入正确 payload，随后关闭", async () => {
    const { onSave, onClose } = renderModal();
    const phoneInput = screen.getByPlaceholderText("11 位手机号") as HTMLInputElement;
    fireEvent.change(phoneInput, { target: { value: "18812345678" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith("user-1", {
        full_name: "张三",
        instrument: "第一小提琴",
        college: "信息科学技术学院",
        email: "zhangsan@example.com",
        phone_number: "18812345678",
        join_date: "2024-09-01",
        is_section_leader: true,
      });
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("保存失败时提示错误且不关闭", async () => {
    const onSave = vi.fn().mockResolvedValue(false);
    const { onClose } = renderModal({ onSave });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(screen.getByText("保存失败，请重试")).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  it("提交中禁用保存按钮（防重复提交）", async () => {
    let resolveSave!: (v: boolean) => void;
    const savePromise = new Promise<boolean>((resolve) => {
      resolveSave = resolve;
    });
    const onSave = vi.fn().mockReturnValue(savePromise);
    renderModal({ onSave });

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      const submittingBtn = screen.getByRole("button", { name: "保存中…" });
      expect(submittingBtn).toBeDisabled();
    });

    resolveSave(true);
  });

  it("user 为 null 时不渲染表单", () => {
    renderModal({ user: null });
    expect(screen.queryByPlaceholderText("姓名")).toBeNull();
  });

  it("切换成员（key=user.id 重置）时表单重新预填新成员数据，不残留旧值", () => {
    const otherUser: ProfileRow = {
      ...baseUser,
      id: "user-2",
      full_name: "李四",
      college: "外国语学院",
      phone_number: "18812345678",
      is_section_leader: true,
    };
    const { rerender } = render(
      <AdminMemberDetailModal
        open
        user={baseUser}
        onClose={() => {}}
        onSave={vi.fn().mockResolvedValue(true)}
      />,
    );
    // 先编辑旧成员，制造脏状态
    const nameInput = screen.getByPlaceholderText("姓名") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "脏数据" } });

    rerender(
      <AdminMemberDetailModal
        open
        user={otherUser}
        onClose={() => {}}
        onSave={vi.fn().mockResolvedValue(true)}
      />,
    );

    // key 重置后重新挂载：取新成员初始值，不残留旧成员编辑内容
    expect((screen.getByPlaceholderText("姓名") as HTMLInputElement).value).toBe("李四");
    expect((screen.getByPlaceholderText("学院") as HTMLInputElement).value).toBe("外国语学院");
    expect((screen.getByPlaceholderText("11 位手机号") as HTMLInputElement).value).toBe(
      "18812345678",
    );
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  });

  it("提交中禁止关闭：closeOnOverlay=false 且标题栏关闭按钮不触发 onClose", async () => {
    let resolveSave!: (v: boolean) => void;
    const savePromise = new Promise<boolean>((resolve) => {
      resolveSave = resolve;
    });
    const onSave = vi.fn().mockReturnValue(savePromise);
    const { onClose } = renderModal({ onSave });

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    // 提交中：Modal 收到 closeOnOverlay=false
    await waitFor(() => {
      expect(mockModal).toHaveBeenLastCalledWith(
        expect.objectContaining({ closeOnOverlay: false }),
        undefined,
      );
    });

    // 提交中点击标题栏"关闭"按钮：守卫拦截，不触发 onClose
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).not.toHaveBeenCalled();

    // 保存成功后才正常关闭
    resolveSave(true);
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });
});
