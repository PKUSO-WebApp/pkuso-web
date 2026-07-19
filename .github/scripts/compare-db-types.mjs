// 对比两份 Supabase gen-types 输出:提取表/视图的列名结构,忽略格式差异
import { readFileSync } from "node:fs";

const [a, b] = process.argv.slice(2).map((f) => readFileSync(f, "utf8"));

/** 剥离注释和空白,提取所有对象字面量 */
function extractTableColumns(s) {
  const result = {};

  // 匹配形如 TableName: { ... Row: { field1: type1, field2: type2 } ... }
  // 先找到所有 Row: 块,用平衡括号跟踪关闭位置
  const rowBlocks = [];
  const rowRe = /(\w+):\s*\{[^}]*Row:\s*\{/g;
  let rm;
  while ((rm = rowRe.exec(s))) {
    const tableName = rm[1];
    const start = rm.index + rm[0].length;
    // 从 Row: { 之后的第一列开始,跟踪括号深度找到匹配的 }
    let depth = 1;
    let end = start;
    while (depth > 0 && end < s.length) {
      if (s[end] === "{") depth++;
      else if (s[end] === "}") depth--;
      end++;
    }
    const body = s.slice(start, end - 1);
    rowBlocks.push({ tableName, body });
  }

  for (const { tableName, body } of rowBlocks) {
    const cols = [];
    // 匹配 field?: type 或 field: type
    for (const cm of body.matchAll(/^\s*(\w+)\??:\s*(.+)/gm)) {
      cols.push(cm[1]);
    }
    if (cols.length > 0 && tableName !== "Relationships") {
      result[tableName] = cols.sort();
    }
  }
  return result;
}

const aSchema = extractTableColumns(a);
const bSchema = extractTableColumns(b);
const aKeys = Object.keys(aSchema).sort();
const bKeys = Object.keys(bSchema).sort();

if (JSON.stringify(aKeys) !== JSON.stringify(bKeys)) {
  console.error("::error::表/视图列表不一致");
  console.error(`  提交: ${aKeys.join(", ") || "(空)"}`);
  console.error(`  远端: ${bKeys.join(", ") || "(空)"}`);
  process.exit(1);
}

let ok = true;
for (const table of aKeys) {
  const aCols = aSchema[table] || [];
  const bCols = bSchema[table] || [];
  if (JSON.stringify(aCols) !== JSON.stringify(bCols)) {
    console.error(`::error::${table} 表的列不一致`);
    console.error(`  提交: ${aCols.join(", ")}`);
    console.error(`  远端: ${bCols.join(", ")}`);
    ok = false;
  }
}

if (!ok) {
  console.error("\n请本地运行: pnpm gen-types");
  process.exit(1);
}

console.log(
  `✅ database.types.ts 与 Supabase schema 一致 (${aKeys.length} 表/视图: ${aKeys.join(", ")})`,
);
