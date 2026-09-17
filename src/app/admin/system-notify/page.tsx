"use client";

import React from "react";
import { Modal } from "@/components/ui/Modal";
import { Toggle } from "@/components/ui/Toggle";
import { supabase } from "@/lib/supabase";
import type { SystemNotificationRow } from "@/types/database";
import { useAdminPageHeader } from "@/context/admin-page-header-context";

export default function SystemNotifyPage() {
  const { setTitle, setHeaderRight } = useAdminPageHeader();
  const [isNotifyOpen, setIsNotifyOpen] = React.useState(false);
  const [notifyTab, setNotifyTab] = React.useState<"发送通知" | "历史通知">("发送通知");
  const [notifyTitle, setNotifyTitle] = React.useState("");
  const [notifyContent, setNotifyContent] = React.useState("");
  const [isPublishing, setIsPublishing] = React.useState(false);
  const publishingRef = React.useRef(false);
  const [publishError, setPublishError] = React.useState<string | null>(null);
  const [publishSuccess, setPublishSuccess] = React.useState(false);
  const [notifyRows, setNotifyRows] = React.useState<SystemNotificationRow[]>([]);
  const [notifyLoading, setNotifyLoading] = React.useState(false);
  const [notifyError, setNotifyError] = React.useState(false);
  const notifySeqRef = React.useRef(0);

  const fetchNotifyHistory = () => {
    const seq = ++notifySeqRef.current;
    setNotifyLoading(true);
    setNotifyError(false);
    void supabase
      .from("system_notifications")
      .select("id, title, content, created_at")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (seq !== notifySeqRef.current) return;
        setNotifyLoading(false);
        if (error) {
          console.error("[Admin SystemNotify] 系统通知历史查询失败", error.message);
          setNotifyError(true);
          setNotifyRows([]);
          return;
        }
        setNotifyRows((data as SystemNotificationRow[] | null) ?? []);
      });
  };

  const handleOpenNotifyModal = React.useCallback(() => {
    setIsNotifyOpen(true);
    setNotifyTab("发送通知");
    fetchNotifyHistory();
  }, []);

  const handlePublishNotify = async () => {
    const title = notifyTitle.trim();
    const content = notifyContent.trim();
    if (!title || !content) {
      setPublishError("标题与内容均不能为空");
      return;
    }
    if (publishingRef.current || isPublishing) return;
    publishingRef.current = true;
    setIsPublishing(true);
    setPublishError(null);
    setPublishSuccess(false);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const response = await window.fetch("/api/admin/notify-system", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ title, content }),
      });
      const result = (await response.json().catch(() => null)) as {
        success?: boolean;
        count?: number;
        error?: string;
      } | null;
      if (response.ok && result?.success) {
        setNotifyTitle("");
        setNotifyContent("");
        setPublishSuccess(true);
        fetchNotifyHistory();
      } else {
        setPublishError(result?.error || "发布失败");
      }
    } catch {
      setPublishError("网络错误");
    } finally {
      publishingRef.current = false;
      setIsPublishing(false);
    }
  };

  React.useEffect(() => {
    setTitle("系统通知");
    setHeaderRight(
      <button
        type="button"
        onClick={handleOpenNotifyModal}
        className="rounded-full bg-primary px-3 py-1 text-label font-medium text-primary-foreground hover:opacity-90"
      >
        发布通知
      </button>,
    );
  }, [setTitle, setHeaderRight, handleOpenNotifyModal]);

  return (
    <div className="flex h-full min-h-0 flex-col space-y-4">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <p className="text-xs text-text-muted text-center py-8">
          点击「发布通知」向全体已通过成员广播站内通知
        </p>
      </div>

      {/* 发布/历史通知 Modal */}
      <Modal
        open={isNotifyOpen}
        onClose={() => setIsNotifyOpen(false)}
        title="系统通知"
        position="bottom"
      >
        <div className="mt-4 space-y-4 pb-safe">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-muted">功能</span>
            <Toggle
              options={["发送通知", "历史通知"] as const}
              value={notifyTab}
              onChange={(v) => setNotifyTab(v)}
              getLabel={(k) => k}
            />
          </div>

          {notifyTab === "发送通知" && (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-text-muted">标题</label>
                <input
                  type="text"
                  value={notifyTitle}
                  onChange={(e) => setNotifyTitle(e.target.value)}
                  className="input"
                  placeholder="通知标题"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-text-muted">内容</label>
                <textarea
                  value={notifyContent}
                  onChange={(e) => setNotifyContent(e.target.value)}
                  rows={4}
                  className="input"
                  placeholder="通知内容…"
                />
              </div>
              {publishError && <p className="text-xs text-danger">{publishError}</p>}
              {publishSuccess && <p className="text-xs text-success">发布成功，已送达全体成员</p>}
              <button
                type="button"
                disabled={isPublishing}
                onClick={handlePublishNotify}
                className="w-full rounded-xl bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
              >
                {isPublishing ? "发布中…" : "发布"}
              </button>
            </div>
          )}

          {notifyTab === "历史通知" && (
            <div className="space-y-3">
              {notifyLoading ? (
                <p className="py-8 text-center text-xs text-text-muted">加载中…</p>
              ) : notifyError ? (
                <div className="py-8 text-center">
                  <p className="text-xs text-danger">加载失败，请稍后重试</p>
                  <button
                    type="button"
                    onClick={fetchNotifyHistory}
                    className="mt-3 rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium text-text-muted hover:bg-muted"
                  >
                    重试
                  </button>
                </div>
              ) : notifyRows.length === 0 ? (
                <p className="py-8 text-center text-xs text-text-muted">暂无历史通知</p>
              ) : (
                <div className="max-h-[60vh] space-y-3 overflow-y-auto">
                  {notifyRows.map((row) => (
                    <div key={row.id} className="rounded-xl border border-border bg-card p-3">
                      <p className="font-medium text-text">{row.title}</p>
                      <p className="mt-1 text-xs text-text-muted">{row.content}</p>
                      <p className="mt-2 text-caption text-text-subtle">
                        发送时间：{new Date(row.created_at).toLocaleString("zh-CN")}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setIsNotifyOpen(false)}
            className="w-full rounded-xl border border-border bg-surface py-2.5 text-sm font-medium text-text-muted hover:bg-muted"
          >
            关闭
          </button>
        </div>
      </Modal>
    </div>
  );
}
