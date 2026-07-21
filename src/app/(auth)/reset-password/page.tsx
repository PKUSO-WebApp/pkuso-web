"use client";

import React from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const [email, setEmail] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState("");
  const [successMsg, setSuccessMsg] = React.useState("");

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setErrorMsg("");
    setSuccessMsg("");

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
    const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
      redirectTo: `${window.location.origin}/login`,
    });
    setSubmitting(false);

    if (error) {
      if (error.message.includes("User not found")) {
        setErrorMsg("该邮箱未注册，请检查输入是否正确。");
      } else {
        setErrorMsg(error.message || "发送重置邮件失败，请稍后重试。");
      }
      return;
    }

    setSuccessMsg("重置邮件已发送，请检查您的邮箱。");
    setEmail("");
  };

  return (
    <div className="flex min-h-[80vh] items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="rounded-3xl border border-border bg-surface p-5 shadow-sm">
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
              />
            </div>

            {errorMsg ? (
              <div className="rounded-xl bg-red-50 px-3 py-2 text-center text-sm text-red-600">
                {errorMsg}
              </div>
            ) : null}

            {successMsg ? (
              <div className="rounded-xl bg-green-50 px-3 py-2 text-center text-sm text-green-600">
                {successMsg}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 flex w-full items-center justify-center rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-white shadow-md hover:opacity-90 disabled:opacity-60"
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
        </div>
      </div>
    </div>
  );
}
