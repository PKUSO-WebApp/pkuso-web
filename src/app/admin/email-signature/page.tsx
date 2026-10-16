"use client";

import React from "react";
import { getFreshAccessToken } from "@/lib/auth-token";
import { EMAIL_SIGNATURE_KEY, EMAIL_SIGNATURE_MAX_LENGTH } from "@/lib/email-signature";
import { useAdminPageHeader } from "@/context/admin-page-header-context";

export default function EmailSignaturePage() {
  const { setTitle } = useAdminPageHeader();
  const [sigLoading, setSigLoading] = React.useState(true);
  const [sigSubmitting, setSigSubmitting] = React.useState(false);
  const sigSubmittingRef = React.useRef(false);
  const sigFetchSeqRef = React.useRef(0);
  const [sigValue, setSigValue] = React.useState("");
  const [sigError, setSigError] = React.useState<string | null>(null);
  const [sigSuccess, setSigSuccess] = React.useState(false);

  const fetchSignature = async () => {
    const seq = ++sigFetchSeqRef.current;
    try {
      const token = await getFreshAccessToken();
      if (sigFetchSeqRef.current !== seq) return;
      if (!token) {
        setSigError("登录状态异常，请重新登录");
        setSigLoading(false);
        return;
      }
      const res = await fetch("/api/admin/settings", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await res.json().catch(() => ({}));
      if (sigFetchSeqRef.current !== seq) return;
      if (!res.ok) throw new Error(result.error || "加载失败");
      // 读成功要清掉上一次的错误：失败过之后表单是按 `sigError && sigValue === ""` 藏的，
      // 而重试一成功 sigValue 就非空 ⇒ 表单立刻渲染出来，`sigError` 若留着就会让
      // 「已读到真实签名」与一句「加载失败/请重新登录」**同时**挂在页面上。
      setSigError(null);
      // ⚠️ GET 返回的是**键值映射**（`route.ts` 的 `Object.fromEntries(...)`），
      // 不是 `{ key, value }` 那种单值形态 —— 按键取。取错键不会报错，只会让
      // textarea 恒为空，而「空 + 保存」走服务端的删键路径 ⇒ 静默清掉已有签名。
      setSigValue(result[EMAIL_SIGNATURE_KEY] ?? "");
      setSigLoading(false);
    } catch (err) {
      if (sigFetchSeqRef.current !== seq) return;
      setSigError(err instanceof Error ? err.message : "加载失败，请重试");
      setSigLoading(false);
    }
  };

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchSignature();
  }, []);

  React.useEffect(() => {
    setTitle("邮件签名");
  }, [setTitle]);

  const handleSaveSignature = async (): Promise<boolean> => {
    if (sigSubmittingRef.current || sigSubmitting) return false;
    sigSubmittingRef.current = true;
    setSigSubmitting(true);
    // ⚠️ textarea 的归属只能有一个裁决者：**写一旦起手，在飞的读整体作废**（序号 +1）。
    // 读在每个写状态的分支前都比对序号，所以它之后再落地也改不动 sigValue / sigError。
    // 少了这一行，「先点「重置」再点「保存」」时后到的读会盖掉刚保存的值、或擦掉保存
    // 失败的文案 —— 页面显示服务端旧值却挂着「签名已保存」，比没有提示更误导。
    // 必须在本函数**第一个 await 之前**：无 token 那条路径直接 return，放到取 token
    // 之后它就来不及作废（用例「保存因无 token 被拒」钉的正是这个位置）。
    // 只需单向（写压读）：读只在用户显式动作下起手，而保存期间这些入口都不可用；
    // 将来若给读加一条保存期间可用的入口，这里就要补对称的作废。
    sigFetchSeqRef.current++;
    setSigError(null);
    setSigSuccess(false);
    try {
      const token = await getFreshAccessToken();
      if (!token) {
        setSigError("登录状态异常，请重新登录");
        return false;
      }
      const trimmed = sigValue.trim();
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        // `key` 是服务端的第一道校验（`route.ts` 的 `ALL_SETTINGS_KEYS`），
        // 漏了它必然 400「无效的设置键」——不是后端拒写，是请求本身不合法。
        body: JSON.stringify({ key: EMAIL_SIGNATURE_KEY, value: trimmed }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || "保存失败，请重试");
      setSigValue(trimmed);
      setSigSuccess(true);
      return true;
    } catch (err) {
      setSigError(err instanceof Error ? err.message : "保存失败，请重试");
      return false;
    } finally {
      sigSubmittingRef.current = false;
      setSigSubmitting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col space-y-4">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mt-4 space-y-3 pb-safe">
          <p className="text-xs text-text-muted">排练通知邮件底部的落款签名</p>

          {sigLoading ? (
            <p className="py-6 text-center text-xs text-text-muted">加载中…</p>
          ) : sigError && sigValue === "" ? (
            <div className="py-4 text-center">
              <p className="text-xs text-danger">加载失败：{sigError}</p>
              <button
                type="button"
                onClick={() => void fetchSignature()}
                className="mt-3 rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium text-text-muted hover:bg-muted"
              >
                重试
              </button>
            </div>
          ) : (
            <>
              <textarea
                value={sigValue}
                onChange={(e) => {
                  setSigValue(e.target.value);
                  setSigSuccess(false);
                }}
                rows={9}
                maxLength={EMAIL_SIGNATURE_MAX_LENGTH}
                disabled={sigSubmitting}
                className="w-full resize-none rounded-xl border border-border bg-muted px-3 py-3 text-xs leading-[1.6] text-text outline-none focus:border-text-muted"
                placeholder="如：北京大学交响乐团管理团队"
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-text-muted">支持多行换行</p>
                <p className="text-xs text-text-muted">
                  {sigValue.length}/{EMAIL_SIGNATURE_MAX_LENGTH}
                </p>
              </div>
              {!sigValue.trim() && (
                <p className="text-xs text-text-muted">未设置时邮件将使用默认签名</p>
              )}
              {sigSuccess && <p className="text-xs text-success">签名已保存</p>}
              {sigError && <p className="text-xs text-danger">{sigError}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  disabled={sigSubmitting}
                  onClick={() => fetchSignature()}
                  className="rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium text-text-muted hover:bg-muted disabled:opacity-60"
                >
                  重置
                </button>
                <button
                  type="button"
                  disabled={sigSubmitting}
                  onClick={() => void handleSaveSignature()}
                  className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
                >
                  {sigSubmitting ? "保存中…" : "保存"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
