import { sortPartsForDisplay } from "./sort-parts";

/**
 * 印制清单（P7b）的纯逻辑：分组、文件名、清单文本。
 *
 * 后端的 `get_score_print_plan` 返回每个文件的
 * 本声部人数 / 已分配人数 / 自动-手动-最终份数；这里只做展示与导出需要的整理。
 */

export type PrintPlanKind = "score" | "percussion" | "part";

export interface PrintPlanRow {
  file_id: string;
  part_id: string;
  section: string;
  file_name: string;
  storage_path: string;
  file_size: number | null;
  sub_parts: number[];
  section_members: number;
  /** 总谱 / 打击乐没有「已分配」概念 */
  assigned_members: number | null;
  auto_copies: number;
  manual_copies: number | null;
  copies: number;
  kind: PrintPlanKind;
}

export interface PrintPlanGroup {
  section: string;
  kind: PrintPlanKind;
  sectionMembers: number;
  rows: PrintPlanRow[];
}

/**
 * 按声部分组，并沿用曲子详情页的排序（总谱最前 / 乐器顺序 / 分声部号）。
 * 不修改入参。
 */
export function groupPrintPlan(rows: PrintPlanRow[]): PrintPlanGroup[] {
  const bySection = new Map<string, PrintPlanRow[]>();
  for (const row of rows) {
    const list = bySection.get(row.section);
    if (list) list.push(row);
    else bySection.set(row.section, [row]);
  }

  const parts = [...bySection.entries()].map(([section, sectionRows]) => ({
    section,
    // sortPartsForDisplay 只读 instrument / sub_parts；其余字段原样带过去
    files: sectionRows.map((row) => ({ ...row, instrument: row.section })),
  }));

  return sortPartsForDisplay(parts).map((part) => ({
    section: part.section,
    kind: part.files[0]?.kind ?? "part",
    sectionMembers: part.files[0]?.section_members ?? 0,
    rows: part.files,
  }));
}

export function summarizePrintPlan(rows: PrintPlanRow[]): {
  fileCount: number;
  totalCopies: number;
} {
  let fileCount = 0;
  let totalCopies = 0;
  for (const row of rows) {
    totalCopies += row.copies;
    if (row.copies > 0) fileCount += 1;
  }
  return { fileCount, totalCopies };
}

/** zip 里的文件名：`{份数}份_{原文件名}.pdf`，与 example-data 的命名一致 */
export function printFileName(copies: number, fileName: string): string {
  const stem =
    sanitizeName(fileName)
      .replace(/\.pdf$/i, "")
      .trim() || "score";
  return `${Math.max(0, Math.floor(copies))}份_${stem}.pdf`;
}

/** 同名文件在同一个 zip 里必须能共存：`x.pdf`、`x_2.pdf`… */
export function uniquePrintName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const stem = name.replace(/\.pdf$/i, "");
  let i = 2;
  while (used.has(`${stem}_${i}.pdf`)) i += 1;
  const next = `${stem}_${i}.pdf`;
  used.add(next);
  return next;
}

/**
 * 可选的 `清单.txt`：给谱务/打印店看的一页纸。
 * 用 tab 分隔，Excel 直接打开也是对的列。
 */
export function buildManifest(scoreTitle: string, rows: PrintPlanRow[]): string {
  const lines = [
    `曲名：${scoreTitle}`,
    "",
    ["声部", "文件", "分声部", "本声部人数", "已分配", "应印份数"].join("\t"),
  ];
  for (const row of rows) {
    lines.push(
      [
        row.section,
        row.file_name,
        row.sub_parts.length > 0 ? row.sub_parts.join(",") : "全部",
        String(row.section_members),
        row.assigned_members == null ? "—" : String(row.assigned_members),
        String(row.copies),
      ].join("\t"),
    );
  }
  const total = rows.reduce((sum, row) => sum + row.copies, 0);
  lines.push(["合计", "", "", "", "", String(total)].join("\t"));
  return lines.join("\n");
}

/** 文件名里不能出现的字符（与 mp 的 sanitizeName 同一套） */
function sanitizeName(s: string): string {
  return s
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
