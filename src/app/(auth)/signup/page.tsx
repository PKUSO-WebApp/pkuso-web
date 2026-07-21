"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { INSTRUMENT_ORDER as INSTRUMENT_OPTIONS } from "@/constants/instruments";
import { Card } from "@/components/ui/Card";

export default function SignupPage() {
  const router = useRouter();
  const [invitationCode, setInvitationCode] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [fullName, setFullName] = React.useState("");
  const [instrument, setInstrument] = React.useState<
    (typeof INSTRUMENT_OPTIONS)[number] | "其他" | ""
  >("");
  const [college, setCollege] = React.useState("");
  const [joinYear, setJoinYear] = React.useState("");
  const [joinSemester, setJoinSemester] = React.useState<"春" | "秋" | "">("");
  const [submitting, setSubmitting] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState("");
  const [successMsg, setSuccessMsg] = React.useState("");

  const validateInvitationCode = async (
    code: string,
    userId?: string | null,
  ): Promise<string | null> => {
    // 使用原子函数验证邀请码，将验证和记录使用者合并为一个操作，防止竞态条件
    const { data, error } = await supabase.rpc("verify_and_use_invitation_code", {
      p_code: code,
      p_user_id: userId,
    });

    if (error) {
      return "邀请码验证失败，请稍后重试。";
    }

    // 函数返回的是一个表，取第一个结果
    const result = data?.[0];
    if (!result) {
      return "邀请码验证失败，请稍后重试。";
    }

    // 验证失败 - 返回统一错误消息，防止枚举攻击
    if (!result.success) {
      return "邀请码无效或已被使用，请联系乐团管理员获取新的邀请码。";
    }

    // 验证通过
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setErrorMsg("");
    setSuccessMsg("");

    const normalizedCode = invitationCode.trim().toUpperCase();

    // 邀请码长度验证
    if (normalizedCode.length > 20) {
      setErrorMsg("邀请码长度不能超过 20 个字符。");
      return;
    }

    if (
      !normalizedCode ||
      !email.trim() ||
      !password.trim() ||
      !confirmPassword.trim() ||
      !fullName.trim() ||
      !instrument ||
      !college.trim() ||
      !joinYear ||
      !joinSemester
    ) {
      setErrorMsg("请填写完整信息后再提交。");
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

    try {
      // 步骤1：先注册用户，获得 user_id
      const { error: signUpError, data: signUpData } = await supabase.auth.signUp({
        email: email.trim(),
        password: password,
        options: {
          data: {
            full_name: fullName.trim(),
            instrument,
            college: college.trim(),
            join_date: `${joinYear}${joinSemester}`,
          },
        },
      });

      if (signUpError) {
        setErrorMsg(signUpError.message || "注册失败，请稍后重试。");
        return;
      }

      if (!signUpData?.user?.id) {
        setErrorMsg("注册失败，请稍后重试。");
        return;
      }

      const userId = signUpData.user.id;

      // 步骤2：调用 RPC 函数验证邀请码并记录使用者（原子操作）
      const codeError = await validateInvitationCode(normalizedCode, userId);
      if (codeError) {
        // 邀请码验证失败，尝试删除已注册的用户
        console.warn("[Signup] 邀请码验证失败，尝试清理已注册用户:", userId);
        await supabase.auth.admin.deleteUser(userId);
        setErrorMsg(codeError);
        return;
      }

      // 注册成功
      setSuccessMsg("注册成功，请等待管理员审核。");
      await new Promise((resolve) => setTimeout(resolve, 2000));
      router.replace("/login");
    } catch (error) {
      console.error("[Signup] 注册过程发生错误:", error);
      setErrorMsg("注册失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-[80vh] items-center justify-center overflow-y-auto pb-safe">
      <div className="w-full max-w-md">
        <Card className="rounded-2xl bg-surface p-4">
          <div className="mb-3 text-center">
            <h1 className="text-lg font-semibold text-text">创建账号</h1>
            <p className="mt-1 text-xs text-text-muted">注册后需等待管理员审核通过</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-2">
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
                className="w-full rounded-lg border border-border bg-muted px-3 py-1.5 text-sm text-text outline-none focus:border-text-muted"
                placeholder="请输入乐团邀请码"
                autoComplete="off"
                maxLength={20}
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
                className="w-full rounded-lg border border-border bg-muted px-3 py-1.5 text-sm text-text outline-none focus:border-text-muted"
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
                className="w-full rounded-lg border border-border bg-muted px-3 py-1.5 text-sm text-text outline-none focus:border-text-muted"
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
                }}
                className="w-full rounded-lg border border-border bg-muted px-3 py-1.5 text-sm text-text outline-none focus:border-text-muted"
                placeholder="再次输入密码"
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
                className="w-full rounded-lg border border-border bg-muted px-3 py-1.5 text-sm text-text outline-none focus:border-text-muted"
                placeholder="请填写真实姓名"
                autoComplete="name"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-label font-medium text-text-muted">所属声部</label>
              <select
                value={instrument}
                onChange={(e) => {
                  setInstrument(e.target.value as (typeof INSTRUMENT_OPTIONS)[number] | "其他");
                  setErrorMsg("");
                }}
                className="w-full rounded-lg border border-border bg-muted px-3 py-1.5 text-sm text-text outline-none focus:border-text-muted"
              >
                <option value="" disabled>
                  请选择声部
                </option>
                {INSTRUMENT_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
                <option key="其他" value="其他">
                  其他
                </option>
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
                className="w-full rounded-lg border border-border bg-muted px-3 py-1.5 text-sm text-text outline-none focus:border-text-muted"
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
                  className="w-20 rounded-lg border border-border bg-muted px-3 py-1.5 text-sm text-text outline-none focus:border-text-muted"
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
              className="mt-1 flex w-full items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-md hover:opacity-90 disabled:opacity-60"
            >
              {submitting ? "注册中…" : "注册"}
            </button>
          </form>

          <div className="mt-3 text-center text-xs text-text-muted">
            已有账号？{" "}
            <Link href="/login" className="font-medium text-text">
              去登录
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
