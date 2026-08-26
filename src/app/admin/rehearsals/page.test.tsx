// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import AdminRehearsalsPage from "./page";
import type { RehearsalRow } from "@/types/database";
import { parseLocalISO, formatLocalISO } from "@/lib/date-utils";

/** 构造排练行（本地时间 ISO；fake timers 固定 now，硬编码日期安全）；startISO 为 null 时无时间 */
function makeRehearsal(
  id: number,
  startISO: string | null,
  repertoire: string,
  opts: {
    type?: "full" | "section";
    endISO?: string | null;
    created?: string | null;
    updated?: string | null;
  } = {},
): RehearsalRow {
  const end =
    startISO === null
      ? null
      : (opts.endISO ??
        formatLocalISO(new Date(parseLocalISO(startISO).getTime() + 2 * 60 * 60 * 1000)));
  return {
    id,
    repertoire,
    type: opts.type ?? "full",
    start_time: startISO,
    end_time: end,
    location: "排练厅",
    title: null,
    date: null,
    time: null,
    checkin_lat: null,
    checkin_lng: null,
    checkin_radius_m: null,
    sign_in_code: (opts.type ?? "full") === "full" ? "8848" : null,
    target_section: null,
    created_at: opts.created ?? null,
    updated_at: opts.updated ?? "2026-08-10T00:00:00.000Z",
    updated_fields: null,
  };
}

// 通过 vi.hoisted 暴露可变排练列表与 mock，测试内动态注入/断言
const mocks = vi.hoisted(() => ({
  rehearsals: [] as RehearsalRow[],
  batchInsert: vi.fn().mockResolvedValue(null),
  checkConflict: vi.fn().mockResolvedValue(null),
  remove: vi.fn().mockResolvedValue(true),
  routerPush: vi.fn(),
}));

/** 替换 mock 排练列表（保持引用不变，触发 useRehearsals 的 data 更新） */
function setData(items: RehearsalRow[]) {
  mocks.rehearsals.splice(0, mocks.rehearsals.length, ...items);
}

// Mock useRehearsals（排练列表）
vi.mock("@/hooks/useRehearsals", () => ({
  useRehearsals: () => ({
    data: mocks.rehearsals,
    loading: false,
    error: null,
    saving: false,
    fetch: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: mocks.remove,
  }),
}));

// Mock useAttendance：batchInsert 用于新建排练出勤记录，测试不触达
vi.mock("@/hooks/useAttendance", () => ({
  useAttendance: () => ({
    map: {},
    list: [],
    loading: false,
    fetchMyAttendances: vi.fn(),
    fetchByRehearsal: vi.fn().mockResolvedValue([]),
    upsert: vi.fn(),
    updateStatus: vi.fn().mockResolvedValue(null),
    batchInsert: mocks.batchInsert,
    fetchStats: vi.fn(),
  }),
}));

// Mock useSchedule（时间冲突检查）
vi.mock("@/hooks/useSchedule", () => ({
  useSchedule: () => ({
    data: [],
    loading: false,
    error: null,
    saving: false,
    fetch: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    checkConflict: mocks.checkConflict,
  }),
}));

// Mock useProfiles（新建排练时的成员列表，测试不触达）
vi.mock("@/hooks/useProfiles", () => ({
  useProfiles: () => ({
    data: [],
    loading: false,
    error: null,
    saving: false,
    fetch: vi.fn(),
    update: vi.fn().mockResolvedValue(true),
    remove: vi.fn(),
  }),
}));

// Mock next/navigation（useRouter：卡片点击跳转详情页）
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.routerPush,
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
  }),
}));

