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
├── pyproject.toml        # Python 包定义（注册 a2a-bridge CLI）
├── requirements.txt      # Python 依赖
├── Dockerfile            # 容器化部署
├── .env.example          # 环境变量示例
├── scripts/
│   ├── install.sh        # macOS / Linux 一键安装脚本
│   └── install.ps1       # Windows 一键安装脚本
├── a2a_bridge/           # CLI 包装器包
│   ├── __init__.py
│   ├── __main__.py       # python -m a2a_bridge 入口
│   └── cli.py            # a2a-bridge 命令（setup/start/stop/status/doctor）
├── bridge_config.py      # 配置管理（环境变量）
├── main.py               # FastAPI 应用入口（JSON-RPC + SSE）
├── agent_card.py         # /.well-known/agent.json 端点
├── executor.py           # 子进程执行器 + 任务生命周期
├── git_manager.py        # Git 工作区管理
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

## 安装

### 方式 1：npx 直接运行（推荐，无需安装）

```bash
npx @tide-ai/a2a-bridge start
npx @tide-ai/a2a-bridge setup --daemon
npx @tide-ai/a2a-bridge doctor
```

### 方式 2：全局安装

```bash
npm install -g @tide-ai/a2a-bridge
a2a-bridge start
```

如果遇到 EACCES 权限错误：
```bash
npm config set prefix ~/.local
export PATH="$HOME/.local/bin:$PATH"  # 添加到 ~/.zshrc
npm install -g @tide-ai/a2a-bridge
```

### 方式 3：Python 直接安装

```bash
cd a2a-bridge
pip install -e .
python3 -m a2a_bridge start
```

---

## 3. 快速部署

### 方式一：一键安装脚本（推荐）

安装脚本会自动检测并按需安装 **Git、Python 3.11+、Node.js 20+**，全局安装 `codex / claude / qoder` CLI，安装 `a2a-bridge` 命令并生成默认配置，还可选注册系统服务（systemd / launchd）。

**macOS / Linux：**

```bash
# 远程安装
curl -fsSL https://raw.githubusercontent.com/multica-ai/tide/main/a2a-bridge/scripts/install.sh | bash

# 或从本地 checkout 安装
cd a2a-bridge && bash scripts/install.sh
```

**Windows（PowerShell）：**

```powershell
# 远程安装
irm https://raw.githubusercontent.com/multica-ai/tide/main/a2a-bridge/scripts/install.ps1 | iex

# 或从本地 checkout 安装
cd a2a-bridge; powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

> Windows 依赖优先通过 `winget` 安装，回退到 `chocolatey`。

安装完成后：

```bash
a2a-bridge setup      # 交互式配置向导（端口 / API Key / LLM Key / Git / 自动探测 CLI）
a2a-bridge doctor      # 环境自检
a2a-bridge start       # 前台启动
a2a-bridge start -d    # 后台守护进程
```

配置写入 `~/.a2a-bridge/.env`；守护进程日志位于 `~/.a2a-bridge/bridge.log`。

#### `a2a-bridge` 命令参考

| 命令 | 说明 |
|------|------|
| `a2a-bridge setup` | 交互式配置向导（HTTP 模式），自动探测本地 CLI，可选注册系统服务 |
| `a2a-bridge setup --daemon` | 交互式配置 Daemon WebSocket 推模式 |
| `a2a-bridge start` | 前台启动（Ctrl+C 停止） |
| `a2a-bridge start -d` | 后台守护进程，写入 PID 文件 |
| `a2a-bridge start --log-level debug` | 覆盖日志级别启动 |
| `a2a-bridge stop` | 通过 PID 文件优雅停止后台进程 |
| `a2a-bridge status` | 显示运行状态、CLI 探测结果与 Health 接口 |
| `a2a-bridge doctor` | 诊断 Python / Node / Git / CLI / 配置 是否就绪 |

#### Daemon WebSocket 推模式

适用于 Bridge 部署在 NAT/防火墙后、无法被 Tide 主动 reach 的场景。启用后由 Bridge **主动连接** Tide 后端的 `/ws/daemon` 端点，在同一条 WebSocket 长连接上完成：**能力注册 → 心跳保活 → 任务反向下发 → 流式事件/结果回传**，替代传统 HTTP 拉模式。

**工作机制：**

```
Bridge 启动（DAEMON_ENABLED=true）
    │
    ▼  主动连接 ws(s)://<tide-host>/ws/daemon?token=<DAEMON_TOKEN>
