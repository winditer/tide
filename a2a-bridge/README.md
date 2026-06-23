# Tide A2A Bridge

将本地 **Codex / Claude Code / Qoder CLI** 包装为标准 **A2A (Agent-to-Agent) Server** 的远程桥接服务。
部署在远程开发机或专用 Agent 主机上后，[Tide](../README.md) 平台即可通过 A2A 协议远程调用这些 Agent，无需在 Tide 主容器中预装多种 CLI 工具。

```
┌────────────┐    A2A / JSON-RPC      ┌──────────────────────┐    subprocess    ┌──────────┐
│  Tide      │ ─────────────────────▶ │  a2a-bridge (此服务) │ ───────────────▶ │  codex   │
│  Backend   │ ◀────── SSE ────────── │  FastAPI :8720       │ ◀─── stream ──── │  claude  │
└────────────┘                        └──────────────────────┘                  │  qoder   │
                                                                                 └──────────┘
```

---

## 1. 目录结构

```
a2a-bridge/
├── README.md             # 本文件
├── requirements.txt      # Python 依赖
├── Dockerfile            # 容器化部署
├── .env.example          # 环境变量示例
├── config.py             # 配置管理（环境变量）
├── main.py               # FastAPI 应用入口（JSON-RPC + SSE）
├── agent_card.py         # /.well-known/agent.json 端点
├── executor.py           # 子进程执行器 + 任务生命周期
├── models.py             # JSON-RPC / Task / Message 数据模型
└── event_parser.py       # CLI stream-json 输出解析
```

---

## 2. 端点

| 路径                                  | 方法 | 说明                                              |
|---------------------------------------|------|---------------------------------------------------|
| `/.well-known/agent.json`             | GET  | 返回 Agent Card，供平台自动发现能力               |
| `/health`                             | GET  | 健康检查，含可用 agent 列表与活跃任务数           |
| `/a2a`                                | POST | A2A JSON-RPC 入口（详见下文方法列表）             |

支持的 JSON-RPC 方法：

| Method            | 说明                                            | 返回             |
|-------------------|-------------------------------------------------|------------------|
| `message/send`    | 阻塞式：执行 CLI 直至完成，返回最终 Task         | JSON-RPC 单条    |
| `message/stream`  | 流式：通过 SSE 推送 status/artifact 事件         | `text/event-stream` |
| `tasks/get`       | 查询任务当前状态                                 | JSON-RPC 单条    |
| `tasks/cancel`    | 取消正在执行的任务（kill subprocess）            | JSON-RPC 单条    |
| `agent/getCard`   | 通过 RPC 取 Agent Card（与 .well-known 等价）   | JSON-RPC 单条    |

JSON-RPC 请求示例：

```json
{
  "jsonrpc": "2.0",
  "id": "req-1",
  "method": "message/send",
  "params": {
    "message": {
      "role": "user",
      "parts": [{"kind": "text", "text": "请帮我把 README 中的拼写错误改掉"}]
    },
    "configuration": {
      "skill": "codex",
      "workDir": "/home/deploy/workspace/myproject",
      "model": "auto"
    }
  }
}
```

---

## 3. 快速部署

### 方式一：直接运行（推荐用于快速验证）

```bash
cd a2a-bridge
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 复制并修改环境变量
cp .env.example .env
# 编辑 .env：至少配置 BRIDGE_API_KEY、BRIDGE_WORK_DIR

# 启动服务
set -a; source .env; set +a
uvicorn main:app --host 0.0.0.0 --port 8720
```

> 前提：本机已安装并可执行 `codex` / `claude` / `qoder` CLI，且已完成各自登录认证。

### 方式二：Docker

```bash
cd a2a-bridge
docker build -t tide-a2a-bridge:latest .

docker run -d --name a2a-bridge \
  -p 8720:8720 \
  -e BRIDGE_API_KEY="your-shared-secret" \
  -e BRIDGE_WORK_DIR=/workspace \
  -v /path/to/projects:/workspace \
  -v $HOME/.codex:/root/.codex \
  -v $HOME/.claude:/root/.claude \
  -v $HOME/.qoder:/root/.qoder \
  tide-a2a-bridge:latest
```

