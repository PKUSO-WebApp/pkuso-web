import { describe, expect, it } from "vitest";
import {
  buildManifest,
  groupPrintPlan,
  printFileName,
  summarizePrintPlan,
  uniquePrintName,
  type PrintPlanRow,
} from "./print-plan";

const row = (over: Partial<PrintPlanRow>): PrintPlanRow => ({
  file_id: "f1",
  part_id: "p1",
  section: "第一小提琴",
  file_name: "小提琴1.pdf",
  storage_path: "s/v1.pdf",
  file_size: 100,
  sub_parts: [1],
  section_members: 12,
  assigned_members: 8,
  auto_copies: 8,
  manual_copies: null,
  copies: 8,
  kind: "part",
  ...over,
});

describe("printFileName", () => {
  it("份数在前，保留原文件名", () => {
    expect(printFileName(8, "小提琴1.pdf")).toBe("8份_小提琴1.pdf");
    expect(printFileName(1, "总谱")).toBe("1份_总谱.pdf");
  });

  it("非法字符替换成空格", () => {
    expect(printFileName(2, "a/b:c.pdf")).toBe("2份_a b c.pdf");
  });
});

describe("uniquePrintName", () => {
  it("同名追加序号", () => {
    const used = new Set<string>();
    expect(uniquePrintName("x.pdf", used)).toBe("x.pdf");
    expect(uniquePrintName("x.pdf", used)).toBe("x_2.pdf");
    expect(uniquePrintName("x.pdf", used)).toBe("x_3.pdf");
  });
});

describe("groupPrintPlan", () => {
  it("总谱最前、按乐器顺序分组，组内按分声部号", () => {
    const groups = groupPrintPlan([
      row({ file_id: "a", section: "长笛", sub_parts: [1], file_name: "长笛1.pdf" }),
      row({ file_id: "b", section: "总谱", sub_parts: [], kind: "score", copies: 1 }),
      row({
        file_id: "c",
        section: "第一小提琴",
        sub_parts: [2],
        file_name: "小提琴2.pdf",
      }),
      row({ file_id: "d", section: "第一小提琴", sub_parts: [1] }),
    ]);

    expect(groups.map((g) => g.section)).toEqual(["总谱", "第一小提琴", "长笛"]);
    expect(groups[1].rows.map((r) => r.file_id)).toEqual(["d", "c"]);
    expect(groups[1].sectionMembers).toBe(12);
  });
});

describe("summarizePrintPlan", () => {
  it("合计所有份数，文件数只算应印 > 0 的", () => {
    expect(
      summarizePrintPlan([
        row({ file_id: "a", copies: 1 }),
        row({ file_id: "b", copies: 0 }),
        row({ file_id: "c", copies: 4 }),
      ]),
    ).toEqual({ fileCount: 2, totalCopies: 5 });
  });
});

describe("buildManifest", () => {
  it("包含表头、每行与合计", () => {
    const text = buildManifest("红旗颂", [
      row({ file_id: "a", file_name: "小提琴1.pdf", sub_parts: [1], copies: 8 }),
      row({
        file_id: "b",
        section: "总谱",
        file_name: "总谱.pdf",
        kind: "score",
        sub_parts: [],
        section_members: 0,
        assigned_members: null,
        auto_copies: 1,
        copies: 1,
      }),
    ]);
    expect(text).toContain("曲名：红旗颂");
    expect(text).toContain("声部\t文件\t分声部\t本声部人数\t已分配\t应印份数");
    expect(text).toContain("第一小提琴\t小提琴1.pdf\t1\t12\t8\t8");
    expect(text).toContain("总谱\t总谱.pdf\t全部\t0\t—\t1");
    expect(text).toContain("合计\t\t\t\t\t9");
  });
});
