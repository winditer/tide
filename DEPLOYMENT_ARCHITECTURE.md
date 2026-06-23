# Tide 项目完整部署架构文档

## 执行摘要

Tide 是一个混合部署的多智能体系统，采用 Docker Compose 编排，包含三个核心容器（`tide-cc-switch`、`tide-backend`、`tide-frontend`）和一个外部依赖网络（`brainstorming_default`）。后端容器预装 Codex CLI **0.139.0**、Claude Code **2.1.177** 和 Qoder CLI **1.0.20** 三个 Agent：Codex 和 Claude 经由 `tide-cc-switch`（当前仅启用 `prana-hub` provider，apiFormat=`anthropic_messages`，上游 `https://llm-api.prana.chat`）代理到上游模型；Qoder **不走 CC Switch**，直接凭借 `QODER_PERSONAL_ACCESS_TOKEN` 连接 Qoder 官方 API。

---

## 1. 容器架构概览

### 1.1 容器清单

| 容器名 | 镜像 | 端口映射 | 状态 | 功能 |
|--------|------|--------|------|------|
| tide-cc-switch | tide-cc-switch:latest | 15721-15723 | Up 32h | API 代理网关（Claude、Codex、Gemini） |
| tide-backend | tide-backend:latest | 8000 | Up 32h (healthy) | FastAPI 后端服务 |
| tide-frontend | tide-frontend:latest | 3000 | Up 32h | Next.js 前端应用 |

### 1.2 Docker Compose 配置

**文件路径**: `/Users/haifeng/Documents/tide/docker-compose.yml`

**核心结构**:
- **Version**: 3.9
- **Networks**: 
  - `tide-network` (内部 bridge)
  - `brainstorming_default` (外部依赖，external: true)
- **Volumes**:
  - `tide-data` → `/app/data` (SQLite + 项目数据)
  - `tide-runtime` → `/app/.tide` (运行时状态)
  - `tide-agent-home` → `/app/.agent` (Agent 工作目录)
  - `tide-qoder-home` → `/root/.qoder`
  - `tide-claude-home` → `/root/.claude`
  - `cc-switch-data` → `/root/.cc-switch` (CC Switch 配置)

---

## 2. CC Switch 容器

### 2.1 容器基本信息

| 项目 | 值 |
|------|------|
| 容器名 | `tide-cc-switch` |
| 镜像 | `tide-cc-switch:latest` |
| Dockerfile | `/Users/haifeng/Documents/tide/Dockerfile.cc-switch` |
| 基础镜像 | `alpine:3.19` |
| 监听地址 | `0.0.0.0`（跨容器可访问，必须强制为 0.0.0.0，否则跨容器不可达） |
| 端口 | 15721（Claude）、15722（Codex）、15723（Gemini） |
| 数据 Volume | `cc-switch-data` → `/root/.cc-switch` |

### 2.2 当前 Provider 配置

当前线上仅启用一个 Provider：`prana-hub`，覆盖 Claude App。

| 字段 | 值 |
|------|------|
| Provider ID | `prana-hub` |
| App | `claude` |
| Base URL | `https://llm-api.prana.chat` |
| apiFormat | `anthropic_messages`（**必须**，否则报 `convert_request_failed`） |
| 主模型 | `claude-sonnet-4-5` |
| 备选模型 | `claude-haiku-4-5`、`claude-opus-4-7` |
| 鉴权字段 | `ANTHROPIC_API_KEY`（由 CC Switch 注入） |

**关键 SQL（位于 `cc-switch.db` 的 `providers` 表）**：

```sql
UPDATE providers
SET meta = '{"apiFormat":"anthropic_messages","apiKeyField":"ANTHROPIC_API_KEY"}'
WHERE id = 'prana-hub' AND app_type = 'claude';
```

### 2.3 apiFormat 说明（关键约束）

CC Switch v5.x 的 `providers.meta.apiFormat` 决定上游请求转换格式：

| 值 | 用途 |
|------|------|
| `anthropic_messages` | 原生 `/v1/messages`，自部署/兼容 Anthropic 协议网关使用（**当前 prana-hub 必选**） |
| `openai_responses` | OpenAI Responses API |
| `codex_responses` | Codex 专用响应协议 |
| `gemini_native` | Gemini 原生协议 |
| `github_copilot` | GitHub Copilot 协议 |

如把 Claude provider 错配为 `openai_responses`，CC Switch 会把 `/v1/messages` 转成 OpenAI 格式发往上游，导致 `HTTP 500: not implemented (...convert_request_failed)`。

### 2.4 启动流程

entrypoint.sh 脚本逻辑：

1. 启动时执行 `cc-switch provider current`，检查是否存在已配置 provider；
2. 若存在 → 执行 `cc-switch proxy serve --takeover claude --listen-address 0.0.0.0`，监听 15721/15722/15723；
3. 若不存在 → 容器保持 idle，打印配置指引，等待管理员通过 `docker exec` 添加 provider。

注意：CC Switch **不是标准 HTTP 正向代理**，不支持 `CONNECT` 隧道，因此后端容器不能用 `HTTP_PROXY=http://cc-switch:15721`，必须按调用方对应方式（环境变量或 `config.toml`）直连其反向代理路径。

### 2.5 数据持久化

