"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { useNotifications, type UnreadCounts } from "@/hooks/useNotifications";
import type { NotificationCategory } from "@/types/database";

type NotificationContextValue = {
  /** 各分类未读数（attendance/activity/system） */
  unreadCounts: UnreadCounts;
  /** 未读总数（tab bar 红气泡） */
  totalUnread: number;
  /** 首次加载中（未读数尚未就绪） */
  loading: boolean;
  /** 重新拉取未读数 */
  refresh: () => Promise<void>;
  /**
   * 打开信箱即全部已读：只标记本次 fetch 到的消息 id（.in("id", ids) + .is("read_at", null)
   * 守卫 + .select("id") 0 行检测）——打开瞬间到达的新通知不在 ids 内不会被误标；
   * ids 为空（本无未读）时跳过 update 直接归零并返回 true；RLS 静默失败/并发已读（0 行）
   * 时返回 false 且不归零，避免与 DB 不一致。
   */
  markCategoryRead: (category: NotificationCategory, ids: string[]) => Promise<boolean>;
};

const NotificationContext = React.createContext<NotificationContextValue | undefined>(undefined);

/**
 * 通知未读数共享 Provider（挂在 member layout）。
 * 挂载时拉取一次；pathname 变化（切换 tab/页面）时刷新，
 * 保证「我的」tab 红气泡与 profile 页信箱徽章始终一致（Issue #188）。
 */
export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { unreadCounts, totalUnread, loading, refresh, markCategoryRead } = useNotifications();

  // 依赖仅取稳定的 refresh（useCallback 包裹），避免每次渲染都触发刷新
  React.useEffect(() => {
    void refresh();
  }, [pathname, refresh]);

  const value = React.useMemo(
    () => ({ unreadCounts, totalUnread, loading, refresh, markCategoryRead }),
    [unreadCounts, totalUnread, loading, refresh, markCategoryRead],
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotificationsContext() {
  const ctx = React.useContext(NotificationContext);
  if (!ctx) {
    throw new Error("useNotificationsContext 必须在 NotificationProvider 内部使用");
  }
  return ctx;
}
