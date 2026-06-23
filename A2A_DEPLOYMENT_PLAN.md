# Tide A2A 多 Agent K8s 分布式部署方案

> 文档版本：v1.0
> 适用范围：Tide 平台从单体 Docker Compose 演进到 Kubernetes 多节点分布式部署
> 核心策略：复用已有 A2A 基础设施，将本地 Agent CLI 拆分为独立 Worker Pod

---

## 1. 方案概述

### 1.1 背景

Tide 是一个工作流驱动的 AI Agent 编排平台，目前的部署形态为单体 Docker Compose：
- Backend(FastAPI) 通过 `subprocess` 在容器内拉起 Codex/Claude/Qoder 等 CLI Agent
- 多 Agent 共用一个容器，CLI 的安装、升级、隔离均不便
- SQLite 单机存储，无法横向扩展
- 单点故障：任一 Agent CLI 崩溃可能影响 Backend 主进程

### 1.2 目标

- **执行解耦**：Backend 不再直接 `subprocess` 启动 CLI，全部通过 A2A 协议远程调用 Worker Pod
- **独立扩缩容**：Codex/Claude/Qoder 各自独立部署，按负载独立扩缩容
- **故障隔离**：单个 Worker Pod 崩溃不影响主控面与其他 Agent
- **动态接入第三方 Agent**：通过 A2A 协议规范化接入第三方 Agent
- **存储集中化**：SQLite → PostgreSQL，支持多副本 Backend

### 1.3 核心策略

> **关键洞察**：Tide 项目**已经具备完整的 A2A 客户端基础设施**，无需从零构建协议层。

