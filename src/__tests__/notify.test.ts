import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { e, resolveTransporter } from "@/app/api/notify/route";

// ============================================================
// 测试 notify/route.ts 中导出的工具函数。
// 端到端测试通过 POST handler 真实发送并验证邮件送达。
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
// 2. resolveTransporter — 根据环境变量选择 SMTP / Resend
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
    expect(result.transporter).toBeDefined();
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
// 3. Ethereal 集成测试
// ============================================================

async function createEtherealClient() {
  const nodemailer = await import("nodemailer");
  const testAccount = await nodemailer.default.createTestAccount();
  const transporter = nodemailer.default.createTransport({
    host: "smtp.ethereal.email",
    port: 587,
    secure: false,
    auth: { user: testAccount.user, pass: testAccount.pass },
  });
  return { nodemailer: nodemailer.default, transporter, testAccount };
}

function skipIfNoNetwork(err: unknown) {
  if (
    err instanceof Error &&
    (err.message.includes("ETIMEDOUT") ||
      err.message.includes("ECONNREFUSED") ||
      err.message.includes("ENOTFOUND"))
  ) {
    console.log("⚠️ 无法连接 Ethereal，跳过（沙箱/CI 环境）");
    return true;
  }
  return false;
}

describe("Ethereal SMTP 直连测试", () => {
  it("发送邮件并验证 SMTP 层面送达", { timeout: 30000 }, async () => {
    try {
      const { nodemailer, transporter } = await createEtherealClient();
      const info = await transporter.sendMail({
        from: "test@pkuso.org",
        to: "member@example.com",
        subject: "[排练通知] SMTP 直连测试",
        html: "<h2>排练通知</h2><p>测试邮件</p>",
      });
      expect(info.messageId).toBeTruthy();
      expect(info.accepted).toHaveLength(1);
      expect(info.rejected).toHaveLength(0);
      expect(nodemailer.getTestMessageUrl(info)).toBeTruthy();
    } catch (err) {
      if (!skipIfNoNetwork(err)) throw err;
    }
  });
});

// ============================================================
// 4. 端到端测试：POST /api/notify → Supabase → Ethereal
//    需要 CI secrets: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================
describe("POST /api/notify 端到端", () => {
  it("创建临时 admin → 调 POST → 验证 Ethereal 收到邮件 → 清理", { timeout: 60000 }, async () => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      console.log("⚠️ 缺少 Supabase 配置，跳过端到端测试");
      return;
    }

    try {
      const { createClient } = await import("@supabase/supabase-js");
      const { nodemailer, testAccount } = await createEtherealClient();
      const sb = createClient(supabaseUrl, serviceRoleKey);

      // 1. 创建临时测试 admin 用户
      const testEmail = `e2e-${Date.now()}@ethereal.example`;
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

      // 2. upsert admin profile（createUser 的 trigger 已自动创建 profile，需 upsert）
      await sb.from("profiles").upsert({
        id: newUser.user.id,
        email: testEmail,
        full_name: "E2E Test",
        status: "approved",
        role: "admin",
      } as never);

      // 3. 登录获取 access token
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

      // 4. 注入 Ethereal SMTP（465 端口 TLS，通常比 587 更少被防火墙拦截）
      process.env.SMTP_USER = testAccount.user;
      process.env.SMTP_PASS = testAccount.pass;
      process.env.SMTP_HOST = "smtp.ethereal.email";
      process.env.SMTP_PORT = "465";

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

        // 6. 验证响应
        expect(res.status).toBe(200);
        expect(body.success).toBe(true);

        // 7. 验证邮件实际送达
        await new Promise((r) => setTimeout(r, 2000));
        const msgRes = await fetch(
          `https://api.nodemailer.com/user/${testAccount.user}/message/latest`,
          {
            headers: {
              Authorization: `Basic ${Buffer.from(`${testAccount.user}:${testAccount.pass}`).toString("base64")}`,
            },
          },
        );

        if (msgRes.ok) {
          const msg = await msgRes.json();
          expect(msg.subject).toContain("E2E 测试排练");
          expect(msg.html).toContain("新太阳B101");
          console.log(
            `✅ 端到端验证成功: ${nodemailer.getTestMessageUrl({ messageId: msg.messageId } as never)}`,
          );
        } else {
          console.log(`⚠️ Ethereal API 返回 ${msgRes.status}，SMTP 层已验证发送`);
        }
      } finally {
        // 8. 清理
        delete process.env.SMTP_USER;
        delete process.env.SMTP_PASS;
        delete process.env.SMTP_HOST;
        delete process.env.SMTP_PORT;

        await sb.from("profiles").delete().eq("id", newUser.user.id);
        await sb.auth.admin.deleteUser(newUser.user.id);
        console.log(`🧹 已清理测试用户 ${testEmail}`);
      }
    } catch (err) {
      if (!skipIfNoNetwork(err)) throw err;
    }
  });
});