describe("AdminRehearsalsPage 排序与历史合排 tab（Issue #171）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 固定 now = 2026-08-15 21:00（本地），与 sortRehearsalsForMember 单测口径一致
    vi.setSystemTime(new Date(2026, 7, 15, 21, 0, 0));
    setData([]);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("列表排序与用户端一致：最近一次第一、更新置顶、已结束底部近 → 远", () => {
    // hook 返回顺序刻意与期望结果不同（模拟 useRehearsals 的降序返回）
    setData([
      makeRehearsal(1, "2026-08-17T20:00:00", "更新过的排练", {
        created: "2026-08-10T00:00:00.000Z",
        updated: "2026-08-15T12:00:00.000Z",
      }),
      makeRehearsal(3, "2026-08-15T08:00:00", "上午排练"), // 已结束 11 小时前
      makeRehearsal(2, "2026-08-16T20:00:00", "明天排练"), // 最近一次，保持第一位
      makeRehearsal(4, "2026-08-15T14:00:00", "下午排练"), // 已结束 5 小时前
    ]);
    render(<AdminRehearsalsPage />);

    const rendered = screen
      .getAllByText(/(明天|更新过的|下午|上午)排练/)
      .map((el) => el.textContent);
    expect(rendered).toEqual(["明天排练", "更新过的排练", "下午排练", "上午排练"]);
    // 更新过的排练渲染更新提示（存量 fixture updated_fields=null → 兜底文案）
    expect(screen.getByText("更新排练时间/地点/曲目")).toBeTruthy();
  });

  it("历史合排 tab：仅已结束的合排，按结束时刻近 → 远，分排/未结束不出现", () => {
    setData([
      makeRehearsal(1, "2026-08-15T08:00:00", "较早合排"), // 已结束 11 小时前
      makeRehearsal(2, "2026-08-15T14:00:00", "较近合排"), // 已结束 5 小时前
      makeRehearsal(3, "2026-08-16T20:00:00", "未结束合排"),
      makeRehearsal(4, "2026-08-14T08:00:00", "已结束分排", { type: "section" }),
    ]);
    const { container } = render(<AdminRehearsalsPage />);
    fireEvent.click(screen.getByRole("button", { name: "历史合排" }));

    const rendered = screen.getAllByText(/(较早|较近)合排/).map((el) => el.textContent);
    expect(rendered).toEqual(["较近合排", "较早合排"]);
    expect(screen.queryByText("未结束合排")).toBeNull();
    expect(screen.queryByText("已结束分排")).toBeNull();
    // 标题联动：h1 切换为「历史合排」
    expect(container.querySelector("h1")?.textContent).toBe("历史合排");
  });

  it("历史合排 tab 隐藏「发布新日程」按钮（创建类型跟随 toggle 在历史视图无意义）", () => {
    setData([makeRehearsal(1, "2026-08-16T20:00:00", "明天排练")]);
    render(<AdminRehearsalsPage />);
    expect(screen.getByRole("button", { name: /发布新日程/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "历史合排" }));
    expect(screen.queryByRole("button", { name: /发布新日程/ })).toBeNull();
  });
});

describe("AdminRehearsalsPage 窗口过滤（Issue #173）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 21, 0, 0));
    setData([]);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("过去日期的排练不出现在合排/分排 tab，仅今天起（含当天已结束）", () => {
    setData([
      makeRehearsal(1, "2026-08-14T20:00:00", "过去的合排"),
      makeRehearsal(2, "2026-08-13T20:00:00", "过去的分排", { type: "section" }),
      makeRehearsal(3, "2026-08-15T08:00:00", "今天已结束的合排"),
      makeRehearsal(4, "2026-08-16T20:00:00", "未来的排练"),
    ]);
    render(<AdminRehearsalsPage />);

    // 合排 tab：过去的合排隐藏，今天与未来保留
    expect(screen.getByText("今天已结束的合排")).toBeTruthy();
    expect(screen.getByText("未来的排练")).toBeTruthy();
    expect(screen.queryByText("过去的合排")).toBeNull();
    expect(screen.queryByText("过去的分排")).toBeNull();

    // 分排 tab：过去的分排同样隐藏（该 tab 无今天起的分排 → 空态）
    fireEvent.click(screen.getByRole("button", { name: "分排" }));
    expect(screen.queryByText("过去的分排")).toBeNull();
    expect(screen.getByText("暂无安排")).toBeTruthy();

    // 历史合排 tab 不受今天窗口限制：过去已结束的合排仍出现
    fireEvent.click(screen.getByRole("button", { name: "历史合排" }));
    expect(screen.getByText("过去的合排")).toBeTruthy();
  });

  it("无 start_time 的排练保守保留在合排 tab", () => {
    setData([makeRehearsal(1, null, "无时间排练")]);
    render(<AdminRehearsalsPage />);
    expect(screen.getByText("无时间排练")).toBeTruthy();
  });

  it("日期区间筛选组件通过 false && 隐藏：不渲染日期选择控件与标签", () => {
    setData([makeRehearsal(1, "2026-08-16T20:00:00", "明天排练")]);
    render(<AdminRehearsalsPage />);
    expect(screen.queryByPlaceholderText("选择日期")).toBeNull();
    expect(screen.queryByText("开始时间")).toBeNull();
    expect(screen.queryByText("结束时间")).toBeNull();
  });
});

describe("AdminRehearsalsPage 卡片导航（Issue #173：Modal→页面）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 21, 0, 0));
    setData([]);
    mocks.routerPush.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("点击卡片跳转到详情页路由（/admin/rehearsals/[id]）", () => {
    setData([makeRehearsal(1, "2026-08-16T20:00:00", "明天排练")]);
    render(<AdminRehearsalsPage />);
    // 卡片本身是按钮（可访问名含曲目），点击跳转
    fireEvent.click(screen.getByRole("button", { name: /明天排练/ }));
    expect(mocks.routerPush).toHaveBeenCalledTimes(1);
    expect(mocks.routerPush).toHaveBeenCalledWith("/admin/rehearsals/1");
  });
});
