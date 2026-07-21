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
      insert: vi.fn().mockResolvedValue({ error: null }),
    }),
    auth: {
      updateUser: vi.fn().mockResolvedValue({ error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
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
    // 使用包含匹配来查找带 emoji 的按钮文本
    const invitationButton = screen.getByRole("button", { name: /生成邀请码/ });
    expect(invitationButton).toBeInTheDocument();
  });

  it("切换到邀请码管理模式", async () => {
    render(<ProfilePage />);
    const invitationButton = screen.getByRole("button", { name: /生成邀请码/ });
    fireEvent.click(invitationButton);

    await waitFor(() => {
      expect(screen.getByText("单个生成")).toBeInTheDocument();
      expect(screen.getByText("批量生成")).toBeInTheDocument();
    });
  });

  it("单个生成邀请码 - 自定义邀请码", async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    (supabase.from as Mock).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      insert: insertMock,
    });

    render(<ProfilePage />);
    const invitationButton = screen.getByRole("button", { name: /生成邀请码/ });
    fireEvent.click(invitationButton);

    await waitFor(() => {
      fireEvent.change(screen.getByPlaceholderText("输入邀请码或留空"), {
        target: { value: "MYCUSTOMCODE" },
      });
    });

    fireEvent.click(screen.getByText("生成"));

    await waitFor(() => {
      expect(insertMock).toHaveBeenCalledWith([
        {
          code: "MYCUSTOMCODE",
          max_uses: 1,
          used_count: 0,
          created_by: "test-admin-id",
        },
      ]);
    });
  });

  it("单个生成邀请码 - 使用次数为0表示不限", async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    (supabase.from as Mock).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      insert: insertMock,
    });

    render(<ProfilePage />);
    const invitationButton = screen.getByRole("button", { name: /生成邀请码/ });
    fireEvent.click(invitationButton);

    await waitFor(() => {
      fireEvent.change(screen.getByPlaceholderText("输入邀请码或留空"), {
        target: { value: "UNLIMITED" },
      });
      const maxUsesInput = screen.getByLabelText("使用次数（默认1，0表示不限次数）");
      fireEvent.change(maxUsesInput, { target: { value: "0" } });
    });

    fireEvent.click(screen.getByText("生成"));

    await waitFor(() => {
      expect(insertMock).toHaveBeenCalledWith([
        {
          code: "UNLIMITED",
          max_uses: 0,
          used_count: 0,
          created_by: "test-admin-id",
        },
      ]);
    });
  });

  it("单个生成邀请码 - 自动生成随机邀请码", async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    (supabase.from as Mock).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      insert: insertMock,
    });

    render(<ProfilePage />);
    const invitationButton = screen.getByRole("button", { name: /生成邀请码/ });
    fireEvent.click(invitationButton);

    await waitFor(() => {
      fireEvent.change(screen.getByPlaceholderText("输入邀请码或留空"), {
        target: { value: "" },
      });
    });

    fireEvent.click(screen.getByText("生成"));

    await waitFor(() => {
      expect(insertMock).toHaveBeenCalled();
      const insertedData = insertMock.mock.calls[0][0][0];
      expect(insertedData.code).toHaveLength(20);
      expect(insertedData.max_uses).toBe(1);
    });
  });

  it("单个生成邀请码 - 长度超过20字符验证失败", async () => {
    const alertMock = vi.spyOn(window, "alert").mockImplementation(() => {});

    render(<ProfilePage />);
    const invitationButton = screen.getByRole("button", { name: /生成邀请码/ });
    fireEvent.click(invitationButton);

    await waitFor(() => {
      fireEvent.change(screen.getByPlaceholderText("输入邀请码或留空"), {
        target: { value: "ABCDEFGHIJKLMNOPQRSTUVWXYZ" },
      });
    });

    fireEvent.click(screen.getByText("生成"));

    expect(alertMock).toHaveBeenCalledWith("邀请码长度不能超过 20 个字符");
    alertMock.mockRestore();
  });

  it("批量生成邀请码 - 默认数量为1", async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    const selectMock = vi.fn().mockReturnThis().mockResolvedValue({ data: [] });
    (supabase.from as Mock).mockReturnValue({
      select: selectMock,
      eq: vi.fn().mockReturnThis(),
      insert: insertMock,
    });

    render(<ProfilePage />);
    const invitationButton = screen.getByRole("button", { name: /生成邀请码/ });
    fireEvent.click(invitationButton);

    await waitFor(() => {
      fireEvent.click(screen.getByText("批量生成"));
    });

    fireEvent.click(screen.getByText("生成"));

    await waitFor(() => {
      expect(insertMock).toHaveBeenCalled();
      const insertedData = insertMock.mock.calls[0][0];
      expect(insertedData).toHaveLength(1);
      expect(insertedData[0].max_uses).toBe(1);
      expect(insertedData[0].code).toHaveLength(20);
    });
  });

  it("批量生成邀请码 - 指定数量", async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    const selectMock = vi.fn().mockReturnThis().mockResolvedValue({ data: [] });
    (supabase.from as Mock).mockReturnValue({
      select: selectMock,
      eq: vi.fn().mockReturnThis(),
      insert: insertMock,
    });

    render(<ProfilePage />);
    const invitationButton = screen.getByRole("button", { name: /生成邀请码/ });
    fireEvent.click(invitationButton);

    await waitFor(() => {
      fireEvent.click(screen.getByText("批量生成"));
      const batchCountInput = screen.getByLabelText("生成数量");
      fireEvent.change(batchCountInput, { target: { value: "5" } });
    });

    fireEvent.click(screen.getByText("生成"));

    await waitFor(() => {
      expect(insertMock).toHaveBeenCalled();
      const insertedData = insertMock.mock.calls[0][0];
      expect(insertedData).toHaveLength(5);
    });
  });

  it("批量生成邀请码 - 数量小于1验证失败", async () => {
    const alertMock = vi.spyOn(window, "alert").mockImplementation(() => {});

    render(<ProfilePage />);
    const invitationButton = screen.getByRole("button", { name: /生成邀请码/ });
    fireEvent.click(invitationButton);

    await waitFor(() => {
      fireEvent.click(screen.getByText("批量生成"));
      const batchCountInput = screen.getByLabelText("生成数量");
      fireEvent.change(batchCountInput, { target: { value: "0" } });
    });

    fireEvent.click(screen.getByText("生成"));

    expect(alertMock).toHaveBeenCalledWith("生成数量必须在1-100之间");
    alertMock.mockRestore();
  });

  it("批量生成邀请码 - 数量大于100验证失败", async () => {
    const alertMock = vi.spyOn(window, "alert").mockImplementation(() => {});

    render(<ProfilePage />);
    const invitationButton = screen.getByRole("button", { name: /生成邀请码/ });
    fireEvent.click(invitationButton);

    await waitFor(() => {
      fireEvent.click(screen.getByText("批量生成"));
      const batchCountInput = screen.getByLabelText("生成数量");
      fireEvent.change(batchCountInput, { target: { value: "101" } });
    });

    fireEvent.click(screen.getByText("生成"));

    expect(alertMock).toHaveBeenCalledWith("生成数量必须在1-100之间");
    alertMock.mockRestore();
  });

  it("生成结果显示使用次数", async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    (supabase.from as Mock).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      insert: insertMock,
    });

    render(<ProfilePage />);
    const invitationButton = screen.getByRole("button", { name: /生成邀请码/ });
    fireEvent.click(invitationButton);

    await waitFor(() => {
      fireEvent.change(screen.getByPlaceholderText("输入邀请码或留空"), {
        target: { value: "TESTCODE" },
      });
    });

    fireEvent.click(screen.getByText("生成"));

    await waitFor(() => {
      expect(screen.getByText("使用次数: 1")).toBeInTheDocument();
    });
  });

  it("生成结果显示不限次数", async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    (supabase.from as Mock).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      insert: insertMock,
    });

    render(<ProfilePage />);
    const invitationButton = screen.getByRole("button", { name: /生成邀请码/ });
    fireEvent.click(invitationButton);

    await waitFor(() => {
      fireEvent.change(screen.getByPlaceholderText("输入邀请码或留空"), {
        target: { value: "UNLIMITED" },
      });
      const maxUsesInput = screen.getByLabelText("使用次数（默认1，0表示不限次数）");
      fireEvent.change(maxUsesInput, { target: { value: "0" } });
    });

    fireEvent.click(screen.getByText("生成"));

    await waitFor(() => {
      expect(screen.getByText("使用次数: 不限")).toBeInTheDocument();
    });
  });

  it("生成失败显示错误信息", async () => {
    const alertMock = vi.spyOn(window, "alert").mockImplementation(() => {});
    const insertMock = vi.fn().mockResolvedValue({ error: { message: "DB error" } });
    (supabase.from as Mock).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      insert: insertMock,
    });

    render(<ProfilePage />);
    const invitationButton = screen.getByRole("button", { name: /生成邀请码/ });
    fireEvent.click(invitationButton);

    await waitFor(() => {
      fireEvent.change(screen.getByPlaceholderText("输入邀请码或留空"), {
        target: { value: "TESTCODE" },
      });
    });

    fireEvent.click(screen.getByText("生成"));

    expect(alertMock).toHaveBeenCalledWith("生成失败: DB error");
    alertMock.mockRestore();
  });
});
