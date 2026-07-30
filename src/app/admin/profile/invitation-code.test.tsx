// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ProfilePage from "./page";
import { supabase } from "@/lib/supabase";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
    auth: {
      updateUser: vi.fn().mockResolvedValue({ error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "test-admin-id" } }, error: null }),
    },
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock("@/context/user-context", () => ({
  useUser: () => ({
    user: { id: "test-admin-id", name: "管理员", email: "admin@example.com", section: "指挥" },
    logout: vi.fn(),
  }),
}));

describe("邀请码管理", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("显示邀请码管理区域", () => {
    render(<ProfilePage />);
    // 存在"管理邀请码"和"生成邀请码"两个按钮
    expect(screen.getByRole("button", { name: /管理邀请码/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /生成邀请码/ })).toBeInTheDocument();
  });

  it("打开生成邀请码 Modal 并显示单个/批量切换", async () => {
    render(<ProfilePage />);
    const invitationButton = screen.getByRole("button", { name: /生成邀请码/ });
    fireEvent.click(invitationButton);

    await waitFor(() => {
      expect(screen.getByText("生成方式")).toBeInTheDocument();
      // Toggle 两个选项的 label
      expect(screen.getByText("单个生成")).toBeInTheDocument();
      expect(screen.getByText("批量生成")).toBeInTheDocument();
    });
  });

  it("单个生成邀请码 - 自动生成 8 位随机码并写入 invitation_codes", async () => {
    // 单个生成：insert -> select -> single
    const singleResult = {
      id: "code-1",
      code: "ABCDEFGH",
      max_uses: 1,
      used_count: 0,
      created_by: "test-admin-id",
      created_at: new Date().toISOString(),
    };
    const insertMock = vi.fn().mockReturnThis();
    const selectMock = vi.fn().mockReturnThis();
    const singleMock = vi.fn().mockResolvedValue({ data: singleResult, error: null });
    (supabase.from as Mock).mockReturnValue({
      select: selectMock,
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      insert: insertMock,
      single: singleMock,
      maybeSingle: vi.fn().mockReturnThis(),
    });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /生成邀请码/ }));

    await waitFor(() => {
      // 默认是单个模式，直接可以点"生成"按钮
      expect(screen.getByRole("button", { name: /^生成$/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /^生成$/ }));

    await waitFor(() => {
      // from("invitation_codes") 被调用
      expect(supabase.from).toHaveBeenCalledWith("invitation_codes");
      // insert 被调用且 data 中 code 是 8 位字符
      expect(insertMock).toHaveBeenCalled();
      const inserted = insertMock.mock.calls[0][0] as Record<string, unknown>;
      expect(inserted.code).toHaveLength(8);
      expect(inserted.created_by).toBe("test-admin-id");
      // insert -> select -> single 链式调用完成
      expect(selectMock).toHaveBeenCalled();
      expect(singleMock).toHaveBeenCalled();
    });
  });

  it("单个生成邀请码 - 生成结果显示在 Modal 内并提供复制按钮", async () => {
    const singleResult = {
      id: "code-2",
      code: "MYCODE01",
      max_uses: 1,
      used_count: 0,
      created_by: "test-admin-id",
      created_at: new Date().toISOString(),
    };
    (supabase.from as Mock).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: singleResult, error: null }),
      maybeSingle: vi.fn().mockReturnThis(),
    });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /生成邀请码/ }));

    await waitFor(() => {
      screen.getByRole("button", { name: /^生成$/ });
    });
    fireEvent.click(screen.getByRole("button", { name: /^生成$/ }));

    await waitFor(() => {
      // 生成结果中显示 code（font-mono 文本）
      expect(screen.getByText("MYCODE01")).toBeInTheDocument();
      // 有"复制"按钮
      expect(screen.getByRole("button", { name: "复制" })).toBeInTheDocument();
    });
  });

  it("批量生成邀请码 - 默认数量为 5 个", async () => {
    // 批量：insert -> select（不带 single）返回数组
    const selectMock = vi.fn().mockResolvedValue({
      data: Array.from({ length: 5 }, (_, i) => ({
        id: `batch-${i}`,
        code: `CODE${i.toString().padStart(4, "0")}`,
        max_uses: 1,
        used_count: 0,
        created_by: "test-admin-id",
        created_at: new Date().toISOString(),
      })),
      error: null,
    });
    const insertMock = vi.fn().mockReturnValue({ select: selectMock });
    (supabase.from as Mock).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      insert: insertMock,
      single: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnThis(),
    });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /生成邀请码/ }));

    await waitFor(() => {
      screen.getByText("批量生成");
    });

    // 切到批量模式
    fireEvent.click(screen.getByText("批量生成"));

    // 默认 batchCount 是 5，直接点生成
    fireEvent.click(screen.getByRole("button", { name: /^生成$/ }));

    await waitFor(() => {
      expect(insertMock).toHaveBeenCalled();
      const batch = insertMock.mock.calls[0][0] as Record<string, unknown>[];
      expect(batch).toHaveLength(5);
      batch.forEach((item) => {
        expect(item.code).toHaveLength(8);
        expect(item.created_by).toBe("test-admin-id");
      });
      // insert 之后调用了 select（不带 single）
      expect(selectMock).toHaveBeenCalled();
    });
  });

  it("批量生成邀请码 - 指定数量", async () => {
    const selectMock = vi.fn().mockResolvedValue({ data: [], error: null });
    const insertMock = vi.fn().mockReturnValue({ select: selectMock });
    (supabase.from as Mock).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      insert: insertMock,
      single: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnThis(),
    });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /生成邀请码/ }));

    await waitFor(() => {
      screen.getByText("批量生成");
    });
    fireEvent.click(screen.getByText("批量生成"));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("1-100")).toBeInTheDocument();
    });

    // 设置数量为 3（placeholder="1-100" 的那个 input）
    fireEvent.change(screen.getByPlaceholderText("1-100"), { target: { value: "3" } });

    fireEvent.click(screen.getByRole("button", { name: /^生成$/ }));

    await waitFor(() => {
      expect(insertMock).toHaveBeenCalled();
      const batch = insertMock.mock.calls[0][0] as Record<string, unknown>[];
      expect(batch).toHaveLength(3);
    });
  });

  it("批量生成邀请码 - 数量小于 1 时自动 clamp 到 1", async () => {
    const selectMock = vi.fn().mockResolvedValue({ data: [], error: null });
    const insertMock = vi.fn().mockReturnValue({ select: selectMock });
    (supabase.from as Mock).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      insert: insertMock,
      single: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnThis(),
    });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /生成邀请码/ }));

    await waitFor(() => {
      screen.getByText("批量生成");
    });
    fireEvent.click(screen.getByText("批量生成"));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("1-100")).toBeInTheDocument();
    });

    // 输入 0，期望被 clamp 到 1
    fireEvent.change(screen.getByPlaceholderText("1-100"), { target: { value: "0" } });

    fireEvent.click(screen.getByRole("button", { name: /^生成$/ }));

    await waitFor(() => {
      expect(insertMock).toHaveBeenCalled();
      const batch = insertMock.mock.calls[0][0] as Record<string, unknown>[];
      expect(batch).toHaveLength(1);
    });
  });

  it("批量生成邀请码 - 数量大于 100 时自动 clamp 到 100", async () => {
    const selectMock = vi.fn().mockResolvedValue({ data: [], error: null });
    const insertMock = vi.fn().mockReturnValue({ select: selectMock });
    (supabase.from as Mock).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      insert: insertMock,
      single: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnThis(),
    });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /生成邀请码/ }));

    await waitFor(() => {
      screen.getByText("批量生成");
    });
    fireEvent.click(screen.getByText("批量生成"));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("1-100")).toBeInTheDocument();
    });

    // 输入 101，期望被 clamp 到 100
    fireEvent.change(screen.getByPlaceholderText("1-100"), { target: { value: "101" } });

    fireEvent.click(screen.getByRole("button", { name: /^生成$/ }));

    await waitFor(() => {
      expect(insertMock).toHaveBeenCalled();
      const batch = insertMock.mock.calls[0][0] as Record<string, unknown>[];
      expect(batch).toHaveLength(100);
    });
  });

  it("生成失败时 Modal 内显示错误提示（text-danger）", async () => {
    // 单个生成返回错误（single 返回 data: null, error: { message: "DB error" }）
    // handleGenerate 里 result 为 null → 显示 genError 固定文案"邀请码生成失败，请重试"
    (supabase.from as Mock).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "DB error" } }),
      maybeSingle: vi.fn().mockReturnThis(),
    });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /生成邀请码/ }));

    await waitFor(() => {
      screen.getByRole("button", { name: /^生成$/ });
    });
    fireEvent.click(screen.getByRole("button", { name: /^生成$/ }));

    await waitFor(() => {
      // 单个生成失败时 genError 显示固定文案，class 为 text-danger
      const errEl = screen.getByText("邀请码生成失败，请重试");
      expect(errEl.closest("p")).toHaveClass("text-danger");
    });
  });

  it("批量生成结果列表显示所有 code 并带复制按钮", async () => {
    const codes = Array.from({ length: 3 }, (_, i) => ({
      id: `b-${i}`,
      code: `BATCH${i}`,
      max_uses: 1,
      used_count: 0,
      created_by: "test-admin-id",
      created_at: new Date().toISOString(),
    }));
    const insertMock = vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: codes, error: null }),
    });
    (supabase.from as Mock).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      insert: insertMock,
      single: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnThis(),
    });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /生成邀请码/ }));

    await waitFor(() => {
      screen.getByText("批量生成");
    });
    fireEvent.click(screen.getByText("批量生成"));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("1-100")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText("1-100"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /^生成$/ }));

    await waitFor(() => {
      // 结果列表显示 3 个 code
      codes.forEach((c) => {
        expect(screen.getByText(c.code)).toBeInTheDocument();
      });
      // 结果标题包含数量
      expect(screen.getByText(/生成结果.*3.*个/)).toBeInTheDocument();
    });
  });

  it("生成失败时批量也显示错误提示", async () => {
    // 批量生成：select 返回错误（或 results.length === 0）
    // handleGenerate 检查 results.length === 0 → 显示固定文案"邀请码生成失败，请重试"
    const insertMock = vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: [], error: { message: "Batch insert failed" } }),
    });
    (supabase.from as Mock).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      insert: insertMock,
      single: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnThis(),
    });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /生成邀请码/ }));

    await waitFor(() => {
      screen.getByText("批量生成");
    });
    fireEvent.click(screen.getByText("批量生成"));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("1-100")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText("1-100"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /^生成$/ }));

    await waitFor(() => {
      expect(screen.getByText("邀请码生成失败，请重试")).toBeInTheDocument();
    });
  });

  it("单个生成邀请码 - 随机码排除易混淆字符（0/O/1/I）", async () => {
    const insertMock = vi.fn().mockReturnThis();
    (supabase.from as Mock).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      insert: insertMock,
      single: vi.fn().mockImplementation(async () => {
        // 这里验证 insert 里的 code 不含 0/O/1/I
        const inserted = insertMock.mock.calls[insertMock.mock.calls.length - 1][0] as Record<
          string,
          unknown
        >;
        return {
          data: { ...inserted, id: "x", created_at: new Date().toISOString() },
          error: null,
        };
      }),
      maybeSingle: vi.fn().mockReturnThis(),
    });

    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /生成邀请码/ }));

    await waitFor(() => {
      screen.getByRole("button", { name: /^生成$/ });
    });

    // 多次生成，确保每次都不含易混淆字符
    for (let i = 0; i < 5; i++) {
      fireEvent.click(screen.getByRole("button", { name: /^生成$/ }));
      await waitFor(() => {
        expect(insertMock).toHaveBeenCalled();
      });
      const inserted = insertMock.mock.calls[insertMock.mock.calls.length - 1][0] as Record<
        string,
        unknown
      >;
      const code = inserted.code as string;
      expect(code).not.toMatch(/[0O1I]/);
      expect(code).toHaveLength(8);
    }
  });
});
