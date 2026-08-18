"use client";

import React from "react";
import { useTheme } from "@/hooks/useTheme";

export type ThemeContextValue = ReturnType<typeof useTheme>;

const ThemeContext = React.createContext<ThemeContextValue | undefined>(undefined);

/**
 * 全局主题 Provider（对抗返工 Issue #203）：主题是整站功能，由根 layout 挂载，
 * 全站共享一份主题状态与 matchMedia/storage 监听。若只在 profile 外观弹窗内挂载，
 * 默认（无存储 = 跟随系统）用户在其他页面打开期间系统外观变化将无法实时跟随
 * （监听随弹窗组件卸载而消失）。
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const value = useTheme();
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeContext() {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useThemeContext 必须在 ThemeProvider 内部使用");
  }
  return ctx;
}
