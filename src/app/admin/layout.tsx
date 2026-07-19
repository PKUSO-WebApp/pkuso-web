"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/context/user-context";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = useUser();
  const router = useRouter();

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

  return <>{children}</>;
}
