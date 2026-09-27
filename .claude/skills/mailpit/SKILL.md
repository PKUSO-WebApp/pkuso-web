---
name: mailpit
description: 启动 Mailpit SMTP 测试容器。⚠️ 当前休眠——仓库里已经没有任何测试用它，仅在要恢复端到端邮件测试时才需要。
---

# 启动 Mailpit

> ⚠️ **2026-09 起休眠。** 端到端邮件测试（Mailpit 直连 + 临时 admin → POST `/api/notify` → 查 Mailpit API）
> 已经从 `src/__tests__/notify.test.ts` 里丢失，该文件现在是纯单测。CI 的 `services.mailpit` 也成了死配置。
> **本技能当前没有触发场景**，留在这里是为了恢复端到端测试时能直接照做。

本项目的 SMTP 集成测试依赖 Mailpit（本地 Docker 容器，零外部网络依赖）。

## 检查状态

```bash
docker ps --filter name=mailpit --format "{{.Status}}"
```

如果输出为空或 `Exited`，需要启动。

## 启动

```bash
# 如果容器不存在则创建并启动
docker run -d --name mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit

# 如果容器已存在但停止了
docker start mailpit
```

## 验证

```bash
curl -s http://localhost:8025/api/v1/messages | head -20
```

返回 JSON 即为正常。也可以通过 Web UI 查看：浏览器打开 `http://localhost:8025`。

## 本地跑测试

```bash
# Linux / Git Bash
MAILPIT_ENABLED=true pnpm vitest run src/__tests__/notify.test.ts

# PowerShell
$env:MAILPIT_ENABLED = "true"
pnpm vitest run src/__tests__/notify.test.ts
```

## 清理

```bash
docker stop mailpit && docker rm mailpit
```
