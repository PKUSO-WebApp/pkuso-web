import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * E2E 测试账号邮箱后缀。
 * 预清扫与清理只针对这类邮箱的账号，绝不触碰真实账号。
 * 四个 E2E（verify_invitation_code / settings route / notify / profiles-privacy）共享本工具，
 * 避免各自清理逻辑漂移导致孤儿账号在共享库积压（Issue #129）。
 */
export const TEST_EMAIL_SUFFIX = "@pkuso.test";

/**
 * E2E 测试广播的通知标题前缀。
 *
 * 背景（实测事故）：notify-system E2E 的 POST handler 会向**全体 approved 成员**
 * 广播——包括生产库里的真实用户。若标题用与真实通知无异的固定文案，
 * afterAll 只清理临时测试账号的信箱，真实用户收到的测试广播就成了永久垃圾
 * （曾积压 24 条「元旦汇演通知」发到 8 个真实成员）。
 * 约定：所有 E2E 广播的标题一律以本前缀开头 + 运行级时间戳结尾，
 * 清扫按前缀/精确标题匹配，绝不触碰真实管理员发布的系统通知。
 */
export const TEST_NOTIFY_TITLE_PREFIX = "[e2e]";

/**
 * 创建独立的 service role 客户端，专用于清理（profiles DELETE / auth.users DELETE）。
 *
 * 为什么必须独立：调用方传入的 client 可能已执行过 signInWithPassword（如 notify /
 * profiles-privacy E2E 需要真实 JWT），登录后 supabase-js 会把用户 access_token 作为
 * 后续 REST 请求的 Authorization 头，PostgREST 以 JWT 的 role claim（authenticated）
 * 判定角色——此时 `client.from("profiles").delete()` 被 RLS 静默拒绝（profiles 无
 * DELETE 策略，0 行不报错），再删 auth.users 就撞 profiles_id_fkey（23503）报
 * "Database error deleting user"。实测该失败为概率性（登录与删除之间若 session
 * 尚未写入，请求仍走 service role 而侥幸成功），此前依赖运气。
 *
 * 本函数每次创建全新 client（无任何登录状态），保证删除永远走 service role 路径。
 * 需 NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY，调用方负责在 env 存在时调用。
 *
 * 关键坑（实测）：jsdom 环境下 supabase-js 的默认 storage 是全局 localStorage，
 * 所有 client 共享同一 storage key。若测试先在某个 client 上 signInWithPassword
 * （拿真实 JWT），随后创建的"干净" client 会在初始化时从 localStorage 恢复该
 * session——删除请求带着用户 JWT 而非 service role，PostgREST 按 JWT role claim
 * 判定为 authenticated，profiles 无 DELETE 策略被 RLS 静默拒（0 行不报错），
 * 再删 auth.users 就撞 profiles_id_fkey（23503）。因此必须 persistSession: false
 * （不恢复、不持久化）+ 独立 storageKey（双保险），彻底隔离登录状态。
 */
function createCleanAdminClient(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("缺少 Supabase 配置，无法创建清理客户端（不应到达：调用方已做 env 检查）");
  }
  return import("@supabase/supabase-js").then(({ createClient }) =>
    createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        storageKey: "e2e-clean-admin-client",
      },
    }),
  );
}

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
export async function deleteTestUser(_client: SupabaseClient, userId: string): Promise<void> {
  // 必须用独立 service role client：调用方传入的 client 可能已被 signInWithPassword
  // 污染（其 REST 请求携带用户 JWT → RLS 静默拒删 profiles → deleteUser 撞 FK 23503）
  const clean = await createCleanAdminClient();
  const { error: profileErr } = await clean.from("profiles").delete().eq("id", userId);
  if (profileErr) throw new Error(`清理测试 profile 失败: ${profileErr.message}`);
  const { error: userErr } = await clean.auth.admin.deleteUser(userId);
  if (userErr) throw new Error(`清理测试 auth.user 失败: ${userErr.message}`);
}

/**
 * 预清扫：删除历史残留的全部测试账号（profiles + auth.users）。
 * 在 beforeAll / 测试开头最先调用，保证测试开始前环境干净，
 * 同时自动清掉历史 CI 崩溃留下的孤儿账号。
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 保留签名兼容既有调用方
export async function sweepTestUsers(_client: SupabaseClient): Promise<void> {
  // 同 deleteTestUser：独立 service role client，防调用方 client 的登录 session 污染
  const clean = await createCleanAdminClient();
  const cutoffMs = Date.now() - SWEEP_MIN_AGE_MS;
  const cutoffISO = new Date(cutoffMs).toISOString();

  // 先删 profiles（按邮箱后缀匹配），解除 auth.users 的外键引用。
  // 只清理 10 分钟前创建的（profiles.created_at 为 timestamptz，
  // 与 ISO 字符串比较由 PostgREST 处理），保护并行文件的活跃用户。
  const { error: pErr } = await clean
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
    const { data, error: listErr } = await clean.auth.admin.listUsers({ page, perPage });
    if (listErr) throw new Error(`预清扫列出用户失败: ${listErr.message}`);
    const users = data?.users ?? [];
    const testUsers = users.filter(
      (u) => u.email?.endsWith(TEST_EMAIL_SUFFIX) && new Date(u.created_at).getTime() < cutoffMs,
    );
    for (const u of testUsers) {
      const { error } = await clean.auth.admin.deleteUser(u.id);
      if (!error) continue;
      // 双删竞态容错：对方已删该用户时视为成功继续（见 isAlreadyDeletedError）
      if (isAlreadyDeletedError(error)) continue;
      throw new Error(`预清扫 auth.user 失败 (${u.email}): ${error.message}`);
    }
    if (users.length < perPage) break;
    page += 1;
  }
}

/**
 * 预清扫历史残留的测试广播通知（notifications 信箱行 + system_notifications 历史行）。
 *
 * 为什么需要：afterAll 清理只在进程正常结束时执行；CI 超时被杀 / 本地 Ctrl-C
 * 都会跳过 afterAll，当次广播的垃圾只能靠下一次运行的预清扫兜底。
 *
 * 匹配规则：标题以 TEST_NOTIFY_TITLE_PREFIX（"[e2e]"）开头。真实管理员不会以
 * 该前缀发通知，误删面为零。与 sweepTestUsers 同样只清 10 分钟前的残留，
 * 保护并行 E2E 文件刚写入的活跃数据（同一 10 分钟窗口理由，见 SWEEP_MIN_AGE_MS）。
 * 独立 service role client 的原因同 deleteTestUser（防调用方 client 登录态污染）。
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 保留签名兼容既有调用方（同 sweepTestUsers）
export async function sweepTestNotifications(_client: SupabaseClient): Promise<void> {
  const clean = await createCleanAdminClient();
  const cutoffISO = new Date(Date.now() - SWEEP_MIN_AGE_MS).toISOString();

  // 先清信箱行（真实成员 + 测试账号收到的），再清历史存档
  const { error: inboxErr } = await clean
    .from("notifications")
    .delete()
    .like("title", `${TEST_NOTIFY_TITLE_PREFIX}%`)
    .lt("created_at", cutoffISO);
  if (inboxErr) throw new Error(`预清扫测试广播信箱失败: ${inboxErr.message}`);

  const { error: historyErr } = await clean
    .from("system_notifications")
    .delete()
    .like("title", `${TEST_NOTIFY_TITLE_PREFIX}%`)
    .lt("created_at", cutoffISO);
  if (historyErr) throw new Error(`预清扫测试系统通知历史失败: ${historyErr.message}`);
}
