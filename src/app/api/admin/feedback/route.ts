import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/verify-admin";

export const runtime = "nodejs";

/**
 * 反馈管理端 API（Issue #210）。
 * - DELETE ?id=：service role 删除指定反馈（管理员治理垃圾反馈的唯一途径——
 *   feedback 表无 DELETE RLS 策略，浏览器端无法直删）。
 * 0 行检测：`.select("id")` 返回空数组时视为「不存在或已被删除」，返回 404，
 * 防止并发重复删除被误报成功。
 */
export async function DELETE(request: Request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.ok) return auth.response;

    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "缺少参数" }, { status: 400 });

    const { data, error } = await auth.supabaseServer
      .from("feedback")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) {
      return NextResponse.json({ error: "反馈不存在或已被删除" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Feedback Admin Error]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
