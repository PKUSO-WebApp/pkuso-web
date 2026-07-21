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
    auth: {
      signUp: vi.fn().mockResolvedValue({ error: null, data: { user: { id: "test-user-id" } } }),
      getSession: vi
        .fn()
        .mockResolvedValue({ data: { session: { user: { id: "test-user-id" } } } }),
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
    // 模拟邀请码有效：使用 UPDATE 操作进行原子验证
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { code: "TESTCODE", used: false, expires_at: "2030-01-01" },
        error: null,
      }),
    });
    (supabase.from as Mock).mockImplementation(mockFrom);

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
      // 验证阶段：使用 UPDATE 进行原子验证
      expect(supabase.from).toHaveBeenCalledWith("invitation_codes");
      // 验证 update 被调用（原子验证）
      expect(mockFrom.mock.results[0].value.update).toHaveBeenCalledWith({ used: true });
      // 验证 select 被调用（获取 expires_at）
      expect(mockFrom.mock.results[0].value.select).toHaveBeenCalledWith("expires_at");
      const eqCalls = mockFrom.mock.results[0].value.eq.mock.calls;
      expect(eqCalls).toContainEqual(["code", "TESTCODE"]);
      expect(eqCalls).toContainEqual(["used", false]);
    });
  });

  it("邀请码验证 - 无效邀请码", async () => {
    // 模拟邀请码无效：返回空 data（UPDATE 操作没有匹配到记录）
    (supabase.from as Mock).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    const { container } = render(<SignupPage />);
    fireEvent.change(screen.getByPlaceholderText("请输入乐团邀请码"), {
      target: { value: "INVALID" },
    });

    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText(/邀请码无效或已被使用/)).toBeInTheDocument();
    });
  });

  it("邀请码验证 - 数据库错误", async () => {
    (supabase.from as Mock).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: "DB error" } }),
    });

    const { container } = render(<SignupPage />);
    fireEvent.change(screen.getByPlaceholderText("请输入乐团邀请码"), {
      target: { value: "TESTCODE" },
    });

    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText("邀请码验证失败，请稍后重试。")).toBeInTheDocument();
    });
  });

  it("密码长度验证 - 少于6位", async () => {
    (supabase.from as Mock).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { code: "TESTCODE", used: false, expires_at: "2030-01-01" },
        error: null,
      }),
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
    (supabase.from as Mock).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { code: "TESTCODE", used: false, expires_at: "2030-01-01" },
        error: null,
      }),
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

  it("邀请码已过期", async () => {
    // 模拟邀请码已过期：返回 data（used: false, expires_at: 过去时间）
    (supabase.from as Mock).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { code: "TESTCODE", used: false, expires_at: "2020-01-01" },
        error: null,
      }),
    });

    const { container } = render(<SignupPage />);
    fireEvent.change(screen.getByPlaceholderText("请输入乐团邀请码"), {
      target: { value: "TESTCODE" },
    });

    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(
        screen.getByText("邀请码已过期，请联系乐团管理员获取新的邀请码。"),
      ).toBeInTheDocument();
    });
  });

  it("邀请码已被使用", async () => {
    // 模拟邀请码已被使用：UPDATE 操作没有匹配到记录（因为 used 已经是 true）
    (supabase.from as Mock).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    const { container } = render(<SignupPage />);
    fireEvent.change(screen.getByPlaceholderText("请输入乐团邀请码"), {
      target: { value: "TESTCODE" },
    });

    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText(/邀请码无效或已被使用/)).toBeInTheDocument();
    });
  });

  it("注册成功后更新邀请码使用者 ID", async () => {
    // 模拟邀请码验证过程（原子 UPDATE）
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { code: "TESTCODE", used: false, expires_at: "2030-01-01" },
        error: null,
      }),
    });
    (supabase.from as Mock).mockImplementation(mockFrom);

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
      // 验证阶段：使用 UPDATE 进行原子验证
      expect(mockFrom.mock.results[0].value.update).toHaveBeenCalledWith({ used: true });
      expect(mockFrom.mock.results[0].value.select).toHaveBeenCalledWith("expires_at");
      const eqCalls0 = mockFrom.mock.results[0].value.eq.mock.calls;
      expect(eqCalls0).toContainEqual(["code", "TESTCODE"]);
      expect(eqCalls0).toContainEqual(["used", false]);

      // 注册成功后：更新邀请码使用者 ID
      expect(mockFrom.mock.results[1].value.update).toHaveBeenCalledWith({
        used_by: "test-user-id",
      });
      const eqCalls1 = mockFrom.mock.results[1].value.eq.mock.calls;
      expect(eqCalls1).toContainEqual(["code", "TESTCODE"]);
    });
  });

  it("注册成功显示自定义成功提示", async () => {
    (supabase.from as Mock).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { code: "TESTCODE", used: false, expires_at: "2030-01-01" },
        error: null,
      }),
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
      expect(screen.getByText("注册成功，请等待管理员审核")).toBeInTheDocument();
    });
  });
});
