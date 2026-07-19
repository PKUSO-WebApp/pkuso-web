---
name: verify
description: 验证本项目代码改动是否真正可用。完成非平凡改动后、提交前使用。关键背景:本项目 build 不做类型检查,必须手动 tsc;登录后流程依赖 .env.local。
---

# 验证改动

按顺序执行,任何一步失败先修复再继续:

1. **类型检查**(必须——`npm run build` 被配置为跳过类型检查,不能替代这一步):

   ```bash
   npx tsc --noEmit
   ```

2. **Lint**:

   ```bash
   npm run lint
   ```

3. **运行验证**:后台起 dev,实际走一遍受影响的流程:

   ```bash
   npm run dev   # http://localhost:3000
   ```

   - 登录后的页面依赖 `.env.local` 里的 Supabase 配置;缺失时控制台有 `[Supabase] 缺少 ...` 警告
   - 改了 admin / member 侧页面 → 用对应角色分别走一遍
   - 改了 API route(notify、delete-user 等)→ 从触发它的 UI 操作验证,或直接请求接口
   - UI 改动 → 亮/暗色模式都看一眼(项目有统一颜色系统)

不要以 `npm run build` 通过作为"没问题"的依据。
