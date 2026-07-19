# 项目 Skills(给人看的说明)

每个子目录一个技能:`<名字>/SKILL.md`。frontmatter 必须含 `name` 和 `description`;`description` 要写清**触发时机**,Claude 据此决定何时自动调用,也可用 `/<名字>` 手动调用。

> 项目核心指导文件为根目录 [`AGENTS.md`](../../AGENTS.md)，所有 Agent 工作前应先读。本目录的 skills 是 AGENTS.md "经验沉淀机制" 的落地:可复用的多步操作流程写成 `<名字>/SKILL.md`,项目级约定写入 AGENTS.md。

现有技能:

| 技能          | 用途                                             |
| ------------- | ------------------------------------------------ |
| `verify`      | 改动后的验证流程(tsc 类型检查 / lint / 实际运行) |
| `save-lesson` | 会话经验分流沉淀到 AGENTS.md / skills / memory   |

添加新技能:直接创建("把 XX 流程存成 skill"),或手动仿照现有格式写。