| 文件/目录 | 大小 | 说明 |
|----------|------|------|
| cc-switch.db | 225 KB | SQLite 数据库（providers、settings） |
| cc-switch.db-shm | 32 KB | SQLite 共享内存文件 |
| cc-switch.db-wal | 82 KB | SQLite 预写日志 |
| settings.json | 1 KB | 全局配置文件 |

备份命令：`cp /root/.cc-switch/cc-switch.db /root/.cc-switch/cc-switch.db.bak.$(date +%s)`

### 2.6 网络配置

- **监听地址**: `0.0.0.0`（跨容器可访问）
- **暴露端口**:
  - 15721: Claude API（`/v1/messages`，供 Claude CLI 通过 `ANTHROPIC_BASE_URL` 直连）
  - 15722: Codex API（`/v1/responses`，供 Codex `config.toml.model_provider` 直连）
  - 15723: Gemini API（保留，未使用）
- **后端访问**: `http://tide-cc-switch:15721`（docker-compose 服务名解析）

---

## 3. Backend 容器 (FastAPI)

### 3.1 构建配置

**Dockerfile 路径**: `/Users/haifeng/Documents/tide/Dockerfile.backend`

多阶段构建：
```
Stage 1: agent-cli (Node.js 22-slim)
  ├─ npm install -g @openai/codex @anthropic-ai/claude-code @qoder-ai/qodercli
  └─ 生成全局 CLI: /usr/local/bin/{codex,claude,qodercli}

Stage 2: runner (Python 3.11-slim)
  ├─ 复制 Node.js 运行时和已安装的 Agent CLI
  ├─ 创建符号链接（保留原始链接结构，确保 require.resolve 可在全局 node_modules 查找）
  ├─ 安装 Git、cURL (worktree 和健康检查)
  ├─ pip install -r backend/requirements.txt
  └─ 初始化持久化目录
```

### 3.2 Agent CLI 安装概览

**安装位置**:
```
/usr/local/lib/node_modules/{@openai/codex, @anthropic-ai/claude-code, @qoder-ai/qodercli}
```

**符号链接**:
```
/usr/local/bin/codex     → /usr/local/lib/node_modules/@openai/codex/bin/codex.js
/usr/local/bin/claude    → /usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe
/usr/local/bin/qodercli  → /usr/local/lib/node_modules/@qoder-ai/qodercli/bundle/qodercli.js
/usr/local/bin/policies  → /usr/local/lib/node_modules/@qoder-ai/qodercli/bundle/policies
```

> 以上符号链接在多阶段 Dockerfile 的 runner 阶段通过 `RUN ln -s` 重建，**禁止**使用 `COPY --from=builder /usr/local/bin/<cli>`。后者会跟随符号链接把入口展平为普通文件，导致 `__dirname` 变为 `/usr/local/bin`、`require.resolve` 不再走全局 `node_modules`，进而报 `Missing optional dependency`。

**版本**:

| Agent | 版本 | 包名 |
|-------|------|------|
| Codex CLI | 0.139.0 | `@openai/codex` |
| Claude Code | 2.1.177 | `@anthropic-ai/claude-code` |
| Qoder CLI | 1.0.20 | `@qoder-ai/qodercli` |

### 3.3 Agent 详细配置

#### 3.3.1 Codex Agent

| 项目 | 值 |
|------|------|
| 版本 | 0.139.0 |
| 二进制 | `/usr/local/bin/codex` → `/usr/local/lib/node_modules/@openai/codex/bin/codex.js` |
| 认证方式 | 不走环境变量上游，通过 `config.toml` 定义 `model_provider=proxy` 直连 CC Switch |
| 升台入口 | `http://cc-switch:15721/v1`（`wire_api = "responses"`） |
| API Key | `OPENAI_API_KEY=proxy-placeholder`（真实 Key 由 CC Switch 的 prana-hub provider 注入） |
| 工作目录 | `CODEX_HOME=/app/.agent/codex`；会话在 `/app/.agent/codex/sessions/` |
| 审批策略 | `CODEX_APPROVAL_POLICY=on-request` |
| 沙箱模式 | `CODEX_SANDBOX_MODE=workspace-write` |
| 超时 | `CODEX_TIMEOUT_SECONDS=1800`（默认） |
| 持久化 Volume | `tide-agent-home` → `/app/.agent` |

**`config.toml` 完整内容**（预置于镜像 `/app/.agent/codex/config.toml`）：

```toml
model_provider = "proxy"
personality = "pragmatic"

[model_providers.proxy]
name = "CC Switch"
base_url = "http://cc-switch:15721/v1"
env_key = "OPENAI_API_KEY"
wire_api = "responses"
supports_websockets = false

[projects."/app"]
trust_level = "trusted"

[projects."/tmp"]
trust_level = "trusted"
```

> `supports_websockets = false` 避免 Codex 向 CC Switch 发起 WebSocket Upgrade 请求被返回 405，从而触发 5秒重试延迟。

**CLI 调用示例**（由 `backend/runtime/adapters.py` 构造）：

```bash
codex -m auto -a on-request -s workspace-write exec \
  --output-last-message /tmp/codex-last.txt \
  --json --skip-git-repo-check \
  -C /app/data/projects/<project_id> \
  "<prompt>"

# Resume 场景
codex -m auto -a on-request -s workspace-write exec \
  resume --json --skip-git-repo-check <session_id> "<prompt>"
```

