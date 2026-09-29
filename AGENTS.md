# pkuso-web

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概况

北大交响乐团管理系统(PKUSO)。Next.js 16(App Router)+ React 19 + TypeScript(strict)+ Tailwind CSS v4 + Supabase,部署于 Vercel。界面文案、代码注释、提交信息均为中文。

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

验证改动 = `bash scripts/gate.sh` + 起 dev 手动走一遍相关流程(详见 `.claude/skills/verify`)。

**闸门的唯一定义是 `scripts/gate.sh`**（= `pnpm verify` + `pnpm build`），CI 调的就是它。以前 CI 里写两步、文档里另抄一份，改一处另两处不会跟着变。

### git hook（本地便利，**不是**门）

```bash
git config core.hooksPath .githooks     # 每个克隆一次，没法提交
```

装好之后推 `main` 会先跑一次闸门（推 WIP 分支不挡——挡那种是反效果，会把人逼去 `--no-verify`）。

⚠️ **但它不是可靠的门，两条原因都别忘**：

1. **没装就是没有** —— `core.hooksPath` 在 `.git/config` 里，不进版本控制。新克隆、换台机器、别的 harness 起的会话，全都是没有的状态。
2. **可以 `git push --no-verify` 绕过。**

**真正的兜底是 CI 的必需检查**（规则集里的 `required_status_checks: verify`）—— 那个决定 PR 能不能合，绕不过去。hook 的价值只是让你**在推之前**就知道，不是让别人绕不过去。

## 架构(跨分支稳定部分)

### 数据层:Supabase

- `src/lib/supabase.ts` —— 浏览器端客户端(anon key,受 RLS 约束):`import { supabase } from "@/lib/supabase"`
- `src/lib/supabase-server.ts` —— `createServerSupabase()`,用 service role key,**绕过 RLS,只允许在 API route 中用于管理员操作**
- 邮件通知走 notify API route:**SMTP 优先(默认 smtp.163.com),Resend 兜底**(`resolveTransporter` 双模式)

### 环境变量(`.env.local`,不入库)

- `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`(仅服务端)
- 邮件:`RESEND_API_KEY` 或 SMTP 系(`SMTP_USER`/`SMTP_PASS`/`SMTP_HOST`/`SMTP_PORT`/`SMTP_FROM`,SMTP 优先)
- `NEXT_PUBLIC_TENCENT_MAP_KEY`:腾讯位置服务 JSAPI Key(lbs.qq.com),用于管理端排练地理围栏的地图选点/搜索;需在腾讯控制台绑定部署域名白名单并启用 WebServiceAPI 产品

### 认证

全局用户状态在 `src/context/user-context.tsx`;页面访问由 `src/components/auth-gate.tsx` 把关;登录页在 `src/app/(auth)/login`,**没有注册页**。

**成员端代码已删除**(2026-09-05,提交 `2e9f69d`):`(member)/` 下只剩一张「成员端已迁移到微信小程序」的静态引导页。登录校验在 `login/page.tsx` 里直接查 `profiles.role`,`role !== "admin"` 即 `signOut()` 并提示「成员不允许进行web端登录」——**不走 `is_admin()` RPC**。网页端仅面向管理员。

### 地理签到（2026-08 起）

- 成员签到唯一路径:微信小程序调用 SECURITY DEFINER RPC `sign_in_attendance_location(p_rehearsal_id,p_lat,p_lng,p_accuracy)`;服务端校验地理围栏(haversine ≤ 半径+accuracy,accuracy 服务端钳制 [0,100] 米)、时间窗与防重;旧签到码 RPC `sign_in_attendance` 已 DROP
- `attendances` 的成员直写 RLS 策略已删除(仅管理员 ALL + authenticated SELECT);任何客户端直写考勤都会被拒
- `rehearsals.checkin_lat/lng/checkin_radius_m` 三字段全非 NULL 才启用围栏,任一为 NULL = 不限位置;管理端表单以「开启地理围栏」开关显式控制
- 历史决策:web member 端已废弃,不再为其维护签到功能

