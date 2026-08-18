"use client";

import React from "react";
import { supabase as defaultClient } from "@/lib/supabase";
import type { NotificationCategory } from "@/types/database";

/** 三个信箱分类（profile 页按钮与 tab 红气泡共用） */
export const NOTIFICATION_CATEGORIES: NotificationCategory[] = ["attendance", "activity", "system"];

/** 各分类未读数（读取时全 0，与 RLS 下无通知等价） */
export type UnreadCounts = Record<NotificationCategory, number>;

/**
 * 通知未读数共享状态（Issue #188）。
 *
 * 数据流：layout 的 NotificationProvider 挂载时拉取一次、pathname 变化时刷新；
 * profile 页打开信箱调用 markCategoryRead —— DB 标记已读成功后本地未读数归零，
 * tab 红气泡经同一 context 立即消失。
 *
 * 未读查询：RLS 只返回自己名下的通知，`select(category).is("read_at", null)`
 * 一次拉回全部未读行，前端按 category 分组计数（列表规模小，无需服务端聚合）。
 */
export function useNotifications(client: typeof defaultClient = defaultClient) {
  const [unreadCounts, setUnreadCounts] = React.useState<UnreadCounts>({
    attendance: 0,
    activity: 0,
    system: 0,
  });
  const [loading, setLoading] = React.useState(true);

  /** 重新拉取未读数（挂载 / 路由变化时调用） */
  const refresh = React.useCallback(async () => {
    setLoading(true);
    const { data, error } = await client
      .from("notifications")
      .select("category")
      .is("read_at", null);
    setLoading(false);
    if (error) {
      console.error("[Notifications] 未读数查询失败", error.message);
      return;
    }
    const counts: UnreadCounts = { attendance: 0, activity: 0, system: 0 };
    for (const row of (data ?? []) as { category: NotificationCategory }[]) {
      if (row.category in counts) counts[row.category] += 1;
    }
    setUnreadCounts(counts);
  }, [client]);

  /**
   * 打开信箱即全部已读（Issue #188 状态机，对抗返工）：
   * 只标记本次 fetch 到的消息 id（.in("id", ids)）——打开信箱瞬间到达的新通知不在 ids 内，
   * 不会被无界更新误标已读；ids 为空（该分类本无未读）时跳过 update 直接归零。
   * update 带 .is("read_at", null) 守卫 + .select("id") 0 行检测（CLAUDE.md）：
   * RLS 静默失败/并发已读时 0 行无 error，此时返回 false 且不归零本地计数，
   * 避免 tab 气泡/信箱徽章与 DB 不一致。
   */
  const markCategoryRead = React.useCallback(
    async (category: NotificationCategory, ids: string[]) => {
      if (ids.length === 0) {
        // 无未读行可标（fetch 已确认该分类无未读）：直接归零
        setUnreadCounts((prev) => ({ ...prev, [category]: 0 }));
        return true;
      }
      try {
        const { data, error } = await client
          .from("notifications")
          .update({ read_at: new Date().toISOString() })
          .in("id", ids)
          .is("read_at", null)
          .select("id");
        if (error) {
          console.error("[Notifications] 标记已读失败", error.message);
          return false;
        }
        if (!data || data.length === 0) {
          // 0 行：RLS 静默失败或全部被并发标已读，不执行本地归零
          return false;
        }
      } catch (err) {
        console.error("[Notifications] 标记已读失败", err);
        return false;
      }
      setUnreadCounts((prev) => ({ ...prev, [category]: 0 }));
      return true;
    },
    [client],
  );

  const totalUnread = NOTIFICATION_CATEGORIES.reduce((sum, c) => sum + unreadCounts[c], 0);

  return { unreadCounts, totalUnread, loading, refresh, markCategoryRead };
}
