import { describe, expect, it } from "vitest";
import { formatRepertoireSummary } from "./repertoire-summary";

describe("formatRepertoireSummary", () => {
  it("没有内容时保持原来的曲名顿号拼接", () => {
    expect(formatRepertoireSummary([{ title: "A" }, { title: "B" }])).toBe("A、B");
  });

  it("有内容时写成「曲名：内容」，曲目之间用分号", () => {
    expect(
      formatRepertoireSummary([
        { title: "肖斯塔科维奇第五交响曲", content: "第一、第二乐章" },
        { title: "另一首", content: "全曲" },
      ]),
    ).toBe("肖斯塔科维奇第五交响曲：第一、第二乐章；另一首：全曲");
  });

  it("空白内容视为没有内容，且会 trim", () => {
    expect(
      formatRepertoireSummary([
        { title: "  肖五  ", content: "  第一乐章  " },
        { title: "B", content: "   " },
      ]),
    ).toBe("肖五：第一乐章；B");
  });

  it("空曲名被丢弃", () => {
    expect(formatRepertoireSummary([{ title: "  " }, { title: "A" }])).toBe("A");
    expect(formatRepertoireSummary([])).toBe("");
  });
});
