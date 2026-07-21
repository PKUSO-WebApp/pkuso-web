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

export default function CommunityPage() {
  const { user } = useUser();
  const [view, setView] = React.useState<PostType>("ensemble");
  const [detailPost, setDetailPost] = React.useState<PostRow | null>(null);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [editId, setEditId] = React.useState<string | null>(null);
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

  const {
    data: rawPosts,
    loading,
    saving: submitting,
    create,
    update,
    remove,
    uploadImage,
  } = usePosts();

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
        type: "ensemble",
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
    if (submitting) return;
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
    setForm((prev) => ({ ...prev, imageFile: file }));
    const url = URL.createObjectURL(file);
    setImagePreviewUrl(url);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!form.title.trim()) {
      alert("请填写标题。");
      return;
    }
    if (!form.contactInfo.trim()) {
      alert("请填写联系方式。");
      return;
    }

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
        alert("更新失败");
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
        alert("发布失败");
        return;
      }
      alert("发布成功！");
    }
    closePublish();
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("确定要删除这条公告吗？")) return;
    const ok = await remove(id);
    if (!ok) {
      alert("删除失败");
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
    <div className="space-y-4">
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
              className="rounded-full bg-primary px-3 py-1 text-label font-medium text-white shadow-sm hover:opacity-90"
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

      <section className="space-y-3">
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
                        <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-caption font-bold text-blue-700">
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
              {(user?.id === post.author_id || user?.role === "admin") && (
                <div className="mt-2 flex gap-2 text-label">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openPublish(post);
                    }}
                    className="text-text-muted hover:text-text"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDelete(post.id);
                    }}
                    className="text-text-subtle hover:text-red-500"
                  >
                    删除
                  </button>
                </div>
              )}
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
          onClose={() => setDetailPost(null)}
          onSaveQr={handleSaveQr}
        />
      )}

      {publishOpen && (
        <PublishModal
          form={form}
          setForm={setForm}
          imagePreviewUrl={imagePreviewUrl}
          onImageChange={handleImageChange}
          submitting={submitting}
          editId={editId}
          onClose={closePublish}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
}

function DetailModal({
  post,
  onClose,
  onSaveQr,
}: {
  post: PostRowWithAuthor;
  onClose: () => void;
  onSaveQr: (url: string) => void;
}) {
  const p = post.profiles;
  const author = p?.full_name
    ? `${p.full_name}${p.instrument ? ` · ${p.instrument}` : ""}`
    : "未知";
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

  return (
    <Modal open onClose={onClose} title={post.title}>
      <p className="text-label text-text-muted flex-shrink-0">
        {TYPE_LABEL[post.type as PostType]} · {author}
      </p>
      {(showCurrent || showMissing) && (
        <div className="mt-2 flex flex-wrap gap-1.5 flex-shrink-0">
          {showCurrent && (
            <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-caption font-medium text-text-muted">
              已有：{post.current_sections!.trim()}
            </span>
          )}
          {showMissing && (
            <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-caption font-bold text-blue-700">
              缺：{post.missing_sections!.trim()}
            </span>
          )}
        </div>
      )}
      <div className="mt-2 overflow-y-auto flex-1 space-y-3 text-xs text-text">
        {post.content != null && post.content.trim() !== "" && (
          <p className="whitespace-pre-line leading-relaxed">{post.content}</p>
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
              className="relative z-10 cursor-pointer rounded-full bg-primary px-3 py-1.5 text-label font-medium text-white shrink-0"
            >
              一键复制
            </button>
          </Card>
        )}
        {post.image_url && (
          <div className="space-y-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={post.image_url}
              alt="二维码或配图"
              className="rounded-2xl border border-border max-w-full h-auto max-h-64 object-contain"
            />
            <button
              type="button"
              onClick={() => onSaveQr(post.image_url!)}
              className="rounded-full bg-muted px-3 py-1.5 text-label font-medium text-text hover:bg-border"
            >
              保存二维码
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
              联系方式 <span className="text-red-500">*</span>
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
            className="rounded-full bg-primary px-4 py-1.5 text-label font-medium text-white disabled:opacity-60"
          >
            {submitting ? "提交中…" : editId ? "保存" : "发布"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
