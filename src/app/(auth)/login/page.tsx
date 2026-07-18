"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setErrorMsg("");

    if (!email.trim() || !password) {
      setErrorMsg("请输入邮箱和密码。");
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setSubmitting(false);

    if (error) {
      setErrorMsg(error.message || "登录失败，请稍后重试。");
      return;
    }

    router.replace("/");
  };

  return (
    <div className="flex min-h-[80vh] items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="mb-4 text-center">
            <h1 className="text-xl font-semibold text-zinc-900">登录</h1>
            <p className="mt-1 text-xs text-zinc-500">登录后进入乐团系统</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-zinc-600">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setErrorMsg("");
                }}
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                placeholder="name@example.com"
                autoComplete="email"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-zinc-600">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrorMsg("");
                }}
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                placeholder="请输入密码"
                autoComplete="current-password"
              />
            </div>

            {errorMsg ? (
              <div className="rounded-xl bg-red-50 px-3 py-2 text-center text-sm text-red-600">
                {errorMsg}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 flex w-full items-center justify-center rounded-2xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white shadow-md hover:bg-zinc-800 disabled:opacity-60"
            >
              {submitting ? "登录中…" : "登录"}
            </button>
          </form>

          <div className="mt-4 text-center text-xs text-zinc-500">
            还没有账号？{" "}
            <Link href="/signup" className="font-medium text-zinc-900">
              去注册
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
