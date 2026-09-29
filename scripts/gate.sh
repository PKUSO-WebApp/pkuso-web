#!/usr/bin/env bash
#
# 交付闸门（**本仓库闸门的唯一定义**）。CI 与人调的都是这一条。
#
#   bash scripts/gate.sh
#
# 组成：
#   node scripts/sync-skills.mjs --check   = 两套 skill 目录是否一致（瞬时）
#   pnpm verify  = format → lint → typecheck → test
#   pnpm build   = 生产构建
#
# 为什么 skill 同步也算闸门的一部分：`.agents/skills/` 是真源、`.claude/skills/`
# 是生成出来的适配层，而**Claude Code 只读后者**。真源改了忘了同步 ⇒ 适配层是旧的，
# 而它不报错、只是 agent 照着过期的说明干活（2026-09-30 实测：`supabase` 那份
# 只存在于真源，Claude Code 完全看不到它）。详见 `scripts/sync-skills.mjs` 的注释。
#
# ⚠️ `pnpm build` 单独跑**替代不了** `pnpm typecheck` —— Next 16 的 build 默认不做
#    tsc 类型检查（CLAUDE.md 的「常用命令」已注明）。两者都跑才算过闸门。
#
# ⚠️ **闸门不需要任何环境变量**（2026-09-29 起）。构建会预渲染页面，而
#    `src/lib/supabase.ts` 过去在模块作用域就 createClient、缺 env 即抛，
#    逼得 CI 必须给它传 NEXT_PUBLIC_SUPABASE_*；那个模块现在缺 env 时返回
#    「取用才抛」的替身，构建因而不再依赖 env。**别把它改回去** ——
#    那会同时让 Dependabot 的 PR（拿不到 secrets）与任何干净环境上的构建失败。
#
# 这不是「少打几个字」的便利命令：闸门的组成散落在 CLAUDE.md / README / ci.yml
# 三处，任一处改了另外两处不会跟着变。收敛成一个文件之后，CI 直接调它，
# 文档只写「闸门 = bash scripts/gate.sh」。
set -euo pipefail

cd "$(dirname "$0")/.."

echo "▶ skill 同步（.agents/skills → .claude/skills）"
node scripts/sync-skills.mjs --check

echo
echo "▶ verify（format → lint → typecheck → test）"
pnpm verify

echo
echo "▶ build（生产构建）"
pnpm build

echo
echo "✓ 闸门全过。"
echo "  注意：闸门只保证「机器可判定的部分」。改动仍需起 pnpm dev 手动走一遍相关流程"
echo "  （见 .claude/skills/verify），UI 改动请亮/暗两种模式都看一眼。"

