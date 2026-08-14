import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { createServerSupabase } from "@/lib/supabase-server";
import { EMAIL_SIGNATURE_KEY, DEFAULT_EMAIL_SIGNATURE } from "@/lib/email-signature";

export const runtime = "nodejs";

export async function resolveTransporter() {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (smtpUser && smtpPass) {
    const port = Number(process.env.SMTP_PORT) || 465;
    return {
      mode: "smtp" as const,
      transporter: nodemailer.createTransport({
        host: process.env.SMTP_HOST || "smtp.163.com",
        port,
        secure: port === 465,
        auth: { user: smtpUser, pass: smtpPass },
      }),
    };
  }
  const resendKey = process.env.RESEND_API_KEY ?? process.env.NEXT_PUBLIC_RESEND_API_KEY;
  if (resendKey) {
    const { Resend } = await import("resend");
    return { mode: "resend" as const, resend: new Resend(resendKey) };
  }
  throw new Error("缺少邮件配置");
}

export async function POST(request: Request) {
  try {
    // 1. 认证 + 授权: 验证调用者为 admin
    const supabaseServer = createServerSupabase();
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "") ?? "";
    if (!token) return NextResponse.json({ error: "未授权" }, { status: 401 });

    const {
      data: { user },
      error: authError,
    } = await supabaseServer.auth.getUser(token);
    if (authError || !user) return NextResponse.json({ error: "未授权" }, { status: 401 });

    const { data: profile } = await supabaseServer
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profile?.role !== "admin") return NextResponse.json({ error: "权限不足" }, { status: 403 });

    // 2. 解析请求
    const body = await request.json();
    const { title, dateStr, location } = body as {
      title?: string;
      dateStr?: string;
      location?: string;
    };
    if (!title || !dateStr || !location)
      return NextResponse.json({ error: "缺少参数" }, { status: 400 });

    // 3. 获取所有已批准用户的邮箱
    const { data: recipients, error: dbError } = await supabaseServer
      .from("profiles")
      .select("email")
      .eq("status", "approved")
      .not("email", "is", null)
      .neq("email", "");
    if (dbError || !recipients?.length)
      return NextResponse.json({ error: "无收件人" }, { status: 500 });

    const emails = (recipients as Array<{ email: string }>).map((r) => r.email);

    // 4. 读取邮件签名（读取失败时静默降级为默认文案，不阻断发信）
    const signature = await fetchEmailSignature(supabaseServer);

    // 5. 发送
    const mailer = await resolveTransporter();
    const from = process.env.SMTP_FROM || "onboarding@resend.dev";
    const html = buildRehearsalHtml({ title, dateStr, location, signature });

    if (mailer.mode === "smtp") {
      await mailer.transporter.sendMail({ from, to: emails, subject: `[排练通知] ${title}`, html });
    } else {
      const { error: sendError } = await mailer.resend.emails.send({
        from,
        to: emails,
        subject: `[排练通知] ${title}`,
        html,
      });
      if (sendError) throw new Error(sendError.message);
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Notify Error]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export function e(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 读取邮件签名。
 * - 未设置（无行或值为空）时返回默认兜底文案；
 * - 读取失败（如表异常）时静默降级为默认文案，不阻断发信。
 */
export async function fetchEmailSignature(
  supabaseServer: ReturnType<typeof createServerSupabase>,
): Promise<string> {
  try {
    const { data, error } = await supabaseServer
      .from("app_settings")
      .select("value")
      .eq("key", EMAIL_SIGNATURE_KEY)
      .maybeSingle();
    if (error) return DEFAULT_EMAIL_SIGNATURE;
    const value = data?.value?.trim();
    return value ? value : DEFAULT_EMAIL_SIGNATURE;
  } catch {
    return DEFAULT_EMAIL_SIGNATURE;
  }
}

/** 组装排练通知邮件 HTML（签名拼在「请各位团员准时出席！」之后，先 e() 转义防注入，再将 \n/\r\n 转为 <br/> 保留换行） */
export function buildRehearsalHtml(params: {
  title: string;
  dateStr: string;
  location: string;
  signature: string;
}) {
  const { title, dateStr, location, signature } = params;
  // 先转义再 nl2br：e() 保证用户内容不可注入；<br/> 是我们自己生成的标签，不来自用户输入
  const signatureHtml = e(signature).replace(/\r\n|\n/g, "<br/>");
  return `
    <h2>排练通知</h2>
    <p><strong>曲目：</strong>${e(title)}</p>
    <p><strong>时间：</strong>${e(dateStr)}</p>
    <p><strong>地点：</strong>${e(location)}</p>
    <p>请各位团员准时出席！</p>
    <p style="margin-top:24px;color:#666;">——<br/>${signatureHtml}</p>
  `;
}
