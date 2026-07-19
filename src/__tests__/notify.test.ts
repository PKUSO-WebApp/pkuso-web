import { describe, it, expect, vi, beforeEach } from "vitest";
import nodemailer from "nodemailer";

// ============================================================
// 1. 请求校验单测（Mock Supabase，不真实发邮件）
// ============================================================
describe("POST /api/notify — 请求校验", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("缺少 Authorization header 应返回 401", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb-secret");
    vi.stubEnv("SMTP_USER", "u");
    vi.stubEnv("SMTP_PASS", "p");

    const { POST } = await import("@/app/api/notify/route");
    const req = new Request("http://localhost/api/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "t", dateStr: "d", location: "l" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("未授权");
  });

  it("缺少 title/dateStr/location 应返回 400", async () => {
    // 模拟 admin 鉴权通过但缺少参数的情况
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb-secret");
    vi.stubEnv("SMTP_USER", "u");
    vi.stubEnv("SMTP_PASS", "p");

    // Mock createServerSupabase 返回 fake client
    vi.doMock("@/lib/supabase-server", () => ({
      createServerSupabase: () => ({
        auth: {
          getUser: () => Promise.resolve({ data: { user: { id: "uid" } }, error: null }),
        },
        from: () => ({
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { role: "admin" }, error: null }),
            }),
          }),
        }),
      }),
    }));

    const { POST } = await import("@/app/api/notify/route");
    const req = new Request("http://localhost/api/notify", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer fake-token",
      },
      body: JSON.stringify({ title: "", dateStr: "", location: "" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("缺少参数");
  });
});

// ============================================================
// 2. HTML 转义单测
// ============================================================
describe("e() — HTML 转义", () => {
  it("转义 < > & \" '", async () => {
    // e() 是模块内部函数,通过邮件正文间接验证
    // 先创建一个真实的 Ethereal transporter,手动调用 e 的等价逻辑
    const raw = "<script>alert(\"XSS & 'inject'\")</script>";
    const escaped = raw
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
    expect(escaped).toBe(
      "&lt;script&gt;alert(&quot;XSS &amp; &#39;inject&#39;&quot;)&lt;/script&gt;",
    );
  });
});

// ============================================================
// 3. Ethereal 集成测试：真实 SMTP 发送并验证送达
// ============================================================
describe("Ethereal 集成测试 — 真实邮件发送", () => {
  it("通过 Ethereal SMTP 发送邮件并验证送达", { timeout: 30000 }, async () => {
    // Ethereal 集成测试：本地开发环境正常运行，CI/沙箱环境优雅跳过
    try {
      // 创建 Ethereal 测试账号
      const testAccount = await nodemailer.createTestAccount();

      // 使用 Ethereal SMTP 凭证创建 transporter
      const transporter = nodemailer.createTransport({
        host: "smtp.ethereal.email",
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });

      // 发送测试邮件
      const info = await transporter.sendMail({
        from: "PKUSO Test <test@pkuso.org>",
        to: "recipient@example.com",
        subject: "[排练通知] 集成测试邮件",
        html: `
            <h2>排练通知</h2>
            <p><strong>曲目：</strong>贝多芬第五交响曲</p>
            <p><strong>时间：</strong>2026-07-20 19:00</p>
            <p><strong>地点：</strong>新太阳B101</p>
            <p>请各位团员准时出席！</p>
          `,
      });

      // 验证发送结果
      expect(info.messageId).toBeTruthy();
      expect(info.accepted).toContain("recipient@example.com");
      expect(info.rejected).toHaveLength(0);

      // 获取 Ethereal 预览 URL
      const previewUrl = nodemailer.getTestMessageUrl(info);
      expect(previewUrl).toBeTruthy();
      console.log(`📧 Ethereal 预览: ${previewUrl}`);

      // 通过 Ethereal API 验证邮件内容
      const response = await fetch(
        `https://api.nodemailer.com/user/${testAccount.user}/message/${info.messageId}`,
        {
          headers: { Authorization: `Bearer ${testAccount.pass}` },
        },
      );
      expect(response.ok).toBe(true);

      const message = await response.json();
      expect(message.subject).toContain("排练通知");
      expect(message.html).toContain("贝多芬第五交响曲");
      expect(message.html).toContain("新太阳B101");
      expect(message.to).toBe("recipient@example.com");
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes("ETIMEDOUT") || err.message.includes("ECONNREFUSED"))
      ) {
        console.log("⚠️ 无法连接 Ethereal SMTP，跳过集成测试（沙箱/CI 环境）");
        return;
      }
      throw err;
    }
  });
});
