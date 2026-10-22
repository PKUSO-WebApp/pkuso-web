import { describe, expect, it } from "vitest";
import { normalizeProfileInstrument } from "./instrument-aliases";

/**
 * 这条判据和 DB 触发器 `validate_profile_instrument` 是同一条：
 * 允许 16 个乐器 + 「其他」；总谱、组名、未知值一律不接受。
 */
describe("normalizeProfileInstrument", () => {
  it("别名归一为规范乐器", () => {
    expect(normalizeProfileInstrument("一提")).toBe("第一小提琴");
    expect(normalizeProfileInstrument("bass")).toBe("低音提琴");
    expect(normalizeProfileInstrument("钢琴")).toBe("键盘");
  });

  it("标准值与「其他」放行", () => {
    expect(normalizeProfileInstrument("长号")).toBe("长号");
    expect(normalizeProfileInstrument("其他")).toBe("其他");
  });

  it("总谱 / 组名 / 未知值 / 旧英文 Other 不接受", () => {
    expect(normalizeProfileInstrument("总谱")).toBeNull();
    expect(normalizeProfileInstrument("木管")).toBeNull();
    expect(normalizeProfileInstrument("小提琴")).toBeNull();
    expect(normalizeProfileInstrument("Other")).toBeNull();
    expect(normalizeProfileInstrument("")).toBeNull();
  });
});
