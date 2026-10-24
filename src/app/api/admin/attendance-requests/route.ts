import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/verify-admin";
import type { DecisionResult } from "@/lib/attendance-change-request";

export const runtime = "nodejs";

/**
 * P4'：管理员审批出勤修改申请。
 *
 * GET 列表：service role 读 `attendance_change_requests` + 成员/排练信息。
 * POST 审批：逐条调 backend `admin_decide_attendance_change_request`；
 * 默认不覆盖已变化的考勤（stale），只有 UI 明确确认后才带 force=true。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BATCH = 50;

type Body =
  | { action: "approve"; ids: string[]; force: boolean }
  | { action: "reject"; ids: string[]; rejectReason: string };

function readIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BATCH) return null;
  if (!value.every((id) => typeof id === "string" && UUID_RE.test(id))) return null;
  return Array.from(new Set(value));
}

function parseBody(value: unknown): Body | null {
  if (typeof value !== "object" || value === null) return null;
  const body = value as Record<string, unknown>;

  if (body.action === "approve") {
    const ids = readIds(body.ids);
    if (!ids) return null;
    if (body.force !== undefined && typeof body.force !== "boolean") return null;
    return { action: "approve", ids, force: body.force === true };
  }
  if (body.action === "reject") {
    const ids = readIds(body.ids);
    const rejectReason = typeof body.rejectReason === "string" ? body.rejectReason.trim() : "";
    if (!ids || rejectReason === "") return null;
    return { action: "reject", ids, rejectReason };
  }
  return null;
}

function interpretRpcResult(id: string, data: unknown): DecisionResult {
  const result = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  if (result.ok === true) {
    return {
      id,
      ok: true,
      status: result.status === "rejected" ? "rejected" : "approved",
    };
  }
  return {
    id,
    ok: false,
    code: typeof result.code === "string" ? result.code : "unknown",
    currentStatus: typeof result.current_status === "string" ? result.current_status : undefined,
  };
}

export async function GET(request: Request) {
  const auth = await verifyAdmin(request);
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabaseServer
    .from("attendance_change_requests")
    .select(
      [
        "*",
        "target:profiles!attendance_change_requests_target_user_id_fkey(full_name, instrument)",
        "requester:profiles!attendance_change_requests_requested_by_fkey(full_name, instrument)",
        "decider:profiles!attendance_change_requests_decided_by_fkey(full_name)",
        "rehearsals(repertoire, title, start_time, end_time, type, target_section)",
      ].join(","),
    )
    .in("status", ["pending", "approved", "rejected"])
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[Attendance Requests] list failed", error);
    return NextResponse.json({ error: "获取考勤修改申请失败" }, { status: 500 });
  }
  return NextResponse.json({ requests: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await verifyAdmin(request);
  if (!auth.ok) return auth.response;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是有效的 JSON" }, { status: 400 });
  }

  const body = parseBody(raw);
  if (!body) return NextResponse.json({ error: "请求参数不完整" }, { status: 400 });

  const results: DecisionResult[] = [];
  for (const id of body.ids) {
    const { data, error } = await auth.supabaseServer.rpc(
      "admin_decide_attendance_change_request",
      {
        p_request_id: id,
        p_approve: body.action === "approve",
        p_reject_reason: body.action === "reject" ? body.rejectReason : "",
        p_force: body.action === "approve" ? body.force : false,
        p_actor_id: auth.userId,
      },
    );
    if (error) {
      console.error("[Attendance Requests] decide failed", id, error);
      results.push({ id, ok: false, code: "rpc_error", message: error.message });
      continue;
    }
    results.push(interpretRpcResult(id, data));
  }

  return NextResponse.json({ results });
}
