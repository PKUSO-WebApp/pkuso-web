"use client";

import React from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";

export default function ResetPasswordPage() {
  const [email, setEmail] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState("");
  const [successMsg, setSuccessMsg] = React.useState("");
  // 暴力破解防护：记录上次请求时间，60 秒内只能请求一次
  // 使用 localStorage 持久化，页面刷新后仍然有效
  const [lastRequestTime, setLastRequestTime] = React.useState(() => {
    const saved = localStorage.getItem("resetPasswordLastRequest");
    return saved ? parseInt(saved, 10) : 0;
  });

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setErrorMsg("");
    setSuccessMsg("");

    // 暴力破解防护：60 秒内只能请求一次
    // 依赖 Supabase 内置的速率限制作为主要防护，前端 localStorage 作为第一层
    const now = Date.now();
    if (now - lastRequestTime < 60000) {
      const remainingSeconds = Math.ceil((60000 - (now - lastRequestTime)) / 1000);
      setErrorMsg(`请在 ${remainingSeconds} 秒后再次请求。`);
      return;
    }

    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      setErrorMsg("请输入邮箱地址。");
      return;
    }

    if (!validateEmail(trimmedEmail)) {
      setErrorMsg("请输入有效的邮箱地址。");
      return;
    }

    setSubmitting(true);
    setLastRequestTime(now);
    localStorage.setItem("resetPasswordLastRequest", String(now));

    try {
      // 直接调用 Supabase 重置密码接口，不提前验证邮箱是否注册
      // 这样可以防止邮箱枚举攻击，无论邮箱是否注册都返回统一提示
      const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo: `${window.location.origin}/reset-password/reset`,
      });

      if (error) {
        console.warn("[ResetPassword] 发送重置链接失败:", error.message);
      }

      // 无论成功与否，都显示统一的提示信息，不区分邮箱是否注册
      setSuccessMsg("如果该邮箱已注册，我们已发送重置链接到您的邮箱。");
      setEmail("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-[80vh] items-center justify-center pb-safe">
      <div className="w-full max-w-md">
        <Card className="rounded-3xl bg-surface p-5">
          <div className="mb-4 text-center">
            <h1 className="text-xl font-semibold text-text">重置密码</h1>
            <p className="mt-1 text-xs text-text-muted">输入您的邮箱，我们将发送重置链接</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <label className="block text-label font-medium text-text-muted">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setErrorMsg("");
                  setSuccessMsg("");
                }}
                className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-sm text-text outline-none focus:border-text-subtle"
                placeholder="name@example.com"
                autoComplete="email"
                maxLength={255}
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
              {submitting ? "发送中…" : "发送重置链接"}
            </button>
          </form>

          <div className="mt-4 text-center text-xs text-text-muted">
            想起密码了？{" "}
            <Link href="/login" className="font-medium text-text">
              返回登录
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
