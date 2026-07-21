// @vitest-environment jsdom

import { describe, it, expect } from "vitest";

// 日期筛选工具函数（从 page.tsx 提取的核心逻辑）
function filterRehearsals(
  schedules: Array<{
    id: number;
    type: "full" | "section" | string;
    start_time: string | null;
  }>,
  currentType: "合排" | "分排",
  startDateFilter: Date | null,
  endDateFilter: Date | null,
) {
  return schedules.filter((r) => {
    // 类型筛选
    if (r.type === "full") {
      if (currentType !== "合排") return false;
    } else if (r.type === "section") {
      if (currentType !== "分排") return false;
    } else {
      return false;
    }

    // 日期筛选
    if (!r.start_time) return false;
    // 解析本地 ISO 字符串
    const dateParts = r.start_time.split("T")[0]?.split("-").map(Number);
    if (!dateParts || dateParts.length !== 3) return false;
    const rehearsalDate = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);

    if (startDateFilter && rehearsalDate < startDateFilter) {
      return false;
    }

    if (endDateFilter) {
      const endOfDay = new Date(endDateFilter);
      endOfDay.setHours(23, 59, 59, 999);
      if (rehearsalDate > endOfDay) return false;
    }

    return true;
  });
}

describe("排练日期筛选", () => {
  const mockRehearsals = [
    { id: 1, type: "full" as const, start_time: "2024-01-01T14:00:00" },
    { id: 2, type: "full" as const, start_time: "2024-01-02T14:00:00" },
    { id: 3, type: "full" as const, start_time: "2024-01-03T14:00:00" },
    { id: 4, type: "section" as const, start_time: "2024-01-01T14:00:00" },
    { id: 5, type: "section" as const, start_time: "2024-01-02T14:00:00" },
    { id: 6, type: "full" as const, start_time: null },
  ];

  it("默认显示全部排练 - 正常路径", () => {
    const result = filterRehearsals(mockRehearsals, "合排", null, null);
    // 只显示合排，且 start_time 不为 null
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it("分排筛选", () => {
    const result = filterRehearsals(mockRehearsals, "分排", null, null);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual([4, 5]);
  });

  it("开始时间筛选", () => {
    const startDate = new Date(2024, 0, 2); // 2024-01-02
    const result = filterRehearsals(mockRehearsals, "合排", startDate, null);
    // 2024-01-02 和 2024-01-03 的合排
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual([2, 3]);
  });

  it("结束时间筛选", () => {
    const endDate = new Date(2024, 0, 2); // 2024-01-02
    const result = filterRehearsals(mockRehearsals, "合排", null, endDate);
    // 2024-01-01 和 2024-01-02 的合排（结束时间设置为当天 23:59:59）
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual([1, 2]);
  });

  it("开始时间和结束时间同时筛选", () => {
    const startDate = new Date(2024, 0, 2); // 2024-01-02
    const endDate = new Date(2024, 0, 2); // 2024-01-02
    const result = filterRehearsals(mockRehearsals, "合排", startDate, endDate);
    // 只显示 2024-01-02 的合排
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(2);
  });

  it("边界条件 - 结束时间当天包含", () => {
    const endDate = new Date(2024, 0, 2); // 2024-01-02
    const rehearsals = [{ id: 1, type: "full" as const, start_time: "2024-01-02T23:59:00" }];
    const result = filterRehearsals(rehearsals, "合排", null, endDate);
    // 结束时间设置为当天 23:59:59，所以 23:59:00 应该被包含
    expect(result).toHaveLength(1);
  });

  it("边界条件 - 结束时间当天不包含明天", () => {
    const endDate = new Date(2024, 0, 2); // 2024-01-02
    const rehearsals = [{ id: 1, type: "full" as const, start_time: "2024-01-03T00:00:00" }];
    const result = filterRehearsals(rehearsals, "合排", null, endDate);
    // 01-03 的排练应该被排除
    expect(result).toHaveLength(0);
  });

  it("边界条件 - 开始时间当天包含", () => {
    const startDate = new Date(2024, 0, 2); // 2024-01-02
    const rehearsals = [{ id: 1, type: "full" as const, start_time: "2024-01-02T00:00:00" }];
    const result = filterRehearsals(rehearsals, "合排", startDate, null);
    // 01-02 的排练应该被包含
    expect(result).toHaveLength(1);
  });

  it("边界条件 - 开始时间当天不包含昨天", () => {
    const startDate = new Date(2024, 0, 2); // 2024-01-02
    const rehearsals = [{ id: 1, type: "full" as const, start_time: "2024-01-01T23:59:59" }];
    const result = filterRehearsals(rehearsals, "合排", startDate, null);
    // 01-01 的排练应该被排除
    expect(result).toHaveLength(0);
  });

  it("无效 start_time 被过滤", () => {
    const result = filterRehearsals(mockRehearsals, "合排", null, null);
    // id 6 的 start_time 为 null，应该被过滤
    expect(result.every((r) => r.start_time !== null)).toBe(true);
  });

  it("无效 type 被过滤", () => {
    const rehearsals = [{ id: 1, type: "invalid" as const, start_time: "2024-01-01T14:00:00" }];
    const result = filterRehearsals(rehearsals, "合排", null, null);
    expect(result).toHaveLength(0);
  });
});
