"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useUser } from "@/context/user-context";
import { ClipboardList, Music, User, UsersRound } from "lucide-react";

const tabs = [
  { href: "/admin", label: "控制台", icon: ClipboardList },
  { href: "/admin/rehearsals", label: "排练", icon: Music },
  { href: "/admin/members", label: "成员", icon: UsersRound },
  { href: "/admin/profile", label: "我的", icon: User },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = useUser();
  const router = useRouter();
  const pathname = usePathname();

  React.useEffect(() => {
    if (user && user.role !== "admin") router.replace("/");
  }, [user, router]);

  if (!user || user.role !== "admin") {
    return (
      <div className="flex min-h-[70vh] items-center justify-center text-sm text-text-muted">
        仅限管理员访问…
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-20">{children}</div>
      <nav className="fixed inset-x-0 bottom-0 z-20 flex justify-center bg-transparent pb-safe">
        <div className="w-full max-w-md border-t border-border bg-surface/95 backdrop-blur">
          <div className="flex items-center justify-around px-4 py-2">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active =
                tab.href === "/admin"
                  ? pathname === "/admin"
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
    </>
  );
}
