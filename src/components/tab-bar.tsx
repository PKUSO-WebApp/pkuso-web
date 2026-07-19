"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Calendar, MessageSquare, User, UsersRound } from "lucide-react";

const tabs = [
  { href: "/", label: "日程", icon: Calendar },
  { href: "/community", label: "社区", icon: MessageSquare },
  { href: "/members", label: "成员", icon: UsersRound },
  { href: "/profile", label: "我的", icon: User },
];

export function TabBar() {
  const pathname = usePathname();

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
                className="flex flex-1 flex-col items-center justify-center gap-1 text-xs"
              >
                <div
                  className={`flex items-center justify-center rounded-full p-1.5 ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-text-muted hover:text-text"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <span
                  className={
                    active ? "text-[11px] font-medium text-text" : "text-[11px] text-text-muted"
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
