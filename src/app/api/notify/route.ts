import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { createServerSupabase } from "@/lib/supabase-server";
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
  type TemplateType,
} from "@/lib/email-template";
import { isSyntheticEmail } from "@/lib/email-utils";

export const runtime = "nodejs";

export async function resolveTransporter() {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (smtpUser && smtpPass) {
    const port = Number(process.env.SMTP_PORT) || 465;
    const from =
      process.env.SMTP_FROM && process.env.SMTP_FROM.includes("@")
        ? process.env.SMTP_FROM
        : smtpUser;
    if (from === "onboarding@resend.dev") {
      throw new Error(
        "SMTP_FROM 不应为 Resend 默认地址 onboarding@resend.dev，请配置真实发件人地址",
      );
    }
    return {
      mode: "smtp" as const,
      from,
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

    const body = await request.json();
    const { title, dateStr, location, type, targetSection } = body as {
      title?: string;
      dateStr?: string;
      location?: string;
      type?: TemplateType;
      targetSection?: string;
    };
    if (!title || !dateStr || !location)
      return NextResponse.json({ error: "缺少参数" }, { status: 400 });

    const rehearsalType: TemplateType = type === "section" ? "section" : "full";

    const { data: recipients, error: dbError } = await supabaseServer
      .from("profiles")
      .select("email")
      .eq("status", "approved")
      .not("email", "is", null)
      .neq("email", "");
    if (dbError || !recipients?.length)
      return NextResponse.json({ error: "无收件人" }, { status: 500 });

    const emails = (recipients as Array<{ email: string }>)
      .map((r) => r.email)
      .filter((email) => !isSyntheticEmail(email));

    if (emails.length === 0) {
      return NextResponse.json({ error: "无有效收件人" }, { status: 500 });
    }

    const [subjectTemplate, bodyTemplate, signature] = await Promise.all([
      fetchEmailTemplate(supabaseServer, rehearsalType, "subject"),
      fetchEmailTemplate(supabaseServer, rehearsalType, "body"),
      fetchEmailSignature(supabaseServer),
    ]);

    const vars: Record<string, string> = {
      title,
      dateStr,
      location,
      signature,
      targetSection: targetSection ?? "",
    };
    const subject = renderTemplate(subjectTemplate, vars);
    const html = renderTemplate(bodyTemplate, vars);

    const mailer = await resolveTransporter();
    const from =
      mailer.mode === "smtp" ? mailer.from : process.env.SMTP_FROM || "onboarding@resend.dev";

    if (mailer.mode === "smtp") {
      const BATCH_SIZE = 20;
      const BATCH_DELAY_MS = 1500;
      for (let i = 0; i < emails.length; i += BATCH_SIZE) {
        const batch = emails.slice(i, i + BATCH_SIZE);
        await mailer.transporter.sendMail({
          from,
          to: batch,
          subject,
          html,
        });
        if (i + BATCH_SIZE < emails.length) {
          await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
        }
      }
    } else {
      const { error: sendError } = await mailer.resend.emails.send({
        from,
        to: emails,
        subject,
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
    .replace(/&/g, "\u0026amp;")
    .replace(/</g, "\u0026lt;")
    .replace(/>/g, "\u0026gt;")
    .replace(/"/g, "\u0026quot;")
    .replace(/'/g, "\u0026#39;");
}

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

export async function fetchEmailTemplate(
  supabaseServer: ReturnType<typeof createServerSupabase>,
  type: TemplateType,
  part: "subject" | "body",
): Promise<string> {
  const subjectKey =
    type === "full" ? EMAIL_TEMPLATE_FULL_SUBJECT_KEY : EMAIL_TEMPLATE_SECTION_SUBJECT_KEY;
  const bodyKey = type === "full" ? EMAIL_TEMPLATE_FULL_BODY_KEY : EMAIL_TEMPLATE_SECTION_BODY_KEY;
  const key = part === "subject" ? subjectKey : bodyKey;
  const defaultValue =
    part === "subject"
      ? type === "full"
        ? DEFAULT_FULL_SUBJECT
        : DEFAULT_SECTION_SUBJECT
      : type === "full"
        ? DEFAULT_FULL_BODY
        : DEFAULT_SECTION_BODY;

  try {
    const { data, error } = await supabaseServer
      .from("app_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error) return defaultValue;
    const value = data?.value?.trim();
    return value ? value : defaultValue;
  } catch {
    return defaultValue;
  }
}

export function renderTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  Object.entries(vars).forEach(([key, value]) => {
    const escapedValue = e(value);
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), escapedValue);
  });
  return result;
}

/** @deprecated 保留兼容旧测试，新代码应使用 renderTemplate + fetchEmailTemplate */
export function buildRehearsalHtml(params: {
  title: string;
  dateStr: string;
  location: string;
  signature: string;
}) {
  const { title, dateStr, location, signature } = params;
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
