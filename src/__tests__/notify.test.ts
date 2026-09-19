import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  e,
  resolveTransporter,
  fetchEmailSignature,
  buildRehearsalHtml,
} from "@/app/api/notify/route";
import { EMAIL_SIGNATURE_KEY, DEFAULT_EMAIL_SIGNATURE } from "@/lib/email-signature";

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
// 1.5 邮件签名读取与降级
// ============================================================
describe("fetchEmailSignature() — 签名读取与降级", () => {
  /** 构造只实现了 from().select().eq().maybeSingle() 链的假客户端 */
  function fakeClient(result: { data: { value: string } | null; error: Error | null }) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => result,
          }),
        }),
      }),
    } as never;
  }

  it("未设置（无行）→ 返回默认文案", async () => {
    const signature = await fetchEmailSignature(fakeClient({ data: null, error: null }));
    expect(signature).toBe(DEFAULT_EMAIL_SIGNATURE);
  });

  it("已设置 → 返回库中签名（自动去首尾空白）", async () => {
    const signature = await fetchEmailSignature(
      fakeClient({ data: { value: "  交响乐团理事会  " }, error: null }),
    );
    expect(signature).toBe("交响乐团理事会");
  });

  it("库中值为空串 → 返回默认文案", async () => {
    const signature = await fetchEmailSignature(fakeClient({ data: { value: "" }, error: null }));
    expect(signature).toBe(DEFAULT_EMAIL_SIGNATURE);
  });

  it("读取抛出异常 → 静默降级为默认文案，不阻断发信", async () => {
    const broken = {
      from: () => {
        throw new Error("db down");
      },
    } as never;
    const signature = await fetchEmailSignature(broken);
    expect(signature).toBe(DEFAULT_EMAIL_SIGNATURE);
  });

  it("查询返回 error → 静默降级为默认文案", async () => {
    const signature = await fetchEmailSignature(
      fakeClient({ data: null, error: new Error("boom") }),
    );
    expect(signature).toBe(DEFAULT_EMAIL_SIGNATURE);
  });

  it("EMAIL_SIGNATURE_KEY 常量与查询 key 一致", () => {
    expect(EMAIL_SIGNATURE_KEY).toBe("email_signature");
  });
});

// ============================================================
// 1.6 邮件 HTML 组装（含签名落款）
// ============================================================
describe("buildRehearsalHtml() — 邮件 HTML 组装", () => {
  const base = { title: "排练《贝五》", dateStr: "2026-08-14 19:00", location: "新太阳B101" };

  it("签名未设置（默认文案）→ HTML 含默认文案", () => {
    const html = buildRehearsalHtml({ ...base, signature: DEFAULT_EMAIL_SIGNATURE });
    expect(html).toContain("请各位团员准时出席！");
    expect(html).toContain(DEFAULT_EMAIL_SIGNATURE);
  });

  it("签名已设置 → HTML 含签名内容", () => {
    const html = buildRehearsalHtml({ ...base, signature: "交响乐团理事会" });
    expect(html).toContain("交响乐团理事会");
  });

  it("签名含 HTML 标签 → 被 e() 转义", () => {
    const html = buildRehearsalHtml({ ...base, signature: "<b>签名</b>" });
    expect(html).toContain("&lt;b&gt;签名&lt;/b&gt;");
    expect(html).not.toContain("<b>签名</b>");
  });

  it("多行签名（\\n 与 \\r\\n 混合）→ 换行全部转为 <br/>，原始换行不残留", () => {
    const html = buildRehearsalHtml({
      ...base,
      signature: "交响乐团理事会\n官方网站：pkuso.org\r\n联系电话：123456",
    });
    expect(html).toContain("交响乐团理事会<br/>官方网站：pkuso.org<br/>联系电话：123456");
    expect(html).not.toContain("交响乐团理事会\n官方网站");
    expect(html).not.toContain("pkuso.org\r\n联系电话");
  });

  it("先转义后 nl2br：签名中的标签被转义，换行仍正常转换（无注入路径）", () => {
    const html = buildRehearsalHtml({ ...base, signature: "<b>理事会</b>\n第二行" });
    expect(html).toContain("&lt;b&gt;理事会&lt;/b&gt;<br/>第二行");
    expect(html).not.toContain("<b>理事会</b>");
    expect(html).not.toContain("<b>理事会</b>\n第二行");
  });

  it("单行签名行为不变（不产生 <br/>）", () => {
    const html = buildRehearsalHtml({ ...base, signature: "交响乐团理事会" });
    expect(html).toContain("交响乐团理事会");
    expect(html).not.toContain("交响乐团理事会<br/>");
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
