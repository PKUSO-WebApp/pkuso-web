// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import AdminLayout from "./layout";
import { useAdminPageHeader } from "@/context/admin-page-header-context";
import type { User } from "@/context/user-context";

// ---- Mock next/link（jsdom 下避免 Next 路由上下文缺失）----
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

// ---- Mock next/navigation ----
// pathname 必须可变：守卫的判据是「角色 × 路径」，只测一个路径等于没测矩阵
const { mockReplace, pathState } = vi.hoisted(() => ({
  mockReplace: vi.fn(),
  pathState: { current: "/admin" },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: mockReplace,
    refresh: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => pathState.current,
}));

// ---- Mock useUser（hoisted 以支持动态切换 user）----
const { useUserMock, setUser } = vi.hoisted(() => {
  let currentUser: User | null = null;
  return {
    useUserMock: () => ({ user: currentUser, login: vi.fn(), logout: vi.fn() }),
    setUser: (u: User | null) => {
      currentUser = u;
    },
  };
});

vi.mock("@/context/user-context", () => ({
  useUser: useUserMock,
}));

// ---- 测试数据 ----
const adminUser: User = {
  id: "admin-1",
  name: "管理员",
  role: "admin",
  section: "指挥",
};
const memberUser: User = {
  id: "member-1",
  name: "团员",
  role: "member",
  section: "小提琴",
};
const scoreManagerUser: User = {
  id: "score-1",
  name: "谱务",
  role: "score_manager",
  section: "",
};

