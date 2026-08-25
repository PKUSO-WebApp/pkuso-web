import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { POST } from "./route";
import type { Database } from "@/types/database.types";
import { deleteTestUser, sweepTestUsers } from "@/__tests__/e2e-utils";

// ============================================================
// POST /api/admin/notify-system 端到端测试（需 Supabase service role）
// 参考 leave route 的端到端模式：临时 admin + 临时成员 → 调 handler → 断言广播 → 清理。
// 缺少环境变量或测试环境准备失败（网络波动）时整组优雅跳过。
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
    // 清理广播产生的通知与本测试创建的系统通知历史
    await step("notifications", () =>
      dbSb.from("notifications").delete().in("user_id", [adminUserId, memberUserId, pendingUserId]),
    );
    await step("system_notifications", () =>
      dbSb.from("system_notifications").delete().eq("publisher_id", adminUserId),
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
    const title = "元旦汇演通知";
    const content = "请于 12 月 31 日 19:00 到场";
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
