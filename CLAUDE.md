# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概况

北大交响乐团管理系统(PKUSO)。Next.js 16(App Router)+ React 19 + TypeScript(strict)+ Tailwind CSS v4 + Supabase,部署于 Vercel。界面文案、代码注释、提交信息均为中文。

**微信小程序 + 国内后端迁移的长期规划见 `docs/wechat-miniprogram-migration-plan.md`**（含架构决策、政策风险、两周 demo 计划；执行小程序相关任务前先读该文档）。

## 常用命令

```bash
pnpm dev          # 开发服务器 http://localhost:3000
pnpm build        # 生产构建(Next 16 默认**不含** tsc 类型检查,必须单独 pnpm typecheck)
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
- 邮件通知走 notify API route:**SMTP 优先(默认 smtp.163.com),Resend 兜底**(`resolveTransporter` 双模式)

### 环境变量(`.env.local`,不入库)

- `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`(仅服务端)
- 邮件:`RESEND_API_KEY` 或 SMTP 系(`SMTP_USER`/`SMTP_PASS`/`SMTP_HOST`/`SMTP_PORT`/`SMTP_FROM`,SMTP 优先)

### 认证

全局用户状态在 `src/context/user-context.tsx`;页面访问由 auth-gate 组件把关;登录/注册页在 `src/app/(auth)/`。

### 路由结构（Route Group 分离 Admin/Member）

```
src/app/
├── (auth)/           # route group, URL: /login, /signup, /reset-password
├── (member)/         # route group, URL: /, /schedule, /community, /members, /profile
│   ├── layout.tsx    # member tab bar（首页/社区/日程/成员/我的）
│   ├── page.tsx      # 排练日程展示（含历史合排 tab）+ 签到
│   ├── schedule/     # 排练房预约（甘特图+预约）
│   │   └── components/  # rehearsal-card, code-verify-modal, leave-request-modal, schedule-gantt 等
│   ├── community/    # 社区帖子（重奏/团建）
│   ├── members/      # 全团成员花名册（声部分组+拼音搜索）
│   └── profile/      # 个人信息+密码修改
├── admin/            # 普通目录, URL: /admin, /admin/rehearsals, /admin/schedule, /admin/members, /admin/community, /admin/profile
│   ├── layout.tsx    # admin tab bar（控制台/排练/社区/日程/成员/我的）+ 角色鉴权 + 守护页超时刷新
│   ├── page.tsx      # 仪表盘（入团审批/请假审批/公告,tab 切换）
│   ├── components/   # admin 共享组件（announcement-list-modal, leave-management, leave-detail-modal 等）
│   ├── rehearsals/   # 排练管理（CRUD+考勤查看）
│   │   └── components/  # rehearsal-card
│   ├── schedule/     # 日程管理（甘特图+预约 CRUD）
│   │   └── components/  # admin-schedule-gantt, create-schedule-modal, date-selector
│   ├── members/      # 花名册+考勤统计（排练行点击直达考勤编辑）
│   ├── community/    # 社区帖子管理
│   └── profile/      # 个人设置（含邀请码管理+邮件签名）
└── api/              # API routes（notify, admin/approve, admin/approve-all, admin/reject,
                      #            admin/reject-all, admin/announcement, admin/settings, admin/leave）
