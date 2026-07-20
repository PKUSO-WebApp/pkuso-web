"use client";

import Link from "next/link";

export default function MemberSchedulePage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center pb-safe">
      <div className="text-center space-y-4">
        <div className="text-6xl">📅</div>
        <h1 className="text-lg font-semibold text-text">排练日程已迁移至首页</h1>
        <p className="text-sm text-text-muted">点击下方按钮返回首页查看排练日程</p>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow-md hover:opacity-90"
        >
          返回首页
        </Link>
      </div>
    </div>
  );
}
