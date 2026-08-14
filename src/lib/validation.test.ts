import { describe, it, expect } from "vitest";
import { isValidPhoneNumber } from "./validation";

describe("validation", () => {
  describe("isValidPhoneNumber", () => {
    it("11 位、以 1 开头的数字合法", () => {
      expect(isValidPhoneNumber("13800138000")).toBe(true);
      expect(isValidPhoneNumber("18812345678")).toBe(true);
      expect(isValidPhoneNumber("19987654321")).toBe(true);
    });

    it("少于 11 位不合法", () => {
      expect(isValidPhoneNumber("1380013800")).toBe(false);
      expect(isValidPhoneNumber("1")).toBe(false);
    });

    it("多于 11 位不合法", () => {
      expect(isValidPhoneNumber("138001380000")).toBe(false);
    });

    it("不以 1 开头不合法", () => {
      expect(isValidPhoneNumber("23800138000")).toBe(false);
      expect(isValidPhoneNumber("01800138000")).toBe(false);
    });

    it("包含非数字字符不合法", () => {
      expect(isValidPhoneNumber("1380013800a")).toBe(false);
      expect(isValidPhoneNumber("138-0013-8000")).toBe(false);
      expect(isValidPhoneNumber("138 0013 8000")).toBe(false);
    });

    it("空串不合法（可选字段为空由表单单独处理）", () => {
      expect(isValidPhoneNumber("")).toBe(false);
      expect(isValidPhoneNumber("   ")).toBe(false);
    });
  });
});
