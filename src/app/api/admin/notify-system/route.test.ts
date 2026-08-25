import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { POST } from "./route";
import type { Database } from "@/types/database.types";
import {
  deleteTestUser,
  sweepTestUsers,
  sweepTestNotifications,
  TEST_NOTIFY_TITLE_PREFIX,
} from "@/__tests__/e2e-utils";

// ============================================================
// POST /api/admin/notify-system 端到端测试（需 Supabase service role）
// 参考 leave route 的端到端模式：临时 admin + 临时成员 → 调 handler → 断言广播 → 清理。
// 缺少环境变量或测试环境准备失败（网络波动）时整组优雅跳过。
//
// ⚠️ 广播会落到真实成员信箱（route 拉全体 approved）：标题必须用
// TEST_NOTIFY_TITLE_PREFIX 前缀 + 运行级时间戳的唯一标记，
// 清理按精确标题全量删除（含真实成员收到的），否则每次运行都会
// 给真实用户留下永久垃圾（曾积压 24 条发到 8 个真实成员）。
// ============================================================
function envReady(): boolean {
  return !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function authRequest(token: string, body: unknown): Request {
  return new Request("http://localhost/api/admin/notify-system", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/notify-system", () => {
  let authSb: SupabaseClient<Database>;
  let dbSb: SupabaseClient<Database>;
  let ready = false;
  let adminToken = "";
  let adminUserId = "";
  let memberUserId = "";
  let pendingUserId = "";
  // 本轮广播的唯一标记（标题/内容带时间戳）：断言与清理共用，
  // 精确匹配保证不误删真实通知、也不误删并行运行的其他轮次
  let broadcastTitle = "";
  let broadcastContent = "";

  beforeAll(async () => {
    if (!envReady()) {
      console.log("⚠️ 缺少 Supabase 配置，跳过 notify-system 端到端测试");
      return;
    }
    try {
      const storageSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      authSb = createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL as string,
        process.env.SUPABASE_SERVICE_ROLE_KEY as string,
        { auth: { storageKey: `ns-auth-${storageSuffix}` } },
      );
      dbSb = createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL as string,
        process.env.SUPABASE_SERVICE_ROLE_KEY as string,
        { auth: { storageKey: `ns-db-${storageSuffix}` } },
      );
      const stamp = Date.now();
      await sweepTestUsers(dbSb);
      // 预清扫历史残留的测试广播（CI 超时被杀等导致 afterAll 未执行的场景）
      await sweepTestNotifications(dbSb);

      // 本轮广播的唯一标记：[e2e] 前缀供预清扫识别，时间戳保证运行间不串扰
      broadcastTitle = `${TEST_NOTIFY_TITLE_PREFIX} 元旦汇演通知 ${stamp}`;
      broadcastContent = `请于 12 月 31 日 19:00 到场 [e2e:${stamp}]`;

      // 1. 临时 admin
      const adminEmail = `ns-admin-${stamp}@pkuso.test`;
      const admin = await authSb.auth.admin.createUser({
        email: adminEmail,
        password: `pw-admin-${stamp}`,
        email_confirm: true,
      } as never);
      if (!admin.data?.user?.id) throw new Error("无法创建 admin 测试用户");
      adminUserId = admin.data.user.id;
      await dbSb.from("profiles").upsert({
        id: adminUserId,
        email: adminEmail,
        full_name: "NS Admin",
        status: "approved",
        role: "admin",
      } as never);

      // 2. 临时已批准成员（应收到广播）
      const memberEmail = `ns-member-${stamp}@pkuso.test`;
      const member = await authSb.auth.admin.createUser({
        email: memberEmail,
        password: `pw-member-${stamp}`,
        email_confirm: true,
      } as never);
      if (!member.data?.user?.id) throw new Error("无法创建 member 测试用户");
      memberUserId = member.data.user.id;
      await dbSb.from("profiles").upsert({
        id: memberUserId,
        email: memberEmail,
        full_name: "NS Member",
        instrument: "第二小提琴",
        status: "approved",
        role: "member",
      } as never);

      // 3. 临时待审批成员（不应收到广播）
      const pendingEmail = `ns-pending-${stamp}@pkuso.test`;
      const pending = await authSb.auth.admin.createUser({
        email: pendingEmail,
        password: `pw-pending-${stamp}`,
        email_confirm: true,
      } as never);
      if (!pending.data?.user?.id) throw new Error("无法创建 pending 测试用户");
      pendingUserId = pending.data.user.id;
      await dbSb.from("profiles").upsert({
        id: pendingUserId,
        email: pendingEmail,
        full_name: "NS Pending",
        status: "pending",
        role: "member",
      } as never);

      // 4. 登录拿 admin token
      const adminSession = await authSb.auth.signInWithPassword({
        email: adminEmail,
        password: `pw-admin-${stamp}`,
      });
      if (!adminSession.data.session?.access_token) throw new Error("无法登录 admin 测试用户");
      adminToken = adminSession.data.session.access_token;

      ready = true;
    } catch (err) {
      console.log("⚠️ notify-system 测试环境准备失败，跳过：", err);
    }
  }, 90000);

  afterAll(async () => {
    if (!ready) return;
    const cleanupErrors: string[] = [];
    const step = async (label: string, fn: () => PromiseLike<unknown>) => {
      try {
        await fn();
      } catch (err) {
        cleanupErrors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    // 清理顺序：先按精确标题全量清（含真实成员误投递 + 测试账号信箱），
    // 再按 user_id 兜底清测试账号信箱，最后清历史存档与临时用户。
    // 每步独立容错：任一步失败记录并继续，最终汇总抛错让测试失败（不允许静默垃圾）
    await step("notifications(按标题全量)", () =>
      dbSb.from("notifications").delete().eq("title", broadcastTitle),
    );
    await step("notifications(测试账号信箱)", () =>
      dbSb.from("notifications").delete().in("user_id", [adminUserId, memberUserId, pendingUserId]),
    );
    await step("system_notifications", () =>
      dbSb.from("system_notifications").delete().eq("title", broadcastTitle),
    );
    await step("admin user", () => deleteTestUser(dbSb, adminUserId));
    await step("member user", () => deleteTestUser(dbSb, memberUserId));
    await step("pending user", () => deleteTestUser(dbSb, pendingUserId));
    if (cleanupErrors.length > 0) {
      throw new Error(`清理失败: ${cleanupErrors.join("; ")}`);
    }
  }, 60000);

  it("未带 token → 401", { timeout: 20000 }, async () => {
    if (!ready) return;
    const res = await POST(
      new Request("http://localhost/api/admin/notify-system", { method: "POST" }),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("未授权");
  });

  it("空标题/内容 → 400", { timeout: 20000 }, async () => {
    if (!ready) return;
    const res = await POST(authRequest(adminToken, { title: "", content: "" }));
    expect(res.status).toBe(400);
  });

  it("发布成功：向全体已批准成员广播（pending 除外）", { timeout: 30000 }, async () => {
    if (!ready) return;
    const title = broadcastTitle;
    const content = broadcastContent;
    const res2 = await POST(authRequest(adminToken, { title, content }));
    const body = (await res2.json()) as { success?: boolean; count?: number; error?: string };
    expect(res2.status).toBe(200);
    expect(body.success).toBe(true);
    // 至少覆盖本测试创建的 admin 与已批准 member（并行测试可能增删其他账号，故用下界断言）
    expect(body.count).toBeGreaterThanOrEqual(2);

    // 历史表写入 1 条
    const { count: histCount } = await dbSb
      .from("system_notifications")
      .select("id", { count: "exact", head: true })
      .eq("publisher_id", adminUserId);
    expect(histCount).toBe(1);

    // 已批准成员收到 category=system 通知
    const { data: memberNotifs } = await dbSb
      .from("notifications")
      .select("id, category, title, content")
      .eq("user_id", memberUserId);
    const m = (memberNotifs ?? []) as { category: string; title: string; content: string }[];
    expect(m.length).toBeGreaterThanOrEqual(1);
    expect(
      m.some((n) => n.category === "system" && n.title === title && n.content === content),
    ).toBe(true);

    // 待审批成员未收到任何通知
    const { data: pendingNotifs } = await dbSb
      .from("notifications")
      .select("id")
      .eq("user_id", pendingUserId);
    expect((pendingNotifs ?? []).length).toBe(0);
  });
});
