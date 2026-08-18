import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { GET, POST } from "./route";
import type { Database } from "@/types/database.types";
import { deleteTestUser, sweepTestUsers } from "@/__tests__/e2e-utils";

// ============================================================
// GET/POST /api/admin/leave 端到端测试（需 Supabase service role）
// 参考 settings route 的端到端模式：临时用户 + 临时排练 → 调 handler → 清理。
// 缺少环境变量或测试环境准备失败（网络波动）时整组优雅跳过。
// ============================================================
function envReady(): boolean {
  return !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/** 构造带 Bearer token 的请求 */
function authRequest(token: string, init: RequestInit = {}): Request {
  return new Request("http://localhost/api/admin/leave", {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
}

describe("GET/POST /api/admin/leave", () => {
  let authSb: SupabaseClient<Database>;
  let dbSb: SupabaseClient<Database>;
  let ready = false;
  let adminToken = "";
  let memberToken = "";
  let adminUserId = "";
  let memberUserId = "";
  let rehearsalId = 0;

  beforeAll(async () => {
    if (!envReady()) {
      console.log("⚠️ 缺少 Supabase 配置，跳过 leave 端到端测试");
      return;
    }
    try {
      const storageSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      authSb = createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL as string,
        process.env.SUPABASE_SERVICE_ROLE_KEY as string,
        { auth: { storageKey: `leave-auth-${storageSuffix}` } },
      );
      dbSb = createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL as string,
        process.env.SUPABASE_SERVICE_ROLE_KEY as string,
        { auth: { storageKey: `leave-db-${storageSuffix}` } },
      );
      const stamp = Date.now();

      // 0. 预清扫历史残留测试账号
      await sweepTestUsers(dbSb);

      // 1. 创建临时 admin
      const adminEmail = `leave-admin-${stamp}@pkuso.test`;
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
        full_name: "Leave Admin",
        status: "approved",
        role: "admin",
      } as never);

      // 2. 创建临时 member（用于申请与 403 用例）
      const memberEmail = `leave-member-${stamp}@pkuso.test`;
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
        full_name: "Leave Member",
        instrument: "第二小提琴",
        status: "approved",
        role: "member",
      } as never);

      // 3. 创建临时排练（leave_requests 外键依赖）
      const { data: reh, error: rehErr } = await dbSb
        .from("rehearsals")
        .insert({
          repertoire: "测试排练",
          type: "full",
          start_time: "2026-08-16T13:00:00",
          end_time: "2026-08-16T16:00:00",
          location: "排练厅",
        } as never)
        .select("id")
        .single();
      if (rehErr || !reh) throw new Error(`创建测试排练失败：${rehErr?.message}`);
      rehearsalId = (reh as { id: number }).id;

      // 4. 登录拿 token
      const adminSession = await authSb.auth.signInWithPassword({
        email: adminEmail,
        password: `pw-admin-${stamp}`,
      });
      if (!adminSession.data.session?.access_token) throw new Error("无法登录 admin 测试用户");
      adminToken = adminSession.data.session.access_token;

      const memberSession = await authSb.auth.signInWithPassword({
        email: memberEmail,
        password: `pw-member-${stamp}`,
      });
      if (!memberSession.data.session?.access_token) throw new Error("无法登录 member 测试用户");
      memberToken = memberSession.data.session.access_token;

      ready = true;
    } catch (err) {
      console.log("⚠️ leave 测试环境准备失败，跳过：", err);
    }
  }, 90000);

  afterAll(async () => {
    if (!ready) return;
    // 清理顺序：先删引用 rehearsals 的 attendances/leave_requests，再删排练，最后删用户
    const cleanupErrors: string[] = [];
    // PromiseLike 兼容 supabase-js 的 PostgrestBuilder（仅有 then 的 thenable）
    const step = async (label: string, fn: () => PromiseLike<unknown>) => {
      try {
        await fn();
      } catch (err) {
        cleanupErrors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    await step("attendances", () =>
      dbSb.from("attendances").delete().eq("rehearsal_id", rehearsalId),
    );
    await step("leave_requests", () =>
      dbSb.from("leave_requests").delete().eq("rehearsal_id", rehearsalId),
    );
    await step("rehearsals", () => dbSb.from("rehearsals").delete().eq("id", rehearsalId));
    await step("admin user", () => deleteTestUser(dbSb, adminUserId));
    await step("member user", () => deleteTestUser(dbSb, memberUserId));
    if (cleanupErrors.length > 0) {
      throw new Error(`清理失败: ${cleanupErrors.join("; ")}`);
    }
  }, 60000);

  /** 建一条 pending 申请（返回 id） */
  async function createPendingRequest(reason = "生病请假"): Promise<string> {
    const { data, error } = await dbSb
      .from("leave_requests")
      .insert({
        rehearsal_id: rehearsalId,
        user_id: memberUserId,
        reason,
        target_status: "excused",
      } as never)
      .select("id")
      .single();
    if (error || !data) throw new Error(`创建测试申请失败：${error?.message}`);
    return (data as { id: string }).id;
  }

  /** 查 leave_requests 行 */
  async function getRequest(id: string) {
    const { data } = await dbSb.from("leave_requests").select("*").eq("id", id).maybeSingle();
    return data as {
      status: string;
      reject_reason: string | null;
      user_id: string;
      rehearsal_id: number;
      target_status: string;
    } | null;
  }

  /** 查 attendances 行 */
  async function getAttendance() {
    const { data } = await dbSb
      .from("attendances")
      .select("*")
      .eq("rehearsal_id", rehearsalId)
      .eq("user_id", memberUserId)
      .maybeSingle();
    return data as { status: string; sign_in_time: string | null } | null;
  }

  /** 查成员最近收到的通知（created_at 倒序，Issue #188 断言用） */
  async function getMemberNotifications() {
    const { data } = await dbSb
      .from("notifications")
      .select("id, category, title, content")
      .eq("user_id", memberUserId)
      .order("created_at", { ascending: false });
    return (data ?? []) as { id: string; category: string; title: string; content: string }[];
  }

  // ---- 鉴权 ----
  it("GET 未带 token → 401", { timeout: 20000 }, async () => {
    if (!ready) return;
    const res = await GET(new Request("http://localhost/api/admin/leave"));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("未授权");
  });

  it("GET 非 admin → 403", { timeout: 20000 }, async () => {
    if (!ready) return;
    const res = await GET(authRequest(memberToken));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("权限不足");
  });

  // ---- 参数校验 ----
  it("POST 非法 JSON → 400", { timeout: 20000 }, async () => {
    if (!ready) return;
    const res = await POST(authRequest(adminToken, { method: "POST", body: "not-json" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("请求体不是有效的 JSON");
  });

  it("POST 未知 action → 400", { timeout: 20000 }, async () => {
    if (!ready) return;
    const res = await POST(
      authRequest(adminToken, {
        method: "POST",
        body: JSON.stringify({ action: "hack", ids: ["x"] }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("POST reject 缺原因 → 400（必填校验）", { timeout: 20000 }, async () => {
    if (!ready) return;
    const res = await POST(
      authRequest(adminToken, {
        method: "POST",
        body: JSON.stringify({ action: "reject", ids: ["x"] }),
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("缺少驳回原因");
  });

  it("POST reject 空白原因 → 400", { timeout: 20000 }, async () => {
    if (!ready) return;
    const res = await POST(
      authRequest(adminToken, {
        method: "POST",
        body: JSON.stringify({ action: "reject", ids: ["x"], reject_reason: "   " }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("POST ids 非数组 → 400", { timeout: 20000 }, async () => {
    if (!ready) return;
    const res = await POST(
      authRequest(adminToken, {
        method: "POST",
        body: JSON.stringify({ action: "approve", ids: "x" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  // ---- GET 列表（含 join）----
  it("GET admin → 返回申请列表（含成员与排练 join）", { timeout: 20000 }, async () => {
    if (!ready) return;
    const id = await createPendingRequest("列表测试原因");
    try {
      const res = await GET(authRequest(adminToken));
      expect(res.status).toBe(200);
      const body = await res.json();
      const mine = body.requests.find((r: { id: string }) => r.id === id);
      expect(mine).toBeTruthy();
      expect(mine.reason).toBe("列表测试原因");
      expect(mine.profiles?.full_name).toBe("Leave Member");
      expect(mine.profiles?.instrument).toBe("第二小提琴");
      expect(mine.rehearsals?.repertoire).toBe("测试排练");
      expect(mine.rehearsals?.location).toBe("排练厅");
    } finally {
      await dbSb.from("leave_requests").delete().eq("id", id);
    }
  });

  // ---- approve 联动考勤（返工：sign_in_time 守卫）----
  it(
    "POST approve 成员已签到（sign_in_time 非空）：考勤不被覆盖、返回 warning（返工）",
    { timeout: 20000 },
    async () => {
      if (!ready) return;
      const id = await createPendingRequest();
      // 预置考勤行：已签到（sign_in_time 非空，签到锁定语义），状态缺勤
      await dbSb.from("attendances").insert({
        rehearsal_id: rehearsalId,
        user_id: memberUserId,
        status: "absent",
        sign_in_time: "2026-08-16T13:05:00",
      } as never);
      try {
        const res = await POST(
          authRequest(adminToken, {
            method: "POST",
            body: JSON.stringify({ action: "approve", ids: [id] }),
          }),
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        // 申请照常置 approved（进 processed 供管理端本地移除），并返回 warning 让管理员知晓
        expect(body.processed).toEqual([id]);
        expect(body.warnings).toHaveLength(1);
        expect(body.warnings[0].id).toBe(id);
        expect(body.warnings[0].message).toContain("已签到");

        const req = await getRequest(id);
        expect(req?.status).toBe("approved");

        // 考勤不被覆盖：「已签到但请假」不可恢复矛盾（返工）——
        // status 保持 absent（不改为 excused），sign_in_time 保持原值
        const att = await getAttendance();
        expect(att?.status).toBe("absent");
        expect(att?.sign_in_time).toBe("2026-08-16T13:05:00");
      } finally {
        await dbSb.from("attendances").delete().eq("rehearsal_id", rehearsalId);
        await dbSb.from("leave_requests").delete().eq("id", id);
        // 清理本用例插入的通知行（避免跨用例累积）
        await dbSb.from("notifications").delete().eq("user_id", memberUserId);
      }
    },
  );

  it(
    "POST approve 考勤行存在且未签到（sign_in_time 为空）：仅改 status、不返回 warning",
    { timeout: 20000 },
    async () => {
      if (!ready) return;
      const id = await createPendingRequest();
      // 预置考勤行：未签到（sign_in_time 为空），状态缺勤
      await dbSb.from("attendances").insert({
        rehearsal_id: rehearsalId,
        user_id: memberUserId,
        status: "absent",
        sign_in_time: null,
      } as never);
      try {
        const res = await POST(
          authRequest(adminToken, {
            method: "POST",
            body: JSON.stringify({ action: "approve", ids: [id] }),
          }),
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.processed).toEqual([id]);
        expect(body.warnings).toEqual([]);

        // 考勤：status 变为 excused（target_status），sign_in_time 保持空（签到锁定语义）
        const att = await getAttendance();
        expect(att?.status).toBe("excused");
        expect(att?.sign_in_time).toBeNull();
      } finally {
        await dbSb.from("attendances").delete().eq("rehearsal_id", rehearsalId);
        await dbSb.from("leave_requests").delete().eq("id", id);
        // 清理本用例插入的通知行（避免跨用例累积）
        await dbSb.from("notifications").delete().eq("user_id", memberUserId);
      }
    },
  );

  it("POST approve 无考勤行 → 补插一行（只写状态）", { timeout: 20000 }, async () => {
    if (!ready) return;
    const id = await createPendingRequest();
    // 不预置考勤行
    try {
      const res = await POST(
        authRequest(adminToken, {
          method: "POST",
          body: JSON.stringify({ action: "approve", ids: [id] }),
        }),
      );
      expect(res.status).toBe(200);

      const att = await getAttendance();
      expect(att?.status).toBe("excused");
      expect(att?.sign_in_time).toBeNull();
      // Issue #188：通过后向申请人插通知（分类/标题/文案含排练曲目）。
      // 前置用例 finally 均已清理通知行，此处 notis[0] 必为本用例插入行（created_at 倒序）
      const notis = await getMemberNotifications();
      expect(notis[0]?.category).toBe("attendance");
      expect(notis[0]?.title).toBe("请假申请已通过");
      expect(notis[0]?.content).toBe("《测试排练》排练的请假申请已通过");
    } finally {
      await dbSb.from("attendances").delete().eq("rehearsal_id", rehearsalId);
      await dbSb.from("leave_requests").delete().eq("id", id);
      // 清理本用例插入的通知行（避免跨用例累积）
      await dbSb.from("notifications").delete().eq("user_id", memberUserId);
    }
  });

  it("POST approve 已处理的申请 → 计入 failed 且不重复生效", { timeout: 20000 }, async () => {
    if (!ready) return;
    const id = await createPendingRequest();
    try {
      await POST(
        authRequest(adminToken, {
          method: "POST",
          body: JSON.stringify({ action: "approve", ids: [id] }),
        }),
      );
      const res2 = await POST(
        authRequest(adminToken, {
          method: "POST",
          body: JSON.stringify({ action: "approve", ids: [id] }),
        }),
      );
      const body2 = await res2.json();
      expect(body2.success).toBe(true);
      expect(body2.processed).toEqual([]);
      expect(body2.failed).toHaveLength(1);
      expect(body2.failed[0].id).toBe(id);
    } finally {
      await dbSb.from("attendances").delete().eq("rehearsal_id", rehearsalId);
      await dbSb.from("leave_requests").delete().eq("id", id);
      // 清理本用例插入的通知行（避免跨用例累积）
      await dbSb.from("notifications").delete().eq("user_id", memberUserId);
    }
  });

  // ---- reject ----
  it("POST reject → 状态 rejected + 保存驳回原因", { timeout: 20000 }, async () => {
    if (!ready) return;
    const id = await createPendingRequest();
    try {
      const res = await POST(
        authRequest(adminToken, {
          method: "POST",
          body: JSON.stringify({ action: "reject", ids: [id], reject_reason: "理由不充分" }),
        }),
      );
      expect(res.status).toBe(200);
      expect((await res.json()).processed).toEqual([id]);

      const req = await getRequest(id);
      expect(req?.status).toBe("rejected");
      expect(req?.reject_reason).toBe("理由不充分");
      // Issue #188：驳回后向申请人插通知（content 附驳回原因）
      const notis = await getMemberNotifications();
      expect(notis[0]?.category).toBe("attendance");
      expect(notis[0]?.title).toBe("请假申请被驳回");
      expect(notis[0]?.content).toBe("《测试排练》排练的请假申请已被驳回，原因：理由不充分");
    } finally {
      await dbSb.from("leave_requests").delete().eq("id", id);
      // 清理本用例插入的通知行（避免跨用例累积）
      await dbSb.from("notifications").delete().eq("user_id", memberUserId);
    }
  });

  // ---- 批量 ----
  it("POST 批量 approve 两条 → 全部 processed", { timeout: 20000 }, async () => {
    if (!ready) return;
    const id1 = await createPendingRequest("原因一");
    const id2 = await createPendingRequest("原因二");
    try {
      const res = await POST(
        authRequest(adminToken, {
          method: "POST",
          body: JSON.stringify({ action: "approve", ids: [id1, id2] }),
        }),
      );
      const body = await res.json();
      expect(body.processed).toEqual(expect.arrayContaining([id1, id2]));
      expect(body.failed).toEqual([]);
    } finally {
      await dbSb.from("attendances").delete().eq("rehearsal_id", rehearsalId);
      await dbSb.from("leave_requests").delete().in("id", [id1, id2]);
      // 清理本用例插入的通知行（避免跨用例累积）
      await dbSb.from("notifications").delete().eq("user_id", memberUserId);
    }
  });

  it("POST 批量 reject 同一原因应用到全部", { timeout: 20000 }, async () => {
    if (!ready) return;
    const id1 = await createPendingRequest("原因一");
    const id2 = await createPendingRequest("原因二");
    try {
      const res = await POST(
        authRequest(adminToken, {
          method: "POST",
          body: JSON.stringify({ action: "reject", ids: [id1, id2], reject_reason: "已另行安排" }),
        }),
      );
      expect((await res.json()).processed).toEqual(expect.arrayContaining([id1, id2]));

      expect((await getRequest(id1))?.reject_reason).toBe("已另行安排");
      expect((await getRequest(id2))?.reject_reason).toBe("已另行安排");
    } finally {
      await dbSb.from("leave_requests").delete().in("id", [id1, id2]);
      // 清理本用例插入的通知行（避免跨用例累积）
      await dbSb.from("notifications").delete().eq("user_id", memberUserId);
    }
  });

  // ---- signed-url ----
  it("POST signed-url → 返回签名链接", { timeout: 20000 }, async () => {
    if (!ready) return;
    // Storage sign 端点要求对象真实存在：先上传测试附件再签名
    const testPath = `${memberUserId}/signed-test.txt`;
    const { error: upErr } = await dbSb.storage
      .from("leave-attachments")
      .upload(testPath, new Uint8Array([1, 2, 3]), { contentType: "text/plain" });
    if (upErr) throw new Error(`上传测试附件失败：${upErr.message}`);
    try {
      const res = await POST(
        authRequest(adminToken, {
          method: "POST",
          body: JSON.stringify({ action: "signed-url", path: testPath }),
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(typeof body.url).toBe("string");
      expect(body.url).toContain("leave-attachments");
    } finally {
      await dbSb.storage.from("leave-attachments").remove([testPath]);
    }
  });

  it("POST signed-url 缺 path → 400", { timeout: 20000 }, async () => {
    if (!ready) return;
    const res = await POST(
      authRequest(adminToken, {
        method: "POST",
        body: JSON.stringify({ action: "signed-url" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
