# Supabase 类型同步 — 操作指南

> Phase 1.5:当此文件中的步骤完成后,手动维护的 `src/types/database.ts` 应被自动生成的 `database.types.ts` 取代。

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
