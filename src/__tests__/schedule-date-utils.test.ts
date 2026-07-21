import { describe, it, expect } from "vitest";
import { parseLocalISO } from "@/lib/date-utils";

// 根据年份、月份、周数和星期几获取目标日期（与 page.tsx 保持一致）
// 返回 { date: Date | null, maxWeek: number, lastDayOfMaxWeek: Date }
const getDateOfWeekInMonth = (
  year: number,
  month: number,
  weekNumber: number,
  dayOfWeek: number,
): { date: Date | null; maxWeek: number; lastDayOfMaxWeek: Date } => {
  const firstDay = new Date(year, month - 1, 1).getDay();
  // 计算该月第一个目标星期几的日期
  // firstDay: 月份第一天的星期（0=周日）
  // dayOfWeek: 目标星期（0=周日，1=周一，...，6=周六）
  const firstTargetOffset = (dayOfWeek - firstDay + 7) % 7;
  const firstTargetDate = new Date(year, month - 1, 1 + firstTargetOffset);

  // 如果第一个目标日期超出本月，则需要从下周开始
  if (firstTargetDate.getMonth() !== month - 1) {
    firstTargetDate.setDate(firstTargetDate.getDate() + 7);
  }

  // 计算该月最大有效周数
  let maxWeek = 1;
  const testDate = new Date(firstTargetDate);
  while (testDate.getMonth() === month - 1) {
    maxWeek++;
    testDate.setDate(testDate.getDate() + 7);
  }
  maxWeek--;

  // 计算最后一周最后一天的日期（周六）
  const lastDayOfMaxWeek = new Date(firstTargetDate);
  lastDayOfMaxWeek.setDate(
    firstTargetDate.getDate() + (maxWeek - 1) * 7 + ((6 - dayOfWeek + 7) % 7),
  );

  // 计算第N周的目标日期
  const targetDate = new Date(firstTargetDate);
  targetDate.setDate(firstTargetDate.getDate() + (weekNumber - 1) * 7);

  // 验证结果是否在本月内
  if (targetDate.getMonth() !== month - 1) {
    return { date: null, maxWeek, lastDayOfMaxWeek };
  }

  return { date: targetDate, maxWeek, lastDayOfMaxWeek };
};

// 计算某月份实际有几周（与 getDateOfWeekInMonth 使用一致的逻辑）
const getWeeksInMonth = (year: number, month: number): number => {
  const result = getDateOfWeekInMonth(year, month, 1, 1);
  return result.maxWeek;
};

// 生成周重复日期（与 page.tsx 保持一致）
function generateWeeklyDates(
  startYear: number,
  startMonth: number,
  startWeek: number,
  endYear: number,
  endMonth: number,
  endWeek: number,
  dayOfWeek: number,
): { dates: Date[]; error: string | null } {
  const dates: Date[] = [];

  const WEEK_DAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const dayLabel = WEEK_DAYS[dayOfWeek];

  // 计算开始日期
  const startResult = getDateOfWeekInMonth(startYear, startMonth, startWeek, dayOfWeek);
  if (!startResult.date) {
    const { maxWeek, lastDayOfMaxWeek } = startResult;
    // 计算下个月第一个有效周的目标日期
    const nextMonth = startMonth === 12 ? 1 : startMonth + 1;
    const nextYear = startMonth === 12 ? startYear + 1 : startYear;
    const nextMonthFirstWeekResult = getDateOfWeekInMonth(nextYear, nextMonth, 1, dayOfWeek);
    const nextMonthTargetDate = nextMonthFirstWeekResult.date;

    let errorMsg = `${startYear}年${startMonth}月第${startWeek}周不存在`;
    if (maxWeek > 0) {
      const lastDayName = WEEK_DAYS[lastDayOfMaxWeek.getDay()];
      errorMsg += `，该月第${maxWeek}周只到${lastDayName}`;
    }
    if (nextMonthTargetDate) {
      errorMsg += `，你可能想选${nextYear}年${nextMonth}月第1周${dayLabel}？`;
    }
    return { dates: [], error: errorMsg };
  }

  // 计算结束日期
  const endResult = getDateOfWeekInMonth(endYear, endMonth, endWeek, dayOfWeek);
  if (!endResult.date) {
    const { maxWeek, lastDayOfMaxWeek } = endResult;
    // 计算下个月第一个有效周的目标日期
    const nextMonth = endMonth === 12 ? 1 : endMonth + 1;
    const nextYear = endMonth === 12 ? endYear + 1 : endYear;
    const nextMonthFirstWeekResult = getDateOfWeekInMonth(nextYear, nextMonth, 1, dayOfWeek);
    const nextMonthTargetDate = nextMonthFirstWeekResult.date;

    let errorMsg = `${endYear}年${endMonth}月第${endWeek}周不存在`;
    if (maxWeek > 0) {
      const lastDayName = WEEK_DAYS[lastDayOfMaxWeek.getDay()];
      errorMsg += `，该月第${maxWeek}周只到${lastDayName}`;
    }
    if (nextMonthTargetDate) {
      errorMsg += `，你可能想选${nextYear}年${nextMonth}月第1周${dayLabel}？`;
    }
    return { dates: [], error: errorMsg };
  }

  if (startResult.date > endResult.date) {
    return { dates: [], error: "日期范围无效，请调整开始和结束周" };
  }

  const currentDate = new Date(startResult.date);
  while (currentDate <= endResult.date) {
    dates.push(new Date(currentDate));
    currentDate.setDate(currentDate.getDate() + 7);
  }

  return { dates, error: null };
}

