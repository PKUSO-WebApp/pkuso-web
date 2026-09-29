"use client";

import React from "react";
import { supabase as defaultClient } from "@/lib/supabase";
import type { RehearsalRow } from "@/types/database";

export function useRehearsals(client: typeof defaultClient = defaultClient) {
  const [data, setData] = React.useState<RehearsalRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  /**
   * 最近一次 error 的**同步可读**副本，经 `getLastError()` 出给调用方。
   *
   * 为什么光有 `error` state 不够（这正是「置一个**可见**的 error」落不了地的原因）：
   * 调用方是在 `await remove(...)` / `await update(...)` 返回后的**同一个闭包**里决定
   * 文案的（如页面里的 `alert`），而 `setError` 要到下一次渲染才进那个闭包
   * ⇒ 那里读 `error` 拿到的是**上一次**的值（首次失败时就是 `null`），
   * 于是「没有匹配的记录，…」永远显示不出来、只剩通用文案。
   */
  const lastErrorRef = React.useRef<string | null>(null);
  const reportError = React.useCallback((message: string | null) => {
    lastErrorRef.current = message;
    setError(message);
  }, []);
  const getLastError = React.useCallback(() => lastErrorRef.current, []);

  const fetch = React.useCallback(async () => {
    setLoading(true);
    const { data: rows, error: dbError } = await client
      .from("rehearsals")
      .select("*")
      .order("start_time", { ascending: false });
    setLoading(false);
    if (dbError) {
      reportError(dbError.message);
      setData([]);
      return;
    }
    setData((rows as RehearsalRow[]) ?? []);
  }, [client, reportError]);

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
        reportError(dbError?.message ?? "创建失败");
        return null;
      }
      await fetch();
      return (inserted as { id: number }).id;
    },
    [client, fetch, reportError],
  );

  const update = React.useCallback(
    async (id: number, payload: Record<string, unknown>) => {
      setSaving(true);
      // updated_at 由 DB 触发器统一写入（BEFORE UPDATE ... SET NEW.updated_at = now()），
      // 与 created_at 同源时钟，避免客户端时钟漂移导致「更新」chip 假阴性
      // 链 .select("id") 做 0 行检测：命中 0 行时无 error（RLS 静默拒绝 / 记录已被并发删除），
      // 若按成功处理会重取列表后显示「没变」而宣称成功（Issue #368）
      const { data: updated, error: dbError } = await client
        .from("rehearsals")
        .update(payload as never)
        .eq("id", id)
        .select("id");
      setSaving(false);
      if (dbError) {
        reportError(dbError.message);
        return false;
      }
      if (!updated || updated.length === 0) {
        reportError("没有匹配的记录，排练可能已被删除");
        return false;
      }
      await fetch();
      return true;
    },
    [client, fetch, reportError],
  );

  const remove = React.useCallback(
    async (id: number) => {
      setSaving(true);
      // 删除数据库行：链 .select("id") 做 0 行检测（AGENTS.md「0 行更新必须检测」）——
      // 0 行时无 error，若按成功处理，界面里那行消失了而库里还在（Issue #368）
      const { data: deleted, error: dbError } = await client
        .from("rehearsals")
        .delete()
        .eq("id", id)
        .select("id");
      if (dbError) {
        setSaving(false);
        reportError(dbError.message);
        return false;
      }
      if (!deleted || deleted.length === 0) {
        setSaving(false);
        reportError("没有匹配的记录，排练可能已被删除");
        return false;
      }
      // 副作用一律在 0 行检测之后（usePosts.remove 的同款顺序）：
      // 清考勤子行是 best-effort。`attendances.rehearsal_id` 是 ON DELETE CASCADE
      // ⇒ 上一句删成功后这里通常已经是 0 行，所以 0 行是**合法结果**，不能当失败。
      // 链 .select("id") 是为了把「真删掉了 N 行」和「一行都没匹配上」分开，
      // 并把原来被整个丢弃的 error 暴露出来（原写法 `await …delete()…` 连 error 都没接）。
      //
      // 「先删排练、再清考勤」这个顺序**以 CASCADE 为前提**（若是 NO ACTION/RESTRICT，
      // 带考勤的排练会删不掉），所以这条约束在 **prod 与 dev 都核过**：两边都是
      // ON DELETE CASCADE，`confdeltype = 'c'`。之所以两边都核，是因为这两个环境的
      // 约束**确实会分叉**——`schedules_group_id_fkey` 就是 prod CASCADE / dev SET NULL。
      const { error: attendanceError } = await client
        .from("attendances")
        .delete()
        .eq("rehearsal_id", id)
        .select("id");
      if (attendanceError) {
        // 同 usePosts.remove 的附件清理：主操作已成功，子行清理失败不改判结果
        console.error("[useRehearsals] 清理考勤失败（排练已删除）:", attendanceError.message);
      }
      setSaving(false);
      await fetch();
      return true;
    },
    [client, fetch, reportError],
  );

  return { data, loading, error, saving, fetch, create, update, remove, getLastError };
}
