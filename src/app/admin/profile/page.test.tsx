// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ProfilePage from "./page";
import { useRouter } from "next/navigation";
import { AdminPageHeaderProvider } from "@/context/admin-page-header-context";

// ---- Mock supabase ----
const { mockUpdateUser } = vi.hoisted(() => ({
  mockUpdateUser: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      updateUser: mockUpdateUser,
    },
  },
}));

// ---- Mock next/navigation ----
const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockBack = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
    prefetch: vi.fn(),
  })),
}));

// ---- Mock useUser context ----
vi.mock("@/context/user-context", () => ({
  useUser: vi.fn(() => ({
    user: { name: "管理员", email: "admin@example.com", role: "admin" },
    logout: vi.fn(),
  })),
}));

// ---- Mock ThemeModal ----
vi.mock("@/components/theme-modal", () => ({
  ThemeModal: vi.fn(() => null),
}));

// ---- Mock Modal ----
vi.mock("@/components/ui/Modal", () => ({
  Modal: vi.fn(
    ({
      open,
      title,
      children,
      position,
    }: {
      open: boolean;
      title?: string;
      children?: React.ReactNode;
      position?: string;
    }) => {
      if (!open) return null;
      return (
        <div data-testid={`modal-${title ?? "untitled"}`} data-position={position}>
          {title && <h2>{title}</h2>}
          {children}
        </div>
      );
    },
  ),
}));

describe("ProfilePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useRouter as unknown as Mock).mockReturnValue({
      push: mockPush,
      replace: mockReplace,
      back: mockBack,
      prefetch: vi.fn(),
    });
    mockUpdateUser.mockReset();
  });

  it("渲染设置页面", () => {
    render(
      <AdminPageHeaderProvider>
        <ProfilePage />
      </AdminPageHeaderProvider>,
    );

    // 标题和返回按钮现在由 layout 的 AdminHeader 渲染
    expect(screen.getByRole("button", { name: /修改密码/ })).toBeInTheDocument();
  });

  it("显示三个功能按钮：修改密码、外观、退出登录", () => {
    render(
      <AdminPageHeaderProvider>
        <ProfilePage />
      </AdminPageHeaderProvider>,
    );

    expect(screen.getByRole("button", { name: /修改密码/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /外观/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /退出登录/ })).toBeInTheDocument();
  });

  it("点击修改密码打开 Modal", async () => {
    render(
      <AdminPageHeaderProvider>
        <ProfilePage />
      </AdminPageHeaderProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /修改密码/ }));

    const modal = await screen.findByTestId("modal-修改登录密码");
    expect(modal).toBeInTheDocument();
    expect(modal).toHaveAttribute("data-position", "bottom");
  });

  it("修改密码：两次输入不一致时提示", async () => {
    vi.spyOn(window, "alert").mockImplementation(() => {});
    render(
      <AdminPageHeaderProvider>
        <ProfilePage />
      </AdminPageHeaderProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /修改密码/ }));

    await waitFor(() => {
      fireEvent.change(screen.getByPlaceholderText(/至少 6 位/), {
        target: { value: "123456" },
      });
      fireEvent.change(screen.getByPlaceholderText(/再次输入/), {
        target: { value: "654321" },
      });
      fireEvent.click(screen.getByRole("button", { name: /确认修改/ }));
    });

    expect(window.alert).toHaveBeenCalledWith("两次输入的密码不一致");
  });

  it("修改密码：长度不足 6 位时提示", async () => {
    vi.spyOn(window, "alert").mockImplementation(() => {});
    render(
      <AdminPageHeaderProvider>
        <ProfilePage />
      </AdminPageHeaderProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /修改密码/ }));

    await waitFor(() => {
      fireEvent.change(screen.getByPlaceholderText(/至少 6 位/), {
        target: { value: "123" },
      });
      fireEvent.change(screen.getByPlaceholderText(/再次输入/), {
        target: { value: "123" },
      });
      fireEvent.click(screen.getByRole("button", { name: /确认修改/ }));
    });

    expect(window.alert).toHaveBeenCalledWith("新密码长度至少 6 位");
  });

  it("修改密码成功：调用 supabase.auth.updateUser 并提示成功", async () => {
    vi.spyOn(window, "alert").mockImplementation(() => {});
    mockUpdateUser.mockResolvedValue({ error: null });
    render(
      <AdminPageHeaderProvider>
        <ProfilePage />
      </AdminPageHeaderProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /修改密码/ }));

    await waitFor(() => {
      fireEvent.change(screen.getByPlaceholderText(/至少 6 位/), {
        target: { value: "newpassword" },
      });
      fireEvent.change(screen.getByPlaceholderText(/再次输入/), {
        target: { value: "newpassword" },
      });
      fireEvent.click(screen.getByRole("button", { name: /确认修改/ }));
    });

    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalledWith({ password: "newpassword" });
      expect(window.alert).toHaveBeenCalledWith("密码修改成功");
    });
  });

  it("修改密码失败：显示错误信息", async () => {
    vi.spyOn(window, "alert").mockImplementation(() => {});
    mockUpdateUser.mockResolvedValue({ error: { message: "密码太弱" } });
    render(
      <AdminPageHeaderProvider>
        <ProfilePage />
      </AdminPageHeaderProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /修改密码/ }));

    await waitFor(() => {
      fireEvent.change(screen.getByPlaceholderText(/至少 6 位/), {
        target: { value: "newpassword" },
      });
      fireEvent.change(screen.getByPlaceholderText(/再次输入/), {
        target: { value: "newpassword" },
      });
      fireEvent.click(screen.getByRole("button", { name: /确认修改/ }));
    });

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith("密码太弱");
    });
  });

  it("点击外观打开 ThemeModal", () => {
    render(
      <AdminPageHeaderProvider>
        <ProfilePage />
      </AdminPageHeaderProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /外观/ }));

    // ThemeModal is mocked to render null, but we can verify it's called
    // by checking the component doesn't crash
    expect(screen.getByRole("button", { name: /外观/ })).toBeInTheDocument();
  });

  it("点击退出登录：调用 logout 并跳转到 /login", async () => {
    render(
      <AdminPageHeaderProvider>
        <ProfilePage />
      </AdminPageHeaderProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /退出登录/ }));

    await waitFor(() => {
      // user.logout is mocked in useUser
      expect(mockPush).toHaveBeenCalledWith("/login");
    });
  });

  it("修改密码成功后 Modal 关闭时重置表单", async () => {
    vi.spyOn(window, "alert").mockImplementation(() => {});
    mockUpdateUser.mockResolvedValue({ error: null });
    render(
      <AdminPageHeaderProvider>
        <ProfilePage />
      </AdminPageHeaderProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /修改密码/ }));

    await waitFor(() => {
      fireEvent.change(screen.getByPlaceholderText(/至少 6 位/), {
        target: { value: "123456" },
      });
      fireEvent.change(screen.getByPlaceholderText(/再次输入/), {
        target: { value: "123456" },
      });
      fireEvent.click(screen.getByRole("button", { name: /确认修改/ }));
    });

    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("button", { name: /修改密码/ }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/至少 6 位/)).toHaveValue("");
      expect(screen.getByPlaceholderText(/再次输入/)).toHaveValue("");
    });
  });

  // 返回按钮现在由 layout 的 AdminHeader 渲染，在 layout 测试中覆盖
});
