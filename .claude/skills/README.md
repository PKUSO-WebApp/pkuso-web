# 项目 Skills(给人看的说明)

每个子目录一个技能:`<名字>/SKILL.md`。frontmatter 必须含 `name` 和 `description`;`description` 要写清**触发时机**,Claude 据此决定何时自动调用,也可用 `/<名字>` 手动调用。

现有技能:

| 技能          | 用途                                             |
| ------------- | ------------------------------------------------ |
| `verify`      | 改动后的验证流程(tsc 类型检查 / lint / 实际运行) |
| `save-lesson` | 会话经验分流沉淀到 CLAUDE.md / skills / memory   |

添加新技能:直接让 Claude 创建("把 XX 流程存成 skill"),或手动仿照现有格式写。整个 `.claude/`(除 `settings.local.json`)建议提交进 git,团队共享。
