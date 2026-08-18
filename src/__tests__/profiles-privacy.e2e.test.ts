import { describe, it, expect } from "vitest";
import { deleteTestUser, sweepTestUsers } from "./e2e-utils";

// ============================================================
// Issue #193 个人信息隐私：成员写路径权限回归（真实连库 E2E）
//
// 背景（本轮 ACL 风波的核心教训）：20260818165318 撤销 anon/authenticated 对
// profiles 敏感三列（email/phone_number/join_date）的表级 SELECT，改为视图
// profiles_roster 统一读取。写路径上，前端 useProfiles.update 以
// `PATCH /rest/v1/profiles?select=id&id=eq.<id>`（prefer: return=representation）
// 更新自己的档案——若未来有人去掉 `.select("id")`，supabase-js 仍会发送
// prefer: return=representation，PostgREST 的 RETURNING * 触碰无 SELECT 权限的
// 敏感列而被拒（403/42501；无 prefer 的裸 PATCH 反而 204 成功，不构成边界）。
// 本用例固化：
//   a) 带 select=id 的真实前端形态写路径必须成功（200 且返回 id）；
//   b) 无 select + prefer=return=representation 必须失败（403/42501），
//      防止"去掉 .select('id') 静默成功"或"改回表级全列授权"；
//   c) 视图掩码双向正确：本人视角 email 原值、匿名视角 email 为 NULL。
//
// 缺 env（NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY /
// SUPABASE_SERVICE_ROLE_KEY）则跳过。清理顺序与 notify.test.ts 一致：
// 先 profiles 后 auth.users（profiles_id_fkey 外键约束）。
// ============================================================

