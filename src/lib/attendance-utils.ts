import type { AttendanceStatus } from "@/types/database";

/** 签到宽限期：开始时间后多少分钟内签到记为出席 */
export const SIGN_IN_GRACE_MINUTES = 15;

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
