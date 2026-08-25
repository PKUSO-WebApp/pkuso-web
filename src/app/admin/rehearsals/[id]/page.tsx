"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";
import { useRehearsals } from "@/hooks/useRehearsals";
import { RehearsalDetailView } from "../components/rehearsal-detail-view";
import type { RehearsalRow } from "@/types/database";

export default function AdminRehearsalDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { data: schedules, loading, remove } = useRehearsals();
  const [deletingId, setDeletingId] = React.useState<number | null>(null);

  const item = React.useMemo<RehearsalRow | null>(
    () => schedules?.find((r) => r.id === id) ?? null,
    [schedules, id],
  );

  const handleDelete = async () => {
    if (!item) return;
    if (deletingId) return;
    if (!window.confirm("确定删除该排练？")) return;
    setDeletingId(item.id);
    const ok = await remove(item.id);
    setDeletingId(null);
    if (!ok) {
      alert("删除失败");
      return;
    }
    router.push("/admin/rehearsals");
  };

  if (loading) {
    return (
      <div className="flex h-full min-h-0 flex-col pb-safe">
        <PageHeader onBack={() => router.back()} />
        <p className="py-12 text-center text-xs text-text-muted">加载中…</p>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="flex h-full min-h-0 flex-col pb-safe">
        <PageHeader onBack={() => router.back()} />
        <p className="py-12 text-center text-xs text-text-muted">未找到该排练</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col pb-safe">
      <PageHeader onBack={() => router.back()} />
      <section className="flex-1 min-h-0 space-y-3 overflow-y-auto">
        <RehearsalDetailView item={item} />
      </section>

      {/* 底部操作行：编辑 + 删除，居中全宽大按钮（参照小程序 sign-in 按钮） */}
      <div className="mt-3 space-y-2 px-4">
        <button
          type="button"
          onClick={() => router.push(`/admin/rehearsals/${item.id}/edit`)}
          className="flex h-11 w-full items-center justify-center rounded-xl bg-primary text-base font-medium text-primary-foreground"
        >
          编辑
        </button>
        <button
          type="button"
          onClick={() => void handleDelete()}
          disabled={deletingId !== null}
          className="flex h-11 w-full items-center justify-center rounded-xl bg-danger/10 text-base font-medium text-danger disabled:opacity-50"
        >
          {deletingId !== null ? "删除中…" : "删除"}
        </button>
      </div>
    </div>
  );
}

function PageHeader({ onBack }: { onBack: () => void }) {
  return (
    <header className="mb-2 flex items-center gap-2">
      <button
        type="button"
        onClick={onBack}
        className="rounded-full px-2 py-1 text-lg text-text-muted hover:bg-muted"
        aria-label="返回"
      >
        ‹
      </button>
      <h1 className="text-lg font-semibold text-text">排练详情</h1>
    </header>
  );
}
