import { describe, it, expect } from "vitest";

// 根据年份、月份、周数和星期几获取目标日期
const getDateOfWeekInMonth = (
  year: number,
  month: number,
  weekNumber: number,
  dayOfWeek: number,
): Date | null => {
  const firstDay = new Date(year, month - 1, 1).getDay();
  const firstTargetOffset = (dayOfWeek - firstDay + 7) % 7;
  const firstTargetDate = new Date(year, month - 1, 1 + firstTargetOffset);

  if (firstTargetDate.getMonth() !== month - 1) {
    firstTargetDate.setDate(firstTargetDate.getDate() + 7);
  }

  const targetDate = new Date(firstTargetDate);
  targetDate.setDate(firstTargetDate.getDate() + (weekNumber - 1) * 7);

  if (targetDate.getMonth() !== month - 1) {
    return null;
  }

  return targetDate;
};

// 计算某月份实际有几周
const getWeeksInMonth = (year: number, month: number): number => {
  let weekNumber = 1;
  while (getDateOfWeekInMonth(year, month, weekNumber, 1)) {
    weekNumber++;
  }
  return weekNumber - 1;
};

// 生成周重复日期
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

  const startTargetDate = getDateOfWeekInMonth(startYear, startMonth, startWeek, dayOfWeek);
  if (!startTargetDate) {
    return { dates: [], error: `开始月份第${startWeek}周无效` };
  }

  const endTargetDate = getDateOfWeekInMonth(endYear, endMonth, endWeek, dayOfWeek);
  if (!endTargetDate) {
    return { dates: [], error: `结束月份第${endWeek}周无效` };
  }

  if (startTargetDate > endTargetDate) {
    return { dates: [], error: "日期范围无效，请调整开始和结束周" };
  }

  const currentDate = new Date(startTargetDate);
  while (currentDate <= endTargetDate) {
    dates.push(new Date(currentDate));
    currentDate.setDate(currentDate.getDate() + 7);
  }

  return { dates, error: null };
}

// 生成月重复日期
function generateMonthlyDates(
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number,
  dayOfMonth: number,
): { dates: Date[]; error: string | null } {
  const dates: Date[] = [];
  const skippedMonths: string[] = [];

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
    };
  }

  if (skippedMonths.length > 0) {
    return { dates, error: `${skippedMonths.join("、")}没有${dayOfMonth}日，已跳过这些月份` };
  }

  return { dates, error: null };
}