register（上报 daemon_id / agents / skills / capability_tags / max_concurrency）
    │
    ▼  收到 registered（含服务端确认的 heartbeat_interval）
每 HEARTBEAT_INTERVAL 秒发送 heartbeat（active_tasks / load / status）
    │
    ▼  收到 task_dispatch → 调用本地 CLI executor 执行
task_event 逐步回传流式输出，终态发 task_result
    │
    ▼  断线后指数退避 + 随机 jitter 自动重连
```

**配置字段（写入 `.env`，完整示例见 [`.env.example`](./.env.example)）：**

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `DAEMON_ENABLED` | `false` | 是否启用 Daemon 推模式（默认关闭，不影响现有 HTTP 模式） |
| `TIDE_WS_URL` | (空) | Tide 后端 daemon WS 地址，如 `ws://localhost:8000/ws/daemon` |
| `DAEMON_TOKEN` | (空) | 鉴权共享密钥，必须与后端 `DAEMON_TOKEN` 一致 |
| `DAEMON_ID` | (空) | Daemon 标识；留空时优先读取 `~/.a2a-bridge/.daemon_id` 持久化值，首次自动生成 UUID 并回写（避免重启积累多条记录） |
| `HEARTBEAT_INTERVAL` | `15` | 心跳间隔（秒）；服务端在 `registered` 中可下发不同值 |
| `CAPABILITY_TAGS` | `code,review,docs` | 能力标签（逗号分隔），供后端调度匹配使用 |
| `BRIDGE_NAME` | (空) | 显示名称前缀（如 `dev/codex`）；留空回退主机名，再回退 daemon_id 前 8 位 |

> 后端侧需配置**相同的** `DAEMON_TOKEN` 环境变量以通过鉴权。

**使用步骤：**

```bash
# 1) 交互式配置 Daemon 模式（引导填写上述字段，写入 ~/.a2a-bridge/.env）
a2a-bridge setup --daemon

# 向导将引导配置：
# - 启用/禁用 Daemon 模式
# - Tide 后端 WS 地址（默认 ws://localhost:8000/ws/daemon）
# - 共享 Token（可自动生成）
# - Daemon ID、心跳间隔、能力标签

# 2) 启动（后台守护）
a2a-bridge start -d

# 3) 在 Tide 后端确认已配置相同的 DAEMON_TOKEN，Bridge 上线后
#    会自动注册为 remote_agents（connection_mode='ws'），无需手动填 Agent Card URL
```

也可手动编辑 `~/.a2a-bridge/.env`、设置上述字段后重启服务生效。与 HTTP 拉模式的对比及 `/ws/daemon` 完整协议见 [`docs/A2A_INTEGRATION.md`](../docs/A2A_INTEGRATION.md)。

### 方式二：pip 直接安装

若已自行准备好 Node.js 与各 CLI，可直接用 pip 安装：

```bash
cd a2a-bridge
pip install -e .        # 本地可编辑安装
# 或（发布后）
pip install tide-a2a-bridge

a2a-bridge setup
a2a-bridge start
```

### 方式三：手动运行（用于快速验证）

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

### 方式四：Docker

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

### 方式五：docker-compose 片段

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
- **Codex CLI**：默认启用 `-a full-auto -s workspace-write` 与 `--skip-git-repo-check`，工作流自动化更顺畅。
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
