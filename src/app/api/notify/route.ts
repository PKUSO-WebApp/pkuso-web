import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";

export const runtime = "nodejs";

export async function POST(request: Request) {
  console.log("=== 邮件 API 被触发 ===");
  try {
    // 1. 检查环境变量
    const resendKey =
      process.env.RESEND_API_KEY ??
      process.env.NEXT_PUBLIC_RESEND_API_KEY ??
      (await readDotenvKey("RESEND_API_KEY")) ??
      (await readDotenvKey("NEXT_PUBLIC_RESEND_API_KEY"));
    console.log(
      "[Env] RESEND-related keys:",
      Object.keys(process.env).filter((k) => k.toUpperCase().includes("RESEND")),
    );
    console.log("[Env] has RESEND key:", !!resendKey);
    console.log("[Env] has NEXT_PUBLIC_SUPABASE_URL:", !!process.env.NEXT_PUBLIC_SUPABASE_URL);
    console.log(
      "[Env] has NEXT_PUBLIC_SUPABASE_ANON_KEY:",
      !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
    if (!resendKey) {
      throw new Error("缺少 RESEND_API_KEY 环境变量");
    }
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      throw new Error("缺少 SUPABASE_URL");
    }
    if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      throw new Error("缺少 NEXT_PUBLIC_SUPABASE_ANON_KEY");
    }

    // 2. 初始化客户端 (一定要放在函数内部，防止顶层崩溃)
    const resend = new Resend(resendKey);
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );

    // 3. 解析请求体
    const body = await request.json();
    console.log("收到的排练数据:", body);
    const { title, dateStr, location } = body as {
      title?: string;
      dateStr?: string;
      location?: string;
    };

    if (!title || !dateStr || !location) {
      throw new Error("缺少 title、dateStr 或 location");
    }

    // 4. 获取团员邮箱
    const { data: users, error: dbError } = await supabase
      .from("users")
      .select("email")
      .not("email", "is", null)
      .neq("email", "");

    if (dbError) throw new Error("数据库查询失败: " + dbError.message);
    if (!users || users.length === 0) throw new Error("没有找到可发送的邮箱");

    const emails = (users as Array<{ email: string }>).map((u) => u.email);
    console.log("准备发送给以下邮箱:", emails);

    // 5. 发送邮件
    const { data, error: sendError } = await resend.emails.send({
      from: "onboarding@resend.dev", // Resend 测试专用发件人
      to: emails,
      subject: `[排练通知] ${title}`,
      html: `
        <h2>排练通知</h2>
        <p><strong>曲目：</strong>${escapeHtml(title)}</p>
        <p><strong>时间：</strong>${escapeHtml(dateStr)}</p>
        <p><strong>地点：</strong>${escapeHtml(location)}</p>
        <p>请各位团员准时出席！</p>
      `,
    });
    if (sendError) throw new Error("Resend 发送失败: " + sendError.message);

    console.log("=== 邮件发送成功 ===", data);
    return NextResponse.json({ success: true, data }, { status: 200 });
  } catch (error: any) {
    console.error("[Email API Error 捕获]:", error?.message || error);
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 });
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

async function readDotenvKey(key: string): Promise<string | null> {
  try {
    const raw = await readFile(`${process.cwd()}/.env.local`, "utf8");
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx <= 0) continue;
      const k = trimmed.slice(0, idx).trim();
      if (k !== key) continue;
      const v = trimmed.slice(idx + 1).trim();
      // 去掉可能的引号包裹
      return v.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    }
    return null;
  } catch {
    return null;
  }
}
