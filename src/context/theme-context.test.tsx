// @vitest-environment jsdom

import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { ThemeProvider, useThemeContext } from "./theme-context";
import { THEME_STORAGE_KEY } from "@/lib/theme";

// 全局主题 Provider（对抗返工 Issue #203）：全站共享一份主题状态。
// jsdom 无 matchMedia，无需 mock——useTheme 内部有守卫，Provider 正常挂载。
describe("ThemeContext（全局主题状态）", () => {
  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("Provider 内 useThemeContext 返回共享的主题状态（默认无存储 → 跟随系统）", () => {
    const { result } = renderHook(() => useThemeContext(), { wrapper: ThemeProvider });
    expect(result.current.preference).toBe("system");
    expect(typeof result.current.setPreference).toBe("function");
  });

  it("通过 Provider 切换主题：共享状态更新并持久化（消费方无需各自挂载监听）", () => {
    const { result } = renderHook(() => useThemeContext(), { wrapper: ThemeProvider });
    act(() => result.current.setPreference("dark"));
    expect(result.current.preference).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("Provider 外使用 useThemeContext 抛错（尽早暴露接线错误）", () => {
    expect(() => renderHook(() => useThemeContext())).toThrow(
      "useThemeContext 必须在 ThemeProvider 内部使用",
    );
  });
});
