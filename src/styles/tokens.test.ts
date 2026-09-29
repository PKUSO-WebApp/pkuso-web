import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 守着「令牌的两份手写清单不许漂移」。
 *
 * ## 为什么需要它
 *
 * web 的令牌是**两份手写清单**：
 *
 * | 文件 | 角色 |
 * | --- | --- |
 * | `src/styles/tokens.css` | **值** —— `:root` 46 个、`[data-theme="dark"]` 26 个 |
 * | `src/app/globals.css` 的 `@theme inline` | **注册**成 Tailwind 工具类的 23 个名字 |
 *
 * `tokens.css` 自称「单一可信源」，但**「能当类名用的清单」实际在 `globals.css`**。
 * 两份都是手写的，于是会漂移，而且**漂移是静默的**：在 `tokens.css` 改个名字、
 * 忘了同步 `globals.css`，那个类就再也生成不出来 —— 用了它的地方**不会报错**，
 * 只是没有样式。
 *
 * 同一个形态在小程序端**已经真的发生过**：`pkuso-mp` 有 8 处在用 `text-label`，
 * 而那份 `app.css` 里没有 `--text-label` ⇒ 构建产物里 0 命中、文字按继承字号渲染。
 *
 * ## 它**不**覆盖什么（别过度解读）
 *
 * 只查「注册 → 定义」这一个方向。**反方向查不了**：`tokens.css` 里新增一个变量
 * 而忘了注册，本文件不会红 —— 因为「哪些变量本来就该是工具类」是一个**意图**，
 * 文件里没有标记可循（`--radius-*` 覆盖 Tailwind 默认阶梯、`--z-*` 只给专用类用，
 * 它们按设计就**不该**注册）。要覆盖那个方向得先引进一个标记，那是另一个决定。
 */

const GLOBALS = "src/app/globals.css";
const TOKENS = "src/styles/tokens.css";

const read = (p: string) => readFileSync(p, "utf8");

/** 取出某个 at-rule / 选择器块的内容（靠大括号配对，不引 CSS 解析器） */
function blockOf(css: string, header: RegExp): string {
  const m = header.exec(css);
  if (!m) throw new Error(`找不到块：${header}`);
  const start = css.indexOf("{", m.index);
  let depth = 0;
  for (let i = start; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(start + 1, i);
    }
  }
  throw new Error(`块没有闭合：${header}`);
}

/** 块里所有自定义属性的声明：名字 → 值 */
function declarations(block: string): Map<string, string> {
  const out = new Map<string, string>();
  // 只认行首的声明，避开值里出现的 var(...)
  for (const m of block.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gim)) {
    out.set(m[1], m[2].trim());
  }
  return out;
}

describe("设计令牌：注册清单与值清单的一致性", () => {
  const globals = read(GLOBALS);
  const tokens = read(TOKENS);
  const registered = declarations(blockOf(globals, /@theme\b/));
  const definedInRoot = declarations(blockOf(tokens, /:root\b/));

  it("两份清单都真的解析到了内容（防夹具空转）", () => {
    // 少了这条：解析器写坏时两个 Map 都空，下面的断言会「全部通过」
    expect(registered.size).toBeGreaterThan(10);
    expect(definedInRoot.size).toBeGreaterThan(20);
  });

  it("`@theme` 里注册的每个名字，都能在 tokens.css 的 :root 找到定义", () => {
    // `--font-*` 豁免，理由具体：它们的值指向 `next/font` 注入的 `--font-geist-*`，
    // **本来就不由 tokens.css 提供**（见 globals.css 里那两行）。
    // 若将来多出别的豁免，这条会红 —— 那是**有意的**：逼你说明为什么它不是令牌。
    const exempt = (name: string) => name.startsWith("--font-");
    const missing = [...registered.keys()].filter(
      (name) => !exempt(name) && !definedInRoot.has(name),
    );

    expect(
      missing,
      `globals.css 注册了这些名字，但 tokens.css 的 :root 里没有定义 —— ` +
        `用了对应工具类的地方会**静默没有样式**：${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("`@theme` 里注册的每个 `--color-*` 都是自指的（防止复制粘贴指错颜色）", () => {
    // `@theme inline` 的写法是 `--color-x: var(--color-x)` —— 自指，把 tokens.css 的值
    // 接进 Tailwind 的主题层。写成 `--color-danger: var(--color-warning)` 也能跑，
    // 但 `bg-danger` 会渲染成警告色，**而且是静默的**（类名存在、值是错的）。
    const wrong = [...registered.entries()]
      .filter(([name]) => name.startsWith("--color-"))
      .filter(([name, value]) => value !== `var(${name})`)
      .map(([name, value]) => `${name} = ${value}`);

    expect(wrong, `这些注册不是自指的，类名会指向别的令牌：\n${wrong.join("\n")}`).toEqual([]);
  });
});
