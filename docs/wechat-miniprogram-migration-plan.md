# 微信小程序 + 国内后端迁移长期规划

> 状态：规划文档（2026-08-15 定稿；2026-08-19 增补 §3 技术路线对比与 §8 Taro 技术 & 操作路线）。
> 本文档指导后续 agent 执行小程序迁移，所有决策与调研结论记录于此，避免重复调研。
> 执行时如遇与本文冲突的现实，更新本文并注明原因。

## 1. 总体架构决策（已确定）

| 维度       | 决策                                                                | 理由                                                                                                                              |
| ---------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 小程序范围 | **仅 member 端**，admin 全部留在 Web                                | 甘特图/Excel 导出/排练 CRUD 是小程序重写最难的部分；管理员人数少，Web/PWA 体验更好。工作量减半                                    |
| 后端       | **MemFire Cloud**（国内 Supabase 兼容 BaaS）                        | `@supabase/supabase-js` 直接可用（换 URL+key）；有微信小程序专用 SDK（`supabase-wechat-stable-v2`）与 `signInWithWechat` 登录 API |
| 后端统一   | **Web 端与小程序的数据库同一套 MemFire 项目**                       | 避免两套后端数据分裂。Web 端迁移 = 换环境变量（成本极低），数据层代码零改动                                                       |
| 小程序框架 | **Taro（React）**，不走 web-view                                    | web-view 有硬政策风险（见 §2）；Taro 复用现有 hooks/lib 逻辑层（~80%），UI 层重写                                                 |
| React 版本 | **小程序项目定版 React 18**（与 Web 端 React 19 解耦）              | Taro 4 官方支持矩阵至 React 18；React 19 官方跟进中（issue #16996/#18329）；小程序为独立 package.json，互不影响                   |
| 编译引擎   | Taro **Webpack 5**（不用 Vite）                                     | weapp-tailwindcss 官方建议新项目用 Webpack；Taro Vite 小程序端不稳定、构建提速收益有限                                            |
| 通知       | 订阅消息（一次性订阅为主）                                          | 国内安卓无 FCM，订阅消息是唯一可靠推送通道；排练频率低（每周 1~2 次），一次性订阅够用                                             |
| 目标       | **两星期内出 demo**（登录+排练+签到+花名册），完整 member 端 3~4 周 | 用户明确要求                                                                                                                      |

## 2. web-view tradeoff 与政策风险（已调研，勿重走弯路）

### web-view 为什么不选

1. **个人主体禁用**：微信官方明确「个人类型小程序暂不支持 web-view 业务域名」（2026-04 核验）
2. **业务域名要求**：HTTPS + **ICP 备案且备案主体与小程序主体一致** + 域名根目录放微信校验文件。ICP 备案必须经国内接入商办理 → **Vercel 托管无法满足备案**，前端也要迁国内
3. 类目审核风险：纯 WebView 壳有「简易应用/套壳」拒审风险
4. 体验差：WebView 内长按保存、登录态、性能均不如原生组件

### 即使走 Taro 也要注意的政策项

| 政策项       | 要求                                                                                                                                 | 影响                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| 主体资质     | 北大乐团需挂靠学校主体（团委/学工部）注册**组织主体**                                                                                | 组织主体才有完整能力（web-view、支付、长期订阅申请资格）             |
| ICP 备案     | 若小程序内用 wx.request 直连后端域名，域名需加入 request/uploadFile/socket 合法域名白名单（MemFire 提供其域名清单）                  | 备案走国内接入商，5~20 工作日，**与开发并行启动**                    |
| UGC 内容安全 | 社区发帖属 UGC：必须接入 `security.msgSecCheck` **V2**（文本）+ `media_check_async`（图片）；**2025 年起 V1 接口在多数类目已被拒审** | V2 强制参数：真实 openid、scene、version=2；实现放云函数，不暴露密钥 |
| 订阅消息     | 一次性订阅：每授权一次发一条、7 天时效、可累计；长期订阅仅特定行业类目且模板需社区申请，排练通知场景**基本拿不到**                   | 设计为「排练发布前引导成员点一次授权」                               |
| 类目选择     | 建议「工具>信息查询」或教育类，避免社交类（UGC 审核更严、内容安全要求更高）                                                          | 类目决定模板库可选范围                                               |

