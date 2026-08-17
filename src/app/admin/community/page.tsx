"use client";

import React from "react";
import { usePosts } from "@/hooks/usePosts";
import { Toggle } from "@/components/ui/Toggle";
import { Card } from "@/components/ui/Card";
import { formatDateTimeInChina } from "@/lib/date-utils";
import { PostDetailModal } from "./components/post-detail-modal";
import type { PostType, PostRow } from "@/types/database";

const TYPE_LABEL: Record<PostType, string> = {
  ensemble: "重奏",
  gathering: "团建",
};

export default function AdminCommunityPage() {
  const [view, setView] = React.useState<PostType>("ensemble");
  const { data: rawPosts, loading, update, remove } = usePosts({ includeLocked: true });

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

  const list = React.useMemo(() => posts.filter((p) => p.type === view), [posts, view]);

  // 详情弹窗只存帖子 ID，帖子对象由列表派生：
  // 删除成功或列表刷新后派生自动失效，弹窗随之关闭
  const [detailPostId, setDetailPostId] = React.useState<string | null>(null);
  const detailPost = detailPostId ? (posts.find((p) => p.id === detailPostId) ?? null) : null;

  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [lockingId, setLockingId] = React.useState<string | null>(null);

  const handleDelete = async (id: string) => {
    // 全局 guard 兜底：正常 UI 下 busy 已禁用按钮并阻止关闭弹窗，
    // 此处仅防御并发路径，命中时给出明确反馈而非静默吞掉
    if (deletingId) {
      alert("请等待当前操作完成");
      return;
    }
    setDeletingId(id);
    const ok = await remove(id);
    setDeletingId(null);
    if (!ok) alert("删除失败");
  };

  const handleToggleLock = async (post: PostRow) => {
    if (lockingId) {
      alert("请等待当前操作完成");
      return;
    }
    setLockingId(post.id);
    const ok = await update(post.id, { is_locked: !post.is_locked });
    setLockingId(null);
    if (!ok) alert("操作失败");
  };

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
              /* 卡片去按钮化（Issue #179）：整卡点击打开详情弹窗，
                 锁定/删除入口收敛到弹窗内（Card 传 onClick 时渲染为 button） */
              <Card
                key={post.id}
                onClick={() => setDetailPostId(post.id)}
                className="w-full text-left"
              >
                <div className="space-y-2">
                  {/* 标题行 */}
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

                  {/* 元信息 */}
                  <p className="text-xs text-text-muted">
                    {author}
                    {post.created_at && ` · ${formatDateTimeInChina(post.created_at)}`}
                  </p>

                  {/* 内容预览 */}
                  {post.content && post.content.trim() !== "" && (
                    <p className="line-clamp-2 text-xs text-text-muted">{post.content}</p>
                  )}
                </div>
              </Card>
            );
          })}
      </section>

      {detailPost && (
        <PostDetailModal
          post={detailPost}
          busyLock={lockingId === detailPost.id}
          busyDelete={deletingId === detailPost.id}
          onToggleLock={() => void handleToggleLock(detailPost)}
          onDelete={() => {
            if (window.confirm("确定删除？")) void handleDelete(detailPost.id);
          }}
          onClose={() => setDetailPostId(null)}
        />
      )}
    </div>
  );
}
