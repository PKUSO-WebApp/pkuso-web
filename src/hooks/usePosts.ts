"use client";

import React from "react";
import { supabase as defaultClient } from "@/lib/supabase";

export function usePosts(options?: {
  client?: typeof defaultClient;
  includeLocked?: boolean;
  /** 仅查询该作者的帖子（「我的-已发布的活动」个人面板，Issue #205）；默认查全部 */
  authorId?: string | null;
}) {
  const { client = defaultClient, includeLocked = false, authorId = null } = options ?? {};

  const [data, setData] = React.useState<unknown[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const fetch = React.useCallback(async () => {
    setLoading(true);
    let query = client
      .from("posts")
      .select(
        "id, title, type, content, image_url, author_id, created_at, contact_info, current_sections, missing_sections, is_locked, profiles(full_name, instrument)",
      );

    // member 端默认过滤已锁定帖子；admin 端传入 includeLocked: true 可见全部
    if (!includeLocked) {
      query = query.eq("is_locked", false);
    }

    // 个人面板按作者过滤（含锁定帖由 includeLocked: true 配合，Issue #205）。
    // 用 != null 而非 truthy：authorId 为 null/undefined（user 未就绪）时才跳过过滤；
    // "" 会被加 eq("author_id", "")（结果为空列表，比拉全团更安全）
    if (authorId != null) {
      query = query.eq("author_id", authorId);
    }

    query = query.order("created_at", { ascending: false });

    const { data: rows, error: dbError } = await query;
    setLoading(false);
    if (dbError) {
      setError(dbError.message);
      setData([]);
      return;
    }
    setData((rows as unknown[]) ?? []);
  }, [client, includeLocked, authorId]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetch();
  }, [fetch]);

  const create = React.useCallback(
    async (payload: Record<string, unknown>) => {
      setSaving(true);
      const { data: inserted, error: dbError } = await client
        .from("posts")
        .insert(payload as never)
        .select();
      setSaving(false);
      if (dbError) {
        setError(dbError.message);
        return false;
      }
      // 乐观更新：新帖子直接插入列表头部，不依赖 fetch 刷新（fetch 的 join 查询可能失败）
      const insertedRow = Array.isArray(inserted) ? inserted[0] : null;
      if (insertedRow) setData((prev) => [insertedRow, ...prev]);
      setError(null);
      return true;
    },
    [client],
  );

  const update = React.useCallback(
    async (id: string, payload: Record<string, unknown>) => {
      setSaving(true);
      // 链 .select("id") 检测 0 行更新（CLAUDE.md）：RLS 静默失败或记录已被并发删除时
      // 返回 false，避免上层假成功（如对已删帖子编辑保存导致内容静默丢失）
      const { data: updated, error: dbError } = await client
        .from("posts")
        .update(payload as never)
        .eq("id", id)
        .select("id");
      setSaving(false);
      if (dbError) {
        setError(dbError.message);
        return false;
      }
      if (!updated || updated.length === 0) {
        // 0 行（RLS 静默失败/记录已被删除）：清理旧 error，避免误导上层提示文案
        setError(null);
        return false;
      }
      // 乐观更新：原地合并修改内容，不依赖 fetch 刷新
      setData((prev) =>
        prev.map((p) =>
          (p as { id?: string } | null)?.id === id
            ? { ...(p as Record<string, unknown>), ...payload }
            : p,
        ),
      );
      setError(null);
      return true;
    },
    [client],
  );

  const remove = React.useCallback(
    async (id: string) => {
      setSaving(true);
      // 先查图片 URL（删行后行不存在，需在删行前取到；查询失败不影响删除主流程）
      let imageUrl: string | null = null;
      try {
        const { data: postData } = await client
          .from("posts")
          .select("image_url")
          .eq("id", id)
          .maybeSingle();
        imageUrl = (postData as { image_url?: string | null } | null)?.image_url ?? null;
      } catch {
        // 查询图片 URL 失败不影响数据库删除
      }
      // 删除数据库行：链 .select("id") 做 0 行检测（CLAUDE.md）——双管理员并发删帖时
      // 后删者命中 0 行无 error，若按成功处理会向作者发「假成功」删除通知（Issue #188 对抗返工）
      const { data: deleted, error: dbError } = await client
        .from("posts")
        .delete()
        .eq("id", id)
        .select("id");
      setSaving(false);
      if (dbError) {
        setError(dbError.message);
        return false;
      }
      if (!deleted || deleted.length === 0) {
        // 0 行（RLS 静默失败/记录已被并发删除）：清理旧 error，返回 false 且不删附件
        setError(null);
        return false;
      }
      // 行删除成功后再清理存储图片（best-effort，失败不影响删除结果）
      if (imageUrl) {
        try {
          // 从 URL 中提取 storage 路径：...community-images/<path>
          const idx = imageUrl.indexOf("community-images/");
          if (idx !== -1) {
            const encodedPath = imageUrl.slice(idx + "community-images/".length);
            const filePath = decodeURIComponent(encodedPath);
            await client.storage.from("community-images").remove([filePath]);
          }
        } catch {
          // 删除存储文件失败不影响数据库删除结果
        }
      }
      // 乐观更新：从本地列表移除，不依赖 fetch 刷新
      setData((prev) => prev.filter((p) => (p as { id?: string } | null)?.id !== id));
      setError(null);
      return true;
    },
    [client],
  );

  const uploadImage = React.useCallback(
    async (file: File, userId: string) => {
      // 文件名消毒：手机截图等原始文件名含中文/空格（如「屏幕截图 2025-11-11 201007.png」），
      // 直接作 storage key 会被 Supabase Storage 拒绝（400 InvalidKey）。
      // 保留 [A-Za-z0-9._-]，其余字符替换为 "-"（扩展名自然保留）；消毒后为空则兜底 "image"。
      const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "-") || "image";
      const path = `${userId}/${Date.now()}-${safeName}`;
      const { error: uploadError } = await client.storage
        .from("community-images")
        .upload(path, file, { upsert: false });
      if (uploadError) return { error: uploadError.message };
      const { data: urlData } = client.storage.from("community-images").getPublicUrl(path);
      return { url: urlData.publicUrl };
    },
    [client],
  );

  return { data, loading, error, saving, fetch, create, update, remove, uploadImage };
}
