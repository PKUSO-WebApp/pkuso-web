"use client";

import React from "react";
import { useUser } from "@/context/user-context";
import { useRehearsals } from "@/hooks/useRehearsals";
import { useAttendance } from "@/hooks/useAttendance";
import { Toggle } from "@/components/ui/Toggle";
import { RehearsalCard } from "./components/rehearsal-card";
import { CodeVerifyModal } from "./components/code-verify-modal";
import type { RehearsalRow } from "@/types/database";

type RehearsalType = "合排" | "分排";

export default function MemberSchedulePage() {
  const { user } = useUser();
  const { data: schedules, loading } = useRehearsals();
  const { map: attendanceMap, fetchMyAttendances, upsert } = useAttendance();

  const [currentType, setCurrentType] = React.useState<RehearsalType>("合排");

  // 签到码
  const [codeRehearsal, setCodeRehearsal] = React.useState<RehearsalRow | null>(null);
  const [codeInput, setCodeInput] = React.useState("");
  const [codeSubmitting, setCodeSubmitting] = React.useState(false);
  const [codeError, setCodeError] = React.useState<string | null>(null);

  // 加载我的考勤
  React.useEffect(() => {
    if (!user?.id) return;
    const ids = schedules.map((r) => r.id);
    void fetchMyAttendances(user.id, ids);
  }, [user?.id, schedules, fetchMyAttendances]);

  const list = React.useMemo(
    () => schedules.filter((r) => (r.type === "full" ? "合排" : "分排") === currentType),
    [schedules, currentType],
  );

  const handleSignIn = async (rehearsal: RehearsalRow) => {
    if (!user) return;
    if (attendanceMap[rehearsal.id]) return;

    if (rehearsal.type === "section") {
      const err = await upsert([
        { rehearsal_id: rehearsal.id, user_id: user.id, status: "present" },
      ]);
      if (!err) alert("签到成功");
    } else if (rehearsal.sign_in_code) {
      setCodeRehearsal(rehearsal);
      setCodeInput("");
      setCodeError(null);
    } else {
      alert("未配置签到码");
    }
  };

  const handleCodeConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!codeRehearsal || !user) return;
    if (!/^\d{4}$/.test(codeInput)) {
      setCodeError("请输4位数字");
      return;
    }
    if (codeInput !== codeRehearsal.sign_in_code) {
      setCodeError("签到码错误");
      return;
    }
    setCodeSubmitting(true);
    const err = await upsert([
      { rehearsal_id: codeRehearsal.id, user_id: user.id, status: "present" },
    ]);
    setCodeSubmitting(false);
    if (!err) {
      alert("签到成功");
      setCodeRehearsal(null);
    } else setCodeError("签到失败");
  };

  return (
    <div className="space-y-4">
      <header className="mb-2">
        <h1 className="text-lg font-semibold text-text">排练日程</h1>
        <p className="mt-1 text-xs text-text-muted">查看乐团合排与分排安排</p>
      </header>

      <Toggle options={["合排", "分排"] as const} value={currentType} onChange={setCurrentType} />

      <section className="space-y-3">
        {loading && <p className="py-6 text-center text-xs text-text-subtle">加载中…</p>}
        {!loading &&
          list.map((item) => (
            <RehearsalCard
              key={item.id}
              item={item}
              hasSigned={!!attendanceMap[item.id]}
              onSignIn={() => handleSignIn(item)}
            />
          ))}
        {!loading && list.length === 0 && (
          <p className="py-8 text-center text-xs text-text-muted">暂无安排</p>
        )}
      </section>

      <CodeVerifyModal
        open={!!codeRehearsal}
        title={codeRehearsal?.repertoire ?? ""}
        submitting={codeSubmitting}
        codeInput={codeInput}
        codeError={codeError}
        onCodeChange={(v) => {
          setCodeError(null);
          setCodeInput(v);
        }}
        onConfirm={handleCodeConfirm}
        onClose={() => {
          if (!codeSubmitting) setCodeRehearsal(null);
        }}
      />
    </div>
  );
}
