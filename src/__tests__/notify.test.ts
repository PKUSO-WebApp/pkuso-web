import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { e, resolveTransporter } from "@/app/api/notify/route";

// ============================================================
// Mailpit 配置常量（本地 Docker / CI service container）
// SMTP: localhost:1025（无认证，接受任意 user/pass）
// API:  http://localhost:8025/api/v1/messages
// ============================================================
const MAILPIT_SMTP_HOST = "localhost";
const MAILPIT_SMTP_PORT = "1025";
const MAILPIT_API_BASE = "http://localhost:8025/api/v1";

function mailpitAvailable(): boolean {
  return process.env.CI === "true" || !!process.env.MAILPIT_ENABLED;
}

async function fetchJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

// ============================================================
// 1. HTML 转义
// ============================================================
describe("e() — HTML 转义", () => {
  it("转义 < > & \" '", () => {
    const raw = "<script>alert(\"XSS & 'inject'\")</script>";
    expect(e(raw)).toBe(
      "&lt;script&gt;alert(&quot;XSS &amp; &#39;inject&#39;&quot;)&lt;/script&gt;",
    );
  });
  it("纯中文不转义", () => {
    expect(e("贝多芬第五交响曲")).toBe("贝多芬第五交响曲");
  });
  it("空字符串不报错", () => {
    expect(e("")).toBe("");
  });
});

// ============================================================
// 2. resolveTransporter
// ============================================================
describe("resolveTransporter() — 传输器选择", () => {
  beforeEach(() => {
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.RESEND_API_KEY;
    delete process.env.NEXT_PUBLIC_RESEND_API_KEY;
  });
  afterEach(() => {
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.RESEND_API_KEY;
  });

  it("SMTP_USER + SMTP_PASS → smtp 模式", async () => {
    process.env.SMTP_USER = "test@example.com";
    process.env.SMTP_PASS = "secret";
    const result = await resolveTransporter();
    expect(result.mode).toBe("smtp");
    expect(result.transporter).toBeDefined();
  });
  it("SMTP_HOST 自定义时生效", async () => {
    process.env.SMTP_USER = "u";
    process.env.SMTP_PASS = "p";
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_PORT = "2525";
    const result = await resolveTransporter();
    expect(result.mode).toBe("smtp");
  });
  it("无 SMTP 但有 RESEND_API_KEY → resend 模式", async () => {
    process.env.RESEND_API_KEY = "re_123";
    const result = await resolveTransporter();
    expect(result.mode).toBe("resend");
    expect(result.resend).toBeDefined();
  });
  it("NEXT_PUBLIC_RESEND_API_KEY 也可触发 resend", async () => {
    process.env.NEXT_PUBLIC_RESEND_API_KEY = "re_pub_456";
    const result = await resolveTransporter();
    expect(result.mode).toBe("resend");
  });
  it("SMTP_USER 存在但 SMTP_PASS 为空 → 降级到 Resend", async () => {
    process.env.SMTP_USER = "u";
    process.env.RESEND_API_KEY = "re_fallback";
    const result = await resolveTransporter();
    expect(result.mode).toBe("resend");
  });
  it("无任何邮箱配置 → 抛出异常", async () => {
    await expect(resolveTransporter()).rejects.toThrow("缺少邮件配置");
  });
});

// ============================================================
// 3. Mailpit SMTP 直连测试
// ============================================================
describe("Mailpit SMTP 直连测试", () => {
  it("发送邮件并验证送达", { timeout: 10000 }, async () => {
    if (!mailpitAvailable()) {
      console.log("⚠️ Mailpit 未启用，跳过");
      return;
    }
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.default.createTransport({
      host: MAILPIT_SMTP_HOST,
      port: Number(MAILPIT_SMTP_PORT),
      secure: false,
    });

    const info = await transporter.sendMail({
      from: "test@pkuso.org",
      to: "member@example.com",
      subject: "[排练通知] SMTP 直连测试",
      html: "<h2>排练通知</h2><p>测试邮件</p>",
    });
    expect(info.messageId).toBeTruthy();
    expect(info.accepted).toHaveLength(1);
    expect(info.rejected).toHaveLength(0);

    // 验证 Mailpit 收到了
    const messages: { total: number } = await fetchJson(`${MAILPIT_API_BASE}/messages`);
    expect(messages.total).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
// 4. 端到端测试：POST /api/notify → Supabase → Mailpit
// ============================================================
describe("POST /api/notify 端到端", () => {
  it("创建临时 admin → 调 POST → 验证 Mailpit 收到邮件 → 清理", { timeout: 60000 }, async () => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      console.log("⚠️ 缺少 Supabase 配置，跳过端到端测试");
      return;
    }
    if (!mailpitAvailable()) {
      console.log("⚠️ Mailpit 未启用，跳过端到端测试");
      return;
    }

    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(supabaseUrl, serviceRoleKey);

    // 1. 创建临时 admin
    const testEmail = `e2e-${Date.now()}@pkuso.test`;
    const testPassword = `pw-${Date.now()}`;

    const { data: newUser, error: createErr } = await sb.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
    } as never);
    if (createErr || !newUser?.user?.id) {
      console.log("⚠️ 无法创建测试用户，跳过");
      return;
    }

    // 2. upsert admin profile
    await sb.from("profiles").upsert({
      id: newUser.user.id,
      email: testEmail,
      full_name: "E2E Test",
      status: "approved",
      role: "admin",
    } as never);

    // 3. 登录
    const { data: session } = await sb.auth.signInWithPassword({
      email: testEmail,
      password: testPassword,
    });
    if (!session?.session?.access_token) {
      console.log("⚠️ 无法登录测试用户，跳过");
      await sb.from("profiles").delete().eq("id", newUser.user.id);
      await sb.auth.admin.deleteUser(newUser.user.id);
      return;
    }
    const token = session.session.access_token;

    // 4. 注入 Mailpit SMTP
    process.env.SMTP_USER = "test";
    process.env.SMTP_PASS = "test";
    process.env.SMTP_HOST = MAILPIT_SMTP_HOST;
    process.env.SMTP_PORT = MAILPIT_SMTP_PORT;

    try {
      // 5. 调用 POST handler
      const { POST } = await import("@/app/api/notify/route");
      const req = new Request("http://localhost/api/notify", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: "E2E 测试排练",
          dateStr: "2026-07-20 19:00",
          location: "新太阳B101",
        }),
      });

      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);

      // 6. 通过 Mailpit API 验证邮件内容
      const messages: {
        total: number;
        messages: Array<{ ID: string; Subject: string; To: Array<{ Address: string }> }>;
      } = await fetchJson(`${MAILPIT_API_BASE}/messages`);
      expect(messages.total).toBeGreaterThanOrEqual(1);

      const latest = await fetchJson(`${MAILPIT_API_BASE}/message/${messages.messages[0].ID}`);
      expect(latest.Subject).toContain("E2E 测试排练");
      expect(latest.HTML).toContain("新太阳B101");
      console.log("✅ 端到端测试通过，邮件已验证送达 Mailpit");
    } finally {
      // 7. 清理
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_PORT;

      await sb.from("profiles").delete().eq("id", newUser.user.id);
      await sb.auth.admin.deleteUser(newUser.user.id);
      console.log(`🧹 已清理测试用户 ${testEmail}`);
    }
  });
});
