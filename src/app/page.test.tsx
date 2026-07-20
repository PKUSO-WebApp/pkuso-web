/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";
import Home from "./page";
import { UserProvider, useUser } from "@/context/user-context";

// Mock hooks
vi.mock("@/hooks/useRehearsals", () => ({
  useRehearsals: vi.fn().mockReturnValue({
    data: [],
    loading: false,
    error: null,
    saving: false,
    fetch: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  }),
}));

vi.mock("@/hooks/useAnnouncements", () => ({
  useAnnouncements: vi.fn().mockReturnValue({
    data: null,
    loading: false,
    error: null,
    publishing: false,
    fetch: vi.fn(),
    publish: vi.fn(),
  }),
}));

vi.mock("@/components/ui/Toggle", () => ({
  Toggle: vi.fn(() => <div data-testid="toggle">Toggle</div>),
}));

vi.mock("@/components/ui/Card", () => ({
  Card: vi.fn(({ children, className }) => (
    <div data-testid="card" className={className}>
      {children}
    </div>
  )),
}));

// 导入 mock 的 hooks
import { useRehearsals } from "@/hooks/useRehearsals";
const mockUseRehearsals = vi.mocked(useRehearsals);

// 辅助组件：在 UserProvider 内自动登录
function WithLoggedInUser({
  children,
  user,
}: {
  children: React.ReactNode;
  user: Parameters<ReturnType<typeof useUser>["login"]>[0];
}) {
  const { login } = useUser();
  React.useEffect(() => {
    login(user);
  }, [login, user]);
  return children;
}

describe("Home 首页组件", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ============================================================
  // 1. 欢迎语测试
  // ============================================================
  describe("欢迎语", () => {
    it("未登录时不显示欢迎语", () => {
      render(<Home />, { wrapper: UserProvider });
      expect(screen.queryByText(/欢迎/)).toBeNull();
    });

    it("登录后显示带用户名的欢迎语", () => {
      render(
        <UserProvider>
          <WithLoggedInUser
            user={{ id: "test-id", name: "张三", role: "member", section: "小提琴" }}
          >
            <Home />
          </WithLoggedInUser>
        </UserProvider>,
      );
      expect(screen.getByText("欢迎，张三！")).toBeTruthy();
    });

    it("用户名全空白时显示'欢迎！'", () => {
      render(
        <UserProvider>
          <WithLoggedInUser
            user={{ id: "test-id", name: "   ", role: "member", section: "小提琴" }}
          >
            <Home />
          </WithLoggedInUser>
        </UserProvider>,
      );
      expect(screen.getByText("欢迎！")).toBeTruthy();
    });

    it("用户名为空字符串时显示'欢迎！'", () => {
      render(
        <UserProvider>
          <WithLoggedInUser user={{ id: "test-id", name: "", role: "member", section: "小提琴" }}>
            <Home />
          </WithLoggedInUser>
        </UserProvider>,
      );
      expect(screen.getByText("欢迎！")).toBeTruthy();
    });

    it("用户名为undefined时显示'欢迎！'", () => {
      render(
        <UserProvider>
          <WithLoggedInUser
            user={{
              id: "test-id",
              name: undefined as unknown as string,
              role: "member",
              section: "小提琴",
            }}
          >
            <Home />
          </WithLoggedInUser>
        </UserProvider>,
      );
      expect(screen.getByText("欢迎！")).toBeTruthy();
    });
  });

  // ============================================================
  // 2. Rehearsals 边界测试
  // ============================================================
  describe("rehearsals 边界处理", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      // 默认返回空数组
      mockUseRehearsals.mockReturnValue({
        data: [],
        loading: false,
        error: null,
        saving: false,
        fetch: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      });
    });

    it("rehearsals 为 undefined 时不崩溃", () => {
      mockUseRehearsals.mockReturnValue({
        data: undefined as unknown as ReturnType<typeof useRehearsals>["data"],
        loading: false,
        error: null,
        saving: false,
        fetch: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      });

      expect(() => {
        render(<Home />, { wrapper: UserProvider });
      }).not.toThrow();

      expect(screen.getByText("暂无安排")).toBeTruthy();
    });

    it("rehearsals 为 null 时不崩溃", () => {
      mockUseRehearsals.mockReturnValue({
        data: null as unknown as ReturnType<typeof useRehearsals>["data"],
        loading: false,
        error: null,
        saving: false,
        fetch: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      });

      expect(() => {
        render(<Home />, { wrapper: UserProvider });
      }).not.toThrow();

      expect(screen.getByText("暂无安排")).toBeTruthy();
    });

    it("rehearsals 为空数组时显示'暂无安排'", () => {
      render(<Home />, { wrapper: UserProvider });
      expect(screen.getByText("暂无安排")).toBeTruthy();
    });

    it("rehearsals 加载中显示'加载中…'", () => {
      mockUseRehearsals.mockReturnValue({
        data: [],
        loading: true,
        error: null,
        saving: false,
        fetch: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      });

      render(<Home />, { wrapper: UserProvider });
      expect(screen.getByText("加载中…")).toBeTruthy();
    });
  });

  // ============================================================
  // 3. Toggle 组件测试
  // ============================================================
  describe("Toggle 组件", () => {
    it("渲染 Toggle 组件", () => {
      render(<Home />, { wrapper: UserProvider });
      expect(screen.getByTestId("toggle")).toBeTruthy();
    });
  });

  // ============================================================
  // 4. 页面标题测试
  // ============================================================
  describe("页面标题", () => {
    it("显示'本周排练日程'标题", () => {
      render(<Home />, { wrapper: UserProvider });
      expect(screen.getByText("本周排练日程")).toBeTruthy();
    });

    it("显示副标题", () => {
      render(<Home />, { wrapper: UserProvider });
      expect(screen.getByText("查看乐团合排与分排安排")).toBeTruthy();
    });
  });
});
