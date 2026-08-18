"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Calendar, Users, House, MessageSquare, User } from "lucide-react";
import { NotificationProvider, useNotificationsContext } from "@/context/notification-context";

const tabs = [
  { href: "/", label: "首页", icon: House },
  { href: "/community", label: "社区", icon: MessageSquare },
  { href: "/schedule", label: "日程", icon: Calendar },
  { href: "/members", label: "成员", icon: Users },
  { href: "/profile", label: "我的", icon: User },
];

/**
 * tab 栏（在 NotificationProvider 内消费未读数）：
 * 「我的」tab 图标右上角红色气泡显示未读总数（任一信箱有未读即显示），
 * profile 页打开信箱归零后经共享 context 立即消失（Issue #188）。
 */
function MemberTabBar() {
  const pathname = usePathname();
  const { totalUnread } = useNotificationsContext();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 flex justify-center bg-transparent pb-safe">
      <div className="w-full max-w-md border-t border-border bg-surface/95 backdrop-blur">
        <div className="flex items-center justify-around px-4 py-2">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active =
              tab.href === "/"
                ? pathname === "/"
                : pathname === tab.href || pathname.startsWith(tab.href + "/");

            return (
              <Link
                key={tab.href}
                href={tab.href}
                // 关闭预取：避免预取兄弟路由 CSS 触发浏览器"preload 未被使用"警告
                prefetch={false}
                className="flex flex-1 flex-col items-center justify-center gap-1 text-xs"
              >
                <div
                  className={`relative flex items-center justify-center rounded-full p-1.5 ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-text-muted hover:text-text"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  {/* 未读红气泡：仅「我的」tab，总数 > 99 时显示 99+ */}
                  {tab.href === "/profile" && totalUnread > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-caption font-medium leading-none text-danger-foreground">
                      {totalUnread > 99 ? "99+" : totalUnread}
                    </span>
                  )}
                </div>
                <span
                  className={
                    active ? "text-label font-medium text-text" : "text-label text-text-muted"
                  }
                >
                  {tab.label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

export default function MemberLayout({ children }: { children: React.ReactNode }) {
  return (
    // NotificationProvider 挂载后自动拉取未读数、pathname 变化时刷新
    <NotificationProvider>
      <div className="flex-1 flex flex-col px-4 pt-4 pb-20 overflow-hidden">{children}</div>
      <MemberTabBar />
    </NotificationProvider>
  );
}
