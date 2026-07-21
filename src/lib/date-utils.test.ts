import { describe, it, expect } from "vitest";
import {
  formatLocalISO,
  parseLocalISO,
  getLocalDateString,
  formatTime,
  formatDisplayDate,
  formatDateTime,
} from "./date-utils";

describe("date-utils", () => {
  describe("formatLocalISO", () => {
    it("应该正确格式化正常日期时间", () => {
      const date = new Date(2024, 5, 15, 14, 30, 45);
      expect(formatLocalISO(date)).toBe("2024-06-15T14:30:45");
    });

    it("应该正确处理凌晨时间（00:30）", () => {
      const date = new Date(2024, 0, 1, 0, 30, 0);
      expect(formatLocalISO(date)).toBe("2024-01-01T00:30:00");
    });

    it("应该正确处理闰年2月29日", () => {
      const date = new Date(2024, 1, 29, 12, 0, 0);
      expect(formatLocalISO(date)).toBe("2024-02-29T12:00:00");
    });

    it("应该正确处理跨年时间（12月31日）", () => {
      const date = new Date(2024, 11, 31, 23, 59, 59);
      expect(formatLocalISO(date)).toBe("2024-12-31T23:59:59");
    });

    it("应该正确处理新年第一天（1月1日）", () => {
      const date = new Date(2025, 0, 1, 0, 0, 0);
      expect(formatLocalISO(date)).toBe("2025-01-01T00:00:00");
    });

    it("应该正确处理个位数月份和日期的补零", () => {
      const date = new Date(2024, 0, 5, 9, 5, 3);
      expect(formatLocalISO(date)).toBe("2024-01-05T09:05:03");
    });

    it("应该对无效Date对象抛出错误", () => {
      expect(() => formatLocalISO(new Date("invalid"))).toThrow("Invalid Date object");
      expect(() => formatLocalISO({} as Date)).toThrow("Invalid Date object");
    });
  });

  describe("parseLocalISO", () => {
    it("应该正确解析正常ISO字符串", () => {
      const date = parseLocalISO("2024-06-15T14:30:45");
      expect(date.getFullYear()).toBe(2024);
      expect(date.getMonth()).toBe(5); // 0-indexed
      expect(date.getDate()).toBe(15);
      expect(date.getHours()).toBe(14);
      expect(date.getMinutes()).toBe(30);
      expect(date.getSeconds()).toBe(45);
    });

    it("应该正确解析凌晨时间", () => {
      const date = parseLocalISO("2024-01-01T00:30:00");
      expect(date.getHours()).toBe(0);
      expect(date.getMinutes()).toBe(30);
    });

    it("应该正确解析闰年2月29日", () => {
      const date = parseLocalISO("2024-02-29T12:00:00");
      expect(date.getFullYear()).toBe(2024);
      expect(date.getMonth()).toBe(1);
      expect(date.getDate()).toBe(29);
    });

    it("应该正确解析跨年时间", () => {
      const date = parseLocalISO("2024-12-31T23:59:59");
      expect(date.getFullYear()).toBe(2024);
      expect(date.getMonth()).toBe(11);
      expect(date.getDate()).toBe(31);
    });

    it("应该正确处理缺少秒数的ISO字符串", () => {
      const date = parseLocalISO("2024-06-15T14:30");
      expect(date.getHours()).toBe(14);
      expect(date.getMinutes()).toBe(30);
      expect(date.getSeconds()).toBe(0);
    });

    it("应该正确处理缺少时间部分的ISO字符串", () => {
      const date = parseLocalISO("2024-06-15");
      expect(date.getFullYear()).toBe(2024);
      expect(date.getMonth()).toBe(5);
      expect(date.getDate()).toBe(15);
      expect(date.getHours()).toBe(0);
      expect(date.getMinutes()).toBe(0);
    });

    it("应该处理无效输入返回有效Date对象（默认值）", () => {
      const date = parseLocalISO("invalid");
      expect(date instanceof Date).toBe(true);
    });
  });

  describe("getLocalDateString", () => {
    it("应该正确获取本地日期字符串", () => {
      const date = new Date(2024, 5, 15);
      expect(getLocalDateString(date)).toBe("2024-06-15");
    });

    it("应该默认使用当前日期", () => {
      const result = getLocalDateString();
      const today = new Date();
      const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      expect(result).toBe(expected);
    });

    it("应该正确处理个位数月份和日期的补零", () => {
      const date = new Date(2024, 0, 5);
      expect(getLocalDateString(date)).toBe("2024-01-05");
    });

    it("应该正确处理跨年日期", () => {
      const date = new Date(2024, 11, 31);
      expect(getLocalDateString(date)).toBe("2024-12-31");
    });

    it("应该对无效Date对象抛出错误", () => {
      expect(() => getLocalDateString(new Date("invalid"))).toThrow("Invalid Date object");
      expect(() => getLocalDateString({} as Date)).toThrow("Invalid Date object");
    });
  });

  describe("formatTime", () => {
    it("应该正确格式化正常时间", () => {
      expect(formatTime("2024-06-15T14:30:45")).toBe("14:30");
    });

    it("应该正确格式化凌晨时间", () => {
      expect(formatTime("2024-01-01T00:30:00")).toBe("00:30");
    });

    it("应该正确格式化午夜时间", () => {
      expect(formatTime("2024-01-01T00:00:00")).toBe("00:00");
    });

    it("应该正确格式化24点前的时间", () => {
      expect(formatTime("2024-12-31T23:59:59")).toBe("23:59");
    });

    it("应该正确处理缺少秒数的时间字符串", () => {
      expect(formatTime("2024-06-15T14:30")).toBe("14:30");
    });

    it("应该对null输入返回--:--", () => {
      expect(formatTime(null)).toBe("--:--");
    });

    it("应该对空字符串返回--:--", () => {
      expect(formatTime("")).toBe("--:--");
    });

    it("应该对无效输入返回默认时间", () => {
      // parseLocalISO 对无效输入返回默认 Date（1970-01-01 00:00:00）
      expect(formatTime("invalid")).toBe("00:00");
    });
  });

  describe("formatDisplayDate", () => {
    it("应该正确格式化正常日期（包含时间部分）", () => {
      // 2024-06-15 是周六
      expect(formatDisplayDate("2024-06-15T14:30:45")).toBe("6月15日 周六");
    });

    it("应该正确格式化纯日期字符串", () => {
      // 2024-01-01 是周一
      expect(formatDisplayDate("2024-01-01")).toBe("1月1日 周一");
    });

    it("应该正确格式化周日", () => {
      // 2024-01-07 是周日
      expect(formatDisplayDate("2024-01-07")).toBe("1月7日 周日");
    });

    it("应该正确格式化闰年2月29日", () => {
      // 2024-02-29 是周四
      expect(formatDisplayDate("2024-02-29")).toBe("2月29日 周四");
    });

    it("应该正确格式化跨年日期", () => {
      // 2024-12-31 是周二
      expect(formatDisplayDate("2024-12-31")).toBe("12月31日 周二");
    });

    it("应该正确格式化新年第一天", () => {
      // 2025-01-01 是周三
      expect(formatDisplayDate("2025-01-01")).toBe("1月1日 周三");
    });

    it("应该正确处理个位数月份和日期", () => {
      // 2024-03-05 是周二
      expect(formatDisplayDate("2024-03-05")).toBe("3月5日 周二");
    });
  });

  describe("formatDateTime", () => {
    it("应该正确格式化正常日期时间", () => {
      // Intl.DateTimeFormat 使用本地日期分隔符，中文环境为 "/"
      expect(formatDateTime("2024-06-15T14:30:45")).toBe("06/15 14:30");
    });

    it("应该正确格式化凌晨时间", () => {
      expect(formatDateTime("2024-01-01T00:30:00")).toBe("01/01 00:30");
    });

    it("应该正确格式化午夜时间", () => {
      expect(formatDateTime("2024-01-01T00:00:00")).toBe("01/01 00:00");
    });

    it("应该正确格式化24点前的时间", () => {
      expect(formatDateTime("2024-12-31T23:59:59")).toBe("12/31 23:59");
    });

    it("应该正确处理缺少秒数的时间字符串", () => {
      expect(formatDateTime("2024-06-15T14:30")).toBe("06/15 14:30");
    });

    it("应该对null输入返回—", () => {
      expect(formatDateTime(null)).toBe("—");
    });

    it("应该对空字符串返回—", () => {
      // !"" 为 true，所以返回 "—"
      expect(formatDateTime("")).toBe("—");
    });

    it("应该对无效输入返回默认日期时间", () => {
      // parseLocalISO 对无效输入返回默认 Date（1970-01-01 00:00:00）
      expect(formatDateTime("invalid")).toBe("01/01 00:00");
    });

    it("应该正确处理个位数月份和日期", () => {
      expect(formatDateTime("2024-03-05T09:05:03")).toBe("03/05 09:05");
    });
  });
});
