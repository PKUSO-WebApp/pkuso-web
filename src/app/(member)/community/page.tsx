"use client";

import React from "react";
import { useUser } from "@/context/user-context";
import { usePosts } from "@/hooks/usePosts";
import { Modal } from "@/components/ui/Modal";
import { Toggle } from "@/components/ui/Toggle";
import { Card } from "@/components/ui/Card";
import { parseLocalISO, getLocalDateString } from "@/lib/date-utils";
import { PublishModal } from "./components/publish-modal";
import type { PostType, PostRow, PostRowWithAuthor } from "@/types/database";

function hasSectionText(s: string | null | undefined): boolean {
  return s != null && typeof s === "string" && s.trim() !== "";
}

function formatPostDate(createdAt: string | null | undefined): string {
  if (!createdAt) return "";
  const d = parseLocalISO(createdAt);
  if (Number.isNaN(d.getTime())) return "";
  return getLocalDateString(d);
}

const TYPE_LABEL: Record<PostType, string> = {
  ensemble: "重奏",
  gathering: "团建",
};

export default function CommunityPage() {
  const { user } = useUser();
  const [view, setView] = React.useState<PostType>("ensemble");
  const [detailPost, setDetailPost] = React.useState<PostRow | null>(null);
  const [publishOpen, setPublishOpen] = React.useState(false);
  // 编辑/新建目标（null = 新建）：传给 PublishModal 预填；关闭时清空
  const [editPost, setEditPost] = React.useState<PostRow | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [zoomImageUrl, setZoomImageUrl] = React.useState<string | null>(null);

  const { data: rawPosts, loading, error, create, update, remove, uploadImage } = usePosts();

  // normalize Supabase join: profiles → single object
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
    }) as PostRowWithAuthor[];
  }, [rawPosts]);

  const list = React.useMemo(
    () => posts.filter((p) => (p.type as PostType) === view),
    [posts, view],
  );

  const openPublish = (initial?: PostRow) => {
    setEditPost(initial ?? null);
    setPublishOpen(true);
  };

  const closePublish = () => {
    setPublishOpen(false);
    setEditPost(null);
  };

  const handleDelete = async (id: string) => {
    // 全局 guard 兜底：正常 UI 下 busy 已禁用按钮并拦截弹窗关闭（纯防御路径）
    if (deletingId) {
      alert("请等待当前操作完成");
      return;
    }
    if (!window.confirm("确定要删除这条公告吗？")) return;
    setDeletingId(id);
    const ok = await remove(id);
    setDeletingId(null);
    if (!ok) {
      // 优先展示 usePosts 中的具体错误信息，避免误导
      alert(error || "删除失败");
      return;
    }
    setDetailPost(null);
    alert("已删除。");
  };

  const handleSaveQr = (imageUrl: string) => {
    window.open(imageUrl, "_blank");
    alert("请在新窗口中长按图片保存。");
  };

  return (
    <div className="flex h-full min-h-0 flex-col space-y-4">
      <header className="mb-1">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold text-text">公告板</h1>
            <p className="mt-1 text-xs text-text-muted">重奏与团建信息</p>
          </div>
          {user?.role === "member" && (
            <button
              type="button"
              onClick={() => openPublish()}
              className="rounded-full bg-primary px-3 py-1 text-label font-medium text-primary-foreground shadow-sm hover:opacity-90"
            >
              发布公告
            </button>
          )}
        </div>
        <div className="mt-2">
          <Toggle
            options={["ensemble", "gathering"] as const}
            value={view}
            onChange={setView}
            getLabel={(k) => ({ ensemble: "重奏", gathering: "团建" })[k]}
          />
        </div>
      </header>

      <section className="flex-1 min-h-0 space-y-3 overflow-y-auto">
        {loading && posts.length === 0 && (
          <p className="py-6 text-center text-xs text-text-subtle">正在加载…</p>
        )}
        {!loading &&
          list.map((post) => (
            <Card key={post.id}>
              <button
                type="button"
                className="w-full text-left"
                onClick={() => setDetailPost(post)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-sm font-semibold text-text">{post.title}</h2>
                    <p className="mt-0.5 text-label text-text-muted">
                      {TYPE_LABEL[post.type as PostType]}
                      {formatPostDate(post.created_at) && ` · ${formatPostDate(post.created_at)}`}
                    </p>
                    {post.type === "ensemble" && hasSectionText(post.missing_sections) && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {/* 缺声部徽章：语义强调色替代硬编码 blue（审计清理）；与详情弹窗「已有/缺」徽章配色一致 */}
                        <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-caption font-bold text-primary">
                          缺：{post.missing_sections!.trim()}
                        </span>
                      </div>
                    )}
                    {post.content != null && post.content.trim() !== "" && (
                      <p className="mt-1 line-clamp-2 text-xs text-text-muted">{post.content}</p>
                    )}
                  </div>
                </div>
              </button>
            </Card>
          ))}
        {!loading && list.length === 0 && (
          <p className="py-8 text-center text-xs text-text-muted">
            暂无「{TYPE_LABEL[view]}」公告。
          </p>
        )}
      </section>

      {detailPost && (
        <DetailModal
          post={detailPost}
          canManage={user?.id === detailPost.author_id || user?.role === "admin"}
          // 删除进行中禁用操作行：防止慢网下删除 pending 期间点「编辑」
          // 打开对已删帖子的编辑弹窗（对抗修复，配合 usePosts.update 0 行检测）
          busy={deletingId !== null}
          onClose={() => setDetailPost(null)}
          onSaveQr={handleSaveQr}
          onZoomImage={setZoomImageUrl}
          onEdit={() => {
            setDetailPost(null);
            openPublish(detailPost);
          }}
          onDelete={() => void handleDelete(detailPost.id)}
        />
      )}

      {/* 图片放大查看浮层（blob 化：手机端长按保存更可靠，Issue #133） */}
      {zoomImageUrl && (
        <ZoomImageOverlay url={zoomImageUrl} onClose={() => setZoomImageUrl(null)} />
      )}

      {publishOpen && (
        <PublishModal
          post={editPost}
          defaultType={view}
          create={create}
          update={update}
          uploadImage={uploadImage}
          error={error}
          onClose={closePublish}
        />
      )}
    </div>
  );
}

