// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import AdminRehearsalDetailPage from "./page";
import type { RehearsalRow } from "@/types/database";
import { parseLocalISO, formatLocalISO } from "@/lib/date-utils";

function makeRehearsal(id: number, startISO: string | null, repertoire: string): RehearsalRow {
  const end =
    startISO === null
      ? null
      : formatLocalISO(new Date(parseLocalISO(startISO).getTime() + 2 * 60 * 60 * 1000));
  return {
    id,
    repertoire,
    type: "full",
    start_time: startISO,
    end_time: end,
    location: "排练厅",
    title: null,
    date: null,
    time: null,
    checkin_lat: null,
    checkin_lng: null,
    checkin_radius_m: null,
    sign_in_code: "8848",
    target_section: null,
    created_at: null,
    updated_at: "2026-08-10T00:00:00.000Z",
    updated_fields: null,
  };
}

const mocks = vi.hoisted(() => ({
  rehearsals: [] as RehearsalRow[],
  remove: vi.fn().mockResolvedValue(true),
  routerPush: vi.fn(),
}));

function setData(items: RehearsalRow[]) {
  mocks.rehearsals.splice(0, mocks.rehearsals.length, ...items);
}

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

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.routerPush,
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
  }),
  useParams: () => ({ id: "1" }),
}));

describe("AdminRehearsalDetailPage（Issue #173：详情页路由）", () => {
  beforeEach(() => {
    mocks.remove.mockClear();
    mocks.routerPush.mockClear();
    setData([]);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("渲染排练明细：曲目、地点", () => {
    setData([makeRehearsal(1, "2026-08-16T20:00:00", "明天排练")]);
    render(<AdminRehearsalDetailPage />);
    expect(screen.getByText("明天排练")).toBeTruthy();
    expect(screen.getByText("排练厅")).toBeTruthy();
  });

  it("删除流：confirm 通过 → remove(1) 并跳回列表", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    setData([makeRehearsal(1, "2026-08-16T20:00:00", "明天排练")]);
    render(<AdminRehearsalDetailPage />);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(confirmSpy).toHaveBeenCalledWith("确定删除该排练？");
    expect(mocks.remove).toHaveBeenCalledWith(1);
    await waitFor(() => expect(mocks.routerPush).toHaveBeenCalledWith("/admin/rehearsals"));
  });

  it("删除流：取消确认 → 不调用 remove", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    setData([makeRehearsal(1, "2026-08-16T20:00:00", "明天排练")]);
    render(<AdminRehearsalDetailPage />);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(confirmSpy).toHaveBeenCalledWith("确定删除该排练？");
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("未找到该排练：空态文案", () => {
    setData([]);
    render(<AdminRehearsalDetailPage />);
    expect(screen.getByText("未找到该排练")).toBeTruthy();
  });
});