#### 3.3.2 Claude Agent

| 项目 | 值 |
|------|------|
| 版本 | 2.1.177 |
| 二进制 | `/usr/local/bin/claude` → `/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe` |
| 认证方式 | 环境变量 `ANTHROPIC_BASE_URL=http://tide-cc-switch:15721`、`ANTHROPIC_API_KEY=PROXY_MANAGED`，通过 CC Switch 代理 |
| 上游路径 | CC Switch `/v1/messages` → `https://llm-api.prana.chat` |
| 工作目录 | `CLAUDE_HOME=/app/.agent/claude`；项目在 `/app/.agent/claude/projects/` |
| 权限模式 | `CLAUDE_PERMISSION_MODE=dontAsk` |
| 超时 | `CLAUDE_TIMEOUT_SECONDS=1800`（默认） |
| 持久化 Volume | `tide-claude-home` → `/root/.claude`（`settings.json`） + `tide-agent-home` → `/app/.agent` |

**`/root/.claude/settings.json` 完整内容**（Dockerfile 预置）：

```json
{
  "theme": "dark",
  "env": {
    "ANTHROPIC_API_KEY": "PROXY_MANAGED",
    "ANTHROPIC_BASE_URL": "http://tide-cc-switch:15721"
  }
}
```

**CLI 调用示例**：

```bash
claude --print --output-format stream-json --verbose \
  -m claude-sonnet-4-5 \
  --permission-mode dontAsk \
  --resume <session_id> \
  "<prompt>"
```

#### 3.3.3 Qoder Agent

| 项目 | 值 |
|------|------|
| 版本 | 1.0.20 |
| 二进制 | `/usr/local/bin/qodercli` → `/usr/local/lib/node_modules/@qoder-ai/qodercli/bundle/qodercli.js` |
| Policy 链接 | `/usr/local/bin/policies` → `/usr/local/lib/node_modules/@qoder-ai/qodercli/bundle/policies`（缺失会导致 qodercli 启动失败） |
| 认证方式 | Personal Access Token (PAT)，环境变量 `QODER_PERSONAL_ACCESS_TOKEN`（以 `pt-` 开头） |
| 上游路径 | **不走 CC Switch**，直连 Qoder 官方 API |
| 工作目录 | `QODER_HOME=/app/.agent/qoder`；项目在 `/app/.agent/qoder/projects/` |
| 权限模式 | `QODER_PERMISSION_MODE=dont_ask` |
| Quest 超时 | `QODER_QUEST_TIMEOUT_SECONDS=43200`（12 小时） |
| 持久化 Volume | `tide-qoder-home` → `/root/.qoder`（PAT 认证数据） + `tide-agent-home` → `/app/.agent` |

**CLI 调用示例**：

```bash
qodercli --print --output-format stream-json \
  --cwd /app/data/projects/<project_id> \
  --permission-mode dont_ask \
  --resume <session_id> \
  "<prompt>"
```

### 3.4 Backend 全局环境变量汇总

**数据库**:
```
DATABASE_URL=sqlite+aiosqlite:////app/data/tide.db
```

**Agent 工作目录**:
```
CODEX_HOME=/app/.agent/codex
CLAUDE_HOME=/app/.agent/claude
QODER_HOME=/app/.agent/qoder
CODEX_SESSIONS_DIR=/app/.agent/codex/sessions
CLAUDE_PROJECTS_DIR=/app/.agent/claude/projects
QODER_PROJECTS_DIR=/app/.agent/qoder/projects
```

**API 代理配置**:
```
# Codex → CC Switch (仅 placeholder)
OPENAI_API_KEY=proxy-placeholder

# Claude → CC Switch
ANTHROPIC_API_KEY=PROXY_MANAGED
ANTHROPIC_BASE_URL=http://tide-cc-switch:15721

# Qoder → 直连官方 API（不走 CC Switch）
QODER_PERSONAL_ACCESS_TOKEN=pt-xxxxxxxxxxxx

# Agent 行为
CODEX_APPROVAL_POLICY=on-request
CODEX_SANDBOX_MODE=workspace-write
CLAUDE_PERMISSION_MODE=dontAsk
QODER_PERMISSION_MODE=dont_ask
QODER_QUEST_TIMEOUT_SECONDS=43200

# 代理绕过名单
NO_PROXY=localhost,127.0.0.1,backend,frontend,cc-switch,open.larksuite.com,open.feishu.cn,*.larksuite.com,*.feishu.cn
```

### 3.5 启动命令

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

**单进程约束**: APScheduler、Lark Listener、WebSocket Hub 均依赖进程内内存状态，禁止 `--workers > 1`。

### 3.6 健康检查

```python
curl http://127.0.0.1:8000/health
# Interval: 30s, Timeout: 5s, Retries: 5, Start period: 20s
```

### 3.7 Volume 挂载