## 3. 技术路线对比：为什么是 Taro（2026-08 复核）

> 复核结论：Taro 决策不变。本节记录「为什么不能直接搬」与替代路线排除理由，避免重复调研。

### 3.1 为什么现有 Web 项目不能直接搬成小程序

微信小程序不是浏览器运行时，现有 Next.js 项目三层全部失效：

| 层     | Web（现状）                                                          | 小程序                                                                   | 后果                                                 |
| ------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------- |
| 渲染层 | `react-dom` 渲染到 DOM                                               | 逻辑层（JSCore）与渲染层分离，靠 `setData` 桥接，**无 DOM/BOM**          | `div`/`document`/`window` 不存在，react-dom 无法工作 |
| 框架层 | Next.js 依赖 Node 服务端（SSR/ISR/Route Handlers/Server Components） | 只有客户端运行时，无 Node 服务端                                         | 整套服务端能力跑不起来（云函数是完全不同的集成方式） |
| 平台层 | `fetch` 任意域名、`localStorage`、现代 CSS                           | `wx.request` + 合法域名白名单、`wx.setStorage`（异步）、WXSS 是 CSS 子集 | supabase-js 浏览器端（localStorage + fetch）直接失效 |

另有三条硬约束：**主包 2MB 体积上限**（Next 全家桶直接爆）；**登录体系不同**（`wx.login` code2session vs 邮箱密码）；**原生组件层级**（input/video 永远浮于普通视图之上，遮罩需特殊处理）。

关键认知：React hooks 里的逻辑是可移植的（Taro 的存在方式就是把 React 运行时适配到 setData），但渲染层与平台适配层任何路线都绕不开。所有号称「直接搬」的方案，本质都是在小程序里再模拟一个浏览器。

### 3.2 五条路线对比

| 路线               | 原理                                                            | 代码复用               | 性能                            | 维护状态（2026-08）                                               |
| ------------------ | --------------------------------------------------------------- | ---------------------- | ------------------------------- | ----------------------------------------------------------------- |
| **Taro 4（选中）** | React 运行时适配到 setData，编译出原生 WXML/WXSS                | ~80%（hooks 照搬）     | 中（100-200ms 运行时开销）      | 活跃（4.2.0，2026-04 发布）                                       |
| 原生开发           | 直接写 WXML/WXSS/JS（GlassEasel 组件框架 2026-08 全面开放）     | ~15%（仅纯函数）       | 最优（Skyline 内存降 ~40%）     | 官方                                                              |
| uni-app x          | Vue3 语法编译为原生代码（2026 版「蒸汽模式」，已非 WebView 壳） | ~50%（逻辑翻译成 Vue） | 优（接近原生）                  | 活跃（800 万开发者生态）                                          |
| kbone              | 小程序内模拟 DOM/BOM 让 Web 框架直接跑                          | ~90%                   | 差（DOM 模拟 + setData 双桥接） | 半维护：核心构建插件 mp-webpack-plugin 停更于 ~2022，单人低频维护 |
| web-view 壳        | 小程序内嵌浏览器指向现有站点                                    | 100%                   | 中                              | —（政策死路，见 §2）                                              |

### 3.3 各路线排除理由

- **原生**：复用率致命低（hooks 全重写为 Component/Behavior 模型），是「重写」不是「迁移」，两周 demo 无望。仅当只做微信且接受全量重写时值得考虑。
- **uni-app x**：技术栈不匹配。PKUSO hooks 均为 React（useState/useEffect/竞态守卫），翻译成 Vue composition API 复用率打对折，团队需学 Vue。性能优势在排练/花名册这类低频交互场景用不上。
- **kbone**：维护风险 + React 支持二等公民。官方项目也印证「腾讯出品 ≠ 可依赖」。
- **web-view**：政策死路（见 §2）。
- **Remax / mpvue / WePY**：均已停更或社区萎缩——佐证 React 小程序路线上 Taro 是唯一活着的选择。

