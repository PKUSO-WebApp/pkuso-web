import { describe, it, expect } from "vitest";
import { hasSignedIn, canSignIn, judgeAttendanceStatus } from "./attendance-utils";

describe("hasSignedIn（签到锁定判定，Issue #141）", () => {
  it("时间戳非空判定为已签到（锁定）", () => {
    expect(hasSignedIn("2026-08-15T20:05:00")).toBe(true);
  });

  it("null 判定为未签到", () => {
    expect(hasSignedIn(null)).toBe(false);
  });

  it("undefined 判定为未签到", () => {
    expect(hasSignedIn(undefined)).toBe(false);
  });

  it("空字符串判定为未签到", () => {
    expect(hasSignedIn("")).toBe(false);
  });
});

describe("canSignIn（签到窗口）", () => {
  const start = new Date("2026-08-15T20:00:00");
  const end = new Date("2026-08-15T22:00:00");

  it("窗口开启前（提前超过 30 分钟）不可签到", () => {
    expect(canSignIn(new Date("2026-08-15T19:20:00"), start, end)).toBe(false);
  });

  it("窗口开启后（提前 30 分钟内）可签到", () => {
    expect(canSignIn(new Date("2026-08-15T19:31:00"), start, end)).toBe(true);
  });

  it("排练结束后不可签到", () => {
    expect(canSignIn(new Date("2026-08-15T22:01:00"), start, end)).toBe(false);
  });
});

describe("judgeAttendanceStatus（出勤状态判定）", () => {
  const start = new Date("2026-08-15T20:00:00");
  const end = new Date("2026-08-15T22:00:00");

  it("宽限期内签到为出席", () => {
    expect(judgeAttendanceStatus(new Date("2026-08-15T20:14:59"), start, end)).toBe("present");
  });

  it("宽限期后至结束前为迟到", () => {
    expect(judgeAttendanceStatus(new Date("2026-08-15T20:15:01"), start, end)).toBe("late");
  });

  it("结束后签到为缺席", () => {
    expect(judgeAttendanceStatus(new Date("2026-08-15T22:00:01"), start, end)).toBe("absent");
  });
});
