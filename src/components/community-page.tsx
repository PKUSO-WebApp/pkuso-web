"use client";

import React from "react";
import imageCompression from "browser-image-compression";
import { useUser } from "@/context/UserContext";
import { supabase } from "@/lib/supabase";
import type { PostType, PostRow } from "@/types/database";

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
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const TYPE_LABEL: Record<PostType, string> = {
  ensemble: "重奏",
  gathering: "团建",
};

export default function CommunityPage() {
  const { user } = useUser();
  const [view, setView] = React.useState<PostType>("ensemble");
  const [posts, setPosts] = React.useState<PostRow[]>([]);
  const [loading, setLoading] = React.useState(true);
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
  const [submitting, setSubmitting] = React.useState(false);
  const [imagePreviewUrl, setImagePreviewUrl] = React.useState<string | null>(null);

  const fetchPosts = React.useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("posts")
      .select(
        "id, title, type, content, image_url, author_id, created_at, contact_info, current_sections, missing_sections, users!author_id(name, section)",
      )
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("[Community] 加载公告失败：", error.message);
      setPosts([]);
    } else {
      // Supabase 嵌套 users 可能返回单对象或数组，统一取第一项以符合 PostRow
      const raw = (data ?? []) as Array<
        PostRow & { users?: PostRow["users"] | Array<{ name: string; section: string }> }
      >;
      const normalized: PostRow[] = raw.map((row) => {
        const u = row.users;
        const users =
          Array.isArray(u) && u.length > 0
            ? { name: u[0].name, section: u[0].section }
            : u && !Array.isArray(u)
              ? u
              : null;
        return { ...row, users };
      });
      setPosts(normalized);
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void fetchPosts();
  }, [fetchPosts]);

  const list = React.useMemo(() => posts.filter((p) => p.type === view), [posts, view]);

  const openPublish = (initial?: PostRow) => {
    if (initial) {
      setEditId(initial.id);
      setForm({
        title: initial.title,
        content: initial.content ?? "",
        type: initial.type,
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
      alert("请填写联系方式（微信号或手机号）。");
      return;
    }

    setSubmitting(true);
    let imageUrl: string | null = null;
    if (form.imageFile) {
      let fileToUpload: File = form.imageFile;
      try {
        const options = {
          maxSizeMB: 0.3,
          maxWidthOrHeight: 1024,
          useWebWorker: true,
        };
        fileToUpload = await imageCompression(form.imageFile, options);
      } catch (err) {
        console.warn("[Community] 图片压缩失败，使用原图上传：", err);
      }
      const path = `${user?.id ?? "anon"}/${Date.now()}-${fileToUpload.name}`;
      const { error: uploadError } = await supabase.storage
        .from("community-images")
        .upload(path, fileToUpload, { upsert: false });
      if (uploadError) {
        console.warn("[Community] 图片上传失败：", uploadError.message);
        alert("图片上传失败，请重试。");
        setSubmitting(false);
        return;
      }
      const { data: urlData } = supabase.storage.from("community-images").getPublicUrl(path);
      imageUrl = urlData.publicUrl;
    } else if (editId && imagePreviewUrl && imagePreviewUrl.startsWith("http")) {
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
      const payload = { ...basePayload };
      const { error } = await supabase.from("posts").update(basePayload).eq("id", editId);
      setSubmitting(false);
      if (error) {
        console.warn("[Community] 更新失败：", error.message);
        alert("更新失败，请重试。");
        return;
      }
      alert("已更新。");
    } else {
      if (!user) {
        alert("请先登录。");
        setSubmitting(false);
        return;
      }
      const { error } = await supabase.from("posts").insert({
        ...basePayload,
        image_url: imageUrl,
        author_id: user.id,
      });
      setSubmitting(false);
      if (error) {
        console.warn("[Community] 发布失败：", error.message);
        alert("发布失败，请重试。");
        return;
      }
      alert("发布成功！");
    }
    closePublish();
    void fetchPosts();
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("确定要删除这条公告吗？")) return;
    const { error } = await supabase.from("posts").delete().eq("id", id);
    if (error) {
      console.warn("[Community] 删除失败：", error.message);
      alert("删除失败，请重试。");
      return;
    }
    setDetailPost(null);
    alert("已删除。");
    void fetchPosts();
  };

  const handleSaveQr = (imageUrl: string) => {
    window.open(imageUrl, "_blank");
    alert("请在新窗口中长按图片保存。");
  };

  const authorLabel = (post: PostRow) => {
    const u = post.users;
    if (u?.name) return `${u.name}${u.section ? ` · ${u.section}` : ""}`;
    return "未知";
  };

  return (
    <div className="space-y-4">
      <header className="mb-1">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900">公告板</h1>
            <p className="mt-1 text-xs text-zinc-500">重奏与团建信息</p>
          </div>
          {user?.role === "member" && (
            <button
              type="button"
              onClick={() => openPublish()}
              className="rounded-full bg-zinc-900 px-3 py-1 text-[11px] font-medium text-white shadow-sm hover:bg-zinc-800"
            >
              发布公告
            </button>
          )}
        </div>
        <div className="mt-2">
          <ViewToggle value={view} onChange={(v) => setView(v)} />
        </div>
      </header>

      <section className="space-y-3">
        {loading && posts.length === 0 && (
          <p className="py-6 text-center text-xs text-zinc-400">正在加载…</p>
        )}
        {!loading &&
          list.map((post) => (
            <article
              key={post.id}
              className="rounded-2xl border border-zinc-100 bg-zinc-50/70 p-3 shadow-[0_1px_4px_rgba(15,23,42,0.06)]"
            >
              <button
                type="button"
                className="w-full text-left"
                onClick={() => setDetailPost(post)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-sm font-semibold text-zinc-900">{post.title}</h2>
                    <p className="mt-0.5 text-[11px] text-zinc-500">
                      {TYPE_LABEL[post.type]}
                      {formatPostDate(post.created_at) && ` · ${formatPostDate(post.created_at)}`}
                    </p>
                    {post.type === "ensemble" && hasSectionText(post.missing_sections) && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                          缺：{post.missing_sections!.trim()}
                        </span>
                      </div>
                    )}
                    {post.content != null && post.content.trim() !== "" && (
                      <p className="mt-1 line-clamp-2 text-xs text-zinc-600">{post.content}</p>
                    )}
                  </div>
                </div>
              </button>
              {(user?.id === post.author_id || user?.role === "admin") && (
                <div className="mt-2 flex gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openPublish(post);
                    }}
                    className="text-zinc-500 hover:text-zinc-800"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDelete(post.id);
                    }}
                    className="text-zinc-400 hover:text-red-500"
                  >
                    删除
                  </button>
                </div>
              )}
            </article>
          ))}
        {!loading && list.length === 0 && (
          <p className="py-8 text-center text-xs text-zinc-500">暂无「{TYPE_LABEL[view]}」公告。</p>
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

function ViewToggle({ value, onChange }: { value: PostType; onChange: (v: PostType) => void }) {
  return (
    <div className="inline-flex rounded-full bg-zinc-100 p-1 text-xs">
      {(["ensemble", "gathering"] as PostType[]).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          className={`min-w-[64px] rounded-full px-3 py-1 text-center transition-colors ${
            value === t ? "bg-zinc-900 text-white shadow-sm" : "text-zinc-600 hover:text-zinc-900"
          }`}
        >
          {TYPE_LABEL[t]}
        </button>
      ))}
    </div>
  );
}