describe("Issue #193 profiles 隐私：成员写路径权限回归（真实连库 E2E）", () => {
  it(
    "临时成员：PATCH 带 select=id 成功 → 视图掩码双向验证 → 裸 PATCH 403 → 清理",
    { timeout: 60000 },
    async () => {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!supabaseUrl || !anonKey || !serviceRoleKey) {
        console.log("⚠️ 缺少 Supabase 配置，跳过端到端测试");
        return;
      }

      const { createClient } = await import("@supabase/supabase-js");
      // service role client 必须 persistSession:false：jsdom 的 localStorage 全局共享，
      // 其他测试/本测试的登录 session 会被新建 client 在初始化时恢复并注入 REST 请求
      // （角色降为 authenticated → 直查敏感列 42501、清理被 RLS 静默拒）
      const sb = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      // 登录用独立 anon client：绝不在 sb 上 signInWithPassword；同样不持久化，
      // 避免登录 session 写入全局 localStorage 污染其他测试
      const userClient = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      // 0. 预清扫历史残留测试账号（创建临时用户前执行，保证环境干净）
      await sweepTestUsers(sb);

      // 1. 创建临时成员（email_confirm + 密码登录拿真实 JWT）
      const testEmail = `e2e-privacy-${Date.now()}@pkuso.test`;
      const testPassword = `pw-${Date.now()}`;

      const { data: newUser } = await sb.auth.admin.createUser({
        email: testEmail,
        password: testPassword,
        email_confirm: true,
      } as never);
      // error 与 id 可能同时存在（半失败）：只要拿到 id 就继续进入后续清理路径
      if (!newUser?.user?.id) {
        console.log("⚠️ 无法创建测试用户，跳过");
        return;
      }
      const userId = newUser.user.id;

      // 2. upsert approved member profile（含敏感三列原值 + 初始学院）
      await sb.from("profiles").upsert({
        id: userId,
        email: testEmail,
        full_name: "隐私测试成员",
        status: "approved",
        role: "member",
        college: "初始学院",
        phone_number: "13800000000",
        join_date: "2024-09-01",
        hide_email: false,
        hide_phone: false,
        hide_join_date: false,
      } as never);

      try {
        // 3. 密码登录拿真实 JWT（authenticated 角色，在独立的 userClient 上进行）
        const { data: session } = await userClient.auth.signInWithPassword({
          email: testEmail,
          password: testPassword,
        });
        const token = session?.session?.access_token;
        if (!token) {
          throw new Error("无法登录测试用户");
        }

        // 4. 前端真实形态写路径：PATCH /rest/v1/profiles?select=id&id=eq.<本人id>
        //    + prefer: return=representation（等价 useProfiles.update 的
        //    client.from("profiles").update(payload).eq("id", id).select("id")）
        const patchUrl = `${supabaseUrl}/rest/v1/profiles?select=id&id=eq.${userId}`;
        const patchRes = await fetch(patchUrl, {
          method: "PATCH",
          headers: {
            apikey: anonKey,
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            prefer: "return=representation",
          },
          body: JSON.stringify({ hide_email: true, college: "测试学院" }),
        });
        expect(patchRes.status).toBe(200);
        const patchBody = (await patchRes.json()) as Array<{ id: string }>;
        expect(Array.isArray(patchBody)).toBe(true);
        expect(patchBody).toHaveLength(1);
        expect(patchBody[0].id).toBe(userId);

        // 4.5 service role 直查表：确认写路径真实落库（不被视图/掩码干扰）
        const { data: dbRow } = await sb
          .from("profiles")
          .select("id, email, college, hide_email")
          .eq("id", userId)
          .maybeSingle();
        expect(dbRow?.hide_email).toBe(true);
        expect(dbRow?.college).toBe("测试学院");
        expect(dbRow?.email).toBe(testEmail);

        // 5. 视图读回验证：本人视角（auth.uid() = id 分支）email 保持原值，掩码不误伤本人
        const selfRes = await fetch(
          `${supabaseUrl}/rest/v1/profiles_roster?select=id,email,college,phone_number,join_date,hide_email,hide_phone,hide_join_date&id=eq.${userId}`,
          {
            headers: {
              apikey: anonKey,
              authorization: `Bearer ${token}`,
            },
          },
        );
        expect(selfRes.status).toBe(200);
        const selfRows = (await selfRes.json()) as Array<{
          id: string;
          email: string | null;
          college: string | null;
          phone_number: string | null;
          join_date: string | null;
          hide_email: boolean;
        }>;
        expect(selfRows).toHaveLength(1);
        expect(selfRows[0].email).toBe(testEmail);
        expect(selfRows[0].college).toBe("测试学院");
        expect(selfRows[0].hide_email).toBe(true);
        // 其余隐私开关未动，本人视角原值可见
        expect(selfRows[0].phone_number).toBe("13800000000");
        expect(selfRows[0].join_date).toBe("2024-09-01");

        // 5.5 匿名视角（无 JWT，anon 角色）：行可见（status=approved）但 email 被掩码为 NULL
        const anonRes = await fetch(
          `${supabaseUrl}/rest/v1/profiles_roster?select=id,email,college&id=eq.${userId}`,
          {
            headers: { apikey: anonKey },
          },
        );
        expect(anonRes.status).toBe(200);
        const anonRows = (await anonRes.json()) as Array<{
          id: string;
          email: string | null;
          college: string | null;
        }>;
        expect(anonRows).toHaveLength(1);
        expect(anonRows[0].id).toBe(userId);
        expect(anonRows[0].email).toBeNull(); // hide_email=true → CASE 走 NULL 分支
        expect(anonRows[0].college).toBe("测试学院"); // 非敏感列匿名可读

        // 6. 反向断言：去掉 .select("id") 的 PATCH → 期望 403（42501）
        //    固化掩码设计边界。两种裸 PATCH 形态（实测）：
        //      - 无 select + 无 prefer（PostgREST 默认 return=minimal）→ 204 成功
        //        （RETURNING id，id 有列级 SELECT 授权，边界未被拒——这不构成约束）
        //      - 无 select + prefer: return=representation → 403/42501
        //        （RETURNING * 触碰敏感三列，anon/authenticated 无 SELECT 权限）
        //    supabase-js 的 update() 默认 prefer 头即 return=representation，
        //    故本形态等价"前端 useProfiles.update 去掉 .select('id')"的真实回归：
        //    一旦有人删除 .select("id")，更新会被列级权限拒绝而非静默成功。
        const bareRes = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
          method: "PATCH",
          headers: {
            apikey: anonKey,
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            prefer: "return=representation",
          },
          body: JSON.stringify({ college: "裸补丁不应写入" }),
        });
        expect(bareRes.status).toBe(403);
        const bareBody = (await bareRes.json().catch(() => null)) as {
          code?: string;
          message?: string;
        } | null;
        expect(bareBody?.code).toBe("42501");
        expect(bareBody?.message ?? "").toContain("permission denied");
        // 且确认裸 PATCH 未写入（列级 UPDATE 有权限但行未落库/未生效）
        const { data: afterBare } = await sb
          .from("profiles")
          .select("college")
          .eq("id", userId)
          .maybeSingle();
        expect(afterBare?.college).toBe("测试学院");
      } finally {
        // 7. 清理（失败即抛错：不允许静默孤儿，Issue #129）。先 profiles 后 auth.users
        await deleteTestUser(sb, userId);
        console.log(`🧹 已清理测试用户 ${testEmail}`);
      }
    },
  );
});