**性能差距的客观评估**：Taro 的 100-200ms 运行时开销只在直播弹幕/答题游戏等高频场景暴露，排练/花名册场景无感；且 Taro 产物兼容 Skyline（按页配置 `renderer: "skyline"` 渐进开启，产物格式不变），长列表卡顿时有官方逃生通道。

## 4. 微信小程序功能 API 调研（已核实）

| API                                             | 用途                                                        | 备注                                                                          |
| ----------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `wx.login` + code2session                       | 获取临时 code → openid                                      | 由 MemFire `signInWithWechat({ code })` 封装，**自动注册新用户**              |
| 头像昵称填写能力                                | `button open-type="chooseAvatar"` + `input type="nickname"` | `getUserProfile` 已废弃，不能再调用                                           |
| `getPhoneNumber` 按钮                           | 手机号授权                                                  | 仅企业/组织主体可用；配合 MemFire `wechatBindPhone`                           |
| `wx.requestSubscribeMessage`                    | 订阅消息授权                                                | 必须在用户点击事件后调用；一次最多 3 个模板                                   |
| `security.msgSecCheck` V2 / `media_check_async` | 内容安全检测                                                | 文本+图片；放云函数调用（access_token 服务端管理）                            |
| `wx.compressImage`                              | 图片压缩                                                    | 替代 browser-image-compression                                                |
| `picker` mode=date/time                         | 日期时间选择                                                | 替代 react-datepicker（原生滚轮体验更好）                                     |
| `wx.connectSocket`                              | WebSocket                                                   | MemFire SDK 的 Realtime 通道（需验证 supabase-wechat-stable-v2 是否内置适配） |

## 5. MemFire Cloud 微信能力（已核实）

- **SDK**：`supabase-wechat-stable-v2`（npm），接口与 supabase-js 一致，底层走 wx.request（无 localStorage，SDK 自带存储适配）
- **登录**：`supabase.auth.signInWithWechat({ code: wx.login 的 code })` —— code 换 openid、**用户不存在自动注册**；Web 端 OAuth 用 `signInWithOAuth`
- **手机号绑定**：`wechatBindPhone`（企业账号）
- **兼容面**：Postgres + RLS + Storage（对象存储公开 bucket）+ Realtime + 云函数；`@supabase/supabase-js` 换 URL/key 即可用于 Web 端
- **待实测项**（迁移前必须验证，MemFire 基于开源 Supabase 某版本，覆盖度有差异）：
  - [ ] 现有 migrations 全量可回放（含 enum、触发器 `trigger_rehearsal_to_schedule`、RLS 策略）
  - [ ] Realtime 在微信 SDK 下的可用性
  - [ ] Storage 公开 bucket 策略与 CORS
  - [ ] auth 触发器（注册自动建 profile）行为一致

## 6. 账号体系与「微信登录」

**决策：小程序登录 = 微信登录（`signInWithWechat`）**，自动注册的新用户 role 默认 member、status 默认 pending（沿用现有审批流：admin 在 Web 端审批）。

老成员（现有邮箱账号）绑定策略（**待定，二选一**）：

- 方案 A：成员先用邮箱密码登录 Web 端，在个人页「绑定微信」生成一次性绑定码 → 小程序输入绑定码完成 openid ↔ 老账号绑定（需调研 MemFire 是否支持账号合并/绑定 API，`wechatBindAccount` 疑似可用）
- 方案 B：抛弃老账号，全员重新用微信注册 → 重新审批（简单但成员体验差、考勤历史断链）

建议先验证 `wechatBindAccount` 的真实语义再定；demo 阶段用「自动注册新账号」即可。

