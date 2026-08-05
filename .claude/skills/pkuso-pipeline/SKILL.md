---
name: pkuso-pipeline
description: PKUSO 多智能体编排流水线。当开发任务需要走完整流程（Issue → 分支 → 编码 → 审查 → 对抗 → 测试 → 提交）时使用。
---

# PKUSO Agent Team 编排流水线

你（主智能体 Claude）按以下流水线调度子智能体。子智能体之间不能互相调用，每次调用由你传递完整上下文。

## 最高准则

- CLAUDE.md（仓库根目录）是本项目的唯一事实源。冲突时：用户输入 > CLAUDE.md > 本规则。
- 所有智能体产出（界面文案、代码注释、Issue、commit message、PR 描述）一律中文。
- 不允许擅自调用非 pkuso 团队的子智能体。

## 你的前置职责

收到需求后，**在调用任何子智能体之前**：

1. 分析需求 → `gh issue create` 创建 Issue
2. 按 `<type>/<简述>` 从 main 切分支（type ∈ feat|fix|docs|refactor|test|chore|build|ci）
3. 确认 Issue 与分支就绪后，再开始调度

## 流水线阶段

### 阶段 0：数据库变更（按需）

**仅当需求涉及数据库变更时调用 pkuso-dba。**

```
🤖 **正在激活 pkuso-dba 处理数据库变更**
```

传入：变更需求、受影响表/列/策略、相关 spec。
产出：migration 清单 + 受影响面声明 → 必须并入后续所有环节的上下文。

### 阶段 1：编码实现

```
🤖 **正在激活 pkuso-implementer 处理 [子任务描述]**
```

传入：Issue 编号与内容、目标文件清单、验收标准（涉及 DB 时另附 dba 的受影响面声明）。
产出：改动清单 + 自检声明。

### 阶段 2：合规审查

```
🤖 **正在激活 pkuso-reviewer 进行合规审查**
```

传入：改动清单 + implementer 自检声明。
产出：PASS/FAIL 报告。

- **PASS** → 进入阶段 3
- **FAIL** → 携带完整返工清单回阶段 1，返工后从阶段 2 重走

### 阶段 3：找 Bug / 逻辑漏洞

```
🤖 **正在激活 pkuso-adversary 进行对抗性测试**
```

传入：改动清单 + 验收标准 + reviewer 的 PASS 报告。
产出：击破/未击破报告。

- **未击破** → 进入阶段 4
- **击破** → 携带完整问题清单回阶段 1，返工后从阶段 2 重走（**禁止跳关直接回阶段 3**）

### 阶段 4：测试补齐与回归

```
🤖 **正在激活 pkuso-tester 补齐测试并回归**
```

传入：改动清单 + 验收标准 + adversary 报告。
产出：通过/失败报告。

- **通过** → 进入提交阶段
- **失败** → 回阶段 1，返工后从阶段 2 重走

### 阶段 5：提交与合并

全部通过后由你执行：

1. `pnpm verify` —— 确保全绿
2. `git commit` —— Conventional Commits，含 `Closes #<issue>`
3. `gh pr create`
4. 等 CI 通过
5. `gh pr ready`（如 draft）
6. `gh pr merge --squash`
7. 删远端分支
8. 切回 main → `git fetch --prune` → `git pull`

## 你的编辑权限边界（重要）

**你只编排，不写代码。** `src/` 下的任何业务代码修改一律由 pkuso-implementer 执行——哪怕只是 reviewer 指出的一行小改，也必须携带报告回 implementer 返工。

原因：子智能体上下文隔离，你改完它们不知道，reviewer 的报告、implementer 的自检声明会与仓库实际状态脱节。

### 唯一例外（微修复通道）

同时满足以下**全部**条件时，你可以直接改，但必须走完"闭环三步"：

1. **改动范围**：单行内的纯机械修正（错别字、文案、import 顺序、格式化、显式类型标注），不含任何逻辑/条件/SQL/样式 token 的变更
2. **改完立即复核**：重新调用 pkuso-reviewer 复核该行，拿到 PASS 才继续
3. **显式声明**：在最终交付汇报中声明"主智能体代改了什么、为什么"，不静默

不满足例外条件的，或你无法确定是否满足的，**一律回 implementer**。

## 调用子智能体的规范

每次调用子智能体时：

1. **声明激活**：在调用前向用户输出 `🤖 **正在激活 [Agent 名称] 处理 [子任务描述]**`
2. **完整上下文**：把必要背景写进指令，不要假设对方"记得"（子智能体上下文互相隔离）
3. **关卡报告传递**：任何关卡失败，携带完整报告回 implementer 返工

## 提交前硬性检查

- `pnpm verify` 全绿
- 涉及 DB schema 改动时 gen-types 产物已同步
- 分支名合法
- commit message 过 commitlint（type 限 build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test）
- PR 用 Squash & merge
- 合并后删分支，不在原分支追加提交
