import { supabase } from "@/lib/supabase";

/**
 * 预约「组」（`schedule_groups`）的两种写操作，**都带 0 行检测**（Issue #368）。
 *
 * 为什么单独一个文件：这两个操作原来一行行写在两个 400+ 行的组件/页面里
 * （甘特图的删除弹窗、列表页的「插入失败后回滚」），而它们要讲清楚的道理
 * （级联删除的环境差异、0 行意味着什么）比代码本身长得多 —— 放在组件里既挤占
 * 行数预算（设计债棘轮：god file 只许变短），也离被解释的那句 SQL 更远。
 *
 * ## 两处的 0 行含义**不同**，所以返回值都是「给用户看的文案」而不是 boolean
 *
 * - `deleteScheduleGroup`：0 行 = **没删掉**（RLS 静默拒绝 / 组已被并发删除）。
 *   调用方据此**不能**宣称「已删除」。
 * - `rollbackGroupAfterInsertFailure`：group 是几行前刚建成功的 ⇒ 0 行几乎只可能是
 *   没删掉，于是留下一个**没有预约的空壳组**（列表里多一条空重复组）。这种情况要说清残留，
 *   用户才知道去列表里手动清掉 —— **宁留可见残留，不静默**。
 *
 * 两处都不吞 `console.error`：出问题时日志里要能看见是哪一个。
 */

/**
 * 删除一个已有的预约组。
 *
 * **只删组即可**：关联的 `schedules` 由外键级联删除。依据是 prod 实测的
 * `pg_get_constraintdef`（ON DELETE **CASCADE**），与本仓 DDL 记录一致：
 * `supabase/migrations/20260722021000_add_schedules_group_id_fkey.sql`。
 *
 * ⚠️ **dev 上同一条约束分叉成了 ON DELETE SET NULL**（同一句查询在 dev 返回 SET NULL
 * ⇒ 只把 `schedules.group_id` 置空、不删行）。所以在 dev / 本地看到「删了组但预约还在」
 * 是**环境差异，不是线上行为** —— 判断这段代码的效果时以 prod 为准，
 * 别拿 dev 的观察反过来改这里的逻辑，或断定界面在说谎。
 *
 * @returns `null` = 删成功；字符串 = **该显示给用户的失败原因**
 */
export async function deleteScheduleGroup(groupId: string): Promise<string | null> {
  // 链 .select("id") 做 0 行检测：命中 0 行时**没有 error**（RLS 静默拒绝 / 组已被并发删除），
  // 按成功处理会关掉弹窗宣称「已删除」而库里还在。
  const { data, error } = await supabase
    .from("schedule_groups")
    .delete()
    .eq("id", groupId)
    .select("id");

  if (error) {
    // 真报错可能是暂时的（网络/权限），所以文案是「请稍后重试」
    console.error("[Schedule] 删除预约组失败:", error.message);
    return "删除预约组失败，请稍后重试";
  }
  if (!data || data.length === 0) {
    // 0 行 = 那组已不在库里，重试永远不会成功 ⇒ 文案不能用「请稍后重试」
    console.warn("[Schedule] 删除预约组命中 0 行，id =", groupId);
    return "没有匹配的记录，该预约组可能已被删除";
  }
  return null;
}

/**
 * 插入 `schedules` 失败后的回滚收尾：删掉本次刚建的 group，
 * 并返回**这一刻该显示给用户的文案**。
 *
 * - 没有 group（`null`）= 根本没有要回滚的东西 ⇒ 原文案「添加预约失败，请重试」。
 * - 回滚成功 ⇒ 同上（库回到了插入前的状态）。
 * - 回滚失败 / 命中 0 行 ⇒ 说明白**可能残留了一个空组**，否则用户只看到「添加失败」，
 *   而列表里悄悄多出一条空记录，谁也不知道该清。
 *
 * @returns 该显示给用户的文案（**总是**有话说，调用方不必自己拼）
 */
export async function rollbackGroupAfterInsertFailure(groupId: string | null): Promise<string> {
  const INSERT_FAILED = "添加预约失败，请重试";
  if (!groupId) return INSERT_FAILED;

  // 同一套 0 行检测：这次 group 是刚建成功的，0 行几乎只可能是没删掉。
  const { data, error } = await supabase
    .from("schedule_groups")
    .delete()
    .eq("id", groupId)
    .select("id");

  if (error || !data || data.length === 0) {
    console.error("[Schedule] 回滚预约组失败:", error?.message ?? "命中 0 行");
    return "添加预约失败，且自动回滚未生效，可能残留空的重复预约组";
  }
  return INSERT_FAILED;
}
