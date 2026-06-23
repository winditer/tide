# Tide 部署架构快速参考卡

## 容器启动序列和依赖关系

```
┌──────────────────┐
│  cc-switch:15721 │  (Alpine 3.19 + CC Switch CLI)
│                  │  - Provider 配置必须手动设置
│                  │  - 代理所有 Claude API 请求
└────────┬─────────┘
         │
         │ depends_on
         ↓
┌──────────────────────────────┐
│ backend:8000                 │  (Python 3.11-slim + Node 22)
│ ├─ FastAPI + uvicorn         │
│ ├─ Agent CLI: codex, claude, │
│ │  qodercli (全局安装)        │
│ ├─ SQLite: /app/data/tide.db │
│ └─ 单进程运行 (禁止 --workers>1) │
└────────┬─────────────────────┘
         │
         │ depends_on
         ↓
┌──────────────────────────────┐
│ frontend:3000                │  (Node 20-alpine)
│ ├─ Next.js (basePath=/tide)  │
│ ├─ Rewrites: /api /* →       │
│ │  http://backend:8000       │
│ └─ 用户入口                  │
└──────────────────────────────┘
```

## 核心端口速查表

| 端口 | 容器 | 协议 | 用途 |
|------|------|------|------|
| 15721 | cc-switch | HTTP | Claude API 代理 |
| 15722 | cc-switch | HTTP | Codex API 代理 |
| 15723 | cc-switch | HTTP | Gemini API 代理（未使用） |
| 8000 | backend | HTTP | FastAPI + WebSocket |
| 3000 | frontend | HTTP | Next.js |

## Volume 映射关键字

```
Host Path                                    Container Path      用途
─────────────────────────────────────────    ──────────────────  ─────────────────
/var/lib/docker/volumes/tide_tide-data      /app/data           SQLite数据库+项目
/var/lib/docker/volumes/tide_tide-runtime   /app/.tide          运行时状态文件
/var/lib/docker/volumes/tide_tide-agent-home /app/.agent        Agent会话/项目
/var/lib/docker/volumes/tide_tide-qoder-home /root/.qoder       Qoder认证
/var/lib/docker/volumes/tide_tide-claude-home /root/.claude     Claude配置
/var/lib/docker/volumes/tide_cc-switch-data /root/.cc-switch   CC Switch配置DB
```

## Agent CLI 符号链接映射

```
/usr/local/bin/codex → 
  /usr/local/lib/node_modules/@openai/codex/bin/codex.js

/usr/local/bin/claude → 
  /usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe

/usr/local/bin/qodercli → 
  /usr/local/lib/node_modules/@qoder-ai/qodercli/bundle/qodercli.js

/usr/local/bin/policies → 
  /usr/local/lib/node_modules/@qoder-ai/qodercli/bundle/policies
```

## Agent CLI 版本快查

```bash
# Backend 容器内
docker exec tide-backend codex --version
  → codex-cli 0.139.0

docker exec tide-backend claude --version
  → 2.1.177 (Claude Code)

docker exec tide-backend qodercli --version
  → 1.0.20
```

## 环境变量优先级链

```
1. docker-compose.yml environment:
   ANTHROPIC_BASE_URL: http://tide-cc-switch:15721
   CODEX_HOME: /app/.agent/codex
   CLAUDL_HOME: /app/.agent/claude
   
2. .env 文件:
   CODEX_MODEL=
   CLAUDE_PERMISSION_MODE=dontAsk
   QODER_PERMISSION_MODE=dont_ask
   
3. backend/runtime/config.py 代码默认值:
   DEFAULT_AGENT_ID = "codex"
   CODEX_TIMEOUT_SECONDS = 1800
```

## 关键配置常量

