/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UserProvider, useUser } from "./user-context";

/**
 * `logout()` 与 `signOut()` 的**分工**测试。
 *
 * 为什么值得单独守：这两个名字几乎同义，而**用错哪一个的后果是静默的**。
 *
 * - 拿 `logout()` 当退出登录：界面正常跳回 `/login`，**看着像退了**。但 Supabase 会话
 *   仍在浏览器里（`useAuth` 的 `client.auth.getSession()` 读的就是它），按浏览器后退、
 *   或直接再进 `/admin/**` 就免密回去了。路由守卫（`auth-gate.tsx`）只看 `sessionUserId`，
 *   **不看** `useUser().user`，所以它拦不住 —— 这条链在 2026-09-29 实测确认过。
 * - 反过来，**把 signOut 接进 `logout()` 也是错的**：`useAuth` 在「本来就没有 session」
 *   时也调 `onClearProfile` → `logout()`（那个 effect 的 `if (!sessionUserId)` 分支），
 *   在那里发一次登出是多余的。所以本文件的第二条用例守的是「**不要**做那件事」。
 *
 * 这也是本仓第一次有 `user-context` 的测试文件。
 */

const h = vi.hoisted(() => ({
  // ⚠️ 默认实现必须返回真实的成功形状 `{ data, error }`。
  // 空 `vi.fn()` 返回 `undefined`，于是 `const { error } = await supabase.auth.signOut()`
  // 会抛 TypeError 走进 **catch** —— 「成功路径」一次都没被走过，而且每跑一次测试
  // 就往 stderr 打一行。这是复审抓出来的。
  // `error` 显式写成 `unknown`：不写的话 TS 会从基础实现把它收窄成字面量 `null`，
  // 下面 `mockResolvedValueOnce({ …, error: new Error(…) })` 就编译不过（闸门的 tsc 抓的）。
  signOut: vi.fn(async (): Promise<{ data: null; error: unknown }> => ({
    data: null,
    error: null,
  })),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { signOut: h.signOut } },
}));

function Probe() {
  const { user, login, logout, signOut } = useUser();
  return (
    <div>
      <span data-testid="user">{user ? user.name : "（空）"}</span>
      <button onClick={() => login({ id: "u1", name: "张三", role: "admin", section: "一提" })}>
        登录
      </button>
      <button onClick={() => logout()}>清态</button>
      <button onClick={() => void signOut()}>登出</button>
    </div>
  );
}

/** 渲染并先登入，返回时用户态是「张三」 */
const renderLoggedIn = () => {
  render(
    <UserProvider>
      <Probe />
    </UserProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "登录" }));
  expect(screen.getByTestId("user")).toHaveTextContent("张三");
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("user-context：logout 与 signOut 的分工", () => {
  it("signOut() 成功：结束会话 + 清空用户态，且**不记日志**", async () => {
    // ⚠️ 「不记日志」那一条把**成功路径**钉住了。少了它，桩返回什么都无所谓：
    // 若桩返回 `undefined`，`const { error } = …` 会抛进 catch，而其余断言照样过
    // —— 复审抓到的正是这个（当时成功路径一次都没被走过，还每次往 stderr 打一行）。
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderLoggedIn();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "登出" }));
    });

    expect(h.signOut).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("user")).toHaveTextContent("（空）");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("logout()：**不碰** Supabase 会话（useAuth 在本来就没有 session 时也调它）", async () => {
    renderLoggedIn();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "清态" }));
    });

    // ⚠️ 这条守的是「不要做」：谁要是「顺手」把 signOut 接进 logout，
    // `useAuth` 那条 `if (!sessionUserId)` 的分支就会每次挂载都发一次登出。
    expect(h.signOut).not.toHaveBeenCalled();
    expect(screen.getByTestId("user")).toHaveTextContent("（空）");
  });

  it("signOut **返回** { error }（真链路上的失败形态）时：记日志 + 清态", async () => {
    // ⚠️ 这条才是真实失败形态，别拿下面那条 reject 用例替代它。
    // 现装版本（`@supabase/auth-js` 2.117.2）对**鉴权/网络失败**是 `return { error }`
    // 而**不是** throw：`GoTrueAdminApi.signOut` 把 AuthError 转成返回值，而
    // `_returnResult` 只在 `throwOnError` 为真时才抛，本项目 `createClient` 没开。
    // 所以「只包 try/catch、不看返回值」的实现会在这条路上**一行日志都没有** ——
    // 首版就是这么写的，是合规审查与对抗测试各自独立指出来的。
    h.signOut.mockResolvedValueOnce({ data: null, error: new Error("500") });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderLoggedIn();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "登出" }));
    });

    expect(spy).toHaveBeenCalled();
    expect(screen.getByTestId("user")).toHaveTextContent("（空）");
    spy.mockRestore();
  });

  it("signOut **抛出**异常（非 AuthError，例如 storage 访问失败）时：也清态且不往外抛", async () => {
    // ⚠️ 别拿「网络中断」当这里的例子：它抛的是 `AuthRetryableFetchError`，
    // 而那是 AuthError 的子类 ⇒ 走上面那条「返回 { error }」的路，不抛。
    // 调用方是 `void signOut()`，抛出去就是一条无人处理的 rejection。
    // 不清态的话界面会停在「已登录」，而调用方已经把人送到 /login 了。
    h.signOut.mockRejectedValueOnce(new Error("network down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderLoggedIn();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "登出" }));
    });

    expect(screen.getByTestId("user")).toHaveTextContent("（空）");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
