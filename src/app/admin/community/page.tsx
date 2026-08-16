"use client";

import React from "react";
import { usePosts } from "@/hooks/usePosts";
import { useUser } from "@/context/user-context";
import { supabase } from "@/lib/supabase";
import { Modal } from "@/components/ui/Modal";
import { Toggle } from "@/components/ui/Toggle";
import { Card } from "@/components/ui/Card";
import { formatDateTimeInChina } from "@/lib/date-utils";
import type { PostType, PostRow } from "@/types/database";

const TYPE_LABEL: Record<PostType, string> = {
  ensemble: "重奏",
  gathering: "团建",
};

// 回收图片预览的 blob URL，避免内存泄漏；非 blob（原图 URL）时无操作
function revokeBlobUrl(url: string | null) {
  if (url && url.startsWith("blob:")) URL.revokeObjectURL(url);
}

export default function AdminCommunityPage() {
  const { user } = useUser();
  const [view, setView] = React.useState<PostType>("ensemble");
  const {
    data: rawPosts,
    loading,
    update,
    remove,
    uploadImage,
  } = usePosts({ includeLocked: true });

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
    imageFile: null as File | null,
  });
  // 图片预览：原图 URL 或新选图片的 blob URL；null 表示已标记删除
  const [imagePreviewUrl, setImagePreviewUrl] = React.useState<string | null>(null);
  // 页面级提交锁定：覆盖「上传 + 更新」全程（usePosts 的 saving 只覆盖 update，
  // uploadImage 期间不置位，否则上传中取消/遮罩/关闭会误关弹窗并清空表单）
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  // 同步 guard：与 isSubmitting state 组成双重防重复提交
  const savingRef = React.useRef(false);

  const openEdit = (post: PostRow) => {
    setEditingPost(post);
    setEditForm({
      title: post.title,
      content: post.content ?? "",
      contactInfo: post.contact_info ?? "",
      imageFile: null,
    });
    setImagePreviewUrl(post.image_url ?? null);
  };

  const closeEdit = () => {
    if (isSubmitting) return;
    revokeBlobUrl(imagePreviewUrl);
    setEditingPost(null);
    setEditForm({ title: "", content: "", contactInfo: "", imageFile: null });
    setImagePreviewUrl(null);
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 换图：先回收旧 blob URL，再生成新预览
    revokeBlobUrl(imagePreviewUrl);
    setEditForm((f) => ({ ...f, imageFile: file }));
    setImagePreviewUrl(URL.createObjectURL(file));
  };

  // 标记删除图片：保存时 image_url 置 null 并清理 storage 附件
  const handleRemoveImage = () => {
    revokeBlobUrl(imagePreviewUrl);
    setEditForm((f) => ({ ...f, imageFile: null }));
    setImagePreviewUrl(null);
  };

  // 从 image_url 提取 storage 路径并删除附件（提取方式同 usePosts.remove）；
  // 用于删图与换图（替换旧附件）两种场景；
  // 失败静默容忍：最多遗留孤儿文件，不影响帖子更新
  const removeImageFromStorage = async (imageUrl: string) => {
    try {
      const idx = imageUrl.indexOf("community-images/");
      if (idx === -1) return;
      const encodedPath = imageUrl.slice(idx + "community-images/".length);
      const filePath = decodeURIComponent(encodedPath);
      const { error: removeError } = await supabase.storage
        .from("community-images")
        .remove([filePath]);
      if (removeError) {
        // 忽略：旧附件删除失败（如已被并发操作删除）不阻断编辑保存（同 Issue #149 语义）
      }
    } catch {
      // 清理失败不阻断主流程
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    // 双重 guard：ref 同步阻断 + state 异步兜底
    if (savingRef.current || isSubmitting || !editingPost) return;
    savingRef.current = true;
    setIsSubmitting(true);
    try {
      let imageUrl: string | null = null;
      if (editForm.imageFile) {
        // 新图：先上传成功再入库
        // 已知限制：上传成功但后续 update 失败时，新图遗留孤儿文件（不入库不清理，
        // 旧图因 update 未成功仍保留）；下次编辑重选新图即可覆盖，无需额外处理
        const result = await uploadImage(editForm.imageFile, user?.id ?? "anon");
        if ("error" in result) {
          alert("图片上传失败");
          return;
        }
        imageUrl = result.url;
      } else if (imagePreviewUrl?.startsWith("http")) {
        // 未更换：保留原图
        imageUrl = imagePreviewUrl;
      }
      // else：已标记删除，imageUrl 保持 null

      const ok = await update(editingPost.id, {
        title: editForm.title.trim(),
        content: editForm.content.trim() || null,
        contact_info: editForm.contactInfo.trim(),
        image_url: imageUrl,
      });
      if (ok) {
        // 换图（新 image_url 与旧不同且旧非空）或删图（新为 null）：
        // 均清理旧 storage 附件。换图删旧同 Issue #149 请假语义，
        // 与删除场景同路径 fire-and-forget，失败静默容忍（最多遗留孤儿文件）
        if (editingPost.image_url && imageUrl !== editingPost.image_url) {
          void removeImageFromStorage(editingPost.image_url);
        }
        closeEdit();
      } else {
        alert("更新失败");
      }
    } finally {
      savingRef.current = false;
      setIsSubmitting(false);
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
                        className="text-text-subtle hover:text-danger"
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
        <Modal
          open
          onClose={closeEdit}
          title="编辑公告"
          closeOnOverlay={!isSubmitting}
          position="bottom"
        >
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
            <div className="space-y-1">
              <label className="block text-label font-medium text-text-muted">图片</label>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                disabled={isSubmitting}
                className="w-full text-label text-text-muted file:mr-2 file:rounded-full file:border-0 file:bg-muted file:px-3 file:py-1 file:text-xs"
              />
              {imagePreviewUrl ? (
                <div className="space-y-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imagePreviewUrl}
                    alt="图片预览"
                    className="max-h-40 w-full rounded-2xl border border-border object-contain"
                  />
                  <button
                    type="button"
                    onClick={handleRemoveImage}
                    disabled={isSubmitting}
                    className="text-label font-medium text-danger disabled:opacity-60"
                  >
                    删除图片
                  </button>
                </div>
              ) : (
                <p className="text-xs text-text-subtle">暂无图片，可在上方选择上传</p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeEdit}
                disabled={isSubmitting}
                className="rounded-full px-4 py-1.5 text-label text-text-muted disabled:opacity-60"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-full bg-primary px-4 py-1.5 text-label font-medium text-primary-foreground disabled:opacity-60"
              >
                {isSubmitting ? "保存中…" : "保存"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
