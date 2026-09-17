"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";
import { useRehearsals } from "@/hooks/useRehearsals";
import { RehearsalDetailView } from "../components/rehearsal-detail-view";
import type { RehearsalRow } from "@/types/database";
import { useAdminPageHeader } from "@/context/admin-page-header-context";

export default function AdminRehearsalDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { setTitle, setOnBack } = useAdminPageHeader();
  const id = Number(params.id);
  const { data: schedules, loading, remove } = useRehearsals();
  const [deletingId, setDeletingId] = React.useState<number | null>(null);

  React.useEffect(() => {
    setTitle("排练详情");
    setOnBack(router.back);
  }, [setTitle, setOnBack, router]);

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
        <p className="py-12 text-center text-xs text-text-muted">加载中…</p>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="flex h-full min-h-0 flex-col pb-safe">
        <p className="py-12 text-center text-xs text-text-muted">未找到该排练</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col pb-safe">
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
