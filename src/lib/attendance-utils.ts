import type { AttendanceStatus } from "@/types/database";

/** 签到宽限期：开始时间后多少分钟内签到记为出席 */
export const SIGN_IN_GRACE_MINUTES = 15;

/** 签到窗口：开始时间前多少分钟内允许签到 */
export const SIGN_IN_WINDOW_BEFORE_MINUTES = 30;

/**
 * 判断当前时间是否处于签到窗口内：
 * - 已过结束时间（now > end）→ false（排练已结束）
 * - 提前开始时间超过 30 分钟（now < start - 30min）→ false（排练尚未开始）
 * - 其余时间 → true
 */
export function canSignIn(now: Date, start: Date, end: Date): boolean {
  if (now.getTime() > end.getTime()) return false;
  const windowStart = start.getTime() - SIGN_IN_WINDOW_BEFORE_MINUTES * 60 * 1000;
  if (now.getTime() < windowStart) return false;
  return true;
}

/**
 * 根据签到时间判定出勤状态：
 * - 签到时间 ≤ 开始时间 + 15分钟 → present
 * - 开始时间 + 15分钟 < 签到时间 ≤ 结束时间 → late
 * - 签到时间 > 结束时间 → absent
 */
export function judgeAttendanceStatus(signInAt: Date, start: Date, end: Date): AttendanceStatus {
  const graceEnd = start.getTime() + SIGN_IN_GRACE_MINUTES * 60 * 1000;
  if (signInAt.getTime() <= graceEnd) return "present";
  if (signInAt.getTime() <= end.getTime()) return "late";
  return "absent";
}

/**
 * 签到锁定判定（Issue #141）：sign_in_time 非空即视为已签到（锁定）。
 * 用户一次签到后出勤状态在用户侧固定，不可再签到/修改——
 * 即使管理员随后把状态改为缺席/请假（sign_in_time 仍在，锁定依旧生效），
 * 规避「缺席签到 → 管理员取消 → 用户再签到」的循环。
 */
export function hasSignedIn(signInTime: string | null | undefined): boolean {
  return signInTime != null && signInTime !== "";
}