| 目标路径 | Volume 名 | 物理位置 | 用途 |
|---------|----------|--------|------|
| /app/data | tide-data | `/var/lib/docker/volumes/tide_tide-data/_data` | SQLite 数据库 + 项目目录 |
| /app/.tide | tide-runtime | `/var/lib/docker/volumes/tide_tide-runtime/_data` | 运行时状态文件 (.tide_state.json) |
| /app/.agent | tide-agent-home | `/var/lib/docker/volumes/tide_tide-agent-home/_data` | Codex/Claude/Qoder 工作目录（含 Codex `config.toml`） |
| /root/.qoder | tide-qoder-home | `/var/lib/docker/volumes/tide_tide-qoder-home/_data` | Qoder PAT 认证数据 |
| /root/.claude | tide-claude-home | `/var/lib/docker/volumes/tide_tide-claude-home/_data` | Claude 配置 (settings.json) |

### 3.8 依赖

- **depends_on**: cc-switch (必须先启动)

---

## 4. Frontend 容器 (Next.js)

### 4.1 构建配置

**Dockerfile 路径**: `/Users/haifeng/Documents/tide/Dockerfile.frontend`

多阶段构建：
```
Stage 1: builder (Node.js 20-alpine)
  ├─ 启用 corepack (yarn classic)
  ├─ 安装 monorepo 依赖: yarn install --frozen-lockfile
  ├─ 复制源码 (apps/web, packages/*)
  └─ 构建: yarn workspace @tide/web build

Stage 2: runner (Node.js 20-alpine)
  ├─ 创建非 root 用户 (nextjs:1001)
  ├─ 复制 node_modules、yarn.lock、构建产物
  └─ 启动: yarn start
```

### 4.2 构建参数

| 参数 | 值 | 说明 |
|------|-----|------|
| NEXT_PUBLIC_BASE_PATH | /tide | 子路径部署（Nginx 路由映射） |
| API_BACKEND_URL | http://backend:8000 | 构建时注入 (next.config.ts rewrites) |
| NODE_ENV | production | |
| PORT | 3000 | |
| HOSTNAME | 0.0.0.0 | |

### 4.3 环保机制

**构建时**:
- `.env` 文件注入（NEXT_PUBLIC_* 变量嵌入产物）
- next.config.ts 中 `outputFileTracingRoot=../..` 指向 monorepo 根

**运行时**:
- API 代理: `/api` 和 `/ws` → `http://backend:8000`（next.config.ts rewrites）
- basePath 配置: `/tide` 用于子路径部署

### 4.4 依赖

- **depends_on**: backend (service_started)

---

## 5. 核心运行时逻辑

### 5.1 Agent 执行器 (AgentExecutor)

**文件**: `backend/runtime/executor.py`

**核心功能**:
1. **命令构建**: 通过 Agent 适配器 (Codex/Claude/Qoder) 构建 CLI 命令
2. **异步执行**: `asyncio.create_subprocess_exec()` 启动子进程
3. **事件流解析**: 逐行读取 stdout JSON 事件，转换为 TaskEvent
4. **Resume 降级**: 若 resume 失败（thread 不存在），自动降级为新建会话
5. **进程管理**: 维护 task_id → Process 映射，支持取消和查询

**TaskEvent 类型**:
- `started`: 任务开始
- `session_id`: 新建会话
- `output`: 普通输出
- `tool_output`: 工具执行结果
- `progress`: 进度提示
- `approval_request`: 需要审批
- `completed`: 成功完成
- `failed`: 执行失败
- `cancelled`: 任务取消

### 5.2 Agent 适配器注册表 (AgentAdapter)

**文件**: `backend/runtime/adapters.py`

三个适配器及其配置：

#### CodexAdapter
```
ID: codex
Binary: codex
Timeout: CODEX_TIMEOUT_SECONDS (default: 1800s)
Valid Models: {auto, ultimate, performance, efficient, lite}
Approval Policy: CODEX_APPROVAL_POLICY (default: on-request)
Sandbox Mode: CODEX_SANDBOX_MODE (default: workspace-write)
```

**命令构建**:
```bash
codex [-m model] [-a approval_policy] [-s sandbox_mode] exec 
  [--output-last-message file]
  [resume --json --skip-git-repo-check session_id prompt | --json --skip-git-repo-check -C cwd prompt]
```

#### ClaudeAdapter
```
ID: claude
Binary: claude
Timeout: CLAUDE_TIMEOUT_SECONDS (default: 1800s)
Permission Mode: CLAUDE_PERMISSION_MODE (default: dontAsk)
```

**命令构建**:
```bash
claude --print --output-format stream-json --verbose 
  [-m model] [--permission-mode mode]
  [--resume session_id]
  [CLAUDE_EXTRA_ARGS]
  prompt
```

#### QoderAdapter
```
ID: qoder
Binary: qodercli
Timeout: QODER_TIMEOUT_SECONDS (default: 1800s)
Permission Mode: QODER_PERMISSION_MODE (default: dont_ask)
```

**命令构建**:
```bash
qodercli --print --output-format stream-json --cwd cwd
  [-m model] [--permission-mode mode]
  [--resume session_id]
  [QODER_EXTRA_ARGS]
  prompt
```

### 5.3 配置管理 (backend/runtime/config.py)

**来源优先级**:
1. 环境变量 (docker-compose.yml environment)
2. .env 文件 (docker-compose.yml env_file)
3. 代码中的默认值

