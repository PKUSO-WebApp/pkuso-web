"use client";

import React from "react";
import { getFreshAccessToken } from "@/lib/auth-token";
import { EmailTemplateEditor } from "@/components/email-template-editor";
import { PLACEHOLDERS, getDefaultTemplate, getTemplateKeys } from "@/lib/email-template";
import { EMAIL_SIGNATURE_KEY, DEFAULT_EMAIL_SIGNATURE } from "@/lib/email-signature";
import { useAdminPageHeader } from "@/context/admin-page-header-context";

type TemplateTab = "full" | "section";
type Tab = TemplateTab | "signature";

const TAB_LABELS: Record<Tab, string> = {
  full: "合排模板",
  section: "分排模板",
  signature: "邮件签名",
};

type TemplateData = {
  subject: string;
  body: string;
};

export default function EmailSettingsPage() {
  const { setTitle } = useAdminPageHeader();
  const [activeTab, setActiveTab] = React.useState<Tab>("full");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const savingRef = React.useRef(false);
  const fetchSeqRef = React.useRef(0);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const [templates, setTemplates] = React.useState<Record<TemplateTab, TemplateData>>({
    full: { subject: "", body: "" },
    section: { subject: "", body: "" },
  });
  const [signature, setSignature] = React.useState("");

  const fetchSettings = React.useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    try {
      const token = await getFreshAccessToken();
      if (fetchSeqRef.current !== seq) return;
      if (!token) {
        setError("登录状态异常，请重新登录");
        setLoading(false);
        return;
      }
      const res = await fetch("/api/admin/settings", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await res.json().catch(() => ({}));
      if (fetchSeqRef.current !== seq) return;
      if (!res.ok) throw new Error(result.error || "加载失败");

      const fullSubject = result.email_template_full_subject ?? "";
      const fullBody = result.email_template_full_body ?? "";
      const sectionSubject = result.email_template_section_subject ?? "";
      const sectionBody = result.email_template_section_body ?? "";
      const sig = result.email_signature ?? "";

      setTemplates({
        full: { subject: fullSubject, body: fullBody },
        section: { subject: sectionSubject, body: sectionBody },
      });
      setSignature(sig);
      setLoading(false);
    } catch (err) {
      if (fetchSeqRef.current !== seq) return;
      setError(err instanceof Error ? err.message : "加载失败，请重试");
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchSettings();
  }, [fetchSettings]);

  React.useEffect(() => {
    setTitle("邮件设置");
  }, [setTitle]);

  const handleSubjectChange = (subject: string) => {
    if (activeTab === "signature") return;
    setTemplates((prev) => ({
      ...prev,
      [activeTab]: { ...prev[activeTab], subject },
    }));
    setSuccess(false);
  };

  const handleBodyChange = (body: string) => {
    if (activeTab === "signature") return;
    setTemplates((prev) => ({
      ...prev,
      [activeTab]: { ...prev[activeTab], body },
    }));
    setSuccess(false);
  };

  const handleSignatureChange = (value: string) => {
    setSignature(value);
    setSuccess(false);
  };

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    setSuccess(false);
    setError(null);
  };

  const handleReset = () => {
    if (activeTab === "signature") {
      setSignature(DEFAULT_EMAIL_SIGNATURE);
    } else {
      const defaults = getDefaultTemplate(activeTab);
      setTemplates((prev) => ({
        ...prev,
        [activeTab]: { ...defaults },
      }));
    }
    setSuccess(false);
    setError(null);
  };

  const saveSetting = async (key: string, value: string): Promise<boolean> => {
    const token = await getFreshAccessToken();
    if (!token) return false;
    const res = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ key, value: value.trim() }),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(result.error || "保存失败");
    return true;
  };

  const handleSave = async () => {
    if (savingRef.current || saving) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      if (activeTab === "signature") {
        await saveSetting(EMAIL_SIGNATURE_KEY, signature);
      } else {
        const keys = getTemplateKeys(activeTab);
        await Promise.all([
          saveSetting(keys.subjectKey, templates[activeTab].subject),
          saveSetting(keys.bodyKey, templates[activeTab].body),
        ]);
      }
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败，请重试");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const placeholders = PLACEHOLDERS.map((p) => ({
    name: p.name,
    label: p.label,
    example: p.example,
  }));

  const currentTemplate = templates[activeTab as TemplateTab];

  return (
    <div className="flex h-full min-h-0 flex-col space-y-4">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mt-4 space-y-3 pb-safe">
          <div className="flex gap-2 border-b border-border">
            {(["full", "section", "signature"] as Tab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => handleTabChange(tab)}
                className={`flex-1 py-2 px-4 text-xs font-medium rounded-t-xl border-b-2 transition-colors ${
                  activeTab === tab
                    ? "border-primary text-primary"
                    : "text-text-muted hover:text-text"
                }`}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>

          {loading ? (
            <p className="py-12 text-center text-xs text-text-muted">加载中…</p>
          ) : error && activeTab !== "signature" && !currentTemplate.subject ? (
            <div className="py-8 text-center">
              <p className="text-xs text-danger">加载失败：{error}</p>
              <button
                type="button"
                onClick={() => void fetchSettings()}
                className="mt-3 rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium text-text-muted hover:bg-muted"
              >
                重试
              </button>
            </div>
          ) : activeTab === "signature" ? (
            <textarea
              value={signature}
              onChange={(e) => handleSignatureChange(e.target.value)}
              disabled={saving}
              placeholder="如：北京大学学生交响乐团"
              className="w-full min-h-[120px] rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted disabled:opacity-50 resize-y"
              maxLength={500}
            />
          ) : (
            <EmailTemplateEditor
              subject={currentTemplate.subject}
              body={currentTemplate.body}
              onSubjectChange={handleSubjectChange}
              onBodyChange={handleBodyChange}
              placeholders={placeholders}
              disabled={saving}
              templateType={activeTab}
            />
          )}

          {success && <p className="text-xs text-success">已保存</p>}
          {error && <p className="text-xs text-danger">{error}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={handleReset}
              disabled={saving}
              className="rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium text-text-muted hover:bg-muted disabled:opacity-60"
            >
              重置为默认
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
