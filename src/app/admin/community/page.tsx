"use client";

import React from "react";
import { usePosts } from "@/hooks/usePosts";
import { Modal } from "@/components/ui/Modal";
import { Toggle } from "@/components/ui/Toggle";
import { Card } from "@/components/ui/Card";
import { formatDateTimeInChina } from "@/lib/date-utils";
import type { PostType, PostRow } from "@/types/database";

const TYPE_LABEL: Record<PostType, string> = {
  ensemble: "重奏",
  gathering: "团建",
};

export default function AdminCommunityPage() {
  const [view, setView] = React.useState<PostType>("ensemble");
  const { data: rawPosts, loading, saving, update, remove } = usePosts({ includeLocked: true });

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

  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [lockingId, setLockingId] = React.useState<string | null>(null);

  // 编辑状态
  const [editingPost, setEditingPost] = React.useState<PostRow | null>(null);
  const [editForm, setEditForm] = React.useState({
    title: "",
    content: "",
    contactInfo: "",
  });

  const openEdit = (post: PostRow) => {
    setEditingPost(post);
    setEditForm({
      title: post.title,
      content: post.content ?? "",
      contactInfo: post.contact_info ?? "",
    });
  };

  const closeEdit = () => {
    if (saving) return;
    setEditingPost(null);
    setEditForm({ title: "", content: "", contactInfo: "" });
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !editingPost) return;
    const ok = await update(editingPost.id, {
      title: editForm.title.trim(),
      content: editForm.content.trim() || null,
      contact_info: editForm.contactInfo.trim(),
    });
    if (ok) {
      closeEdit();
    } else {
      alert("更新失败");
    }
  };

  const handleDelete = async (id: string) => {
    if (deletingId) return;
    setDeletingId(id);
    const ok = await remove(id);
    setDeletingId(null);
    if (!ok) alert("删除失败");
  };

  const handleToggleLock = async (post: PostRow) => {
    if (lockingId) return;
    setLockingId(post.id);
    const ok = await update(post.id, { is_locked: !post.is_locked });
    setLockingId(null);
    if (!ok) alert("操作失败");
  };

  return (
    <div className="flex h-full min-h-0 flex-col space-y-4">
      <header className="mb-2">
        <h1 className="text-lg font-semibold text-text">社区管理</h1>
        <p className="mt-1 text-xs text-text-muted">查看、编辑、锁定重奏与团建公告</p>
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
              <Card key={post.id}>
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

                  {/* 操作按钮 */}
                  <div className="flex items-center gap-2 text-label">
                    <button
                      type="button"
                      onClick={() => openEdit(post)}
                      className="text-text-muted hover:text-text"
                    >
                      编辑
                    </button>
                    {!deletingId || deletingId !== post.id ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm("确定删除？")) handleDelete(post.id);
                        }}
                        className="text-text-subtle hover:text-red-500"
                      >
                        删除
                      </button>
                    ) : (
                      <span className="text-text-subtle">删除中…</span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleToggleLock(post)}
                      disabled={lockingId === post.id}
                      className="text-text-muted hover:text-warning disabled:opacity-50"
                    >
                      {lockingId === post.id ? "处理中…" : post.is_locked ? "解锁" : "锁定"}
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
      </section>

      {/* 编辑 Modal */}
      {editingPost && (
        <Modal open onClose={closeEdit} title="编辑公告" closeOnOverlay={!saving} position="bottom">
          <form onSubmit={handleSaveEdit} className="space-y-3">
            <div className="space-y-1">
              <label className="block text-label font-medium text-text-muted">标题</label>
              <input
                type="text"
                value={editForm.title}
                onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-label font-medium text-text-muted">联系方式</label>
              <input
                type="text"
                value={editForm.contactInfo}
                onChange={(e) => setEditForm((f) => ({ ...f, contactInfo: e.target.value }))}
                className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-label font-medium text-text-muted">内容</label>
              <textarea
                value={editForm.content}
                onChange={(e) => setEditForm((f) => ({ ...f, content: e.target.value }))}
                className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
                rows={5}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeEdit}
                disabled={saving}
                className="rounded-full px-4 py-1.5 text-label text-text-muted"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-full bg-primary px-4 py-1.5 text-label font-medium text-primary-foreground disabled:opacity-60"
              >
                {saving ? "保存中…" : "保存"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
