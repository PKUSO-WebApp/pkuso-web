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