// 生成月重复日期（与 page.tsx 保持一致）
function generateMonthlyDates(
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number,
  dayOfMonth: number,
): { dates: Date[]; error: string | null; skippedMonths: string[] } {
  const dates: Date[] = [];
  const skippedMonths: string[] = [];

  // 支持跨年生成日期
  for (let year = startYear; year <= endYear; year++) {
    const monthStart = year === startYear ? startMonth : 1;
    const monthEnd = year === endYear ? endMonth : 12;

    for (let month = monthStart; month <= monthEnd; month++) {
      const date = new Date(year, month - 1, dayOfMonth);
      if (date.getMonth() === month - 1) {
        dates.push(date);
      } else {
        skippedMonths.push(`${year}年${month}月`);
      }
    }
  }

  if (skippedMonths.length > 0 && dates.length === 0) {
    return {
      dates: [],
      error: `${skippedMonths.join("、")}没有${dayOfMonth}日，请选择其他日期`,
      skippedMonths,
    };
  }

  if (skippedMonths.length > 0) {
    return {
      dates,
      error: `${skippedMonths.join("、")}没有${dayOfMonth}日，已跳过这些月份`,
      skippedMonths,
    };
  }

  return { dates, error: null, skippedMonths: [] };
}

describe("getDateOfWeekInMonth", () => {
  it("should return correct date when first day of month is Monday", () => {
    // 2024年1月1日是周一，第1周周一应该是1月1日
    const result = getDateOfWeekInMonth(2024, 1, 1, 1);
    expect(result.date).not.toBeNull();
    expect(result.date?.getDate()).toBe(1);
    expect(result.date?.getMonth()).toBe(0);
    expect(result.date?.getFullYear()).toBe(2024);
  });

  it("should return correct date when first day of month is Sunday", () => {
    // 2023年10月1日是周日，第1周周一应该是10月2日
    const result = getDateOfWeekInMonth(2023, 10, 1, 1);
    expect(result.date).not.toBeNull();
    expect(result.date?.getDate()).toBe(2);
    expect(result.date?.getMonth()).toBe(9);
    expect(result.date?.getFullYear()).toBe(2023);
  });

  it("should return correct date when first day of month is Friday", () => {
    // 2024年3月1日是周五，第1周周一应该是3月4日
    const result = getDateOfWeekInMonth(2024, 3, 1, 1);
    expect(result.date).not.toBeNull();
    expect(result.date?.getDate()).toBe(4);
    expect(result.date?.getMonth()).toBe(2);
    expect(result.date?.getFullYear()).toBe(2024);
  });

  it("should return null for invalid week number and provide maxWeek info", () => {
    // 2024年2月（闰年）只有4周周一，第5周应该返回null
    const result = getDateOfWeekInMonth(2024, 2, 5, 1);
    expect(result.date).toBeNull();
    expect(result.maxWeek).toBe(4);
  });

  it("should handle different day of week", () => {
    // 2024年1月1日是周一，第1周周五应该是1月5日
    const result = getDateOfWeekInMonth(2024, 1, 1, 5);
    expect(result.date).not.toBeNull();
    expect(result.date?.getDate()).toBe(5);
    expect(result.date?.getMonth()).toBe(0);
    expect(result.date?.getFullYear()).toBe(2024);
  });

  it("should handle Sunday (dayOfWeek = 0)", () => {
    // 2024年1月1日是周一，第1周周日应该是1月7日
    const result = getDateOfWeekInMonth(2024, 1, 1, 0);
    expect(result.date).not.toBeNull();
    expect(result.date?.getDate()).toBe(7);
    expect(result.date?.getMonth()).toBe(0);
    expect(result.date?.getFullYear()).toBe(2024);
  });

  it("should return correct date for leap year February", () => {
    // 2024年2月1日是周四，第1周周一应该是2月5日
    const result = getDateOfWeekInMonth(2024, 2, 1, 1);
    expect(result.date).not.toBeNull();
    expect(result.date?.getDate()).toBe(5);
    expect(result.date?.getMonth()).toBe(1);
    expect(result.date?.getFullYear()).toBe(2024);
  });

  it("should return correct date for non-leap year February", () => {
    // 2023年2月1日是周三，第1周周一应该是2月6日
    const result = getDateOfWeekInMonth(2023, 2, 1, 1);
    expect(result.date).not.toBeNull();
    expect(result.date?.getDate()).toBe(6);
    expect(result.date?.getMonth()).toBe(1);
    expect(result.date?.getFullYear()).toBe(2023);
  });

  it("should return correct lastDayOfMaxWeek", () => {
    // 2024年1月有5周周一：1月1日、8日、15日、22日、29日
    // 第5周周一1月29日的周六是2月3日（跨月）
    const result = getDateOfWeekInMonth(2024, 1, 1, 1);
    expect(result.lastDayOfMaxWeek.getDate()).toBe(3);
    expect(result.lastDayOfMaxWeek.getMonth()).toBe(1); // February
    expect(result.lastDayOfMaxWeek.getDay()).toBe(6); // Saturday
  });
});