### 谱务系统（2026-09 起）

Web 端最重的子系统：上传总谱 PDF → 自动切成各声部分谱。代码全在 `src/app/admin/sheet-music/`。

**链路**：PDF → `pdf-render.ts` 渲染页面 → `staff-line.ts` 定位第一条谱线 → `segmentation.ts` 按谱线分段 → `mosaic.ts` 拼图 → `ocr-client.ts` 调后端 `ocr-analyze`（转发 OCR.space）→ `analysis.ts` 调后端 `llm-analyze` 识别声部与乐器 → `sub-parts.ts` / `sort-parts.ts` 整理 → `split-pdf.ts` 切分导出。

- **后端依赖**：`ocr-analyze` 与 `llm-analyze` 两个 Edge Function 都在 `pkuso-backend`，本仓库只调不改
- **数据表**：`sheet_music` / `sheet_music_files` / `sheet_music_parts` / `sheet_music_distributions` / `sheet_music_analysis_logs`
- **已知设计陷阱**（改之前先读）：降级逻辑会掩盖失败、`functions.invoke` 吞错、pdf.js 静默不画、OCR 链路无超时
- **别用固定阈值**判分谱页边界——换出版社后会大面积判错，判据必须与 OCR+LLM 耦合
- **渲染对照台**在仓库外的 `.render-harness/`（真实浏览器跑串行 vs 并发）。注意**并发不会让纯 CPU 渲染变快**
- `upload-modal.tsx` 是这一块的核心，也是全仓最大的文件（已经拆过几轮，还没拆完），正按「类型 → 行级 helper → 出图/OCR → 分段/LLM → 叶子组件」继续分层拆分（进行中）

### 路由结构

**全部功能都在 admin 端**（member 端只剩引导页）。

```
src/app/
├── (auth)/           # route group, URL: /login, /reset-password, /reset-password/reset
├── (member)/         # route group, URL: / —— 只剩引导页
│   ├── layout.tsx    # 直通 fragment（无 tab bar）
│   └── page.tsx      # 「成员端已迁移到微信小程序」静态引导页
├── admin/            # 普通目录, URL: /admin/*
│   ├── layout.tsx    # 顶部 AdminHeader（返回/标题/设置）+ 角色鉴权 + 守护页超时刷新
│   ├── page.tsx      # 首页宫格入口 + 入团审批/请假审批/公告
│   ├── components/   # admin 共享组件（leave-management 等）
│   ├── rehearsals/   # 排练管理（list + new + [id] + [id]/edit）
│   ├── schedule/     # 排练房预约（甘特图 + CRUD）
│   ├── attendance/   # 考勤管理
│   ├── members/      # 花名册 + 考勤统计
│   ├── roster/       # 成员花名册（声部/在团标记）
│   ├── approval/     # 入团审批
│   ├── leave/        # 请假审批
│   ├── announcements/# 公告管理
│   ├── community/    # 社区帖子管理（list + [id]）
│   ├── sheet-music/  # 谱务系统（list + [id]）—— 见下文专节
│   ├── feedback/     # 意见反馈
│   ├── config/import/# 团员信息 Excel 导入
│   ├── email-settings/ email-signature/  # 邮件模板与签名
│   ├── system-notify/# 系统通知
│   └── profile/      # 个人设置
└── api/              # API routes
    ├── notify/                       # 排练通知发信
    └── admin/                        # announcement, approve, approve-all, reject, reject-all,
                                      # feedback, import-member-info, leave, notify-system,
                                      # settings, sync-profiles
```

各功能域的私有组件放各自目录的 `components/` 子目录（`rehearsals/`、`schedule/`、`members/`、`sheet-music/`、`community/` 都有）。

### 开发方式：只做 admin 端

Web 端**只服务管理员**，没有「两端独立」这回事了。新功能一律加在 `admin/` 下。

