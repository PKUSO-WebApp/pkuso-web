# PKUSO 交响乐团管理系统

北大交响乐团(PKUSO)内部管理系统：排练日程发布与考勤、社区发帖、成员花名册。

## 技术栈

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS v4 · Supabase · Vercel

## 本地开发

```bash
# 前置要求: Node.js ≥20.9 (见 .nvmrc)、pnpm ≥11
corepack enable
pnpm install
pnpm dev            # http://localhost:3000
```

## 常用命令

| 命令              | 说明                                     |
| ----------------- | ---------------------------------------- |
| `pnpm dev`        | 开发服务器                               |
| `pnpm build`      | 生产构建 (**不含** tsc,须另跑 typecheck) |
| `pnpm typecheck`  | TypeScript 类型检查                      |
| `pnpm lint`       | ESLint 检查                              |
| `pnpm format`     | Prettier 格式检查                        |
| `pnpm format:fix` | 自动格式化                               |
| `pnpm test`       | 运行测试                                 |
| `pnpm verify`     | 一次性: 格式 → lint → 类型 → 测试        |

## 环境变量

复制 `.env.example` 为 `.env.local` 并填入实际值——**`.env.example` 是完整清单**，别在这里再抄一份（抄了就会腐烂）。

最小可用集合：`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`、`SUPABASE_SERVICE_ROLE_KEY`；邮件走 SMTP 系（`SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM`，**优先**）或 `RESEND_API_KEY`（兜底）。

## 部署

通过 Vercel 自动部署。`main` 分支推送后自动发布到生产环境,PR 自动生成预览部署。
