// @vitest-environment jsdom

/**
 * AuthGate 的路由判据（Issue #340）。
 *
 * 这里只测「已登录 + 已批准」的路由分流：判据本身（角色 × 路径矩阵）在
 * `src/lib/access.test.ts`。本文件钉的是**接线**——AuthGate 的两个 effect
 * 有没有走那份判据、落点是不是分角色的。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { AuthGate } from "./auth-gate";
import type { UserRole } from "@/context/user-context";

// ---- next/navigation：pathname 可变，replace 可断言 ----
const { mockReplace, pathState, authState } = vi.hoisted(() => ({
  mockReplace: vi.fn(),
  pathState: { current: "/" },
  authState: { current: {} as Record<string, unknown> },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => pathState.current,
}));

vi.mock("@/context/user-context", () => ({
  useUser: () => ({ user: null, login: vi.fn(), logout: vi.fn() }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authState.current,
}));

type AuthOverrides = Partial<{
  sessionUserId: string | null;
  sessionLoading: boolean;
  emailConfirmed: boolean | null;
  profileStatus: string | null;
  profileRole: UserRole | null;
  profileLoading: boolean;
  profileErrorMsg: string | null;
}>;

/** 默认：已登录、邮箱已验证、资料已批准、admin */
function setAuth(overrides: AuthOverrides = {}) {
  authState.current = {
    sessionUserId: "u1",
    sessionLoading: false,
    emailConfirmed: true,
    profileStatus: "approved",
    profileRole: "admin",
    profileLoading: false,
    profileErrorMsg: null,
    handleSignOut: vi.fn(),
    ...overrides,
  };
}

function renderGate() {
  return render(
    <AuthGate>
      <div data-testid="children-content">子内容</div>
    </AuthGate>,
  );
}

describe("AuthGate 路由分流", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pathState.current = "/";
    setAuth();
  });

  afterEach(() => {
    cleanup();
  });

  it("admin 停在 /（非管理端）→ 送回 /admin", async () => {
    renderGate();
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/admin");
    });
  });

  it("admin 停在 /admin/roster → 不跳转（回归：管理端内部自由走动）", () => {
    pathState.current = "/admin/roster";
    renderGate();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("score_manager 停在 /（成员引导页）→ 送到谱务列表，不是死胡同", async () => {
    setAuth({ profileRole: "score_manager" });
    renderGate();
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/admin/sheet-music");
    });
  });

  it("score_manager 停在管理端非谱务路径 → 也送到谱务列表", async () => {
    setAuth({ profileRole: "score_manager" });
    pathState.current = "/admin/roster";
    renderGate();
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/admin/sheet-music");
    });
  });

  it("score_manager 停在谱务列表 → 不跳转", () => {
    setAuth({ profileRole: "score_manager" });
    pathState.current = "/admin/sheet-music";
    renderGate();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("member 停在 / → 不跳转（引导页就是他该在的地方）", () => {
    setAuth({ profileRole: "member" });
    renderGate();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("member 停在 /admin → 弹回 /（回归）", async () => {
    setAuth({ profileRole: "member" });
    pathState.current = "/admin";
    renderGate();
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/");
    });
  });

  it("邮箱未验证（emailConfirmed=false）时不跳转，等验证状态", () => {
    setAuth({ profileRole: "score_manager", emailConfirmed: false });
    pathState.current = "/admin/roster";
    renderGate();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("资料未批准（pending）时不跳转", () => {
    setAuth({ profileRole: "score_manager", profileStatus: "pending" });
    pathState.current = "/admin/roster";
    renderGate();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
