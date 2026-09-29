#!/usr/bin/env node
/**
 * 把 `.agents/skills/`（**真源**）镜像到 `.claude/skills/`（**适配层**）。
 *
 * ## 为什么要这东西
 *
 * 这个仓库里有两套 skill 目录，而它们是**两类不同的东西混在一起**：
 *
 * | | `.agents/skills/` | `.claude/skills/` |
 * | --- | --- | --- |
 * | 谁读它 | `npx skills add` 这类工具的约定位置（harness 中立） | **Claude Code 只读这个** |
 * | 2026-09-30 实测 | 从 `pkuso-web` 起全新 Claude Code 会话**看不到**它 | 看得到 |
 *
 * 实测证据：`supabase` 当时只存在于 `.agents/skills/`，而全新会话列出的 skill 里
 * **没有它** —— 也就是说那份 Supabase 开发/安全指南，Claude Code 用户等于没有。
 * 同时 `verify` / `mailpit` / `README.md` 三份**各自漂移**了（`.claude/` 那份更新）。
 *
 * 方向照 `AGENTS.md` 的既有决策（真源放中立位置、`.claude/` 只做适配层）——
 * 同一条原则也用在类型定义上（`database.types.ts` 由 CI 生成）。
 *
 * ## 为什么是复制而不是软链
 *
 * 试过：这台 Windows 上 `ln -s` **静默退化成复制**（建出来是真目录）。而静默退化
 * 比不用软链更糟 —— 某些环境链接、某些环境复制，漂移又回来了。
 *
 * ## 用法
 *
 * ```
 * node scripts/sync-skills.mjs            # 写入：补上缺失 / 更新过期的
 * node scripts/sync-skills.mjs --check     # 只报告不改（闸门用的是这个）
 * ```
 *
 * ## 它**不**自动删除
 *
 * 适配层里有真源没有的东西时，它**只报告、不删**。理由：那有两种可能 ——
 * ① 新装的 skill 装错了地方（该移进真源）② 是残留（该删）。脚本分不出，
 * 而「自动删掉刚装进来的东西」是最不该由脚本做的决定。`--check` 会红，逼人去看。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = ".agents/skills";
const DST = ".claude/skills";
const checkOnly = process.argv.includes("--check");

/** 把一个目录读成 `相对路径 → 内容` 的 Map（不跟软链，避免环） */
function snapshot(dir, base = dir, out = new Map()) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) snapshot(full, base, out);
    else if (entry.isFile()) {
      out.set(relative(base, full).split("\\").join("/"), readFileSync(full));
    }
  }
  return out;
}

if (!existsSync(SRC)) {
  console.error(`✗ 找不到真源目录 ${SRC}`);
  process.exit(2);
}
// 防夹具空转：真源空的时候别当作「全部对上」
const src = snapshot(SRC);
if (src.size === 0) {
  console.error(`✗ ${SRC} 是空的 —— 不做任何事（否则会把适配层误判成「全部多余」）`);
  process.exit(2);
}
const dst = existsSync(DST) ? snapshot(DST) : new Map();

const missing = [...src.keys()].filter((k) => !dst.has(k));
const stale = [...src.keys()].filter((k) => dst.has(k) && !src.get(k).equals(dst.get(k)));
const extra = [...dst.keys()].filter((k) => !src.has(k));

const report = (label, list) => {
  if (list.length)
    console.log(`${label}（${list.length}）:\n` + list.map((k) => `    ${k}`).join("\n"));
};
report("缺失（真源有、适配层没有）", missing);
report("过期（两边都有但内容不同）", stale);
report("多余（适配层有、真源没有 —— 脚本**不删**，请自己判断该移进真源还是该删）", extra);

const dirty = missing.length + stale.length + extra.length;

if (dirty === 0) {
  console.log(`✓ skill 已同步（真源 ${src.size} 个文件）`);
  process.exit(0);
}

if (checkOnly) {
  console.log(
    `\n✗ 两套 skill 不一致（共 ${dirty} 处）。` +
      `\n  跑 \`node scripts/sync-skills.mjs\` 补上缺失与过期的；` +
      `「多余」那些要你自己决定。`,
  );
  process.exit(1);
}

for (const key of [...missing, ...stale]) {
  const target = join(DST, key);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, src.get(key));
}
console.log(`✓ 已同步 ${missing.length + stale.length} 个文件到 ${DST}`);

if (extra.length) {
  console.log(`⚠️ 仍有 ${extra.length} 个「多余」未处理 —— 脚本不替你决定删不删。`);
  process.exit(1);
}
