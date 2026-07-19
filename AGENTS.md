# AGENTS.md

本文件是 Agent（交付工程师）在本仓库工作时的**唯一核心指导文档**（Source of Truth）。详细背景见 `CLAUDE.md`，可复用操作流程见 `.agents/skills/`。

## 项目概况

北大交响乐团管理系统（PKUSO）。Next.js 16（App Router）+ React 19 + TypeScript（strict）+ Tailwind CSS v4 + Supabase，部署于 Vercel。界面文案、代码注释、提交信息均为中文。

## 常用命令

```bash
pnpm dev          # 开发服务器 http://localhost:3000
pnpm build        # 生产构建（含 tsc 类型检查）
pnpm typecheck    # TypeScript 类型检查
pnpm lint         # ESLint（flat config: eslint.config.mjs）
pnpm format       # Prettier 格式检查
pnpm format:fix   # 自动格式化
pnpm test         # vitest
pnpm verify       # 一键：format → lint → typecheck → test
pnpm gen-types    # 同步 Supabase 类型到 src/types/database.types.ts
```

验证改动 = `pnpm verify` + 起 dev 手动走一遍相关流程（详见 `.agents/skills/verify`）。CI 跑的和 `pnpm verify` 是同一条命令。

## 架构

### 数据层：Supabase

- `src/lib/supabase.ts` —— 浏览器端客户端（anon key，受 RLS 约束）：`import { supabase } from "@/lib/supabase"`
- `src/lib/supabase-server.ts` —— `createServerSupabase()`，用 service role key，**绕过 RLS，只允许在 API route 中用于管理员操作**
- 邮件通知走 Resend（notify API route）

### 环境变量（`.env.local`，不入库）

- `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`（仅服务端）
- `RESEND_API_KEY`

### 认证

全局用户状态在 `src/context/user-context.tsx`；页面访问由 `auth-gate` 组件把关；登录/注册页在 `src/app/(auth)/`。

## 六阶段工作流（强制执行）

每个需求严格按顺序执行，**禁止跳步**：

| 阶段 | 动作                                                                                        | 完成信号                       |
| ---- | ------------------------------------------------------------------------------------------- | ------------------------------ |
| 1    | 解析需求 → 查重 → 创建 Issue                                                                | `Issue #<n> 已创建`            |
| 2    | `git checkout main && git pull && git checkout -b <type>/<issue>-<slug>`                    | `分支 <name> 已创建`           |
| 3    | 实现 + 测试 + `pnpm verify`                                                                 | `已完成实现，测试通过（n 个）` |
| 4    | `git add -A && git commit -m "<type>(<scope>): <subject>` + `Closes #<issue>"` + `git push` | `分支已推送，commit <hash>`    |
| 5    | `gh pr create`                                                                              | `PR #<n> 已创建`               |
| 6    | 等待 CI 全绿 → `gh pr merge --squash --delete-branch`                                       | `PR #<n> 已 Squash Merge`      |

**关键规则：**

- 分支命名：`<type>/<issue>-<slug>`，type = `feat|fix|docs|refactor|test|chore|build|ci`（CI 强制校验）
- 提交遵循 Conventional Commits（commitlint 强制，type 白名单：`build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test`）
- PR 用 Squash & merge，提交信息必须含 `Closes #<issue>`
- CI 自动验证：`verify`（format+lint+typecheck+test+build）、`gen-types-check`、`branch-name`

## 前端设计原则

- **Token 优先**：`src/styles/tokens.css` 为设计令牌单一可信源。所有颜色通过 Tailwind 语义类使用（`bg-primary`/`text-text`/`border-border` 等），**禁止硬编码 `zinc-*`**。16 对语义色覆盖亮/暗双模式。
- **移动端优先**：页面宽 `max-w-md`（448px），Modal 默认底部弹出（`position="bottom"`），底部安全区 `pb-safe`。
- **组件复用**：写新 UI 前先查 `src/components/ui/`（Modal/Toggle/Card）和 `src/app/<route>/components/`。Button 暂不统一（20+ 变体，待设计系统定型）。
- **暗色模式**：`<html data-theme="dark">` 即可全局切换，所有组件应双模式可用。测试时亮/暗都过一遍。

### 颜色语义表

| 用途           | 类名                                        | 亮色                          | 暗色                          |
| -------------- | ------------------------------------------- | ----------------------------- | ----------------------------- |
| 主按钮/强调    | `bg-primary text-primary-foreground`        | zinc-900/white                | zinc-100/zinc-900             |
| 页背景         | `bg-page-bg`                                | zinc-100                      | zinc-950                      |
| 卡片           | `bg-card border-border`                     | zinc-50/zinc-200              | zinc-900/zinc-800             |
| 正文           | `text-text`                                 | zinc-900                      | zinc-100                      |
| 辅助文字       | `text-text-muted`                           | zinc-500                      | zinc-400                      |
| 危险/成功/警告 | `text-danger`/`text-success`/`text-warning` | red-600/emerald-600/amber-600 | red-400/emerald-400/amber-400 |

