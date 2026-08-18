// 主题机制（Issue #203）：亮色 / 暗色 / 跟随系统 三态切换
//
// 设计决策：
// - 存储键 THEME_STORAGE_KEY（pkuso-theme），值 "light" | "dark" | "system"。
//   用户显式选择（含选择「跟随系统」）才写入 localStorage；未选择过则存储为空。
// - 默认（无存储）跟随系统：首访用户不打扰、与设备外观一致；
//   首次访问不写存储，避免把「默认值」固化成用户偏好。
// - 解析规则唯一来源 resolveTheme（存储值 + 系统偏好 → 最终亮/暗）：
//   useTheme 与首帧脚本（THEME_INIT_SCRIPT）共用同一套决策，防止两侧行为不一致。
// - 生效方式：<html> 上设置 / 移除 data-theme="dark"（tokens.css 的暗色模式选择器）。
// - 容错：localStorage / matchMedia 不可用（隐私模式、旧浏览器、SSR）时降级为
//   默认亮色，任何异常都被捕获，不阻断页面。

export const THEME_STORAGE_KEY = "pkuso-theme";

/** 用户三态选择：亮色 / 暗色 / 跟随系统 */
export type ThemePreference = "light" | "dark" | "system";

/** 实际生效的模式（跟随系统解析后的最终结果） */
export type ThemeMode = "light" | "dark";

/** 三态选项（供 Toggle 分段控件使用） */
export const THEME_OPTIONS: readonly ThemePreference[] = ["light", "dark", "system"];

/** 选项中文文案 */
export const themeLabel = (v: ThemePreference): string =>
  v === "dark" ? "暗色" : v === "light" ? "亮色" : "跟随系统";

export const isThemePreference = (v: unknown): v is ThemePreference =>
  v === "light" || v === "dark" || v === "system";

/**
 * 核心解析规则：给定存储偏好 + 系统暗色偏好 → 最终亮/暗。
 * 无存储（null / undefined，即默认）按跟随系统处理——与首帧脚本逻辑保持一致。
 */
export function resolveTheme(
  preference: ThemePreference | null | undefined,
  systemDark: boolean,
): ThemeMode {
  if (preference === "light") return "light";
  if (preference === "dark") return "dark";
  return systemDark ? "dark" : "light";
}

/**
 * 读取存储偏好；localStorage 不可用或值为非法时返回 null（调用方按默认 system 处理）。
 * @param storage 可注入的存储对象（测试用）；不传时用 window.localStorage（SSR 下为空）
 */
export function readStoredTheme(storage?: Storage | null): ThemePreference | null {
  try {
    const store = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
    const raw = store?.getItem(THEME_STORAGE_KEY);
    return isThemePreference(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** 写入存储偏好；localStorage 不可用（隐私模式等）时静默跳过，仅当前会话生效 */
export function writeThemePreference(value: ThemePreference): void {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(THEME_STORAGE_KEY, value);
  } catch {
    // localStorage 不可用：不持久化，本次选择仍即时生效
  }
}

/** 系统是否为暗色偏好；matchMedia 不存在（旧浏览器/SSR）时按亮色处理 */
export function getSystemDark(): boolean {
  try {
    return (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    );
  } catch {
    return false;
  }
}

/** 应用模式到 <html>：dark 设置 data-theme="dark"，light 移除属性（tokens.css 暗色选择器） */
export function applyThemeMode(mode: ThemeMode): void {
  const root = typeof document !== "undefined" ? document.documentElement : null;
  if (!root) return;
  if (mode === "dark") root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");
}

/**
 * 首帧防闪烁脚本（供根 layout <head> 内联，内容渲染前预置 data-theme，
 * 防止暗色用户白屏闪烁——useEffect 时机太晚，须在 HTML 解析阶段执行）。
 * 与 useTheme 共享决策：无存储 → 跟随系统；脚本自包含且幂等（重复执行无副作用）；
 * localStorage / matchMedia 不可用时 try/catch 静默跳过，走 CSS 默认亮色。
 */
export const THEME_INIT_SCRIPT = `(function () {
  try {
    var raw = window.localStorage.getItem("pkuso-theme");
    var pref = raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
    var isDark = pref === "dark" || (pref === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (isDark) {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  } catch (e) {
    // localStorage / matchMedia 不可用时跳过，按 CSS 默认（亮色）渲染
  }
})();`;
