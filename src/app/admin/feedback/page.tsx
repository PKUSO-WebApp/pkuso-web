"use client";

import React from "react";
import { Modal } from "@/components/ui/Modal";
import { supabase } from "@/lib/supabase";
import { formatDateTimeInChina } from "@/lib/date-utils";
import type { FeedbackRow } from "@/types/database";
import { useAdminPageHeader } from "@/context/admin-page-header-context";

type FeedbackWithAuthor = FeedbackRow & { profiles?: { full_name?: string | null } | null };

export default function FeedbackPage() {
  const { setTitle, setHeaderRight } = useAdminPageHeader();
  const [isFeedbackOpen, setIsFeedbackOpen] = React.useState(false);
  const [feedbackRows, setFeedbackRows] = React.useState<FeedbackWithAuthor[]>([]);
  const [feedbackLoading, setFeedbackLoading] = React.useState(false);
  const [feedbackError, setFeedbackError] = React.useState(false);
  const feedbackSeqRef = React.useRef(0);
  const [deletingFeedbackId, setDeletingFeedbackId] = React.useState<string | null>(null);

  const fetchFeedback = () => {
    const seq = ++feedbackSeqRef.current;
    setFeedbackLoading(true);
    setFeedbackError(false);
    void supabase
      .from("feedback")
      .select("id, content, created_at, is_anonymous, profiles!inner(full_name)")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (seq !== feedbackSeqRef.current) return;
        setFeedbackLoading(false);
        if (error) {
          console.error("[Admin Feedback] 反馈列表查询失败", error.message);
          setFeedbackError(true);
          setFeedbackRows([]);
          return;
        }
        const rows = (
          (data ?? []) as Array<FeedbackRow & { profiles?: { full_name: string | null }[] }>
        ).map((r) => ({
          ...r,
          profiles: r.profiles?.[0] ?? null,
        }));
        setFeedbackRows(rows);
      });
  };

  const handleOpenFeedbackModal = React.useCallback(() => {
    setIsFeedbackOpen(true);
    fetchFeedback();
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
        setFeedbackRows((prev) => prev.filter((r) => r.id !== id));
      } else {
        alert(result?.error || "删除失败");
      }
    } catch {
      alert("网络错误");
    } finally {
      setDeletingFeedbackId(null);
    }
  };

  React.useEffect(() => {
    setTitle("反馈查看");
    setHeaderRight(
      <button
        type="button"
        onClick={handleOpenFeedbackModal}
        className="rounded-full bg-primary px-3 py-1 text-label font-medium text-primary-foreground hover:opacity-90"
      >
        查看反馈
      </button>,
    );
  }, [setTitle, setHeaderRight, handleOpenFeedbackModal]);

  return (
    <div className="flex h-full min-h-0 flex-col space-y-4">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <p className="text-xs text-text-muted text-center py-8">
          点击「查看反馈」查看成员提交的匿名/实名反馈
        </p>
      </div>

      <Modal
        open={isFeedbackOpen}
        onClose={() => setIsFeedbackOpen(false)}
        title="反馈列表"
        position="bottom"
      >
        <div className="mt-4 space-y-3 pb-safe">
          {feedbackLoading ? (
            <p className="py-8 text-center text-xs text-text-muted">加载中…</p>
          ) : feedbackError ? (
            <div className="py-8 text-center">
              <p className="text-xs text-danger">加载失败，请稍后重试</p>
              <button
                type="button"
                onClick={fetchFeedback}
                className="mt-3 rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium text-text-muted hover:bg-muted"
              >
                重试
              </button>
            </div>
          ) : feedbackRows.length === 0 ? (
            <p className="py-8 text-center text-xs text-text-muted">暂无反馈</p>
          ) : (
            <div className="max-h-[60vh] space-y-3 overflow-y-auto pb-1">
              {feedbackRows.map((row) => (
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
                      onClick={() => handleDeleteFeedback(row.id)}
                      className="shrink-0 rounded-full bg-danger-bg px-3 py-1.5 text-xs font-medium text-danger hover:opacity-90 disabled:opacity-60"
                    >
                      {deletingFeedbackId === row.id ? "删除中…" : "删除"}
                    </button>
                  </div>
                  <p className="mt-2 text-sm text-text">{row.content}</p>
                  {row.is_anonymous && (
                    <p className="mt-1 text-caption text-text-muted">匿名反馈</p>
                  )}
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setIsFeedbackOpen(false)}
            className="w-full rounded-xl border border-border bg-surface py-2.5 text-sm font-medium text-text-muted hover:bg-muted"
          >
            关闭
          </button>
        </div>
      </Modal>
    </div>
  );
}