**关键配置常量** (共 80+ 个):
- Lark: APP_ID, APP_SECRET, DOMAIN, 加密密钥等
- Codex: 模型、超时、审批策略、沙箱模式
- Claude: 权限模式、额外参数
- Qoder: 权限模式、Quest 超时
- 消息和性能: 分片大小、最大并行数、事件队列
- 认证: JWT Secret、Admin 凭证、密码策略

---

## 6. 网络拓扑

### 6.1 Docker Networks

| Network | Driver | 用途 | 容器成员 |
|---------|--------|------|---------|
| tide_tide-network | bridge | Tide 内部通信 | cc-switch, backend, frontend |
| brainstorming_default | bridge (external) | 与 brainstorming 项目通信 | frontend |

### 6.2 服务间通信

```
frontend (3000)
  ├─ API 请求 → backend:8000 (/api 和 /ws rewrites)
  ├─ 构建时注入 API_BACKEND_URL=http://backend:8000
  └─ brainstorming_default 网络（external）→ 供 Nginx 反向代理

backend (8000)
  ├─ Agent CLI
  │   ├─ codex     → config.toml model_provider=proxy → http://cc-switch:15721/v1
  │   ├─ claude    → ANTHROPIC_BASE_URL=http://tide-cc-switch:15721
  │   └─ qodercli  → QODER_PERSONAL_ACCESS_TOKEN → Qoder 官方 API（不走 CC Switch）
  ├─ Lark API → open.larksuite.com / open.feishu.cn（NO_PROXY 绕过）
  └─ 内部 HTTP 服务 → backend, frontend, cc-switch（NO_PROXY）

cc-switch (15721 / 15722 / 15723)
  └─ prana-hub provider → https://llm-api.prana.chat
```

### 6.2.1 调用链路明细

```
┌─────────────┐    config.toml      ┌──────────────────────┐      ┌────────────────────┐
│  Codex CLI  ├──────────────────►│ cc-switch:15721/v1   ├────►│ llm-api.prana.chat │
└─────────────┘   wire_api=responses  │ (CC Switch proxy)    │  v1  └────────────────────┘
                                       │ apiFormat:           │
┌─────────────┐    ANTHROPIC_BASE_URL │  anthropic_messages  │
│  Claude CLI ├──────────────────►│                      │
└─────────────┘   /v1/messages         └──────────────────────┘

┌─────────────┐    QODER_PERSONAL_ACCESS_TOKEN          ┌───────────────────┐
│  Qoder CLI  ├───────────────────────────────────────►│ Qoder 官方 API   │
└─────────────┘    （直连，不经过 CC Switch）             └───────────────────┘
```

文本版本：

```
Codex CLI  → config.toml             → http://cc-switch:15721/v1     → CC Switch → https://llm-api.prana.chat
Claude CLI → ANTHROPIC_BASE_URL       → http://tide-cc-switch:15721   → CC Switch → https://llm-api.prana.chat
Qoder CLI  → QODER_PERSONAL_ACCESS_TOKEN                              → Qoder 官方 API（不经 CC Switch）
```

### 6.3 网络隔离和 NO_PROXY

```
NO_PROXY=localhost,127.0.0.1,backend,frontend,cc-switch,
         open.larksuite.com,open.feishu.cn,
         *.larksuite.com,*.feishu.cn
```

**目的**: Lark 和 Codex 内部调用不经过 CC Switch 代理；仅 Claude API 请求通过 CC Switch。

---

## 7. 持久化存储

### 7.1 数据卷 (Docker Volumes)

| Volume | Size | Mount Point | 内容 |
|--------|------|-----------|------|
| tide_tide-data | N/A | /app/data | tide.db (SQLite), 项目源码目录 |
| tide_tide-runtime | N/A | /app/.tide | .tide_state.json, .tide_archived.json, 附件目录, worktrees |
| tide_tide-agent-home | N/A | /app/.agent | codex/, claude/, qoder/ (会话和项目文件、Codex `config.toml`) |
| tide_tide-qoder-home | N/A | /root/.qoder | Qoder PAT 认证数据 |
| tide_tide-claude-home | N/A | /root/.claude | Claude 配置 (settings.json, projects/) |
| tide_cc-switch-data | 516 KB | /root/.cc-switch | cc-switch.db (Provider 配置), settings.json |

**Volume 与容器映射**：

| Volume | 挂载到的容器 | 容器内路径 | 用途 |
|--------|--------------|-------------|------|
| tide-data | tide-backend | /app/data | SQLite DB + 项目目录 |
| tide-runtime | tide-backend | /app/.tide | 运行时状态 |
| tide-agent-home | tide-backend | /app/.agent | codex/claude/qoder 工作目录 |
| tide-qoder-home | tide-backend | /root/.qoder | Qoder PAT 认证数据 |
| tide-claude-home | tide-backend | /root/.claude | Claude 全局配置 |
| cc-switch-data | tide-cc-switch | /root/.cc-switch | CC Switch DB + 设置 |

**物理存储** (服务器):
```
/var/lib/docker/volumes/tide_*/
```

### 7.2 SQLite 数据库

**主数据库**: `/app/data/tide.db`

**表结构** (推测，基于代码):
- users / conversations / tasks / schedules / workflows
- approvals / events / sessions / work_items
- 等等

---

## 8. 环境变量和配置

### 8.1 关键环境变量

