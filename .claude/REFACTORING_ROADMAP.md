# 渐进式重构路线图

> 2026-07-19 基于全仓审计(CLAUDE.md 历史:原 refactor 分支已放弃,工程基线已并入 main)

## 现状诊断

### 量化指标

| 指标               | 数值                                                         |
| ------------------ | ------------------------------------------------------------ |
| 最大单文件行数     | 943 (schedule-page.tsx)                                      |
| 同一类型重复定义   | `ProfileRow` × 4、`RehearsalRow` × 3、`INSTRUMENT_ORDER` × 3 |
| Modal 遮罩模式重复 | 10+ 处                                                       |
| Toggle 组件重复    | 4 处                                                         |
| 自定义 Hooks       | 0                                                            |
| `use client` 占比  | 除 layout/layout+route handler 外的所有页面                  |

### 核心病症

1. **God Components**：3 个文件(`schedule-page.tsx`/`page.tsx`/`community-page.tsx`)各自承担 5+ 个职责,UI+数据+业务逻辑混在单文件中
2. **零数据 Hook 抽象**：每个组件直接 `import { supabase }` 裸写 SQL,无复用/去重/缓存层
3. **Admin/Member UI 混杂**：通过条件渲染而非路由分离,`profile/page.tsx` 内含管理员控制台
4. **类型碎片化**：同一个 Supabase 表在不同文件中定义了不一致的 TypeScript 类型

### 做得好的地方

- `UserContext` Provider 模式干净、类型安全
- `TabBar` 组件职责清晰
- TypeScript strict + ESLint/Prettier 门禁已建立
- 工程基线(pnpm/husky/CI/vitest)已贯通

---

## Phase 1: 类型与常量中心(~1h, 低风险)

### 目标

消除重复定义,建立单一可信源

### 产出

```
src/
├── types/
│   └── database.ts          ← 全仓唯一的 Profile/Rehearsal/Attendance/Post/Announcement 类型
├── constants/
│   └── instruments.ts       ← INSTRUMENT_ORDER 常量(24 声部)
```

### 改动文件

| 文件                                | 改动                                                     |
| ----------------------------------- | -------------------------------------------------------- |
| `src/types/database.ts`             | 新建,集中所有表行类型                                    |
| `src/constants/instruments.ts`      | 新建,只含 INSTRUMENT_ORDER                               |
| `src/app/(auth)/signup/page.tsx`    | 删除内置 INSTRUMENT_OPTIONS,import                       |
| `src/app/page.tsx`                  | 删除内置 INSTRUMENT_ORDER/ProfileRow/RehearsalRow,import |
| `src/app/members/page.tsx`          | 删除内置 INSTRUMENT_ORDER/ProfileRow,import              |
| `src/app/profile/page.tsx`          | 删除内置 ProfileRow,import                               |
| `src/components/auth-gate.tsx`      | 删除内置 ProfileData,import                              |
| `src/components/community-page.tsx` | 删除内置 PostRow/FormState,import                        |
| `src/components/schedule-page.tsx`  | 删除内置 RehearsalRow,import                             |

### 验证

`pnpm typecheck` 全绿

---

## Phase 1.5: Supabase 类型自动生成(~30min, 需人工登录)

### 目标

以自动生成的 `database.types.ts` 取代手写的 `database.ts`,实现 DB schema ↔ 代码零延迟同步。

### 背景

项目已安装 `supabase` CLI(devDependency),`package.json` 已有 `gen-types` 脚本。详细操作指南见 `.claude/SUPABASE_TYPE_SYNC.md`。

### 关键步骤

1. `npx supabase login` → 浏览器授权
2. `npx supabase link --project-ref <ref>` → 关联项目
3. `pnpm gen-types` → 生成 `src/types/database.types.ts`
4. 将 `supabase` 客户端泛型化(`createClient<Database>`)
5. 删除手写 `src/types/database.ts`,迁移 import 到 `database.types.ts`

### 完成后效果

- Supabase 改字段 → `pnpm gen-types` → tsc 自动标出所有需要适配的地方
- insert/update 参数也经类型校验,字段名拼错会编译报错

---

## Phase 2: 数据 Hooks 抽取(~2h, 中风险)

### 目标

组件不再直接 import supabase;数据获取逻辑统一、可测试

### 产出

```
src/hooks/
├── useRehearsals.ts    ← supabase.from("rehearsals").select(...)
├── useAttendance.ts    ← attendances CRUD
├── usePosts.ts         ← posts CRUD
├── useProfiles.ts      ← profiles CRUD
├── useAnnouncements.ts ← announcement fetch/publish
└── useAuth.ts          ← 从 auth-gate 中抽出 supabase.auth 逻辑
```

