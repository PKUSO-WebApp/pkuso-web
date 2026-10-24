import { describe, expect, it } from "vitest";
import {
  decisionMessage,
  memberLabel,
  normalizeRejectReason,
  partitionAttendanceChangeRequests,
  rehearsalLabel,
  statusChangeLabel,
} from "./attendance-change-request";
import type { AttendanceChangeRequestWithDetails } from "@/types/database";

function request(
  overrides: Partial<AttendanceChangeRequestWithDetails> = {},
): AttendanceChangeRequestWithDetails {
  return {
    id: "req-1",
    rehearsal_id: 1,
    target_user_id: "u1",
    requested_by: "u2",
    from_status: "absent",
    to_status: "present",
    reason: null,
    status: "pending",
    decided_by: null,
    decided_at: null,
    reject_reason: null,
    created_at: "2026-10-24T10:00:00Z",
    updated_at: "2026-10-24T10:00:00Z",
    ...overrides,
  };
}

describe("attendance-change-request helpers", () => {
  it("memberLabel：姓名（乐器），缺信息时兜底", () => {
    expect(memberLabel({ full_name: " 张三 ", instrument: "第一小提琴" })).toBe(
      "张三（第一小提琴）",
    );
    expect(memberLabel({ full_name: null, instrument: null })).toBe("未知成员");
    expect(memberLabel(null)).toBe("未知成员");
  });

  it("rehearsalLabel：时间 + 合排/分排 + 曲目", () => {
    expect(
      rehearsalLabel({
        repertoire: "贝多芬第五交响曲",
        title: null,
        start_time: "2026-10-24T19:00:00",
        end_time: null,
        type: "full",
      }),
    ).toBe("10月24日 周六 19:00 合排《贝多芬第五交响曲》");
  });

  it("rehearsalLabel：无曲目回退 title，再回退「排练」", () => {
    expect(rehearsalLabel({ title: "分排", type: "section" })).toBe("分排《分排》");
    expect(rehearsalLabel(null)).toBe("《排练》");
  });

  it("statusChangeLabel：中文状态变化", () => {
    expect(statusChangeLabel("absent", "present")).toBe("缺勤 → 出席");
    expect(statusChangeLabel("excused", "exempt")).toBe("请假 → 无需出勤");
  });

  it("decisionMessage：stale 带当前状态，其它错误给中文", () => {
    expect(decisionMessage("stale", "present")).toContain("当前：出席");
    expect(decisionMessage("not_pending")).toBe("申请已被处理");
    expect(decisionMessage("attendance_missing")).toBe("考勤记录不存在，无法通过");
    expect(decisionMessage("actor_not_admin")).toBe("当前账号无权审批");
    expect(decisionMessage("unknown")).toBe("处理失败，请重试");
  });

  it("normalizeRejectReason：普通空白与零宽字符都视为空", () => {
    expect(normalizeRejectReason("\u200B\uFEFF")).toBe("");
    expect(normalizeRejectReason("\u200B")).toBe("");
  });

  it("partition：pending 与 approved/rejected 分开，canceled 不进入已处理", () => {
    const { pending, processed } = partitionAttendanceChangeRequests([
      request({ id: "p", status: "pending" }),
      request({ id: "a", status: "approved" }),
      request({ id: "r", status: "rejected" }),
      request({ id: "c", status: "canceled" }),
    ]);
    expect(pending.map((item) => item.id)).toEqual(["p"]);
    expect(processed.map((item) => item.id)).toEqual(["a", "r"]);
  });
});