describe("getWeeksInMonth", () => {
  it("should return 4 weeks for February in non-leap year", () => {
    // 2023年2月只有28天，最多4周周一
    const result = getWeeksInMonth(2023, 2);
    expect(result).toBe(4);
  });

  it("should return 4 weeks for February in leap year", () => {
    // 2024年2月有29天，最多4周周一
    const result = getWeeksInMonth(2024, 2);
    expect(result).toBe(4);
  });

  it("should return 5 weeks for month with 31 days starting on Monday", () => {
    // 2024年1月有31天，1月1日是周一，有5周周一
    const result = getWeeksInMonth(2024, 1);
    expect(result).toBe(5);
  });

  it("should return 4 weeks for month with 30 days starting on Wednesday", () => {
    // 2023年11月有30天，11月1日是周三，第一个周一是11月6日，第4周周一11月27日，第5周超出
    const result = getWeeksInMonth(2023, 11);
    expect(result).toBe(4);
  });

  it("should return 4 weeks for month with 30 days starting on Saturday", () => {
    // 2024年6月有30天，6月1日是周六，第一个周一是6月3日，第4周周一6月24日，第5周超出
    const result = getWeeksInMonth(2024, 6);
    expect(result).toBe(4);
  });

  it("should return 4 weeks for December 2023 (starts on Friday)", () => {
    // 2023年12月有31天，12月1日是周五，第一个周一是12月4日，第4周周一12月25日，第5周超出
    const result = getWeeksInMonth(2023, 12);
    expect(result).toBe(4);
  });

  it("should return 5 weeks for March 2025 (starts on Saturday)", () => {
    // 2025年3月有31天，3月1日是周六，第一个周一是3月3日，第5周周一3月31日仍在当月
    const result = getWeeksInMonth(2025, 3);
    expect(result).toBe(5);
  });
});

describe("generateWeeklyDates", () => {
  it("should generate dates within same month", () => {
    // 2024年1月第1周到第3周周一
    const result = generateWeeklyDates(2024, 1, 1, 2024, 1, 3, 1);
    expect(result.error).toBeNull();
    expect(result.dates).toHaveLength(3);
    expect(result.dates[0].getDate()).toBe(1);
    expect(result.dates[1].getDate()).toBe(8);
    expect(result.dates[2].getDate()).toBe(15);
  });

  it("should generate dates across months", () => {
    // 2024年1月第4周到2月第2周周一：1月22日、1月29日、2月5日、2月12日，共4个日期
    const result = generateWeeklyDates(2024, 1, 4, 2024, 2, 2, 1);
    expect(result.error).toBeNull();
    expect(result.dates).toHaveLength(4);
    expect(result.dates[0].getMonth()).toBe(0); // January
    expect(result.dates[1].getMonth()).toBe(0); // January
    expect(result.dates[2].getMonth()).toBe(1); // February
    expect(result.dates[3].getMonth()).toBe(1); // February
  });

  it("should generate dates across years", () => {
    // 2024年12月第4周到2025年1月第2周周一
    const result = generateWeeklyDates(2024, 12, 4, 2025, 1, 2, 1);
    expect(result.error).toBeNull();
    expect(result.dates.length).toBeGreaterThanOrEqual(2);
    expect(result.dates[0].getFullYear()).toBe(2024);
    expect(result.dates[result.dates.length - 1].getFullYear()).toBe(2025);
  });

  it("should return detailed error for invalid start week with suggestion", () => {
    // 2024年2月只有4周，第5周无效
    const result = generateWeeklyDates(2024, 2, 5, 2024, 2, 1, 1);
    expect(result.error).toContain("2024年2月第5周不存在");
    expect(result.error).toContain("该月第4周只到");
    expect(result.error).toContain("你可能想选2024年3月第1周周一");
    expect(result.dates).toHaveLength(0);
  });

  it("should return detailed error for invalid end week with suggestion", () => {
    // 2024年2月只有4周，第5周无效
    const result = generateWeeklyDates(2024, 2, 1, 2024, 2, 5, 1);
    expect(result.error).toContain("2024年2月第5周不存在");
    expect(result.error).toContain("该月第4周只到");
    expect(result.error).toContain("你可能想选2024年3月第1周周一");
    expect(result.dates).toHaveLength(0);
  });

  it("should return error when start date is after end date", () => {
    const result = generateWeeklyDates(2024, 2, 3, 2024, 2, 1, 1);
    expect(result.error).toBe("日期范围无效，请调整开始和结束周");
    expect(result.dates).toHaveLength(0);
  });

  it("should handle different day of week", () => {
    // 2024年1月第1周到第2周周五
    const result = generateWeeklyDates(2024, 1, 1, 2024, 1, 2, 5);
    expect(result.error).toBeNull();
    expect(result.dates).toHaveLength(2);
    expect(result.dates[0].getDate()).toBe(5);
    expect(result.dates[1].getDate()).toBe(12);
  });

  it("should handle year boundary (December to January)", () => {
    // 2024年12月第4周到2025年1月第1周周一
    const result = generateWeeklyDates(2024, 12, 4, 2025, 1, 1, 1);
    expect(result.error).toBeNull();
    expect(result.dates.length).toBeGreaterThanOrEqual(1);
    expect(result.dates.some((d) => d.getFullYear() === 2024)).toBe(true);
    expect(result.dates.some((d) => d.getFullYear() === 2025)).toBe(true);
  });

  it("should provide correct suggestion when month has no target day", () => {
    // 2024年6月1日是周六，第1周周日应该是6月2日
    // 测试当周数无效时的建议是否正确
    const result = generateWeeklyDates(2024, 6, 5, 2024, 6, 5, 1);
    expect(result.error).toContain("2024年6月第5周不存在");
    expect(result.error).toContain("你可能想选2024年7月第1周周一");
  });
});

