"use client";

import React from "react";
import { supabase } from "@/lib/supabase";
import type { AnnouncementRow } from "@/types/database";

export function useAnnouncements() {
  const [data, setData] = React.useState<AnnouncementRow | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [publishing, setPublishing] = React.useState(false);

  const fetch = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: rows, error: dbError } = await supabase
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
  }, []);

  React.useEffect(() => {
    void fetch();
  }, [fetch]);

  const publish = React.useCallback(async (content: string) => {
    setPublishing(true);
    const { error: dbError } = await supabase.from("announcements").insert({ content });
    setPublishing(false);
    if (dbError) {
      setError(dbError.message);
      return false;
    }
    return true;
  }, []);

  return { data, loading, error, publishing, fetch, publish };
}