> Volume 挂载凭证目录是为了让容器内的 CLI 复用宿主机的登录态。
> 如果使用 CC Switch 等代理网关，需要再透传 `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `CODEX_HOME` 等环境变量。

### 方式三：docker-compose 片段

```yaml
services:
  a2a-bridge:
    build: ./a2a-bridge
    ports:
      - "8720:8720"
    environment:
      BRIDGE_API_KEY: ${A2A_BRIDGE_KEY}
      BRIDGE_WORK_DIR: /workspace
      OPENAI_API_KEY: ${OPENAI_API_KEY}
    volumes:
      - ./projects:/workspace
      - ~/.codex:/root/.codex
      - ~/.claude:/root/.claude
    restart: unless-stopped
```

---

## 4. 环境变量

完整列表见 [`.env.example`](./.env.example)。最常用的几项：

| 变量                       | 默认                        | 说明                                    |
|----------------------------|-----------------------------|-----------------------------------------|
| `BRIDGE_HOST`              | `0.0.0.0`                   | 监听地址                                |
| `BRIDGE_PORT`              | `8720`                      | 监听端口                                |
| `BRIDGE_PUBLIC_URL`        | *（自动推导）*              | 写入 Agent Card 的 url                  |
| `BRIDGE_API_KEY`           | *（空，禁用认证）*          | `X-API-Key` 头校验值                    |
| `BRIDGE_WORK_DIR`          | `/home/deploy/workspace`    | 默认 cwd（可被请求覆盖）                |
| `BRIDGE_MAX_CONCURRENCY`   | `5`                         | 同时执行的最大任务数                    |
| `BRIDGE_DEFAULT_TIMEOUT`   | `600`                       | 单任务超时（秒）                        |
| `BRIDGE_DEFAULT_AGENT`     | `codex`                     | 未指定 skill 时使用的 agent             |
| `CODEX_BIN` / `CLAUDE_BIN` / `QODER_BIN` | `codex` / `claude` / `qoder` | CLI 可执行文件路径 |
| `BRIDGE_AGENTS`            | *（未设置）*                | 一个 JSON 字符串，整体覆盖 AGENTS 配置  |

---

## 5. Git 工作区管理

A2A Bridge 支持自动管理远程项目的 Git 工作区，实现代码同步和变更回传。

### 工作流程

```
Tide 发送任务 (含 git 上下文)
    │
    ▼
Bridge: git fetch → checkout -b task/xxx origin/main
    │
    ▼
CLI Agent 在任务分支上执行
    │
    ▼
Bridge: git add -A → commit → push origin task/xxx
    │
    ▼
Tide workflow: git_merge 节点合并 task/xxx → main
```

### Git 相关环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `GIT_REPOS_DIR` | `/tmp/a2a-repos` | 仓库克隆目录 |
| `GIT_SSH_KEY_PATH` | (空) | SSH 私钥路径，用于 SSH 协议认证 |
| `GIT_AUTH_TOKEN` | (空) | HTTPS Personal Access Token |
| `GIT_DEFAULT_REPO` | (空) | 默认仓库 URL（未通过 A2A 传入时使用） |
| `GIT_DEFAULT_BRANCH` | `main` | 默认基线分支 |
| `GIT_AUTO_PUSH` | `true` | 任务完成后是否自动 push |

### 认证配置

**SSH 方式（推荐）：**
```bash
export GIT_SSH_KEY_PATH=/home/deploy/.ssh/id_ed25519
```

**HTTPS Token 方式：**
```bash
export GIT_AUTH_TOKEN=ghp_xxxxxxxxxxxx
```

### 通过 A2A 消息传递 Git 上下文

Tide 发送任务时在 `configuration.git` 中携带仓库信息：

```json
{
  "method": "message/send",
  "params": {
    "message": {"role": "user", "parts": [{"kind": "text", "text": "实现 xxx 功能"}]},
    "configuration": {
      "skill": "codex",
      "git": {
        "repoUrl": "git@github.com:org/project.git",
        "baseBranch": "main",
        "taskBranch": "task/a2a-abc123",
        "commitMessage": "feat: implement xxx by remote agent"
      }
    }
  }
}
```

如果 `configuration.git` 缺省，Bridge 回退到环境变量 `GIT_DEFAULT_REPO`；若该变量也为空，则使用固定 `BRIDGE_WORK_DIR`，不执行任何 git 操作。

### 响应中的 Git 信息

任务完成后，响应的 `task.metadata.git` 包含分支和 commit SHA：

```json
{
  "result": {
    "id": "task-xxx",
    "status": {"state": "completed"},
    "metadata": {
      "git": {
        "repoUrl": "git@github.com:org/project.git",
        "baseBranch": "main",
        "branch": "task/a2a-abc123",
        "sha": "a1b2c3d4"
      }
    }
  }
}
```

Tide 工作流引擎可据此自动触发后续 git_merge 节点。

---

## 6. 在 Tide 中注册此 Agent

部署 Bridge 后，在 Tide 前端「**设置 → Remote Agents**」页面：

1. **填入 Agent Card URL**：
   ```
   http://<bridge-host>:8720/.well-known/agent.json
   ```
2. 点击「自动发现」：Tide 会读取 Agent Card，自动填充 `name / skills / capabilities`。
3. 选择**认证方式**为 `apiKey`，粘贴 Bridge `.env` 中配置的 `BRIDGE_API_KEY`。
4. 选择默认**审批策略**（建议 `on-request`）。
5. 保存后即可在工作流编辑器的 Agent 节点下拉中选择该远程 Agent，并指定要使用的 skill（codex / claude / qoder）。

也可以通过 Tide 的 REST API 注册（详见 Tide 主仓 `backend/api/remote_agents.py`）：

```bash
curl -X POST http://tide-host/api/remote-agents \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Remote Coding Bridge",
    "card_url": "http://10.0.0.5:8720/.well-known/agent.json",
    "auth": {"scheme": "apiKey", "value": "your-shared-secret"}
  }'