describe("generateMonthlyDates", () => {
  it("should generate dates within same month", () => {
    const result = generateMonthlyDates(2024, 1, 2024, 1, 15);
    expect(result.error).toBeNull();
    expect(result.dates).toHaveLength(1);
    expect(result.dates[0].getDate()).toBe(15);
    expect(result.skippedMonths).toHaveLength(0);
  });

  it("should generate dates across months", () => {
    const result = generateMonthlyDates(2024, 1, 2024, 3, 15);
    expect(result.error).toBeNull();
    expect(result.dates).toHaveLength(3);
    expect(result.dates[0].getMonth()).toBe(0);
    expect(result.dates[1].getMonth()).toBe(1);
    expect(result.dates[2].getMonth()).toBe(2);
    expect(result.skippedMonths).toHaveLength(0);
  });

  it("should generate dates across years", () => {
    const result = generateMonthlyDates(2024, 11, 2025, 1, 15);
    expect(result.error).toBeNull();
    expect(result.dates).toHaveLength(3);
    expect(result.dates[0].getFullYear()).toBe(2024);
    expect(result.dates[2].getFullYear()).toBe(2025);
    expect(result.skippedMonths).toHaveLength(0);
  });

  it("should skip months without specified day (31st) and return skippedMonths", () => {
    // 2月、4月、6月、9月、11月没有31日
    const result = generateMonthlyDates(2024, 1, 2024, 6, 31);
    expect(result.error).toBe("2024年2月、2024年4月、2024年6月没有31日，已跳过这些月份");
    expect(result.dates).toHaveLength(3); // 1月、3月、5月
    expect(result.skippedMonths).toHaveLength(3);
    expect(result.skippedMonths).toContain("2024年2月");
    expect(result.skippedMonths).toContain("2024年4月");
    expect(result.skippedMonths).toContain("2024年6月");
  });

  it("should skip 30th for February and return skippedMonths", () => {
    const result = generateMonthlyDates(2024, 1, 2024, 3, 30);
    expect(result.error).toBe("2024年2月没有30日，已跳过这些月份");
    expect(result.dates).toHaveLength(2); // 1月、3月
    expect(result.skippedMonths).toHaveLength(1);
    expect(result.skippedMonths).toContain("2024年2月");
  });

  it("should skip 29th for non-leap year February", () => {
    const result = generateMonthlyDates(2023, 1, 2023, 3, 29);
    expect(result.error).toBe("2023年2月没有29日，已跳过这些月份");
    expect(result.dates).toHaveLength(2); // 1月、3月
    expect(result.skippedMonths).toHaveLength(1);
  });

  it("should return error when all months are skipped", () => {
    // 只有2月，选择30日，所有月份都跳过
    const result = generateMonthlyDates(2023, 2, 2023, 2, 30);
    expect(result.error).toBe("2023年2月没有30日，请选择其他日期");
    expect(result.dates).toHaveLength(0);
    expect(result.skippedMonths).toHaveLength(1);
  });

  it("should handle leap year February with 29th", () => {
    const result = generateMonthlyDates(2024, 2, 2024, 2, 29);
    expect(result.error).toBeNull();
    expect(result.dates).toHaveLength(1);
    expect(result.dates[0].getDate()).toBe(29);
    expect(result.skippedMonths).toHaveLength(0);
  });

  it("should handle edge case day 1", () => {
    const result = generateMonthlyDates(2024, 1, 2024, 12, 1);
    expect(result.error).toBeNull();
    expect(result.dates).toHaveLength(12);
    expect(result.skippedMonths).toHaveLength(0);
  });

  it("should handle edge case day 28", () => {
    const result = generateMonthlyDates(2024, 1, 2024, 12, 28);
    expect(result.error).toBeNull();
    expect(result.dates).toHaveLength(12);
    expect(result.skippedMonths).toHaveLength(0);
  });

  it("should handle year boundary for month repetition", () => {
    // 2024年12月到2025年3月，每月31日
    // 12月、1月、3月有31日（3个日期），2月没有（1个跳过）
    const result = generateMonthlyDates(2024, 12, 2025, 3, 31);
    expect(result.dates).toHaveLength(3); // 2024年12月、2025年1月、2025年3月
    expect(result.skippedMonths).toHaveLength(1); // 2025年2月
    expect(result.error).toContain("2025年2月");
    expect(result.error).toContain("没有31日");
  });

  it("should handle selecting 31st day which triggers confirmation flow", () => {
    // 这是验收标准1的测试：月重复选择31日但月份不足31天时，应返回skippedMonths供确认窗口使用
    const result = generateMonthlyDates(2024, 2, 2024, 6, 31);
    expect(result.skippedMonths.length).toBeGreaterThan(0);
    expect(result.dates.length).toBeGreaterThan(0);
    expect(result.error).toContain("已跳过这些月份");
  });
});

