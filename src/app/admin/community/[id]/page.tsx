"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";
import { usePosts } from "@/hooks/usePosts";
import { useUser } from "@/context/user-context";
import { supabase } from "@/lib/supabase";
import { PostDetailContent } from "../components/post-detail-content";
import type { PostType, PostRow, PostRowWithAuthor } from "@/types/database";

const TYPE_LABEL: Record<PostType, string> = {
  ensemble: "重奏",
  gathering: "团建",
};

async function insertPostNotification(post: PostRow, kind: "deleted" | "locked" | "unlocked") {
  try {
    const verb = kind === "deleted" ? "删除" : kind === "locked" ? "锁定" : "解锁";
    const { error } = await supabase.from("notifications").insert({
      user_id: post.author_id,
      category: "activity",
      title: `帖子已被${verb}`,
      content: `你的${TYPE_LABEL[post.type as PostType]}帖子《${post.title}》已被管理员${verb}`,
    });
    if (error) console.error("[AdminCommunity] 通知插入失败", error.message);
  } catch (err) {
    console.error("[AdminCommunity] 通知插入失败", err);
  }
}

export default function AdminPostDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { user } = useUser();
  const adminId = user?.id;
  const {
    data: rawPosts,
    loading,
    update,
    remove,
  } = usePosts({
    includeLocked: true,
    // 创建者自锁帖对管理端不可见（列表同源过滤）：查不到即渲染「未找到该公告」
    excludeUserLocked: true,
  });

  const [lockingId, setLockingId] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  // normalize Supabase join profiles（与列表页一致）
  const post = React.useMemo<PostRowWithAuthor | null>(() => {
    const raw = (rawPosts as unknown[]).find((r) => (r as PostRow).id === params.id);
    if (!raw) return null;
    const r = raw as PostRow & { profiles?: unknown };
    const p = r.profiles as Record<string, unknown> | undefined;
    const profiles =
      Array.isArray(p) && p.length > 0
        ? {
            full_name: (p[0] as Record<string, string>).full_name,
            instrument: (p[0] as Record<string, string>).instrument,
          }
        : p && typeof p === "object" && !Array.isArray(p)
          ? (p as unknown as { full_name: string; instrument: string })
          : null;
    return { ...r, profiles };
  }, [rawPosts, params.id]);

  // 创建者自锁帖已在查询层过滤（excludeUserLocked），此处 post 只可能是未锁定或 admin 锁定

  const handleToggleLock = async () => {
    if (!post || lockingId) return;
    setLockingId(post.id);
    const unlocking = post.is_locked;
    const ok = await update(post.id, { is_locked: !unlocking });
    setLockingId(null);
    if (!ok) {
      alert("操作失败");
      return;
    }
    if (post.author_id !== adminId) {
      await insertPostNotification(post, unlocking ? "unlocked" : "locked");
    }
  };

  const handleDelete = async () => {
    if (!post || deletingId) return;
    if (!window.confirm("确定删除？")) return;
    setDeletingId(post.id);
    const target = post;
    const ok = await remove(post.id);
    setDeletingId(null);
    if (!ok) {
      alert("删除失败");
      return;
    }
    if (target.author_id !== adminId) {
      await insertPostNotification(target, "deleted");
    }
    router.push("/admin/community");
  };

  if (loading) {
    return (
      <div className="flex h-full min-h-0 flex-col pb-safe">
        <PageHeader onBack={() => router.back()} />
        <p className="py-12 text-center text-xs text-text-muted">加载中…</p>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="flex h-full min-h-0 flex-col pb-safe">
        <PageHeader onBack={() => router.back()} />
        <p className="py-12 text-center text-xs text-text-muted">未找到该公告</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col pb-safe">
      <PageHeader onBack={() => router.back()} />
      <section className="flex-1 min-h-0 space-y-3 overflow-y-auto">
        <PostDetailContent post={post} />
      </section>

      {/* 底部操作行：锁定/解锁 + 删除，居中全宽大按钮（参照小程序 sign-in 按钮；admin 仅可锁定/删除，不可编辑） */}
      <div className="mt-3 space-y-2 px-4">
        <button
          type="button"
          onClick={() => void handleToggleLock()}
          disabled={lockingId !== null}
          className="flex h-11 w-full items-center justify-center rounded-xl bg-muted text-base font-medium text-text disabled:opacity-50"
        >
          {lockingId ? "处理中…" : post.is_locked ? "解锁" : "锁定"}
        </button>
        <button
          type="button"
          onClick={() => void handleDelete()}
          disabled={deletingId !== null}
          className="flex h-11 w-full items-center justify-center rounded-xl bg-danger/10 text-base font-medium text-danger disabled:opacity-50"
        >
          {deletingId ? "删除中…" : "删除"}
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
      <h1 className="text-lg font-semibold text-text">公告详情</h1>
    </header>
  );
}
