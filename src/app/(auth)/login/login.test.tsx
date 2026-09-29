// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import LoginPage from "./page";
import { supabase } from "@/lib/supabase";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
      signOut: vi.fn().mockResolvedValue({}),
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "test-user-id" } }, error: null }),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
    })),
  },
}));

const { mockReplace } = vi.hoisted(() => ({ mockReplace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
}));

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("显示邮箱和密码输入框", () => {
    render(<LoginPage />);
    expect(screen.getByPlaceholderText("name@example.com")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("请输入密码")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
  });

  it("表单验证 - 邮箱为空", async () => {
    const { container } = render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText("请输入密码"), {
      target: { value: "password123" },
    });
    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText("请输入邮箱和密码。")).toBeInTheDocument();
    });
  });

  it("表单验证 - 密码为空", async () => {
    const { container } = render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText("name@example.com"), {
      target: { value: "test@example.com" },
    });
    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText("请输入邮箱和密码。")).toBeInTheDocument();
    });
  });

  it("登录成功调用 signInWithPassword", async () => {
    const { container } = render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText("name@example.com"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("请输入密码"), {
      target: { value: "password123" },
    });
    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
        email: "test@example.com",
        password: "password123",
      });
    });
  });

  it("登录失败显示错误消息", async () => {
    (supabase.auth.signInWithPassword as Mock).mockResolvedValue({
      error: { message: "Invalid credentials" },
    });

    const { container } = render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText("name@example.com"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("请输入密码"), {
      target: { value: "wrongpassword" },
    });
    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText("Invalid credentials")).toBeInTheDocument();
    });
  });

  it("登录时禁用按钮", async () => {
    let resolveFn: () => void;
    (supabase.auth.signInWithPassword as Mock).mockImplementation(() => {
      return new Promise((resolve) => {
        resolveFn = () => resolve({ error: null });
      });
    });

    const { container } = render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText("name@example.com"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("请输入密码"), {
      target: { value: "password123" },
    });
    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    const buttons = screen.getAllByRole("button", { name: /登录/ });
    expect(buttons[0]).toBeDisabled();
    expect(buttons[0]).toHaveTextContent("登录中…");

    resolveFn!();
    await waitFor(() => {
      const updatedButtons = screen.getAllByRole("button", { name: /登录/ });
      expect(updatedButtons[0]).not.toBeDisabled();
    });
  });

  it("成员（非管理员）登录被拦截", async () => {
    (supabase.auth.signInWithPassword as Mock).mockResolvedValue({ error: null });
    (supabase.from as Mock).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { role: "member" }, error: null }),
    });

    const { container } = render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText("name@example.com"), {
      target: { value: "member@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("请输入密码"), {
      target: { value: "password123" },
    });
    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(
        screen.getByText("成员请使用微信小程序登录（网页端仅限管理员与谱务账号）"),
      ).toBeInTheDocument();
    });
    expect(supabase.auth.signOut).toHaveBeenCalled();
  });

  it("profile 查询出错时同样拦截并登出", async () => {
    (supabase.auth.signInWithPassword as Mock).mockResolvedValue({ error: null });
    (supabase.from as Mock).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }),
    });

    const { container } = render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText("name@example.com"), {
      target: { value: "member@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("请输入密码"), {
      target: { value: "password123" },
    });
    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(
        screen.getByText("成员请使用微信小程序登录（网页端仅限管理员与谱务账号）"),
      ).toBeInTheDocument();
    });
    expect(supabase.auth.signOut).toHaveBeenCalled();
  });

  // ==========================================
  // score_manager 放行 + 落点分角色（Issue #340）
  // ==========================================
  describe("角色闸门与落点", () => {
    /** 登录成功 + 指定角色，返回提交后的断言入口 */
    async function submitWithRole(role: string | null) {
      (supabase.auth.signInWithPassword as Mock).mockResolvedValue({ error: null });
      (supabase.from as Mock).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: role === null ? null : { role }, error: null }),
      });

      const { container } = render(<LoginPage />);
      fireEvent.change(screen.getByPlaceholderText("name@example.com"), {
        target: { value: `${role ?? "none"}@example.com` },
      });
      fireEvent.change(screen.getByPlaceholderText("请输入密码"), {
        target: { value: "password123" },
      });
      fireEvent.submit(container.querySelector("form")!);
    }

    it("admin 登录落到 /admin", async () => {
      await submitWithRole("admin");
      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith("/admin");
      });
      expect(supabase.auth.signOut).not.toHaveBeenCalled();
    });

    it("score_manager 登录放行，落到谱务列表", async () => {
      await submitWithRole("score_manager");
      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith("/admin/sheet-music");
      });
      expect(supabase.auth.signOut).not.toHaveBeenCalled();
    });

    it("未知角色（未在枚举内）仍被拦截", async () => {
      await submitWithRole("superadmin");
      await waitFor(() => {
        expect(
          screen.getByText("成员请使用微信小程序登录（网页端仅限管理员与谱务账号）"),
        ).toBeInTheDocument();
      });
      expect(supabase.auth.signOut).toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });
});
