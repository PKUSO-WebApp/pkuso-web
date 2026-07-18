import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("vitest 运行正常", () => {
    expect(1 + 1).toBe(2);
  });

  it("@ 路径别名可解析(不依赖运行时环境变量)", async () => {
    const mod = await import("@/lib/supabase-server");
    expect(typeof mod.createServerSupabase).toBe("function");
  });
});