## 7. 工程迁移复杂度控制策略

### 可直接复用（零改动）

- `src/lib/` 全部纯函数：`name-search.ts`（拼音搜索）、`roster-utils.ts`、`validation.ts`、`attendance-utils.ts`、`date-utils.ts`、`rehearsal-utils.ts`、`email-signature.ts` 常量
- `src/types/database.types.ts`（Postgres schema 同构，gen-types 重新生成）

### 接口层小改

- 客户端初始化：`@/lib/supabase`（supabase-js）→ `supabase-wechat-stable-v2` 的 createClient
- `alert/confirm` → `wx.showToast/wx.showModal`
- hooks 业务逻辑（查询构建、乐观更新、双重 guard、竞态守卫）照搬，仅存储/请求适配层替换

### UI 层重写（member 端 8 页）

登录、首页（排练+签到）、花名册（搜索+详情）、社区（发帖+图片+内容安全）、个人信息、日程预约（甘特图最难，demo 阶段可先只读）。

### 必须换原生替代的依赖

| Web                       | 小程序                                     |
| ------------------------- | ------------------------------------------ |
| react-datepicker          | `picker` mode=date/time                    |
| xlsx 导出（admin）        | 不涉及（admin 留 Web）                     |
| browser-image-compression | `wx.compressImage`                         |
| lucide-react              | 图标字体/静态资源                          |
| Tailwind v4               | Taro 4 + weapp-tailwindcss 插件（或 WXSS） |

## 8. Taro 技术 & 操作路线（2026-08 调研）

> 本节为落地操作手册：依赖定版 → 初始化 → Tailwind 接入 → 适配层 → 页面迁移 → 构建调试。
> 与 §7 的复用策略、§9 的 demo 计划一一对应。

### 8.1 工具链与依赖定版

| 项       | 定版                                     | 说明                                                                               |
| -------- | ---------------------------------------- | ---------------------------------------------------------------------------------- |
| Taro     | 4.2.x（2026-04 发布）                    | `@tarojs/cli` + `@tarojs/plugin-framework-react`                                   |
| React    | **18**（react/react-dom 18.3.x）         | Taro 官方支持矩阵至 React 18；React 19 官方 issue #16996/#18329 跟进中，**勿升级** |
| 编译引擎 | Webpack 5（`compiler.type: 'webpack5'`） | weapp-tailwindcss 官方建议；Taro Vite 小程序端不稳定、实测提速收益有限             |
| 样式     | Tailwind CSS v4 + weapp-tailwindcss      | 需 `weapp-tw patch` postinstall 补丁（见 8.3）                                     |
| 数据     | `supabase-wechat-stable-v2`（MemFire）   | 接口同 supabase-js，底层 wx.request + 自带存储适配                                 |
| 包管理器 | pnpm（沿用仓库惯例）                     | pnpm ≥10 需 `pnpm approve-builds weapp-tailwindcss`（见 8.3）                      |
| 状态管理 | 不用第三方库                             | 现有 hooks + React state 已够；user-context 直接移植                               |

### 8.2 初始化步骤（操作命令）

1. **工程位置**：独立目录/独立仓库，独立 package.json。不复用 Web 端依赖栈（React 18 vs 19 冲突）；同仓库时需让根目录 eslint/tsc 排除该目录
2. **脚手架**：

   ```bash
   npx @tarojs/cli init pkuso-miniprogram
   ```

   交互选项：框架 **React**；TypeScript **Yes**；CSS 预处理 Sass（可选）；模板源默认/国内镜像（网络慢时）；模板「默认模板」。项目名小写+中划线

3. **微信开发者工具** + AppID 准备：无正式号先用「测试号」（限制：订阅消息/手机号授权等能力不可用，正式开发需组织主体 AppID）
4. 安装依赖（pnpm install 后补 postinstall 补丁，见 8.3）
5. `src/app.config.ts` 注册页面 + tabBar（首页/日程/社区/我的，与 member 端一致）