| 常量 | 值 | 说明 |
|------|-----|------|
| DEFAULT_AGENT_ID | codex | 默认 Agent |
| CODEX_APPROVAL_POLICY | on-request | 普通任务审批 |
| CODEX_SANDBOX_MODE | workspace-write | 沙箱模式 |
| CLAUDE_PERMISSION_MODE | dontAsk | Claude 权限 |
| MAX_RUNNING_TASKS | 6 | 全局最大并发 |
| MAX_RUNNING_TASKS_PER_CHAT | 4 | 单群最大并发 |
| PLAN_MAX_PARALLEL | 3 | Plan 并行数 |
| TIDE_JWT_EXPIRE_MINUTES | 15 | JWT 过期时间 |

## Agent 执行流程图

```
输入: task_id, agent_id, prompt, cwd
  ↓
选择 Adapter (Codex / Claude / Qoder)
  ↓
构建命令:
  - Codex: codex [-m] [-a] [-s] exec [resume ...] prompt
  - Claude: claude --print --output-format stream-json [--resume] prompt
  - Qoder: qodercli --print --output-format stream-json --cwd [--resume] prompt
  ↓
asyncio.create_subprocess_exec(*cmd, cwd=cwd, ...)
  ↓
逐行读 stdout → adapter.parse_events(line)
  ↓
发出 TaskEvent:
  - session_id: 新建会话 ID
  - output: 普通消息
  - tool_output: 工具执行结果
  - progress: 进度提示
  - approval_request: 需要审批
  - completed / failed / cancelled
  ↓
Resume 失败检测:
  ↓
  └─ 如检测到 "no rollout found" 等错误 →
     自动降级为新建会话重试
  ↓
返回最终状态和输出
```

## Docker Network 拓扑

```
Host Network (172.16.79.51)
  ↓
  ├─ Nginx/Router (80/443)
  │    ↓
  │    └─ http://tide-frontend:3000 (Reverse Proxy)
  │         ↓ /api, /ws
  │         └─ http://tide-backend:8000
  │
  └─ tide-network (Bridge)
       ├─ tide-cc-switch
       │   ├─ 15721 (Claude)
       │   ├─ 15722 (Codex)
       │   └─ 15723 (Gemini)
       │
       ├─ tide-backend
       │   └─ 8000 (FastAPI)
       │
       └─ tide-frontend
           └─ 3000 (Next.js)

brainstorming_default (外部网络)
  └─ tide-frontend 可访问 brainstorming 网络资源
```

## NO_PROXY 白名单含义

```
NO_PROXY="localhost,127.0.0.1,backend,frontend,cc-switch,
          open.larksuite.com,open.feishu.cn,
          *.larksuite.com,*.feishu.cn"

含义:
  - localhost / 127.0.0.1: 本机调用不代理
  - backend / frontend / cc-switch: 容器内部服务不代理
  - open.larksuite.com / *.larksuite.com: Lark API 不代理
  - open.feishu.cn / *.feishu.cn: 飞书 API 不代理

结果:
  ✓ Claude API → 通过 CC Switch (15721)
  ✓ Codex 内部调用 → 直连（不经代理）
  ✓ Lark 回调 → 直连（不经代理）
  ✓ 其他 API → 根据需要通过代理或直连
```

## Backend 启动健康检查

```bash
# 检查项
1. PYTHONUNBUFFERED=1 (确保实时日志输出)
2. PYTHONDONTWRITEBYTECODE=1 (不生成 .pyc)
3. uvicorn 后端启动无错误
4. HTTP GET /health → 200 OK
5. WebSocket Hub 初始化成功
6. APScheduler 启动成功
7. Lark Listener 连接成功

# 验证命令
docker exec tide-backend python -c "import backend.main; print('OK')"
curl http://localhost:8000/health
```

## CC Switch 配置工作流

