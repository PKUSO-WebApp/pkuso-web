import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * E2E 测试账号邮箱后缀。
 * 预清扫与清理只针对这类邮箱的账号，绝不触碰真实账号。
 * 三个 E2E（verify_invitation_code / settings route / notify）共享本工具，
 * 避免各自清理逻辑漂移导致孤儿账号在共享库积压（Issue #129）。
 */
export const TEST_EMAIL_SUFFIX = "@pkuso.test";

/**
 * 预清扫只清理 10 分钟前创建的测试账号。
 * 10 分钟窗口的理由：vitest 并行跑多个 E2E 文件时，各文件的预清扫
 * 可能同时执行，若不设时效窗口，先跑的清扫会误删另一文件刚创建的
 * 活跃测试用户（实测 4 跑 3 败）。10 分钟既保护并行文件的活跃用户，
 * 又保留清历史孤儿（CI 崩溃残留）的目标。
 */
const SWEEP_MIN_AGE_MS = 10 * 60 * 1000;

/**
 * 判断 deleteUser 错误是否属于"用户已被删除"（双删竞态）：
 * 两个测试文件并行清扫同一批历史孤儿时，先到者删除成功，后到者对
 * 已删除用户调用 deleteUser 会得到 404（User not found）或
 * "Database error deleting user"（0 affected rows）。
 * 这类错误视为成功继续——清理目标已由对方达成，不该中止本轮清扫；
 * 其余错误（网络/权限等）仍需抛出，避免掩盖真实问题。
 */
function isAlreadyDeletedError(error: { message: string; status?: number }): boolean {
  return error.status === 404 || error.message.includes("deleting user");
}

/**
 * 彻底删除一个测试用户：先删 profiles 行，再删 auth.users 行。
 *
 * 为什么先 profiles：注册触发器会自动创建 profile 行，而 profiles.id
 * 外键指向 auth.users.id（profiles_id_fkey）。直接删 auth.user 会触发
 * 外键约束错误——deleteUser 返回 error 对象（不抛异常），若不检查会被
 * 打印成假成功，留下孤儿账号。必须先删 profiles 解除外键引用。
 *
 * 任一步失败即抛错：清理失败必须让测试失败，不允许静默孤儿。
 */
export async function deleteTestUser(client: SupabaseClient, userId: string): Promise<void> {
  const { error: profileErr } = await client.from("profiles").delete().eq("id", userId);
  if (profileErr) throw new Error(`清理测试 profile 失败: ${profileErr.message}`);
  const { error: userErr } = await client.auth.admin.deleteUser(userId);
  if (userErr) throw new Error(`清理测试 auth.user 失败: ${userErr.message}`);
}

/**
 * 预清扫：删除历史残留的全部测试账号（profiles + auth.users）。
 * 在 beforeAll / 测试开头最先调用，保证测试开始前环境干净，
 * 同时自动清掉历史 CI 崩溃留下的孤儿账号。
 */
export async function sweepTestUsers(client: SupabaseClient): Promise<void> {
  const cutoffMs = Date.now() - SWEEP_MIN_AGE_MS;
  const cutoffISO = new Date(cutoffMs).toISOString();

  // 先删 profiles（按邮箱后缀匹配），解除 auth.users 的外键引用。
  // 只清理 10 分钟前创建的（profiles.created_at 为 timestamptz，
  // 与 ISO 字符串比较由 PostgREST 处理），保护并行文件的活跃用户。
  const { error: pErr } = await client
    .from("profiles")
    .delete()
    .like("email", `%${TEST_EMAIL_SUFFIX}`)
    .lt("created_at", cutoffISO);
  if (pErr) throw new Error(`预清扫 profiles 失败: ${pErr.message}`);

  // 再逐个删除匹配的 auth.users（admin API 不支持按邮箱 like 批量删）。
  // listUsers 默认每页 50 条，历史残留可能超过一页（生产库曾积压 42 个），
  // 循环翻页直到取完，避免漏删。
  // listUsers 返回的 user.created_at 现成可用，同样只清理 10 分钟前的。
  let page = 1;
  const perPage = 200;
  while (true) {
    const { data, error: listErr } = await client.auth.admin.listUsers({ page, perPage });
    if (listErr) throw new Error(`预清扫列出用户失败: ${listErr.message}`);
    const users = data?.users ?? [];
    const testUsers = users.filter(
      (u) => u.email?.endsWith(TEST_EMAIL_SUFFIX) && new Date(u.created_at).getTime() < cutoffMs,
    );
    for (const u of testUsers) {
      const { error } = await client.auth.admin.deleteUser(u.id);
      if (!error) continue;
      // 双删竞态容错：对方已删该用户时视为成功继续（见 isAlreadyDeletedError）
      if (isAlreadyDeletedError(error)) continue;
      throw new Error(`预清扫 auth.user 失败 (${u.email}): ${error.message}`);
    }
    if (users.length < perPage) break;
    page += 1;
  }
}
