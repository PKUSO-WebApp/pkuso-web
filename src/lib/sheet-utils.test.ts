import { describe, it, expect } from "vitest";
import { sanitizeSheetName, buildUniqueSheetNames } from "./sheet-utils";

describe("sanitizeSheetName（sheet 名清洗）", () => {
  it("非法字符 \\ / ? * [ ] : 全部替换为 _", () => {
    // 注意 "目[1]:演"：] 与 : 相邻，各替换一个 _，得到 "目_1__演"
    expect(sanitizeSheetName("贝/多\\芬?曲*目[1]:演")).toBe("贝_多_芬_曲_目_1__演");
  });

  it("超过 31 字符截断至 31", () => {
    expect(sanitizeSheetName("排".repeat(40))).toBe("排".repeat(31));
  });

  it("清洗后为空回退为 Sheet", () => {
    expect(sanitizeSheetName("")).toBe("Sheet");
  });

  it("全非法字符替换后保留替换结果（非空不回退）", () => {
    expect(sanitizeSheetName("///")).toBe("___");
  });

  it("合法名原样返回", () => {
    expect(sanitizeSheetName("排练_2026-08-16")).toBe("排练_2026-08-16");
  });
});

describe("buildUniqueSheetNames（重名去重）", () => {
  it("重名追加序号（第二个为 (2)）", () => {
    expect(buildUniqueSheetNames(["排练_2026-08-16", "排练_2026-08-16"])).toEqual([
      "排练_2026-08-16",
      "排练_2026-08-16(2)",
    ]);
  });

  it("三连重名依次追加 (2)(3)", () => {
    expect(buildUniqueSheetNames(["A", "A", "A"])).toEqual(["A", "A(2)", "A(3)"]);
  });

  it("原始名不同但清洗后重名的也去重", () => {
    expect(buildUniqueSheetNames(["A/B", "A:B"])).toEqual(["A_B", "A_B(2)"]);
  });

  it("超长重名：追加序号后仍不超过 31 字符", () => {
    const long = "排".repeat(40);
    const [first, second] = buildUniqueSheetNames([long, long]);
    expect(first).toBe("排".repeat(31));
    expect(second.length).toBe(31);
    expect(second).toBe(`${"排".repeat(28)}(2)`);
  });

  it("序号与既有名字冲突时继续递增", () => {
    // 第二个 "A" 与已有的 "A(2)" 冲突，应跳到 (3)
    expect(buildUniqueSheetNames(["A", "A(2)", "A"])).toEqual(["A", "A(2)", "A(3)"]);
  });

  it("不重名时保持原顺序与内容", () => {
    expect(buildUniqueSheetNames(["排练_2026-08-16", "莫扎特协奏曲_2026-08-21"])).toEqual([
      "排练_2026-08-16",
      "莫扎特协奏曲_2026-08-21",
    ]);
  });
});
