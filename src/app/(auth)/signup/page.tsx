"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const INSTRUMENT_OPTIONS = [
  "第一小提琴",
  "第二小提琴",
  "中提琴",
  "大提琴",
  "低音提琴",
  "长笛",
  "双簧管",
  "单簧管",
  "大管",
  "圆号",
  "小号",
  "长号",
  "大号",
  "打击乐",
  "键盘",
  "竖琴",
] as const;

export default function SignupPage() {
  const router = useRouter();
  const [invitationCode, setInvitationCode] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [fullName, setFullName] = React.useState("");
  const [instrument, setInstrument] = React.useState<(typeof INSTRUMENT_OPTIONS)[number] | "">("");
  const [college, setCollege] = React.useState("");
  const [joinDate, setJoinDate] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setErrorMsg("");

    const normalizedCode = invitationCode.trim().toUpperCase();
    if (normalizedCode !== "PKUSO2026") {
      alert("邀请码错误，请联系乐团管理员获取");
      return;
    }

    if (
      !email.trim() ||
      !password.trim() ||
      !fullName.trim() ||
      !instrument ||
      !college.trim() ||
      !joinDate.trim()
    ) {
      setErrorMsg("请填写完整信息后再提交。");
      return;
    }

    setSubmitting(true);
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password: password,
    });

    if (signUpError) {
      setSubmitting(false);
      setErrorMsg(signUpError.message || "注册失败，请稍后重试。");
      return;
    }

    const userId = signUpData.user?.id;
    if (!userId) {
      setSubmitting(false);
      setErrorMsg("注册成功但未获取到用户信息，请稍后重试。");
      return;
    }

    const { error: profileError } = await supabase.from("profiles").insert({
      id: userId,
      email: email.trim(),
      full_name: fullName.trim(),
      instrument,
      college: college.trim(),
      join_date: joinDate.trim(),
    });

    setSubmitting(false);

    if (profileError) {
      setErrorMsg(profileError.message || "写入资料失败，请稍后重试。");
      return;
    }

    alert("注册成功，请等待管理员审核");
    router.replace("/login");
  };

  return (
    <div className="flex min-h-[80vh] items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="mb-4 text-center">
            <h1 className="text-xl font-semibold text-zinc-900">创建账号</h1>
            <p className="mt-1 text-xs text-zinc-500">注册后需等待管理员审核通过</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-zinc-600">
                乐团邀请码 (Invitation Code)
              </label>
              <input
                value={invitationCode}
                onChange={(e) => {
                  setInvitationCode(e.target.value);
                  setErrorMsg("");
                }}
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                placeholder="请输入乐团邀请码"
                autoComplete="off"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-zinc-600">邮箱</label>
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
              <label className="block text-[11px] font-medium text-zinc-600">密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrorMsg("");
                }}
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                placeholder="至少 6 位"
                autoComplete="new-password"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-zinc-600">真实姓名</label>
              <input
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  setErrorMsg("");
                }}
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                placeholder="请填写真实姓名"
                autoComplete="name"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-zinc-600">所属声部</label>
              <select
                value={instrument}
                onChange={(e) => {
                  setInstrument(e.target.value as any);
                  setErrorMsg("");
                }}
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400"
              >
                <option value="" disabled>
                  请选择声部
                </option>
                {INSTRUMENT_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-zinc-600">学院</label>
              <input
                value={college}
                onChange={(e) => {
                  setCollege(e.target.value);
                  setErrorMsg("");
                }}
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                placeholder="例如：经济学院"
                autoComplete="organization"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-zinc-600">入团时间</label>
              <input
                value={joinDate}
                onChange={(e) => {
                  setJoinDate(e.target.value);
                  setErrorMsg("");
                }}
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                placeholder="例如：2024秋"
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
              {submitting ? "注册中…" : "注册"}
            </button>
          </form>

          <div className="mt-4 text-center text-xs text-zinc-500">
            已有账号？{" "}
            <Link href="/login" className="font-medium text-zinc-900">
              去登录
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
