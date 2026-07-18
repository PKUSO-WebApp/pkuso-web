# 贡献指南

## 分支命名

`<type>/<简述>`

| type        | 用途           |
| ----------- | -------------- |
| `feat/`     | 新功能         |
| `fix/`      | 修缺陷         |
| `docs/`     | 文档           |
| `refactor/` | 重构(不改行为) |
| `test/`     | 测试           |
| `chore/`    | 工程配置/依赖  |
| `build/`    | 构建系统       |
| `ci/`       | CI/CD          |

分支应短命: 一个分支 ≈ 一个 Issue ≈ 1-3 天的工作量,合并后即删。

## 提交规范 (Conventional Commits)

```
<type>(<scope>): <subject>
```

- type 同上
- scope 可选,如 `(auth)`、`(rehearsal)`
- subject 中文或英文均可,小写开头

示例:

```
feat(community): 新增帖子图片上传
fix(attendance): 修复考勤状态未刷新
chore: 升级 pnpm 到 11
```

提交信息受 `commitlint` 强制检查,不合规范会被 pre-commit 钩子拦截。

## PR 流程

1. 从最新 `main` 切出功能分支: `git switch -c feat/xxx main`
2. 写代码 + 测试,按 Conventional Commits 提交
3. `git push -u origin feat/xxx`,在 GitHub 开 PR
4. 本地 `pnpm verify` 通过 → 填 PR 模板 → 发 PR
5. CI 自动跑 verify + build;通过后由 reviewer 审查
6. Squash & merge 合并进 main

## Code Review

- **提 PR 的人**: 先自己 review 一遍 diff,PR 描述写清"为什么这么改"
- **Review 的人**: 区分 `must-fix`(必须改) 和 `suggestion`(建议)

## 本地门禁

每次提交自动触发:

- `lint-staged`: 暂存区文件 → Prettier 格式化 + ESLint 修复
- `commitlint`: 提交信息格式校验

提交前先 `pnpm verify` 把格式/lint/类型/测试全跑一遍。
