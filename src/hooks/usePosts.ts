"use client";

import React from "react";
import { supabase as defaultClient } from "@/lib/supabase";

export function usePosts(client: typeof defaultClient = defaultClient) {
  const [data, setData] = React.useState<unknown[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const fetch = React.useCallback(async () => {
    setLoading(true);
    const { data: rows, error: dbError } = await client
      .from("posts")
      .select(
        "id, title, type, content, image_url, author_id, created_at, contact_info, current_sections, missing_sections",
      )
      .order("created_at", { ascending: false });
    setLoading(false);
    if (dbError) {
      setError(dbError.message);
      setData([]);
      return;
    }
    setData((rows as unknown[]) ?? []);
  }, [client]);

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