describe("AdminLayout", () => {
  let reloadSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    setUser(null);
    pathState.current = "/admin";
    sessionStorage.clear();
    reloadSpy = vi.fn();
    // jsdom 下 window.location.reload 不可单独 redefine（non-configurable），
    // 改为整体替换 window.location 对象；组件仅使用 reload 方法
    Object.defineProperty(window, "location", {
      value: { reload: reloadSpy },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  // ==========================================
  // 验收标准 1 & 4：守护页状态判断与文案
  // ==========================================
  describe("守护页状态判断（isLoading vs isUnauthorized）", () => {
    it("user=null（加载中）显示'正在加载用户…'，不显示跳转文案", () => {
      setUser(null);
      render(<AdminLayout>children</AdminLayout>);
      expect(screen.getByText("正在加载用户…")).toBeInTheDocument();
      expect(screen.queryByText("正在跳转…")).not.toBeInTheDocument();
    });

    it("非 admin 用户显示'正在跳转…'而非'正在加载用户…'", () => {
      setUser(memberUser);
      render(<AdminLayout>children</AdminLayout>);
      expect(screen.getByText("正在跳转…")).toBeInTheDocument();
      expect(screen.queryByText("正在加载用户…")).not.toBeInTheDocument();
    });

    it("admin 用户渲染 children 与顶部设置按钮", () => {
      setUser(adminUser);
      render(
        <AdminLayout>
          <div data-testid="children-content">子内容</div>
        </AdminLayout>,
      );
      expect(screen.getByTestId("children-content")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "设置" })).toBeInTheDocument();
    });
  });

  // ==========================================
  // 验收标准 7：非 admin 跳转 /
  // ==========================================
  describe("非 admin 路由权限守卫", () => {
    it("非 admin 用户触发 router.replace('/')", async () => {
      setUser(memberUser);
      render(<AdminLayout>children</AdminLayout>);
      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith("/");
      });
    });

    it("admin 用户不触发 router.replace", () => {
      setUser(adminUser);
      render(<AdminLayout>children</AdminLayout>);
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // score_manager：只碰谱务（Issue #340）
  // ==========================================
  describe("score_manager 只碰谱务", () => {
    it("谱务列表正常渲染 children，不跳转", () => {
      setUser(scoreManagerUser);
      pathState.current = "/admin/sheet-music";
      render(
        <AdminLayout>
          <div data-testid="children-content">子内容</div>
        </AdminLayout>,
      );
      expect(screen.getByTestId("children-content")).toBeInTheDocument();
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it("曲子详情（谱务子路径）正常渲染 children", () => {
      setUser(scoreManagerUser);
      pathState.current = "/admin/sheet-music/8f3a-1b";
      render(
        <AdminLayout>
          <div data-testid="children-content">子内容</div>
        </AdminLayout>,
      );
      expect(screen.getByTestId("children-content")).toBeInTheDocument();
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it("/admin 首页重定向到谱务列表（不是成员引导页 /）", async () => {
      setUser(scoreManagerUser);
      pathState.current = "/admin";
      render(<AdminLayout>children</AdminLayout>);
      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith("/admin/sheet-music");
      });
    });

    it("非谱务路径（个人设置 / 花名册 / 数据导入）同样回到谱务列表", async () => {
      for (const path of ["/admin/profile", "/admin/roster", "/admin/config/import"]) {
        cleanup(); // 逐条独立：别让上一轮挂载的组件替这一轮把 replace 打出来
        mockReplace.mockClear();
        setUser(scoreManagerUser);
        pathState.current = path;
        render(<AdminLayout>children</AdminLayout>);
        await waitFor(() => {
          expect(mockReplace).toHaveBeenCalledWith("/admin/sheet-music");
        });
      }
    });

    it("越界时不渲染 children，显示「正在跳转…」", () => {
      setUser(scoreManagerUser);
      pathState.current = "/admin/roster";
      render(
        <AdminLayout>
          <div data-testid="children-content">子内容</div>
        </AdminLayout>,
      );
      expect(screen.queryByTestId("children-content")).not.toBeInTheDocument();
      expect(screen.getByText("正在跳转…")).toBeInTheDocument();
    });

    it("member 仍被弹回成员引导页（回归：没被 score_manager 的落点带偏）", async () => {
      setUser(memberUser);
      pathState.current = "/admin/sheet-music";
      render(<AdminLayout>children</AdminLayout>);
      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith("/");
      });
    });
  });

  // ==========================================
  // 验收标准 1：reloadTimer 仅在 user=null（真正加载中）时启动
  // ==========================================
  describe("自动刷新触发条件", () => {
    it("user=null 时 5s 后触发 reload 并 +1 计数（0→1）", () => {
      vi.useFakeTimers();
      setUser(null);
      sessionStorage.setItem("admin_layout_refreshes", "0");
      render(<AdminLayout>children</AdminLayout>);
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(reloadSpy).toHaveBeenCalledTimes(1);
      expect(sessionStorage.getItem("admin_layout_refreshes")).toBe("1");
    });

    it("user=null 时 5s 后触发 reload 并 +1 计数（1→2）", () => {
      vi.useFakeTimers();
      setUser(null);
      sessionStorage.setItem("admin_layout_refreshes", "1");
      render(<AdminLayout>children</AdminLayout>);
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(reloadSpy).toHaveBeenCalledTimes(1);
      expect(sessionStorage.getItem("admin_layout_refreshes")).toBe("2");
    });

    it("非 admin 用户不触发自动刷新（不调用 reload，不改 sessionStorage）", () => {
      vi.useFakeTimers();
      setUser(memberUser);
      sessionStorage.setItem("admin_layout_refreshes", "0");
      render(<AdminLayout>children</AdminLayout>);
      // 推进 10 秒，远超 5 秒阈值
      act(() => {
        vi.advanceTimersByTime(10000);
      });
      expect(reloadSpy).not.toHaveBeenCalled();
      // 非加载态不启动 timer，sessionStorage 计数不应变化
      expect(sessionStorage.getItem("admin_layout_refreshes")).toBe("0");
    });

    it("admin 用户不触发自动刷新", () => {
      vi.useFakeTimers();
      setUser(adminUser);
      sessionStorage.setItem("admin_layout_refreshes", "0");
      render(<AdminLayout>children</AdminLayout>);
      act(() => {
        vi.advanceTimersByTime(10000);
      });
      expect(reloadSpy).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // 验收标准 2：2 次刷新上限后显示"加载失败" UI + 重试按钮
  // ==========================================
  describe("刷新上限与加载失败 UI", () => {
    it("计数达到上限（2）后显示'加载失败'和'重试'按钮，不调用 reload", () => {
      vi.useFakeTimers();
      setUser(null);
      sessionStorage.setItem("admin_layout_refreshes", "2");
      render(<AdminLayout>children</AdminLayout>);
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(reloadSpy).not.toHaveBeenCalled();
      expect(screen.getByText("加载失败")).toBeInTheDocument();
      expect(screen.getByText("多次自动刷新仍未成功")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    });

    it("3s 后显示'加载较久'提示（hintTimer）", () => {
      vi.useFakeTimers();
      setUser(null);
      render(<AdminLayout>children</AdminLayout>);
      expect(screen.queryByText("加载较久，即将自动刷新页面…")).not.toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(screen.getByText("加载较久，即将自动刷新页面…")).toBeInTheDocument();
    });

    it("点击'重试'按钮清除 sessionStorage 并 reload", () => {
      vi.useFakeTimers();
      setUser(null);
      sessionStorage.setItem("admin_layout_refreshes", "2");
      render(<AdminLayout>children</AdminLayout>);
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.getByText("加载失败")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "重试" }));
      expect(sessionStorage.getItem("admin_layout_refreshes")).toBeNull();
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================
  // 验收标准 3：重新进入守护页时重置 showReloadHint/reloadFailed
  // ==========================================
  describe("守护页状态重置", () => {
    it("重新进入守护页时重置 showReloadHint（不再显示之前的提示）", () => {
      vi.useFakeTimers();
      setUser(null);
      const { rerender } = render(<AdminLayout>children</AdminLayout>);
      // 触发 hint 显示
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(screen.getByText("加载较久，即将自动刷新页面…")).toBeInTheDocument();
      // 离开守护页（user 加载为 admin）
      setUser(adminUser);
      rerender(<AdminLayout>children</AdminLayout>);
      // 再次进入守护页
      setUser(null);
      rerender(<AdminLayout>children</AdminLayout>);
      // 提示应被重置（不再显示，需再等 3s）
      expect(screen.queryByText("加载较久，即将自动刷新页面…")).not.toBeInTheDocument();
      expect(screen.getByText("正在加载用户…")).toBeInTheDocument();
    });

    it("重新进入守护页时重置 reloadFailed", () => {
      vi.useFakeTimers();
      setUser(null);
      sessionStorage.setItem("admin_layout_refreshes", "2");
      const { rerender } = render(<AdminLayout>children</AdminLayout>);
      // 触发 reloadFailed
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.getByText("加载失败")).toBeInTheDocument();
      // 离开守护页
      setUser(adminUser);
      rerender(<AdminLayout>children</AdminLayout>);
      // 再次进入守护页（计数已被 cleanup 清除）
      setUser(null);
      rerender(<AdminLayout>children</AdminLayout>);
      // 加载失败 UI 应被重置
      expect(screen.queryByText("加载失败")).not.toBeInTheDocument();
      expect(screen.getByText("正在加载用户…")).toBeInTheDocument();
    });
  });

  // ==========================================
  // 验收标准 5 & 6：sessionStorage 计数清除
  // ==========================================
  describe("sessionStorage 计数清除", () => {
    it("进入 admin 成功态时清除 sessionStorage 计数", () => {
      setUser(adminUser);
      sessionStorage.setItem("admin_layout_refreshes", "1");
      render(<AdminLayout>children</AdminLayout>);
      expect(sessionStorage.getItem("admin_layout_refreshes")).toBeNull();
    });

    it("AdminLayout 卸载时清除 sessionStorage 计数", () => {
      setUser(null);
      sessionStorage.setItem("admin_layout_refreshes", "1");
      const { unmount } = render(<AdminLayout>children</AdminLayout>);
      // 守护态：effect body 不清除，但 cleanup 已注册
      expect(sessionStorage.getItem("admin_layout_refreshes")).toBe("1");
      unmount();
      expect(sessionStorage.getItem("admin_layout_refreshes")).toBeNull();
    });

    it("member 用户访问 /admin 卸载后也清除计数（避免跨会话残留）", () => {
      setUser(memberUser);
      sessionStorage.setItem("admin_layout_refreshes", "1");
      const { unmount } = render(<AdminLayout>children</AdminLayout>);
      unmount();
      expect(sessionStorage.getItem("admin_layout_refreshes")).toBeNull();
    });
  });

  // ==========================================
  // adversary 验证：timer 清理与幂等性
  // ==========================================
  describe("timer 清理", () => {
    it("user 加载成 admin 后 reloadTimer 被清理，不再触发 reload", () => {
      vi.useFakeTimers();
      setUser(null);
      sessionStorage.setItem("admin_layout_refreshes", "0");
      const { rerender } = render(<AdminLayout>children</AdminLayout>);
      // 推进 4s（未到 5s 阈值）
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      expect(reloadSpy).not.toHaveBeenCalled();
      // user 加载为 admin
      setUser(adminUser);
      rerender(<AdminLayout>children</AdminLayout>);
      // 推进 2s（累计 6s，超过原始 5s 阈值）
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(reloadSpy).not.toHaveBeenCalled();
    });

    it("user 从 null 变为 member（非 admin）时 reloadTimer 被清理", () => {
      vi.useFakeTimers();
      setUser(null);
      sessionStorage.setItem("admin_layout_refreshes", "0");
      const { rerender } = render(<AdminLayout>children</AdminLayout>);
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      expect(reloadSpy).not.toHaveBeenCalled();
      // user 变为 member：isGuarding 仍为 true，但 isLoading 变 false
      setUser(memberUser);
      rerender(<AdminLayout>children</AdminLayout>);
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(reloadSpy).not.toHaveBeenCalled();
      // 非加载态不启动 timer，sessionStorage 计数不应被 +1
      expect(sessionStorage.getItem("admin_layout_refreshes")).toBe("0");
    });

    it("isGuarding true→false 切换时 removeItem 幂等无副作用", () => {
      vi.useFakeTimers();
      setUser(null);
      sessionStorage.setItem("admin_layout_refreshes", "1");
      const { rerender } = render(<AdminLayout>children</AdminLayout>);
      // 切换到 admin（isGuarding: true→false）
      setUser(adminUser);
      rerender(<AdminLayout>children</AdminLayout>);
      // sessionStorage 应被清除（cleanup + body 两次 removeItem，幂等）
      expect(sessionStorage.getItem("admin_layout_refreshes")).toBeNull();
      // 再次切回守护态并设置计数
      setUser(null);
      rerender(<AdminLayout>children</AdminLayout>);
      sessionStorage.setItem("admin_layout_refreshes", "1");
      // 再次切换到 admin
      setUser(adminUser);
      rerender(<AdminLayout>children</AdminLayout>);
      expect(sessionStorage.getItem("admin_layout_refreshes")).toBeNull();
    });
  });

  // ==========================================
  // 语义 token 类断言（亮/暗双模式通用）
  // ==========================================
  describe("语义 token 类", () => {
    it("守护页根容器使用 text-text-muted 语义类", () => {
      setUser(null);
      render(<AdminLayout>children</AdminLayout>);
      const guardDiv = screen.getByText("正在加载用户…").closest("div");
      expect(guardDiv).toHaveClass("text-text-muted");
    });

    it("加载失败 UI 使用 text-danger / text-text-subtle 语义类", () => {
      vi.useFakeTimers();
      setUser(null);
      sessionStorage.setItem("admin_layout_refreshes", "2");
      render(<AdminLayout>children</AdminLayout>);
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.getByText("加载失败")).toHaveClass("text-danger");
      expect(screen.getByText("多次自动刷新仍未成功")).toHaveClass("text-text-subtle");
    });

    it("重试按钮使用 bg-primary / text-primary-foreground 语义类", () => {
      vi.useFakeTimers();
      setUser(null);
      sessionStorage.setItem("admin_layout_refreshes", "2");
      render(<AdminLayout>children</AdminLayout>);
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      const retryBtn = screen.getByRole("button", { name: "重试" });
      expect(retryBtn).toHaveClass("bg-primary");
      expect(retryBtn).toHaveClass("text-primary-foreground");
    });

    it("加载较久提示使用 text-text-subtle 语义类", () => {
      vi.useFakeTimers();
      setUser(null);
      render(<AdminLayout>children</AdminLayout>);
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(screen.getByText("加载较久，即将自动刷新页面…")).toHaveClass("text-text-subtle");
    });
  });
});

// ==========================================
// 顶栏的**渲染**：左槽抢占 与 hideBackButton 的重载
// ==========================================
//
// ⚠️ 这一组是**补出来的**，不是锦上添花。
//
// 本文件此前每一次渲染传的 children 都是裸字符串或裸 div，**没有任何东西去 setTitle**
// ⇒ `title` 恒为 ""、`hasTitle` 恒为 false。于是 `AdminHeader` 里「有标题」的那几支
// 从来没有被渲染过 —— 包括新增的 `headerLeft` 抢占分支。
// 实测：把左槽改回让「返回」优先（`headerLeft` 不再抢占），全量测试**照样全绿**。
//
// 探针子组件通过 `useAdminPageHeader()` 真的去设置状态（那个 context 在本文件里
// **没有**被 mock），所以渲染出来的是真实顶栏。
// ⚠️ 传进去的 ReactNode 必须是**模块级常量**：每次渲染新建元素的话，探针 effect 的
// 依赖每轮都变 → 无限重渲染（本仓踩过，症状是 vitest worker 约 90 秒后 V8 fatal）。

const LEFT_SLOT = <span data-testid="left-slot">退出登录</span>;
const RIGHT_SLOT = <span data-testid="right-slot">新增</span>;

function HeaderSetter({
  title,
  left,
  right,
  hideBack,
}: {
  title?: string;
  left?: ReactNode;
  right?: ReactNode;
  hideBack?: boolean;
}) {
  const { setTitle, setHeaderLeft, setHeaderRight, setHideBackButton } = useAdminPageHeader();
  useEffect(() => {
    if (title !== undefined) setTitle(title);
    if (left !== undefined) setHeaderLeft(left);
    if (right !== undefined) setHeaderRight(right);
    if (hideBack !== undefined) setHideBackButton(hideBack);
  }, [title, left, right, hideBack, setTitle, setHeaderLeft, setHeaderRight, setHideBackButton]);
  return null;
}

describe("顶栏渲染：左槽抢占与 hideBackButton 的重载", () => {
  const renderHeader = (props: Parameters<typeof HeaderSetter>[0]) => {
    setUser(adminUser);
    pathState.current = "/admin/sheet-music";
    render(
      <AdminLayout>
        <HeaderSetter {...props} />
      </AdminLayout>,
    );
  };

  it("设了 headerLeft ⇒ 左槽是它，且「返回」不渲染", () => {
    renderHeader({ title: "谱务管理", left: LEFT_SLOT, right: RIGHT_SLOT });

    expect(screen.getByTestId("left-slot")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "返回" })).not.toBeInTheDocument();
  });

  it("没设 headerLeft ⇒ 仍是「返回」（本次改动的另一半：不回归）", () => {
    renderHeader({ title: "谱务管理", right: RIGHT_SLOT });

    expect(screen.getByRole("button", { name: "返回" })).toBeInTheDocument();
    expect(screen.queryByTestId("left-slot")).not.toBeInTheDocument();
  });

  it("⚠️ hideBackButton 同时驱动右槽：置 true 会把 headerRight 换成设置齿轮", () => {
    renderHeader({ title: "谱务管理", left: LEFT_SLOT, right: RIGHT_SLOT, hideBack: true });

    // 这条钉的是本次栽过的那个坑：左槽已被 headerLeft 抢占，所以 hideBackButton
    // 对**左侧**零作用；但它同时是右槽的判据，于是「新增」被换成设置齿轮，
    // 而齿轮指向 /admin/profile —— 对 score_manager 越界，等于换个死按钮。
    expect(screen.queryByTestId("right-slot")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "设置" })).toBeInTheDocument();
    // 左槽不受 hideBackButton 影响
    expect(screen.getByTestId("left-slot")).toBeInTheDocument();
  });

  it("hideBackButton 为 false ⇒ 右槽是 headerRight（页面的实际状态）", () => {
    renderHeader({ title: "谱务管理", left: LEFT_SLOT, right: RIGHT_SLOT, hideBack: false });

    expect(screen.getByTestId("right-slot")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "设置" })).not.toBeInTheDocument();
  });
});
