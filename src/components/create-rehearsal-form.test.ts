import { describe, expect, it } from "vitest";
import { formatRepertoireLabel } from "./create-rehearsal-form";

describe("formatRepertoireLabel", () => {
  it("有作曲家时显示「曲目名 - 作曲家」", () => {
    expect(formatRepertoireLabel({ title: "第五交响曲", composer: "肖斯塔科维奇" })).toBe(
      "第五交响曲 - 肖斯塔科维奇",
    );
    expect(formatRepertoireLabel({ title: "第五交响曲", composer: "舒伯特" })).toBe(
      "第五交响曲 - 舒伯特",
    );
  });

  it("没有作曲家时只显示曲目名，不留悬空分隔符", () => {
    expect(formatRepertoireLabel({ title: "燕园情", composer: null })).toBe("燕园情");
    expect(formatRepertoireLabel({ title: "燕园情", composer: "" })).toBe("燕园情");
    expect(formatRepertoireLabel({ title: "燕园情", composer: "   " })).toBe("燕园情");
    expect(formatRepertoireLabel({ title: "燕园情" })).toBe("燕园情");
  });
});
