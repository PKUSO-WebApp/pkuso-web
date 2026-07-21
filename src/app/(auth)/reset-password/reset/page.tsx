"use client";

import React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";

export default function ResetPasswordResetPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const type = searchParams.get("type");

  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState("");
  const [successMsg, setSuccessMsg] = React.useState("");
  const [isTokenValid, setIsTokenValid] = React.useState(false);
  const [tokenChecked, setTokenChecked] = React.useState(false);

  // 检查用户是否已通过重置链接登录（token 有效时 Supabase 会自动登录用户）
  React.useEffect(() => {
    const checkAuth = async () => {
      if (!token || !type) {
        setErrorMsg("重置链接无效，请重新请求密码重置。");
        setTokenChecked(true);
        return;
      }

      // 获取当前会话，检查用户是否已登录
      const { data, error } = await supabase.auth.getSession();

      if (error || !data.session?.user) {
        setErrorMsg("重置链接无效或已过期，请重新请求密码重置。");
        setIsTokenValid(false);
      } else {
        // 用户已通过重置链接登录，token 有效
        setIsTokenValid(true);
      }

      setTokenChecked(true);
    };

    checkAuth();
  }, [token, type]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setErrorMsg("");
    setSuccessMsg("");

    if (!password.trim() || !confirmPassword.trim()) {
      setErrorMsg("请输入新密码。");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMsg("两次输入的密码不一致，请重新输入。");
      return;
    }

    if (password.length < 6) {
      setErrorMsg("密码长度至少为 6 位，请重新设置。");
      return;
    }

    setSubmitting(true);

    // 更新密码
    const { error } = await supabase.auth.updateUser({
      password: password,
    });

    setSubmitting(false);

    if (error) {
      setErrorMsg(error.message || "密码重置失败，请稍后重试。");
      return;
    }

    // 密码更新成功后，主动登出用户
    await supabase.auth.signOut();

    setSuccessMsg("密码重置成功，请使用新密码登录。");
    // 延迟跳转
    setTimeout(() => {
      router.replace("/login");
    }, 2000);
  };

  return (
    <div className="flex min-h-[80vh] items-center justify-center pb-safe">
      <div className="w-full max-w-md">
        <Card className="rounded-3xl bg-surface p-5">
          <div className="mb-4 text-center">
            <h1 className="text-xl font-semibold text-text">设置新密码</h1>
            <p className="mt-1 text-xs text-text-muted">输入您的新密码</p>
          </div>

          {!tokenChecked ? (
            <div className="text-center py-8">
              <div className="animate-pulse text-text-muted">验证链接中...</div>
            </div>
          ) : !isTokenValid ? (
            <div className="text-center py-8">
              <div className="rounded-xl bg-danger-bg px-3 py-2 text-center text-sm text-danger">
                {errorMsg}
              </div>
              <div className="mt-4 text-center text-xs text-text-muted">
                <Link href="/reset-password" className="font-medium text-text">
                  重新请求密码重置
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1">
                <label className="block text-label font-medium text-text-muted">新密码</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setErrorMsg("");
                    setSuccessMsg("");
                  }}
                  className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-sm text-text outline-none focus:border-text-subtle"
                  placeholder="至少 6 位"
                  autoComplete="new-password"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-label font-medium text-text-muted">确认密码</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setErrorMsg("");
                    setSuccessMsg("");
                  }}
                  className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-sm text-text outline-none focus:border-text-subtle"
                  placeholder="再次输入密码"
                  autoComplete="new-password"
                />
              </div>

              {errorMsg ? (
                <div className="rounded-xl bg-danger-bg px-3 py-2 text-center text-sm text-danger">
                  {errorMsg}
                </div>
              ) : null}

              {successMsg ? (
                <div className="rounded-xl bg-success-bg px-3 py-2 text-center text-sm text-success">
                  {successMsg}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={submitting}
                className="mt-1 flex w-full items-center justify-center rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-md hover:opacity-90 disabled:opacity-60"
              >
                {submitting ? "设置中…" : "设置新密码"}
              </button>
            </form>
          )}

          <div className="mt-4 text-center text-xs text-text-muted">
            <Link href="/login" className="font-medium text-text">
              返回登录
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