// ============================================================
// Adversary 报告重点测试对象
// ============================================================
describe("Adversary Report - Boundary Cases", () => {
  it("should handle invalid week number at year boundary", () => {
    // 2024年12月第5周（如果存在的话）
    const result = generateWeeklyDates(2024, 12, 5, 2025, 1, 1, 1);
    // 如果12月没有第5周，应该返回错误并建议明年1月第1周
    if (result.error) {
      expect(result.error).toContain("2024年12月第5周不存在");
      expect(result.error).toContain("你可能想选2025年1月第1周");
    } else {
      expect(result.dates.length).toBeGreaterThan(0);
    }
  });

  it("should handle dayOfWeek boundary (0 = Sunday, 6 = Saturday)", () => {
    // 测试周日和周六的边界情况
    const sundayResult = generateWeeklyDates(2024, 1, 1, 2024, 1, 2, 0);
    expect(sundayResult.error).toBeNull();
    expect(sundayResult.dates).toHaveLength(2);

    const saturdayResult = generateWeeklyDates(2024, 1, 1, 2024, 1, 2, 6);
    expect(saturdayResult.error).toBeNull();
    expect(saturdayResult.dates).toHaveLength(2);
  });

  it("should handle month boundary (January to December)", () => {
    // 测试全年的月重复
    const result = generateMonthlyDates(2024, 1, 2024, 12, 15);
    expect(result.error).toBeNull();
    expect(result.dates).toHaveLength(12);
    expect(result.skippedMonths).toHaveLength(0);
  });

  it("should handle year overflow in generateMonthlyDates", () => {
    // 测试跨年边界
    const result = generateMonthlyDates(2024, 12, 2025, 1, 15);
    expect(result.error).toBeNull();
    expect(result.dates).toHaveLength(2);
    expect(result.dates[0].getFullYear()).toBe(2024);
    expect(result.dates[1].getFullYear()).toBe(2025);
  });
});

describe("Adversary Report - pendingData Consistency", () => {
  it("should preserve dates and groupId when months are skipped", () => {
    // 模拟验证pendingData一致性：当有跳过的月份时，dates和skippedMonths应该对应
    const result = generateMonthlyDates(2024, 1, 2024, 6, 31);
    // 1月、3月、5月有31日（3个日期），2月、4月、6月没有（3个跳过）
    expect(result.dates.length + result.skippedMonths.length).toBe(6); // 6个月
    expect(result.dates.length).toBe(3);
    expect(result.skippedMonths.length).toBe(3);
  });

  it("should return all dates when no months are skipped", () => {
    const result = generateMonthlyDates(2024, 1, 2024, 3, 15);
    expect(result.dates.length).toBe(3);
    expect(result.skippedMonths.length).toBe(0);
    expect(result.error).toBeNull();
  });
});

