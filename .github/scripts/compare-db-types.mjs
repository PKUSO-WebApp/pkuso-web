// 对比两份 Supabase gen-types 输出,忽略格式差异,只检查表列结构一致性
import { readFileSync } from "node:fs";

const [a, b] = process.argv.slice(2).map((f) => readFileSync(f, "utf8"));

function extract(s) {
  const result = {};
  // 匹配 Row 块中的字段: 字段名: 类型
  const tableRe = /(\w+):\s*\{[^}]*Row:\s*\{([^}]*)\}/gs;
  let m;
  while ((m = tableRe.exec(s))) {
    const name = m[1];
    const body = m[2];
    const cols = {};
    for (const cm of body.matchAll(/(\w+)\??:\s*(.+?)(?:,|\n)/g)) {
      cols[cm[1]] = cm[2].trim().replace(/\s+/g, " ");
    }
    result[name] = Object.keys(cols).sort();
  }
  // 也收集 Views
  const viewRe = /Views:\s*\{(.*?)\}\s*,?\s*(?:Functions|Enums)/gs;
  let vm;
  while ((vm = viewRe.exec(s))) {
    const inner = vm[1];
    for (const tm of inner.matchAll(/(\w+):\s*\{[^}]*Row:\s*\{([^}]*)\}/gs)) {
      const name = tm[1];
      const body = tm[2];
      const cols = {};
      for (const cm of body.matchAll(/(\w+)\??:\s*(.+?)(?:,|\n)/g)) {
        cols[cm[1]] = cm[2].trim().replace(/\s+/g, " ");
      }
      result[name] = Object.keys(cols).sort();
    }
  }
  return result;
}

const aSchema = extract(a);
const bSchema = extract(b);

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

console.log(`✅ database.types.ts 与 Supabase schema 一致 (${aKeys.length} 表/视图)`);