**来自 docker-compose.yml**:
```yaml
backend:
  env_file: .env
  environment:
    DATABASE_URL: sqlite+aiosqlite:////app/data/tide.db
    NO_PROXY: "localhost,127.0.0.1,backend,frontend,cc-switch,..."
    OPENAI_API_KEY: "proxy-placeholder"
    ANTHROPIC_API_KEY: "PROXY_MANAGED"
    ANTHROPIC_BASE_URL: "http://tide-cc-switch:15721"
    CODEX_HOME: /app/.agent/codex
    CLAUDE_HOME: /app/.agent/claude
    QODER_HOME: /app/.agent/qoder
    # ... 等 30+ 个变量

frontend:
  env_file: .env
  environment:
    API_BACKEND_URL: http://backend:8000
    NEXT_PUBLIC_BASE_PATH: /tide
    NODE_ENV: production
    PORT: "3000"
    HOSTNAME: "0.0.0.0"
```

**来自 .env 文件** (脱敏):
- LARK_APP_ID, LARK_APP_SECRET, LARK_DOMAIN
- LARK_ENCRYPT_KEY, LARK_VERIFICATION_TOKEN
- CODEX_DEFAULT_CWD, CODEX_TIMEOUT_SECONDS, CODEX_MODEL
- CLAUDE_PERMISSION_MODE, APPROVED_CLAUDE_PERMISSION_MODE
- QODER_PERMISSION_MODE, QODER_PERSONAL_ACCESS_TOKEN
- CODEX_APPROVAL_POLICY, CODEX_SANDBOX_MODE
- PLAN_MAX_PARALLEL, PLAN_USE_WORKTREES
- TIDE_JWT_SECRET, TIDE_REQUIRE_AUTH, TIDE_ADMIN_USERNAME
- 80+ 配置参数

### 8.2 路径配置原则

**容器内必须使用绝对路径** (Docker 不展开 ~):
```
✓ /app/.agent/codex
✗ ~/.codex 或 $HOME/.codex
```

**覆盖规则** (优先级从高到低):
1. docker-compose.yml environment
2. .env 文件
3. config.py 代码默认值

---

## 9. 部署流程

### 9.1 首次构建和启动

```bash
# 1. 构建镜像
docker-compose build

# 2. 启动容器
docker-compose up -d

# 3. 配置 CC Switch Provider（手动）
docker exec tide-cc-switch cc-switch provider add
# 输入 API Key、选择 Provider（claude、codex、gemini）

# 4. 启用 CC Switch 代理
docker exec tide-cc-switch cc-switch proxy enable

# 5. 重启 CC Switch 容器
docker restart tide-cc-switch

# 6. 验证健康状态
docker-compose ps
# tide-backend 应显示 "Up X hours (healthy)"
```

### 9.2 环境准备

**本地开发环境**:
- 需要在 `/Users/haifeng/Documents/tide` 目录运行 docker-compose 命令
- .env 文件需配置 Lark 凭证、Agent 参数、认证秘钥等

**服务器部署环境**:
- 服务器 IP: 172.16.79.51
- 数据卷自动创建在 `/var/lib/docker/volumes/`
- CC Switch 首次需要交互式配置

---

## 10. 关键技术决策和约束

### 10.1 多阶段 Dockerfile

**原因**:
- 最小化最终镜像大小
- Agent CLI 需要 Node.js 环境，但后端仅需 Python
- 符号链接保留确保 require.resolve 正确工作

**风险**:
- COPY --from 破坏符号链接（需用 -p 标志或脚本处理）

### 10.2 单进程 uvicorn

**原因**:
- APScheduler、Lark Listener、WebSocket Hub 依赖进程内内存状态
- 多进程无法共享内存，导致任务重复执行或事件丢失

**约束**:
- 禁止设置 `--workers > 1`
- 性能扩展需要 Redis 等分布式状态管理

### 10.3 CC Switch 代理集中管理

**优势**:
- 统一管理 API Key 和模型路由
- 支持多 Provider 切换（Anthropic、OpenAI、Google）
- Codex 不支持 CONNECT 隧道，需直连 API 路由

**劣势**:
- CC Switch 宕机影响所有 Claude 请求
- 需要手动配置 Provider，无自动发现

### 10.4 NO_PROXY 白名单

**设计**:
```
NO_PROXY=localhost,127.0.0.1,backend,frontend,cc-switch,
         open.larksuite.com,open.feishu.cn,*.larksuite.com,*.feishu.cn
```

**意义**:
- Lark 和 Codex 内部调用绕过 CC Switch
- 避免代理链过长或循环

---

## 11. 故障排查指南

### 11.1 Backend 容器无法启动

**症状**: `docker logs tide-backend` 显示模块导入错误

**排查**:
```bash
# 1. 检查 Agent CLI 是否安装
docker exec tide-backend which codex claude qodercli

# 2. 检查符号链接
docker exec tide-backend ls -la /usr/local/bin/{codex,claude,qodercli}

# 3. 验证 Node.js 在 PATH
docker exec tide-backend which node npm
```

**常见原因**:
- Dockerfile COPY --from 破坏符号链接
- 多阶段构建基础镜像不兼容

### 11.2 Claude 执行失败

**症状**: 任务返回 "not logged in" 、 API 500 或 `convert_request_failed`