```

### 开发方式：admin/member 分端独立

项目虽然部署在同一个 Next.js app 中，但 **admin 和 member 已完全分离**，可按两个独立应用对待：

| 维度     | Member 端                                   | Admin 端                             |
| -------- | ------------------------------------------- | ------------------------------------ |
| 路由前缀 | `/`                                         | `/admin`                             |
| 布局     | `(member)/layout.tsx`                       | `admin/layout.tsx`                   |
| Tab bar  | 首页 · 日程 · 社区 · 我的                   | 控制台 · 排练 · 日程 · 成员 · 我的   |
| 角色守卫 | 无（AuthGate 统一鉴权）                     | `layout.tsx` 检查 `role === "admin"` |
| 开发入口 | 新功能加在 `(member)/` 下                   | 新功能加在 `admin/` 下               |
| 组件     | 各端组件放在各自目录的 `components/` 子目录 | 同                                   |
| 数据层   | 共享 `src/hooks/` 和 `src/lib/`             | 同                                   |
| UI 原语  | 共享 `src/components/ui/`                   | 同                                   |

**不再通过 `isAdmin` 条件分支混合 UI**。开发 member 端新功能时不需要关心 admin 代码，反之亦然。唯一共享的部分是 hooks、lib、UI 原语、类型定义。

## 分支工作流

- 分支命名: `<type>/<简述>`,type = feat|fix|docs|refactor|test|chore|build|ci
- 每个 PR 从 main 切新分支,合并后删分支。禁止在原分支上继续追加。
- 提交遵循 Conventional Commits(commitlint 强制)。PR 用 Squash & merge。
- CI 自动验证 typecheck + lint + test + build + gen-types 一致性 + 分支命名规范。

## 前端设计原则

- **Token 优先**: `src/styles/tokens.css` 为设计令牌单一可信源。所有颜色通过 Tailwind 语义类使用,**禁止硬编码调色板色**(`zinc-*`/`text-white` 等——`text-white` 应写 `text-primary-foreground`,暗色模式才不会低对比度)。21 对语义色覆盖亮/暗双模式,完整清单以 tokens.css 为准。
- **移动端优先**: 页面宽 `max-w-md`(448px),Modal 默认底部弹出(`position="bottom"`),底部安全区 `pb-safe`。
- **罗列内容必须可滚动**: 页面是固定视口(AuthGate `h-screen` 列 + 两端 layout `flex-1 overflow-hidden`,页面本身不可滚动)。罗列性质的内容必须放可滚动容器(`flex-1 min-h-0 overflow-y-auto` 或 `max-h-[Npx] overflow-y-auto`);含筛选控件的列表页,根容器用 `flex h-full min-h-0 flex-col`,控件+列表整体放滚动区(矮屏可到达)。**豁免:member 端 profile 页整页滚动**——page 根节点自身为 `flex-1 min-h-0 overflow-y-auto` 滚动容器(整页上下滚动、tab bar 固定),其余页面维持固定视口。
- **多行文本框可拉长**: textarea 保持默认可拖拽调整大小(resize: both),除全屏铺满等豁免场景外**不要加 `resize-none`**,且避免 `.input` 固定高度类覆盖 rows。
- **组件复用**: 写新 UI 前先查 `src/components/ui/`(Modal/Toggle/Card/Toast)和 `src/app/(member)/schedule/components/`(排练相关组件)。Button 暂不统一(35+ 变体,待设计系统定型)。
- **暗色模式**: `<html data-theme="dark">` 即可全局切换,所有组件应双模式可用。测试时亮/暗都过一遍。
- **0 行更新必须检测**: 带状态守卫的 update 要链 `.select("id")`,0 行(RLS 静默失败/并发已处理)时 return false,且**在任何副作用(如删附件)之前检测**。
- **附件路径提取**: storage 路径从 URL 提取统一用 `indexOf("bucket/")` + `decodeURIComponent`,try/catch 兜底(参考 `usePosts.remove`)。
- **blob URL 必须 revoke**: `URL.createObjectURL` 生成的预览在关闭/换图/卸载时配对 `URL.revokeObjectURL`。
- **竞态守卫用递增序号**: 快速切换的异步读取用 `const seq = ++ref.current` + 回调内比较(优于存 ID 模式,支持任意次快速切换)。
- **状态机集中注释**: 复杂交互状态机(如请假流程、卡片按钮矩阵)在文件头集中注释声明规则,前后端一致。
- **弹层焦点管理**: 叠加弹层(全屏层盖 Modal)时,底层加 `inert` 隔离;全屏层内用根节点 `tabIndex={-1}` + Tab 循环做 focus trap(参考 `admin/profile` 全屏签名编辑)。
- **双按钮操作行右下角**(Issue #182 确立): 弹窗/区块底部的双交互按钮操作行(「取消+提交」「编辑+删除」「锁定+删除」等)统一 `justify-end` 靠右下角,禁止左对齐或左右两端分布。豁免:标题栏「关闭」按钮;「通过/驳回」等主审批按钮与内联确认块(「确认删除」等)保持全宽平分;仅剩一个主操作按钮(如「编辑申请」「重新申请」)时右对齐。
- **内联确认块位置**: 全宽平分的确认块位于内容区与操作行之间(操作行上方),不要放在操作行下方或弹窗顶部。
- **只读状态入标题**: 弹窗只读视图的状态(如请假申请状态 chip)放 Modal 标题右侧——用 Modal 的 `headerExtra` prop(渲染在标题与「关闭」按钮之间),不在内容区/底部操作行重复展示。
- **移除附件按钮规范**: 「移除附件」按钮单独出现时全宽(`w-full`),与「更换图片」等成对出现时全宽平分(`flex-1`)。
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
  - **bash heredoc（`cat <<'EOF'`）在 PowerShell 中不可用**，会报 "Missing file specification after redirection operator"。多行中文 commit message / PR body 改用文件方式：写入临时文件后 `git commit -F <file>` / `gh pr create --body-file <file>`，完成后删除临时文件。
  - **PowerShell `Select-Object` 在管道输出中文时会出现乱码**,改用 `ForEach-Object` 或直接输出。如需格式化对象输出,使用 `ConvertTo-Json -Depth 10` 或手动拼接字符串。
- **`supabase/` 文件夹必须保持 git 追踪**：`.gitignore` 中只忽略 `supabase/.temp/`，不忽略 `supabase/migrations/` 等目录。所有 migration 文件、Edge Functions、配置文件都应进入版本控制，确保 schema 变更可追溯、可回滚。
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

### 级联删除优先使用外键约束

当需要实现"删除 A 时自动删除 B"的功能时，优先使用外键约束的 `ON DELETE CASCADE`，而非自定义触发器：

```sql
ALTER TABLE schedules
ADD CONSTRAINT schedules_rehearsal_id_fkey
FOREIGN KEY (rehearsal_id) REFERENCES rehearsals(id)
ON DELETE CASCADE;
```

优点：

- PostgreSQL 原生支持，性能更好
- 保证数据完整性，触发器可能被绕过
- 代码更简洁，无需维护触发器函数

### Supabase CLI 交互问题

Supabase CLI 多个子命令在非 TTY（自动化/子智能体）环境下会进入交互模式等待 Y/n 或密码输入，导致任务卡死。**不是只有 `db push` 会卡**，以下命令都会阻塞：

- `supabase db push` — 等待 Y/n 确认推送到远端
- `supabase db pull` — 等待确认拉取并生成 migration
- `supabase db reset` — 等待确认重置本地数据库
- `supabase link` — 等待输入数据库密码
- `supabase migration up --linked` — 等待确认应用到远端

**解决方案（按优先级）：**

1. **首选：全局 `--yes` flag**（所有子命令通用，自动对所有提示回答 yes）

   ```bash
   supabase db push --yes
   supabase db pull --yes
   supabase db reset --yes
   supabase migration up --linked --yes
   ```

2. **`db push` 也可用 `--force`**（等价于 `--yes`，旧版本兼容）

   ```bash
   supabase db push --force
   ```

3. **`link` 必须通过参数传密码**，不要让它进交互式输入：

   ```bash
   supabase link --project-ref "$SUPABASE_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD"
   ```

4. **CI 环境**：设置 `SUPABASE_ACCESS_TOKEN` 环境变量可跳过 `login` 交互；`SUPABASE_FORCE_PUSH=true` 可让 `db push` 跳过确认。

**子智能体（pkuso-dba 等）执行任何 supabase 命令时，必须显式带 `--yes` 或对应非交互参数，禁止裸跑 `supabase db push` / `db pull` / `db reset` / `link`。** 调用 pkuso-dba 时主智能体应在指令中强调这一点。

### PostgREST 外键必须指向 public schema

Supabase 的嵌入资源 join 语法（`profiles(full_name, instrument)` 或 `profiles!inner(...)`）依赖 PostgREST 识别 FK 关系。FK 必须指向 `public` schema 的表（如 `public.profiles`），不能指向 `auth.users` 等内部 schema。如果 FK 目标不对，PostgREST 无法解析 join，整个请求被网关拒绝返回 `400 No API key`（误导性错误——实际不是 API key 问题）。

**检查方法**：运行 `pnpm gen-types` 后查看 `database.types.ts` 中对应表的 `Relationships` 数组是否包含预期的 FK。若为空或缺失，说明 FK 未指向 public schema。

```sql
-- 修复：删旧 FK，重建指向 public schema
ALTER TABLE posts DROP CONSTRAINT posts_author_id_fkey;
ALTER TABLE posts ADD CONSTRAINT posts_author_id_fkey
  FOREIGN KEY (author_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
```

### Storage bucket 删除/更新需要显式 RLS 策略

Supabase Storage bucket 默认只有 `SELECT` 和 `INSERT` 策略（允许公开查看和上传）。**`DELETE` 和 `UPDATE` 操作没有默认策略**，即使请求带了有效的用户 JWT 也会被 RLS 拒绝（静默失败）。

在代码中调用 `client.storage.from("bucket").remove([path])` 前，确认数据库中有对应的 DELETE 策略：

```sql
-- 查看现有策略
SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects';

-- 如缺少 DELETE，添加认证用户删除策略
CREATE POLICY "认证用户可删除" ON storage.objects
  FOR DELETE USING (bucket_id = '<bucket-name>' AND auth.role() = 'authenticated');
```

### `.single()` vs `.maybeSingle()`

Supabase JS client 的 `.single()` 在查询返回 0 行时返回 `406 Not Acceptable` 错误（而非 `data: null`），会中断 async 流程。查询**可能不存在**的行（如删除前查 image_url、查可选关联数据）时用 `.maybeSingle()`——0 行返回 `{ data: null, error: null }`，不抛错。配合 try/catch 兜底确保核心操作不受影响。

## 前端开发防坑指南

### 防止重复提交

表单提交时必须添加双重 guard（同步 ref + 异步 state），防止用户快速点击多次提交。**仅用 state（`isSubmitting`）不够**——React setState 是异步的，两次快速点击之间 state 仍为 false。

```tsx
const [isSubmitting, setIsSubmitting] = useState(false);
const submittingRef = useRef(false); // 同步 guard，阻断竞态窗口

const handleSubmit = async () => {
  // 双重检查：ref 同步阻断，state 异步兜底
  if (submittingRef.current || isSubmitting) return;
  submittingRef.current = true;
  setIsSubmitting(true);
  try {
    // 提交逻辑
  } finally {
    submittingRef.current = false;
    setIsSubmitting(false);
  }
};
```

按钮需配合 `disabled={isSubmitting}` 使用。

同样的模式也适用于删除操作——用 `deletingId` state 记录正在删除的 ID，防止重复删除：

```tsx
const [deletingId, setDeletingId] = useState<string | null>(null);

const handleDelete = async (id: string) => {
  if (deletingId) return; // 同步阻断（setState 虽异步，但 deletingId 在当前闭包已是旧值，
  setDeletingId(id); // 第二次点击前 React 已 re-render，deletingId 非 null）
  const ok = await remove(id);
  setDeletingId(null);
  // ...
};
```

### 竞态条件处理

当用户快速切换操作（如快速点击多个预约窗口查看详情）时，异步请求可能返回乱序，导致显示错误数据。解决方案：

```tsx
const queryingScheduleId = useRef<string | null>(null);

const fetchAuthorName = async (scheduleId: string) => {
  queryingScheduleId.current = scheduleId;
  const { data } = await supabase.from("profiles").select("full_name").eq("id", authorId);
  if (queryingScheduleId.current === scheduleId) {
    // 只有当前查询的结果才更新状态
    setAuthorName(data?.[0]?.full_name || "未知");
  }
};
```

使用 `useRef` 追踪当前操作的 ID，在异步回调中检查是否仍为当前操作。

### 时间验证

预约时间选择需注意：

- 结束时间必须晚于开始时间（不能等于）
- 使用 `select` 下拉框限制时间选项为半小时间隔，而非原生 `time` input（step 属性可能被忽略）
- 时区问题：使用本地时间而非 UTC，避免日期偏移

### 滚动同步

当页面包含固定时间轴和可滚动内容区域时，需确保两者同步滚动：

```tsx
<div className="flex overflow-y-auto">
  <div className="flex-shrink-0 w-12">{/* 时间轴（随容器同步滚动） */}</div>
  <div className="flex-1">{/* 内容区域 */}</div>
</div>
```

将时间轴和内容放在同一滚动容器内，移除内容区域单独的 `overflow-y-auto`。

### 守护页加载态兜底

布局组件（如 AdminLayout）在 user 未就绪时显示守护页，必须提供超时兜底，避免 profile 加载延迟导致永久卡住：

- **状态拆分**：区分"加载中"（`user === null`，数据未到）与"未授权"（`user.role !== "admin"`，数据已到但不满足条件），两者语义不同，不应共用同一逻辑分支
- **超时自动刷新**：仅在"加载中"状态启动定时器（如 5 秒），到时触发 `window.location.reload()`
- **防死循环**：用 `sessionStorage` 记录刷新次数，限制最多 2 次
- **失败恢复**：达到刷新上限后切换到"加载失败"UI + 手动重试按钮（清除计数后刷新）
- **跨会话清理**：组件卸载时也清除 `sessionStorage` 计数，避免残留计数导致后续访问误判为失败
- **提示文案区分**：加载中显示"正在加载…"，未授权显示"正在跳转…"，避免误导

## Subagent Team

项目配置了 5 个专用 subagent（定义在 `.claude/agents/`），由主智能体按流水线调度。子智能体上下文互相隔离，之间不能互相调用。

| Agent             | 模型      | 职责                                                          | 工具                                                         |
| ----------------- | --------- | ------------------------------------------------------------- | ------------------------------------------------------------ |
| pkuso-implementer | Sonnet    | 编码实现（Issue 明确、分支就绪后调用）                        | Read/Write/Edit/Glob/Grep/Bash/Task/Skill/WebSearch/WebFetch |
| pkuso-reviewer    | **Haiku** | CLAUDE.md 合规审查（命名/颜色 Token/架构/编码规范）           | Read/Glob/Grep/Bash（只读，不修代码）                        |
| pkuso-adversary   | Sonnet    | 找 Bug/逻辑漏洞/边界情况（reviewer PASS 后调用）              | Read/Glob/Grep/Bash（只读，不修代码）                        |
| pkuso-tester      | Sonnet    | 测试补齐与回归（adversary 未击破后调用）                      | Read/Write/Edit/Glob/Grep/Bash/Task                          |
| pkuso-dba         | Sonnet    | 数据库变更（schema/RLS/枚举/migration，唯一可产出 migration） | + Supabase MCP tools                                         |

**模型选择理由**：reviewer 是纯机械性规则匹配（grep 文件名/颜色/import），不需要推理能力，Haiku 比 Sonnet 便宜 ~10 倍。其余 agent 都需要理解代码语义、做判断或生成内容，必须 Sonnet。

### 编排流水线

完整流程走 `/pkuso-pipeline` skill（定义在 `.claude/skills/pkuso-pipeline/SKILL.md`）：

```
DBA(按需) → 实现 → 审查 → 对抗 → 测试 → 提交
```

- **关卡失败**：携带完整报告回 implementer 返工，从 reviewer 重走全流程，**禁止跳关**
- **上下文隔离**：每次调用子智能体时传入完整背景（任务描述、涉及文件、验收标准、上一环节报告）
- **透明声明**：激活子智能体前向用户输出 `🤖 正在激活 [Agent] 处理 [子任务]`

### 主智能体编辑权限

**主智能体只编排，不写业务代码。** `src/` 下的任何修改一律由 pkuso-implementer 执行——哪怕只是 reviewer 指出的一行小改，也必须携带报告回 implementer 返工。原因：子智能体上下文隔离，主智能体直接改会导致 reviewer 报告、implementer 自检声明与仓库实际状态脱节。

唯一例外（微修复通道，同时满足全部条件）：

1. 单行内的纯机械修正（错别字、文案、import 顺序、格式化、显式类型标注），不含逻辑/条件/SQL/样式 token 变更
2. 改完立即调 pkuso-reviewer 复核该行，拿到 PASS
3. 最终交付汇报中显式声明"主智能体代改了什么、为什么"

## 交付流程

功能开发走 **Issue → 分支 → 编排流水线 → PR → CI → Squash Merge**。Conventional Commits 含 `Closes #<issue>`。

常见坑：

- **sed 改代码后 prettier 格式错乱**：始终用 Edit/Write 工具
- **commitlint type 白名单**：仅 `build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test`
- **draft PR 不能 merge**：需 `gh pr ready` 后再 `gh pr merge --squash`
- **commitlint + PowerShell here-string**：`@"..."@` 多行中文 commit message 可能被解析为 subject-empty。改用 bash heredoc（`git commit -F - <<'MSG'`）或写入临时文件 `git commit -F <file>`
