"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { usePosts } from "@/hooks/usePosts";
import { Toggle } from "@/components/ui/Toggle";
import { Card } from "@/components/ui/Card";
import { formatDateTimeInChina } from "@/lib/date-utils";
import type { PostType, PostRow } from "@/types/database";

const TYPE_LABEL: Record<PostType, string> = {
  ensemble: "重奏",
  gathering: "团建",
};

export default function AdminCommunityPage() {
  const router = useRouter();
  const { data: rawPosts, loading } = usePosts({ includeLocked: true, excludeUserLocked: true });

  // normalize Supabase join profiles
  const posts = React.useMemo(() => {
    return (rawPosts as unknown[]).map((row) => {
      const r = row as PostRow & { profiles?: unknown };
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
    }) as (PostRow & { profiles?: { full_name?: string; instrument?: string } | null })[];
  }, [rawPosts]);

  const [view, setView] = React.useState<PostType>("ensemble");
  const list = React.useMemo(() => posts.filter((p) => p.type === view), [posts, view]);

  return (
    <div className="flex h-full min-h-0 flex-col space-y-4">
      <header className="mb-2">
        <h1 className="text-lg font-semibold text-text">社区管理</h1>
        <p className="mt-1 text-xs text-text-muted">查看、锁定重奏与团建公告</p>
      </header>

      <Toggle
        options={["ensemble", "gathering"] as const}
        value={view}
        onChange={setView}
        getLabel={(k) => ({ ensemble: "重奏", gathering: "团建" })[k]}
      />

      <section className="flex-1 min-h-0 space-y-3 overflow-y-auto">
        {loading && <p className="py-6 text-center text-xs text-text-subtle">加载中…</p>}
        {!loading && list.length === 0 && (
          <p className="py-8 text-center text-xs text-text-muted">暂无「{TYPE_LABEL[view]}」公告</p>
        )}
        {!loading &&
          list.map((post) => {
            const authorName = post.profiles?.full_name ?? "未知";
            const author = `创建者：${authorName}`;

            return (
              <Card
                key={post.id}
                onClick={() => router.push(`/admin/community/${post.id}`)}
                className="w-full text-left"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="min-w-0 flex-1 text-sm font-semibold text-text">{post.title}</h2>
                    <div className="flex flex-shrink-0 items-center gap-1">
                      {post.is_locked && (
                        <span className="rounded-full bg-danger/10 px-2 py-0.5 text-caption font-medium text-danger">
                          🔒 已锁定
                        </span>
                      )}
                      <span className="rounded-full bg-muted px-2 py-0.5 text-caption text-text-muted">
                        {TYPE_LABEL[post.type as PostType]}
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-text-muted">
                    {author}
                    {post.created_at && ` · ${formatDateTimeInChina(post.created_at)}`}
                  </p>

                  {post.content && post.content.trim() !== "" && (
                    <p className="line-clamp-2 text-xs text-text-muted">{post.content}</p>
                  )}
                </div>
              </Card>
            );
          })}
      </section>
    </div>
  );
}
