"use client";

import Link from "next/link";

export default function MemberGuardPage() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
      <div className="rounded-3xl border border-border bg-surface p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-text">成员端已迁移</h1>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-text-muted">
          成员端功能已迁移至<strong>微信小程序</strong>，网页端不再提供成员登录。
        </p>
        <p className="mt-2 text-xs text-text-muted">请在微信中搜索「PKUSO」小程序使用。</p>
        <Link
          href="/login"
          className="mt-6 inline-block rounded-full bg-primary px-6 py-2 text-sm font-medium text-primary-foreground shadow-md hover:opacity-90"
        >
          管理员登录
        </Link>
      </div>
    </div>
  );
}