### 8.3 Tailwind CSS v4 接入（关键坑）

1. 安装：`pnpm add -D tailwindcss @tailwindcss/postcss weapp-tailwindcss`（tailwindcss 用 v4）
2. `package.json` 加 `"postinstall": "weapp-tw patch"`（给 tailwindcss@4 打 rpx 补丁，否则 rpx 被当作颜色报错）
3. **pnpm ≥10 必须执行 `pnpm approve-builds weapp-tailwindcss`**，否则 postinstall 脚本被拦
4. Tailwind 入口放**纯 `.css` 文件**（如 `src/app.css`），不要写在 Sass/Less 入口：

   ```css
   @import "tailwindcss" source(none);
   @source "../src";
   ```

   `source(none)` 关闭默认自动扫描，只按 `@source` 扫描 src/

5. `config/index.ts` 的 `mini`（与 h5）里 webpackChain 注册插件，`cssEntries` 必须绝对路径：

   ```js
   const { WeappTailwindcss } = require("weapp-tailwindcss/webpack");

   mini: {
     webpackChain(chain) {
       chain.merge({
         plugin: {
           install: {
             plugin: WeappTailwindcss,
             args: [{ rem2rpx: true, cssEntries: [path.resolve(__dirname, "../src/app.css")] }],
           },
         },
       });
     },
   }
   ```

   注意：只注册 WeappTailwindcss，**不要再注册** tailwindcss / @tailwindcss/postcss（小程序构建）

6. tokens.css 的 21 对语义色平移到小程序 Tailwind 配置（rem2rpx 已开，设计稿 375 对齐）

### 8.4 迁移操作顺序（复用 → 小改 → 重写）

按依赖方向自底向上：

1. **零改动复制**（§7 清单）：`src/lib/` 纯函数 + `database.types.ts`（对 MemFire 重新 gen-types）
2. **适配层小改**：
   - `@/lib/supabase` → `supabase-wechat-stable-v2` 的 createClient（MemFire URL/key）
   - `alert/confirm` → `Taro.showToast/Taro.showModal`（收敛成统一封装，勿散落各处）
   - 存储：SDK 自带适配（无 localStorage 环境）
3. **UI 原语重写**（Taro 版，先做这四个再写页面）：
   - Modal：底部弹层惯例（position="bottom"）、headerExtra、inert 隔离改为条件渲染 + catchMove 方案（小程序无 inert 属性）
   - Toast / Card / Toggle
   - 注意原生组件层级：input/textarea 会穿透遮罩，弹层打开时先失焦/隐藏输入
4. **hooks 移植**：业务逻辑照搬（双重 guard、竞态守卫、0 行检测模式原样保留），仅替换依赖项：
   - react-datepicker → `picker` mode=date/time
   - browser-image-compression → `wx.compressImage`
   - lucide-react → 图标字体/静态资源
   - `URL.createObjectURL` 预览 → 小程序临时文件路径（`wx.chooseMedia`），无 blob revoke 问题

### 8.5 页面迁移映射（member 端）

| Web 路由                     | 小程序页面      | 复用                                      | demo 阶段                |
| ---------------------------- | --------------- | ----------------------------------------- | ------------------------ |
| `/login`                     | pages/login     | 无（新写）                                | ✅                       |
| `/`（排练+签到）             | pages/home      | useRehearsals、rehearsal-utils、canSignIn | ✅                       |
| `/members`                   | pages/members   | useProfiles、name-search                  | ✅（第 2 周）            |
| `/schedule`                  | pages/schedule  | useSchedule                               | 只读甘特图               |
| `/profile`                   | pages/profile   | useProfiles、validation                   | ✅（第 2 周）            |
| `/community`                 | pages/community | usePosts、useNotifications                | ❌（3~4 周，含内容安全） |
| `/reset-password` 等 auth 页 | 小程序端不需要  | —                                         | —                        |

注：member tab bar 5 个入口中「社区」demo 阶段可占位。

