import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/** SMTP 优先,Resend 回退:新旧配置均可工作 */
async function resolveTransporter() {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (smtpUser && smtpPass) {
    console.log("[Notify] 使用 SMTP 发送(host:", process.env.SMTP_HOST || "smtp.163.com", ")");
    return {
      mode: "smtp" as const,
      transporter: nodemailer.createTransport({
        host: process.env.SMTP_HOST || "smtp.163.com",
        port: Number(process.env.SMTP_PORT) || 465,
        secure: true,
        auth: { user: smtpUser, pass: smtpPass },
      }),
    };
  }

  const resendKey = process.env.RESEND_API_KEY ?? process.env.NEXT_PUBLIC_RESEND_API_KEY;
  if (resendKey) {
    console.log("[Notify] SMTP 未配置,回退到 Resend");
    const { Resend } = await import("resend");
    return { mode: "resend" as const, resend: new Resend(resendKey) };
  }

  throw new Error("缺少邮件配置:请设置 SMTP_USER+SMTP_PASS 或 RESEND_API_KEY");
}

export async function POST(request: Request) {
  console.log("=== 邮件 API 被触发 ===");
  try {
    // 1. 检查 Supabase 环境变量
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("缺少 NEXT_PUBLIC_SUPABASE_URL");
    if (!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
      throw new Error("缺少 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

    const supabaseClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    );

    // 2. 解析请求体
    const body = await request.json();
    console.log("收到的排练数据:", body);
    const { title, dateStr, location } = body as {
      title?: string;
      dateStr?: string;
      location?: string;
    };
    if (!title || !dateStr || !location) throw new Error("缺少 title、dateStr 或 location");

    // 3. 获取团员邮箱
    const { data: users, error: dbError } = await supabaseClient
      .from("users")
      .select("email")
      .not("email", "is", null)
      .neq("email", "");
    if (dbError) throw new Error("数据库查询失败: " + dbError.message);
    if (!users || users.length === 0) throw new Error("没有找到可发送的邮箱");

    const emails = (users as Array<{ email: string }>).map((u) => u.email);
    console.log("准备发送给以下邮箱:", emails);

    // 4. 发送邮件
    const mailer = await resolveTransporter();
    const from = process.env.SMTP_FROM || "onboarding@resend.dev";
    const html = `
      <h2>排练通知</h2>
      <p><strong>曲目：</strong>${escapeHtml(title)}</p>
      <p><strong>时间：</strong>${escapeHtml(dateStr)}</p>
      <p><strong>地点：</strong>${escapeHtml(location)}</p>
      <p>请各位团员准时出席！</p>
    `;

    if (mailer.mode === "smtp") {
      await mailer.transporter.sendMail({ from, to: emails, subject: `[排练通知] ${title}`, html });
    } else {
      const { error: sendError } = await mailer.resend.emails.send({
        from,
        to: emails,
        subject: `[排练通知] ${title}`,
        html,
      });
      if (sendError) throw new Error("Resend 发送失败: " + sendError.message);
    }

    console.log("=== 邮件发送成功 ===");
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Email API Error 捕获]:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
