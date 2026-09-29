#!/usr/bin/env bash
#
# 交付闸门（**本仓库闸门的唯一定义**）。CI 与人调的都是这一条。
#
#   bash scripts/gate.sh
#
# 组成：
#   pnpm verify  = format → lint → typecheck → test
#   pnpm build   = 生产构建
#
# ⚠️ `pnpm build` 单独跑**替代不了** `pnpm typecheck` —— Next 16 的 build 默认不做
#    tsc 类型检查（CLAUDE.md 的「常用命令」已注明）。两者都跑才算过闸门。
#
# 这不是「少打几个字」的便利命令：闸门的组成散落在 CLAUDE.md / README / ci.yml
# 三处，任一处改了另外两处不会跟着变。收敛成一个文件之后，CI 直接调它，
# 文档只写「闸门 = bash scripts/gate.sh」。
set -euo pipefail

cd "$(dirname "$0")/.."

echo "▶ verify（format → lint → typecheck → test）"
pnpm verify

echo
echo "▶ build（生产构建）"
pnpm build

echo
echo "✓ 闸门全过。"
echo "  注意：闸门只保证「机器可判定的部分」。改动仍需起 pnpm dev 手动走一遍相关流程"
echo "  （见 .claude/skills/verify），UI 改动请亮/暗两种模式都看一眼。"
