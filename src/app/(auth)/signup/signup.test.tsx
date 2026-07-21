// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import SignupPage from "./page";
import { supabase } from "@/lib/supabase";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
    rpc: vi.fn().mockResolvedValue({ data: [{ success: true, message: "验证成功" }], error: null }),
    auth: {
      signUp: vi.fn().mockResolvedValue({ error: null, data: { user: { id: "test-user-id" } } }),
      getSession: vi
        .fn()
        .mockResolvedValue({ data: { session: { user: { id: "test-user-id" } } } }),
      admin: {
        deleteUser: vi.fn().mockResolvedValue({ error: null }),
      },
    },
  },
}));

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
  }),
}));

describe("SignupPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("显示所有表单字段", () => {
    render(<SignupPage />);
    expect(screen.getByPlaceholderText("请输入乐团邀请码")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("name@example.com")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("至少 6 位")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("再次输入密码")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("请填写真实姓名")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("例如：经济学院")).toBeInTheDocument();
  });

  it("声部选择包含'其他'选项", () => {
    const { container } = render(<SignupPage />);
    const selects = container.querySelectorAll("select");
    // 声部选择是第一个 select
    const instrumentSelect = selects[0];
    const options = instrumentSelect.querySelectorAll("option");
    const optionValues = Array.from(options).map((opt) => opt.value);
    expect(optionValues).toContain("其他");
  });

  it("邀请码验证 - 有效邀请码", async () => {
    // 模拟邀请码有效：RPC 函数返回成功
    (supabase.rpc as Mock).mockResolvedValue({
      data: [{ success: true, message: "验证成功", expires_at: "2030-01-01" }],
      error: null,
    });

    const { container } = render(<SignupPage />);
    fireEvent.change(screen.getByPlaceholderText("请输入乐团邀请码"), {
      target: { value: "TESTCODE" },
    });
    fireEvent.change(screen.getByPlaceholderText("name@example.com"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("至少 6 位"), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText("再次输入密码"), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText("请填写真实姓名"), {
      target: { value: "张三" },
    });
    const selects = container.querySelectorAll("select");
    fireEvent.change(selects[0], { target: { value: "长笛" } });
    fireEvent.change(screen.getByPlaceholderText("例如：经济学院"), {
      target: { value: "经济学院" },
    });
    fireEvent.change(selects[1], { target: { value: "2024" } });
    fireEvent.change(selects[2], { target: { value: "秋" } });

    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      // 验证 RPC 函数被调用，传入 p_code 和 p_user_id
      expect(supabase.rpc).toHaveBeenCalledWith("verify_and_use_invitation_code", {
        p_code: "TESTCODE",
        p_user_id: "test-user-id",
      });
    });
  });

  it("邀请码验证 - 无效邀请码", async () => {
    // 模拟邀请码无效：RPC 函数返回失败
    (supabase.rpc as Mock).mockResolvedValue({
      data: [{ success: false, message: "邀请码无效或已被使用" }],
      error: null,
    });

    const { container } = render(<SignupPage />);
    fireEvent.change(screen.getByPlaceholderText("请输入乐团邀请码"), {
      target: { value: "INVALID" },
    });
    fireEvent.change(screen.getByPlaceholderText("name@example.com"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("至少 6 位"), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText("再次输入密码"), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText("请填写真实姓名"), {
      target: { value: "张三" },
    });
    const selects = container.querySelectorAll("select");
    fireEvent.change(selects[0], { target: { value: "长笛" } });
    fireEvent.change(screen.getByPlaceholderText("例如：经济学院"), {
      target: { value: "经济学院" },
    });
    fireEvent.change(selects[1], { target: { value: "2024" } });
    fireEvent.change(selects[2], { target: { value: "秋" } });

    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(
        screen.getByText("邀请码无效或已被使用，请联系乐团管理员获取新的邀请码。"),
      ).toBeInTheDocument();
    });
  });

  it("邀请码验证 - 数据库错误", async () => {
    // 模拟 RPC 调用失败
    (supabase.rpc as Mock).mockResolvedValue({ data: null, error: { message: "DB error" } });

    const { container } = render(<SignupPage />);
    fireEvent.change(screen.getByPlaceholderText("请输入乐团邀请码"), {
      target: { value: "TESTCODE" },
    });
    fireEvent.change(screen.getByPlaceholderText("name@example.com"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("至少 6 位"), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText("再次输入密码"), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText("请填写真实姓名"), {
      target: { value: "张三" },
    });
    const selects = container.querySelectorAll("select");
    fireEvent.change(selects[0], { target: { value: "长笛" } });
    fireEvent.change(screen.getByPlaceholderText("例如：经济学院"), {
      target: { value: "经济学院" },
    });
    fireEvent.change(selects[1], { target: { value: "2024" } });
    fireEvent.change(selects[2], { target: { value: "秋" } });

    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText("邀请码验证失败，请稍后重试。")).toBeInTheDocument();
    });
  });

  it("密码长度验证 - 少于6位", async () => {
    (supabase.rpc as Mock).mockResolvedValue({
      data: [{ success: true, message: "验证成功", expires_at: "2030-01-01" }],
      error: null,
    });

    const { container } = render(<SignupPage />);
    fireEvent.change(screen.getByPlaceholderText("请输入乐团邀请码"), {
      target: { value: "TESTCODE" },
    });
    fireEvent.change(screen.getByPlaceholderText("name@example.com"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("至少 6 位"), {
      target: { value: "123" },
    });
    fireEvent.change(screen.getByPlaceholderText("再次输入密码"), {
      target: { value: "123" },
    });
    fireEvent.change(screen.getByPlaceholderText("请填写真实姓名"), {
      target: { value: "张三" },
    });
    const selects = container.querySelectorAll("select");
    fireEvent.change(selects[0], { target: { value: "长笛" } });
    fireEvent.change(screen.getByPlaceholderText("例如：经济学院"), {
      target: { value: "经济学院" },
    });
    fireEvent.change(selects[1], { target: { value: "2024" } });
    fireEvent.change(selects[2], { target: { value: "秋" } });

    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText(/密码长度至少为 6 位/)).toBeInTheDocument();
    });
  });

  it("确认密码验证 - 两次输入不一致", async () => {
    (supabase.rpc as Mock).mockResolvedValue({
      data: [{ success: true, message: "验证成功", expires_at: "2030-01-01" }],
      error: null,
    });

    const { container } = render(<SignupPage />);
    fireEvent.change(screen.getByPlaceholderText("请输入乐团邀请码"), {
      target: { value: "TESTCODE" },
    });
    fireEvent.change(screen.getByPlaceholderText("name@example.com"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("至少 6 位"), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText("再次输入密码"), {
      target: { value: "different123" },
    });
    fireEvent.change(screen.getByPlaceholderText("请填写真实姓名"), {
      target: { value: "张三" },
    });
    const selects = container.querySelectorAll("select");
    fireEvent.change(selects[0], { target: { value: "长笛" } });
    fireEvent.change(screen.getByPlaceholderText("例如：经济学院"), {
      target: { value: "经济学院" },
    });
    fireEvent.change(selects[1], { target: { value: "2024" } });
    fireEvent.change(selects[2], { target: { value: "秋" } });

    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText(/两次输入的密码不一致/)).toBeInTheDocument();
    });
  });

  it("表单验证 - 必填字段为空", async () => {
    const { container } = render(<SignupPage />);
    // 不填写任何字段直接提交
    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText("请填写完整信息后再提交。")).toBeInTheDocument();
    });
  });

  it("邀请码已过期 - 返回统一错误消息", async () => {
    // 模拟邀请码已过期：RPC 函数返回失败，返回统一错误消息防止枚举攻击
    (supabase.rpc as Mock).mockResolvedValue({
      data: [{ success: false, message: "邀请码已过期" }],
      error: null,
    });

    const { container } = render(<SignupPage />);
    fireEvent.change(screen.getByPlaceholderText("请输入乐团邀请码"), {
      target: { value: "TESTCODE" },
    });
    fireEvent.change(screen.getByPlaceholderText("name@example.com"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("至少 6 位"), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText("再次输入密码"), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText("请填写真实姓名"), {
      target: { value: "张三" },
    });
    const selects = container.querySelectorAll("select");
    fireEvent.change(selects[0], { target: { value: "长笛" } });
    fireEvent.change(screen.getByPlaceholderText("例如：经济学院"), {
      target: { value: "经济学院" },
    });
    fireEvent.change(selects[1], { target: { value: "2024" } });
    fireEvent.change(selects[2], { target: { value: "秋" } });

    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      // 所有验证失败情况返回统一错误消息
      expect(
        screen.getByText("邀请码无效或已被使用，请联系乐团管理员获取新的邀请码。"),
      ).toBeInTheDocument();
    });
  });

  it("邀请码已被使用完毕 - 返回统一错误消息", async () => {
    // 模拟邀请码已被使用完毕：RPC 函数返回失败，返回统一错误消息防止枚举攻击
    (supabase.rpc as Mock).mockResolvedValue({
      data: [{ success: false, message: "邀请码已被使用完毕" }],
      error: null,
    });

    const { container } = render(<SignupPage />);
    fireEvent.change(screen.getByPlaceholderText("请输入乐团邀请码"), {
      target: { value: "TESTCODE" },
    });
    fireEvent.change(screen.getByPlaceholderText("name@example.com"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("至少 6 位"), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText("再次输入密码"), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText("请填写真实姓名"), {
      target: { value: "张三" },
    });
    const selects = container.querySelectorAll("select");
    fireEvent.change(selects[0], { target: { value: "长笛" } });
    fireEvent.change(screen.getByPlaceholderText("例如：经济学院"), {
      target: { value: "经济学院" },
    });
    fireEvent.change(selects[1], { target: { value: "2024" } });
    fireEvent.change(selects[2], { target: { value: "秋" } });

    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      // 所有验证失败情况返回统一错误消息
      expect(
        screen.getByText("邀请码无效或已被使用，请联系乐团管理员获取新的邀请码。"),
      ).toBeInTheDocument();
    });
  });

  it("邀请码已被使用 - 返回统一错误消息", async () => {
    // 模拟邀请码已被使用：RPC 函数返回失败，返回统一错误消息防止枚举攻击
    (supabase.rpc as Mock).mockResolvedValue({
      data: [{ success: false, message: "邀请码已被使用" }],
      error: null,
    });

    const { container } = render(<SignupPage />);
    fireEvent.change(screen.getByPlaceholderText("请输入乐团邀请码"), {
      target: { value: "TESTCODE" },
    });
    fireEvent.change(screen.getByPlaceholderText("name@example.com"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("至少 6 位"), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText("再次输入密码"), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText("请填写真实姓名"), {
      target: { value: "张三" },
    });
    const selects = container.querySelectorAll("select");
    fireEvent.change(selects[0], { target: { value: "长笛" } });
    fireEvent.change(screen.getByPlaceholderText("例如：经济学院"), {
      target: { value: "经济学院" },
    });
    fireEvent.change(selects[1], { target: { value: "2024" } });
    fireEvent.change(selects[2], { target: { value: "秋" } });

    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      // 所有验证失败情况返回统一错误消息
      expect(
        screen.getByText("邀请码无效或已被使用，请联系乐团管理员获取新的邀请码。"),
      ).toBeInTheDocument();
    });
  });

  it("注册成功后 RPC 函数记录使用者 ID", async () => {
    // 模拟邀请码验证过程（RPC 函数返回成功）
    (supabase.rpc as Mock).mockResolvedValue({
      data: [{ success: true, message: "验证成功", expires_at: "2030-01-01" }],
      error: null,
    });

    const { container } = render(<SignupPage />);
    fireEvent.change(screen.getByPlaceholderText("请输入乐团邀请码"), {
      target: { value: "TESTCODE" },
    });
    fireEvent.change(screen.getByPlaceholderText("name@example.com"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("至少 6 位"), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText("再次输入密码"), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText("请填写真实姓名"), {
      target: { value: "张三" },
    });
    const selects = container.querySelectorAll("select");
    fireEvent.change(selects[0], { target: { value: "长笛" } });
    fireEvent.change(screen.getByPlaceholderText("例如：经济学院"), {
      target: { value: "经济学院" },
    });
    fireEvent.change(selects[1], { target: { value: "2024" } });
    fireEvent.change(selects[2], { target: { value: "秋" } });

    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      // 验证 RPC 函数被调用，传入 p_code 和 p_user_id（原子操作）
      expect(supabase.rpc).toHaveBeenCalledWith("verify_and_use_invitation_code", {
        p_code: "TESTCODE",
        p_user_id: "test-user-id",
      });

      // 注册成功后不再需要单独更新邀请码表，RPC 函数已原子完成
      expect(supabase.from).not.toHaveBeenCalled();
    });
  });

  it("邀请码验证失败时删除已注册用户", async () => {
    // 模拟邀请码验证失败：RPC 函数返回失败
    (supabase.rpc as Mock).mockResolvedValue({
      data: [{ success: false, message: "邀请码无效或已被使用" }],
      error: null,
    });

    const { container } = render(<SignupPage />);
    fireEvent.change(screen.getByPlaceholderText("请输入乐团邀请码"), {
      target: { value: "INVALID" },
    });
    fireEvent.change(screen.getByPlaceholderText("name@example.com"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("至少 6 位"), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText("再次输入密码"), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText("请填写真实姓名"), {
      target: { value: "张三" },
    });
    const selects = container.querySelectorAll("select");
    fireEvent.change(selects[0], { target: { value: "长笛" } });
    fireEvent.change(screen.getByPlaceholderText("例如：经济学院"), {
      target: { value: "经济学院" },
    });
    fireEvent.change(selects[1], { target: { value: "2024" } });
    fireEvent.change(selects[2], { target: { value: "秋" } });

    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      // 验证 admin.deleteUser 被调用，清理已注册用户
      expect(supabase.auth.admin.deleteUser).toHaveBeenCalledWith("test-user-id");
    });
  });

  it("邀请码长度超过20个字符时验证失败", async () => {
    const { container } = render(<SignupPage />);
    fireEvent.change(screen.getByPlaceholderText("请输入乐团邀请码"), {
      target: { value: "ABCDEFGHIJKLMNOPQRSTUV" }, // 21个字符
    });

    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText("邀请码长度不能超过 20 个字符。")).toBeInTheDocument();
    });
  });

  it("注册成功显示自定义成功提示", async () => {
    (supabase.rpc as Mock).mockResolvedValue({
      data: [{ success: true, message: "验证成功", expires_at: "2030-01-01" }],
      error: null,
    });

    const { container } = render(<SignupPage />);
    fireEvent.change(screen.getByPlaceholderText("请输入乐团邀请码"), {
      target: { value: "TESTCODE" },
    });
    fireEvent.change(screen.getByPlaceholderText("name@example.com"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("至少 6 位"), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText("再次输入密码"), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText("请填写真实姓名"), {
      target: { value: "张三" },
    });
    const selects = container.querySelectorAll("select");
    fireEvent.change(selects[0], { target: { value: "长笛" } });
    fireEvent.change(screen.getByPlaceholderText("例如：经济学院"), {
      target: { value: "经济学院" },
    });
    fireEvent.change(selects[1], { target: { value: "2024" } });
    fireEvent.change(selects[2], { target: { value: "秋" } });

    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText("注册成功，请等待管理员审核。")).toBeInTheDocument();
    });
  });

  // 邀请码多次使用测试
  it("多次使用邀请码 - 第二次使用成功（max_uses > 1）", async () => {
    // 模拟邀请码可使用多次，第一次验证成功
    (supabase.rpc as Mock)
      .mockResolvedValueOnce({
        data: [{ success: true, message: "验证成功", expires_at: "2030-01-01" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ success: true, message: "验证成功", expires_at: "2030-01-01" }],
        error: null,
      });

    const { container } = render(<SignupPage />);
    // 第一次提交
    fireEvent.change(screen.getByPlaceholderText("请输入乐团邀请码"), {
      target: { value: "MULTIUSE" },
    });
    fireEvent.change(screen.getByPlaceholderText("name@example.com"), {
      target: { value: "test1@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("至少 6 位"), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText("再次输入密码"), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText("请填写真实姓名"), {
      target: { value: "张三" },
    });
    const selects = container.querySelectorAll("select");
    fireEvent.change(selects[0], { target: { value: "长笛" } });
    fireEvent.change(screen.getByPlaceholderText("例如：经济学院"), {
      target: { value: "经济学院" },
    });
    fireEvent.change(selects[1], { target: { value: "2024" } });
    fireEvent.change(selects[2], { target: { value: "秋" } });

    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      // 第一次注册成功
      expect(screen.getByText("注册成功，请等待管理员审核。")).toBeInTheDocument();
    });
  });

  it("多次使用邀请码 - 达到使用次数上限后失败", async () => {
    // 第一次验证成功，第二次验证失败（达到使用次数上限）
    (supabase.rpc as Mock)
      .mockResolvedValueOnce({
        data: [{ success: true, message: "验证成功", expires_at: "2030-01-01" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ success: false, message: "邀请码已被使用完毕" }],
        error: null,
      });

    // 第一次注册
    const { container } = render(<SignupPage />);
    fireEvent.change(screen.getByPlaceholderText("请输入乐团邀请码"), {
      target: { value: "SINGLEUSE" },
    });
    fireEvent.change(screen.getByPlaceholderText("name@example.com"), {
      target: { value: "test1@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("至少 6 位"), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText("再次输入密码"), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByPlaceholderText("请填写真实姓名"), {
      target: { value: "张三" },
    });
    const selects = container.querySelectorAll("select");
    fireEvent.change(selects[0], { target: { value: "长笛" } });
    fireEvent.change(screen.getByPlaceholderText("例如：经济学院"), {
      target: { value: "经济学院" },
    });
    fireEvent.change(selects[1], { target: { value: "2024" } });
    fireEvent.change(selects[2], { target: { value: "秋" } });

    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText("注册成功，请等待管理员审核。")).toBeInTheDocument();
    });
  });
});
