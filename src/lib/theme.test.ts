import { describe, it, expect, vi, afterEach } from "vitest";
import {
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  applyThemeMode,
  getSystemDark,
  readStoredTheme,
  resolveTheme,
} from "./theme";

describe("resolveTheme（存储偏好 + 系统偏好 → 最终亮/暗）", () => {
  it("system + 系统暗色 → dark", () => {
    expect(resolveTheme("system", true)).toBe("dark");
  });

  it("system + 系统亮色 → light", () => {
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("light 不论系统偏好 → light", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("light", false)).toBe("light");
  });

  it("dark 不论系统偏好 → dark", () => {
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("null（无存储，默认跟随系统）→ 按系统偏好", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
  });

  it("undefined → 按系统偏好", () => {
    expect(resolveTheme(undefined, false)).toBe("light");
    expect(resolveTheme(undefined, true)).toBe("dark");
  });
});

describe("readStoredTheme（容错读取存储偏好）", () => {
  afterEach(() => window.localStorage.clear());

  it("无存储 → null（调用方按默认 system 处理）", () => {
    expect(readStoredTheme(window.localStorage)).toBeNull();
  });

  it("读取合法值", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(readStoredTheme(window.localStorage)).toBe("dark");
  });

  it("非法值 → null", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "blue");
    expect(readStoredTheme(window.localStorage)).toBeNull();
  });

  it("storage 为空（SSR 无 localStorage）→ null", () => {
    expect(readStoredTheme(null)).toBeNull();
  });

  it("getItem 抛错（隐私模式等）→ null 不抛出", () => {
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
    };
    expect(readStoredTheme(throwing as never)).toBeNull();
  });
});

describe("getSystemDark（系统暗色判定，matchMedia 缺失时按亮色）", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("系统暗色 → true", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    expect(getSystemDark()).toBe(true);
  });

  it("系统亮色 → false", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );
    expect(getSystemDark()).toBe(false);
  });

  it("matchMedia 不存在（旧浏览器/SSR）→ false", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(getSystemDark()).toBe(false);
  });

  it("matchMedia 抛错 → false 不抛出", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => {
        throw new Error("unsupported");
      }),
    );
    expect(getSystemDark()).toBe(false);
  });
});

describe("applyThemeMode（html 的 data-theme 属性）", () => {
  afterEach(() => document.documentElement.removeAttribute("data-theme"));

  it("dark → 设置 data-theme=dark", () => {
    applyThemeMode("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("light → 移除 data-theme", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    applyThemeMode("light");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("light 时无属性也不报错（幂等）", () => {
    expect(() => applyThemeMode("light")).not.toThrow();
  });
});

describe("THEME_INIT_SCRIPT（首帧防闪烁脚本）", () => {
  afterEach(() => {
    vi.unstubAllGlobals(); // 先恢复 localStorage 全局（stub 无 clear 方法），再清空
    vi.restoreAllMocks();
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  // 脚本是自包含字符串（内联进 <head>），测试用 new Function 在 jsdom 中执行
  const runInitScript = () => {
    new Function(THEME_INIT_SCRIPT)();
  };

  it("无存储 + 系统暗色 → 预置 data-theme=dark（默认跟随系统）", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    runInitScript();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("无存储 + 系统亮色 → 不设置 data-theme", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );
    runInitScript();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("存储 dark → 预置 data-theme=dark（不论系统偏好）", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    runInitScript();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("存储 light → 移除 data-theme（覆盖上次会话遗留的暗色）", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    document.documentElement.setAttribute("data-theme", "dark");
    runInitScript();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("localStorage 不可用（访问抛错，隐私模式等）→ 静默跳过，不改动属性", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
    });
    document.documentElement.setAttribute("data-theme", "dark");
    runInitScript();
    // 脚本在读取阶段即失败：不改动现有属性
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});
