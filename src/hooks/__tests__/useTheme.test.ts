// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useTheme } from "../useTheme";
import * as themeLib from "@/lib/theme";
import { THEME_STORAGE_KEY } from "@/lib/theme";

// 部分 mock：applyThemeMode 包一层 vi.fn 并转发真实实现——
// 既能断言 html 属性（真实副作用），又能检查调用序列（hydrated gate 拦截中间态）。
// 其余导出（常量/纯函数）原样透传，行为与生产一致
vi.mock("@/lib/theme", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/theme")>();
  return {
    ...actual,
    applyThemeMode: vi.fn((mode: themeLib.ThemeMode) => actual.applyThemeMode(mode)),
  };
});

const applyThemeModeMock = vi.mocked(themeLib.applyThemeMode);

/**
 * matchMedia mock：jsdom 未实现 matchMedia，须 mock。
 * 返回的 setSystemDark 可模拟系统外观变化（触发已注册的 change 监听器）。
 */
function mockMatchMedia(initialDark: boolean) {
  const listeners = new Set<(e: { matches: boolean }) => void>();
  const mql = {
    matches: initialDark,
    media: "(prefers-color-scheme: dark)",
    addEventListener: vi.fn((_type: string, cb: (e: { matches: boolean }) => void) => {
      listeners.add(cb);
    }),
    removeEventListener: vi.fn((_type: string, cb: (e: { matches: boolean }) => void) => {
      listeners.delete(cb);
    }),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => mql),
  );
  return {
    mql,
    /** 模拟系统外观切换：更新 matches 并触发所有已注册监听器 */
    setSystemDark: (dark: boolean) => {
      mql.matches = dark;
      for (const cb of [...listeners]) cb({ matches: dark });
    },
  };
}

describe("useTheme", () => {
  beforeEach(() => {
    vi.clearAllMocks(); // 清空 applyThemeMode 调用记录，保证每用例独立
    window.localStorage.clear();
  });

  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
    vi.unstubAllGlobals();
  });

  it("默认（无存储）跟随系统：preference=system，mode 由系统偏好解析", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe("system");
    expect(result.current.mode).toBe("dark");
    // hydrated gate 放行后把模式应用到 html
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("挂载时读取存储偏好（dark）→ preference 变为 dark", async () => {
    mockMatchMedia(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const { result } = renderHook(() => useTheme());
    await waitFor(() => expect(result.current.preference).toBe("dark"));
    expect(result.current.mode).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("setPreference('light') → localStorage 写入 + html 移除 data-theme", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setPreference("light"));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(result.current.preference).toBe("light");
    expect(result.current.mode).toBe("light");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("setPreference('dark') → localStorage 写入 + html 设置 data-theme=dark", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setPreference("dark"));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("system 模式下系统外观变化实时跟随：mode 与 html 属性随之变化", () => {
    const { setSystemDark } = mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe("light");
    act(() => setSystemDark(true));
    expect(result.current.mode).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("切到 light/dark 后移除 matchMedia 监听，系统外观变化不再影响", () => {
    const { mql, setSystemDark } = mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(mql.addEventListener).toHaveBeenCalledTimes(1);
    act(() => result.current.setPreference("dark"));
    expect(mql.removeEventListener).toHaveBeenCalledTimes(1);
    // 监听已移除：系统外观变化不再触发 state 更新，mode 保持显式偏好
    act(() => setSystemDark(true));
    expect(result.current.mode).toBe("dark");
  });

  it("从 light/dark 切回 system：重新挂上监听并立即按当前系统偏好解析", () => {
    const { mql, setSystemDark } = mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setPreference("dark"));
    expect(mql.removeEventListener).toHaveBeenCalledTimes(1);
    act(() => result.current.setPreference("system"));
    expect(mql.addEventListener).toHaveBeenCalledTimes(2);
    expect(result.current.preference).toBe("system");
    // 重新跟随：系统切暗色后 mode 变为 dark
    act(() => setSystemDark(true));
    expect(result.current.mode).toBe("dark");
  });

  it("matchMedia 不存在（旧浏览器）时不挂监听，hook 正常工作不抛错", () => {
    vi.stubGlobal("matchMedia", undefined);
    const { result } = renderHook(() => useTheme());
    // matchMedia 缺失按亮色处理，preference 保持默认 system
    expect(result.current.mode).toBe("light");
    act(() => result.current.setPreference("dark"));
    expect(result.current.mode).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  // ============================================================
  // 对抗返工 Issue #203：hydrated gate / 老浏览器守卫 / 多标签页同步
  // ============================================================
  it("首帧脚本已预置时挂载不产生中间态覆盖（存储 dark + 系统亮色，对抗击破复现）", () => {
    mockMatchMedia(false); // 系统亮色
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark"); // 用户显式偏好暗色
    document.documentElement.setAttribute("data-theme", "dark"); // 模拟首帧脚本已按存储预置
    const { result } = renderHook(() => useTheme());
    // 挂载后仍是首帧值：未被「初始 preference=system + 系统亮色」解析出的 light 覆盖
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(result.current.mode).toBe("dark");
    // 应用 effect 从未收到 light（hydrated gate 拦截了中间态；旧实现此序列为 ["light","dark"]）
    expect(applyThemeModeMock.mock.calls.map((c) => c[0])).toEqual(["dark"]);
  });

  it("matchMedia 存在但无 addEventListener（iOS Safari <14 等老浏览器）→ 放弃实时跟随不抛错", () => {
    // 老式 MediaQueryList：只有 addListener 没有 addEventListener
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false, addListener: vi.fn() })),
    );
    const { result } = renderHook(() => useTheme());
    // 挂载与切换均不抛错，按挂载时解析结果生效
    expect(result.current.preference).toBe("system");
    expect(result.current.mode).toBe("light");
    act(() => result.current.setPreference("dark"));
    expect(result.current.mode).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("其他标签页写入主题偏好时经 storage 事件同步（多标签页一致）", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe("system");
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: THEME_STORAGE_KEY, newValue: "light" }),
      );
    });
    expect(result.current.preference).toBe("light");
    expect(result.current.mode).toBe("light");
    // 同步后按新偏好生效
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("storage 事件只响应主题键：其他键写入不影响主题状态", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "other-key", newValue: "x" }));
    });
    expect(result.current.preference).toBe("system");
  });

  it("storage 事件值为非法/清空（removeItem）时保持当前选择，不回落 system", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setPreference("dark"));
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: THEME_STORAGE_KEY, newValue: null }));
    });
    expect(result.current.preference).toBe("dark");
  });
});