**排查**:
```bash
# 1. 检查 CC Switch 是否运行
docker exec tide-cc-switch cc-switch provider current

# 2. 检查 prana-hub provider 的 apiFormat
docker exec tide-cc-switch sqlite3 /root/.cc-switch/cc-switch.db \
  "SELECT id, app_type, json_extract(meta,'$.apiFormat') FROM providers;"
# 期望: prana-hub | claude | anthropic_messages

# 3. 检查 Claude 配置
docker exec tide-backend cat /root/.claude/settings.json

# 4. 测试连接
docker exec tide-backend curl -sv http://tide-cc-switch:15721/health

# 5. 检查上游反转设置
docker exec tide-cc-switch cc-switch provider stream-check prana-hub -a claude
```

**常见原因**:
- CC Switch 无有效 Provider 配置
- prana-hub `apiFormat` 误设为 `openai_responses`，需改回 `anthropic_messages`
- `ANTHROPIC_BASE_URL` 指向错误地址（应为 `http://tide-cc-switch:15721`）
- 网络隔离（cc-switch 容器默认监听 127.0.0.1 而非 0.0.0.0）
- ANTHROPIC_MODEL 设为 OpenAI 模型名（需为上游支持的 Claude 型号）

### 11.3 会话恢复 (Resume) 失败

**症状**: 任务报错 "no rollout found" 或 "no conversation found"

**排查**:
```bash
# 1. 检查会话文件是否存在
docker exec tide-backend ls /app/.agent/codex/sessions/

# 2. 查看最近日志
docker logs tide-backend | tail -50 | grep -i resume

# 3. 验证数据卷挂载
docker inspect tide-backend | grep -A 20 Mounts
```

**自动降级机制**: executor.py 自动检测 resume 失败，自动转为新建会话

---

## 12. 监控和维护

### 12.1 健康检查

**Backend**:
```bash
curl http://localhost:8000/health
# 预期: 200 OK
```

**Frontend**:
```bash
curl http://localhost:3000/tide
# 预期: 3xx redirect 或 200 OK
```

**CC Switch** (手动):
```bash
docker exec tide-cc-switch cc-switch provider current
docker exec tide-cc-switch curl -s http://localhost:15721/health || echo "PROXY_NOT_RUNNING"
```

### 12.2 日志采集

```bash
# Backend 日志
docker logs tide-backend -f

# Frontend 日志
docker logs tide-frontend -f

# CC Switch 日志
docker logs tide-cc-switch -f

# 容器事件
docker events --filter type=container
```

### 12.3 容量规划

**数据卷预期大小**:
- tide_tide-data: 100MB - 1GB (SQLite + 项目代码)
- tide_tide-agent-home: 100MB - 500MB (Agent 会话和项目)
- cc-switch-data: < 10MB (Provider 配置)

**单进程约束下的并发限制**:
- MAX_RUNNING_TASKS: 6 (全局)
- MAX_RUNNING_TASKS_PER_CHAT: 4 (单个 Lark 群)

---

## 13. 安全考虑

### 13.1 凭证管理总结表

| 凭证 | 存储位置 | 使用者 | 上游路由 | 说明 |
|------|---------|--------|---------|------|
| prana-hub Anthropic Key | `cc-switch.db` (`/root/.cc-switch/cc-switch.db`)、`providers.api_key` | CC Switch | `https://llm-api.prana.chat` | 为 Claude / Codex 提供实际密钥，后端不可见 |
| `OPENAI_API_KEY` | docker-compose `environment` (值=`proxy-placeholder`) | Codex CLI | — | 仅占位，避免 Codex CLI 报“未设置 Key” |
| `ANTHROPIC_API_KEY` | docker-compose / `/root/.claude/settings.json` (值=`PROXY_MANAGED`) | Claude CLI | — | 占位值，实际 Key 由 CC Switch 注入 |
| `ANTHROPIC_BASE_URL` | docker-compose / `settings.json`（`http://tide-cc-switch:15721`） | Claude CLI | CC Switch | 路由入口 |
| Codex `config.toml` | `/app/.agent/codex/config.toml`（volume `tide-agent-home`） | Codex CLI | CC Switch | `model_provider=proxy`，`base_url=http://cc-switch:15721/v1` |
| `QODER_PERSONAL_ACCESS_TOKEN` | `.env` / docker-compose `environment` (`pt-` 开头) | Qoder CLI | Qoder 官方 API | **不走 CC Switch**，直连 Qoder 官方 |
| Qoder 认证数据 | `/root/.qoder`（volume `tide-qoder-home`） | Qoder CLI | Qoder 官方 API | PAT 验证后的会话状态 |
| `TIDE_JWT_SECRET` | `.env` | Tide Backend | — | 后端 JWT 签名密钥（强随机 32+ 字符） |
| `TIDE_ADMIN_USERNAME/PASSWORD` | `.env` | Tide Backend | — | 初始管理员账号 |
| `LARK_APP_ID/APP_SECRET` | `.env` | Tide Backend | open.larksuite.com / open.feishu.cn | 只读，不提交 git |

