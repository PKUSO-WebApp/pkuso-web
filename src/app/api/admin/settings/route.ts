import { NextResponse } from "next/server";
import { EMAIL_SIGNATURE_KEY, EMAIL_SIGNATURE_MAX_LENGTH } from "@/lib/email-signature";
import { verifyAdmin } from "@/lib/verify-admin";

export const runtime = "nodejs";

/** 读取邮件签名设置；未设置（无行）时 value 为 null */
export async function GET(request: Request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.ok) return auth.response;

    const { data, error } = await auth.supabaseServer
      .from("app_settings")
      .select("value")
      .eq("key", EMAIL_SIGNATURE_KEY)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // trim 后返回，与发信路径 fetchEmailSignature 的取用方式保持一致
    return NextResponse.json({ key: EMAIL_SIGNATURE_KEY, value: data?.value?.trim() ?? null });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Settings Error]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** 保存邮件签名设置；value 为空串时删除该行，回到未设置状态 */
export async function PUT(request: Request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.ok) return auth.response;

    // 非法 JSON（如纯文本 body）返回结构化 400，而非 500
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "请求体不是有效的 JSON" }, { status: 400 });
    }
    // JSON 字面量 null 也视为缺参
    if (body === null) return NextResponse.json({ error: "缺少参数" }, { status: 400 });
    const { value } = body as { value?: unknown };
    if (typeof value !== "string") return NextResponse.json({ error: "缺少参数" }, { status: 400 });

    const trimmed = value.trim();
    // NUL 字节会导致 Postgres 写入报错，直接 400
    if (trimmed.includes("\u0000"))
      return NextResponse.json({ error: "签名包含非法字符" }, { status: 400 });

    if (trimmed === "") {
      // 空值 → 删除设置行，邮件回落到默认签名
      const { error } = await auth.supabaseServer
        .from("app_settings")
        .delete()
        .eq("key", EMAIL_SIGNATURE_KEY);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true }, { status: 200 });
    }

    // 长度上限：签名是邮件落款短文本，超长可能导致 SMTP/Resend 拒收、全团通知失败
    if (trimmed.length > EMAIL_SIGNATURE_MAX_LENGTH) {
      return NextResponse.json(
        { error: `签名长度不能超过 ${EMAIL_SIGNATURE_MAX_LENGTH} 字` },
        { status: 400 },
      );
    }

    // 非空 → upsert（key 为主键，冲突时按主键合并；updated_at 显式刷新）
    const { error } = await auth.supabaseServer.from("app_settings").upsert({
      key: EMAIL_SIGNATURE_KEY,
      value: trimmed,
      updated_at: new Date().toISOString(),
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Settings Error]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
