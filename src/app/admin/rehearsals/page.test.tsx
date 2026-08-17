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

// Mock next/navigation（useRouter：冲突弹窗「前往管理」跳转，测试不触达）
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
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

describe("AdminRehearsalsPage 详情弹窗（Issue #173）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 21, 0, 0));
    setData([]);
    mocks.remove.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** 渲染单条明天合排并点击卡片打开详情 */
  function openDetail() {
    setData([makeRehearsal(1, "2026-08-16T20:00:00", "明天排练")]);
    render(<AdminRehearsalsPage />);
    // 卡片去按钮化：卡片本身是按钮（可访问名含曲目），点击打开详情
    fireEvent.click(screen.getByRole("button", { name: /明天排练/ }));
    expect(screen.getByText("排练详情")).toBeTruthy();
  }

  it("点击卡片打开详情弹窗：展示类型/时间/地点/曲目/签到码", () => {
    openDetail();
    expect(screen.getByRole("dialog")).toBeTruthy();
    // 字段标签（卡片上不存在的 label 文案，仅弹窗内出现）
    expect(screen.getByText("排练类型")).toBeTruthy();
    expect(screen.getByText("时间")).toBeTruthy();
    expect(screen.getByText("地点")).toBeTruthy();
    expect(screen.getByText("曲目")).toBeTruthy();
    // 签到码（卡片已移除展示，仅详情弹窗出现）
    expect(screen.getByText("签到码")).toBeTruthy();
    expect(screen.getByText("8848")).toBeTruthy();
    // 底部操作按钮：删除在前、编辑在后，并列右下角（Issue #182）
    const deleteBtn = screen.getByRole("button", { name: "删除" });
    const editBtn = screen.getByRole("button", { name: "编辑" });
    expect(editBtn.parentElement).toBe(deleteBtn.parentElement);
    expect(deleteBtn.parentElement!.className).toContain("justify-end");
    expect(
      deleteBtn.compareDocumentPosition(editBtn) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("删除流：window.confirm「确认删除？」通过 → 调用 remove 并关闭弹窗", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    openDetail();
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(confirmSpy).toHaveBeenCalledWith("确认删除？");
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledWith(1);
    // 删除后关闭详情弹窗
    expect(screen.queryByText("排练详情")).toBeNull();
  });

  it("删除流：取消确认 → 不调用 remove，弹窗保留", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    openDetail();
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(confirmSpy).toHaveBeenCalledWith("确认删除？");
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(screen.getByText("排练详情")).toBeTruthy();
  });

  it("编辑流：详情弹窗「编辑」→ 关闭详情并打开编辑弹窗（复用 CreateRehearsalModal 编辑模式）", () => {
    openDetail();
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    // 详情关闭、编辑弹窗打开
    expect(screen.queryByText("排练详情")).toBeNull();
    expect(screen.getByText("编辑排练日程")).toBeTruthy();
    // 表单已回填（地点/曲目/签到码），提交按钮为「保存」
    expect(screen.getByDisplayValue("排练厅")).toBeTruthy();
    expect(screen.getByDisplayValue("明天排练")).toBeTruthy();
    expect(screen.getByDisplayValue("8848")).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存" })).toBeTruthy();
  });

  it("详情弹窗可关闭（关闭按钮）", () => {
    openDetail();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByText("排练详情")).toBeNull();
    // 列表仍渲染
    expect(screen.getByText("明天排练")).toBeTruthy();
  });
});
