import { describe, it, expect } from "vitest";

// ============================================================
// DB 集成测试：verify_and_use_invitation_code 的 CTE 去重（Issue #94 问题2）
// ============================================================
// 测试目标：
//   migration 20260801120000 在 CTE WHERE 子句新增去重条件：
//     AND (ic.used_by IS NULL OR NOT (p_user_id = ANY(ic.used_by)))
//   防止同一 p_user_id 在 10 分钟窗口内重复调用耗尽 max_uses>1 的共享邀请码。
//
// 验证场景：
//   1. 第一次调用：CTE 命中，used_count 递增到 1，used_by 数组追加 p_user_id
//   2. 第二次调用（同一 p_user_id）：CTE 去重命中，返回空数组，
//      used_count 不再递增，used_by 不重复追加
//
// 测试模式：参照 notify.test.ts 端到端测试
//   - 缺 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 时优雅跳过
//   - 创建临时数据 → 调用 RPC → 验证 → 清理
//   - 临时记录必须清理，不污染开发库
// ============================================================

describe("verify_and_use_invitation_code CTE 去重（DB 集成测试）", () => {
  it("同一 p_user_id 不能重复消耗邀请码", async () => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      console.log("⚠️ 缺少 Supabase 配置，跳过 DB 集成测试");
      return;
    }

    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(supabaseUrl, serviceRoleKey);

    // 1. 创建临时 auth user（用于 p_user_id）
    //    email_confirm: true 让用户立即可用；created_at 默认 NOW() 满足 10 分钟内校验
    const testEmail = `inv-${Date.now()}@pkuso.test`;
    const testPassword = `pw-${Date.now()}`;
    const { data: newUser, error: createErr } = await sb.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
    } as never);
    if (createErr || !newUser?.user?.id) {
      console.log("⚠️ 无法创建测试用户，跳过 DB 集成测试");
      return;
    }
    const userId = newUser.user.id;

    // 2. 在 invitation_codes 表插入共享邀请码（max_uses=2，便于测试去重）
    //    若 max_uses=1，第一次成功后第二次会因 used_count >= max_uses 失败，
    //    无法区分失败原因是 CTE 去重还是名额耗尽
    const code = `CTE${Date.now().toString().slice(-8)}`;
    const { data: inserted, error: insertErr } = await sb
      .from("invitation_codes")
      .insert({
        code,
        max_uses: 2,
        expires_at: new Date(Date.now() + 86400000).toISOString(), // 1 天后过期
      })
      .select()
      .single();
    if (insertErr || !inserted?.id) {
      console.log("⚠️ 无法创建测试邀请码，跳过 DB 集成测试");
      await sb.auth.admin.deleteUser(userId);
      return;
    }
    const codeId = inserted.id;

    try {
      // 3. 第一次调用：CTE 命中（used_by 为 NULL，去重条件成立），消耗成功
      const { data: firstData, error: firstErr } = await sb.rpc("verify_and_use_invitation_code", {
        p_code: code,
        p_user_id: userId,
      });
      expect(firstErr).toBeNull();
      expect(Array.isArray(firstData)).toBe(true);
      expect(firstData).toHaveLength(1);
      expect(firstData[0].used_count).toBe(1);
      expect(firstData[0].used_by).toEqual([userId]);

      // 4. 第二次调用（同一 p_user_id）：CTE 去重命中（used_by 已含 userId），
      //    返回空数组，used_count 不递增，used_by 不重复追加
      const { data: secondData, error: secondErr } = await sb.rpc(
        "verify_and_use_invitation_code",
        { p_code: code, p_user_id: userId },
      );
      expect(secondErr).toBeNull();
      expect(Array.isArray(secondData)).toBe(true);
      // 关键断言：CTE 去重生效，返回空数组而非第二行
      expect(secondData).toHaveLength(0);

      // 5. 直接查 invitation_codes 表，确认最终状态：
      //    used_count 仍为 1（未虚假递增），used_by 仅含 userId 一次（无重复）
      const { data: finalRow, error: finalErr } = await sb
        .from("invitation_codes")
        .select("used_count, used_by")
        .eq("id", codeId)
        .single();
      expect(finalErr).toBeNull();
      expect(finalRow).not.toBeNull();
      expect(finalRow!.used_count).toBe(1);
      expect(finalRow!.used_by).toEqual([userId]);

      console.log(`✅ CTE 去重测试通过：邀请码 ${code} 在 user ${userId} 下仅消耗一次`);
    } finally {
      // 6. 清理临时数据（必须执行，不污染开发库）
      await sb.from("invitation_codes").delete().eq("id", codeId);
      await sb.auth.admin.deleteUser(userId);
      console.log(`🧹 已清理测试邀请码 ${code} 和测试用户 ${testEmail}`);
    }
  }, 60000);
});
