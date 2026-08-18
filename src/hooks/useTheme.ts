"use client";

import React from "react";
import {
  THEME_STORAGE_KEY,
  applyThemeMode,
  getSystemDark,
  isThemePreference,
  readStoredTheme,
  resolveTheme,
  writeThemePreference,
} from "@/lib/theme";
import type { ThemePreference } from "@/lib/theme";

/**
 * 主题状态 hook（Issue #203，含对抗返工三项加固）：
 * - preference：用户三态选择（亮色 / 暗色 / 跟随系统），默认 system（无存储时跟随系统，
 *   与首帧脚本决策一致，见 src/lib/theme.ts）
 * - mode：实际生效的亮/暗（system 时由系统偏好解析）
 * - hydrated gate（对抗返工）：首次应用完全交给首帧脚本，防止挂载时序中间态——
 *   「读存储 setState 排队（未生效）→ 应用 effect 用初始 preference=system 解析」
 *   会把首帧脚本按存储设置的正确 data-theme 短暂覆盖（如存储 dark + 系统亮色时
 *   先闪亮色再回暗色）。gate 下应用 effect 在 hydrated=false 时直接 return，
 *   待存储读取 flush 后 mode 已是最终值，应用幂等且与首帧一致。
 * - 生命周期：preference 为 system 时挂 matchMedia change 监听实时跟随系统，
 *   切到 light/dark 时 effect 清理自动移除监听；matchMedia 或 addEventListener
 *   缺失（旧浏览器）时放弃实时跟随不抛错；另挂 storage 事件监听同步多标签页。
 * - 持久化：用户显式选择（含 system）即时写入 localStorage，未选择过则存储保持为空。
 */
export function useTheme() {
  // 初始为 system：SSR 期间不能读 localStorage，统一在挂载 effect 中读取覆盖
  const [preference, setPreferenceState] = React.useState<ThemePreference>("system");
  const [systemDark, setSystemDark] = React.useState<boolean>(() => getSystemDark());
  // 挂载完成标记：false 时应用 effect 不碰 DOM（首帧脚本已按同一规则预置）
  const [hydrated, setHydrated] = React.useState(false);
  const mode = resolveTheme(preference, systemDark);

  // 挂载后读取存储偏好覆盖默认值（仅客户端执行）。
  // 必须在 effect 内同步读取存储：SSR 期间没有 localStorage；若用 useState lazy initializer，
  // 客户端 hydration 首渲染会与服务器输出（默认 system）不一致，引发 hydration mismatch
  // （Toggle 选中态入 DOM）。本 effect 与下一 effect 共享同一 flush：setPreferenceState 与
  // setHydrated 一起排队，下一 effect 首次执行时 hydrated 仍为 false（见 hydrated gate 注释）
  React.useEffect(() => {
    const stored = readStoredTheme();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored) setPreferenceState(stored);
    setHydrated(true);
  }, []);

  // 应用模式到 <html>（幂等：与首帧脚本共享同一解析规则，值一致，重复设置无副作用）。
  // hydrated=false（首帧与挂载之间的窗口）时不应用——首次应用完全交给首帧脚本
  React.useEffect(() => {
    if (!hydrated) return;
    applyThemeMode(mode);
  }, [mode, hydrated]);

  // system 模式下监听系统外观变化实时跟随；切到 light/dark 时清理移除监听
  React.useEffect(() => {
    if (preference !== "system") return;
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    // 老浏览器（iOS Safari <14 等）MediaQueryList 无 addEventListener（只有 addListener）：
    // 放弃实时跟随，仅按挂载时解析结果生效，不抛错
    if (typeof mql.addEventListener !== "function") return;
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [preference]);

  // 多标签页同步（对抗返工）：其他标签页写入/变更主题偏好时 storage 事件触发，
  // 同步本页 preference；同页自身写入不触发 storage 事件（无自环）。
  // removeItem（newValue 为 null）时保持当前选择，不回落 system
  React.useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key !== THEME_STORAGE_KEY) return;
      if (isThemePreference(e.newValue)) setPreferenceState(e.newValue);
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  /** 切换偏好：即时更新状态 + 生效 + 持久化（显式选择，含 system） */
  const setPreference = React.useCallback((value: ThemePreference) => {
    setPreferenceState(value);
    writeThemePreference(value);
  }, []);

  return { preference, mode, setPreference };
}
