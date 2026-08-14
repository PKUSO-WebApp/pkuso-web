# 微信小程序 + 国内后端迁移长期规划

> 状态：规划文档（2026-08-15 定稿）。本文档指导后续 agent 执行小程序迁移，
> 所有决策与调研结论记录于此，避免重复调研。执行时如遇与本文冲突的现实，
> 更新本文并注明原因。

## 1. 总体架构决策（已确定）

| 维度       | 决策                                                                | 理由                                                                                                                              |
| ---------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 小程序范围 | **仅 member 端**，admin 全部留在 Web                                | 甘特图/Excel 导出/排练 CRUD 是小程序重写最难的部分；管理员人数少，Web/PWA 体验更好。工作量减半                                    |
| 后端       | **MemFire Cloud**（国内 Supabase 兼容 BaaS）                        | `@supabase/supabase-js` 直接可用（换 URL+key）；有微信小程序专用 SDK（`supabase-wechat-stable-v2`）与 `signInWithWechat` 登录 API |
| 后端统一   | **Web 端与小程序的数据库同一套 MemFire 项目**                       | 避免两套后端数据分裂。Web 端迁移 = 换环境变量（成本极低），数据层代码零改动                                                       |
| 小程序框架 | **Taro（React）**，不走 web-view                                    | web-view 有硬政策风险（见 §2）；Taro 复用现有 hooks/lib 逻辑层（~80%），UI 层重写                                                 |
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

## 3. 微信小程序功能 API 调研（已核实）

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

## 4. MemFire Cloud 微信能力（已核实）

- **SDK**：`supabase-wechat-stable-v2`（npm），接口与 supabase-js 一致，底层走 wx.request（无 localStorage，SDK 自带存储适配）
- **登录**：`supabase.auth.signInWithWechat({ code: wx.login 的 code })` —— code 换 openid、**用户不存在自动注册**；Web 端 OAuth 用 `signInWithOAuth`
- **手机号绑定**：`wechatBindPhone`（企业账号）
- **兼容面**：Postgres + RLS + Storage（对象存储公开 bucket）+ Realtime + 云函数；`@supabase/supabase-js` 换 URL/key 即可用于 Web 端
- **待实测项**（迁移前必须验证，MemFire 基于开源 Supabase 某版本，覆盖度有差异）：
  - [ ] 现有 migrations 全量可回放（含 enum、触发器 `trigger_rehearsal_to_schedule`、RLS 策略）
  - [ ] Realtime 在微信 SDK 下的可用性
  - [ ] Storage 公开 bucket 策略与 CORS
  - [ ] auth 触发器（注册自动建 profile）行为一致

## 5. 账号体系与「微信登录」

**决策：小程序登录 = 微信登录（`signInWithWechat`）**，自动注册的新用户 role 默认 member、status 默认 pending（沿用现有审批流：admin 在 Web 端审批）。

老成员（现有邮箱账号）绑定策略（**待定，二选一**）：

- 方案 A：成员先用邮箱密码登录 Web 端，在个人页「绑定微信」生成一次性绑定码 → 小程序输入绑定码完成 openid ↔ 老账号绑定（需调研 MemFire 是否支持账号合并/绑定 API，`wechatBindAccount` 疑似可用）
- 方案 B：抛弃老账号，全员重新用微信注册 → 重新审批（简单但成员体验差、考勤历史断链）

建议先验证 `wechatBindAccount` 的真实语义再定；demo 阶段用「自动注册新账号」即可。

## 6. 工程迁移复杂度控制策略

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

## 7. 两星期 demo 计划（关键路径）

> 行政项（§2 的主体/备案）**第一天就启动**，与技术并行。

### 第 0 周（并行启动，1 天）

- [ ] 学校团委确认组织主体注册可行性（阻塞项，越早越好）
- [ ] MemFire 注册项目；现有 migrations 回放验证 + RLS 策略迁移 + 数据搬运（auth 用户密码哈希不可搬，老成员走 §5 绑定策略）
- [ ] Web 端试点切 MemFire（换环境变量，全量回归）——先验证兼容性，再动小程序

### 第 1 周（demo 骨架 + 登录 + 核心页）

- [ ] Taro 项目初始化（React + TS），tabBar 结构
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

## 8. 风险清单

| 风险                                 | 等级 | 缓解                                               |
| ------------------------------------ | :--: | -------------------------------------------------- |
| 学校主体注册流程漫长（组织资质）     |  高  | 第 0 周启动；期间用体验版+测试号开发               |
| MemFire 功能覆盖度与 Supabase 有差异 |  高  | 第 0 周全量回放 migrations + Realtime/Storage 实测 |
| UGC 审核被拒（内容安全）             |  中  | 严格按 V2 接口 + 真实 openid 测试；类目选工具类    |
| 老账号 → 微信绑定方案不可行          |  中  | 先验证 `wechatBindAccount`；退路为方案 B 重注册    |
| 国内 Supabase 替代品合规/稳定性      |  中  | MemFire 为社区验证方案；自部署 Supabase 为退路     |
| 订阅消息模板审核                     |  低  | 提前在模板库选「活动提醒」类模板                   |

## 9. 验收标准

- **Demo（2 周）**：真机上微信登录 → 看到一周排练 → 合排签到成功（Admin Web 端可见考勤）→ 花名册搜索「王子轩」=wzx 命中
- **完整版（4 周）**：member 端全功能 + 内容安全 + 订阅消息 + 提交审核

## 10. 参考来源（调研结论出处）

- MemFire 身份验证文档（signInWithWechat）：https://docs.memfiredb.com/docs/app/development_guide/auth/authentication/
- MemFire 微信 SDK：https://github.com/MemFire-Cloud/supabase-wechat-stable-v2
- web-view 业务域名政策（个人主体禁用、备案要求）：https://www.kufanyun.com/ask/659527.html
- 订阅消息规则（一次性/长期、模板限制）：https://www.bookstack.cn/read/miniprogram-202505/890bc6ff2c244ed7.md
- UGC 内容安全 msgSecCheck V2（2025 起 V1 拒审）：https://yidun.csdn.net/6942521b5b9f5f317819a9b9.html
- Taro React 小程序路线与限制：https://global.v2ex.co/t/1118982
- Supabase 国内延迟实测与自部署：https://cloud.tencent.cn/developer/article/2587891
- EdgeOne Pages（Next.js 国内部署、免备案域名）：https://www.vvhan.com/article/edgeone-pages-vs-cloudflare
