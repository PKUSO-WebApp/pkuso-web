# PKUSO 快速开发工作流程（Agent 版）

## 前置能力要求

| 能力                       | 用途                                                    |
| -------------------------- | ------------------------------------------------------- |
| GitHub CLI (`gh`)          | Issue/PR 管理                                           |
| Git                        | 分支、提交、推送                                        |
| Supabase MCP               | 数据库 schema 变更（`apply_migration` / `execute_sql`） |
| Vitest                     | 测试编写与运行                                          |
| Next.js App Router 知识    | 路由、API route、服务端/客户端组件                      |
| TypeScript                 | 类型安全                                                |
| Tailwind CSS v4 + 设计令牌 | UI 开发                                                 |
| pnpm                       | 包管理                                                  |

## 六阶段工作流

每个需求严格按顺序执行：

### 🔖 阶段 1：需求澄清与 Issue 创建

1. 解析需求，有不明确处立即向用户提问
2. 识别类型：`feat` / `fix` / `refactor` / `docs` / `test`
3. 查重：`gh issue list --repo PKUSO-WebApp/pkuso-web --search "关键词"`
4. 按 Issue Template 创建：`gh issue create --repo PKUSO-WebApp/pkuso-web --title "..." --body "..."`
5. 记录 Issue Number

### 🌿 阶段 2：创建分支

```bash
git checkout main && git pull origin main
git checkout -b <type>/<issue>-<slug>
```

分支名必匹配 `^(feat|fix|docs|refactor|test|chore|build|ci|style)/`（CI 强制）。

### 💻 阶段 3：实现 + 测试

**实现原则：**

- 页面：`src/app/<route>/page.tsx`，专属组件放 `src/app/<route>/components/`
- 跨路由共享组件：`src/components/`
- UI 原语：`src/components/ui/`（Card, Modal, Toast, Toggle）
- 数据访问：通过 `src/hooks/use*.ts`，组件不直接 import Supabase
- 颜色：用语义类（`bg-primary`，`text-text`），**禁止 `zinc-*`**
- 文件命名：按 CLAUDE.md 规范表

**测试：**

- 工具函数 → vitest 单元测试
- SMTP → Mailpit 集成测试（`localhost:1025`）
- 非纯文档需求至少含 1 个测试用例

**本地验证：**

```bash
pnpm verify        # format → lint → typecheck → test
pnpm build         # 确认生产构建（需要 .env.local）
```

### 📦 阶段 4：提交

```bash
git add -A
git commit -m "<type>(<scope>): <subject>

<body>
Closes #<issue>"
```

- Conventional Commits（commitlint 强制，白名单：`build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test`）
- commit message 必须含 `Closes #<issue>`
- **禁止**用 sed 修改文件后用 Edit 工具（格式错乱后无法匹配）

### 🔀 阶段 5：创建 PR

```bash
git push -u origin <branch>
gh pr create --repo PKUSO-WebApp/pkuso-web --title "..." --body "..." --base main --head <branch>
```

### ✅ 阶段 6：CI 通过 → Squash Merge

```bash
gh pr checks <pr-number> --repo PKUSO-WebApp/pkuso-web   # 等全绿
gh pr merge <pr-number> --repo PKUSO-WebApp/pkuso-web --squash --delete-branch
```

CI 三个 job：`verify`（format+lint+typecheck+test+build）、`gen-types-check`、`branch-name`。

---

## 项目特定知识

### 技术栈

Next.js 16 (App Router) + React 19 + TypeScript strict + Tailwind CSS v4 + Supabase + vitest

### 数据库

- 5 张表（profiles / rehearsals / attendances / announcements / posts），全部 RLS 启用
- 4 个 enum 类型（profileStatus / profileRole / postType / attendanceStatus）
- `pnpm gen-types` 同步生成 `database.types.ts`（需 Supabase CLI 已 link）
- 改列类型前必须删 CHECK 约束和引用该列的 RLS 策略

### 测试

- **Mailpit**：SMTP 测试用 `localhost:1025`，CI 中通过 service container 提供
- **端到端**：需要 `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
- **环境变量**：`vitest-setup.ts` 自动加载 `.env.local`
- Mailpit 本地启动：`docker run -d --name mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit`

### 文件命名规范

| 类型      | 规范                 | 示例                 |
| --------- | -------------------- | -------------------- |
| UI 原语   | PascalCase           | `Card.tsx`           |
| 其他组件  | kebab-case           | `error-boundary.tsx` |
| Hooks     | camelCase `use` 前缀 | `useAuth.ts`         |
| 工具/类型 | kebab-case           | `database.ts`        |
| 路由文件  | Next.js 约定         | `page.tsx`           |

### 常见坑

- **Supabase trigger 自动建 profile**：`createUser` 后 trigger 已插 profile，代码里用 `.upsert()` 不用 `.insert()`
- **sed 改代码**：prettier 格式化后 Edit 工具无法匹配原字符串，始终用 Edit/Write
- **draft PR**：需先 `gh pr ready` 再 merge
- **worktree**：单任务不需要，本仓库已设 `bgIsolation: none`
- **gen-types 在 worktree 中失效**：Supabase link 不继承，可用 MCP `generate_typescript_types` 替代

---

## 不同任务类型的处理模式

### Feature（新功能）

```
Issue → 分支 → 新页面/组件 → hooks 拿数据 → 测试 → PR
```

### Fix（Bug 修复）

```
Issue → 分支 → 复现确认 → 修复 → 加回归测试 → PR
```

### Refactor（重构）

```
Issue → 分支 → 改代码 → 全量 pnpm verify → 确认行为不变 → PR
```

### DB Schema 变更

```
MCP apply_migration → 本地 pnpm gen-types → 代码适配 → 测试 → PR
```

---

## 完成信号

每个阶段完成后向用户报告：

- `Issue #<n> 已创建: <title>`
- `分支 <name> 已创建`
- `已完成实现，测试通过（n 个）`
- `分支已推送，commit <hash>`
- `PR #<n> 已创建: <url>`
- `PR #<n> 已 Squash Merge，分支已删除`
