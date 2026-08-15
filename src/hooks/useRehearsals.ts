"use client";

import React from "react";
import { supabase as defaultClient } from "@/lib/supabase";
import type { RehearsalRow } from "@/types/database";

export function useRehearsals(client: typeof defaultClient = defaultClient) {
  const [data, setData] = React.useState<RehearsalRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const fetch = React.useCallback(async () => {
    setLoading(true);
    const { data: rows, error: dbError } = await client
      .from("rehearsals")
      .select("*")
      .order("start_time", { ascending: false });
    setLoading(false);
    if (dbError) {
      setError(dbError.message);
      setData([]);
      return;
    }
    setData((rows as RehearsalRow[]) ?? []);
  }, [client]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetch();
  }, [fetch]);

  const create = React.useCallback(
    async (payload: Record<string, unknown>) => {
      setSaving(true);
      const { data: inserted, error: dbError } = await client
        .from("rehearsals")
        .insert([payload] as never)
        .select("id")
        .single();
      setSaving(false);
      if (dbError || !inserted) {
        setError(dbError?.message ?? "创建失败");
        return null;
      }
      await fetch();
      return (inserted as { id: number }).id;
    },
    [client, fetch],
  );

  const update = React.useCallback(
    async (id: number, payload: Record<string, unknown>) => {
      setSaving(true);
      // updated_at 由 DB 触发器统一写入（BEFORE UPDATE ... SET NEW.updated_at = now()），
      // 与 created_at 同源时钟，避免客户端时钟漂移导致「更新」chip 假阴性
      const { error: dbError } = await client
        .from("rehearsals")
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
    async (id: number) => {
      setSaving(true);
      await client.from("attendances").delete().eq("rehearsal_id", id);
      const { error: dbError } = await client.from("rehearsals").delete().eq("id", id);
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

  return { data, loading, error, saving, fetch, create, update, remove };
}
