// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import ResetPasswordResetPage from "./page";
import { supabase } from "@/lib/supabase";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      verifyOtp: vi.fn().mockResolvedValue({ error: null }),
      updateUser: vi.fn().mockResolvedValue({ error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn().mockReturnValue({
    replace: vi.fn(),
  }),
  useSearchParams: vi.fn().mockReturnValue({
    get: vi.fn((key: string) => {
      if (key === "token") return "valid-token";
      if (key === "type") return "recovery";
      return null;
    }),
  }),
}));

const mockLocalStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
};
Object.defineProperty(window, "localStorage", {
  value: mockLocalStorage,
});

describe("ResetPasswordResetPage", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mockLocalStorage.getItem.mockReturnValue(null);
    // 重新设置 supabase auth mock
    (supabase.auth.verifyOtp as Mock).mockResolvedValue({ error: null });
    (supabase.auth.updateUser as Mock).mockResolvedValue({ error: null });
    (supabase.auth.signOut as Mock).mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.clearAllMocks();
  });

  it("token 验证成功后显示密码输入表单", async () => {
    render(<ResetPasswordResetPage />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("至少 6 位")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("再次输入密码")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "设置新密码" })).toBeInTheDocument();
    });

    expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({
      token_hash: "valid-token",
      type: "recovery",
    });
  });

  it("token 验证失败显示错误消息", async () => {
    (supabase.auth.verifyOtp as Mock).mockResolvedValue({
      error: { message: "Token invalid" },
    });

    render(<ResetPasswordResetPage />);

    await waitFor(() => {
      expect(screen.getByText("重置链接无效或已过期，请重新请求密码重置。")).toBeInTheDocument();
    });
  });

  it("密码长度验证 - 少于6位", async () => {
    render(<ResetPasswordResetPage />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("至少 6 位")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("至少 6 位"), {
      target: { value: "123" },
    });
    fireEvent.change(screen.getByPlaceholderText("再次输入密码"), {
      target: { value: "123" },
    });

    const buttons = screen.getAllByRole("button");
    const submitButton = buttons.find((b) => b.textContent === "设置新密码");
    fireEvent.click(submitButton!);

    await waitFor(() => {
      expect(screen.getByText("密码长度至少为 6 位，请重新设置。")).toBeInTheDocument();
    });

    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it("两次密码不一致验证", async () => {
    render(<ResetPasswordResetPage />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("至少 6 位")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("至少 6 位"), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText("再次输入密码"), {
      target: { value: "password456" },
    });

    const buttons = screen.getAllByRole("button");
    const submitButton = buttons.find((b) => b.textContent === "设置新密码");
    fireEvent.click(submitButton!);

    await waitFor(() => {
      expect(screen.getByText("两次输入的密码不一致，请重新输入。")).toBeInTheDocument();
    });

    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it("密码为空验证", async () => {
    render(<ResetPasswordResetPage />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("至少 6 位")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("至少 6 位"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByPlaceholderText("再次输入密码"), {
      target: { value: "" },
    });

    const buttons = screen.getAllByRole("button");
    const submitButton = buttons.find((b) => b.textContent === "设置新密码");
    fireEvent.click(submitButton!);

    await waitFor(() => {
      expect(screen.getByText("请输入新密码。")).toBeInTheDocument();
    });

    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it("暴力破解防护 - 60秒内重复提交", async () => {
    const tenSecondsAgo = Date.now() - 10000;
    mockLocalStorage.getItem.mockReturnValue(String(tenSecondsAgo));

    render(<ResetPasswordResetPage />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("至少 6 位")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("至少 6 位"), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText("再次输入密码"), {
      target: { value: "password123" },
    });

    const buttons = screen.getAllByRole("button");
    const submitButton = buttons.find((b) => b.textContent === "设置新密码");
    fireEvent.click(submitButton!);

    await waitFor(() => {
      expect(screen.getByText("操作过于频繁，请等待 60 秒后再试。")).toBeInTheDocument();
    });

    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it("暴力破解防护 - 超过60秒可再次提交", async () => {
    const seventySecondsAgo = Date.now() - 70000;
    mockLocalStorage.getItem.mockReturnValue(String(seventySecondsAgo));

    render(<ResetPasswordResetPage />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("至少 6 位")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("至少 6 位"), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText("再次输入密码"), {
      target: { value: "password123" },
    });

    const buttons = screen.getAllByRole("button");
    const submitButton = buttons.find((b) => b.textContent === "设置新密码");
    fireEvent.click(submitButton!);

    await waitFor(() => {
      expect(supabase.auth.updateUser).toHaveBeenCalledWith({
        password: "password123",
      });
    });

    expect(mockLocalStorage.setItem).toHaveBeenCalled();
  });

  it("密码更新成功后显示成功消息并登出", async () => {
    vi.useFakeTimers();

    render(<ResetPasswordResetPage />);

    // 推进时间让 useEffect 中的 verifyOtp 完成
    await vi.runAllTimersAsync();

    expect(screen.getByPlaceholderText("至少 6 位")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("至少 6 位"), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText("再次输入密码"), {
      target: { value: "password123" },
    });

    const buttons = screen.getAllByRole("button");
    const submitButton = buttons.find((b) => b.textContent === "设置新密码");
    fireEvent.click(submitButton!);

    // 推进时间让 updateUser 和后续逻辑完成
    await vi.runAllTimersAsync();

    expect(screen.getByText("密码重置成功，请使用新密码登录。")).toBeInTheDocument();

    // signOut 在 setTimeout 回调中，需要触发定时器
    await vi.runAllTimersAsync();

    expect(supabase.auth.signOut).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("密码更新失败显示错误消息", async () => {
    (supabase.auth.updateUser as Mock).mockResolvedValue({
      error: { message: "更新失败" },
    });

    render(<ResetPasswordResetPage />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("至少 6 位")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("至少 6 位"), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText("再次输入密码"), {
      target: { value: "password123" },
    });

    const buttons = screen.getAllByRole("button");
    const submitButton = buttons.find((b) => b.textContent === "设置新密码");
    fireEvent.click(submitButton!);

    await waitFor(() => {
      expect(screen.getByText("更新失败")).toBeInTheDocument();
    });

    expect(supabase.auth.signOut).not.toHaveBeenCalled();
  });

  it("提交时禁用按钮", async () => {
    let resolveFn: () => void;
    (supabase.auth.updateUser as Mock).mockImplementation(() => {
      return new Promise((resolve) => {
        resolveFn = () => resolve({ error: null });
      });
    });

    render(<ResetPasswordResetPage />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("至少 6 位")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("至少 6 位"), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText("再次输入密码"), {
      target: { value: "password123" },
    });

    const buttons = screen.getAllByRole("button");
    const submitButton = buttons.find((b) => b.textContent === "设置新密码");
    fireEvent.click(submitButton!);

    await waitFor(() => {
      const disabledButton = screen.getByRole("button", { name: "设置中…" });
      expect(disabledButton).toBeDisabled();
    });

    resolveFn!();

    await waitFor(() => {
      const enabledButton = screen.getByRole("button", { name: "设置新密码" });
      expect(enabledButton).not.toBeDisabled();
    });
  });
});