describe("getDateOfWeekInMonth", () => {
  it("should return correct date when first day of month is Monday", () => {
    // 2024年1月1日是周一，第1周周一应该是1月1日
    const result = getDateOfWeekInMonth(2024, 1, 1, 1);
    expect(result).not.toBeNull();
    expect(result?.getDate()).toBe(1);
    expect(result?.getMonth()).toBe(0);
    expect(result?.getFullYear()).toBe(2024);
  });

  it("should return correct date when first day of month is Sunday", () => {
    // 2023年10月1日是周日，第1周周一应该是10月2日
    const result = getDateOfWeekInMonth(2023, 10, 1, 1);
    expect(result).not.toBeNull();
    expect(result?.getDate()).toBe(2);
    expect(result?.getMonth()).toBe(9);
    expect(result?.getFullYear()).toBe(2023);
  });

  it("should return correct date when first day of month is Friday", () => {
    // 2024年3月1日是周五，第1周周一应该是3月4日
    const result = getDateOfWeekInMonth(2024, 3, 1, 1);
    expect(result).not.toBeNull();
    expect(result?.getDate()).toBe(4);
    expect(result?.getMonth()).toBe(2);
    expect(result?.getFullYear()).toBe(2024);
  });

  it("should return null for invalid week number", () => {
    // 2024年2月（闰年）只有4周周一，第5周应该返回null
    const result = getDateOfWeekInMonth(2024, 2, 5, 1);
    expect(result).toBeNull();
  });

  it("should handle different day of week", () => {
    // 2024年1月1日是周一，第1周周五应该是1月5日
    const result = getDateOfWeekInMonth(2024, 1, 1, 5);
    expect(result).not.toBeNull();
    expect(result?.getDate()).toBe(5);
    expect(result?.getMonth()).toBe(0);
    expect(result?.getFullYear()).toBe(2024);
  });

  it("should handle Sunday (dayOfWeek = 0)", () => {
    // 2024年1月1日是周一，第1周周日应该是1月7日
    const result = getDateOfWeekInMonth(2024, 1, 1, 0);
    expect(result).not.toBeNull();
    expect(result?.getDate()).toBe(7);
    expect(result?.getMonth()).toBe(0);
    expect(result?.getFullYear()).toBe(2024);
  });

  it("should return correct date for leap year February", () => {
    // 2024年2月1日是周四，第1周周一应该是2月5日
    const result = getDateOfWeekInMonth(2024, 2, 1, 1);
    expect(result).not.toBeNull();
    expect(result?.getDate()).toBe(5);
    expect(result?.getMonth()).toBe(1);
    expect(result?.getFullYear()).toBe(2024);
  });

  it("should return correct date for non-leap year February", () => {
    // 2023年2月1日是周三，第1周周一应该是2月6日
    const result = getDateOfWeekInMonth(2023, 2, 1, 1);
    expect(result).not.toBeNull();
    expect(result?.getDate()).toBe(6);
    expect(result?.getMonth()).toBe(1);
    expect(result?.getFullYear()).toBe(2023);
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

  it("should return error for invalid start week", () => {
    const result = generateWeeklyDates(2024, 2, 5, 2024, 2, 1, 1);
    expect(result.error).toBe("开始月份第5周无效");
    expect(result.dates).toHaveLength(0);
  });

  it("should return error for invalid end week", () => {
    const result = generateWeeklyDates(2024, 2, 1, 2024, 2, 5, 1);
    expect(result.error).toBe("结束月份第5周无效");
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
});

describe("generateMonthlyDates", () => {
  it("should generate dates within same month", () => {
    const result = generateMonthlyDates(2024, 1, 2024, 1, 15);
    expect(result.error).toBeNull();
    expect(result.dates).toHaveLength(1);
    expect(result.dates[0].getDate()).toBe(15);
  });

  it("should generate dates across months", () => {
    const result = generateMonthlyDates(2024, 1, 2024, 3, 15);
    expect(result.error).toBeNull();
    expect(result.dates).toHaveLength(3);
    expect(result.dates[0].getMonth()).toBe(0);
    expect(result.dates[1].getMonth()).toBe(1);
    expect(result.dates[2].getMonth()).toBe(2);
  });

  it("should generate dates across years", () => {
    const result = generateMonthlyDates(2024, 11, 2025, 1, 15);
    expect(result.error).toBeNull();
    expect(result.dates).toHaveLength(3);
    expect(result.dates[0].getFullYear()).toBe(2024);
    expect(result.dates[2].getFullYear()).toBe(2025);
  });

  it("should skip months without specified day (31st)", () => {
    // 2月、4月、6月、9月、11月没有31日
    const result = generateMonthlyDates(2024, 1, 2024, 6, 31);
    expect(result.error).toBe("2024年2月、2024年4月、2024年6月没有31日，已跳过这些月份");
    expect(result.dates).toHaveLength(3); // 1月、3月、5月
  });

  it("should skip 30th for February", () => {
    const result = generateMonthlyDates(2024, 1, 2024, 3, 30);
    expect(result.error).toBe("2024年2月没有30日，已跳过这些月份");
    expect(result.dates).toHaveLength(2); // 1月、3月
  });

  it("should skip 29th for non-leap year February", () => {
    const result = generateMonthlyDates(2023, 1, 2023, 3, 29);
    expect(result.error).toBe("2023年2月没有29日，已跳过这些月份");
    expect(result.dates).toHaveLength(2); // 1月、3月
  });

  it("should return error when all months are skipped", () => {
    // 只有2月，选择30日，所有月份都跳过
    const result = generateMonthlyDates(2023, 2, 2023, 2, 30);
    expect(result.error).toBe("2023年2月没有30日，请选择其他日期");
    expect(result.dates).toHaveLength(0);
  });

  it("should handle leap year February with 29th", () => {
    const result = generateMonthlyDates(2024, 2, 2024, 2, 29);
    expect(result.error).toBeNull();
    expect(result.dates).toHaveLength(1);
    expect(result.dates[0].getDate()).toBe(29);
  });

  it("should handle edge case day 1", () => {
    const result = generateMonthlyDates(2024, 1, 2024, 12, 1);
    expect(result.error).toBeNull();
    expect(result.dates).toHaveLength(12);
  });

  it("should handle edge case day 28", () => {
    const result = generateMonthlyDates(2024, 1, 2024, 12, 28);
    expect(result.error).toBeNull();
    expect(result.dates).toHaveLength(12);
  });
});
