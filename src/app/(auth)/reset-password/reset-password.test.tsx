// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import ResetPasswordPage from "./page";
import { supabase } from "@/lib/supabase";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}));

// Mock localStorage
const mockLocalStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
};
Object.defineProperty(window, "localStorage", {
  value: mockLocalStorage,
});

// Mock window.location.origin
Object.defineProperty(window, "location", {
  value: { origin: "http://localhost:3000" },
});

describe("ResetPasswordPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocalStorage.getItem.mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
  });

  it("显示邮箱输入框和发送按钮", () => {
    render(<ResetPasswordPage />);
    expect(screen.getByPlaceholderText("name@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送重置链接" })).toBeInTheDocument();
  });

  it("邮箱格式验证 - 无效邮箱", async () => {
    const { container } = render(<ResetPasswordPage />);
    fireEvent.change(screen.getByPlaceholderText("name@example.com"), {
      target: { value: "invalid-email" },
    });
    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText("请输入有效的邮箱地址。")).toBeInTheDocument();
    });
  });

  it("邮箱格式验证 - 空邮箱", async () => {
    const { container } = render(<ResetPasswordPage />);
    fireEvent.change(screen.getByPlaceholderText("name@example.com"), {
      target: { value: "" },
    });
    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText("请输入邮箱地址。")).toBeInTheDocument();
    });
  });

  it("邮箱格式验证 - 有效邮箱直接调用重置密码接口", async () => {
    const { container } = render(<ResetPasswordPage />);
    fireEvent.change(screen.getByPlaceholderText("name@example.com"), {
      target: { value: "test@example.com" },
    });
    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      // 直接调用重置密码接口，不再调用邮箱检查 API
      expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith(
        "test@example.com",
        expect.any(Object),
      );
    });
  });

  it("暴力破解防护 - 60秒内重复请求", async () => {
    // 设置上次请求时间为 10 秒前
    const tenSecondsAgo = Date.now() - 10000;
    mockLocalStorage.getItem.mockReturnValue(String(tenSecondsAgo));

    const { container } = render(<ResetPasswordPage />);
    fireEvent.change(screen.getByPlaceholderText("name@example.com"), {
      target: { value: "test@example.com" },
    });
    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText(/请在.*秒后再次请求/)).toBeInTheDocument();
      expect(supabase.auth.resetPasswordForEmail).not.toHaveBeenCalled();
    });
  });

  it("暴力破解防护 - 超过60秒可再次请求", async () => {
    // 设置上次请求时间为 70 秒前
    const seventySecondsAgo = Date.now() - 70000;
    mockLocalStorage.getItem.mockReturnValue(String(seventySecondsAgo));

    const { container } = render(<ResetPasswordPage />);
    fireEvent.change(screen.getByPlaceholderText("name@example.com"), {
      target: { value: "test@example.com" },
    });
    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalled();
    });
  });

  it("发送成功显示统一提示消息（防邮箱枚举）", async () => {
    const { container } = render(<ResetPasswordPage />);
    fireEvent.change(screen.getByPlaceholderText("name@example.com"), {
      target: { value: "test@example.com" },
    });
    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      // 无论邮箱是否注册，都显示统一的提示消息
      expect(screen.getByText("我们已发送重置链接到您的邮箱。")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("name@example.com")).toHaveValue("");
    });
  });

  it("发送失败也显示统一提示消息（防邮箱枚举）", async () => {
    (supabase.auth.resetPasswordForEmail as Mock).mockResolvedValue({
      error: { message: "发送失败" },
    });

    const { container } = render(<ResetPasswordPage />);
    fireEvent.change(screen.getByPlaceholderText("name@example.com"), {
      target: { value: "test@example.com" },
    });
    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      // 即使失败也显示统一的提示消息，不暴露邮箱是否注册
      expect(screen.getByText("我们已发送重置链接到您的邮箱。")).toBeInTheDocument();
    });
  });

  it("请求时禁用按钮", async () => {
    let resolveFn: () => void;
    (supabase.auth.resetPasswordForEmail as Mock).mockImplementation(() => {
      return new Promise((resolve) => {
        resolveFn = () => resolve({ error: null });
      });
    });

    const { container } = render(<ResetPasswordPage />);
    fireEvent.change(screen.getByPlaceholderText("name@example.com"), {
      target: { value: "test@example.com" },
    });
    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    // 等待按钮文本变为"发送中…"并禁用
    await waitFor(() => {
      const buttons = screen.getAllByRole("button");
      const submitButton = buttons.find((b) => b.textContent === "发送中…");
      expect(submitButton).toBeDisabled();
    });

    resolveFn!();
    await waitFor(() => {
      const updatedButtons = screen.getAllByRole("button");
      const updatedSubmitButton = updatedButtons.find((b) => b.textContent === "发送重置链接");
      expect(updatedSubmitButton).not.toBeDisabled();
    });
  });
});