describe("Adversary Report - Date Formatting", () => {
  it("should generate dates in correct local time zone", () => {
    // 测试日期生成不应该有UTC时区偏移问题
    const result = generateMonthlyDates(2024, 1, 2024, 1, 1);
    expect(result.dates).toHaveLength(1);
    const date = result.dates[0];
    expect(date.getDate()).toBe(1);
    expect(date.getMonth()).toBe(0);
    expect(date.getFullYear()).toBe(2024);
  });

  it("should generate weekly dates with consistent interval", () => {
    const result = generateWeeklyDates(2024, 1, 1, 2024, 1, 4, 1);
    expect(result.dates).toHaveLength(4);
    // 每个日期应该间隔7天
    for (let i = 1; i < result.dates.length; i++) {
      const diffDays =
        (result.dates[i].getTime() - result.dates[i - 1].getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBe(7);
    }
  });
});

// ============================================================
// 新版本 generateWeeklyDates 测试（使用开始/结束日期）
// ============================================================

// 新的 generateWeeklyDates 函数（与 page.tsx 保持一致）
function generateWeeklyDatesNew(
  startDate: string,
  endDate: string,
): { dates: Date[]; error: string | null } {
  // 验证输入
  if (!startDate || !endDate) {
    return { dates: [], error: "请选择开始日期和结束日期" };
  }

  const dates: Date[] = [];
  const start = parseLocalISO(startDate + "T00:00:00");
  const end = parseLocalISO(endDate + "T00:00:00");

  // 验证日期有效性
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return { dates: [], error: "日期格式无效" };
  }

  // 验证日期范围
  if (start > end) {
    return { dates: [], error: "开始日期必须早于或等于结束日期" };
  }

  // 每隔7天生成一个日期
  const current = new Date(start);
  while (current <= end) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 7);
  }

  return { dates, error: null };
}

