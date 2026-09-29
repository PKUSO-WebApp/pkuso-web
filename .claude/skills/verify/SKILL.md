---
name: verify
description: 验证本项目代码改动是否真正可用。完成非平凡改动后、提交前使用。关键背景:本项目 build 不做类型检查,必须手动 typecheck;登录后流程依赖 .env.local。
---

# 验证改动

按顺序执行,任何一步失败先修复再继续:

1. **闸门**(**唯一定义是 `scripts/gate.sh`**,CI 调的就是它):

   ```bash
   bash scripts/gate.sh
   ```

   ⚠️ **别在这里复述它的组成** —— 那正是 AGENTS.md 记着的病:CI 里写两步、文档里另抄一份,
   改一处另两处不会跟着变。闸门包含什么、覆盖不到什么,以 `scripts/gate.sh` 的头部注释为准。

   单独跑某一步时用 `pnpm format` / `pnpm lint` / `pnpm typecheck` / `pnpm test`。
   **`pnpm typecheck` 不能省** —— `pnpm build` 被配置为跳过类型检查,替代不了这一步。

2. **运行验证**:后台起 dev,实际走一遍受影响的流程:

   ```bash
   pnpm dev   # http://localhost:3000
   ```

   - 登录后的页面依赖 `.env.local` 里的 Supabase 配置;缺失时控制台有 `[Supabase] 缺少 ...` 警告
   - 全站都是管理员端,用管理员账号走一遍即可(member 端代码已删除,只剩一张引导页)
   - 改了 API route(notify、admin/* 等)→ 从触发它的 UI 操作验证,或直接请求接口
   - UI 改动 → 亮/暗色模式都看一眼(项目有统一颜色系统)

**闸门绿 ≠ 交付。** 它只保证「机器可判定的部分」,第 2 步是它替代不了的。
也别以 `pnpm build` 通过作为"没问题"的依据(build 不含 tsc)。
