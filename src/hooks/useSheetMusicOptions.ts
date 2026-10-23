"use client";

import React from "react";
import { supabase } from "@/lib/supabase";

/** 排练曲目选择器用的最小曲目信息 */
export type SheetMusicOption = {
  id: string;
  title: string;
};

/**
 * 谱务库曲目列表（排练表单的「从谱务选择」用）。
 * 只读 id/title；失败时返回空列表，表单仍可添加无谱曲目。
 */
export function useSheetMusicOptions(): SheetMusicOption[] {
  const [options, setOptions] = React.useState<SheetMusicOption[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    void supabase
      .from("sheet_music")
      .select("id, title")
      .order("title")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("[useSheetMusicOptions] 曲目加载失败", error.message);
          return;
        }
        setOptions((data ?? []) as SheetMusicOption[]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return options;
}
