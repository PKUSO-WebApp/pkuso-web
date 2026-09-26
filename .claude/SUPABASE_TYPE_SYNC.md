# Supabase 类型同步 — 操作指南

> ⚠️ **2026-09-27：这条已作废** —— 手写层 `src/types/database.ts` **保留**，并作为取 `Database`/表类型的**单一入口**（pkuso-web#314）。下面保留原文只为存档。
>
> Phase 1.5(原计划):当此文件中的步骤完成后,手动维护的 `src/types/database.ts` 应被自动生成的 `database.types.ts` 取代。

## 背景

`refactor/phase-1-types-constants` 分支已安装 `supabase` CLI(devDependency)并添加了 `gen-types` 脚本。以下步骤需你在本地交互完成(需要 Supabase 登录凭据)。

## ⚠️ Windows 安装

Supabase CLI 的 npm 包不支持 Windows。请用以下方式安装独立 CLI:

```powershell
# 方式 A: Scoop (推荐)
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase

# 方式 B: 直接下载
# 下载 .exe 放到 PATH 目录: https://github.com/supabase/cli/releases
```

安装后验证: `supabase --version`

## 步骤

### 1. 登录 Supabase CLI

```bash
supabase login
```

会打开浏览器 → 选择你的 Supabase 账号 → 生成 access token。

### 2. 关联项目

```bash
supabase link --project-ref <你的 project-ref>
```

Project ref 在 Supabase Dashboard → Settings → General → Reference ID,格式类似 `abcdefghijklmnopqrst`。

### 3. 生成类型文件

```bash
pnpm gen-types
```

会在 `src/types/database.types.ts` 生成完整的数据库 schema 类型。

### 4. 验证

```bash
pnpm typecheck
```

应 0 错误。

## 后续工作流

之后每次在 Supabase Dashboard 修改了表结构(加字段/改类型/加表):

```bash
pnpm gen-types  # 重新生成类型
pnpm typecheck  # 检查哪些代码需要适配新 schema
```

## 从手写类型迁移到自动类型(Phase 1 完成后的下一步)

> ⚠️ **2026-09-27 现状：下面第 2 步没有执行，而且已经被反过来定死。**
> 手写层 `src/types/database.ts` **保留**，并作为「要 `Database` 泛型或表类型时从这一层拿」的
> **单一入口**（`src/lib/supabase.ts` / `src/lib/supabase-server.ts` 也已改走它，不再直接 import
> 生成文件 —— 那条「单一入口」的 docblock 在 `src/types/database.ts` 里）。
> **第 2/3 步是当时的计划，别再照着做。**
> 第 1 步代码片段里的 import 路径同样以手写层为准：`@/types/database`（不是 `@/types/database.types`）。

生成 `database.types.ts` 后:

1. 将 Supabase 客户端泛型化:

```ts
// src/lib/supabase.ts
import type { Database } from "@/types/database.types";
export const supabase = createClient<Database>(url, key);
```

2. 删除手写的 `src/types/database.ts`,所有 import 改为 `@/types/database.types`

3. 类型使用方式:
   - `Database['public']['Tables']['profiles']['Row']` 替代手写 `ProfileRow`
   - 或在 `database.types.ts` 底部导出便捷别名:
     ```ts
     export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
     ```

4. 好处:insert/update 参数也自动校验,字段不匹配会编译报错。