### 统一接口

```ts
type AsyncState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  mutate: () => Promise<void>;
};
```

每个 hook 返回 `AsyncState<T>` + 对应的 CRUD 方法

### 改动文件

每个现有页面/组件的 `supabase.from(...)` 调用替换为对应 hook

---

## Phase 3: UI 原语抽取(~1.5h, 低风险)

### 目标

消除 10+ 处 Modal/Toggle/Card/Button 复制粘贴

### 产出

```
src/components/ui/
├── Modal.tsx       ← 通用弹窗壳(遮罩+关闭+内容区)
├── Toggle.tsx      ← 合排/分排、重奏/团建 是同一个组件
├── Card.tsx        ← 标准卡片容器(rounded-2xl border)
└── Button.tsx      ← 按钮变体(primary/secondary/danger)
```

### 样式对齐

复用现有 Tailwind 类体系(与 `colors.css` 一致),不引入新的颜色方案

---

## Phase 4: 拆分 God Components(~3-4h, 中高风险)

### 目标

每个巨型文件拆为 1 个 page(编排) + N 个独立 component + 1 个 hook

### schedule-page.tsx (943 行 → 6 文件)

```
src/app/(schedule)/
├── page.tsx                 ← ~50 行,编排
├── components/
│   ├── RehearsalCard.tsx    ← 单张排练卡片(~60 行)
│   ├── CheckInButton.tsx    ← 签到按钮+签到码弹窗(~120 行)
│   ├── AttendanceModal.tsx  ← 考勤查看弹窗(~80 行)
│   └── CreateRehearsalModal.tsx ← 发布/编辑表单(~200 行)
```

### community-page.tsx (663 行 → 4 文件)

```
src/app/community/
├── page.tsx                 ← ~40 行
├── components/
│   ├── PostCard.tsx         ← ~80 行
│   ├── PostDetailModal.tsx  ← ~100 行
│   └── PublishPostModal.tsx ← ~200 行
```

### page.tsx (838 行, Home)

- 删除与 schedule-page.tsx 重复的考勤管理
- 删除重复的排练发布 Modal
- 仅保留:公告 Banner + 排练日程展示 + 团员签到入口

### auth-gate.tsx (220 行 → 2 文件)

```
src/components/
├── auth-gate.tsx            ← ~80 行,仅 UI 逻辑
src/hooks/
└── useAuth.ts               ← ~140 行,session+profile 数据逻辑
```

---

## Phase 5: Admin/Member 路由分离(~2h, 中风险)

### 目标

通过路由自然隔离权限,不再依赖组件内条件渲染

### 产出

```
src/app/
├── (main)/                  ← member 端
│   ├── page.tsx             ← 排练日程(展示+签到)
│   ├── community/
│   │   ├── page.tsx
│   │   └── components/
│   └── profile/
│       └── page.tsx         ← 仅个人信息+密码修改
├── admin/                   ← admin 端
│   ├── page.tsx             ← 管理员控制台(审批+公告)
│   ├── members/
│   │   └── page.tsx         ← 考勤统计+花名册
│   └── rehearsals/
│       └── page.tsx         ← 排练发布管理
```

### 权限控制

- Layout 层做 admin 路由保护(复用 `useUser().role`)
- 后端:已有 RLS 策略,前端做路由级重定向即可

---

## Phase 6: 数据层升级(远期,后续决策)

### 候选方向

| 方案                                | 成本                         | 收益                             |
| ----------------------------------- | ---------------------------- | -------------------------------- |
| **TanStack Query**                  | 中(需改所有 hook)            | 缓存/去重/重试/乐观更新/DevTools |
| **SWR**                             | 低(API 简洁,Vercel 团队维护) | 缓存/去重/重试/轻量              |
| **Server Components**               | 高(改造全仓架构)             | SEO+首屏性能(本项目不太需要)     |
| 保持现有 effect 模式 + hooks 薄封装 | 零                           | 比现状好,不锁定框架              |

**建议**:Phase 2 完成后评估。如果数据量不大(乐团 ~100 人),SWR 的低成本方案最合适。

---

## 实施原则

- **每 Phase 一个分支**,合并回 main 后验证 CI 全绿再开始下一 Phase
- **不跨 Phase 混合改动**——保持每个 PR 小而聚焦(< 400 行优先)
- Phase 1-3 是"安全重构"(不改行为),Phase 4-5 是"结构重构"(会影响文件组织)
- 每个 Phase 完成后允许停止:增量收益即可用,不必一次做完