已有能力：
- A2A JSON-RPC 客户端（[a2a_client.py](file:///Users/haifeng/Documents/tide/backend/runtime/a2a_client.py)）
- A2A 适配器（[adapters.py](file:///Users/haifeng/Documents/tide/backend/runtime/adapters.py) 中的 `A2AAdapter`）
- A2A 服务发现与健康检查（[a2a_discovery.py](file:///Users/haifeng/Documents/tide/backend/services/a2a_discovery.py)）
- Executor 路由：`agent_id` 以 `a2a:` 前缀路由到远程执行（[executor.py](file:///Users/haifeng/Documents/tide/backend/runtime/executor.py)）
- `remote_agents` 表，存储远程 Agent 注册信息

**因此本方案的工作重心是**：
1. 将本地 CLI Agent 包装为 A2A Server（Worker Pod）
2. K8s 编排与服务发现
3. SQLite → PostgreSQL 迁移
4. 生产级运维（监控、日志、扩缩容）

### 1.4 方案优势

| 优势 | 说明 |
|------|------|
| **独立扩缩容** | 同类 Worker 可基于 HPA 独立水平扩展 |
| **故障隔离** | Pod 崩溃只影响该副本，其他任务不受影响 |
| **滚动升级** | CLI 版本变更只需更新对应 Worker 镜像 |
| **动态接入** | 第三方 A2A Agent 通过注册即可使用 |
| **资源精细化** | Codex 通常重 IO，Claude 重 CPU，可差异化 Resource Limits |
| **多租户友好** | 通过 Namespace + NetworkPolicy 实现租户隔离 |

---

## 2. 架构总览

### 2.1 当前架构（单体）

```
┌──────────────┐
│   Browser    │
└──────┬───────┘
       │ HTTPS
       ▼
┌──────────────────────────────────────────────────────────┐
│  docker-compose.yml (单宿主机)                           │
│                                                          │
│  ┌────────────┐   ┌──────────────────────────────────┐   │
│  │ Frontend   │   │ Backend Container                │   │
│  │ (Next.js)  │◀─▶│  ┌─────────────────────────────┐ │   │
│  └────────────┘   │  │ FastAPI + APScheduler       │ │   │
│                   │  │ + SQLite (tide.db)          │ │   │
│                   │  └────────────┬────────────────┘ │   │
│                   │               │ subprocess       │   │
│                   │  ┌────────────▼────────────────┐ │   │
│                   │  │ Codex CLI / Claude CLI /    │ │   │
│                   │  │ Qoder CLI                   │ │   │
│                   │  └────────────┬────────────────┘ │   │
│                   └───────────────┼──────────────────┘   │
│                                   │ HTTP                 │
│                   ┌───────────────▼──────────────────┐   │
│                   │  CC Switch Container             │   │
│                   │  (Proxy → LLM Providers)         │   │
│                   └───────────────┬──────────────────┘   │
└───────────────────────────────────┼──────────────────────┘
                                    │ HTTPS
                                    ▼
                          ┌─────────────────────┐
                          │ Anthropic / OpenAI  │
                          │ Qoder / 其他 LLM    │
                          └─────────────────────┘
```

**痛点**：所有 CLI 与 Backend 共生，故障域大；状态强依赖本地 SQLite 与文件系统。

### 2.2 目标架构（K8s 分布式）

```
                                 ┌────────────────┐
                                 │  External      │
                                 │  3rd-party     │
                                 │  A2A Agents    │
                                 └───────┬────────┘
                                         │ HTTPS (A2A JSON-RPC)
                                         ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Kubernetes Cluster                                                      │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │  Ingress Controller (Nginx / Traefik / Istio Gateway)            │    │
│  │   /tide       → frontend-svc                                     │    │
│  │   /tide/api   → backend-svc                                      │    │
│  │   /tide/ws    → backend-svc (WebSocket upgrade)                  │    │
│  └──────────────┬───────────────────────────────┬───────────────────┘    │
│                 │                               │                        │
│  ┌──────────────▼─────────┐         ┌───────────▼───────────────────┐    │
│  │ ns: tide-system        │         │ ns: tide-system               │    │
│  │ ┌────────────────────┐ │         │ ┌──────────────────────────┐  │    │
│  │ │ frontend (Next.js) │ │         │ │ backend (FastAPI)        │  │    │
│  │ │  Deployment x N    │ │         │ │  Deployment x 2          │  │    │
│  │ │  Service ClusterIP │ │         │ │  - A2A Client Hub        │  │    │
│  │ └────────────────────┘ │         │ │  - WS Hub                │  │    │
│  └────────────────────────┘         │ │  - APScheduler (leader)  │  │    │
│                                     │ └──────────┬───────────────┘  │    │
│                                     └────────────┼──────────────────┘    │
│                                                  │ A2A JSON-RPC          │
│              ┌───────────────────────────────────┴────────────────┐      │
│              │                                                    │      │
│  ┌───────────▼────────────────────────────────────────────────────▼───┐  │
│  │  ns: tide-agents                                                   │  │
│  │                                                                    │  │
│  │  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐        │  │
│  │  │ codex-worker   │  │ claude-worker  │  │ qoder-worker   │        │  │
│  │  │ Deployment x 2 │  │ Deployment x 2 │  │ Deployment x 1 │        │  │
│  │  │ Service:9000   │  │ Service:9000   │  │ Service:9000   │        │  │
│  │  │ + HPA          │  │ + HPA          │  │ + HPA          │        │  │
│  │  │ + PVC sessions │  │ + PVC sessions │  │ + PVC sessions │        │  │
│  │  └───────┬────────┘  └───────┬────────┘  └────────┬───────┘        │  │
│  └──────────┼────────────────────┼─────────────────────┼─────────────┘   │
│             │                    │                     │ (Qoder 直连)    │
│             ▼                    ▼                     │                 │
│  ┌───────────────────────────────────────────┐         │                 │
│  │  ns: tide-infra                           │         │                 │
│  │  ┌────────────────┐  ┌─────────────────┐  │         │                 │
│  │  │ cc-switch      │  │ postgres        │  │         │                 │
│  │  │ StatefulSet x1 │  │ StatefulSet x1  │  │         │                 │
│  │  │ Svc:8080       │  │ Svc:5432        │  │         │                 │
│  │  └───────┬────────┘  └─────────────────┘  │         │                 │
│  │          │                                │         │                 │
│  │  ┌───────┴─────┐                          │         │                 │
│  │  │ redis (opt.)│  ← session lock / queue  │         │                 │
│  │  └─────────────┘                          │         │                 │
│  └───────────────┬───────────────────────────┘         │                 │
│                  │                                     │                 │
│  ┌───────────────┼─────────────────────────────────────┼──────────────┐  │
│  │ Shared Storage (NFS/EFS - ReadWriteMany)            │              │  │
│  │  /projects/* （多 Worker 共享代码 worktree）        │              │  │
│  └─────────────────────────────────────────────────────┼──────────────┘  │
└────────────────────────────────────────────────────────┼─────────────────┘
                                                         │ Egress
                                                         ▼
                              ┌───────────────────────────────────────┐
                              │  Anthropic / OpenAI / Qoder / 其他    │
                              └───────────────────────────────────────┘
```

### 2.3 当前 vs 目标对比

| 维度 | 当前（Docker Compose） | 目标（K8s 分布式） |
|------|------------------------|---------------------|
| Agent 执行 | 本地 `subprocess` | A2A HTTP/SSE 远程调用 |
| 状态存储 | SQLite + 本地文件 | PostgreSQL + PVC + NFS |
| Agent 扩展 | 修改 Dockerfile.backend | 注册 A2A endpoint |
| 水平扩展 | 不支持 | K8s HPA / KEDA |
| 故障隔离 | 单进程混合 | Pod 级别 |
| 滚动升级 | 整机停机 | 滚动更新 + 健康检查 |
| 多租户 | 不支持 | Namespace + NetworkPolicy |
| 凭证管理 | `.env` 明文 | K8s Secret + Sealed Secrets |
| 监控 | 文本日志 | Prometheus + Grafana + Loki |
| 第三方 Agent | 无 | A2A 注册即用 |

---

## 3. 已有 A2A 基础设施

> 本节梳理 Tide 已实现的 A2A 客户端能力，避免重复造轮子。

### 3.1 A2A Client（[a2a_client.py](file:///Users/haifeng/Documents/tide/backend/runtime/a2a_client.py)）

#### 接口定义
```python
class A2AClient:
    async def send_message(self, params: dict) -> dict
    async def send_streaming_message(self, params: dict) -> AsyncIterator[dict]
    async def get_task(self, task_id: str) -> dict
    async def cancel_task(self, task_id: str) -> dict
    async def discover(self, agent_card_url: str) -> dict
```

#### 关键能力
- **JSON-RPC 2.0** 协议封装：`method`, `params`, `id`, `jsonrpc`
- **SSE 流式支持**：逐行 `data: {...}` JSON 解析，支持中断
- **认证方式**：
  - `bearer`：`Authorization: Bearer <token>`
  - `api_key`：`X-API-Key: <key>` 或自定义 Header
  - `none`：无认证
- **超时控制**：默认 30s（可配置）
- **错误码处理**：`error.code`、`error.message`、`error.data`

### 3.2 A2A Adapter（[adapters.py](file:///Users/haifeng/Documents/tide/backend/runtime/adapters.py) → `A2AAdapter`）

#### 职责
将 A2A 协议事件映射为 Tide 内部 `TaskEvent`，统一与本地 CLI 输出形态。

#### `execute()` 方法
```python
async def execute(
    self,
    *,
    session_id: str,
    prompt: str,
    cwd: str,
    capabilities_streaming: bool,
    ...
) -> AsyncIterator[TaskEvent]:
    if capabilities_streaming:
        async for evt in self._stream_execute(...):
            yield evt
    else:
        async for evt in self._poll_execute(...):
            yield evt
```

#### 事件映射
| A2A 事件 | Tide TaskEvent |
|----------|----------------|
| `statusUpdate` (working/completed/failed) | `status_changed` |
| `artifactUpdate` (chunk) | `output_chunk` |
| `input_required` | `approval_request` |
| `error` | `error` |

#### 超时与重试
- 单次 RPC 超时：30s（可在 `remote_agents` 表配置）
- 流式心跳超时：60s（无事件即重连）
- 最大重试：3 次（指数退避）

### 3.3 A2A Discovery（[a2a_discovery.py](file:///Users/haifeng/Documents/tide/backend/services/a2a_discovery.py)）

#### 关键函数
```python
async def discover(agent_card_url: str) -> AgentCard
async def health_check(endpoint_url: str) -> HealthStatus
async def scheduled_check_all() -> None  # APScheduler 触发
async def validate_auth(remote_agent_id: str) -> bool
```

#### Agent Card 字段
```json
{
  "name": "codex-worker",
  "description": "Codex CLI A2A Worker",
  "version": "1.0.0",
  "capabilities": {
    "streaming": true,
    "input_required": true,
    "cancel": true
  },
  "auth": {
    "type": "bearer"
  },
  "endpoint": "http://codex-worker.tide-agents.svc.cluster.local:9000"
}
```

#### 巡检策略
- 默认每 60s 检查一次所有 `status != disabled` 的 Worker
- 失败 3 次标记为 `unreachable`
- 恢复后自动转回 `healthy`

### 3.4 Executor 路由逻辑（[executor.py](file:///Users/haifeng/Documents/tide/backend/runtime/executor.py)）

```python
async def run_task(agent_id: str, ...):
    if agent_id.startswith("a2a:"):
        remote_id = agent_id[4:]
        async for evt in _run_remote_a2a(remote_id, ...):
            yield evt
    else:
        async for evt in _run_local_cli(agent_id, ...):
            yield evt
```

> **设计要点**：本地 CLI 与远程 A2A 共享 `TaskEvent` 输出格式，上层 Workflow Engine 完全无感知。这意味着**只需把 `agent_id` 从 `codex` 改为 `a2a:codex-worker` 即可切换至远程执行**。

### 3.5 Remote Agents 注册表

`remote_agents` 表核心字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | TEXT PK | Agent 唯一 ID（如 `codex-worker`） |
| `name` | TEXT | 显示名 |
| `endpoint_url` | TEXT | A2A JSON-RPC 端点 |
| `agent_card_url` | TEXT | `/.well-known/agent.json` URL |
| `auth_type` | TEXT | `bearer` / `api_key` / `none` |
| `auth_credentials` | TEXT | 加密存储的凭证 |
| `capabilities_streaming` | INTEGER | 是否支持 SSE 流 |
| `capabilities_input_required` | INTEGER | 是否支持人审 |
| `status` | TEXT | `healthy` / `unreachable` / `disabled` |
| `approval_required` | INTEGER | 调用前是否需人审 |
| `last_check_at` | TIMESTAMP | 最近一次健康检查时间 |
| `latency_ms` | INTEGER | 最近一次延迟 |

---

## 4. Agent Worker Pod 设计

### 4.1 Worker 通用职责

每个 Worker Pod 是一个独立的 A2A Server，职责：

1. **暴露 A2A JSON-RPC 接口**：监听 HTTP 9000 端口
2. **暴露 Agent Card**：`/.well-known/agent.json`
3. **管理子进程生命周期**：内部 `subprocess` 拉起对应 CLI
4. **会话状态管理**：将 `taskId ↔ sessionId ↔ pid` 关系存储在本地 PVC
5. **健康检查**：`/health` 与 `/ready`
6. **优雅关闭**：SIGTERM 时取消所有进行中的 Task

### 4.2 Codex Worker Pod

| 项 | 配置 |
|----|------|
| 基础镜像 | `node:22-slim`（Debian Slim）+ Python 3.11 |
| CLI 安装 | `npm i -g @openai/codex@latest` |
| 配置 | `~/.codex/config.toml` 指向 `http://cc-switch.tide-infra.svc.cluster.local:8080` |
| A2A 端口 | `9000` |
| 资源 | CPU `1000m` / 内存 `2Gi` / 存储 `10Gi` |
| 副本 | 2（HPA 上限 8） |
| 持久化 | PVC `codex-sessions` 挂载 `/root/.codex` |

#### 环境变量
```yaml
- name: CODEX_HOME
  value: /root/.codex
- name: OPENAI_API_KEY
  valueFrom:
    secretKeyRef: { name: codex-secrets, key: api-key }
- name: CC_SWITCH_URL
  value: http://cc-switch.tide-infra.svc.cluster.local:8080
- name: AGENT_ID
  value: codex-worker
- name: A2A_PORT
  value: "9000"
```

### 4.3 Claude Worker Pod

| 项 | 配置 |
|----|------|
| 基础镜像 | `node:22-slim` + Python 3.11 |
| CLI 安装 | `npm i -g @anthropic-ai/claude-code@latest` |
| 配置 | `ANTHROPIC_BASE_URL` 指向 CC Switch |
| A2A 端口 | `9000` |
| 资源 | CPU `1000m` / 内存 `2Gi` / 存储 `10Gi` |
| 副本 | 2（HPA 上限 8） |
| 持久化 | PVC `claude-sessions` 挂载 `/root/.claude` |

#### 环境变量
```yaml
- name: CLAUDE_HOME
  value: /root/.claude
- name: ANTHROPIC_BASE_URL
  value: http://cc-switch.tide-infra.svc.cluster.local:8080/anthropic
- name: ANTHROPIC_API_KEY
  valueFrom:
    secretKeyRef: { name: claude-secrets, key: api-key }
- name: AGENT_ID
  value: claude-worker
- name: A2A_PORT
  value: "9000"
```

> **特别注意**（来自项目记忆）：CC Switch + prana-hub 作为 Claude 代理网关时，Provider 的 `apiFormat` **必须设为 `anthropic_messages`**，否则会触发 `convert_request_failed`。

### 4.4 Qoder Worker Pod

| 项 | 配置 |
|----|------|
| 基础镜像 | `node:22-slim` + Python 3.11 |
| CLI 安装 | `npm i -g @qoder-ai/qodercli@latest` |
| 配置 | PAT Token（**直连 Qoder API，不经 CC Switch**） |
| A2A 端口 | `9000` |
| 资源 | CPU `1000m` / 内存 `2Gi` / 存储 `10Gi` |
| 副本 | 1（HPA 上限 4） |
| 持久化 | PVC `qoder-sessions` 挂载 `/root/.qoder` |

#### 环境变量
```yaml
- name: QODER_HOME
  value: /root/.qoder
- name: QODER_PERSONAL_ACCESS_TOKEN
  valueFrom:
    secretKeyRef: { name: qoder-secrets, key: pat }
- name: AGENT_ID
  value: qoder-worker
- name: A2A_PORT
  value: "9000"
```

> **policies 目录修复**（来自项目记忆）：qodercli 安装后需要符号链接 `policies` 目录，Dockerfile 中需追加 `RUN ln -s $(npm root -g)/@qoder-ai/qodercli/policies /root/.qoder/policies`。

### 4.5 Worker 通用 A2A Server 实现

#### 目录结构
```
agent_worker/
├── server.py            # FastAPI A2A Server
├── adapters/
│   ├── base.py         # CliAdapter 抽象基类
│   ├── codex.py        # Codex CLI 适配
│   ├── claude.py       # Claude CLI 适配
│   └── qoder.py        # Qoder CLI 适配
├── session_store.py     # 本地 PVC 会话状态
├── agent_card.py        # /.well-known/agent.json 生成
├── health.py            # /health /ready
└── Dockerfile
```

#### `server.py` 核心代码
```python
# agent_worker/server.py
"""通用 A2A Worker Server。

启动方式：AGENT_TYPE=codex python -m agent_worker.server
"""
from __future__ import annotations

import asyncio
import json
import os
import uuid
from typing import Any, AsyncIterator

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

from .adapters import build_adapter
from .agent_card import build_agent_card
from .session_store import SessionStore

AGENT_TYPE = os.environ["AGENT_TYPE"]  # codex / claude / qoder
AGENT_ID = os.environ.get("AGENT_ID", f"{AGENT_TYPE}-worker")
A2A_PORT = int(os.environ.get("A2A_PORT", "9000"))

app = FastAPI(title=f"{AGENT_ID} A2A Server")
adapter = build_adapter(AGENT_TYPE)
store = SessionStore(base=os.environ.get("SESSION_DIR", "/data/sessions"))


# ---------- Agent Card ----------
@app.get("/.well-known/agent.json")
async def agent_card() -> JSONResponse:
    return JSONResponse(build_agent_card(agent_id=AGENT_ID, agent_type=AGENT_TYPE))


# ---------- Health ----------
@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "agent": AGENT_ID}


@app.get("/ready")
async def ready() -> dict:
    ok = await adapter.probe()
    if not ok:
        raise HTTPException(503, detail="cli not ready")
    return {"status": "ready"}


# ---------- JSON-RPC ----------
@app.post("/")
async def jsonrpc(request: Request) -> Any:
    body = await request.json()
    method = body.get("method")
    params = body.get("params") or {}
    rpc_id = body.get("id")

    try:
        if method == "message/send":
            result = await _message_send(params)
            return _ok(rpc_id, result)
        if method == "message/stream":
            return StreamingResponse(_message_stream(params, rpc_id),
                                     media_type="text/event-stream")
        if method == "tasks/get":
            return _ok(rpc_id, await _task_get(params))
        if method == "tasks/cancel":
            return _ok(rpc_id, await _task_cancel(params))
        return _err(rpc_id, -32601, f"Method not found: {method}")
    except Exception as exc:  # noqa: BLE001
        return _err(rpc_id, -32000, str(exc))


# ---------- 业务 ----------
async def _message_send(params: dict) -> dict:
    task_id = params.get("taskId") or str(uuid.uuid4())
    session_id = params.get("sessionId") or task_id
    prompt = params["message"]["content"]
    cwd = params.get("cwd") or "/workspace"

    final_text = await adapter.run_once(
        task_id=task_id, session_id=session_id, prompt=prompt, cwd=cwd
    )
    store.update(task_id, status="completed", output=final_text)
    return {"taskId": task_id, "status": "completed", "result": {"text": final_text}}


async def _message_stream(params: dict, rpc_id: Any) -> AsyncIterator[bytes]:
    task_id = params.get("taskId") or str(uuid.uuid4())
    session_id = params.get("sessionId") or task_id
    prompt = params["message"]["content"]
    cwd = params.get("cwd") or "/workspace"

    store.create(task_id, session_id=session_id)

    async for evt in adapter.run_streaming(
        task_id=task_id, session_id=session_id, prompt=prompt, cwd=cwd
    ):
        # evt is one of: statusUpdate / artifactUpdate / input_required / error
        payload = {"jsonrpc": "2.0", "id": rpc_id, "result": evt}
        yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")

    yield b"data: [DONE]\n\n"


async def _task_get(params: dict) -> dict:
    task_id = params["taskId"]
    return store.get(task_id) or {"taskId": task_id, "status": "unknown"}


async def _task_cancel(params: dict) -> dict:
    task_id = params["taskId"]
    await adapter.cancel(task_id)
    store.update(task_id, status="cancelled")
    return {"taskId": task_id, "status": "cancelled"}


def _ok(rpc_id: Any, result: Any) -> JSONResponse:
    return JSONResponse({"jsonrpc": "2.0", "id": rpc_id, "result": result})


def _err(rpc_id: Any, code: int, msg: str) -> JSONResponse:
    return JSONResponse(
        {"jsonrpc": "2.0", "id": rpc_id, "error": {"code": code, "message": msg}}
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=A2A_PORT, log_level="info")
```

#### `adapters/base.py` 抽象类
```python
# agent_worker/adapters/base.py
from __future__ import annotations

import abc
import asyncio
from typing import AsyncIterator


class CliAdapter(abc.ABC):
    """CLI 适配器基类。"""

    bin_path: str

    @abc.abstractmethod
    def build_argv(self, *, prompt: str, cwd: str, session_id: str) -> list[str]: ...

    async def probe(self) -> bool:
        try:
            proc = await asyncio.create_subprocess_exec(
                self.bin_path, "--version",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            await asyncio.wait_for(proc.wait(), timeout=5)
            return proc.returncode == 0
        except Exception:
            return False

    async def run_once(self, *, task_id: str, session_id: str,
                       prompt: str, cwd: str) -> str:
        chunks: list[str] = []
        async for evt in self.run_streaming(
            task_id=task_id, session_id=session_id, prompt=prompt, cwd=cwd
        ):
            if evt.get("type") == "artifactUpdate":
                chunks.append(evt["artifact"]["text"])
        return "".join(chunks)

    @abc.abstractmethod
    async def run_streaming(
        self, *, task_id: str, session_id: str, prompt: str, cwd: str,
    ) -> AsyncIterator[dict]: ...

    @abc.abstractmethod
    async def cancel(self, task_id: str) -> None: ...
```

#### `adapters/codex.py` 示例
```python
# agent_worker/adapters/codex.py
from __future__ import annotations

import asyncio
import os
from typing import AsyncIterator

from .base import CliAdapter


class CodexAdapter(CliAdapter):
    bin_path = "codex"

    def __init__(self) -> None:
        self._procs: dict[str, asyncio.subprocess.Process] = {}

    def build_argv(self, *, prompt: str, cwd: str, session_id: str) -> list[str]:
        return [
            self.bin_path, "exec",
            "--full-auto",                # 工作流场景必须启用
            "--session", session_id,
            prompt,
        ]

    async def run_streaming(
        self, *, task_id: str, session_id: str, prompt: str, cwd: str,
    ) -> AsyncIterator[dict]:
        argv = self.build_argv(prompt=prompt, cwd=cwd, session_id=session_id)
        env = os.environ.copy()
        proc = await asyncio.create_subprocess_exec(
            *argv, cwd=cwd, env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        self._procs[task_id] = proc

        yield {"type": "statusUpdate", "status": "working", "taskId": task_id}

        try:
            assert proc.stdout is not None
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace")
                yield {"type": "artifactUpdate",
                       "artifact": {"text": text}, "taskId": task_id}
            await proc.wait()
            status = "completed" if proc.returncode == 0 else "failed"
            yield {"type": "statusUpdate", "status": status, "taskId": task_id,
                   "exitCode": proc.returncode}
        finally:
            self._procs.pop(task_id, None)

    async def cancel(self, task_id: str) -> None:
        proc = self._procs.get(task_id)
        if proc and proc.returncode is None:
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), timeout=10)
            except asyncio.TimeoutError:
                proc.kill()
```

### 4.6 Worker Dockerfile 模板

#### `Dockerfile.codex-worker`
```dockerfile
# syntax NOT supported (parser bug w/o auth)
FROM node:22-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv git curl ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

# Codex CLI
RUN npm install -g @openai/codex@latest

# Python deps for A2A Server
COPY agent_worker/requirements.txt /tmp/requirements.txt
RUN python3 -m pip install --no-cache-dir --break-system-packages \
      -r /tmp/requirements.txt

# Worker code
COPY agent_worker /app/agent_worker
WORKDIR /app

ENV AGENT_TYPE=codex \
    A2A_PORT=9000 \
    SESSION_DIR=/root/.codex/sessions \
    CODEX_HOME=/root/.codex

EXPOSE 9000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python3", "-m", "agent_worker.server"]
```

> 与 [Dockerfile.backend](file:///Users/haifeng/Documents/tide/Dockerfile.backend) 类似，Claude / Qoder Worker 仅替换 `npm install` 行与 `AGENT_TYPE`。

#### Worker `requirements.txt`
```
fastapi==0.115.*
uvicorn[standard]==0.32.*
pydantic==2.9.*
httpx==0.27.*
```

---

## 5. K8s 部署清单

### 5.1 Namespace 规划

```yaml
apiVersion: v1
kind: Namespace
metadata: { name: tide-system }
---
apiVersion: v1
kind: Namespace
metadata: { name: tide-agents }
---
apiVersion: v1
kind: Namespace
metadata: { name: tide-infra }
```

| Namespace | 作用 | 资源 |
|-----------|------|------|
| `tide-system` | 控制面 | Backend、Frontend |
| `tide-agents` | Agent Worker | Codex/Claude/Qoder Worker |
| `tide-infra` | 基础设施 | PostgreSQL、Redis、CC Switch、NFS Provisioner |

### 5.2 Backend Deployment & Service

```yaml
# tide-backend.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
  namespace: tide-system
spec:
  replicas: 2
  selector:
    matchLabels: { app: backend }
  template:
    metadata:
      labels: { app: backend }
    spec:
      serviceAccountName: tide-backend
      containers:
        - name: backend
          image: registry.example.com/tide/backend:1.0.0
          ports:
            - { name: http, containerPort: 8000 }
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef: { name: tide-db, key: url }
            - name: REDIS_URL
              value: redis://redis.tide-infra.svc.cluster.local:6379/0
            - name: CC_SWITCH_URL
              value: http://cc-switch.tide-infra.svc.cluster.local:8080
            - name: TIDE_REQUIRE_AUTH
              value: "true"
            - name: A2A_DISCOVERY_INTERVAL_SECONDS
              value: "60"
          envFrom:
            - secretRef: { name: tide-backend-secrets }
          resources:
            requests: { cpu: 250m, memory: 256Mi }
            limits:   { cpu: 500m, memory: 512Mi }
          readinessProbe:
            httpGet: { path: /api/health, port: http }
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet: { path: /api/health, port: http }
            initialDelaySeconds: 30
            periodSeconds: 30
          volumeMounts:
            - { name: projects, mountPath: /app/data/projects }
      volumes:
        - name: projects
          persistentVolumeClaim: { claimName: projects-shared }
---
apiVersion: v1
kind: Service
metadata:
  name: backend
  namespace: tide-system
spec:
  selector: { app: backend }
  ports:
    - { name: http, port: 80, targetPort: 8000 }
```

> **APScheduler leader 选举**：多副本 Backend 时，定时任务（如 `scheduled_check_all`）必须只在一个副本执行。可使用 Redis 分布式锁，或将调度专门拆出 `backend-scheduler` 单副本 Deployment。

### 5.3 Agent Worker Deployments

#### `codex-worker`
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: codex-worker
  namespace: tide-agents
spec:
  replicas: 2
  selector: { matchLabels: { app: codex-worker } }
  template:
    metadata: { labels: { app: codex-worker } }
    spec:
      containers:
        - name: worker
          image: registry.example.com/tide/codex-worker:1.0.0
          ports:
            - { name: a2a, containerPort: 9000 }
          env:
            - { name: AGENT_TYPE, value: codex }
            - { name: AGENT_ID, value: codex-worker }
            - name: OPENAI_API_KEY
              valueFrom: { secretKeyRef: { name: codex-secrets, key: api-key } }
            - name: CC_SWITCH_URL
              value: http://cc-switch.tide-infra.svc.cluster.local:8080
            - name: A2A_TOKEN
              valueFrom: { secretKeyRef: { name: a2a-internal-token, key: token } }
          resources:
            requests: { cpu: 500m, memory: 1Gi }
            limits:   { cpu: 1500m, memory: 2Gi }
          readinessProbe:
            httpGet: { path: /ready, port: a2a }
            initialDelaySeconds: 10
            periodSeconds: 15
          livenessProbe:
            httpGet: { path: /health, port: a2a }
            periodSeconds: 30
          volumeMounts:
            - { name: sessions, mountPath: /root/.codex }
            - { name: projects, mountPath: /workspace }
      volumes:
        - name: sessions
          persistentVolumeClaim: { claimName: codex-sessions }
        - name: projects
          persistentVolumeClaim: { claimName: projects-shared }
---
apiVersion: v1
kind: Service
metadata:
  name: codex-worker
  namespace: tide-agents
spec:
  selector: { app: codex-worker }
  ports:
    - { name: a2a, port: 9000, targetPort: 9000 }
```

> Claude / Qoder Worker 完全镜像该结构，仅替换镜像名、Secret 名和 `AGENT_TYPE`。

#### HPA 配置
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: codex-worker
  namespace: tide-agents
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: codex-worker
  minReplicas: 2
  maxReplicas: 8
  metrics:
    - type: Resource
      resource:
        name: cpu
        target: { type: Utilization, averageUtilization: 70 }
    - type: Pods
      pods:
        metric: { name: a2a_inflight_tasks }
        target: { type: AverageValue, averageValue: "3" }
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
    scaleUp:
      stabilizationWindowSeconds: 30
      policies:
        - { type: Pods, value: 2, periodSeconds: 30 }
```

### 5.4 CC Switch Deployment

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: cc-switch
  namespace: tide-infra
spec:
  serviceName: cc-switch
  replicas: 1
  selector: { matchLabels: { app: cc-switch } }
  template:
    metadata: { labels: { app: cc-switch } }
    spec:
      containers:
        - name: cc-switch
          image: registry.example.com/tide/cc-switch:1.0.0
          ports:
            - { name: http, containerPort: 8080 }
          env:
            - { name: CC_SWITCH_HOST, value: 0.0.0.0 }
          volumeMounts:
            - { name: data, mountPath: /root/.cc-switch }
          resources:
            requests: { cpu: 100m, memory: 128Mi }
            limits:   { cpu: 500m, memory: 512Mi }
  volumeClaimTemplates:
    - metadata: { name: data }
      spec:
        accessModes: [ReadWriteOnce]
        resources: { requests: { storage: 1Gi } }
---
apiVersion: v1
kind: Service
metadata:
  name: cc-switch
  namespace: tide-infra
spec:
  selector: { app: cc-switch }
  ports:
    - { name: http, port: 8080, targetPort: 8080 }
```

> **重要约束**（来自项目记忆）：
> - cc-switch 容器默认监听 `127.0.0.1` 会导致跨容器不可达，**必须设置 `CC_SWITCH_HOST=0.0.0.0`**
> - cc-switch 不能作为 `HTTP_PROXY`，Codex 必须通过 `config.toml` 直连其 API 路由

### 5.5 PostgreSQL StatefulSet

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
  namespace: tide-infra
spec:
  serviceName: postgres
  replicas: 1
  selector: { matchLabels: { app: postgres } }
  template:
    metadata: { labels: { app: postgres } }
    spec:
      containers:
        - name: postgres
          image: postgres:16-alpine
          ports:
            - { name: pg, containerPort: 5432 }
          env:
            - name: POSTGRES_DB
              value: tide
            - name: POSTGRES_USER
              valueFrom: { secretKeyRef: { name: tide-db, key: user } }
            - name: POSTGRES_PASSWORD
              valueFrom: { secretKeyRef: { name: tide-db, key: password } }
            - { name: PGDATA, value: /var/lib/postgresql/data/pgdata }
          volumeMounts:
            - { name: data, mountPath: /var/lib/postgresql/data }
          resources:
            requests: { cpu: 250m, memory: 512Mi }
            limits:   { cpu: 1000m, memory: 1Gi }
          readinessProbe:
            exec: { command: [pg_isready, -U, tide] }
            periodSeconds: 5
  volumeClaimTemplates:
    - metadata: { name: data }
      spec:
        accessModes: [ReadWriteOnce]
        resources: { requests: { storage: 20Gi } }
---
apiVersion: v1
kind: Service
metadata:
  name: postgres
  namespace: tide-infra
spec:
  selector: { app: postgres }
  ports:
    - { name: pg, port: 5432, targetPort: 5432 }
```

> 生产建议使用 **CloudNativePG / Zalando Postgres Operator / RDS** 提供主从高可用与自动备份。

### 5.6 Ingress 配置

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: tide
  namespace: tide-system
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "600"
    nginx.ingress.kubernetes.io/websocket-services: "backend"
spec:
  ingressClassName: nginx
  tls:
    - hosts: [tide.example.com]
      secretName: tide-tls
  rules:
    - host: tide.example.com
      http:
        paths:
          - path: /tide/api
            pathType: Prefix
            backend: { service: { name: backend, port: { name: http } } }
          - path: /tide/ws
            pathType: Prefix
            backend: { service: { name: backend, port: { name: http } } }
          - path: /tide
            pathType: Prefix
            backend: { service: { name: frontend, port: { name: http } } }
```

> 路由前缀 `/tide` 与 [.tide/nginx-storming.conf](file:///Users/haifeng/Documents/tide/.tide/nginx-storming.conf) 保持一致。

### 5.7 Secret & ConfigMap

#### Secret：Agent 凭证
```yaml
apiVersion: v1
kind: Secret
metadata: { name: codex-secrets, namespace: tide-agents }
type: Opaque
stringData:
  api-key: "sk-..."
---
apiVersion: v1
kind: Secret
metadata: { name: claude-secrets, namespace: tide-agents }
type: Opaque
stringData:
  api-key: "sk-ant-..."
---
apiVersion: v1
kind: Secret
metadata: { name: qoder-secrets, namespace: tide-agents }
type: Opaque
stringData:
  pat: "qoder_pat_..."
---
apiVersion: v1
kind: Secret
metadata: { name: a2a-internal-token, namespace: tide-agents }
type: Opaque
stringData:
  token: "<random-256-bit>"
```

#### Secret：数据库
```yaml
apiVersion: v1
kind: Secret
metadata: { name: tide-db, namespace: tide-system }
type: Opaque
stringData:
  user: tide
  password: "<strong-password>"
  url: "postgresql+asyncpg://tide:<pwd>@postgres.tide-infra:5432/tide"
```

#### ConfigMap：Agent Registry 静态配置
```yaml
apiVersion: v1
kind: ConfigMap
metadata: { name: agent-registry, namespace: tide-system }
data:
  registry.json: |
    [
      {
        "id": "codex-worker",
        "name": "Codex Worker",
        "endpoint_url": "http://codex-worker.tide-agents.svc.cluster.local:9000",
        "agent_card_url": "http://codex-worker.tide-agents.svc.cluster.local:9000/.well-known/agent.json",
        "auth_type": "bearer",
        "capabilities": { "streaming": true, "input_required": true }
      },
      {
        "id": "claude-worker",
        "name": "Claude Worker",
        "endpoint_url": "http://claude-worker.tide-agents.svc.cluster.local:9000",
        "agent_card_url": "http://claude-worker.tide-agents.svc.cluster.local:9000/.well-known/agent.json",
        "auth_type": "bearer",
        "capabilities": { "streaming": true, "input_required": true }
      },
      {
        "id": "qoder-worker",
        "name": "Qoder Worker",
        "endpoint_url": "http://qoder-worker.tide-agents.svc.cluster.local:9000",
        "agent_card_url": "http://qoder-worker.tide-agents.svc.cluster.local:9000/.well-known/agent.json",
        "auth_type": "bearer",
        "capabilities": { "streaming": true, "input_required": true }
      }
    ]
```

### 5.8 NetworkPolicy

```yaml
# 默认 deny
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: default-deny, namespace: tide-agents }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
---
# Backend → Workers
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: allow-backend-to-workers, namespace: tide-agents }
spec:
  podSelector: { matchLabels: { tier: agent-worker } }
  policyTypes: [Ingress]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels: { kubernetes.io/metadata.name: tide-system }
          podSelector: { matchLabels: { app: backend } }
      ports:
        - { protocol: TCP, port: 9000 }
---
# Workers → CC Switch
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: allow-workers-to-ccswitch, namespace: tide-agents }
spec:
  podSelector: { matchLabels: { tier: agent-worker } }
  policyTypes: [Egress]
  egress:
    - to:
        - namespaceSelector:
            matchLabels: { kubernetes.io/metadata.name: tide-infra }
          podSelector: { matchLabels: { app: cc-switch } }
      ports:
        - { protocol: TCP, port: 8080 }
---
# Qoder Worker → 外网（Qoder API）
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: allow-qoder-egress-internet, namespace: tide-agents }
spec:
  podSelector: { matchLabels: { app: qoder-worker } }
  policyTypes: [Egress]
  egress:
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
            except: [10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16]
      ports:
        - { protocol: TCP, port: 443 }
```

---

## 6. 服务路由与发现

### 6.1 路由策略

#### 方式一：Kubernetes Service DNS（**推荐内部 Worker**）
```
codex-worker.tide-agents.svc.cluster.local:9000
claude-worker.tide-agents.svc.cluster.local:9000
qoder-worker.tide-agents.svc.cluster.local:9000
```

特点：
- K8s 自动 DNS 解析 + L4 负载均衡（kube-proxy / IPVS）
- 无需额外注册中心
- Pod 重启自动获取新 IP

#### 方式二：`remote_agents` 表动态注册（**外部 Agent**）
- 第三方 Agent 部署后，通过 Tide 管理后台 `POST /api/remote-agents` 注册 `endpoint_url`
- Backend 启动 `A2ADiscovery` 拉取 Agent Card 并健康检查
- Workflow 引用时使用 `agentId="a2a:<remote-agent-id>"`

#### 方式三：Consul/etcd（**跨集群、跨云**）
- 适用于联邦部署或混合云场景
- Worker 启动时向 Consul 注册自己
- Backend 定期同步 Consul → `remote_agents` 表

### 6.2 Agent 注册流程

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│  Worker Pod │      │   Backend   │      │ remote_agents│
└──────┬──────┘      └──────┬──────┘      └──────┬──────┘
       │ 1. 启动              │                    │
       │ 2. 暴露 /.well-known │                    │
       │                     │                    │
       │                     │ 3. 启动加载         │
       │                     │   ConfigMap 静态注册│
       │                     │   或扫描 K8s Services│
       │                     │──────────────────▶│
       │                     │                    │
       │                     │ 4. discover()      │
       │◀────────────────────│                    │
       │ 5. agent.json       │                    │
       │────────────────────▶│                    │
       │                     │ 6. 更新 capabilities│
       │                     │──────────────────▶│
       │                     │                    │
       │                     │ 7. health_check 巡检│
       │◀────────────────────│ (每 60s)           │
       │ 8. /health 200 OK   │                    │
       │────────────────────▶│                    │
       │                     │ 9. 更新 status     │
       │                     │──────────────────▶│
```

### 6.3 负载均衡

#### 6.3.1 同类 Worker 多副本
- K8s Service 默认 **Round Robin**
- 通过 `service.spec.sessionAffinity: ClientIP` 实现源 IP 粘滞（适用于会话重要的场景）

#### 6.3.2 项目亲和性（Session Stickiness）
对于 Codex 等强状态 CLI（session 文件存于 PVC），同一 `session_id` 应路由到同一 Pod。

实现方案：
- **Redis 路由表**：`session_id → pod_name`，Backend 调用前查询
- **一致性哈希**：在 Backend 的 `A2AClient` 中根据 `session_id` 计算目标 Pod 索引

```python
# 示例：一致性哈希路由
import hashlib

def pick_pod(session_id: str, pods: list[str]) -> str:
    h = int(hashlib.sha1(session_id.encode()).hexdigest(), 16)
    return pods[h % len(pods)]
```

> 缺点：Pod 缩容会破坏分布。生产建议改用 Redis 路由表或共享 PVC（NFS）。

---

## 7. 数据持久化方案

### 7.1 PostgreSQL Schema 设计

从 [backend/db/init.sql](file:///Users/haifeng/Documents/tide/backend/db/init.sql) 迁移到 PostgreSQL，主要变更：
- `INTEGER PRIMARY KEY AUTOINCREMENT` → `BIGSERIAL PRIMARY KEY`
- `DATETIME` → `TIMESTAMPTZ`
- `TEXT` → 视场景为 `TEXT` / `VARCHAR(N)` / `JSONB`
- 新增 GIN 索引：`metadata JSONB`, `tags TEXT[]`

#### 关键表迁移示例
```sql
CREATE TABLE projects (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          VARCHAR(255) NOT NULL,
    repo_url      TEXT,
    cwd           TEXT,
    metadata      JSONB DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE remote_agents (
    id                            VARCHAR(64) PRIMARY KEY,
    name                          VARCHAR(255) NOT NULL,
    endpoint_url                  TEXT NOT NULL,
    agent_card_url                TEXT,
    auth_type                     VARCHAR(32) DEFAULT 'none',
    auth_credentials              TEXT,
    capabilities_streaming        BOOLEAN DEFAULT false,
    capabilities_input_required   BOOLEAN DEFAULT false,
    status                        VARCHAR(32) DEFAULT 'unknown',
    approval_required             BOOLEAN DEFAULT false,
    last_check_at                 TIMESTAMPTZ,
    latency_ms                    INTEGER,
    created_at                    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_remote_agents_status ON remote_agents(status);

CREATE TABLE tasks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID REFERENCES projects(id) ON DELETE CASCADE,
    agent_id    VARCHAR(64),
    status      VARCHAR(32) NOT NULL,
    metadata    JSONB DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_status ON tasks(status);
```

> 推荐使用 **Alembic** 管理迁移版本。

### 7.2 Agent 会话持久化

| Agent | 路径 | 卷类型 | 备份 |
|-------|------|--------|------|
| Codex | `/root/.codex/sessions` | PVC RWO（每 Pod 独立） | 每日 PVC Snapshot |
| Claude | `/root/.claude` | PVC RWO（每 Pod 独立） | 每日 PVC Snapshot |
| Qoder | `/root/.qoder` | PVC RWO（每 Pod 独立） | 每日 PVC Snapshot |
| 项目代码 | `/workspace` | NFS/EFS RWX（共享） | 每日全量 + 增量 |

> **Pod 漂移问题**：RWO PVC 在 Node 间漂移困难。可：
> 1. 使用 StatefulSet（强绑定 Pod 标识 + PVC）
> 2. 使用支持迁移的 CSI（Longhorn / Rook-Ceph）
> 3. 改造为 Redis 集中存储 session metadata，CLI 工作目录每次重新拉起

### 7.3 文件系统设计

```
NFS/EFS (ReadWriteMany, 共享):
/app/data/
├── projects/                 # 项目 Worktree（多 Worker 共享）
│   ├── project-1/
│   │   ├── main/             # 主 worktree
│   │   └── worktrees/
│   │       ├── feat-A/
│   │       └── feat-B/
│   └── project-2/
└── attachments/              # 用户上传附件

Worker 本地 PVC (ReadWriteOnce, 独立):
/root/.codex/sessions/
├── session-abc/
│   ├── rollout.jsonl
│   └── transcript.json
└── session-xyz/

/root/.claude/
└── projects/
    └── ...

/root/.qoder/
└── sessions/
```

---

## 8. 安全与凭证管理

### 8.1 K8s Secret 管理

推荐方案二选一：

#### 8.1.1 Sealed Secrets（GitOps 友好）
- Bitnami Sealed Secrets Controller
- 加密后的 `SealedSecret` 安全提交到 Git
- Controller 自动解密为 `Secret`

#### 8.1.2 External Secrets Operator
- 后端：AWS Secrets Manager / GCP Secret Manager / Vault
- `ExternalSecret` CR 自动同步到 K8s Secret
- 支持自动轮换

### 8.2 Agent 间认证

#### 内部 Worker
- **方案 A**：共享 `A2A_TOKEN`（Bearer Token），Backend 与所有 Worker 通过 Secret 注入相同值
- **方案 B**：K8s ServiceAccount Token（短期 + 自动轮换），Worker 验证 Token 的 `iss/aud`
- **方案 C**：mTLS（Istio Sidecar 自动注入 + STRICT 策略）

#### 外部 Agent
- 注册时录入 `auth_type` + `auth_credentials`（见 [a2a_client.py](file:///Users/haifeng/Documents/tide/backend/runtime/a2a_client.py)）
- 凭证在数据库中加密存储（KMS / AES-256）

### 8.3 网络安全

- **NetworkPolicy 最小权限**：见 §5.8
- **mTLS（推荐）**：Istio / Linkerd Sidecar
  ```yaml
  apiVersion: security.istio.io/v1beta1
  kind: PeerAuthentication
  metadata: { name: default, namespace: tide-agents }
  spec:
    mtls: { mode: STRICT }
  ```
- **Egress 控制**：Egress Gateway 限制对外可访问的域名/IP

---

## 9. 监控与可观测性

### 9.1 指标（Prometheus）

#### 9.1.1 Backend 暴露
```python
# backend/main.py
from prometheus_client import Counter, Histogram, make_asgi_app

task_duration = Histogram(
    "task_execution_duration_seconds",
    "Task execution duration",
    ["agent_type", "status"],
    buckets=[1, 5, 10, 30, 60, 180, 600, 1800],
)

a2a_rpc_latency = Histogram(
    "a2a_rpc_latency_seconds",
    "A2A RPC latency",
    ["agent_id", "method"],
)

a2a_rpc_errors = Counter(
    "a2a_rpc_errors_total",
    "A2A RPC errors",
    ["agent_id", "code"],
)

app.mount("/metrics", make_asgi_app())
```

#### 9.1.2 Worker 暴露
```python
# agent_worker/server.py
from prometheus_fastapi_instrumentator import Instrumentator
Instrumentator().instrument(app).expose(app, endpoint="/metrics")

inflight_tasks = Gauge("a2a_inflight_tasks", "In-flight tasks count")
```

#### 9.1.3 ServiceMonitor
```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata: { name: tide-agents, namespace: tide-agents }
spec:
  selector: { matchLabels: { tier: agent-worker } }
  endpoints:
    - port: a2a
      path: /metrics
      interval: 15s
```

### 9.2 日志（Loki / ELK）

- **结构化 JSON**：所有服务统一使用 JSON formatter
- 关键字段：`timestamp`, `level`, `service`, `pod`, `task_id`, `session_id`, `agent_id`, `trace_id`
- **关联性**：通过 `task_id` + `session_id` 串联 Backend 与 Worker 日志
- **采集**：Promtail / Fluent Bit DaemonSet

```python
# 通用日志格式（structlog）
import structlog

structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.contextvars.merge_contextvars,
        structlog.processors.JSONRenderer(),
    ]
)
log = structlog.get_logger()

with structlog.contextvars.bound_contextvars(task_id=task_id, session_id=session_id):
    log.info("a2a.send_message", agent_id=agent_id, prompt_chars=len(prompt))
```

### 9.3 链路追踪（OpenTelemetry → Jaeger/Tempo）

```python
# backend/main.py
from opentelemetry import trace
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

FastAPIInstrumentor.instrument_app(app)
HTTPXClientInstrumentor().instrument()

# A2A 调用时自动注入 traceparent header
```

Trace 链路：Frontend → Backend → A2A Worker → CLI Subprocess → CC Switch → LLM API

### 9.4 告警规则（PrometheusRule）

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata: { name: tide-alerts, namespace: tide-system }
spec:
  groups:
    - name: tide.rules
      rules:
        - alert: AgentWorkerDown
          expr: up{job=~".*-worker"} == 0
          for: 30s
          labels: { severity: critical }
          annotations:
            summary: "Worker {{ $labels.pod }} unreachable"

        - alert: A2ARpcErrorRateHigh
          expr: |
            sum(rate(a2a_rpc_errors_total[5m])) by (agent_id)
              / sum(rate(a2a_rpc_latency_seconds_count[5m])) by (agent_id) > 0.05
          for: 5m
          labels: { severity: warning }

        - alert: TaskExecutionSlow
          expr: histogram_quantile(0.95,
                  sum(rate(task_execution_duration_seconds_bucket[5m])) by (le, agent_type)) > 600
          for: 10m
          labels: { severity: warning }
```

---

## 10. 扩缩容策略

### 10.1 HPA（Horizontal Pod Autoscaler）

#### 基础策略：CPU
- 阈值 `70%`，超出即扩容
- `minReplicas=2`, `maxReplicas=8`

#### 高级策略：自定义指标（KEDA）
```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata: { name: codex-worker, namespace: tide-agents }
spec:
  scaleTargetRef: { name: codex-worker }
  minReplicaCount: 2
  maxReplicaCount: 16
  triggers:
    - type: prometheus
      metadata:
        serverAddress: http://prometheus.monitoring:9090
        metricName: a2a_inflight_tasks
        threshold: "3"
        query: avg(a2a_inflight_tasks{app="codex-worker"})
```

### 10.2 VPA（Vertical Pod Autoscaler）

```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata: { name: codex-worker, namespace: tide-agents }
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: codex-worker
  updatePolicy: { updateMode: "Auto" }
  resourcePolicy:
    containerPolicies:
      - containerName: worker
        minAllowed: { cpu: 250m, memory: 512Mi }
        maxAllowed: { cpu: 4000m, memory: 8Gi }
```

> ⚠️ **VPA 与 HPA 冲突**：使用 KEDA + 自定义指标时关闭 VPA 的 CPU/Memory 模式，仅做内存推荐。

### 10.3 手动扩容场景

- **批量 Workflow 执行**：定时任务前置 `kubectl scale deploy codex-worker --replicas=8`
- **特定 Agent 突发**：通过工单/管理后台一键扩容
- **节假日缩容**：CronJob 修改 `minReplicas`

---

## 11. 第三方 Agent 接入指南

### 11.1 接入流程

1. **实现 A2A Server**：暴露 `POST /` JSON-RPC 接口与 `GET /.well-known/agent.json`
2. **部署服务**：自有 K8s 集群、虚拟机或公有云函数
3. **注册到 Tide**：在管理后台填写 `endpoint_url`, `agent_card_url`, `auth_type`, `auth_credentials`
4. **Tide 自动 discover & health_check**：通过后状态变为 `healthy`
5. **配置 Approval**：是否每次调用前需审批
6. **在工作流中使用**：节点配置 `agentId="a2a:<your-agent-id>"`

### 11.2 Agent Card 规范

```json
{
  "name": "my-custom-agent",
  "displayName": "My Custom Agent",
  "description": "An agent that does X, Y, Z",
  "version": "1.0.0",
  "vendor": "ACME Inc.",
  "endpoint": "https://my-agent.example.com",
  "capabilities": {
    "streaming": true,
    "input_required": true,
    "cancel": true,
    "modalities": ["text", "code"]
  },
  "auth": {
    "type": "bearer",
    "header": "Authorization"
  },
  "limits": {
    "max_prompt_chars": 100000,
    "max_concurrent_tasks": 5,
    "default_timeout_seconds": 300
  }
}
```

### 11.3 最小实现示例（Python FastAPI）

```python
# my_agent/server.py
"""第三方 A2A Agent 最小可运行示例。"""
import json
import uuid
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

app = FastAPI()
TASKS: dict[str, dict] = {}
SECRET = "my-secret-token"


def _auth(token: str | None) -> None:
    if token != f"Bearer {SECRET}":
        raise HTTPException(401, "unauthorized")


@app.get("/.well-known/agent.json")
async def card():
    return {
        "name": "my-custom-agent",
        "version": "1.0.0",
        "endpoint": "https://my-agent.example.com",
        "capabilities": {"streaming": True, "input_required": False, "cancel": True},
        "auth": {"type": "bearer"},
    }


@app.post("/")
async def rpc(req: Request, authorization: str | None = Header(None)):
    _auth(authorization)
    body = await req.json()
    method, params, rpc_id = body["method"], body.get("params") or {}, body.get("id")

    if method == "message/send":
        return _ok(rpc_id, await _send(params))
    if method == "message/stream":
        return StreamingResponse(_stream(params, rpc_id), media_type="text/event-stream")
    if method == "tasks/get":
        return _ok(rpc_id, TASKS.get(params["taskId"], {}))
    if method == "tasks/cancel":
        TASKS[params["taskId"]] = {**TASKS.get(params["taskId"], {}), "status": "cancelled"}
        return _ok(rpc_id, {"taskId": params["taskId"], "status": "cancelled"})
    return _err(rpc_id, -32601, "method not found")


async def _send(params):
    task_id = params.get("taskId") or str(uuid.uuid4())
    prompt = params["message"]["content"]
    result = f"echo: {prompt}"
    TASKS[task_id] = {"taskId": task_id, "status": "completed", "result": result}
    return {"taskId": task_id, "status": "completed", "result": {"text": result}}


async def _stream(params, rpc_id):
    task_id = params.get("taskId") or str(uuid.uuid4())
    prompt = params["message"]["content"]
    TASKS[task_id] = {"taskId": task_id, "status": "working"}
    yield _sse(rpc_id, {"type": "statusUpdate", "status": "working", "taskId": task_id})
    for chunk in [f"echo: ", prompt, "\n"]:
        yield _sse(rpc_id, {"type": "artifactUpdate", "artifact": {"text": chunk},
                            "taskId": task_id})
    TASKS[task_id]["status"] = "completed"
    yield _sse(rpc_id, {"type": "statusUpdate", "status": "completed", "taskId": task_id})
    yield b"data: [DONE]\n\n"


def _sse(rpc_id, payload):
    return f"data: {json.dumps({'jsonrpc':'2.0','id':rpc_id,'result':payload})}\n\n".encode()


def _ok(rpc_id, result):
    return JSONResponse({"jsonrpc": "2.0", "id": rpc_id, "result": result})


def _err(rpc_id, code, msg):
    return JSONResponse({"jsonrpc": "2.0", "id": rpc_id,
                         "error": {"code": code, "message": msg}})
```

启动：`uvicorn my_agent.server:app --host 0.0.0.0 --port 8080`

---

## 12. 迁移路线图

### Phase 1：Agent Worker 容器化（2-3 周）

**目标**：把本地 CLI 包装为 A2A Worker 镜像，本地 docker-compose 验证。

任务清单：
- [ ] 实现通用 `agent_worker` 框架（§4.5）
- [ ] 构建 `codex-worker` / `claude-worker` / `qoder-worker` 镜像
- [ ] 编写过渡 `docker-compose.workers.yml`（Backend + 3 Workers + CC Switch）
- [ ] 在 `remote_agents` 表静态注册 3 个 Worker
- [ ] 端到端测试：手动创建工作流 → A2A Worker → 验证输出
- [ ] 与本地 CLI 模式做兼容性对比测试

**验收标准**：本地 docker-compose 启动后，`agentId="a2a:codex-worker"` 的工作流可正常执行并输出与本地 CLI 一致的结果。

### Phase 2：K8s 部署（2-3 周）

**目标**：迁移到 K8s 测试集群。

任务清单：
- [ ] 编写所有 K8s 清单（§5）
- [ ] 配置 Sealed Secrets / External Secrets
- [ ] 部署 cc-switch、postgres、redis 到 `tide-infra`
- [ ] 部署 backend、frontend 到 `tide-system`
- [ ] 部署 3 个 Worker 到 `tide-agents`
- [ ] Ingress + TLS 配置
- [ ] NetworkPolicy 验证
- [ ] 滚动更新 / 故障恢复演练

**验收标准**：在测试集群完整跑通端到端工作流；杀掉单个 Worker Pod 自动恢复。

### Phase 3：PostgreSQL 迁移（1-2 周）

**目标**：从 SQLite 迁移到 PostgreSQL。

任务清单：
- [ ] Alembic 初始化 + Schema migration 脚本
- [ ] 数据迁移工具（SQLite → PostgreSQL，逐表对账）
- [ ] DB engine 改造：`backend/db/engine.py` 支持 `postgresql+asyncpg://`
- [ ] 连接池、事务隔离级别调优
- [ ] 性能基准测试（写入吞吐 / 查询延迟）
- [ ] 备份策略验证（PITR）

**验收标准**：所有 API 测试通过；导入历史 SQLite 数据后业务连续。

### Phase 4：生产化（2-3 周）

**目标**：监控、告警、压测。

任务清单：
- [ ] Prometheus + Grafana 部署 + Dashboard
- [ ] Loki + Promtail 日志聚合
- [ ] OpenTelemetry + Jaeger 链路追踪
- [ ] HPA / KEDA 配置
- [ ] 压测（k6 / locust）：单工作流 100 并发 + 多工作流混合
- [ ] 告警规则与 Runbook
- [ ] 灾备演练

**验收标准**：SLA 99.9%，p95 任务延迟 < 60s（不含 LLM）。

### Phase 5：多集群与外部 Agent（按需）

**目标**：支持跨集群部署 + 第三方 A2A Agent 接入。

任务清单：
- [ ] Consul / Kubernetes Federation 服务发现
- [ ] Egress Gateway + 限流
- [ ] 第三方 Agent 接入 SDK（Python / TypeScript）
- [ ] 接入文档与示例项目
- [ ] 鉴权网关（OAuth2 / API Gateway）

---

## 13. 风险评估与缓解

| 风险 | 概率 | 影响 | 缓解策略 |
|------|------|------|---------|
| CLI 版本不一致 | 中 | 中 | 镜像版本锁定 (`@1.2.3`)；CI 监听 npm 新版本自动构建并跑回归 |
| Worker → Backend 网络延迟 | 低 | 低 | 同 AZ / 同 Node 亲和性；HTTP/2 长连接复用；连接池 |
| CC Switch 单点故障 | 中 | 高 | 多副本 + 只读 Provider 缓存；本地 fallback 配置；Redis sentinel 队列 |
| Session 文件丢失 | 中 | 中 | PVC + Snapshot；Codex/Claude 失败时自动新建 session 降级 |
| Agent Worker OOM | 中 | 中 | Resource Limits + VPA；OOMKilled 自动重启；超大 prompt 限流 |
| 向下兼容（本地 CLI 用户） | 低 | 高 | Executor 双模式：`agentId` 不带 `a2a:` 前缀仍走本地（按需关闭） |
| PostgreSQL 主节点宕机 | 中 | 高 | CloudNativePG 自动切换 + 异步只读副本；Backup PITR |
| 凭证泄露 | 低 | 极高 | Sealed Secrets / Vault；最小权限 ServiceAccount；定期轮换 |
| 第三方 Agent 恶意行为 | 低 | 中 | NetworkPolicy 隔离；审批流；调用频率限制；输入输出大小校验 |
| K8s 集群升级 | 中 | 中 | PDB（PodDisruptionBudget）保证最少可用副本；Surge 升级；蓝绿环境演练 |

---

## 14. 成本估算

### 14.1 资源需求（基础规模）

| 组件 | CPU Request | Memory Request | 存储 | 副本数 | 备注 |
|------|------|------|------|--------|------|
| Backend | 250m | 256Mi | - | 2 | 主控面 |
| Frontend | 100m | 128Mi | - | 2 | 静态文件 |
| Codex Worker | 500m | 1Gi | 10Gi | 2-8 | HPA |
| Claude Worker | 500m | 1Gi | 10Gi | 2-8 | HPA |
| Qoder Worker | 500m | 1Gi | 10Gi | 1-4 | HPA |
| CC Switch | 100m | 128Mi | 1Gi | 1 | StatefulSet |
| PostgreSQL | 250m | 512Mi | 20Gi | 1 | 主，建议托管服务 |
| Redis | 100m | 128Mi | 1Gi | 1 | 可选 |
| 共享 Project NFS | - | - | 50Gi | - | RWX |
| Prometheus + Grafana | 500m | 1Gi | 50Gi | 1 | 可与现有共用 |
| Loki | 250m | 512Mi | 50Gi | 1 | 可与现有共用 |

**最小集群规模**：3 节点 × (4 vCPU / 8 GiB) ≈ 12 vCPU / 24 GiB

### 14.2 网络流量估算

| 流量类型 | 方向 | 数据量（典型工作流） |
|----------|------|-----------------------|
| Frontend ↔ Backend | 双向 | 1-10 MB/天/用户 |
| Backend ↔ Worker | 双向 | 100 KB - 5 MB/任务 |
| Worker ↔ CC Switch | 双向 | 50 KB - 2 MB/任务 |
| CC Switch ↔ LLM API | 双向（Egress） | 主要成本 |
| Qoder Worker ↔ Qoder API | 双向（Egress） | 主要成本 |

> 内部流量（K8s 内）通常免费；Egress 需重点监控（按字节计费）。

---

## 15. 附录

### A. 完整 K8s YAML 清单

按部署顺序：

1. **基础**
   - `00-namespaces.yaml`（§5.1）
   - `01-storageclass.yaml`（NFS / EFS）
   - `02-network-policies.yaml`（§5.8）

2. **Infra**
   - `10-postgres.yaml`（§5.5）
   - `11-redis.yaml`（可选）
   - `12-cc-switch.yaml`（§5.4）
   - `13-secrets.yaml`（Sealed Secrets，§5.7）

3. **Workers**
   - `20-codex-worker.yaml`（§5.3）
   - `21-claude-worker.yaml`
   - `22-qoder-worker.yaml`
   - `23-hpa.yaml`

4. **Control Plane**
   - `30-backend.yaml`（§5.2）
   - `31-frontend.yaml`
   - `32-ingress.yaml`（§5.6）

5. **Observability**
   - `40-servicemonitor.yaml`
   - `41-prometheusrule.yaml`（§9.4）

### B. Agent Worker Server 代码模板

完整代码见 §4.5。建议作为独立子项目 `tools/agent_worker/` 发布。

### C. docker-compose.yml（过渡阶段）

```yaml
# docker-compose.workers.yml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: tide
      POSTGRES_USER: tide
      POSTGRES_PASSWORD: tide
    ports: ["5432:5432"]
    volumes: [pg_data:/var/lib/postgresql/data]

  cc-switch:
    build: { context: ., dockerfile: Dockerfile.cc-switch }
    environment:
      CC_SWITCH_HOST: 0.0.0.0
    ports: ["8080:8080"]
    volumes: [cc_data:/root/.cc-switch]

  backend:
    build: { context: ., dockerfile: Dockerfile.backend }
    depends_on: [postgres, cc-switch]
    environment:
      DATABASE_URL: postgresql+asyncpg://tide:tide@postgres:5432/tide
      CC_SWITCH_URL: http://cc-switch:8080
    ports: ["8000:8000"]

  codex-worker:
    build: { context: ., dockerfile: Dockerfile.codex-worker }
    environment:
      AGENT_TYPE: codex
      AGENT_ID: codex-worker
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      CC_SWITCH_URL: http://cc-switch:8080
    ports: ["9001:9000"]
    volumes: [codex_sessions:/root/.codex, ./projects:/workspace]

  claude-worker:
    build: { context: ., dockerfile: Dockerfile.claude-worker }
    environment:
      AGENT_TYPE: claude
      AGENT_ID: claude-worker
      ANTHROPIC_BASE_URL: http://cc-switch:8080/anthropic
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
    ports: ["9002:9000"]
    volumes: [claude_sessions:/root/.claude, ./projects:/workspace]

  qoder-worker:
    build: { context: ., dockerfile: Dockerfile.qoder-worker }
    environment:
      AGENT_TYPE: qoder
      AGENT_ID: qoder-worker
      QODER_PERSONAL_ACCESS_TOKEN: ${QODER_PAT}
    ports: ["9003:9000"]
    volumes: [qoder_sessions:/root/.qoder, ./projects:/workspace]

  frontend:
    build: { context: ., dockerfile: Dockerfile.frontend }
    depends_on: [backend]
    ports: ["3000:3000"]

volumes:
  pg_data:
  cc_data:
  codex_sessions:
  claude_sessions:
  qoder_sessions:
```

### D. Helm Chart 结构（推荐）

```
charts/tide/
├── Chart.yaml
├── values.yaml                # 默认值
├── values.production.yaml     # 生产覆盖
├── templates/
│   ├── _helpers.tpl
│   ├── namespaces.yaml
│   ├── secrets.yaml
│   ├── configmap-agent-registry.yaml
│   ├── postgres-statefulset.yaml
│   ├── cc-switch-statefulset.yaml
│   ├── backend-deployment.yaml
│   ├── backend-service.yaml
│   ├── frontend-deployment.yaml
│   ├── ingress.yaml
│   ├── workers/
│   │   ├── codex-deployment.yaml
│   │   ├── codex-service.yaml
│   │   ├── codex-hpa.yaml
│   │   ├── claude-*.yaml
│   │   └── qoder-*.yaml
│   ├── networkpolicies.yaml
│   └── monitoring/
│       ├── servicemonitor.yaml
│       └── prometheusrule.yaml
└── README.md
```

`values.yaml` 关键参数：
```yaml
global:
  domain: tide.example.com
  imageRegistry: registry.example.com
  imageTag: "1.0.0"

backend:
  replicas: 2
  resources:
    requests: { cpu: 250m, memory: 256Mi }
    limits:   { cpu: 500m, memory: 512Mi }

workers:
  codex:
    enabled: true
    replicas: 2
    hpa: { minReplicas: 2, maxReplicas: 8, cpuTarget: 70 }
  claude:
    enabled: true
    replicas: 2
    hpa: { minReplicas: 2, maxReplicas: 8, cpuTarget: 70 }
  qoder:
    enabled: true
    replicas: 1
    hpa: { minReplicas: 1, maxReplicas: 4, cpuTarget: 70 }

postgres:
  enabled: true     # false 时使用外部 RDS
  storage: 20Gi

ccSwitch:
  enabled: true
  storage: 1Gi

ingress:
  className: nginx
  tls: { enabled: true, secretName: tide-tls }

monitoring:
  serviceMonitor: { enabled: true }
  prometheusRule: { enabled: true }
```

部署：
```bash
helm upgrade --install tide charts/tide \
  -f values.production.yaml \
  --set global.imageTag=1.2.0 \
  --namespace tide-system --create-namespace
```

---

## 结语

本方案以 Tide 已有 A2A 基础设施为起点，通过 **Worker 化 + K8s 编排 + PostgreSQL** 三步实现从单体到分布式的演进。改造路径可控，每个 Phase 都能独立验收并保留向下兼容能力（双模式 Executor）。

完成本方案后，Tide 将具备：
- **可水平扩展**的 Agent 执行能力
- **可独立升级** 的 Agent 镜像版本
- **可动态接入**的第三方 A2A Agent 生态
- **可观测**的端到端任务链路
- **可演进**的多集群、多租户能力基础

下一步建议从 **Phase 1（Worker 容器化）** 开始，在本地 docker-compose 环境完成 PoC 后再推进 K8s 部署。
