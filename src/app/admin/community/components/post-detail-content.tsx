"use client";

import { formatDateTimeInChina } from "@/lib/date-utils";
import type { PostType, PostRowWithAuthor } from "@/types/database";

const TYPE_LABEL: Record<PostType, string> = {
  ensemble: "重奏",
  gathering: "团建",
};

function hasSectionText(value: string | null | undefined): boolean {
  return value != null && value.trim() !== "";
}

/**
 * 公告只读详情内容（参照小程序 post-detail/index.tsx 转写）
 *
 * 仅渲染内容本身（不含操作按钮），供管理员公告详情页复用。
 * 标题（主字）+ 类型·时间（副字）+ 分隔线 + 各字段明细 + 联系方式（一键复制）。
 * 锁定/解锁、删除等操作入口由详情页在操作行中提供。
 */
export function PostDetailContent({ post }: { post: PostRowWithAuthor }) {
  const dateText = post.created_at ? formatDateTimeInChina(post.created_at) : "";

  const handleCopy = () => {
    if (!post.contact_info) return;
    void navigator.clipboard?.writeText(post.contact_info);
  };

  return (
    <div className="px-4 py-2">
      <h2 className="text-xl font-semibold leading-snug text-text">{post.title}</h2>
      <p className="mt-1 text-base text-text-muted">
        {TYPE_LABEL[post.type as PostType]}
        {dateText ? ` · ${dateText}` : ""}
      </p>

      <div className="my-4 h-px w-full bg-border" />

      {post.type === "ensemble" && hasSectionText(post.current_sections) && (
        <div className="mb-4">
          <p className="text-base font-medium text-text">已有声部</p>
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-text-muted">
            {post.current_sections}
          </p>
        </div>
      )}

      {post.type === "ensemble" && hasSectionText(post.missing_sections) && (
        <div className="mb-4">
          <p className="text-base font-medium text-text">招募声部</p>
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-text-muted">
            {post.missing_sections}
          </p>
        </div>
      )}

      {hasSectionText(post.content) && (
        <div className="mb-4">
          <p className="text-base font-medium text-text">内容</p>
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-text">
            {post.content}
          </p>
        </div>
      )}

      {post.image_url && (
        <div className="mb-4">
          <p className="text-base font-medium text-text">图片</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={post.image_url}
            alt="公告图片"
            className="mt-1 w-full rounded-2xl border border-border object-contain"
          />
        </div>
      )}

      {hasSectionText(post.contact_info) && (
        <div className="mb-4 flex items-center justify-between gap-2 rounded-2xl border border-border bg-card p-3">
          <div>
            <p className="text-base font-medium text-text">联系方式</p>
            <p className="text-sm text-text-muted">{post.contact_info}</p>
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-label font-medium text-primary-foreground"
          >
            复制
          </button>
        </div>
      )}
    </div>
  );
}
