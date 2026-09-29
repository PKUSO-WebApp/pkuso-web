#!/usr/bin/env bash
#
# 交付闸门（**本仓库闸门的唯一定义**）。CI 与人调的都是这一条。
#
#   bash scripts/gate.sh              完整闸门
#   bash scripts/gate.sh --no-build   只跑 format → lint → typecheck → test
#
# 组成：
#   pnpm verify  = format → lint → typecheck → test
#   pnpm build   = 生产构建
#
# ⚠️ `pnpm build` 单独跑**替代不了** `pnpm typecheck` —— Next 16 的 build 默认不做
#    tsc 类型检查（CLAUDE.md 的「常用命令」已注明）。两者都跑才算过闸门。
#
# ⚠️ **`--no-build` 是给 Dependabot 的 PR 用的，不要在别处用它。**
#    理由：GitHub **不把仓库 secrets 提供给 Dependabot 触发的 workflow**（官方行为，
#    要用独立的一套 Dependabot secrets）。而 build 会预渲染页面，其中
#    `src/lib/supabase.ts` 在**模块作用域**就 `createClient(...)`，缺
#    `NEXT_PUBLIC_SUPABASE_URL` 时会抛 `supabaseUrl is required.`（见下方注释）。
#    于是 Dependabot 的 PR 上 build 必然失败 —— 而这跟被升的那个依赖毫无关系。
#    `pnpm verify` 那半不需要 secret（测试都 mock 掉了 supabase），所以照跑。
#
# 这不是「少打几个字」的便利命令：闸门的组成散落在 CLAUDE.md / README / ci.yml
# 三处，任一处改了另外两处不会跟着变。收敛成一个文件之后，CI 直接调它，
# 文档只写「闸门 = bash scripts/gate.sh」。
set -euo pipefail

cd "$(dirname "$0")/.."

SKIP_BUILD=0
if [ "${1:-}" = "--no-build" ]; then
  SKIP_BUILD=1
fi

echo "▶ verify（format → lint → typecheck → test）"
pnpm verify

if [ "$SKIP_BUILD" = "0" ]; then
  echo
  echo "▶ build（生产构建）"
  pnpm build
else
  echo
  echo "⏭  跳过 build（--no-build）"
fi

echo
echo "✓ 闸门全过。"
echo "  注意：闸门只保证「机器可判定的部分」。改动仍需起 pnpm dev 手动走一遍相关流程"
echo "  （见 .claude/skills/verify），UI 改动请亮/暗两种模式都看一眼。"

