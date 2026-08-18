"use client";

import React from "react";
import imageCompression from "browser-image-compression";
import { useUser } from "@/context/user-context";
import { Modal } from "@/components/ui/Modal";
import { Toggle } from "@/components/ui/Toggle";
import type { PostRow, PostType } from "@/types/database";

type FormState = {
  title: string;
  content: string;
  type: PostType;
  contactInfo: string;
  currentSections: string;
  missingSections: string;
  imageFile: File | null;
};

// 回收图片预览的 blob URL，避免内存泄漏；非 blob（原图 URL）时无操作
function revokeBlobUrl(url: string | null) {
  if (url && url.startsWith("blob:")) URL.revokeObjectURL(url);
}

type Props = {
  /** null = 发布新帖；非 null = 编辑该帖（预填表单） */
  post: PostRow | null;
  /** 新建时的默认类型（社区页取当前 tab 视图；个人面板编辑场景不适用） */
  defaultType: PostType;
  /** 来自调用方已有的 usePosts 实例：与列表共享同一份 data，保存成功靠乐观更新同步列表 */
  create: (payload: Record<string, unknown>) => Promise<boolean>;
  update: (id: string, payload: Record<string, unknown>) => Promise<boolean>;
  uploadImage: (file: File, userId: string) => Promise<{ url: string } | { error: string }>;
  /** usePosts 的 error（提示优先展示具体错误信息，避免误导） */
  error: string | null;
  /** 取消或保存成功后关闭（提交进行中不可关闭，由本组件守卫） */
  onClose: () => void;
};

/**
 * 发布 / 编辑公告弹窗（从社区页抽出共用，Issue #205）。
 * 自持表单状态与提交逻辑（校验、图片压缩上传、create/update）；
 * api 由调用方注入——社区页与「我的-已发布的活动」面板各自持有 usePosts 实例，
 * 保存成功后的乐观更新落在各自列表上，无需手动刷新。
 */
export function PublishModal({
  post,
  defaultType,
  create,
  update,
  uploadImage,
  error,
  onClose,
}: Props) {
  const { user } = useUser();
  const [form, setForm] = React.useState<FormState>(() => ({
    title: post?.title ?? "",
    content: post?.content ?? "",
    type: post?.type ?? defaultType,
    contactInfo: post?.contact_info ?? "",
    currentSections: post?.current_sections ?? "",
    missingSections: post?.missing_sections ?? "",
    imageFile: null,
  }));
  const [imagePreviewUrl, setImagePreviewUrl] = React.useState<string | null>(
    post?.image_url ?? null,
  );
  const submittingRef = React.useRef(false);
  // 页面级提交锁定：覆盖「上传 + 建帖/更新」全程（usePosts 的 saving 只覆盖
  // create/update，uploadImage 期间不置位，否则上传中取消/遮罩/关闭会误关弹窗）
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 换图：先回收旧 blob URL，再生成新预览
    revokeBlobUrl(imagePreviewUrl);
    setForm((prev) => ({ ...prev, imageFile: file }));
    const url = URL.createObjectURL(file);
    setImagePreviewUrl(url);
  };

  /** 用户主动关闭（取消/遮罩/标题栏）：提交进行中禁止关闭 */
  const handleClose = () => {
    if (isSubmitting) return;
    revokeBlobUrl(imagePreviewUrl);
    onClose();
  };

  /** 提交成功后关闭：提交已完成，跳过 isSubmitting 守卫 */
  const handleSuccessClose = () => {
    revokeBlobUrl(imagePreviewUrl);
    onClose();
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
      } else if (post && imagePreviewUrl?.startsWith("http")) {
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

      if (post) {
        const ok = await update(post.id, basePayload);
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
      handleSuccessClose();
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onClose={handleClose}
      title={post ? "编辑公告" : "发布公告"}
      closeOnOverlay={!isSubmitting}
    >
      <form onSubmit={handleSubmit} className="max-h-[90vh] overflow-y-auto">
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
              onChange={handleImageChange}
              disabled={isSubmitting}
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
        {/* 双按钮操作行右下角（Issue #182）：取消 + 提交 */}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="rounded-full px-4 py-1.5 text-label text-text-muted"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-full bg-primary px-4 py-1.5 text-label font-medium text-primary-foreground disabled:opacity-60"
          >
            {isSubmitting ? "提交中…" : post ? "保存" : "发布"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
