"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { INSTRUMENT_ORDER as INSTRUMENT_OPTIONS } from "@/constants/instruments";

export default function SignupPage() {
  const router = useRouter();
  const [invitationCode, setInvitationCode] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [fullName, setFullName] = React.useState("");
  const [instrument, setInstrument] = React.useState<(typeof INSTRUMENT_OPTIONS)[number] | "">("");
  const [college, setCollege] = React.useState("");
  const [joinYear, setJoinYear] = React.useState("");
  const [joinSemester, setJoinSemester] = React.useState<"春" | "秋" | "">("");
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
      !joinYear ||
      !joinSemester
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

    // upsert: createUser trigger 已自动建 profile，需覆盖
    const { error: profileError } = await supabase.from("profiles").upsert({
      id: userId,
      email: email.trim(),
      full_name: fullName.trim(),
      instrument,
      college: college.trim(),
      join_date: `${joinYear}${joinSemester}`,
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
        <div className="rounded-3xl border border-border bg-surface p-5 shadow-sm">
          <div className="mb-4 text-center">
            <h1 className="text-xl font-semibold text-text">创建账号</h1>
            <p className="mt-1 text-xs text-text-muted">注册后需等待管理员审核通过</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <label className="block text-label font-medium text-text-muted">
                乐团邀请码 (Invitation Code)
              </label>
              <input
                value={invitationCode}
                onChange={(e) => {
                  setInvitationCode(e.target.value);
                  setErrorMsg("");
                }}
                className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-sm text-text outline-none focus:border-text-muted"
                placeholder="请输入乐团邀请码"
                autoComplete="off"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-label font-medium text-text-muted">邮箱</label>
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setErrorMsg("");
                }}
                className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-sm text-text outline-none focus:border-text-muted"
                placeholder="name@example.com"
                autoComplete="email"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-label font-medium text-text-muted">密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrorMsg("");
                }}
                className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-sm text-text outline-none focus:border-text-muted"
                placeholder="至少 6 位"
                autoComplete="new-password"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-label font-medium text-text-muted">真实姓名</label>
              <input
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  setErrorMsg("");
                }}
                className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-sm text-text outline-none focus:border-text-muted"
                placeholder="请填写真实姓名"
                autoComplete="name"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-label font-medium text-text-muted">所属声部</label>
              <select
                value={instrument}
                onChange={(e) => {
                  setInstrument(e.target.value as (typeof INSTRUMENT_OPTIONS)[number]);
                  setErrorMsg("");
                }}
                className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-sm text-text outline-none focus:border-text-muted"
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
              <label className="block text-label font-medium text-text-muted">学院</label>
              <input
                value={college}
                onChange={(e) => {
                  setCollege(e.target.value);
                  setErrorMsg("");
                }}
                className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-sm text-text outline-none focus:border-text-muted"
                placeholder="例如：经济学院"
                autoComplete="organization"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-label font-medium text-text-muted">入团时间</label>
              <div className="flex gap-2">
                <select
                  value={joinYear}
                  onChange={(e) => {
                    setJoinYear(e.target.value);
                    setErrorMsg("");
                  }}
                  className="flex-1 rounded-xl border border-border bg-muted px-3 py-2 text-sm text-text outline-none focus:border-text-muted"
                >
                  <option value="" disabled>
                    年份
                  </option>
                  {Array.from({ length: 8 }, (_, i) => {
                    const y = new Date().getFullYear() - i;
                    return (
                      <option key={y} value={String(y)}>
                        {y}
                      </option>
                    );
                  })}
                </select>
                <select
                  value={joinSemester}
                  onChange={(e) => {
                    setJoinSemester(e.target.value as "春" | "秋");
                    setErrorMsg("");
                  }}
                  className="w-20 rounded-xl border border-border bg-muted px-3 py-2 text-sm text-text outline-none focus:border-text-muted"
                >
                  <option value="" disabled>
                    学期
                  </option>
                  <option value="春">春</option>
                  <option value="秋">秋</option>
                </select>
              </div>
            </div>

            {errorMsg ? (
              <div className="rounded-xl bg-red-50 px-3 py-2 text-center text-sm text-red-600">
                {errorMsg}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 flex w-full items-center justify-center rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-white shadow-md hover:opacity-90 disabled:opacity-60"
            >
              {submitting ? "注册中…" : "注册"}
            </button>
          </form>

          <div className="mt-4 text-center text-xs text-text-muted">
            已有账号？{" "}
            <Link href="/login" className="font-medium text-text">
              去登录
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
