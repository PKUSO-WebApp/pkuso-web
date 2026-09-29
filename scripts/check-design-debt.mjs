#!/usr/bin/env node
/**
 * 设计债的两个**棘轮**——拦住「god file」与「平铺式、不考虑复用」，且不要求你今天就还清。
 *
 * ## 为什么是棘轮而不是硬阈值
 *
 * 硬阈值（「不许超过 400 行」）在既有一堆 500+ 文件时会**立刻全红**，于是只有两条路：
 * 大重构，或者把阈值调到没意义。两种都不发生 —— 第三种最可能：把这条检查删掉。
 *
 * 棘轮是：**把现状记下来当基线，只许变好不许变坏。** 既有的 god file 可以留着慢慢拆，
 * 但**谁也不能再让它长一行**；新文件一上来超线也直接红。
 *
 * ## 两个棘轮
 *
 * | # | 量什么 | 拦什么 |
 * |---|---|---|
 * | 1 | 单个源文件的行数 | god file 继续长大 / 新 god file |
 * | 2 | 长 `className` 串的**重复次数** | 同一段样式被复制到第 N 处（该抽组件/用原语） |
 *
 * 第 2 条的形态在本仓库实测过：一个输入框的类串被抄了 **23 次**
 * （`w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text …`）。
 *
 * ## 用法
 *
 * ```
 * node scripts/check-design-debt.mjs            # 检查（闸门用的是这个）
 * node scripts/check-design-debt.mjs --update   # 按当前值更新基线，**只许调低**
 * ```
 *
 * `--update` **拒绝把任何一项调高** —— 否则它就成了「红了我跑一下」的橡皮图章，
 * 而棘轮的全部意义就在于它不往上走。要放宽就得改这个文件，那是一次看得见的决定。
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const BASELINE_PATH = "scripts/design-debt-baseline.json";

/** 单文件行数上限：超过就要进基线 */
const LINE_LIMIT = 400;
/** 多长的 className 才算「一段样式」 */
const CLASS_MIN_LEN = 60;
/** 一段样式出现几次才算「该抽出来」 */
const CLASS_MIN_COUNT = 3;

/**
 * 不参与行数统计的文件。
 * ⚠️ 加进来要写清楚为什么 —— 这个清单每多一项，棘轮的覆盖面就少一块。
 */
const SIZE_EXEMPT = [
  { match: /\.test\.tsx?$/, why: "测试文件长通常是好事（用例多），不是 god component" },
  {
    match: /^src\/types\/database\.types\.ts$/,
    why: "由 pkuso-backend 的 CI 生成（`gen types`），手动改会被 type-sync 覆盖",
  },
];

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      walk(p, out);
    } else out.push(relative(ROOT, p).split("\\").join("/"));
  }
  return out;
}

const files = walk(join(ROOT, "src")).filter((f) => /\.tsx?$/.test(f));

// ---- 棘轮 1：文件行数 ----
const sizes = {};
for (const f of files) {
  if (SIZE_EXEMPT.some((e) => e.match.test(f))) continue;
  const n = readFileSync(join(ROOT, f), "utf8").split("\n").length;
  if (n > LINE_LIMIT) sizes[f] = n;
}

// ---- 棘轮 2：重复的 className ----
// 度量取「出现次数之和」，这样把 23 处拆成 5 处，数字会**真的变小**
// —— 若取「多少个串超标」，拆掉一处重复可能一个数都不动。
const counts = new Map();
for (const f of files) {
  if (/\.test\.tsx?$/.test(f)) continue;
  const src = readFileSync(join(ROOT, f), "utf8");
  for (const m of src.matchAll(/className="([^"]+)"/g)) {
    const cls = m[1];
    if (cls.length < CLASS_MIN_LEN) continue;
    counts.set(cls, (counts.get(cls) ?? 0) + 1);
  }
}
const duplicated = [...counts.values()].filter((n) => n >= CLASS_MIN_COUNT);
const classDebt = duplicated.reduce((a, b) => a + b, 0);

const current = { fileLines: sizes, duplicatedClassOccurrences: classDebt };

// ---- 基线 ----
if (process.argv.includes("--update")) {
  const old = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, "utf8")) : null;
  if (old) {
    const raisedFiles = Object.entries(sizes).filter(([f, n]) => (old.fileLines[f] ?? 0) < n);
    const raisedClass = classDebt > old.duplicatedClassOccurrences;
    if (raisedFiles.length || raisedClass) {
      console.error("✗ 拒绝调高基线 —— 棘轮只往好的方向走。");
      if (raisedClass)
        console.error(`    重复 className：${old.duplicatedClassOccurrences} → ${classDebt}`);
      for (const [f, n] of raisedFiles)
        console.error(`    ${f}：${old.fileLines[f] ?? "（基线里没有，=不该新增）"} → ${n}`);
      console.error(
        "  真要放宽，改 scripts/check-design-debt.mjs 里的阈值，那是一次看得见的决定。",
      );
      process.exit(1);
    }
  }
  writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + "\n");
  console.log(
    `✓ 基线已更新（${Object.keys(sizes).length} 个超长文件，重复 className ${classDebt} 次）`,
  );
  process.exit(0);
}

if (!existsSync(BASELINE_PATH)) {
  console.error(`✗ 找不到基线 ${BASELINE_PATH}，先跑一次 --update`);
  process.exit(2);
}
const base = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));

const grew = Object.entries(sizes).filter(([f, n]) => (base.fileLines[f] ?? LINE_LIMIT) < n);
const classGrew = classDebt > base.duplicatedClassOccurrences;
const shrunk = Object.keys(base.fileLines).filter((f) => !(f in sizes));

if (!grew.length && !classGrew && !shrunk.length) {
  console.log(
    `✓ 设计债没有增长（超长文件 ${Object.keys(sizes).length} 个；` +
      `重复 className ${classDebt} 次，基线 ${base.duplicatedClassOccurrences}）`,
  );
  process.exit(0);
}

if (grew.length) {
  console.log("✗ 有文件比基线更长了（god file 只能变短）:");
  for (const [f, n] of grew)
    console.log(
      `    ${f}  ${base.fileLines[f] ? `${base.fileLines[f]} → ` : "新增超长文件，"}${n} 行`,
    );
}
if (classGrew) {
  console.log(
    `✗ 重复的 className 变多了：${base.duplicatedClassOccurrences} → ${classDebt} 次。\n` +
      `    同一段样式出现 ≥${CLASS_MIN_COUNT} 次就该抽出来（或改用 src/components/ui/ 里已有的原语）。\n` +
      `    当前最重复的一段：\n` +
      [...counts.entries()]
        .filter(([, n]) => n >= CLASS_MIN_COUNT)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([c, n]) => `      ${n}× ${c.slice(0, 78)}…`)
        .join("\n"),
  );
}
if (shrunk.length) {
  console.log(
    `💡 有 ${shrunk.length} 个文件已经低于基线了 —— 跑 \`--update\` 把基线收紧：\n` +
      shrunk.map((f) => `    ${f}`).join("\n"),
  );
}
console.log(`\n（跑 \`node scripts/check-design-debt.mjs --update\` 收紧基线；它只许调低。）`);
process.exit(1);
