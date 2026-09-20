import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  e,
  resolveTransporter,
  fetchEmailSignature,
  buildRehearsalHtml,
  fetchEmailTemplate,
  renderTemplate,
} from "@/app/api/notify/route";
import { EMAIL_SIGNATURE_KEY, DEFAULT_EMAIL_SIGNATURE } from "@/lib/email-signature";
import {
  EMAIL_TEMPLATE_FULL_SUBJECT_KEY,
  EMAIL_TEMPLATE_FULL_BODY_KEY,
  EMAIL_TEMPLATE_SECTION_SUBJECT_KEY,
  EMAIL_TEMPLATE_SECTION_BODY_KEY,
  DEFAULT_FULL_SUBJECT,
  DEFAULT_FULL_BODY,
  DEFAULT_SECTION_SUBJECT,
  DEFAULT_SECTION_BODY,
} from "@/lib/email-template";

// ============================================================
// 1. HTML 转义
// ============================================================
describe("e() — HTML 转义", () => {
  it("转义 < > & \" '", () => {
    const raw = "<script>alert(\"XSS & 'inject'\")</script>";
    const result = e(raw);
    expect(result).toContain(e("<script>"));
    expect(result).toContain("&");
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
    expect(html).toContain(e("<b>签名</b>"));
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
    expect(html).toContain(e("<b>理事会</b>") + "<br/>第二行");
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

// ============================================================
// 3. 邮件模板读取与渲染
// ============================================================
describe("fetchEmailTemplate() — 模板读取与降级", () => {
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

  it("合排主题：未设置 → 返回默认模板", async () => {
    const subject = await fetchEmailTemplate(
      fakeClient({ data: null, error: null }),
      "full",
      "subject",
    );
    expect(subject).toBe(DEFAULT_FULL_SUBJECT);
  });

  it("合排正文：未设置 → 返回默认模板", async () => {
    const body = await fetchEmailTemplate(fakeClient({ data: null, error: null }), "full", "body");
    expect(body).toBe(DEFAULT_FULL_BODY);
  });

  it("分排主题：未设置 → 返回默认模板", async () => {
    const subject = await fetchEmailTemplate(
      fakeClient({ data: null, error: null }),
      "section",
      "subject",
    );
    expect(subject).toBe(DEFAULT_SECTION_SUBJECT);
  });

  it("分排正文：未设置 → 返回默认模板", async () => {
    const body = await fetchEmailTemplate(
      fakeClient({ data: null, error: null }),
      "section",
      "body",
    );
    expect(body).toBe(DEFAULT_SECTION_BODY);
  });

  it("已设置 → 返回库中模板（自动去首尾空白）", async () => {
    const subject = await fetchEmailTemplate(
      fakeClient({ data: { value: "  [自定义] {title}  " }, error: null }),
      "full",
      "subject",
    );
    expect(subject).toBe("[自定义] {title}");
  });

  it("库中值为空串 → 返回默默认模板", async () => {
    const body = await fetchEmailTemplate(
      fakeClient({ data: { value: "" }, error: null }),
      "full",
      "body",
    );
    expect(body).toBe(DEFAULT_FULL_BODY);
  });

  it("读取抛出异常 → 静默降级为默认模板", async () => {
    const broken = {
      from: () => {
        throw new Error("db down");
      },
    } as never;
    const subject = await fetchEmailTemplate(broken, "full", "subject");
    expect(subject).toBe(DEFAULT_FULL_SUBJECT);
  });

  it("查询返回 error → 静默降级为默认模板", async () => {
    const body = await fetchEmailTemplate(
      fakeClient({ data: null, error: new Error("boom") }),
      "section",
      "body",
    );
    expect(body).toBe(DEFAULT_SECTION_BODY);
  });

  it("模板 key 常量正确", () => {
    expect(EMAIL_TEMPLATE_FULL_SUBJECT_KEY).toBe("email_template_full_subject");
    expect(EMAIL_TEMPLATE_FULL_BODY_KEY).toBe("email_template_full_body");
    expect(EMAIL_TEMPLATE_SECTION_SUBJECT_KEY).toBe("email_template_section_subject");
    expect(EMAIL_TEMPLATE_SECTION_BODY_KEY).toBe("email_template_section_body");
  });
});

describe("renderTemplate() — 占位符替换与 HTML 转义", () => {
  it("基本替换", () => {
    const tpl = "标题: {title}, 时间: {dateStr}";
    const result = renderTemplate(tpl, { title: "柴五", dateStr: "2026-09-20 19:00" });
    expect(result).toBe("标题: 柴五, 时间: 2026-09-20 19:00");
  });

  it("HTML 特殊字符被转义", () => {
    const tpl = "内容: {content}";
    const result = renderTemplate(tpl, { content: "<script>alert(1)</script>" });
    expect(result).toBe("内容: " + e("<script>alert(1)</script>"));
  });

  it("缺失的占位符保持原样", () => {
    const tpl = "A: {a}, B: {b}";
    const result = renderTemplate(tpl, { a: "1" });
    expect(result).toBe("A: 1, B: {b}");
  });

  it("多个相同占位符全部替换", () => {
    const tpl = "{x} - {x} - {x}";
    const result = renderTemplate(tpl, { x: "重复" });
    expect(result).toBe("重复 - 重复 - 重复");
  });

  it("空值替换为空串", () => {
    const tpl = "前{val}后";
    const result = renderTemplate(tpl, { val: "" });
    expect(result).toBe("前后");
  });

  it("包含 & < > \" ' 的值全部转义", () => {
    const tpl = "{v}";
    const input = "A&B<C>D\"E'F";
    const result = renderTemplate(tpl, { v: input });
    expect(result).toBe(e(input));
  });
});