function DetailModal({
  post,
  onClose,
  onSaveQr,
}: {
  post: PostRow;
  onClose: () => void;
  onSaveQr: (url: string) => void;
}) {
  const u = post.users;
  const author = u?.name ? `${u.name}${u.section ? ` · ${u.section}` : ""}` : "未知";
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
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 px-4 pb-safe">
      <button aria-label="关闭详情" className="absolute inset-0 h-full w-full" onClick={onClose} />
      <div className="relative w-full max-w-md max-h-[85vh] overflow-hidden rounded-3xl bg-white p-4 shadow-xl flex flex-col">
        <div className="mb-2 flex items-center justify-between flex-shrink-0">
          <h2 className="text-base font-semibold text-zinc-900">{post.title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-zinc-100 px-3 py-1 text-[11px] text-zinc-600"
          >
            关闭
          </button>
        </div>
        <p className="text-[11px] text-zinc-500 flex-shrink-0">
          {TYPE_LABEL[post.type]} · {author}
        </p>
        {(showCurrent || showMissing) && (
          <div className="mt-2 flex flex-wrap gap-1.5 flex-shrink-0">
            {showCurrent && (
              <span className="inline-flex rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600">
                已有：{post.current_sections!.trim()}
              </span>
            )}
            {showMissing && (
              <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                缺：{post.missing_sections!.trim()}
              </span>
            )}
          </div>
        )}
        <div className="mt-2 overflow-y-auto flex-1 space-y-3 text-xs text-zinc-700">
          {post.content != null && post.content.trim() !== "" && (
            <p className="whitespace-pre-line leading-relaxed">{post.content}</p>
          )}
          {post.contact_info && (
            <div className="rounded-2xl bg-zinc-50 p-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-[11px] font-medium text-zinc-500">联系方式</p>
                <p className="text-xs text-zinc-800">{post.contact_info}</p>
              </div>
              <button
                type="button"
                onClick={copyContact}
                className="relative z-10 cursor-pointer rounded-full bg-zinc-900 px-3 py-1.5 text-[11px] font-medium text-white shrink-0"
              >
                一键复制
              </button>
            </div>
          )}
          {post.image_url && (
            <div className="space-y-2">
              <img
                src={post.image_url}
                alt="二维码或配图"
                className="rounded-2xl border border-zinc-200 max-w-full h-auto max-h-64 object-contain"
              />
              <button
                type="button"
                onClick={() => onSaveQr(post.image_url!)}
                className="rounded-full bg-zinc-100 px-3 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-200"
              >
                保存二维码
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
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
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 px-4 pb-safe">
      <button
        aria-label="关闭"
        className="absolute inset-0 h-full w-full"
        onClick={onClose}
        disabled={submitting}
      />
      <form
        onSubmit={onSubmit}
        className="relative w-full max-w-md rounded-3xl bg-white p-4 shadow-xl max-h-[90vh] overflow-y-auto"
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-900">
            {editId ? "编辑公告" : "发布公告"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-full bg-zinc-100 px-3 py-1 text-[11px] text-zinc-600"
          >
            取消
          </button>
        </div>
        <div className="space-y-3 text-xs">
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-zinc-600">类型</label>
            <div className="inline-flex rounded-full bg-zinc-100 p-1 text-[11px]">
              {(["ensemble", "gathering"] as PostType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, type: t }))}
                  className={`min-w-[64px] rounded-full px-3 py-1 ${
                    form.type === t ? "bg-zinc-900 text-white" : "text-zinc-600"
                  }`}
                >
                  {TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-zinc-600">
              联系方式 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.contactInfo}
              onChange={(e) => setForm((f) => ({ ...f, contactInfo: e.target.value }))}
              className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-400"
              placeholder="微信号或手机号"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-zinc-600">标题</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-400"
              placeholder="请输入标题"
            />
          </div>
          {form.type === "ensemble" && (
            <>
              <div className="space-y-1">
                <label className="block text-[11px] font-medium text-zinc-600">已有声部</label>
                <input
                  type="text"
                  value={form.currentSections}
                  onChange={(e) => setForm((f) => ({ ...f, currentSections: e.target.value }))}
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-400"
                  placeholder="如：长笛、单簧管"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-[11px] font-medium text-zinc-600">需要声部</label>
                <input
                  type="text"
                  value={form.missingSections}
                  onChange={(e) => setForm((f) => ({ ...f, missingSections: e.target.value }))}
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-400"
                  placeholder="如：双簧管、大管"
                />
              </div>
            </>
          )}
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-zinc-600">内容</label>
            <textarea
              value={form.content ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-400"
              rows={4}
              placeholder="请输入内容"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-zinc-600">
              图片（如微信二维码）
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={onImageChange}
              className="w-full text-[11px] text-zinc-600 file:mr-2 file:rounded-full file:border-0 file:bg-zinc-100 file:px-3 file:py-1 file:text-xs"
            />
            {imagePreviewUrl && (
              <img
                src={imagePreviewUrl}
                alt="预览"
                className="mt-2 rounded-2xl border border-zinc-200 max-w-full h-auto max-h-32 object-contain"
              />
            )}
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-full px-4 py-1.5 text-[11px] text-zinc-500"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-full bg-zinc-900 px-4 py-1.5 text-[11px] font-medium text-white disabled:opacity-60"
          >
            {submitting ? "提交中…" : editId ? "保存" : "发布"}
          </button>
        </div>
      </form>
    </div>
  );
}
