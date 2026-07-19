---
name: mailpit
description: 启动 Mailpit SMTP 测试容器。当运行 notify 测试遇到 ECONNREFUSED 时报错时使用。
---

# 启动 Mailpit

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
MAILPIT_ENABLED=true npx vitest run src/__tests__/notify.test.ts

# PowerShell
$env:MAILPIT_ENABLED = "true"
npx vitest run src/__tests__/notify.test.ts
```

## 清理

```bash
docker stop mailpit && docker rm mailpit
```
