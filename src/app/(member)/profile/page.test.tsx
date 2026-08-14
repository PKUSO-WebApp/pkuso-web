/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import ProfilePage from "./page";
import { useUser } from "@/context/user-context";
import { useProfiles } from "@/hooks/useProfiles";
import type { ProfileRow } from "@/types/database";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/context/user-context", () => ({
  useUser: vi.fn(),
}));

vi.mock("@/hooks/useProfiles", () => ({
  useProfiles: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { updateUser: vi.fn().mockResolvedValue({ error: null }) },
  },
}));

vi.mock("lucide-react", () => ({
  LogOut: () => <span>LogOut</span>,
}));

const mockUseUser = vi.mocked(useUser);
const mockUseProfiles = vi.mocked(useProfiles);

function mockProfile(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    id: "u1",
    college: null,
    created_at: null,
    email: "a@b.com",
    full_name: "张三",
    instrument: "小提琴",
    is_section_leader: false,
    join_date: null,
    phone_number: null,
    role: "member",
    status: "approved",
    ...overrides,
  };
}

function mockUseProfilesReturn(data: ProfileRow[]) {
  mockUseProfiles.mockReturnValue({
    data,
    loading: false,
    error: null,
    saving: false,
    fetch: vi.fn(),
    update: vi.fn().mockResolvedValue(true),
  } as never);
}

describe("ProfilePage 个人信息页", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseUser.mockReturnValue({
      user: { id: "u1", name: "张三", role: "member", section: "小提琴", email: "a@b.com" },
      login: vi.fn(),
      logout: vi.fn(),
    });
    // jsdom 的 alert 未实现，spy 并吞掉，用于断言提示
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("profile 未加载完成时点击编辑个人信息给出提示且不打开弹窗", () => {
    mockUseProfilesReturn([]);
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /编辑个人信息/ }));
    expect(window.alert).toHaveBeenCalledWith("个人信息加载中，请稍候再试");
    // 弹窗标题不出现
    expect(screen.queryByRole("heading", { name: "编辑个人信息" })).toBeNull();
  });

  it("profile 已加载时打开编辑弹窗并预填数据", () => {
    mockUseProfilesReturn([
      mockProfile({ phone_number: "13800138000", college: "信息科学技术学院" }),
    ]);
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /编辑个人信息/ }));
    expect((screen.getByPlaceholderText("11 位手机号") as HTMLInputElement).value).toBe(
      "13800138000",
    );
    expect((screen.getByPlaceholderText("所在学院") as HTMLInputElement).value).toBe(
      "信息科学技术学院",
    );
  });

  it("手机号格式错误时提示错误且不调用 update", async () => {
    const update = vi.fn().mockResolvedValue(true);
    mockUseProfiles.mockReturnValue({
      data: [mockProfile({ phone_number: "13800138000" })],
      loading: false,
      error: null,
      saving: false,
      fetch: vi.fn(),
      update,
    } as never);
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /编辑个人信息/ }));

    const phoneInput = screen.getByPlaceholderText("11 位手机号") as HTMLInputElement;
    fireEvent.change(phoneInput, { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText(/手机号格式不正确/)).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
    // 弹窗保持打开
    expect(screen.getByRole("heading", { name: "编辑个人信息" })).toBeInTheDocument();
  });

  it("保存成功时调用 update 并关闭弹窗、提示已更新", async () => {
    const update = vi.fn().mockResolvedValue(true);
    mockUseProfiles.mockReturnValue({
      data: [mockProfile({ phone_number: "13800138000" })],
      loading: false,
      error: null,
      saving: false,
      fetch: vi.fn(),
      update,
    } as never);
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /编辑个人信息/ }));

    const collegeInput = screen.getByPlaceholderText("所在学院") as HTMLInputElement;
    fireEvent.change(collegeInput, { target: { value: "光华管理学院" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith("u1", {
        phone_number: "13800138000",
        college: "光华管理学院",
      });
    });
    expect(window.alert).toHaveBeenCalledWith("个人信息已更新");
    // 弹窗关闭
    expect(screen.queryByRole("heading", { name: "编辑个人信息" })).toBeNull();
  });

  it("保存失败时提示错误且不关闭弹窗", async () => {
    mockUseProfiles.mockReturnValue({
      data: [mockProfile()],
      loading: false,
      error: null,
      saving: false,
      fetch: vi.fn(),
      update: vi.fn().mockResolvedValue(false),
    } as never);
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /编辑个人信息/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText("保存失败，请重试")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "编辑个人信息" })).toBeInTheDocument();
  });

  it("防重复提交：保存进行中双击只调用一次 update", async () => {
    let resolveUpdate!: (v: boolean) => void;
    const pending = new Promise<boolean>((resolve) => {
      resolveUpdate = resolve;
    });
    const update = vi.fn().mockReturnValue(pending);
    mockUseProfiles.mockReturnValue({
      data: [mockProfile()],
      loading: false,
      error: null,
      saving: false,
      fetch: vi.fn(),
      update,
    } as never);
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: /编辑个人信息/ }));

    const saveBtn = screen.getByRole("button", { name: "保存" });
    fireEvent.click(saveBtn);
    fireEvent.click(saveBtn);
    expect(update).toHaveBeenCalledTimes(1);

    // 保存中按钮进入提交态
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "保存中..." })).toBeDisabled();
    });

    await act(async () => {
      resolveUpdate(true);
    });
  });
});
