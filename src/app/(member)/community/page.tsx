"use client";

import React from "react";
import imageCompression from "browser-image-compression";
import { useUser } from "@/context/user-context";
import { usePosts } from "@/hooks/usePosts";
import { Modal } from "@/components/ui/Modal";
import { Toggle } from "@/components/ui/Toggle";
import { Card } from "@/components/ui/Card";
import { parseLocalISO, getLocalDateString } from "@/lib/date-utils";
import type { PostType, PostRow, PostRowWithAuthor } from "@/types/database";

type FormState = {
  title: string;
  content: string;
  type: PostType;
  contactInfo: string;
  currentSections: string;
  missingSections: string;
  imageFile: File | null;
};

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

// 回收图片预览的 blob URL，避免内存泄漏；非 blob（原图 URL）时无操作
function revokeBlobUrl(url: string | null) {
  if (url && url.startsWith("blob:")) URL.revokeObjectURL(url);
}

export default function CommunityPage() {
  const { user } = useUser();
  const [view, setView] = React.useState<PostType>("ensemble");
  const [detailPost, setDetailPost] = React.useState<PostRow | null>(null);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [editId, setEditId] = React.useState<string | null>(null);
  const submittingRef = React.useRef(false);
  // 页面级提交锁定：覆盖「上传 + 建帖/更新」全程（usePosts 的 saving 只覆盖
  // create/update，uploadImage 期间不置位，否则上传中取消/遮罩/关闭会误关弹窗）
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [zoomImageUrl, setZoomImageUrl] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<FormState>({
    title: "",
    content: "",
    type: "ensemble",
    contactInfo: "",
    currentSections: "",
    missingSections: "",
    imageFile: null,
  });
  const [imagePreviewUrl, setImagePreviewUrl] = React.useState<string | null>(null);

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
    if (initial) {
      setEditId(initial.id);
      setForm({
        title: initial.title,
        content: initial.content ?? "",
        type: initial.type as PostType,
        contactInfo: initial.contact_info ?? "",
        currentSections: initial.current_sections ?? "",
        missingSections: initial.missing_sections ?? "",
        imageFile: null,
      });
      setImagePreviewUrl(initial.image_url ?? null);
    } else {
      setEditId(null);
      setForm({
        title: "",
        content: "",
        type: view,
        contactInfo: "",
        currentSections: "",
        missingSections: "",
        imageFile: null,
      });
      setImagePreviewUrl(null);
    }
    setPublishOpen(true);
  };

  const closePublish = () => {
    if (isSubmitting) return;
    revokeBlobUrl(imagePreviewUrl);
    setPublishOpen(false);
    setEditId(null);
    setForm({
      title: "",
      content: "",
      type: "ensemble",
      contactInfo: "",
      currentSections: "",
      missingSections: "",
      imageFile: null,
    });
    setImagePreviewUrl(null);
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 换图：先回收旧 blob URL，再生成新预览
    revokeBlobUrl(imagePreviewUrl);
    setForm((prev) => ({ ...prev, imageFile: file }));
    const url = URL.createObjectURL(file);
    setImagePreviewUrl(url);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // 同步 + 异步双重防重复提交
    if (submittingRef.current || isSubmitting) return;
    if (!form.title.trim()) {
      alert("请填写标题。");
      return;
    }
    if (!form.contactInfo.trim()) {
      alert("请填写联系方式。");
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);

    try {
      let imageUrl: string | null = null;
      if (form.imageFile) {
        let fileToUpload: File = form.imageFile;
        try {
          fileToUpload = await imageCompression(form.imageFile, {
            maxSizeMB: 0.3,
            maxWidthOrHeight: 1024,
            useWebWorker: true,
          });
        } catch {
          /* fall through */
        }
        const result = await uploadImage(fileToUpload, user?.id ?? "anon");
        if ("error" in result) {
          alert("图片上传失败");
          return;
        }
        imageUrl = result.url;
      } else if (editId && imagePreviewUrl?.startsWith("http")) {
        imageUrl = imagePreviewUrl;
      }

      const basePayload: Record<string, unknown> = {
        title: form.title.trim(),
        content: form.content.trim() || null,
        type: form.type,
        contact_info: form.contactInfo.trim(),
      };
      if (form.type === "ensemble") {
        basePayload.current_sections = form.currentSections.trim() || null;
        basePayload.missing_sections = form.missingSections.trim() || null;
      } else {
        basePayload.current_sections = null;
        basePayload.missing_sections = null;
      }
      if (imageUrl !== null) basePayload.image_url = imageUrl;

      if (editId) {
        const ok = await update(editId, basePayload);
        if (!ok) {
          // 优先展示 usePosts 中的具体错误信息，避免误导
          alert(error || "更新失败");
          return;
        }
        alert("已更新。");
      } else {
        if (!user) {
          alert("请先登录。");
          return;
        }
        const ok = await create({ ...basePayload, image_url: imageUrl, author_id: user.id });
        if (!ok) {
          // 优先展示 usePosts 中的具体错误信息，避免误导
          alert(error || "发布失败");
          return;
        }
        alert("发布成功！");
      }
      closePublish();
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
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
          form={form}
          setForm={setForm}
          imagePreviewUrl={imagePreviewUrl}
          onImageChange={handleImageChange}
          submitting={isSubmitting}
          editId={editId}
          onClose={closePublish}
          onSubmit={handleSubmit}
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
        {/* 底部操作行：仅帖主或管理员可见（Issue #179：卡片去按钮化，操作入口收敛到详情弹窗；#182：右下角） */}
        {canManage && (
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

function PublishModal({
  form,
  setForm,
  imagePreviewUrl,
  onImageChange,
  submitting,
  editId,
  onClose,
  onSubmit,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  imagePreviewUrl: string | null;
  onImageChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  submitting: boolean;
  editId: string | null;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      title={editId ? "编辑公告" : "发布公告"}
      closeOnOverlay={!submitting}
    >
      <form onSubmit={onSubmit} className="max-h-[90vh] overflow-y-auto">
        <div className="space-y-3 text-xs">
          <div className="space-y-1">
            <label className="block text-label font-medium text-text-muted">类型</label>
            <Toggle
              options={["ensemble", "gathering"] as const}
              value={form.type}
              onChange={(t) => setForm((f) => ({ ...f, type: t }))}
              getLabel={(k) => ({ ensemble: "重奏", gathering: "团建" })[k]}
            />
          </div>
          <div className="space-y-1">
            <label className="block text-label font-medium text-text-muted">
              联系方式 <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              value={form.contactInfo}
              onChange={(e) => setForm((f) => ({ ...f, contactInfo: e.target.value }))}
              className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
              placeholder="微信号或手机号"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-label font-medium text-text-muted">标题</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
              placeholder="请输入标题"
            />
          </div>
          {form.type === "ensemble" && (
            <>
              <div className="space-y-1">
                <label className="block text-label font-medium text-text-muted">已有声部</label>
                <input
                  type="text"
                  value={form.currentSections}
                  onChange={(e) => setForm((f) => ({ ...f, currentSections: e.target.value }))}
                  className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
                  placeholder="如：长笛、单簧管"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-label font-medium text-text-muted">需要声部</label>
                <input
                  type="text"
                  value={form.missingSections}
                  onChange={(e) => setForm((f) => ({ ...f, missingSections: e.target.value }))}
                  className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
                  placeholder="如：双簧管、大管"
                />
              </div>
            </>
          )}
          <div className="space-y-1">
            <label className="block text-label font-medium text-text-muted">内容</label>
            <textarea
              value={form.content ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
              rows={4}
              placeholder="请输入内容"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-label font-medium text-text-muted">
              图片（如微信二维码）
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={onImageChange}
              disabled={submitting}
              className="w-full text-label text-text-muted file:mr-2 file:rounded-full file:border-0 file:bg-muted file:px-3 file:py-1 file:text-xs"
            />
            {imagePreviewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imagePreviewUrl}
                alt="预览"
                className="mt-2 rounded-2xl border border-border max-w-full h-auto max-h-32 object-contain"
              />
            )}
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-full px-4 py-1.5 text-label text-text-muted"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-full bg-primary px-4 py-1.5 text-label font-medium text-primary-foreground disabled:opacity-60"
          >
            {submitting ? "提交中…" : editId ? "保存" : "发布"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
