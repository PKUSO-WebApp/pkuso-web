# 项目 Skills(给人看的说明)

每个子目录一个技能:`<名字>/SKILL.md`。frontmatter 必须含 `name` 和 `description`;`description` 要写清**触发时机**,Claude 据此决定何时自动调用,也可用 `/<名字>` 手动调用。

现有技能:

| 技能                               | 用途                                           |
| ---------------------------------- | ---------------------------------------------- |
| `verify`                           | 改动后的验证流程(pnpm verify + 实际跑一遍)     |
| `save-lesson`                      | 会话经验分流沉淀到 CLAUDE.md / skills / memory |
| `mailpit`                          | 启动 Mailpit 容器 —— **当前休眠**,无测试使用   |
| `supabase-postgres-best-practices` | Postgres 查询/schema 优化(外部引入,未改动)     |
| `vercel-react-best-practices`      | React / Next.js 性能优化(外部引入,未改动)      |
| `web-design-guidelines`            | Web 界面规范审查(外部引入,未改动)              |

另有 `.claude/agents/` 下的评审 subagent 定义(`pkuso-reviewer`、`pkuso-adversary`)。

添加新技能:直接让 Claude 创建("把 XX 流程存成 skill"),或手动仿照现有格式写。整个 `.claude/`(除 `settings.local.json`)建议提交进 git,团队共享。
