"use client";

import React from "react";
import { supabase as defaultClient } from "@/lib/supabase";
import type { AnnouncementRow } from "@/types/database";

export function useAnnouncements(client: typeof defaultClient = defaultClient) {
  const [data, setData] = React.useState<AnnouncementRow | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [publishing, setPublishing] = React.useState(false);

  const fetch = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: rows, error: dbError } = await client
      .from("announcements")
      .select("id, content, created_at")
      .order("created_at", { ascending: false })
      .limit(1);
    setLoading(false);
    if (dbError) {
      setError(dbError.message);
      setData(null);
      return;
    }
    const row = Array.isArray(rows) && rows.length > 0 ? (rows[0] as AnnouncementRow) : null;
    setData(row);
  }, [client]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetch();
  }, [fetch]);

  const publish = React.useCallback(
    async (content: string) => {
      setPublishing(true);
      const { error: dbError } = await client.from("announcements").insert({ content });
      setPublishing(false);
      if (dbError) {
        setError(dbError.message);
        return false;
      }
      return true;
    },
    [client],
  );

  return { data, loading, error, publishing, fetch, publish };
}
