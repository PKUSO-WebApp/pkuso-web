import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { GET, PUT } from "@/app/api/admin/settings/route";
import { EMAIL_SIGNATURE_KEY } from "@/lib/email-signature";
import type { Database } from "@/types/database.types";

// ============================================================
// GET/PUT /api/admin/settings 端到端测试（需 Supabase service role）
// 参考 notify.test.ts 的端到端模式：临时用户 → 调 handler → 清理。
// 缺少环境变量或测试环境准备失败（网络波动）时整组优雅跳过。
// ============================================================
function envReady(): boolean {
  return !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/** 构造带 Bearer token 的请求 */
function authRequest(token: string, init: RequestInit = {}): Request {
  return new Request("http://localhost/api/admin/settings", {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
}

describe("GET/PUT /api/admin/settings", () => {
  // 认证客户端：仅用于创建测试用户并登录拿 token（会持有 user 会话）
  let authSb: SupabaseClient<Database>;
  // 数据客户端：从不登录，确保所有数据操作都使用 service role key
  // （supabase-js 在存在会话时，PostgREST 请求会用 user JWT 代替 service key，
  //  被 app_settings 的 RLS 拒绝；两个客户端都必须用独立 storageKey，
  //  避免会话泄漏到默认存储键被路由内 createServerSupabase() 读到）
  let dbSb: SupabaseClient<Database>;
  let ready = false;
  let adminToken = "";
  let memberToken = "";
  let adminUserId = "";
  let memberUserId = "";
  // 测试前生产 email_signature 原值（S1 严重项防护）：
  // CI 注入的是共享生产库的 service role key，测试期间会临时改写生产签名行，
  // 必须在 beforeAll 备份、afterAll 恢复，绝不触碰/丢失真实签名数据。
  let originalSignature: string | null = null; // 原值（null = 未设置，无行）
  let signatureWasSet = false; // 原值是否已设置（决定恢复时写回还是删除）

  beforeAll(async () => {
    if (!envReady()) {
      console.log("⚠️ 缺少 Supabase 配置，跳过 settings 端到端测试");
      return;
    }
    try {
      const storageSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      authSb = createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL as string,
        process.env.SUPABASE_SERVICE_ROLE_KEY as string,
        { auth: { storageKey: `settings-auth-${storageSuffix}` } },
      );
      dbSb = createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL as string,
        process.env.SUPABASE_SERVICE_ROLE_KEY as string,
        { auth: { storageKey: `settings-db-${storageSuffix}` } },
      );
      const stamp = Date.now();

      // 0. 先备份生产签名原值（在任何改写前执行；afterAll 据此恢复）
      const orig = await dbSb
        .from("app_settings")
        .select("value")
        .eq("key", EMAIL_SIGNATURE_KEY)
        .maybeSingle();
      if (orig.error) throw new Error(`读取签名原值失败：${orig.error.message}`);
      signatureWasSet = orig.data !== null;
      originalSignature = orig.data?.value ?? null;

      // 1. 创建临时 admin
      const adminEmail = `settings-admin-${stamp}@pkuso.test`;
      const admin = await authSb.auth.admin.createUser({
        email: adminEmail,
        password: `pw-admin-${stamp}`,
        email_confirm: true,
      } as never);
      if (admin.error || !admin.data?.user?.id) throw new Error("无法创建 admin 测试用户");
      adminUserId = admin.data.user.id;
      await dbSb.from("profiles").upsert({
        id: adminUserId,
        email: adminEmail,
        full_name: "Settings Admin",
        status: "approved",
        role: "admin",
      } as never);

      // 2. 创建临时 member（用于 403 用例）
      const memberEmail = `settings-member-${stamp}@pkuso.test`;
      const member = await authSb.auth.admin.createUser({
        email: memberEmail,
        password: `pw-member-${stamp}`,
        email_confirm: true,
      } as never);
      if (member.error || !member.data?.user?.id) throw new Error("无法创建 member 测试用户");
      memberUserId = member.data.user.id;
      await dbSb.from("profiles").upsert({
        id: memberUserId,
        email: memberEmail,
        full_name: "Settings Member",
        status: "approved",
        role: "member",
      } as never);

      // 3. 登录拿 token（仅用于构造 Authorization 头，数据操作一律走 dbSb）
      const adminSession = await authSb.auth.signInWithPassword({
        email: adminEmail,
        password: `pw-admin-${stamp}`,
      });
      if (!adminSession.data.session?.access_token) throw new Error("无法登录 admin 测试用户");
      adminToken = adminSession.data.session.access_token;

      const memberSession = await authSb.auth.signInWithPassword({
        email: memberEmail,
        password: `pw-member-${stamp}`,
      });
      if (!memberSession.data.session?.access_token) throw new Error("无法登录 member 测试用户");
      memberToken = memberSession.data.session.access_token;

      ready = true;
    } catch (err) {
      console.log("⚠️ settings 测试环境准备失败，跳过：", err);
    }
  }, 90000);

  afterAll(async () => {
    if (!ready) return;
    // 恢复生产签名原值：有则写回原值，无则删除。
    // 取代旧的"无条件删除"——旧实现每次 CI 都会清空 admin 设置的真实签名（S1 严重项）。
    try {
      if (signatureWasSet) {
        await dbSb.from("app_settings").upsert({
          key: EMAIL_SIGNATURE_KEY,
          value: originalSignature ?? "",
          updated_at: new Date().toISOString(),
        });
      } else {
        await dbSb.from("app_settings").delete().eq("key", EMAIL_SIGNATURE_KEY);
      }
    } catch {
      // 恢复失败不影响其他用例结果（网络波动时避免误报）
    }
    if (adminUserId) {
      try {
        await dbSb.from("profiles").delete().eq("id", adminUserId);
        await authSb.auth.admin.deleteUser(adminUserId);
      } catch {
        // 忽略清理错误
      }
    }
    if (memberUserId) {
      try {
        await dbSb.from("profiles").delete().eq("id", memberUserId);
        await authSb.auth.admin.deleteUser(memberUserId);
      } catch {
        // 忽略清理错误
      }
    }
  }, 60000);

  it("GET 未带 token → 401", { timeout: 20000 }, async () => {
    if (!ready) return;
    const res = await GET(new Request("http://localhost/api/admin/settings"));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("未授权");
  });

  it("GET 非 admin → 403", { timeout: 20000 }, async () => {
    if (!ready) return;
    const res = await GET(authRequest(memberToken));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("权限不足");
  });

  it("GET 已有值 → 返回该值", { timeout: 20000 }, async () => {
    if (!ready) return;
    // 先清空再写入，避免上一次运行的残留数据影响断言
    await dbSb.from("app_settings").delete().eq("key", EMAIL_SIGNATURE_KEY);
    const { error: upsertErr } = await dbSb.from("app_settings").upsert({
      key: EMAIL_SIGNATURE_KEY,
      value: "测试签名XYZ",
      updated_at: new Date().toISOString(),
    });
    if (upsertErr) throw new Error(`预置数据失败：${upsertErr.message}`);

    const res = await GET(authRequest(adminToken));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ key: EMAIL_SIGNATURE_KEY, value: "测试签名XYZ" });
  });

  it("GET 未设置（无行）→ value 为 null", { timeout: 20000 }, async () => {
    if (!ready) return;
    await dbSb.from("app_settings").delete().eq("key", EMAIL_SIGNATURE_KEY);
    const res = await GET(authRequest(adminToken));
    expect(res.status).toBe(200);
    expect((await res.json()).value).toBeNull();
  });

  it("PUT 空串 → 删除该行", { timeout: 20000 }, async () => {
    if (!ready) return;
    // 预置一条签名
    await dbSb.from("app_settings").delete().eq("key", EMAIL_SIGNATURE_KEY);
    const { error: upsertErr } = await dbSb.from("app_settings").upsert({
      key: EMAIL_SIGNATURE_KEY,
      value: "待删除签名",
      updated_at: new Date().toISOString(),
    });
    if (upsertErr) throw new Error(`预置数据失败：${upsertErr.message}`);

    const res = await PUT(
      authRequest(adminToken, { method: "PUT", body: JSON.stringify({ value: "" }) }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);

    // 行已被删除
    const { data } = await dbSb
      .from("app_settings")
      .select("value")
      .eq("key", EMAIL_SIGNATURE_KEY)
      .maybeSingle();
    expect(data).toBeNull();
  });

  it("PUT 非空 → upsert 生效并可读回", { timeout: 20000 }, async () => {
    if (!ready) return;
    const res = await PUT(
      authRequest(adminToken, {
        method: "PUT",
        body: JSON.stringify({ value: "北京大学交响乐团管理团队" }),
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);

    const getRes = await GET(authRequest(adminToken));
    expect(getRes.status).toBe(200);
    expect((await getRes.json()).value).toBe("北京大学交响乐团管理团队");
  });

  it("PUT value 非字符串 → 400", { timeout: 20000 }, async () => {
    if (!ready) return;
    const res = await PUT(
      authRequest(adminToken, { method: "PUT", body: JSON.stringify({ value: 123 }) }),
    );
    expect(res.status).toBe(400);
  });

  it("PUT value 超过 500 字 → 400", { timeout: 20000 }, async () => {
    if (!ready) return;
    const res = await PUT(
      authRequest(adminToken, { method: "PUT", body: JSON.stringify({ value: "长".repeat(501) }) }),
    );
    expect(res.status).toBe(400);
  });

  it("PUT value 恰为 500 字 → 成功", { timeout: 20000 }, async () => {
    if (!ready) return;
    const res = await PUT(
      authRequest(adminToken, { method: "PUT", body: JSON.stringify({ value: "长".repeat(500) }) }),
    );
    expect(res.status).toBe(200);
  });

  it("PUT 非 JSON body → 400", { timeout: 20000 }, async () => {
    if (!ready) return;
    const res = await PUT(authRequest(adminToken, { method: "PUT", body: "not-json" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("请求体不是有效的 JSON");
  });

  it("PUT body 为 JSON 字面量 null → 400", { timeout: 20000 }, async () => {
    if (!ready) return;
    const res = await PUT(authRequest(adminToken, { method: "PUT", body: "null" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("缺少参数");
  });

  it("PUT value 含 NUL 字节 → 400", { timeout: 20000 }, async () => {
    if (!ready) return;
    const res = await PUT(
      authRequest(adminToken, { method: "PUT", body: JSON.stringify({ value: "签名\u0000内容" }) }),
    );
    expect(res.status).toBe(400);
  });
});
