import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "./route";

/**
 * approve 的考勤联动分支（pkuso-backend#47 请假侧）。
 * 覆盖三条互斥路径：已签到 / 无需出勤 / 普通（可联动）。
 */

type AttendanceRow = { status: string; sign_in_time: string | null };

type Scenario = {
  /** attendances 前置查询返回（null = 无考勤行） */
  attendance: AttendanceRow | null;
  /** attendances 复核查询返回；缺省与前置一致（模拟「间隙内被改」时填不同值） */
  recheckAttendance?: AttendanceRow | null;
  /** attendances 的 update 是否命中（false = 0 行，走复核分支） */
  updateHits: boolean;
};

const scenario: Scenario = { attendance: null, updateHits: true };
const updateMock = vi.fn();
let attendanceQueries = 0;

const makeChain = (table: string) => {
  let op: "select" | "update" = "select";
  const o: Record<string, unknown> = {};
  const passthrough = () => o;
  o.select = passthrough;
  o.eq = passthrough;
  o.neq = passthrough;
  o.is = passthrough;
  o.insert = () => Promise.resolve({ error: null });
  o.update = vi.fn(() => {
    op = "update";
    return o;
  });
  o.maybeSingle = () => {
    if (table === "attendances") {
      attendanceQueries += 1;
      const data =
        attendanceQueries > 1
          ? (scenario.recheckAttendance ?? scenario.attendance)
          : scenario.attendance;
      return Promise.resolve({ data, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  };
  o.then = (resolve: (v: unknown) => void) => {
    if (table === "leave_requests") {
      return resolve(
        op === "update"
          ? { data: [{ id: "lr-1" }], error: null }
          : {
              data: [
                {
                  id: "lr-1",
                  rehearsal_id: 1,
                  user_id: "u1",
                  target_status: "excused",
                  rehearsals: {
                    repertoire: "贝多芬第五交响曲",
                    title: null,
                    type: "full",
                    start_time: "2026-08-20T19:00:00",
                  },
                },
              ],
              error: null,
            },
      );
    }
    if (table === "attendances" && op === "update") {
      updateMock();
      return resolve({ data: scenario.updateHits ? [{ id: 1 }] : [], error: null });
    }
    return resolve({ data: null, error: null });
  };
  return o;
};

const supabaseServerMock = { from: vi.fn((table: string) => makeChain(table)) };

vi.mock("@/lib/verify-admin", () => ({ verifyAdmin: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({
  createServerSupabase: vi.fn().mockReturnValue(supabaseServerMock),
}));

import { verifyAdmin } from "@/lib/verify-admin";

const approve = () =>
  POST(
    new Request("http://localhost/api/admin/leave", {
      method: "POST",
      body: JSON.stringify({ action: "approve", ids: ["lr-1"] }),
    }),
  );

describe("POST /api/admin/leave — approve 的考勤联动（#47 请假侧）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scenario.attendance = null;
    scenario.updateHits = true;
    attendanceQueries = 0;
    scenario.recheckAttendance = undefined;
    (verifyAdmin as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      supabaseServer: supabaseServerMock,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("成员被设为「无需出勤」→ 不联动考勤，并返回对应 warning", async () => {
    scenario.attendance = { status: "exempt", sign_in_time: null };

    const res = await approve();
    const body = await res.json();

    expect(updateMock).not.toHaveBeenCalled();
    expect(body.warnings).toEqual([
      { id: "lr-1", message: "成员已设为「无需出勤」，考勤保持该状态（请假申请已通过）" },
    ]);
    expect(body.processed).toEqual(["lr-1"]);
  });

  it("成员已实际签到 → 不联动考勤（既有行为，回归）", async () => {
    scenario.attendance = { status: "present", sign_in_time: "2026-08-20T19:05:00" };

    const res = await approve();
    const body = await res.json();

    expect(updateMock).not.toHaveBeenCalled();
    expect(body.warnings).toEqual([
      { id: "lr-1", message: "成员已签到，考勤保持签到记录（请假申请已通过）" },
    ]);
  });

  it("普通行 → 照常联动考勤，无 warning", async () => {
    scenario.attendance = { status: "absent", sign_in_time: null };

    const res = await approve();
    const body = await res.json();

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(body.warnings).toEqual([]);
  });

  it("更新 0 行且复核发现已被设为「无需出勤」→ 报无需出勤而非「已签到」", async () => {
    // 前置查询时还是普通缺勤行，写入时已被改（update 0 行），复核才看到 exempt
    scenario.attendance = { status: "absent", sign_in_time: null };
    scenario.recheckAttendance = { status: "exempt", sign_in_time: null };
    scenario.updateHits = false;

    const res = await approve();
    const body = await res.json();

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(body.warnings).toEqual([
      { id: "lr-1", message: "成员已设为「无需出勤」，考勤保持该状态（请假申请已通过）" },
    ]);
  });

  it("更新 0 行且复核发现是并发签到 → 仍报「已签到」（既有行为，回归）", async () => {
    scenario.attendance = { status: "absent", sign_in_time: null };
    scenario.recheckAttendance = { status: "present", sign_in_time: "2026-08-20T19:05:00" };
    scenario.updateHits = false;

    const res = await approve();
    const body = await res.json();

    expect(body.warnings).toEqual([
      { id: "lr-1", message: "成员已签到，考勤保持签到记录（请假申请已通过）" },
    ]);
  });
});
