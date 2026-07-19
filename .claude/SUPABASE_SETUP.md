# Supabase 重建指南

> 原仓库被冻结后,按此指南在 10 分钟内重建完整后端

## 1. 创建新 Supabase 项目

1. 打开 [supabase.com/dashboard](https://supabase.com/dashboard)
2. 新建项目 → 填入名称(如 `pkuso-web`)、设置数据库密码、选择最近区域
3. 等待项目初始化(~2 分钟)

## 2. 运行数据库初始化

1. 进入新项目的 **SQL Editor**
2. 打开本仓库的 `supabase/migration.sql`
3. 全选 → Run(Ctrl+Enter)

## 3. 创建 Storage Bucket

1. 左侧菜单 → **Storage**
2. 新建 bucket:名称 `community-images`,勾选 **Public bucket**
3. 在 **Policies** 页为 `community-images` 添加:
   - SELECT: `true`(所有人可查看)
   - INSERT: `auth.role() = 'authenticated'`(登录用户可上传)

## 4. 配置 Auth

1. 左侧菜单 → **Authentication** → **Providers**
2. 确认 Email 提供商已启用
3. 可选:关闭 **Confirm email**(注册后直接可用,适合内部系统)
4. **Email Templates** 可选自定义

## 5. 设置第一个管理员

1. SQL Editor → New query:
   ```sql
   update public.profiles set role = 'admin' where email = '你的邮箱';
   ```
2. 你的账号需先通过注册页面注册

## 6. 配置环境变量

将新项目的密钥填入 `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
RESEND_API_KEY=<你的 Resend API key>
```

Project ref 和密钥在 **Settings** → **API** 页面。

## 7. 验证

```bash
pnpm dev       # 启动
pnpm gen-types # 生成类型(scoop 安装 supabase CLI 后)
pnpm verify    # 全量检查
```

访问 http://localhost:3000 → 注册 → 设 admin → 测试发布排练和考勤。