**API Keys 存储位置汇总**：
```
CC Switch 数据库（唯一真实 Key 位置）: /root/.cc-switch/cc-switch.db（volume cc-switch-data）
Claude 配置（占位）         : /root/.claude/settings.json（volume tide-claude-home）
Codex 配置（代理路由）       : /app/.agent/codex/config.toml（volume tide-agent-home）
Qoder PAT 认证                : .env + /root/.qoder（volume tide-qoder-home）
```

**最佳实践**:
- `.env` 文件勿提交 Git（已在 `.gitignore`）
- `cc-switch-data` 数据卷需定期备份：`docker run --rm -v tide_cc-switch-data:/data -v $PWD:/backup alpine tar czf /backup/cc-switch-$(date +%F).tgz /data`
- `TIDE_JWT_SECRET` 应为强随机值（当前 32 字符）
- 轮换 prana-hub Key 只需 `docker exec tide-cc-switch cc-switch provider edit prana-hub`，后端无需重启

### 13.2 网络安全

**隔离措施**:
- Backend 仅监听 0.0.0.0:8000 (外网访问需 Nginx 反向代理)
- CC Switch 监听 0.0.0.0:15721-15723 (但 Dockerfile.cc-switch 未配 Nginx)
- Frontend 监听 0.0.0.0:3000
- 内部网络 (tide-network) 隔离

**NO_PROXY 白名单**:
- 防止敏感请求（Lark、Codex 内部）被代理拦截

---

## 14. 文件清单

| 路径 | 类型 | 说明 |
|-----|------|------|
| /Users/haifeng/Documents/tide/docker-compose.yml | Config | 容器编排配置 |
| /Users/haifeng/Documents/tide/Dockerfile.backend | Config | Backend 多阶段构建 |
| /Users/haifeng/Documents/tide/Dockerfile.frontend | Config | Frontend 多阶段构建 |
| /Users/haifeng/Documents/tide/Dockerfile.cc-switch | Config | CC Switch 容器 |
| /Users/haifeng/Documents/tide/.env | Secret | 环境变量 (勿提交) |
| /Users/haifeng/Documents/tide/backend/runtime/config.py | Code | 配置常量和加载逻辑 |
| /Users/haifeng/Documents/tide/backend/runtime/executor.py | Code | Agent 异步执行器 |
| /Users/haifeng/Documents/tide/backend/runtime/adapters.py | Code | Codex/Claude/Qoder 适配器 |
| /Users/haifeng/Documents/tide/apps/web/next.config.ts | Config | Next.js 配置 (rewrites、basePath) |
| /Users/haifeng/Documents/tide/package.json | Config | Monorepo root 清单 |

---

## 15. 故障恢复检查表

```
[ ] 确认 cc-switch 容器已配置 Provider
[ ] 确认 backend 启动日志无异常 (PYTHONUNBUFFERED=1)
[ ] 确认 frontend yarn start 成功
[ ] 确认 database health check 通过 (HTTP 200 /health)
[ ] 测试 Agent CLI 可执行 (which codex, claude, qodercli)
[ ] 测试 Claude 连通性 (curl http://tide-cc-switch:15721)
[ ] 检查 volume 挂载正确 (docker inspect)
[ ] 确认 .env 文件完整且密钥有效
[ ] 验证 NO_PROXY 白名单包含所有需要绕过的域名
[ ] 备份 cc-switch-data volume 和 SQLite 数据库
```

---

## 16. 版本信息快照

生成时间: 2024-06-15 (部署 32 小时后)

| 组件 | 版本 | 状态 |
|------|------|------|
| Docker Compose | 3.9 | ✓ 活跃 |
| Backend Image | tide-backend:latest | ✓ Up 32h (healthy) |
| Frontend Image | tide-frontend:latest | ✓ Up 32h |
| CC Switch Image | tide-cc-switch:latest | ✓ Up 32h |
| Codex CLI | 0.139.0 | ✓ 安装且可用 |
| Claude Code | 2.1.177 | ✓ 安装且可用 |
| Qoder CLI | 1.0.20 | ✓ 安装且可用 |
| Python | 3.11-slim | ✓ Backend 基础镜像 |
| Node.js (Backend) | 22-slim | ✓ Agent CLI 阶段 |
| Node.js (Frontend) | 20-alpine | ✓ Builder 和 Runner |
| Alpine | 3.19 | ✓ CC Switch 基础镜像 |

---

## 17. 后续改进建议

### 17.1 高可用性

1. **多副本 Backend**: 需要 Redis 共享状态
2. **CC Switch 冗余**: 部署多个 CC Switch 实例 + 负载均衡
3. **数据卷备份**: 定期快照 SQLite 和 Agent 工作目录

### 17.2 监控和告警

1. **容器监控**: Prometheus + Grafana
2. **日志聚合**: ELK Stack 或 Loki
3. **性能指标**: CPU、内存、磁盘使用率、API 延迟

### 17.3 自动化

1. **部署流程**: 脚本化 CC Switch Provider 初始化
2. **版本管理**: CI/CD 流水线自动构建和推送镜像
3. **灾难恢复**: 自动化备份和恢复脚本

---

**文档版本**: 1.1  
**最后更新**: 2024-06-15  
**变更说明**: 补齐 CC Switch prana-hub Provider / apiFormat / 启动逻辑；为 Codex · Claude · Qoder 三个 Agent 拆分独立详细章节；重绘调用链路图与凭证管理总结表。  
**维护人**: 研究分析团队
