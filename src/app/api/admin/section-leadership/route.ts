import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/verify-admin";

export const runtime = "nodejs";

/**
 * P0c：声部长 / 首席任命（admin-only）。
 *
 * 角色表对 authenticated 没有写权限；这里用 verifyAdmin 的 service_role 客户端调
 * backend P0b 的 admin RPC。`p_actor_id` 取真实登录 admin，RPC 内还会再校验一次。
 */

type Body =
  | { action: "set_section_leader"; section: string; userId: string }
  | { action: "remove_section_leader"; section: string }
  | { action: "set_principal"; instrument: string; userId: string }
  | { action: "remove_principal"; instrument: string };

const ERROR_MESSAGES: Record<string, string> = {
  invalid_scope: "该作用域不能任命",
  target_not_eligible: "该成员不是可任命的在册团员",
  target_not_in_scope: "该成员不属于这个声部",
  scope_overlap: "该作用域与已有任命冲突，请先撤销冲突项",
  actor_not_admin: "权限不足",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function parseBody(value: unknown): Body | null {
  if (typeof value !== "object" || value === null) return null;
  const body = value as Record<string, unknown>;

  if (body.action === "set_section_leader") {
    const section = readString(body.section);
    const userId = readString(body.userId);
    if (!section || !userId || !UUID_RE.test(userId)) return null;
    return { action: body.action, section, userId };
  }
  if (body.action === "remove_section_leader") {
    const section = readString(body.section);
    return section ? { action: body.action, section } : null;
  }
  if (body.action === "set_principal") {
    const instrument = readString(body.instrument);
    const userId = readString(body.userId);
    if (!instrument || !userId || !UUID_RE.test(userId)) return null;
    return { action: body.action, instrument, userId };
  }
  if (body.action === "remove_principal") {
    const instrument = readString(body.instrument);
    return instrument ? { action: body.action, instrument } : null;
  }
  return null;
}

function interpretError(error: { message?: string; code?: string }): {
  message: string;
  code?: string;
  status: number;
} {
  const raw = error.message ?? "";
  const key = Object.keys(ERROR_MESSAGES).find((candidate) => raw.startsWith(candidate));
  if (key) {
    return {
      message: ERROR_MESSAGES[key],
      code: key,
      status: key === "actor_not_admin" ? 403 : 400,
    };
  }
  if (error.code === "42501") return { message: "权限不足", status: 403 };
  return { message: "保存失败，请重试", status: 500 };
}

export async function POST(request: Request) {
  const auth = await verifyAdmin(request);
  if (!auth.ok) return auth.response;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const body = parseBody(raw);
  if (!body) return NextResponse.json({ error: "请求参数不完整" }, { status: 400 });

  const result =
    body.action === "set_section_leader"
      ? await auth.supabaseServer.rpc("admin_set_section_leader", {
          p_section: body.section,
          p_leader_id: body.userId,
          p_actor_id: auth.userId,
        })
      : body.action === "remove_section_leader"
        ? await auth.supabaseServer.rpc("admin_remove_section_leader", {
            p_section: body.section,
            p_actor_id: auth.userId,
          })
        : body.action === "set_principal"
          ? await auth.supabaseServer.rpc("admin_set_principal", {
              p_instrument: body.instrument,
              p_principal_id: body.userId,
              p_actor_id: auth.userId,
            })
          : await auth.supabaseServer.rpc("admin_remove_principal", {
              p_instrument: body.instrument,
              p_actor_id: auth.userId,
            });

  if (result.error) {
    const interpreted = interpretError(result.error);
    return NextResponse.json(
      { error: interpreted.message, code: interpreted.code },
      { status: interpreted.status },
    );
  }

  return NextResponse.json({ ok: true });
}
