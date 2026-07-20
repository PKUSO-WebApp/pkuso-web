# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概况

北大交响乐团管理系统(PKUSO)。Next.js 16(App Router)+ React 19 + TypeScript(strict)+ Tailwind CSS v4 + Supabase,部署于 Vercel。界面文案、代码注释、提交信息均为中文。

## 常用命令

```bash
pnpm dev          # 开发服务器 http://localhost:3000
pnpm build        # 生产构建(含 tsc 类型检查)
pnpm typecheck    # TypeScript 类型检查
pnpm lint         # ESLint(flat config:eslint.config.mjs)
pnpm format       # Prettier 格式检查
pnpm format:fix   # 自动格式化
pnpm test         # vitest
pnpm verify       # 一键:format → lint → typecheck → test
```

验证改动 = `pnpm verify` + 起 dev 手动走一遍相关流程(详见 `.claude/skills/verify`)。CI 跑的和 `pnpm verify` 是同一条命令。

## 架构(跨分支稳定部分)

### 数据层:Supabase

- `src/lib/supabase.ts` —— 浏览器端客户端(anon key,受 RLS 约束):`import { supabase } from "@/lib/supabase"`
- `src/lib/supabase-server.ts` —— `createServerSupabase()`,用 service role key,**绕过 RLS,只允许在 API route 中用于管理员操作**
- 邮件通知走 Resend(notify API route)

### 环境变量(`.env.local`,不入库)

- `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`(仅服务端)
- `RESEND_API_KEY`

### 认证

全局用户状态在 `src/context/user-context.tsx`;页面访问由 auth-gate 组件把关;登录/注册页在 `src/app/(auth)/`。

## 分支工作流

- 分支命名: `<type>/<简述>`,type = feat|fix|docs|refactor|test|chore|build|ci
- 每个 PR 从 main 切新分支,合并后删分支。禁止在原分支上继续追加。
- 提交遵循 Conventional Commits(commitlint 强制)。PR 用 Squash & merge。
- CI 自动验证 typecheck + lint + test + build + gen-types 一致性 + 分支命名规范。

## 重构路线

渐进式多分支重构,目录结构文档待重构定型后补充。

## 前端设计原则

- **Token 优先**: `src/styles/tokens.css` 为设计令牌单一可信源。所有颜色通过 Tailwind 语义类使用(`bg-primary`/`text-text`/`border-border` 等),**禁止硬编码 `zinc-*`**。16 对语义色覆盖亮/暗双模式。
- **移动端优先**: 页面宽 `max-w-md`(448px),Modal 默认底部弹出(`position="bottom"`),底部安全区 `pb-safe`。
- **组件复用**: 写新 UI 前先查 `src/components/ui/`(Modal/Toggle/Card)和 `src/app/schedule/components/`(排练相关组件)。Button 暂不统一(20+ 变体,待设计系统定型)。
- **暗色模式**: `<html data-theme="dark">` 即可全局切换,所有组件应双模式可用。测试时亮/暗都过一遍。
- **颜色语义表**:

| 用途           | 类名                                        | 亮色                          | 暗色                          |
| -------------- | ------------------------------------------- | ----------------------------- | ----------------------------- |
| 主按钮/强调    | `bg-primary text-primary-foreground`        | zinc-900/white                | zinc-100/zinc-900             |
| 页背景         | `bg-page-bg`                                | zinc-100                      | zinc-950                      |
| 卡片           | `bg-card border-border`                     | zinc-50/zinc-200              | zinc-900/zinc-800             |
| 正文           | `text-text`                                 | zinc-900                      | zinc-100                      |
| 辅助文字       | `text-text-muted`                           | zinc-500                      | zinc-400                      |
| 危险/成功/警告 | `text-danger`/`text-success`/`text-warning` | red-600/emerald-600/amber-600 | red-400/emerald-400/amber-400 |

## 文件命名规范