### 8.6 构建、调试、提审流程

```bash
pnpm dev:weapp     # 监听编译 → dist/
pnpm build:weapp   # 生产构建
```

1. 微信开发者工具：新建项目 → 目录选 **Taro 项目根目录**（模板自带 project.config.json，miniprogramRoot 指向 dist；无此文件则直接选 dist）→ 填 AppID
2. 工具设置：**关闭**「ES6 转 ES5」「上传代码时样式自动补全」「代码压缩上传」
3. 样式类不生效时：检查开发者工具「代码自动热重载」，关闭后重新预览
4. 真机预览（开发版二维码）→ 上传体验版 → 提交审核（类目材料、UGC 说明见 §2）

### 8.7 已知坑清单（操作前必读）

1. **React 19 不可用**：Taro 4 官方仅 React 18，升级即编译报错（react-jsx-runtime exports）
2. **Tailwind v4 两件套**：`weapp-tw patch` postinstall + pnpm approve-builds，缺一 rpx 报错
3. **主包 2MB**：Tailwind WXSS + 图标控体积；社区图片走 Storage 外链；超限用分包
4. **WXSS 子集**：`*` 选择器、部分现代 CSS 不可用；weapp-tailwindcss 已自动处理 oklch→rgb、类名转义、@layer 展平，自定义样式需自查
5. **依赖 window/document 的 npm 包直接报错**：引入依赖前先查兼容性（业界经验：适配成本约占总开发量 15-20%）
6. **axios 不可用**：一律 `Taro.request`（supabase SDK 已封装）
7. **域名白名单**：MemFire 域名加入 request/uploadFile/socket 合法域名（§2 政策项）
8. **性能逃生通道**：长列表/高频交互卡顿时按页配置 `renderer: "skyline"`（Taro 产物兼容 Skyline；注意 Skyline 下 WXSS 更受限、页面需 navigationStyle: custom）

## 9. 两星期 demo 计划（关键路径）

> 行政项（§2 的主体/备案）**第一天就启动**，与技术并行。

### 第 0 周（并行启动，1 天）

- [ ] 学校团委确认组织主体注册可行性（阻塞项，越早越好）
- [ ] MemFire 注册项目；现有 migrations 回放验证 + RLS 策略迁移 + 数据搬运（auth 用户密码哈希不可搬，老成员走 §6 绑定策略）
- [ ] Web 端试点切 MemFire（换环境变量，全量回归）——先验证兼容性，再动小程序

### 第 1 周（demo 骨架 + 登录 + 核心页）

- [ ] Taro 项目初始化（React + TS），tabBar 结构（操作步骤见 §8）
- [ ] supabase-wechat-stable-v2 接入 + `signInWithWechat` 登录 + 会话持久化
- [ ] UI 原语：Modal（底部弹层）/Toast/Card/Toggle 小程序版
- [ ] 首页：排练列表（一周窗口复用 `rehearsal-utils`）+ 签到（签到码弹窗、canSignIn 逻辑复用）

### 第 2 周（成员价值闭环）

- [ ] 花名册：声部分组 + 拼音搜索（`name-search` 直接复用）+ 声部长徽章
- [ ] 个人信息：编辑联系方式/学院（复用 `validation`）
- [ ] 订阅消息：排练发布 → 触发授权弹窗 → 云函数发通知（一次性订阅模式）
- [ ] 真机联调 + 内部体验版

### 第 3~4 周（完整 member 端，demo 后）

- [ ] 社区发帖（`msgSecCheck` V2 + `media_check_async` 内容安全）
- [ ] 日程预约（甘特图重写）
- [ ] 提交审核（类目材料、UGC 说明、用户协议）

## 10. 风险清单

