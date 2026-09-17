# Admin 端扁平化导航重构计划

## 目标

去掉底部 Tab Bar，将首页改造为功能入口网格（2列卡片），点击卡片导航到对应功能页面。

## 核心业务入口清单（13个）

| #   | 入口名称   | 路由路径                | 图标           | 徽章        |
| --- | ---------- | ----------------------- | -------------- | ----------- |
| 1   | 入团审批   | /admin/approval         | UserCheck      | ✅ 待审批数 |
| 2   | 请假审批   | /admin/leave            | CalendarCheck  | ✅ 待审批数 |
| 3   | 公告管理   | /admin/announcements    | Megaphone      | —           |
| 4   | 排练管理   | /admin/rehearsals       | Music          | —           |
| 5   | 排练房预约 | /admin/schedule         | Calendar       | —           |
| 6   | 考勤管理   | /admin/attendance       | ClipboardList  | —           |
| 7   | 成员花名册 | /admin/roster           | UsersRound     | —           |
| 8   | 社区管理   | /admin/community        | MessagesSquare | —           |
| 9   | 邀请码管理 | /admin/invitation-codes | Key            | —           |
| 10  | 系统通知   | /admin/system-notify    | Bell           | —           |
| 11  | 反馈查看   | /admin/feedback         | MessageSquare  | —           |
| 12  | 邮件签名   | /admin/email-signature  | Mail           | —           |
| 13  | 数据导入   | /admin/config/import    | Upload         | —           |

## 布局调整

- 移除：`admin/layout.tsx` 底部 Tab Bar
- 新增：右上角用户菜单（头像下拉）→ 含「设置」「退出登录」
- 首页：`admin/page.tsx` 重写为 2 列网格卡片，徽章并行查询
- Profile 页：精简为仅显示头像/姓名/邮箱卡片，无分组标题，设置入口归入右上角菜单

## 路由新增（8个页面拆分自原聚合页）

```
admin/approval/page.tsx         ← 从控制台拆出
admin/leave/page.tsx            ← 从控制台拆出（复用 LeaveManagement）
admin/announcements/page.tsx    ← 从控制台拆出
admin/attendance/page.tsx       ← 从 members 拆出
admin/roster/page.tsx           ← 从 members 拆出
admin/invitation-codes/page.tsx ← 从 profile 拆出
admin/system-notify/page.tsx    ← 从 profile 拆出
admin/feedback/page.tsx         ← 从 profile 拆出
admin/email-signature/page.tsx  ← 从 profile 拆出
```

## 兼容性

- 旧深链 `/admin?tab=leave` → 302 重定向到 `/admin/leave`
- 现有 hooks/components 最大程度复用，不重写业务逻辑

## 分支策略

- 创建分支 `refactor/admin-flat-navigation`
- 所有提交在本地，验收通过前不推送远程

## 实施步骤

### 步骤 1：创建 FeatureCard 组件

- 文件：`src/app/admin/components/FeatureCard.tsx`
- 接口：title, href, icon, badgeCount?, description?, badgeMax?

### 步骤 2：新建 8 个拆分页面路由文件（空壳）

- 创建目录和 page.tsx 文件

### 步骤 3：迁移控制台 3-tab 逻辑

- approval/page.tsx：入团审批逻辑
- leave/page.tsx：请假审批逻辑（复用 LeaveManagement）
- announcements/page.tsx：公告管理逻辑

### 步骤 4：拆分 members 双视图

- attendance/page.tsx：考勤管理视图
- roster/page.tsx：成员花名册视图

### 步骤 5：拆分 profile 4 项业务

- invitation-codes/page.tsx
- system-notify/page.tsx
- feedback/page.tsx
- email-signature/page.tsx

### 步骤 6：重写 admin/layout.tsx

- 移除底部 Tab Bar
- 添加右上角用户菜单

### 步骤 7：重写 admin/page.tsx

- 网格首页 + 徽章并行查询
- 旧深链重定向逻辑

### 步骤 8：精简 admin/profile/page.tsx

- 仅个人信息卡片

### 步骤 9：验证

- pnpm verify 全绿
- 手工验证所有入口跳转、功能完整

## 待确认项（已确认）

1. 用户菜单位置：右上角 ✅
2. 卡片列数：2列 ✅
3. 最近访问/常用功能动态排序：暂不做 ✅
4. Profile 页个人信息卡片：不需要，仅头像/姓名/邮箱 ✅
