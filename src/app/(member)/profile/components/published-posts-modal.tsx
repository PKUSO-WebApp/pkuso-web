"use client";

import React from "react";
import { useUser } from "@/context/user-context";
import { usePosts } from "@/hooks/usePosts";
import { Modal } from "@/components/ui/Modal";
import { PublishModal } from "@/app/(member)/community/components/publish-modal";
import { formatDateTimeInChina } from "@/lib/date-utils";
import type { PostRow, PostType } from "@/types/database";

const TYPE_LABEL: Record<PostType, string> = {
  ensemble: "重奏",
  gathering: "团建",
};

/**
 * 「已发布的活动」弹窗（Issue #205）：本人发布的公告管理（含锁定帖）。
 * 状态机（集中注释）：
 * 1. 列表视图（默认）：usePosts({ includeLocked: true, authorId: me }) 查本人全部帖子——
 *    usePosts 默认过滤 is_locked=false，此处显式包含锁定帖（🔒 已锁定徽章）；
 *    点帖子 → 管理面板（selectedId），空列表显示「暂无已发布的活动」。
 * 2. 管理面板：只读详情 + 底部操作行（编辑/锁定解锁/删除，右下角规范，Issue #182）。
 *    - 编辑 → PublishModal（社区共用编辑弹窗，预填帖子）；保存成功靠 usePosts 乐观更新同步列表；
 *      编辑打开时底层 Modal 根容器加 inert 隔离（弹层焦点管理，CLAUDE.md）：
 *      Tab/点击无法逃逸到底层「关闭」按钮，防止误触丢弃未保存的编辑内容
 *      （对抗返工 Issue #205，参照 admin/profile 全屏签名编辑的既有范式）；
 *    - 锁定/解锁 → update(id, { is_locked: !post.is_locked })（0 行检测内建）；
 *      锁定后帖子从社区列表下架（社区 usePosts 过滤 is_locked=false 的既有语义），
 *      面板内仍可见可解锁；成员侧不插通知（通知仅 admin 侧逻辑，Issue #188）；
 *    - 删除 → window.confirm 后 remove（0 行检测内建，附件清理守卫在 hook 内）；
 *      成功后回列表视图；失败时 usePosts.remove 只返回 boolean 无法区分「0 行
 *      （帖子已被并发删除）」与真实失败——统一刷新列表同步真实状态并提示
 *      「删除失败（帖子可能已被删除）」（0 行时 DB 已无该帖，本地残留无意义；
 *      真实失败时列表保留，用户可重试）。
 * 3. 列表/面板数据派生自同一份 usePosts.data：update/remove 的乐观更新自动同步两处视图
 *    （面板帖子对象由列表派生，锁定徽章即时刷新、删除后面板自动回列表）。
 * 4. busy（删除/锁定 pending）：操作行按钮互斥禁用 + 弹窗关闭守卫（防慢网下误操作）。
 */
type Props = {
  /** 关闭弹窗（返回「我的」页） */
  onClose: () => void;
};