| 风险                                 | 等级 | 缓解                                                  |
| ------------------------------------ | :--: | ----------------------------------------------------- |
| 学校主体注册流程漫长（组织资质）     |  高  | 第 0 周启动；期间用体验版+测试号开发                  |
| MemFire 功能覆盖度与 Supabase 有差异 |  高  | 第 0 周全量回放 migrations + Realtime/Storage 实测    |
| UGC 审核被拒（内容安全）             |  中  | 严格按 V2 接口 + 真实 openid 测试；类目选工具类       |
| 老账号 → 微信绑定方案不可行          |  中  | 先验证 `wechatBindAccount`；退路为方案 B 重注册       |
| 国内 Supabase 替代品合规/稳定性      |  中  | MemFire 为社区验证方案；自部署 Supabase 为退路        |
| 小程序主包 2MB 限制                  |  中  | Tailwind WXSS + 图标控体积；分包；图片走 Storage 外链 |
| Taro React 19 兼容（官方跟进缓慢）   |  低  | 小程序项目 React 18 定版，不依赖官方跟进（§1）        |
| weapp-tailwindcss 上游维护           |  低  | 社区活跃；退路为手写 WXSS（UI 原语数量可控）          |
| Taro 运行时性能（100-200ms 开销）    |  低  | 低频交互场景无感；长列表按页开启 Skyline（§8.7）      |
| 订阅消息模板审核                     |  低  | 提前在模板库选「活动提醒」类模板                      |

## 11. 验收标准

- **Demo（2 周）**：真机上微信登录 → 看到一周排练 → 合排签到成功（Admin Web 端可见考勤）→ 花名册搜索「王子轩」=wzx 命中
- **完整版（4 周）**：member 端全功能 + 内容安全 + 订阅消息 + 提交审核

## 12. 参考来源（调研结论出处）

- MemFire 身份验证文档（signInWithWechat）：https://docs.memfiredb.com/docs/app/development_guide/auth/authentication/
- MemFire 微信 SDK：https://github.com/MemFire-Cloud/supabase-wechat-stable-v2
- web-view 业务域名政策（个人主体禁用、备案要求）：https://www.kufanyun.com/ask/659527.html
- 订阅消息规则（一次性/长期、模板限制）：https://www.bookstack.cn/read/miniprogram-202505/890bc6ff2c244ed7.md
- UGC 内容安全 msgSecCheck V2（2025 起 V1 拒审）：https://yidun.csdn.net/6942521b5b9f5f317819a9b9.html
- Taro React 小程序路线与限制：https://global.v2ex.co/t/1118982
- Supabase 国内延迟实测与自部署：https://cloud.tencent.cn/developer/article/2587891
- EdgeOne Pages（Next.js 国内部署、免备案域名）：https://www.vvhan.com/article/edgeone-pages-vs-cloudflare
- Taro 4.2.0 发布（2026-04）：http://tool.pfan.cn/article/aff8ea99.html
- Taro 官方 issue #16996（支持 React 19）：https://github.com/NervJS/taro/issues/16996
- Taro 官方 issue #18329（renderReactRoot 不支持 React 19）：https://github.com/NervJS/taro/issues/18329
- vite-plugin-taro（React 19 替代路线，不推荐）：https://www.npmjs.com/package/vite-plugin-taro
- weapp-tailwindcss（Tailwind v4 支持）：https://github.com/sonofmagic/weapp-tailwindcss
- weapp-tailwindcss Taro webpack 接入文档：https://v4.tw.icebreaker.top/docs/quick-start/v4/taro-webpack
- Taro 初始化到微信小程序运行实战：https://ecweb.ecer.com/topic/cn/detail-286041-taro_simplifies_wechat_mini_program_development.html
- kbone 维护状态报告（mp-webpack-plugin 停更于 2022）：https://zread.ai/Tencent/kbone/5-latest-updates-and-status
- Taro vs uni-app 2026 实战选型：https://cloud.tencent.com.cn/developer/article/2667283
- Skyline 渲染引擎详解：https://www.e-com-net.com/article/1723262302192480256.htm
- glass-easel 组件框架 2026-08 全面开放：https://www.jzl.com/industry-news/glass-easel