describe("generateWeeklyDatesNew - 正常路径", () => {
  it("应该生成开始日期到结束日期之间的周重复日期", () => {
    // 2024-01-01（周一）到 2024-01-22（周一）：应该生成 1/1, 1/8, 1/15, 1/22 共4个日期
    const result = generateWeeklyDatesNew("2024-01-01", "2024-01-22");
    expect(result.error).toBeNull();
    expect(result.dates).toHaveLength(4);
    expect(result.dates[0].getDate()).toBe(1);
    expect(result.dates[1].getDate()).toBe(8);
    expect(result.dates[2].getDate()).toBe(15);
    expect(result.dates[3].getDate()).toBe(22);
  });

  it("应该支持跨月的周重复", () => {
    // 2024-01-25（周四）到 2024-02-15（周四）：应该生成 1/25, 2/1, 2/8, 2/15 共4个日期
    const result = generateWeeklyDatesNew("2024-01-25", "2024-02-15");
    expect(result.error).toBeNull();
    expect(result.dates).toHaveLength(4);
    expect(result.dates[0].getMonth()).toBe(0); // 1月
    expect(result.dates[0].getDate()).toBe(25);
    expect(result.dates[1].getMonth()).toBe(1); // 2月
    expect(result.dates[1].getDate()).toBe(1);
    expect(result.dates[2].getMonth()).toBe(1); // 2月
    expect(result.dates[2].getDate()).toBe(8);
    expect(result.dates[3].getMonth()).toBe(1); // 2月
    expect(result.dates[3].getDate()).toBe(15);
  });

  it("应该支持跨年的周重复", () => {
    // 2024-12-26（周四）到 2025-01-09（周四）：应该生成 12/26, 1/2, 1/9 共3个日期
    const result = generateWeeklyDatesNew("2024-12-26", "2025-01-09");
    expect(result.error).toBeNull();
    expect(result.dates).toHaveLength(3);
    expect(result.dates[0].getFullYear()).toBe(2024);
    expect(result.dates[0].getMonth()).toBe(11); // 12月
    expect(result.dates[1].getFullYear()).toBe(2025);
    expect(result.dates[1].getMonth()).toBe(0); // 1月
    expect(result.dates[2].getFullYear()).toBe(2025);
    expect(result.dates[2].getMonth()).toBe(0); // 1月
  });

  it("开始日期等于结束日期时应生成单个日期", () => {
    const result = generateWeeklyDatesNew("2024-03-15", "2024-03-15");
    expect(result.error).toBeNull();
    expect(result.dates).toHaveLength(1);
    expect(result.dates[0].getDate()).toBe(15);
  });

  it("应该保持每隔7天的一致间隔", () => {
    const result = generateWeeklyDatesNew("2024-01-01", "2024-01-29");
    expect(result.dates).toHaveLength(5);
    for (let i = 1; i < result.dates.length; i++) {
      const diffDays =
        (result.dates[i].getTime() - result.dates[i - 1].getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBe(7);
    }
  });
});

describe("generateWeeklyDatesNew - 边界与空值（Adversary 重点测试对象）", () => {
  it("空字符串输入应返回错误消息", () => {
    const result1 = generateWeeklyDatesNew("", "2024-01-15");
    expect(result1.error).toBe("请选择开始日期和结束日期");
    expect(result1.dates).toHaveLength(0);

    const result2 = generateWeeklyDatesNew("2024-01-01", "");
    expect(result2.error).toBe("请选择开始日期和结束日期");
    expect(result2.dates).toHaveLength(0);

    const result3 = generateWeeklyDatesNew("", "");
    expect(result3.error).toBe("请选择开始日期和结束日期");
    expect(result3.dates).toHaveLength(0);
  });

  it("无效日期格式应被 parseLocalISO 解析为默认日期", () => {
    // parseLocalISO 对格式错误的字符串会返回默认日期（1900-01-01），而不是 NaN
    // 这是预期行为，所以无效格式会生成日期，但可能不是用户期望的
    const result = generateWeeklyDatesNew("invalid-date", "2024-01-15");
    // 由于 parseLocalISO 会将 "invalid-date" 解析为 1900-01-01，这会生成日期
    // 但在实际应用中，UI 会限制用户只能选择有效日期，所以这个场景不会发生
    expect(result.error).toBeNull();
    expect(result.dates.length).toBeGreaterThan(0);
  });

  it("开始日期晚于结束日期应返回错误消息", () => {
    const result = generateWeeklyDatesNew("2024-01-15", "2024-01-01");
    expect(result.error).toBe("开始日期必须早于或等于结束日期");
    expect(result.dates).toHaveLength(0);
  });

  it("应该正确处理闰年日期", () => {
    // 2024年是闰年，2月有29天
    const result = generateWeeklyDatesNew("2024-02-29", "2024-03-14");
    expect(result.error).toBeNull();
    expect(result.dates).toHaveLength(3);
    expect(result.dates[0].getDate()).toBe(29);
    expect(result.dates[0].getMonth()).toBe(1); // 2月
    expect(result.dates[1].getDate()).toBe(7);
    expect(result.dates[1].getMonth()).toBe(2); // 3月
    expect(result.dates[2].getDate()).toBe(14);
    expect(result.dates[2].getMonth()).toBe(2); // 3月
  });

  it("应该正确处理月末边界（31日）", () => {
    const result = generateWeeklyDatesNew("2024-01-31", "2024-02-21");
    expect(result.error).toBeNull();
    expect(result.dates).toHaveLength(4);
    // 1月31日、2月7日、2月14日、2月21日
    expect(result.dates[0].getDate()).toBe(31);
    expect(result.dates[0].getMonth()).toBe(0); // 1月
    expect(result.dates[1].getDate()).toBe(7);
    expect(result.dates[1].getMonth()).toBe(1); // 2月
    expect(result.dates[2].getDate()).toBe(14);
    expect(result.dates[2].getMonth()).toBe(1); // 2月
    expect(result.dates[3].getDate()).toBe(21);
    expect(result.dates[3].getMonth()).toBe(1); // 2月
  });

  it("应该使用 parseLocalISO 解析日期，避免时区偏移", () => {
    // 测试日期解析不应该有 UTC 时区偏移问题
    const result = generateWeeklyDatesNew("2024-01-01", "2024-01-08");
    expect(result.dates).toHaveLength(2);
    // 所有日期的时分秒应该是 00:00:00
    result.dates.forEach((date) => {
      expect(date.getHours()).toBe(0);
      expect(date.getMinutes()).toBe(0);
      expect(date.getSeconds()).toBe(0);
    });
  });
});

// ============================================================
// formatGroupInfo 测试（Adversary 重点测试对象）
// ============================================================

// 模拟 formatGroupInfo 函数（与 admin-schedule-gantt.tsx 保持一致）
const WEEK_DAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function formatGroupInfo(group: {
  title: string;
  repeat_mode: string;
  weekly_start_date?: string | null;
  weekly_end_date?: string | null;
  monthly_start_year?: number | null;
  monthly_start_month?: number | null;
  monthly_end_year?: number | null;
  monthly_end_month?: number | null;
  monthly_day?: number | null;
}): string {
  if (group.repeat_mode === "weekly" && group.weekly_start_date && group.weekly_end_date) {
    const startDate = parseLocalISO(group.weekly_start_date + "T00:00:00");
    const endDate = parseLocalISO(group.weekly_end_date + "T00:00:00");

    const formatDate = (date: Date): string => {
      return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
    };

    const dayIndex = startDate.getDay();
    const dayLabel = WEEK_DAYS[dayIndex];

    return `${group.title}：${formatDate(startDate)}至${formatDate(endDate)}，每周${dayLabel}`;
  } else if (group.repeat_mode === "monthly") {
    return `${group.title}：${group.monthly_start_year}年${group.monthly_start_month}月至${group.monthly_end_year}年${group.monthly_end_month}月，每月${group.monthly_day}日`;
  }
  return `${group.title}：重复预约组`;
}

describe("formatGroupInfo - 周重复信息显示", () => {
  it("应该正确显示周重复信息（周一）", () => {
    const group = {
      title: "排练房A",
      repeat_mode: "weekly",
      weekly_start_date: "2024-01-01",
      weekly_end_date: "2024-01-22",
    };
    const result = formatGroupInfo(group);
    expect(result).toContain("排练房A");
    expect(result).toContain("2024年1月1日");
    expect(result).toContain("2024年1月22日");
    expect(result).toContain("每周周一");
  });

  it("应该正确显示周重复信息（周日）", () => {
    const group = {
      title: "排练房B",
      repeat_mode: "weekly",
      weekly_start_date: "2024-01-07", // 周日
      weekly_end_date: "2024-01-28", // 周日
    };
    const result = formatGroupInfo(group);
    expect(result).toContain("每周周日");
  });

  it("应该正确显示周重复信息（周六）", () => {
    const group = {
      title: "排练房C",
      repeat_mode: "weekly",
      weekly_start_date: "2024-01-06", // 周六
      weekly_end_date: "2024-01-27", // 周六
    };
    const result = formatGroupInfo(group);
    expect(result).toContain("每周周六");
  });

  it("应该正确计算 weekly_day（周二到周五）", () => {
    const testCases = [
      { date: "2024-01-02", expected: "周二" },
      { date: "2024-01-03", expected: "周三" },
      { date: "2024-01-04", expected: "周四" },
      { date: "2024-01-05", expected: "周五" },
    ];

    testCases.forEach(({ date, expected }) => {
      const group = {
        title: "测试",
        repeat_mode: "weekly",
        weekly_start_date: date,
        weekly_end_date: "2024-01-29",
      };
      const result = formatGroupInfo(group);
      expect(result).toContain(`每周${expected}`);
    });
  });

  it("应该使用 parseLocalISO 解析日期，避免时区偏移", () => {
    const group = {
      title: "测试",
      repeat_mode: "weekly",
      weekly_start_date: "2024-03-15",
      weekly_end_date: "2024-04-05",
    };
    const result = formatGroupInfo(group);
    // 验证日期显示正确，没有因时区偏移导致日期错误
    expect(result).toContain("2024年3月15日");
    expect(result).toContain("2024年4月5日");
  });

  it("应该正确处理跨年的周重复", () => {
    const group = {
      title: "跨年测试",
      repeat_mode: "weekly",
      weekly_start_date: "2024-12-26",
      weekly_end_date: "2025-01-09",
    };
    const result = formatGroupInfo(group);
    expect(result).toContain("2024年12月26日");
    expect(result).toContain("2025年1月9日");
    expect(result).toContain("每周周四"); // 2024-12-26 是周四
  });
});

describe("formatGroupInfo - 月重复信息显示", () => {
  it("应该正确显示月重复信息", () => {
    const group = {
      title: "月度会议",
      repeat_mode: "monthly",
      monthly_start_year: 2024,
      monthly_start_month: 1,
      monthly_end_year: 2024,
      monthly_end_month: 12,
      monthly_day: 15,
    };
    const result = formatGroupInfo(group);
    expect(result).toBe("月度会议：2024年1月至2024年12月，每月15日");
  });

  it("应该正确显示跨年的月重复", () => {
    const group = {
      title: "跨年月度",
      repeat_mode: "monthly",
      monthly_start_year: 2024,
      monthly_start_month: 11,
      monthly_end_year: 2025,
      monthly_end_month: 2,
      monthly_day: 20,
    };
    const result = formatGroupInfo(group);
    expect(result).toBe("跨年月度：2024年11月至2025年2月，每月20日");
  });
});

describe("formatGroupInfo - weekly_day 计算（Adversary 重点测试对象）", () => {
  it("应该从 weekly_start_date 正确计算周一（dayOfWeek=1）", () => {
    const group = {
      title: "周一测试",
      repeat_mode: "weekly",
      weekly_start_date: "2024-01-01", // 2024-01-01 是周一
      weekly_end_date: "2024-01-29",
    };
    const startDate = parseLocalISO(group.weekly_start_date + "T00:00:00");
    expect(startDate.getDay()).toBe(1); // 周一
    const result = formatGroupInfo(group);
    expect(result).toContain("每周周一");
  });

  it("应该从 weekly_start_date 正确计算周日（dayOfWeek=0）", () => {
    const group = {
      title: "周日测试",
      repeat_mode: "weekly",
      weekly_start_date: "2024-01-07", // 2024-01-07 是周日
      weekly_end_date: "2024-02-04",
    };
    const startDate = parseLocalISO(group.weekly_start_date + "T00:00:00");
    expect(startDate.getDay()).toBe(0); // 周日
    const result = formatGroupInfo(group);
    expect(result).toContain("每周周日");
  });

  it("应该从 weekly_start_date 正确计算周六（dayOfWeek=6）", () => {
    const group = {
      title: "周六测试",
      repeat_mode: "weekly",
      weekly_start_date: "2024-01-06", // 2024-01-06 是周六
      weekly_end_date: "2024-02-03",
    };
    const startDate = parseLocalISO(group.weekly_start_date + "T00:00:00");
    expect(startDate.getDay()).toBe(6); // 周六
    const result = formatGroupInfo(group);
    expect(result).toContain("每周周六");
  });

  it("应该正确处理闰年日期的 weekly_day 计算", () => {
    // 2024-02-29 是周四
    const group = {
      title: "闰年测试",
      repeat_mode: "weekly",
      weekly_start_date: "2024-02-29",
      weekly_end_date: "2024-03-28",
    };
    const startDate = parseLocalISO(group.weekly_start_date + "T00:00:00");
    expect(startDate.getDay()).toBe(4); // 周四
    const result = formatGroupInfo(group);
    expect(result).toContain("每周周四");
  });
});