- **导航形态**：没有 tab bar。`admin/layout.tsx` 只提供顶部 `AdminHeader`（返回按钮 + 页面标题 + 设置齿轮，标题走 `AdminPageHeaderContext`）；入口是 `/admin` 首页的宫格。
- **角色守卫**：`admin/layout.tsx` 里 `user.role !== "admin"` → `router.replace("/")`（落到 member 引导页）；AuthGate 也会把非 admin 从 `/admin/*` 弹回 `/`。
- **共享层**：`src/hooks/`、`src/lib/`、`src/components/ui/`、`src/types/`。

### 迁移状态（2026-09）

微信小程序 → Web 的界面迁移已完成，随后**member 端代码被整体删除**（2026-09-05 提交 `2e9f69d`，保留一张引导页）。`(member)/schedule|community|members|profile` 等页面**已不存在**——引用它们的旧文档、旧 skill、旧记忆都已过期。

成员端的功能（含签到）在微信小程序里实现，Web 端不再维护。

## 分支工作流

- 分支命名: `<type>/<简述>`,type = feat|fix|docs|refactor|test|chore|build|ci|style(以 `.github/workflows/ci.yml` 的 branch-name job 为准)
- 每个 PR 从 main 切新分支,合并后删分支。禁止在原分支上继续追加。
- 提交遵循 Conventional Commits(commitlint 强制)。PR 用 Squash & merge。
- CI 自动验证 typecheck + lint + test + build + gen-types 一致性 + 分支命名规范。

## 前端设计原则

- **Token 优先**: `src/styles/tokens.css` 为设计令牌单一可信源,经 `globals.css` 的 `@theme inline` 注册成 Tailwind 语义类。所有颜色通过语义类使用,**禁止硬编码调色板色**(`zinc-*`/`text-white` 等——`text-white` 应写 `text-primary-foreground`,暗色模式才不会低对比度)。令牌清单以 tokens.css 为准——**不要在本文件里写令牌数量**,那种计数一定会腐烂。
- **移动端优先**: 页面宽 `max-w-md`(448px),Modal 默认底部弹出(`position="bottom"`),底部安全区 `pb-safe`。
- **罗列内容必须可滚动**: AuthGate 外层是 `h-screen` + `overflow-hidden` 的列,页面因此是固定视口。页面根节点按 `flex h-full min-h-0 flex-col` 铺满,罗列性质的内容**必须自带滚动容器**(`flex-1 min-h-0 overflow-y-auto` 或 `max-h-[Npx] overflow-y-auto`);含筛选控件的列表页,控件+列表整体放滚动区(矮屏可到达)。现役 admin 页面都遵循这个骨架,可参照 `admin/roster`、`admin/members`、`admin/sheet-music`、`admin/page.tsx`。
- **多行文本框可拉长**: textarea 保持默认可拖拽调整大小(resize: both),除全屏铺满等豁免场景外**不要加 `resize-none`**,且避免 `.input` 固定高度类覆盖 rows。
- **组件复用**: 写新 UI 前先查 `src/components/ui/`(Modal/Toggle/Card/Toast)和该功能域自己的 `components/` 子目录(如 `src/app/admin/rehearsals/components/`)。Button 暂不统一(变体很多,待设计系统定型)。
- **暗色模式**: `<html data-theme="dark">` 即可全局切换,所有组件应双模式可用。测试时亮/暗都过一遍。
- **0 行更新必须检测**: 带状态守卫的 update 要链 `.select("id")`,0 行(RLS 静默失败/并发已处理)时 return false,且**在任何副作用(如删附件)之前检测**。
- **附件路径提取**: 统一走 `src/lib/storage.ts` 的 `storagePathFromUrl(url, bucket)`，bucket 名也从那里取（`STORAGE_BUCKETS`），**不要在调用处写字面量**。自己写 `indexOf` + `decodeURIComponent` 的代价是**静默失败**：bucket 改名或对象名含中文时，上传照常成功而删除悄悄删不掉，界面上看不出任何异常。抠不出路径时它返回 `null`（而不是猜一个键），调用方要显式处理。
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
- **`supabase/` 文件夹保持 git 追踪**：**新迁移不要添加到这里**——所有新 schema 变更必须提交到 `pkuso-backend` 仓库。
  注意这个目录不只是「参考和审计」材料：`pkuso-backend` 的迁移里 2026-09-08 之前的部分只有 stub 占位文件（内容为 `-- Applied directly to dev database. Stub file for migration version compatibility.`），**本目录是那之前 schema 的唯一真实 DDL 记录**，别再往里加东西，也别删。
