import { NextResponse } from "next/server";
import { EMAIL_SIGNATURE_KEY, EMAIL_SIGNATURE_MAX_LENGTH } from "@/lib/email-signature";
import {
  EMAIL_TEMPLATE_FULL_SUBJECT_KEY,
  EMAIL_TEMPLATE_FULL_BODY_KEY,
  EMAIL_TEMPLATE_SECTION_SUBJECT_KEY,
  EMAIL_TEMPLATE_SECTION_BODY_KEY,
  EMAIL_TEMPLATE_MAX_LENGTH,
} from "@/lib/email-template";
import { verifyAdmin } from "@/lib/verify-admin";

export const runtime = "nodejs";

const ALL_SETTINGS_KEYS = [
  EMAIL_SIGNATURE_KEY,
  EMAIL_TEMPLATE_FULL_SUBJECT_KEY,
  EMAIL_TEMPLATE_FULL_BODY_KEY,
  EMAIL_TEMPLATE_SECTION_SUBJECT_KEY,
  EMAIL_TEMPLATE_SECTION_BODY_KEY,
] as const;

type SettingsKey = (typeof ALL_SETTINGS_KEYS)[number];

const KEY_MAX_LENGTHS: Record<SettingsKey, number> = {
  [EMAIL_SIGNATURE_KEY]: EMAIL_SIGNATURE_MAX_LENGTH,
  [EMAIL_TEMPLATE_FULL_SUBJECT_KEY]: EMAIL_TEMPLATE_MAX_LENGTH,
  [EMAIL_TEMPLATE_FULL_BODY_KEY]: EMAIL_TEMPLATE_MAX_LENGTH,
  [EMAIL_TEMPLATE_SECTION_SUBJECT_KEY]: EMAIL_TEMPLATE_MAX_LENGTH,
  [EMAIL_TEMPLATE_SECTION_BODY_KEY]: EMAIL_TEMPLATE_MAX_LENGTH,
};

async function fetchSettings(
  supabaseServer: ReturnType<typeof import("@/lib/supabase-server").createServerSupabase>,
) {
  const { data, error } = await supabaseServer
    .from("app_settings")
    .select("key, value")
    .in("key", ALL_SETTINGS_KEYS);
  if (error) throw error;
  const map = new Map<string, string | null>();
  (data ?? []).forEach((row: { key: string; value: string | null }) => {
    map.set(row.key, row.value?.trim() ?? null);
  });
  ALL_SETTINGS_KEYS.forEach((k) => {
    if (!map.has(k)) map.set(k, null);
  });
  return map;
}

/** 读取所有邮件相关设置 */
export async function GET(request: Request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.ok) return auth.response;

    const settings = await fetchSettings(auth.supabaseServer);

    return NextResponse.json(Object.fromEntries(settings));
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Settings Error]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** 保存单个设置项 */
export async function PUT(request: Request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.ok) return auth.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "请求体不是有效的 JSON" }, { status: 400 });
    }
    if (body === null) return NextResponse.json({ error: "缺少参数" }, { status: 400 });

    const { key, value } = body as { key?: unknown; value?: unknown };
    if (typeof key !== "string" || !ALL_SETTINGS_KEYS.includes(key as SettingsKey)) {
      return NextResponse.json({ error: "无效的设置键" }, { status: 400 });
    }
    if (typeof value !== "string") return NextResponse.json({ error: "缺少参数" }, { status: 400 });

    const typedKey = key as SettingsKey;
    const maxLength = KEY_MAX_LENGTHS[typedKey];

    const trimmed = value.trim();
    if (trimmed.includes("\u0000"))
      return NextResponse.json({ error: "包含非法字符" }, { status: 400 });

    if (trimmed === "") {
      const { error } = await auth.supabaseServer.from("app_settings").delete().eq("key", typedKey);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true }, { status: 200 });
    }

    if (trimmed.length > maxLength) {
      return NextResponse.json({ error: `长度不能超过 ${maxLength} 字` }, { status: 400 });
    }

    const { error } = await auth.supabaseServer.from("app_settings").upsert({
      key: typedKey,
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
