# 项目 Skills(给人看的说明)

每个子目录一个技能:`<名字>/SKILL.md`。frontmatter 必须含 `name` 和 `description`;`description` 要写清**触发时机**,Claude 据此决定何时自动调用,也可用 `/<名字>` 手动调用。

## ⚠️ 两个目录:`这里`是真源,`.claude/skills/`是生成的

|      | `.agents/skills/`（**本目录**）                     | `.claude/skills/`          |
| ---- | --------------------------------------------------- | -------------------------- |
| 角色 | **真源** —— 改东西改这里                            | **生成的适配层** —— 别手改 |
| 谁读 | `npx skills add` 这类工具的约定位置（harness 中立） | **Claude Code 只读这个**   |

**新技能写在本目录**，然后跑：

```bash
node scripts/sync-skills.mjs          # 或直接跑 bash scripts/gate.sh，它开头就会检查
```

**这不是形式主义**，2026-09-30 实测出来的：

- 当时 `supabase` 那份**只存在于本目录**，而全新 Claude Code 会话列出的 skill 里**没有它** ⇒ 那份 Supabase 开发/安全指南，Claude Code 用户等于没有
- 同时 `verify` / `mailpit` / `README.md` 三份**各自漂移**了（两边内容不同）

`bash scripts/gate.sh` 的第一件事就是 `--check`，所以**漂移会在本地和 CI 都红**。

**同步脚本不自动删除**：适配层里多出来的东西它只报告、不删 —— 那可能是「新装的 skill 装错了地方」也可能是「残留」，脚本分不出，而「自动删掉刚装进来的东西」是最不该由脚本做的决定。

用复制而不是软链，是因为这台 Windows 上 `ln -s` **静默退化成复制**；静默退化比不用软链更糟。

## 现有技能

| 技能                               | 用途                                           |
| ---------------------------------- | ---------------------------------------------- |
| `verify`                           | 改动后的验证流程(闸门 + 实际跑一遍)            |
| `save-lesson`                      | 会话经验分流沉淀到 AGENTS.md / skills / memory |
| `mailpit`                          | 启动 Mailpit 容器 —— **当前休眠**,无测试使用   |
| `supabase`                         | Supabase 开发/安全指南(外部引入,未改动)        |
| `supabase-postgres-best-practices` | Postgres 查询/schema 优化(外部引入,未改动)     |
| `vercel-react-best-practices`      | React / Next.js 性能优化(外部引入,未改动)      |
| `web-design-guidelines`            | Web 界面规范审查(外部引入,未改动)              |

另有 `.claude/agents/` 下的评审 subagent 定义(`pkuso-reviewer`、`pkuso-adversary`)。

## 添加新技能

写在本目录：`<名字>/SKILL.md`，然后跑一次同步。外部引入的 skill 也一样 —— 先用它的安装工具装（它可能写进 `.claude/skills/`），**再把它移进本目录**，否则下次同步会报「多余」。

`.claude/`（除 `settings.local.json`）建议提交进 git,团队共享。