```

---

## 7. 测试

启动后可用 curl 直接验证：

```bash
# 1) Agent Card
curl -s http://localhost:8720/.well-known/agent.json | jq

# 2) 健康检查
curl -s http://localhost:8720/health | jq

# 3) 阻塞式调用（无认证场景）
curl -s -X POST http://localhost:8720/a2a \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0","id":"1","method":"message/send",
    "params":{"message":{"role":"user","parts":[{"kind":"text","text":"echo hello"}]},
              "configuration":{"skill":"codex"}}
  }' | jq

# 4) 流式调用
curl -N -X POST http://localhost:8720/a2a \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: your-shared-secret' \
  -d '{
    "jsonrpc":"2.0","id":"2","method":"message/stream",
    "params":{"message":{"role":"user","parts":[{"kind":"text","text":"列出当前目录文件"}]},
              "configuration":{"skill":"claude","workDir":"/workspace/demo"}}
  }'

# 5) 取消任务
curl -s -X POST http://localhost:8720/a2a \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"3","method":"tasks/cancel","params":{"id":"task-xxx"}}'
```

---

## 8. 实现注意事项

- **任务存储**：内存 `dict`，重启即丢失。单实例部署足够；如需高可用可挂接 Redis（自行扩展 executor）。
- **并发控制**：`asyncio.Semaphore(BRIDGE_MAX_CONCURRENCY)`。超出时新请求会排队等待。
- **优雅关闭**：进程收到 SIGTERM 时会 `terminate()` 所有未完成 subprocess，再 5 秒强制 `kill`。
- **日志**：JSON 行格式，输出到 stdout，由容器/systemd 统一收集。
- **审批检测**：当 CLI 输出含 `permission required` / `请求批准` / `please approve` 等关键词时，任务自动转为 `input_required` 状态并发送 final SSE 帧。Tide 收到后可通过自身审批系统下发后续动作。
- **Codex CLI**：默认启用 `--full-auto` 与 `--skip-git-repo-check`，工作流自动化更顺畅。
- **凭证**：Bridge 不存储 LLM API Key，全部由宿主机/容器环境变量 + CLI 自身的登录态提供。

---

## 9. 常见问题

**Q: CLI 启动报 `Missing optional dependency`？**
A: 这是 npm 全局安装的可执行入口被 `COPY` 破坏符号链接所致。本镜像已通过保留 `/usr/local/lib/node_modules` + 在最终阶段 `ln -s` 重建符号链接的方式规避。如果你修改了 Dockerfile，请保持该约定。

**Q: 容器内 Codex 报 CONNECT 404？**
A: 不要把 `HTTP_PROXY` 指向 CC Switch（它是 API 网关而非正向代理），改用 Codex 的 `config.toml`：通过 `model_provider` 直连 `http://cc-switch:15721/v1`。

**Q: 如何只暴露其中一个 CLI？**
A: 使用 `BRIDGE_AGENTS` JSON 覆盖整体配置，例如：
```bash
BRIDGE_AGENTS='{"codex":{"bin":"codex","model":"auto","timeout":900}}'
```