```
Step 1: 检查现有配置
  docker exec tide-cc-switch cc-switch provider current

Step 2: 添加新 Provider（交互式）
  docker exec -it tide-cc-switch cc-switch provider add
  # 选择 Provider 类型 (Claude / Codex / Gemini)
  # 输入 API Key

Step 3: 启用代理
  docker exec tide-cc-switch cc-switch proxy enable

Step 4: 重启容器使配置生效
  docker restart tide-cc-switch

Step 5: 验证代理运行
  docker exec tide-cc-switch cc-switch provider current
  # 应输出当前 Provider 信息
```

## Frontend 路由和反向代理

```
用户请求:
  GET https://storming.ebonex.io/tide
    ↓
  Nginx /tide → 反向代理到 http://tide-frontend:3000
    ↓
  Next.js basePath=/tide
    ├─ 静态资源: /_next/... (NEXT_PUBLIC_BASE_PATH)
    ├─ API 代理: /api/* → next.config.ts rewrites
    │              ↓ http://backend:8000/api/*
    └─ WebSocket: /ws/* → 同上

环境变量（构建时注入）:
  NEXT_PUBLIC_BASE_PATH=/tide
  API_BACKEND_URL=http://backend:8000
  (在 next.config.ts 中使用)
```

## SQLite 数据库路径

```
容器内: /app/data/tide.db
卷挂载: /var/lib/docker/volumes/tide_tide-data/_data/tide.db
连接URL: sqlite+aiosqlite:////app/data/tide.db
        (4 个 / 是标准写法: sqlite+aiosqlite://[host]/[path])

备份方法:
  docker exec tide-backend cp /app/data/tide.db /app/data/tide.db.bak
  docker cp tide-backend:/app/data/tide.db ./tide.db.backup
```

## 常见故障快速诊断

```
❌ Backend 无法启动
  ├─ 检查: docker logs tide-backend
  ├─ Agent CLI: docker exec tide-backend which codex
  └─ 解决: 重建镜像 (docker-compose build --no-cache)

❌ Claude 任务失败
  ├─ 检查: docker exec tide-cc-switch cc-switch provider current
  ├─ 检查: docker exec tide-backend cat /root/.claude/settings.json
  └─ 解决: 重新配置 CC Switch provider

❌ Resume 失败自动降级
  ├─ 原因: Session 文件丢失或不可达
  ├─ 日志: grep -i "resume failed" $(docker logs tide-backend)
  └─ 解决: 自动降级为新建会话（executor.py L199-297）

❌ 前端 API 连接失败
  ├─ 检查: docker exec tide-frontend env | grep API_BACKEND_URL
  ├─ 日志: docker logs tide-frontend
  └─ 解决: 重新构建 frontend (NEXT_PUBLIC_BASE_PATH=/tide)

❌ WebSocket 连接失败
  ├─ 检查: curl -i -N -H "Connection: Upgrade" http://localhost:8000/ws
  ├─ 检查: docker logs tide-backend | grep -i websocket
  └─ 解决: backend 不能多进程，检查 --workers 参数
```

## 快速命令集

```bash
# 启动全栈
docker-compose up -d

# 查看实时日志
docker-compose logs -f backend

# 进入后端容器
docker exec -it tide-backend bash

# 验证 Agent CLI
docker exec tide-backend which codex claude qodercli
docker exec tide-backend codex --version

# 检查数据库连接
docker exec tide-backend sqlite3 /app/data/tide.db ".tables"

# 检查卷使用情况
docker exec tide-backend du -sh /app/data /app/.agent /app/.tide

# 停止所有容器
docker-compose down

# 删除数据卷（谨慎！）
docker-compose down -v

# 重启特定容器
docker-compose restart backend
docker-compose restart cc-switch

# 查看容器资源使用
docker stats tide-backend tide-frontend tide-cc-switch

# 备份重要数据卷
docker run --rm -v tide_tide-data:/data -v $(pwd):/backup \
  alpine tar czf /backup/tide-data.tar.gz -C /data .
```

---

**快速参考卡版本**: 1.0  
**最后更新**: 2024-06-15