## 文件命名规范

| 类型                                | 规范                                         | 示例                                  |
| ----------------------------------- | -------------------------------------------- | ------------------------------------- |
| UI 原语组件（`src/components/ui/`） | PascalCase                                   | `Card.tsx`、`Modal.tsx`、`Toggle.tsx` |
| 其他 React 组件                     | kebab-case                                   | `auth-gate.tsx`、`rehearsal-card.tsx` |
| Hooks（`src/hooks/`）               | camelCase + `use` 前缀                       | `useAuth.ts`、`useRehearsals.ts`      |
| 工具/类型/常量                      | kebab-case                                   | `database.ts`、`instruments.ts`       |
| Next.js 路由文件                    | 不变（`page.tsx`、`layout.tsx`、`route.ts`） | —                                     |
| Context                             | kebab-case                                   | `user-context.tsx`                    |
| 测试                                | 文件名 + `.test.ts(x)`                       | `notify.test.ts`、`Card.test.tsx`     |

## 测试基础设施

- **环境变量加载**：vitest 默认不加载 `.env.local`。`vitest.config.ts` 中 `setupFiles: ["./src/__tests__/vitest-setup.ts"]` 手动解析注入 `process.env`。CI 通过 GitHub Actions secrets 注入相同变量。
- **Mailpit**：SMTP 测试用 Mailpit 替代 Ethereal（Ethereal 公网 SMTP 在北大校园网超时）。
  - 本地：`docker run -d --name mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit`
  - CI：`.github/workflows/ci.yml` 中 `services.mailpit` container
  - SMTP: `localhost:1025` 无认证；API: `http://localhost:8025/api/v1/messages` 验证
  - 测试通过 `process.env.CI` 或 `MAILPIT_ENABLED` 判断启用
- **端到端 notify 测试**（`src/__tests__/notify.test.ts`）：需 `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`，缺则跳过。

## 数据库操作注意事项

### text → enum 迁移

改列类型前必须在同一事务中：

1. `DROP CONSTRAINT` 删除 CHECK 约束
2. 删除所有引用该列的 RLS 策略（含其他表子查询引用）
3. `ALTER COLUMN SET DATA TYPE "enumType" USING col::"enumType"`
4. 重建策略时显式转型：`col = 'val'::"enumType"`（不能省）

### gen-types

`pnpm gen-types` 需 Supabase CLI 已 link。CI 通过 `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF` secrets 动态 link。worktree 中 link 不继承，可用 MCP `generate_typescript_types` 替代。

## 经验沉淀机制

| 经验性质                         | 去处                             |
| -------------------------------- | -------------------------------- |
| 项目级事实、约定、陷阱           | 本文件（AGENTS.md）对应小节      |
| 可复用的多步操作流程             | `.agents/skills/<名字>/SKILL.md` |
| 用户偏好、决策背景、时效性上下文 | Agent 持久 memory                |
| git 历史 / 代码本身已能查到的    | 不存，避免重复                   |

会话结束前可用 `.agents/skills/save-lesson` 的流程做沉淀。新 skill 的 frontmatter `description` 必须写清触发时机（"当…时使用"），否则不会被调用。

## 常见坑与经验总结

### 文档迁移经验（2026-07-20）

- **文件名选择**：IDE 对复数形式文件名（如 `AGENTS.md`）支持更好，单数字符文件可能被忽略。
- **引用更新**：重命名后必须全局搜索更新所有引用，否则链接断裂。
- **git 操作**：`git mv` 保留文件历史，优于删除重建。
- **格式问题**：`pnpm format:fix` 可自动修复 prettier 风格问题，但修复后 Edit 工具无法匹配原字符串，需重新读取文件。
- **PowerShell 引号**：多行字符串用 here-string（`@"..."@`）或多个 `-m` 参数，避免单引号嵌套问题。

### 技术坑

- **Supabase trigger 自动建 profile**：`createUser` 后 trigger 已插 profile，代码里用 `.upsert()` 不用 `.insert()`
- **sed 改代码**：prettier 格式化后 Edit 工具无法匹配原字符串，始终用 Edit/Write
- **draft PR**：需先 `gh pr ready` 再 merge
- **commitlint type 白名单**：仅 `build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test`
- **Windows 开发环境**：仓库内为 LF，git 输出 CRLF 转换警告属正常，不要为此改动文件
- **`.trae/specs/`**（本地目录，已 gitignore）存有历代功能 spec。做相关模块改动前值得先翻阅对应 spec

### CI 经验

- CI 三个 job：`verify`（format+lint+typecheck+test+build）、`gen-types-check`、`branch-name`
- `branch-name` job 强制分支名匹配 `^(feat|fix|docs|refactor|test|chore|build|ci|style)/`
- CI 失败后分析原因，修复后 `git commit --amend` + `git push --force` 重新触发