- 历代功能 spec(颜色系统、admin/member 拆分、hooks-modal 重构、排练房预订等)已迁移至项目 wiki。
- 经验沉淀机制:项目级约定写进本文件;可复用操作流程写成 **`.agents/skills/<名字>/SKILL.md`**;会话中的偏好与决策背景由 Claude 记入其持久 memory。会话结束前可用 `save-lesson` 的流程做沉淀。
  ⚠️ **写 `.agents/skills/`,不是 `.claude/skills/`** —— 后者是**生成出来的**适配层（Claude Code 只读它,但别手改）。改完跑 `node scripts/sync-skills.mjs`,否则闸门会红。两套目录为什么这么分、以及实测到的漂移事故,见 `.agents/skills/README.md`。

## 测试基础设施

### 环境变量加载

vitest 默认不加载 `.env.local`。`vitest.config.ts` 中 `setupFiles: ["./src/__tests__/vitest-setup.ts"]` 手动解析注入 `process.env`。CI 通过 GitHub Actions secrets 注入相同变量。

### notify 邮件测试

`src/__tests__/notify.test.ts` 是**纯单测**：转义、签名/模板的读取与静默降级、传输器选择、收件人过滤。用 `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` 的部分在缺失时自动跳过。

⚠️ **端到端邮件测试已丢失（未补回）**：这里曾经有一个 Mailpit SMTP 直连测试和一个「临时 admin → POST `/api/notify` → 查 Mailpit API → 清理」的端到端测试，配套 CI 里也有 `services.mailpit`。现在全仓已经搜不到任何 Mailpit 引用，`ci.yml` 里那个 mailpit service container 成了死配置（留着没删，要恢复端到端测试时能直接用）。**邮件链路的端到端保障目前是空的**——改发信链路请手工验证。

（历史选择：SMTP 测试用 Mailpit 而非 Ethereal，因为 Ethereal 公网 SMTP 在北大校园网超时。）

## ⚠️ 后端修改流程

**禁止在 web 仓库中直接修改数据库 schema、RLS 策略或 Edge Functions。**

所有后端变更（DDL / RLS / 函数 / 触发器 / Edge Functions）必须提交到 `pkuso-backend` 仓库（`https://github.com/PKUSO-WebApp/pkuso-backend`）。

- 发现后端问题 → 在 `pkuso-backend` 仓库创建 Issue
- 需要新表/列/函数 → 在 `pkuso-backend` 创建 PR
- 紧急修复 → 在 `pkuso-backend` 走加急 PR，**不要在本仓库或通过 MCP 直接改线上**

### 类型同步

- `src/types/database.types.ts` 由 `pkuso-backend` 仓库 CI 生成
- 实际链路（`pkuso-backend/.github/workflows/sync-dev.yml`）：后端推 `main` → 把 migration 应用到 dev → 用 dev 的 schema 生成类型 → **`github-actions[bot]` 直接 `git push` 到本仓库 `main`**（commit message `chore: sync database types from pkuso-backend [skip ci]`）。
  **不是 PR，也不走 `dev` 分支**——本仓库根本没有 `dev` 分支。