/**
 * 图片放大查看浮层。
 * 打开时把跨域原图 fetch 成同源 blob（URL.createObjectURL），
 * iOS/安卓/微信内置浏览器对 blob 图片长按保存最可靠。
 */
function ZoomImageOverlay({ url, onClose }: { url: string; onClose: () => void }) {
  const [src, setSrc] = React.useState<string>(url);

  React.useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    // 打开瞬间先用原 URL 展示，随后异步替换为 blob URL
    void (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`图片加载失败 HTTP ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch {
        // fetch 失败（网络/CORS 等）回退原 URL；
        // Supabase 公共桶默认返回 CORS * 头，跨域 img 展示不受影响
        if (!cancelled) setSrc(url);
      }
    })();

    return () => {
      // 竞态守卫：URL 变化或组件卸载时丢弃旧请求结果，并回收 blob URL
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  return (
    <div
      data-testid="zoom-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div className="flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="图片放大查看"
          className="max-h-[90vh] max-w-full rounded-2xl object-contain"
        />
        <p className="text-xs text-text-muted">长按图片即可保存到相册</p>
      </div>
    </div>
  );
}

function DetailModal({
  post,
  canManage,
  busy,
  onClose,
  onSaveQr,
  onZoomImage,
  onEdit,
  onDelete,
}: {
  post: PostRowWithAuthor;
  /** 是否可管理（帖主或管理员）：控制底部「编辑/删除」操作行（Issue #179） */
  canManage: boolean;
  /** 删除进行中：操作按钮禁用（防删除 pending 期间点「编辑」操作已删帖子） */
  busy: boolean;
  onClose: () => void;
  onSaveQr: (url: string) => void;
  onZoomImage: (url: string) => void;
  /** 点「编辑」：关闭详情并打开发布弹窗（编辑模式预填） */
  onEdit: () => void;
  /** 点「删除」：confirm 后删除（成功后关闭详情） */
  onDelete: () => void;
}) {
  const p = post.profiles;
  const author = p?.full_name ? `创建者：${p.full_name}` : "未知";
  const showCurrent = post.type === "ensemble" && hasSectionText(post.current_sections);
  const showMissing = post.type === "ensemble" && hasSectionText(post.missing_sections);

  const copyContact = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!post.contact_info) return;
    navigator.clipboard.writeText(post.contact_info).then(
      () => alert("复制成功！"),
      () => alert("复制失败，请手动复制"),
    );
  };

  // busy（删除进行中）期间禁止关闭弹窗（遮罩关闭禁用 + 关闭按钮守卫），
  // 与操作行互斥对齐管理端 post-detail-modal 的做法
  const handleClose = () => {
    if (busy) return;
    onClose();
  };

  return (
    <Modal open onClose={handleClose} closeOnOverlay={!busy} title={post.title}>
      <p className="text-label text-text-muted flex-shrink-0">
        {TYPE_LABEL[post.type as PostType]} · {author}
      </p>
      {(showCurrent || showMissing) && (
        /* 声部徽章统一语义色：已有=中性（bg-muted），缺=强调（bg-primary/10），替代硬编码 blue（审计清理） */
        <div className="mt-2 flex flex-wrap gap-1.5 flex-shrink-0">
          {showCurrent && (
            <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-caption font-medium text-text-muted">
              已有：{post.current_sections!.trim()}
            </span>
          )}
          {showMissing && (
            <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-caption font-bold text-primary">
              缺：{post.missing_sections!.trim()}
            </span>
          )}
        </div>
      )}
      <div className="mt-2 overflow-y-auto flex-1 space-y-3 text-xs text-text">
        {post.content != null && post.content.trim() !== "" && (
          <p className="whitespace-pre-line leading-relaxed">{post.content}</p>
        )}
        {post.image_url && (
          <div className="space-y-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={post.image_url}
              alt="二维码或配图"
              className="rounded-2xl border border-border max-w-full h-auto max-h-64 object-contain cursor-pointer hover:opacity-90"
              onClick={() => onZoomImage(post.image_url!)}
            />
            {/* 暂时隐藏：手机端长按放大视图可直接保存；保留按钮代码，后续若需一键下载（a[download]）再启用 */}
            {false && (
              <button
                type="button"
                onClick={() => onSaveQr(post.image_url!)}
                className="rounded-full bg-muted px-3 py-1.5 text-label font-medium text-text hover:bg-border"
              >
                保存图片
              </button>
            )}
          </div>
        )}
        {post.contact_info && (
          <Card className="flex items-center justify-between gap-2">
            <div>
              <p className="text-label font-medium text-text-muted">联系方式</p>
              <p className="text-xs text-text">{post.contact_info}</p>
            </div>
            <button
              type="button"
              onClick={copyContact}
              className="relative z-10 cursor-pointer rounded-full bg-primary px-3 py-1.5 text-label font-medium text-primary-foreground shrink-0"
            >
              一键复制
            </button>
          </Card>
        )}
        {/* 底部操作行：仅帖主或管理员可见（Issue #179：卡片去按钮化，操作入口收敛到详情弹窗；#182：右下角）。
            暂时隐藏（Issue #205）：编辑/删除入口已迁移到「我的-已发布的活动」个人面板，
            保留代码待后续验证（E）后恢复或移除；面板内仍可管理自己的帖子（含锁定/解锁/删除） */}
        {canManage && false && (
          <div className="flex items-center justify-end gap-3 text-label">
            <button
              type="button"
              onClick={onEdit}
              disabled={busy}
              className="text-text-muted hover:text-text disabled:opacity-50"
            >
              编辑
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              className="text-text-subtle hover:text-danger disabled:opacity-50"
            >
              {busy ? "删除中…" : "删除"}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
