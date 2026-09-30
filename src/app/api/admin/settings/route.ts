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
      // ⚠️ **Issue #368 在本处的结论是反的：0 行按成功处理。** 判据是这条 DELETE 的
      // **语义**，不是「客户端不好改」：
      //   · 它不是「删除某条已知存在的记录」，而是 `saveSetting(key, "")` 的落地形式，
      //     意图是**让这个键不存在**；
      //   · 「本来就不存在」正是它想要的结果 ⇒ 0 行 == 目标状态已达成，不是失败。
      // 对照其余各处：那些是按主键/外键**定向**的写（`.eq("id", …)`），0 行意味着
      // 「我要改/删的那一行没动过」，所以才是假成功。分界是**定向写 vs 幂等写**，
      // 不是「这是第几处」。同属幂等那一侧的还有 `useRehearsals.remove` 里清考勤子行
      // 那一步（子行已被 CASCADE 带走，0 行同样是目标状态）。
      // 「要防 RLS 静默拒绝」这条理由在这里也不成立：本路由用的是 `supabaseServer`
      // （service role，绕过 RLS，只用在 API route 里），0 行只可能来自「本来就没有」。
      //
      // `.select("key")` 仍然保留：`app_settings` 的主键就是 `key`（没有 id 列），
      // 它是契约第 1 条要求的「拿回被影响的行」那条链（本仓既有约定，也是写链审计的
      // 判据），只是本处**不据此判失败**。
      const { error } = await auth.supabaseServer
        .from("app_settings")
        .delete()
        .eq("key", typedKey)
        .select("key");
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      // 0 行与删掉 1 行返回**同一个**响应（回归守卫见 route.test.ts 里
      // 「email-settings 整 tab 全字段保存」那条）
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
