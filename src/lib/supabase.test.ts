import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 守的是「**缺 env 时 import 不能抛**」这一条。
 *
 * 为什么它值得一条测试：本模块在模块作用域建客户端，而 Next 会把客户端组件也预渲染
 * 一遍（服务端要走一遍模块图）。所以「import 就抛」的后果不是某个功能不可用，
 * 而是**整个构建挂掉**。实测 2026-09-29（把 .env.local 移开跑 `pnpm build`）：
 *
 *     Error occurred prerendering page "/reset-password/reset"  → supabaseUrl is required.
 *     Error occurred prerendering page "/admin/rehearsals"      → 同样在炸
 *
 * ⚠️ 别把这条测试删成「只测有 env 的情况」——有 env 时本来就不会出事，
 *    出事的永远是没 env 的那条路（构建机、Dependabot 的 PR）。
 */
describe("supabase 客户端模块：缺 env 的行为", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const withoutEnv = () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
  };

  it("缺 env 时 **import 本身不抛**（预渲染能过的前提）", async () => {
    withoutEnv();

    // 这一行就是断言本身：它抛的话，任何预渲染到本模块的页面都会让构建失败。
    const mod = await import("./supabase");

    expect(mod.hasSupabaseEnv).toBe(false);
  });

  it("缺 env 时**取用**才抛，且抛的是能读懂的那句", async () => {
    withoutEnv();
    const { supabase } = await import("./supabase");

    // 不是 SDK 内部那句 `supabaseUrl is required.`
    expect(() => supabase.from("profiles")).toThrow(/缺少 NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("只缺一半也算缺（两个都要有）", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");

    const mod = await import("./supabase");
    expect(mod.hasSupabaseEnv).toBe(false);
  });

  it("有 env 时拿到的是**真客户端**，不是替身", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");

    const mod = await import("./supabase");

    expect(mod.hasSupabaseEnv).toBe(true);
    expect(typeof mod.supabase.from).toBe("function");
    expect(typeof mod.supabase.auth.getSession).toBe("function");
  });
});