export function PublishedPostsModal({ onClose }: Props) {
  const { user } = useUser();
  const {
    data: rawPosts,
    loading,
    error,
    fetch,
    create,
    update,
    remove,
    uploadImage,
  } = usePosts({
    includeLocked: true,
    authorId: user?.id ?? null,
  });

  // 本人帖子无需 profiles join 展示（作者即自己），直接转型使用
  const posts = React.useMemo(() => rawPosts as unknown[] as PostRow[], [rawPosts]);

  // 管理面板当前帖子 ID（null = 列表视图）；帖子对象由列表派生：
  // 删除/锁定后列表乐观更新，派生自动失效（删除后面板自动回列表，双保险见 handleDelete）
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  // 编辑弹窗目标（null = 未打开）；PublishModal 关闭后回列表视图
  const [editPost, setEditPost] = React.useState<PostRow | null>(null);

  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [lockingId, setLockingId] = React.useState<string | null>(null);
  const busy = deletingId !== null || lockingId !== null;

  // user 未就绪兜底（正常由 AuthGate 把关，此处防御：避免 authorId 为 null 时
  // usePosts 不加过滤意外拉全团帖子——对抗返工 Issue #205）。
  // 必须放在全部 hooks 之后（rules-of-hooks：early return 不能插在 hooks 之间）
  if (!user) return null;

  const selected = selectedId ? (posts.find((p) => p.id === selectedId) ?? null) : null;

  const handleToggleLock = async (post: PostRow) => {
    // 全局 guard 兜底：正常 UI 下 busy 已禁用按钮并拦截弹窗关闭（纯防御路径）
    if (busy) {
      alert("请等待当前操作完成");
      return;
    }
    setLockingId(post.id);
    const ok = await update(post.id, { is_locked: !post.is_locked });
    setLockingId(null);
    if (!ok) {
      // 优先展示 usePosts 中的具体错误信息，避免误导
      alert(error || "操作失败");
      return;
    }
    // 成功：usePosts 乐观更新本地 data，面板/列表锁定徽章自动同步
  };

  const handleDelete = async (post: PostRow) => {
    // 全局 guard 兜底：正常 UI 下 busy 已禁用按钮并拦截弹窗关闭（纯防御路径）
    if (busy) {
      alert("请等待当前操作完成");
      return;
    }
    if (!window.confirm("确定要删除这条公告吗？")) return;
    setDeletingId(post.id);
    const ok = await remove(post.id);
    setDeletingId(null);
    if (!ok) {
      // usePosts.remove 只返回 boolean，无法区分「0 行（帖子已被并发删除）」与真实失败
      // （对抗返工 Issue #205）：统一刷新列表同步真实状态——0 行时 DB 已无该帖，
      // 本地残留无意义，刷新后自然消失；真实失败时帖子仍在列表，用户可重试。
      // 提示文案兼容两种情况。
      void fetch();
      setSelectedId(null);
      alert("删除失败（帖子可能已被删除）");
      return;
    }
    // 成功：乐观更新已把帖子从列表移除；selectedId 置空回列表（派生兜底双保险）
    setSelectedId(null);
    alert("已删除。");
  };

  // busy（删除/锁定 pending）期间禁止关闭弹窗（遮罩关闭禁用 + 关闭按钮守卫），
  // 与操作行互斥对齐管理端 post-detail-modal 的做法
  const handleClose = () => {
    if (busy) return;
    onClose();
  };

  return (
    <>
      {/* 编辑弹窗打开时底层 Modal 加 inert 隔离（弹层焦点管理，CLAUDE.md）：
          Tab/点击无法逃逸到底层遮罩/「关闭」/列表项，防止误触关闭丢弃未保存的编辑内容；
          读屏器只暴露编辑弹窗一个 aria-modal。参照 admin/profile 全屏签名编辑的既有范式 */}
      <div inert={editPost !== null}>
        <Modal
          open
          onClose={handleClose}
          closeOnOverlay={!busy}
          title={selected ? selected.title : "已发布的活动"}
          // 只读状态入标题（CLAUDE.md）：管理面板的锁定状态放标题右侧，内容区不重复展示
          headerExtra={
            selected?.is_locked ? (
              <span className="rounded-full bg-danger/10 px-2 py-0.5 text-caption font-medium text-danger">
                🔒 已锁定
              </span>
            ) : undefined
          }
        >
          {selected ? (
            /* ---- 管理面板（只读详情 + 操作行） ---- */
            <div className="max-h-[90vh] space-y-3 overflow-y-auto text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-muted px-2 py-0.5 text-caption text-text-muted">
                  {TYPE_LABEL[selected.type as PostType]}
                </span>
              </div>
              <p className="text-text-muted">
                发布时间：{formatDateTimeInChina(selected.created_at)}
              </p>
              {selected.content != null && selected.content.trim() !== "" && (
                <p className="whitespace-pre-line leading-relaxed text-text">{selected.content}</p>
              )}
              {selected.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selected.image_url}
                  alt="公告图片"
                  className="max-h-64 w-full rounded-2xl border border-border object-contain"
                />
              )}
              {/* 底部操作行：编辑 / 锁定解锁 / 删除（busy 期间互相禁用；Issue #182：右下角） */}
              <div className="flex items-center justify-end gap-4 pt-1 text-label">
                <button
                  type="button"
                  onClick={() => {
                    // 编辑：关闭面板打开共用编辑弹窗（社区同款预填），完成后回列表
                    setEditPost(selected);
                    setSelectedId(null);
                  }}
                  disabled={busy}
                  className="text-text-muted hover:text-text disabled:opacity-50"
                >
                  编辑
                </button>
                <button
                  type="button"
                  onClick={() => void handleToggleLock(selected)}
                  disabled={busy}
                  className="text-text-muted hover:text-warning disabled:opacity-50"
                >
                  {lockingId === selected.id ? "处理中…" : selected.is_locked ? "解锁" : "锁定"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(selected)}
                  disabled={busy}
                  className="text-text-subtle hover:text-danger disabled:opacity-50"
                >
                  {deletingId === selected.id ? "删除中…" : "删除"}
                </button>
              </div>
            </div>
          ) : (
            /* ---- 列表视图（本人帖子，含锁定帖） ---- */
            <div className="mt-2 max-h-[60vh] space-y-2 overflow-y-auto pb-1">
              {loading && <p className="py-6 text-center text-xs text-text-muted">正在加载…</p>}
              {!loading && error && (
                <p className="py-6 text-center text-sm text-text-muted">加载失败，请稍后重试</p>
              )}
              {!loading && !error && posts.length === 0 && (
                <p className="py-6 text-center text-sm text-text-muted">暂无已发布的活动</p>
              )}
              {!loading &&
                !error &&
                posts.map((post) => (
                  <button
                    key={post.id}
                    type="button"
                    onClick={() => setSelectedId(post.id)}
                    className="w-full rounded-xl border border-border bg-card p-3 text-left"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <h2 className="truncate text-sm font-semibold text-text">{post.title}</h2>
                        <p className="mt-0.5 text-label text-text-muted">
                          {TYPE_LABEL[post.type as PostType]} ·{" "}
                          {formatDateTimeInChina(post.created_at)}
                        </p>
                      </div>
                      {post.is_locked && (
                        <span className="flex-shrink-0 rounded-full bg-danger/10 px-2 py-0.5 text-caption font-medium text-danger">
                          🔒 已锁定
                        </span>
                      )}
                    </div>
                  </button>
                ))}
            </div>
          )}
        </Modal>
      </div>

      {editPost && (
        <PublishModal
          post={editPost}
          defaultType={editPost.type}
          create={create}
          update={update}
          uploadImage={uploadImage}
          error={error}
          onClose={() => setEditPost(null)}
        />
      )}
    </>
  );
}
