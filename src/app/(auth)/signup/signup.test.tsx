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
    // 两阶段默认：check_invitation_code 和 verify_and_use_invitation_code 都返回空数组（无效）
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
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
const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
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
    // 模拟两阶段调用：check_invitation_code 返回有效（只读验证阶段）
    (supabase.rpc as Mock).mockImplementation((fn: string) => {
      if (fn === "check_invitation_code") {
        return Promise.resolve({
          data: [{ id: "test-id", code: "TESTCODE", expires_at: "2030-01-01", used: false }],
          error: null,
        });
      }
      if (fn === "verify_and_use_invitation_code") {
        return Promise.resolve({
          data: [{ id: "test-id", code: "TESTCODE", used: true, used_by: "test-user-id" }],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
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
      // 第一阶段：调用 check_invitation_code 只读验证（不消耗）
      expect(supabase.rpc).toHaveBeenCalledWith("check_invitation_code", {
        p_code: "TESTCODE",
      });
    });
  });

  it("邀请码验证 - 无效邀请码", async () => {
    // 模拟 check_invitation_code 返回空数组（邀请码无效）
    (supabase.rpc as Mock).mockImplementation((fn: string) => {
      if (fn === "check_invitation_code") {
        return Promise.resolve({ data: [], error: null });
      }
      return Promise.resolve({ data: [], error: null });
    });

    const { container } = render(<SignupPage />);
    fireEvent.change(screen.getByPlaceholderText("请输入乐团邀请码"), {
      target: { value: "INVALID" },
    });
    // 需要填写必填字段，否则表单验证会先失败
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
    (supabase.rpc as Mock).mockImplementation((fn: string) => {
      if (fn === "check_invitation_code") {
        return Promise.resolve({ data: null, error: { message: "DB error" } });
      }
      return Promise.resolve({ data: [], error: null });
    });

    const { container } = render(<SignupPage />);
    fireEvent.change(screen.getByPlaceholderText("请输入乐团邀请码"), {
      target: { value: "TESTCODE" },
    });
    // 需要填写必填字段，否则表单验证会先失败
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
    // 表单验证在邀请码验证之前，密码长度不够直接返回，不会调用 RPC
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
    // 验证：表单验证失败时不会调用邀请码 RPC（不消耗邀请码）
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("确认密码验证 - 两次输入不一致", async () => {
    // 表单验证在邀请码验证之前，密码不一致直接返回，不会调用 RPC
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
    // 验证：表单验证失败时不会调用邀请码 RPC（不消耗邀请码）
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("表单验证 - 必填字段为空", async () => {
    const { container } = render(<SignupPage />);
    // 不填写任何字段直接提交
    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText("请填写完整信息后再提交。")).toBeInTheDocument();
    });
    // 验证：表单验证失败时不会调用邀请码 RPC（不消耗邀请码）
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("邀请码已过期 - 返回统一错误消息", async () => {
    // 模拟 check_invitation_code 返回空数组（RPC 内部已检查过期）
    (supabase.rpc as Mock).mockImplementation((fn: string) => {
      if (fn === "check_invitation_code") {
        return Promise.resolve({ data: [], error: null });
      }
      return Promise.resolve({ data: [], error: null });
    });

    const { container } = render(<SignupPage />);
    fireEvent.change(screen.getByPlaceholderText("请输入乐团邀请码"), {
      target: { value: "TESTCODE" },
    });
    // 需要填写必填字段，否则表单验证会先失败
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
    // 模拟 check_invitation_code 返回空数组（邀请码已被使用完毕）
    (supabase.rpc as Mock).mockImplementation((fn: string) => {
      if (fn === "check_invitation_code") {
        return Promise.resolve({ data: [], error: null });
      }
      return Promise.resolve({ data: [], error: null });
    });

    const { container } = render(<SignupPage />);
    fireEvent.change(screen.getByPlaceholderText("请输入乐团邀请码"), {
      target: { value: "TESTCODE" },
    });
    // 需要填写必填字段，否则表单验证会先失败
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
    // 模拟 check_invitation_code 返回空数组（邀请码已被使用）
    (supabase.rpc as Mock).mockImplementation((fn: string) => {
      if (fn === "check_invitation_code") {
        return Promise.resolve({ data: [], error: null });
      }
      return Promise.resolve({ data: [], error: null });
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

  it("注册成功后调用 verify_and_use_invitation_code 消耗邀请码（两阶段流程）", async () => {
    // 模拟两阶段 RPC 调用：
    // 1. check_invitation_code 返回有效（只读验证）
    // 2. verify_and_use_invitation_code 成功（原子消耗+绑定）
    const mockRpc = vi.fn().mockImplementation((fn: string, params: Record<string, unknown>) => {
      void params;
      if (fn === "check_invitation_code") {
        return Promise.resolve({
          data: [{ id: "test-id", code: "TESTCODE", expires_at: "2030-01-01", used: false }],
          error: null,
        });
      }
      if (fn === "verify_and_use_invitation_code") {
        return Promise.resolve({
          data: [{ id: "test-id", code: "TESTCODE", used: true, used_by: "test-user-id" }],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    });
    (supabase.rpc as Mock).mockImplementation(mockRpc);

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
      // 第一阶段：调用 check_invitation_code 只读验证
      expect(mockRpc).toHaveBeenCalledWith("check_invitation_code", {
        p_code: "TESTCODE",
      });

      // 第二阶段：注册成功后调用 verify_and_use_invitation_code 原子消耗+绑定
      // 传入 p_code 和 p_user_id（来自 signUp 响应），RPC 内部校验用户存在且为近期创建
      expect(mockRpc).toHaveBeenCalledWith("verify_and_use_invitation_code", {
        p_code: "TESTCODE",
        p_user_id: "test-user-id",
      });

      // 不再通过 supabase.from 直接更新 used_by
      expect(supabase.from).not.toHaveBeenCalled();
    });
  });

  it("邀请码验证失败（只读阶段）时不调用 signUp、不创建用户", async () => {
    // 两阶段流程：check_invitation_code 失败 → 直接返回，不创建用户
    (supabase.rpc as Mock).mockImplementation((fn: string) => {
      if (fn === "check_invitation_code") {
        return Promise.resolve({ data: [], error: null });
      }
      return Promise.resolve({ data: [], error: null });
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
      // 邀请码只读验证失败，根本不会走到 signUp，所以不需要 admin.deleteUser
      expect(supabase.auth.signUp).not.toHaveBeenCalled();
      expect(supabase.auth.admin.deleteUser).not.toHaveBeenCalled();
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
    // 长度校验在邀请码 RPC 之前，所以不会调用 RPC
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("注册成功显示自定义成功提示", async () => {
    // 模拟两阶段 RPC 调用都成功
    (supabase.rpc as Mock).mockImplementation((fn: string) => {
      if (fn === "check_invitation_code") {
        return Promise.resolve({
          data: [{ id: "test-id", code: "TESTCODE", expires_at: "2030-01-01", used: false }],
          error: null,
        });
      }
      if (fn === "verify_and_use_invitation_code") {
        return Promise.resolve({
          data: [{ id: "test-id", code: "TESTCODE", used: true, used_by: "test-user-id" }],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
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

  it("邀请码消耗失败时显示错误提示且不跳转", async () => {
    // 模拟 check_invitation_code 成功，但 verify_and_use_invitation_code 失败
    (supabase.rpc as Mock).mockImplementation((fn: string) => {
      if (fn === "check_invitation_code") {
        return Promise.resolve({
          data: [{ id: "test-id", code: "TESTCODE", expires_at: "2030-01-01", used: false }],
          error: null,
        });
      }
      if (fn === "verify_and_use_invitation_code") {
        return Promise.resolve({
          data: null,
          error: { message: "邀请码已被使用" },
        });
      }
      return Promise.resolve({ data: [], error: null });
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
      expect(screen.getByText("注册成功但邀请码绑定异常，请联系管理员")).toBeInTheDocument();
    });

    // 验证没有跳转到登录页
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("邀请码消耗返回空数组时显示错误提示且不跳转", async () => {
    // 模拟 check_invitation_code 成功，但 verify_and_use_invitation_code 返回空数组（邀请码已被使用或过期）
    (supabase.rpc as Mock).mockImplementation((fn: string) => {
      if (fn === "check_invitation_code") {
        return Promise.resolve({
          data: [{ id: "test-id", code: "TESTCODE", expires_at: "2030-01-01", used: false }],
          error: null,
        });
      }
      if (fn === "verify_and_use_invitation_code") {
        // RPC 返回 TABLE，邀请码无效/已被使用时返回空数组，error 为 null
        return Promise.resolve({
          data: [],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
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
      expect(screen.getByText("注册成功但邀请码绑定异常，请联系管理员")).toBeInTheDocument();
    });

    // 验证没有跳转到登录页
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