| 类型                               | 规范                                        | 示例                                                        |
| ---------------------------------- | ------------------------------------------- | ----------------------------------------------------------- |
| UI 原语组件 (`src/components/ui/`) | PascalCase                                  | `Card.tsx`, `Modal.tsx`, `Toggle.tsx`                       |
| 其他 React 组件                    | kebab-case                                  | `auth-gate.tsx`, `error-boundary.tsx`, `rehearsal-card.tsx` |
| Hooks (`src/hooks/`)               | camelCase + `use` 前缀                      | `useAuth.ts`, `useRehearsals.ts`                            |
| 工具/类型/常量                     | kebab-case                                  | `database.ts`, `instruments.ts`, `supabase-server.ts`       |
| Next.js 路由文件                   | 不变 (`page.tsx`, `layout.tsx`, `route.ts`) | —                                                           |
| Context                            | kebab-case                                  | `user-context.tsx`                                          |
| 测试                               | 文件名 + `.test.ts(x)`                      | `notify.test.ts`, `Card.test.tsx`                           |

## 其他约定

- Windows 开发环境;仓库内为 LF,git 输出 CRLF 转换警告属正常,不要为此改动文件。
- **Windows 编码注意事项**:
  - PowerShell 默认编码可能不是 UTF-8(尤其是 PowerShell 5.1)。写文件、读文件、管道传递中文时务必显式指定 `UTF8` 编码,避免乱码。
  - 仓库内文件统一保存为 **UTF-8 无 BOM**。不要让编辑器自动加 BOM,否则 prettier / ESLint 可能误报。
  - git 已配置 `core.autocrlf` 时,本地 checkout 可能是 CRLF,提交回库时会自动转回 LF。不要手动改行尾。
  - PowerShell here-string(`@"..."@`)在多行中文场景下更可靠,优于多个 `-m` 拼接 commit message。
- 历代功能 spec(颜色系统、admin/member 拆分、hooks-modal 重构、排练房预订等)已迁移至项目 wiki。
- 经验沉淀机制:项目级约定写进本文件;可复用操作流程写成 `.claude/skills/<名字>/SKILL.md`;会话中的偏好与决策背景由 Claude 记入其持久 memory。会话结束前可用 `.claude/skills/save-lesson` 的流程做沉淀。

## 测试基础设施

### 环境变量加载

vitest 默认不加载 `.env.local`。`vitest.config.ts` 中 `setupFiles: ["./src/__tests__/vitest-setup.ts"]` 手动解析注入 `process.env`。CI 通过 GitHub Actions secrets 注入相同变量。

### Mailpit（本地 + CI SMTP 测试）

SMTP 测试用 Mailpit 替代 Ethereal（Ethereal 公网 SMTP 在北大校园网超时）。

- **本地**：`docker run -d --name mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit`
- **CI**：`.github/workflows/ci.yml` 中 `services.mailpit` container
- SMTP: `localhost:1025` 无认证；API: `http://localhost:8025/api/v1/messages` 验证
- 测试通过 `process.env.CI` 或 `MAILPIT_ENABLED` 判断启用

### 端到端 notify 测试

`src/__tests__/notify.test.ts`：

- `e()` 转义 + `resolveTransporter()` 配置选择（9 个单测）
- Mailpit SMTP 直连（1 个）
- **端到端**（1 个）：临时 admin → POST /api/notify → Mailpit API 验证 → 清理

需 `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`，缺则跳过。

## 数据库操作注意事项

### text → enum 迁移

改列类型前必须在同一事务中：

1. `DROP CONSTRAINT` 删除 CHECK 约束
2. 删除所有引用该列的 RLS 策略（含其他表子查询引用）
3. `ALTER COLUMN SET DATA TYPE "enumType" USING col::"enumType"`
4. 重建策略时显式转型：`col = 'val'::"enumType"`（不能省）

### gen-types

`pnpm gen-types` 需 Supabase CLI 已 link。CI 通过 `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF` secrets 动态 link。

## 交付流程

功能开发走 **Issue → 分支 → 实现+测试 → PR → CI → Squash Merge**。Conventional Commits 含 `Closes #<issue>`。

常见坑：

- **sed 改代码后 prettier 格式错乱**：始终用 Edit/Write 工具
- **commitlint type 白名单**：仅 `build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test`
- **draft PR 不能 merge**：需 `gh pr ready` 后再 `gh pr merge --squash`