- **不要手动编辑** `src/types/database.types.ts`，它始终由后端 CI 管理
- **本仓库 `main` 上装的是 dev schema 的类型**（不是 prod 的）。这是有意的：本仓库没有 `dev` 分支、单线合并即部署，而「先写前端代码、再用后端新列」要求类型先到——装 prod 类型会死锁（PR 的 `tsc` 失败，手动补类型又会被 `gen-types-check` 拒掉）。
- 本仓库 CI 的 `gen-types-check` job 会重新拉 **dev** schema 与提交的文件比对，防止漂移。`pkuso-backend/CLAUDE.md` 的「类型同步的目标分支」一节是这条规矩的完整定义——**改类型同步前先读它**。
- 手动同步（本地已有 `pkuso-backend` 克隆时）：`pnpm pull-types`，从 `../pkuso-backend/types/database.types.ts` 拷贝

### 手写类型层 `src/types/database.ts`（#314 起）

生成文件只是数据源。**取 `Database` 泛型或表类型的唯一入口是手写的 `src/types/database.ts`**——`src/lib/supabase.ts` / `supabase-server.ts` 都已改走它，不再直接 import 生成文件；要新别名请在这一层加，不要各处直接摸 `database.types.ts`。细节见 `.claude/SUPABASE_TYPE_SYNC.md`。

### 三个仓库的职责划分

| 仓库            | 职责                                               | 事实来源                |
| --------------- | -------------------------------------------------- | ----------------------- |
| `pkuso-backend` | 数据库 schema、Edge Functions、TypeScript 类型定义 | **唯一后端事实来源**    |
| `pkuso-mp`      | 微信小程序（成员端）                               | 消费 backend 产生的类型 |
| `pkuso-web`     | 管理端 Web 应用                                    | 消费 backend 产生的类型 |

### MCP 的使用边界

**数据库变更一律走 `pkuso-backend` 仓库的 CI，不再通过 MCP 直接部署 migration。**

- **不通过 MCP 执行 DDL**，不通过 MCP 应用 migration（`supabase db push` / `db pull` 等一律不走 MCP）
- migration 写在 `pkuso-backend/supabase/migrations/` → 推 `main` → CI 自动应用到 dev；prod 手动触发 `Deploy to Prod`
- 本仓库（pkuso-web）完全不碰数据库 schema
- MCP 仅用于**只读**用途：查询现状、排查问题、审计。**任何写操作都不走 MCP**
- 本仓库的 `.mcp.json` 只配置 `read_only=true` 的 server。**不要在这里加可写 server**——规矩挡不住手滑，配置才挡得住

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

**在非 TTY 环境（自动化脚本、子智能体）执行任何 supabase 命令时，必须显式带 `--yes` 或对应非交互参数，禁止裸跑 `supabase db push` / `db pull` / `db reset` / `link`。**

> 注：数据库变更一律走 `pkuso-backend` 仓库 CI（见上文「MCP 的使用边界」），本仓库不应出现 `db push` 之类的操作。本节保留是因为排查问题时仍可能需要在本地跑只读的 supabase 命令。

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

## 开发工作流

**主智能体直接实现业务代码**，实现完成后按**风险分级**决定跑哪几道评审。早先的多智能体编排流水线（implementer / tester / dba 分工）**已废弃**——对应的 agent 定义和 `pkuso-pipeline` skill 已从仓库删除，不要再按那个流程走。

### 第 0 步：契约先行（硬性）

开工前在 Issue 里写清两栏，**缺一不开工**：

- **必须为真的 N 条** —— 不变量 / 验收标准。对抗审查就攻击这个清单
- **本次明确不覆盖的 M 条** —— 已知边界、故意不做的事

这不是形式主义。「主动找 Bug」是**没有终止条件的指令**——任何非平凡 diff 都能被找出东西，所以「无发现」这个停止条件基本不可达。**只有有限的目标才收得住**，契约就是那个目标，它同时是复审时的判据。

### 风险分级（主智能体在开工时判定，写进 Issue）

