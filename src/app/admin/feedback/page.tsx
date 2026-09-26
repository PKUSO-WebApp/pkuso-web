"use client";

import React from "react";
import { supabase } from "@/lib/supabase";
import { formatDateTimeInChina } from "@/lib/date-utils";
import type { FeedbackRow } from "@/types/database";
import { useAdminPageHeader } from "@/context/admin-page-header-context";

// ⚠️ `profiles` 是**对象**不是数组：反馈 → profiles 的 FK（`feedback_created_by_fkey`）
// 在 feedback 那一侧，所以从 feedback 看是**多对一**，PostgREST 的嵌入回单个对象
//（仓内另两个 join 扩展 `PostRowWithAuthor` / `AttendanceRowWithUser` 也是这么写的）。
// 查询归一化里原先是 `r.profiles?.[0] ?? null` —— 对象上取 `[0]` 恒为 undefined，
// 于是作者名不显示。⚠️ 别写成「从来没显示出来过」：**#268（`63d6948`）修过它**，
// 是 #271（`f2bd326`）重写这个页面（抽出页面 + 引入 `!inner`）时又带回来的
// —— #314 接上泛型后由类型报错再照出来一次。
// ⚠️ `profiles` 是**必填、可空**，不是可选：左连接下 PostgREST 一定发这个键、值可能是 `null`。
// 写成 `profiles?` 的话「**把嵌入从 select 里漏掉**」也合法 ⇒ 类型检查对漏字段完全失明，
// 而作者名会**静静地**不再显示（**收紧那两条断言之前**实测：类型退回可选形态 + 删掉
// `profiles(full_name)` ⇒ tsc 0 错、**用例也照绿**；现在那两条断言会把这个组合判红 ——
// 它们就是为「类型层失明」兜底的）。`full_name` 同理：列在库里存在、只是可空。
type FeedbackWithAuthor = Pick<FeedbackRow, "id" | "content" | "created_at" | "is_anonymous"> & {
  profiles: { full_name: string | null } | null;
};

export default function FeedbackPage() {
  const { setTitle } = useAdminPageHeader();
  const [rows, setRows] = React.useState<FeedbackWithAuthor[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);
  const [deletingFeedbackId, setDeletingFeedbackId] = React.useState<string | null>(null);
  const seqRef = React.useRef(0);

  React.useEffect(() => {
    setTitle("反馈查看");
  }, [setTitle]);

  React.useEffect(() => {
    const seq = ++seqRef.current;
    void supabase
      .from("feedback")
      // ⚠️ **不带 `!inner`**：inner-join 语义会把「嵌入为 null」的父行**整个滤掉**，
      // 而匿名反馈的 `created_by` 就是 null ⇒ 带 `!inner` 会让**匿名反馈从列表里消失**
      //（#271 重写页面时带进来的回归）。渲染侧本来就是 null-safe 的。
      .select("id, content, created_at, is_anonymous, profiles(full_name)")
      .order("created_at", { ascending: false })
      .then(({ data, error: dbError }) => {
        if (seq !== seqRef.current) return;
        setLoading(false);
        if (dbError) {
          console.error("[Admin Feedback] 反馈列表查询失败", dbError.message);
          setError(true);
          setRows([]);
          return;
        }
        // ⚠️ 这里**不需要** cast 也不需要归一化：泛型接上之后 `data` 的推断类型就是
        // `profiles: { full_name: string | null } | null`，与 FeedbackWithAuthor 相容。
        // （原先那份 cast 把类型钉回手写形状，恰好与「让生成类型参与检查」相反。）
        setRows(data ?? []);
      });
  }, []);

  const refetch = React.useCallback(() => {
    setLoading(true);
    setError(false);
    const seq = ++seqRef.current;
    void supabase
      .from("feedback")
      // ⚠️ **不带 `!inner`**：inner-join 语义会把「嵌入为 null」的父行**整个滤掉**，
      // 而匿名反馈的 `created_by` 就是 null ⇒ 带 `!inner` 会让**匿名反馈从列表里消失**
      //（#271 重写页面时带进来的回归）。渲染侧本来就是 null-safe 的。
      .select("id, content, created_at, is_anonymous, profiles(full_name)")
      .order("created_at", { ascending: false })
      .then(({ data, error: dbError }) => {
        if (seq !== seqRef.current) return;
        setLoading(false);
        if (dbError) {
          setError(true);
          setRows([]);
          return;
        }
        // ⚠️ 这里**不需要** cast 也不需要归一化：泛型接上之后 `data` 的推断类型就是
        // `profiles: { full_name: string | null } | null`，与 FeedbackWithAuthor 相容。
        // （原先那份 cast 把类型钉回手写形状，恰好与「让生成类型参与检查」相反。）
        setRows(data ?? []);
      });
  }, []);

  const handleDeleteFeedback = async (id: string) => {
    if (deletingFeedbackId) return;
    if (!window.confirm("确定删除这条反馈吗？删除后不可恢复")) return;
    setDeletingFeedbackId(id);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const response = await window.fetch(`/api/admin/feedback?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : undefined,
      });
      const result = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (response.ok && result?.ok) {
        setRows((prev) => prev.filter((r) => r.id !== id));
      } else {
        alert(result?.error || "删除失败");
      }
    } catch {
      alert("网络错误");
    } finally {
      setDeletingFeedbackId(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 min-h-0 space-y-3 overflow-y-auto">
        {loading ? (
          <p className="py-8 text-center text-xs text-text-muted">加载中…</p>
        ) : error ? (
          <div className="py-8 text-center">
            <p className="text-xs text-danger">加载失败，请稍后重试</p>
            <button
              type="button"
              onClick={refetch}
              className="mt-3 rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium text-text-muted hover:bg-muted"
            >
              重试
            </button>
          </div>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-xs text-text-muted">暂无反馈</p>
        ) : (
          rows.map((row) => (
            <div key={row.id} className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-caption text-text-muted">
                  {formatDateTimeInChina(row.created_at)}
                  {!row.is_anonymous && row.profiles?.full_name
                    ? ` · ${row.profiles.full_name}`
                    : ""}
                </p>
                <button
                  type="button"
                  disabled={deletingFeedbackId !== null}
                  onClick={() => void handleDeleteFeedback(row.id)}
                  className="shrink-0 rounded-full bg-danger-bg px-3 py-1.5 text-xs font-medium text-danger hover:opacity-90 disabled:opacity-60"
                >
                  {deletingFeedbackId === row.id ? "删除中…" : "删除"}
                </button>
              </div>
              <p className="mt-2 text-sm text-text">{row.content}</p>
              {row.is_anonymous && <p className="mt-1 text-caption text-text-muted">匿名反馈</p>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
