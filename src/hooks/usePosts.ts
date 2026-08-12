"use client";

import React from "react";
import { supabase as defaultClient } from "@/lib/supabase";

export function usePosts(options?: { client?: typeof defaultClient; includeLocked?: boolean }) {
  const { client = defaultClient, includeLocked = false } = options ?? {};

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

    query = query.order("created_at", { ascending: false });

    const { data: rows, error: dbError } = await query;
    setLoading(false);
    if (dbError) {
      setError(dbError.message);
      setData([]);
      return;
    }
    setData((rows as unknown[]) ?? []);
  }, [client, includeLocked]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetch();
  }, [fetch]);

  const create = React.useCallback(
    async (payload: Record<string, unknown>) => {
      setSaving(true);
      const { error: dbError } = await client.from("posts").insert(payload as never);
      setSaving(false);
      if (dbError) {
        setError(dbError.message);
        return false;
      }
      await fetch();
      return true;
    },
    [client, fetch],
  );

  const update = React.useCallback(
    async (id: string, payload: Record<string, unknown>) => {
      setSaving(true);
      const { error: dbError } = await client
        .from("posts")
        .update(payload as never)
        .eq("id", id);
      setSaving(false);
      if (dbError) {
        setError(dbError.message);
        return false;
      }
      await fetch();
      return true;
    },
    [client, fetch],
  );

  const remove = React.useCallback(
    async (id: string) => {
      setSaving(true);
      // 先查询图片 URL，删除 post 前清理存储图片
      try {
        const { data: postData } = await client
          .from("posts")
          .select("image_url")
          .eq("id", id)
          .maybeSingle();
        const imageUrl = (postData as { image_url?: string | null } | null)?.image_url;
        if (imageUrl) {
          // 从 URL 中提取 storage 路径：...community-images/<path>
          const idx = imageUrl.indexOf("community-images/");
          if (idx !== -1) {
            const encodedPath = imageUrl.slice(idx + "community-images/".length);
            const filePath = decodeURIComponent(encodedPath);
            await client.storage.from("community-images").remove([filePath]);
          }
        }
      } catch {
        // 查询图片或删除存储文件失败不影响数据库删除
      }
      // 删除数据库行
      const { error: dbError } = await client.from("posts").delete().eq("id", id);
      setSaving(false);
      if (dbError) {
        setError(dbError.message);
        return false;
      }
      await fetch();
      return true;
    },
    [client, fetch],
  );

  const uploadImage = React.useCallback(
    async (file: File, userId: string) => {
      const path = `${userId}/${Date.now()}-${file.name}`;
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