| 级别 | 判据                                | 门                              |
| ---- | ----------------------------------- | ------------------------------- |
| T0   | 文档 / 注释 / 格式 / 文案           | 无门，`pnpm verify` 过即可      |
| T1   | 纯展示 UI、只读查询、无状态写入     | 合规审查                        |
| T2   | 写库、状态机、并发、校验、导入导出  | 合规审查 **∥** 对抗测试（并行） |
| T3   | schema / 认证 / 权限 / 外部服务调用 | T2 + 人工验证                   |

**拿不准就往上取一级。**

### 评审关卡

| 环节     | 职责                                                          | 定义                                |
| -------- | ------------------------------------------------------------- | ----------------------------------- |
| 合规审查 | 对照本文件检查命名 / 颜色 Token / 架构 / 编码规范，只读不改码 | `.claude/agents/pkuso-reviewer.md`  |
| 对抗测试 | 攻击契约里的「必须为真」清单，只读不改码                      | `.claude/agents/pkuso-adversary.md` |

- **必须是独立上下文的 subagent**：自己写的代码自己审有盲区 —— 这是关卡存在的唯一理由
- **两道门并行**，喂**同一份 `git diff`** + **同一份契约**；主智能体合并两份报告后**只修一轮**
- **只审 diff**：不是本次改动引入的问题一律不算本次的账
- **透明声明**：激活 subagent 前向用户输出 `🤖 正在激活 [环节] ...`
- **传 diff，不传文件清单**——后者会让审查扩散到既有债
- **不转发历次报告全文**：只传「上一轮改了什么」（subagent 上下文互相隔离，但传递成本要控住）
- **模型档位**：合规审查固定 haiku（机械清单）；对抗默认 sonnet，T3 或改动面大时才上调

### 收敛判据（硬性）

```
契约 → 实现 → pnpm verify → [合规 ∥ 对抗] → 一轮修复 → 复审（仅限修复 diff）→ 提交
```

**一轮对抗 + 一轮修复 + 一次复审 = 结束。** 复审只问两件事：**修得对不对**、**有没有引入新缺陷**。

- **不再开新一轮对抗**
- 复审后仍有阻塞项 → 修掉即合并，**不允许第二次复审**
- 合并后剩余项走下面的分流表，不回头重开审查

### findings 分流

审查 agent **既不开 issue，也不做删除决定**。主智能体把两份报告合并成一张分流表，**PR 合并后一次性交给用户**，由用户决定开哪些 issue。

| finding                                   | 处理                   |
| ----------------------------------------- | ---------------------- |
| 有具体复现场景 + 影响正确性 / 数据 / 安全 | **阻塞**，本轮修       |
| 有场景、影响面小、改起来便宜              | 本轮修                 |
| 有场景、影响面小、改起来贵                | **进分流表**，等用户定 |
| 化简 / 风格 / 可读性                      | 记 PR 评论，不进展     |
| 猜测——**给不出 `输入/状态 → 错误输出`**   | **丢弃**，不算 finding |
| 既有债（非本次改动引入）                  | 记 backlog，**不阻塞** |

### 编辑权限

主智能体**直接编写业务代码**（与旧流程相反）。评审 subagent **只读、不修代码** —— 它们指出的问题由主智能体修复。

## 交付流程

**Issue（含契约 + 风险级别）→ 分支 → 实现 → `pnpm verify` → 按级别过门 → PR → CI → Squash Merge → 分流表交给用户**。

Conventional Commits 含 `Closes #<issue>`，**不要给 `Closes #N` 加反引号**——加了不触发自动关闭（#327 实测）。

常见坑：

- **sed 改代码后 prettier 格式错乱**：始终用 Edit/Write 工具
- **commitlint type 白名单**：仅 `build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test`
- **draft PR 不能 merge**：需 `gh pr ready` 后再 `gh pr merge --squash`
- **commitlint + PowerShell here-string**：`@"..."@` 多行中文 commit message 可能被解析为 subject-empty。改用 bash heredoc（`git commit -F - <<'MSG'`）或写入临时文件 `git commit -F <file>`
