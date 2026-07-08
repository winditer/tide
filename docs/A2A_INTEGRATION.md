# A2A 三方 Agent 集成方案（设计文档）

> 状态：**已实施**

## 1. 背景与目标

### 现状
当前 Tide 系统的 Agent 执行层完全基于**本地 CLI 子进程**（Codex/Claude/Qoder），通过 `AgentAdapter` 适配器模式统一接口。Agent 必须部署在同一服务器上，通过 `asyncio.create_subprocess_exec` 启动 CLI 进程，stdout 流式读取 JSON 事件。

### 目标
引入 **Google A2A（Agent-to-Agent）协议** 支持远程三方 Agent：
- 在**工作流 DAG** 中作为节点执行（接收上游输出，产出给下游）
- 作为**独立任务**直接调用（通过 API 或聊天窗口）
- 保留**审批机制**（类似 Codex 的 approval 流程）

### 为何选择 A2A
| 特性 | A2A | MCP | 自定义 HTTP |
|------|-----|-----|------------|
| 定位 | Agent-to-Agent 协作 | 工具/上下文扩展 | 自由定义 |
| 能力发现 | Agent Card 标准化 | 无 | 需自行实现 |
| 任务生命周期 | 完整状态机 | 无 | 需自行实现 |
| 流式输出 | SSE 原生支持 | 支持 | 需自行实现 |
| 异步长任务 | 原生支持 | 不适合 | 需自行实现 |
| 生态 | Linux Foundation + Google 主导，Python/JS/Go SDK | Anthropic 主导 | 无 |

---

## 2. 架构设计

### 2.1 整体架构（扩展后）

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户交互层                                │
│  Web UI │ FloatingChat │ FastAPI Routes │ WebSocket              │
└────────────┬────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     工作流和任务管理层                             │
│  WorkflowEngine │ ScheduleService │ TaskService                 │
└────────────┬────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Agent 执行层（扩展后）                        │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  AgentExecutor.run_task()                                  │ │
│  │  - 路由策略: agent_id 前缀判断                               │ │
│  │    - codex/claude/qoder → 本地 CLI 子进程（现有逻辑不变）    │ │
│  │    - a2a:xxx → A2AAdapter → HTTP/SSE 远程调用              │ │
│  └────────────────────────────────────────────────────────────┘ │
│     ┌─────────┐ ┌────────┐ ┌────────┐ ┌──────────────────────┐ │
│     │ Codex   │ │ Claude │ │ Qoder  │ │ A2AAdapter           │ │
│     │ Adapter │ │ Adapter│ │ Adapter│ │ (HTTP/JSON-RPC/SSE)  │ │
│     └────┬────┘ └───┬────┘ └───┬────┘ └──────────┬───────────┘ │
└──────────┼───────────┼──────────┼─────────────────┼─────────────┘
           │           │          │                 │
           ▼           ▼          ▼                 ▼
    ┌──────────────────────────┐         ┌────────────────────────┐
    │    本地 CLI 二进制工具     │         │   远程 A2A Server(s)    │
    │  codex │ claude │ qoder  │         │  (任意框架/语言/服务器)  │
    └──────────────────────────┘         └────────────────────────┘
```

### 2.2 A2A 协议核心概念映射

| A2A 概念 | Tide 系统对应 | 说明 |
|----------|-------------|------|
| Agent Card | `remote_agents.agent_card_json` | Agent 能力自描述清单 |
| Task | `tasks` 表记录 | 一次任务执行的完整生命周期 |
| Message | prompt + context | Client→Server 的请求消息 |
| Artifact | task.result | Agent 产出的结果内容 |
| TaskState | task.status | 映射：WORKING→running, COMPLETED→completed, FAILED→failed |
| INPUT_REQUIRED | approval_request 事件 | 触发审批/人工输入流程 |
| contextId | conversation_id | 多轮对话的上下文关联 |
| Skill | Agent 的具体能力标签 | 辅助用户选择合适的 Agent |

### 2.3 通信协议细节

```
Tide (A2A Client)                    Remote Agent (A2A Server)
      │                                       │
      │  1. GET /.well-known/agent.json       │
      │──────────────────────────────────────►│
      │◄──────────────────────────────────────│
      │     AgentCard (capabilities, skills)   │
      │                                       │
      │  2. POST /a2a (JSON-RPC: message/send) │
      │     {message, configuration}           │
      │──────────────────────────────────────►│
      │                                       │
      │  3a. 同步返回 Task                     │
      │◄──────────────────────────────────────│
      │                                       │
      │  3b. 或 SSE 流式返回事件               │
      │◄── Task ─── StatusUpdate ─── Artifact │
      │                                       │
      │  4. 若 INPUT_REQUIRED（审批）          │
      │     POST /a2a (message/send + taskId)  │
      │──────────────────────────────────────►│
      │                                       │
      │  5. GET /a2a (tasks/get) 轮询状态      │
      │──────────────────────────────────────►│
      │◄──────────────────────────────────────│
```

---

## 3. 数据模型设计

### 3.1 新增表：`remote_agents`

```sql
CREATE TABLE IF NOT EXISTS remote_agents (
    id TEXT PRIMARY KEY,                       -- 内部 ID，格式 "a2a:{slug}"
    name TEXT NOT NULL,                        -- 显示名称
    description TEXT,                          -- Agent 描述
    agent_card_url TEXT NOT NULL,              -- Agent Card 发现 URL
    agent_card_json TEXT,                      -- 缓存的完整 Agent Card JSON
    endpoint_url TEXT NOT NULL,                -- A2A JSON-RPC 端点 URL
    protocol_binding TEXT DEFAULT 'JSONRPC',   -- JSONRPC / HTTP+JSON / GRPC
    protocol_version TEXT DEFAULT '1.0',       -- A2A 协议版本
    
    -- 认证配置
    auth_type TEXT DEFAULT 'bearer',           -- bearer / api_key / oauth2 / none
    auth_credentials TEXT,                     -- 加密存储的凭据（Token/Key）
    auth_header_name TEXT,                     -- 自定义 Header 名（api_key 模式）
    
    -- 能力声明（从 Agent Card 解析）
    capabilities_streaming BOOLEAN DEFAULT FALSE,
    capabilities_push_notifications BOOLEAN DEFAULT FALSE,
    skills_json TEXT,                          -- JSON: AgentSkill[] 列表
    
    -- 运行策略
    approval_required BOOLEAN DEFAULT TRUE,    -- 是否启用审批
    approval_policy TEXT DEFAULT 'on-request', -- always / on-request / never
    timeout_ms INTEGER DEFAULT 300000,         -- 单次调用超时（默认 5 分钟）
    max_retries INTEGER DEFAULT 2,             -- 失败重试次数
    
    -- 状态
    status TEXT DEFAULT 'active',              -- active / inactive / unreachable
    last_health_check TIMESTAMP,
    last_error TEXT,
    
    -- 元数据
    workspace_id TEXT,                         -- 所属工作区（NULL = 全局）
    created_by TEXT,                           -- 创建者
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 3.2 新增表：`a2a_task_mapping`

远程 A2A Task ID 与本地 Task ID 的映射：

```sql
CREATE TABLE IF NOT EXISTS a2a_task_mapping (
    local_task_id TEXT PRIMARY KEY,            -- Tide tasks.id
    remote_task_id TEXT NOT NULL,              -- A2A Server 返回的 Task ID
    remote_context_id TEXT,                    -- A2A contextId（多轮对话）
    agent_id TEXT NOT NULL,                    -- remote_agents.id
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 3.3 actors 表扩展

```sql
-- 远程 Agent 注册时动态插入
INSERT INTO actors (id, type, name, metadata) VALUES
    ('a2a:my-agent', 'remote_agent', 'My Remote Agent', 
     '{"endpoint": "https://...", "protocol": "a2a"}');
```

---

## 4. 核心模块设计

### 4.1 A2A Client 模块

**文件**: `backend/runtime/a2a_client.py`

```python
import httpx
from dataclasses import dataclass
from typing import AsyncGenerator, Optional

@dataclass
class A2AAgentConfig:
    """远程 Agent 连接配置"""
    agent_id: str
    endpoint_url: str
    auth_type: str            # bearer / api_key / oauth2 / none
    auth_credentials: str
    auth_header_name: str     # 自定义 header（api_key 模式）
    capabilities: dict        # {streaming: bool, pushNotifications: bool}
    timeout_ms: int
    max_retries: int
    approval_required: bool
    approval_policy: str

@dataclass  
class A2ATask:
    """A2A 远程任务状态"""
    id: str
    context_id: Optional[str]
    state: str                # submitted/working/completed/failed/canceled/input_required
    artifacts: list           # [{artifactId, parts: [{text/data/url}]}]
    history: list             # Message 历史
    metadata: dict

class A2AClient:
    """A2A 协议客户端 - JSON-RPC over HTTP(S)"""
    
    def __init__(self, config: A2AAgentConfig):
        self.config = config
        self._client = httpx.AsyncClient(
            timeout=config.timeout_ms / 1000,
            headers=self._build_auth_headers()
        )
    
    def _build_auth_headers(self) -> dict:
        headers = {"Content-Type": "application/json", "A2A-Version": "1.0"}
        if self.config.auth_type == "bearer":
            headers["Authorization"] = f"Bearer {self.config.auth_credentials}"
        elif self.config.auth_type == "api_key":
            headers[self.config.auth_header_name] = self.config.auth_credentials
        return headers
    
    async def send_message(
        self, prompt: str, 
        task_id: Optional[str] = None,
        context_id: Optional[str] = None,
        context_parts: list = None,
        metadata: dict = None
    ) -> A2ATask:
        """发送消息（同步模式）- JSON-RPC: message/send"""
        payload = {
            "jsonrpc": "2.0",
            "id": str(uuid4()),
            "method": "message/send",
            "params": {
                "message": {
                    "messageId": str(uuid4()),
                    "role": "user",
                    "parts": [{"text": prompt}] + (context_parts or []),
                    **({"taskId": task_id} if task_id else {}),
                    **({"contextId": context_id} if context_id else {}),
                },
                "configuration": {
                    "acceptedOutputModes": ["text/plain", "application/json"],
                },
                **({"metadata": metadata} if metadata else {}),
            }
        }
        resp = await self._client.post(self.config.endpoint_url, json=payload)
        return self._parse_task_response(resp.json())
    
    async def send_streaming_message(
        self, prompt: str, **kwargs
    ) -> AsyncGenerator:
        """流式发送消息（SSE）- message/stream"""
        payload = self._build_message_payload(prompt, **kwargs)
        payload["method"] = "message/stream"
        
        async with self._client.stream(
            "POST", self.config.endpoint_url, json=payload
        ) as response:
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    event = json.loads(line[6:])
                    yield self._parse_stream_event(event)
    
    async def get_task(self, task_id: str) -> A2ATask:
        """获取任务状态 - JSON-RPC: tasks/get"""
        payload = {
            "jsonrpc": "2.0", "id": str(uuid4()),
            "method": "tasks/get",
            "params": {"id": task_id}
        }
        resp = await self._client.post(self.config.endpoint_url, json=payload)
        return self._parse_task_response(resp.json())
    
    async def cancel_task(self, task_id: str) -> A2ATask:
        """取消任务 - JSON-RPC: tasks/cancel"""
        payload = {
            "jsonrpc": "2.0", "id": str(uuid4()),
            "method": "tasks/cancel",
            "params": {"id": task_id}
        }
        resp = await self._client.post(self.config.endpoint_url, json=payload)
        return self._parse_task_response(resp.json())
    
    async def discover(self, agent_card_url: str) -> dict:
        """发现 Agent Card - GET /.well-known/agent.json"""
        resp = await self._client.get(agent_card_url)
        return resp.json()
```

### 4.2 A2A Adapter（适配器层）

**文件**: `backend/runtime/adapters.py`（追加）

```python
class A2AAdapter(AgentAdapter):
    """远程 A2A Agent 适配器 - 将 A2A 协议映射为 Tide 内部事件流"""
    
    async def execute(
        self, runtime: CodexTaskRuntime, config: A2AAgentConfig
    ) -> AsyncGenerator:
        """通过 HTTP 执行远程 Agent，产出内部事件流"""
        client = A2AClient(config)
        
        # 构建上下文（来自工作流上游或对话历史）
        context_parts = self._build_context_parts(runtime)
        
        if config.capabilities.get("streaming"):
            # 优先流式调用
            async for event in client.send_streaming_message(
                prompt=runtime.prompt,
                task_id=runtime.remote_task_id,  # 续接已有任务
                context_id=runtime.conversation_id,
                context_parts=context_parts,
            ):
                yield self._map_to_internal_event(event)
        else:
            # 降级为同步调用 + 轮询
            task = await client.send_message(
                prompt=runtime.prompt,
                context_parts=context_parts,
            )
            yield self._map_task_to_event(task, "submitted")
            
            # 轮询直到终态
            while task.state in ("submitted", "working", "input_required"):
                await asyncio.sleep(2)
                task = await client.get_task(task.id)
                yield self._map_task_to_event(task, task.state)
    
    def _map_to_internal_event(self, a2a_event) -> dict:
        """A2A 事件 → Tide 内部事件格式映射"""
        event_type = a2a_event.get("type")
        
        if event_type == "task":
            return {"type": "status_changed", "status": a2a_event["state"]}
        
        elif event_type == "statusUpdate":
            state = a2a_event["status"]["state"]
            message = a2a_event["status"].get("message", {})
            
            if state == "input_required":
                return {
                    "type": "approval_request",
                    "message": self._extract_text(message),
                }
            elif state == "completed":
                return {"type": "completed", "result": ""}
            elif state == "failed":
                return {"type": "failed", "error": self._extract_text(message)}
            else:
                return {"type": "status_changed", "status": state}
        
        elif event_type == "artifactUpdate":
            artifact = a2a_event["artifact"]
            text = self._extract_artifact_text(artifact)
            return {
                "type": "output_chunk",
                "content": text,
                "artifact_id": artifact.get("artifactId"),
                "is_final": a2a_event.get("lastChunk", False),
            }
        
        return {"type": "unknown", "raw": a2a_event}
    
    def _build_context_parts(self, runtime) -> list:
        """构建传递给远程 Agent 的上下文 Parts"""
        parts = []
        # 工作流上游输出
        if runtime.prev_output:
            parts.append({
                "data": {"workflow_context": runtime.prev_output},
                "mediaType": "application/json"
            })
        # CWD / 项目信息
        if runtime.cwd:
            parts.append({
                "text": f"Working directory: {runtime.cwd}",
                "mediaType": "text/plain"
            })
        return parts
```

### 4.3 执行路由扩展

**文件**: `backend/runtime/executor.py`（修改 `run_task` 方法）

```python
# 在现有 run_task 方法开头增加路由判断
async def run_task(self, runtime: CodexTaskRuntime, ...):
    agent_id = runtime.agent_id
    
    if agent_id.startswith("a2a:"):
        # ===== 远程 A2A Agent 路由 =====
        config = await self._load_remote_agent_config(agent_id)
        if not config:
            yield {"type": "failed", "error": f"Remote agent {agent_id} not found"}
            return
        
        adapter = A2AAdapter()
        async for event in adapter.execute(runtime, config):
            if event["type"] == "approval_request" and config.approval_required:
                # 触发审批流程
                yield {
                    "type": "approval_request",
                    "message": event.get("message", "Remote agent requires approval"),
                    "agent_id": agent_id,
                }
                # 暂停等待审批回调（通过 task 状态更新触发）
                approved = await self._wait_for_approval(runtime.task_id)
                if approved:
                    # 向远程 Agent 发送 "approved" 消息继续执行
                    client = A2AClient(config)
                    await client.send_message(
                        "Approved. Please continue.",
                        task_id=runtime.remote_task_id
                    )
                else:
                    client = A2AClient(config)
                    await client.cancel_task(runtime.remote_task_id)
                    yield {"type": "failed", "error": "Approval denied by user"}
                    return
            else:
                yield event
    else:
        # ===== 现有本地 Agent 逻辑（完全不变）=====
        adapter = AGENT_ADAPTERS.get(agent_id)
        ...  # 原有代码
```

---

## 5. 审批机制设计

### 5.1 审批流程

```
远程 Agent                   Tide Backend                    用户
    │                            │                            │
    │  state: INPUT_REQUIRED     │                            │
    │  message: "需要执行 xxx"    │                            │
    │───────────────────────────►│                            │
    │                            │  WebSocket 推送审批请求      │
    │                            │───────────────────────────►│
    │                            │                            │
    │                            │  用户点击 "批准" / "拒绝"   │
    │                            │◄───────────────────────────│
    │                            │                            │
    │  message/send: "Approved"  │                            │
    │◄───────────────────────────│                            │
    │                            │                            │
    │  state: WORKING → COMPLETED│                            │
    │───────────────────────────►│  推送执行结果               │
    │                            │───────────────────────────►│
```

### 5.2 审批策略

| 策略 | 行为 |
|------|------|
| `always` | 远程 Agent 的每次执行都需要人工确认后才发送 |
| `on-request` | 仅当远程 Agent 返回 `INPUT_REQUIRED` 时触发审批 |
| `never` | 全自动执行，不做任何拦截 |

### 5.3 与现有审批系统的复用

当前 Codex Agent 已有 approval 机制（检测 "permission required" / "blocked by policy"）。A2A 审批通过相同的事件管道（`approval_request` event type）接入，前端复用同一个审批 UI 组件。

---

## 6. 工作流引擎集成

### 6.1 Agent 节点配置扩展

工作流 Agent 节点的 `data` 字段新增支持：

```typescript
interface AgentNodeData {
  label: string;
  agent_id: string;         // "codex" | "claude" | "qoder" | "a2a:xxx"
  model?: string;           // 本地 Agent 专用，远程 Agent 忽略
  prompt?: string;          // Prompt 模板
  cwd?: string;             // 工作目录（本地 Agent 专用）
  
  // 以下为 A2A 扩展字段
  a2a_skill_id?: string;    // 指定使用远程 Agent 的某个 Skill
  a2a_output_mode?: string; // 期望的输出格式: text/plain, application/json
  a2a_timeout_ms?: number;  // 覆盖默认超时
}
```

### 6.2 上下文传递

工作流节点间的上下文传递通过 A2A Message Parts 实现：

```python
# 工作流引擎构建 A2A 消息
message_parts = [
    {"text": rendered_prompt},                          # 主 prompt
    {"data": prev_node_output, "mediaType": "application/json"},  # 上游输出
    {"data": workflow_variables, "mediaType": "application/json"}, # 工作流变量
]
```

远程 Agent 返回的 Artifacts 提取为节点输出，传递给下游节点：

```python
# 完成后提取结果
artifacts = completed_task.artifacts
node_output = ""
for artifact in artifacts:
    for part in artifact["parts"]:
        if "text" in part:
            node_output += part["text"]
        elif "data" in part:
            node_output = json.dumps(part["data"])
```

---

## 7. 管理 API 设计

### 7.1 路由清单

**文件**: `backend/api/remote_agents.py`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/remote-agents` | 注册远程 Agent |
| GET | `/api/remote-agents` | 列出所有远程 Agent |
| GET | `/api/remote-agents/{id}` | 获取详情 |
| PUT | `/api/remote-agents/{id}` | 更新配置 |
| DELETE | `/api/remote-agents/{id}` | 删除 |
| POST | `/api/remote-agents/discover` | 通过 URL 发现 Agent Card |
| POST | `/api/remote-agents/{id}/test` | 测试连通性 |
| POST | `/api/remote-agents/{id}/refresh` | 刷新 Agent Card 缓存 |

### 7.2 注册流程

```
用户输入 Agent Card URL
       │
       ▼
GET https://agent.example.com/.well-known/agent.json
       │
       ▼
解析 Agent Card → 提取 name, description, skills, 
                   capabilities, endpoint, securitySchemes
       │
       ▼
用户补充: 认证凭据 + 审批策略 + 超时配置
       │
       ▼
存入 remote_agents 表 → 插入 actors 表
       │
       ▼
发送测试消息验证连通性
```

### 7.3 Agent 选择器 API

扩展现有的 `/api/agents` 接口，返回本地 + 远程 Agent 列表：

```python
GET /api/agents
Response:
{
  "agents": [
    {"id": "codex", "type": "local", "name": "Codex", "status": "available"},
    {"id": "claude", "type": "local", "name": "Claude", "status": "available"},
    {"id": "qoder", "type": "local", "name": "Qoder", "status": "available"},
    {"id": "a2a:recipe-agent", "type": "remote", "name": "Recipe Agent", 
     "status": "active", "skills": [...], "capabilities": {...}},
  ]
}
```

---

## 8. 前端 UI 变更

### 8.1 工作流编辑器 - Agent 选择器

在 `PropertyPanel.tsx` 的 Agent 下拉框中：
- 分组显示：**本地 Agent** / **远程 Agent**
- 远程 Agent 显示状态标识（绿色/红色圆点）
- 选择远程 Agent 后展示其 Skills 列表，辅助编写 prompt
- 隐藏不适用于远程 Agent 的字段（model、cwd）

### 8.2 设置页 - 远程 Agent 管理

**路径**: Settings → Remote Agents（新增 Tab）

功能：
- Agent 列表（表格：名称、端点、状态、技能数、最后检查时间）
- 添加 Agent（输入 Agent Card URL → 自动填充）
- 编辑（修改凭据、审批策略、超时）
- 测试连通性（实时反馈）
- 删除（确认弹窗）

### 8.3 任务详情 - 远程 Agent 标识

任务列表和详情页中，远程 Agent 执行的任务显示：
- Agent 名称 + "远程" 标签
- 审批记录（若有）
- 远程 Task ID（调试用）

---

## 9. 健康检查与容错

### 9.1 健康检查机制

```python
class A2ADiscoveryService:
    async def health_check(self, agent_id: str) -> HealthStatus:
        """
        检查方式：
        1. GET Agent Card URL → 验证可达性
        2. 可选: 发送空 message 检测端点是否响应
        """
    
    async def scheduled_check_all(self):
        """每 5 分钟检查一次所有活跃的远程 Agent"""
        for agent in get_active_remote_agents():
            status = await self.health_check(agent.id)
            if status.is_unreachable:
                update_agent_status(agent.id, "unreachable")
                # 连续 3 次不可达 → 标记 inactive
```

### 9.2 容错策略

| 场景 | 处理方式 |
|------|---------|
| 网络超时 | 按 max_retries 重试，指数退避 |
| 认证失败（401/403） | 标记 agent 状态异常，通知用户更新凭据 |
| Agent 返回 REJECTED | 任务标记 failed，记录拒绝原因 |
| SSE 连接断开 | 降级为轮询模式继续获取状态 |
| Agent 长时间 WORKING | 超过 timeout_ms 后标记超时，用户可选取消 |

---

## 10. 安全考虑

1. **凭据存储**: `auth_credentials` 字段加密存储（AES-256 或使用环境变量引用）
2. **网络隔离**: 远程 Agent 调用走独立的 HTTP Client，不复用内部服务连接
3. **请求验证**: 所有 A2A 响应验证 JSON-RPC 格式合规性
4. **权限控制**: 远程 Agent 管理操作仅 admin 角色可执行
5. **审计日志**: 所有远程 Agent 调用记录完整的请求/响应日志

---

## 11. 文件变更清单

| 操作 | 文件路径 | 说明 |
|------|---------|------|
| 新增 | `backend/runtime/a2a_client.py` | A2A 协议客户端实现 |
| 新增 | `backend/api/remote_agents.py` | 远程 Agent 管理 API |
| 新增 | `backend/services/a2a_discovery.py` | Agent 发现与健康检查 |
| 修改 | `backend/runtime/adapters.py` | 新增 A2AAdapter 类 |
| 修改 | `backend/runtime/executor.py` | 增加 a2a: 前缀路由 |
| 修改 | `backend/runtime/task_runtime.py` | 扩展 runtime 数据模型 |
| 修改 | `backend/services/workflow_engine.py` | Agent 节点支持远程调用 |
| 修改 | `backend/services/approval_service.py` | 审批流程适配 |
| 修改 | `backend/api/agents.py` | 返回远程 Agent 列表 |
| 修改 | `backend/db/init.sql` | 新增表 |
| 修改 | `backend/main.py` | 注册新路由 |
| 修改 | `packages/views/src/workflows/PropertyPanel.tsx` | Agent 选择器 |
| 新增 | 前端远程 Agent 管理页组件 | Settings Tab |

---

## 12. 依赖与兼容性

### 新增依赖
- `httpx` >= 0.25（异步 HTTP 客户端，已在 requirements.txt 中）
- `a2a-sdk`（可选，用于协议数据类型验证）: `pip install a2a-sdk`

### 向后兼容
- 现有本地 Agent（codex/claude/qoder）的调用路径**完全不变**
- 数据库仅做增量操作（新增表），不修改现有表结构
- 前端 Agent 选择器保持现有选项，仅追加远程 Agent 组
- API 接口新增路由，不修改现有接口签名

---

## 13. 开发优先级建议

| 阶段 | 内容 | 预估工作量 |
|------|------|-----------|
| P0 | DB Schema + A2A Client + Adapter + Executor 路由 | 2-3 天 |
| P1 | 管理 API + Agent 发现 + 健康检查 | 1-2 天 |
| P2 | 工作流引擎集成 + 审批机制 | 2 天 |
| P3 | 前端 UI（管理页 + 选择器扩展） | 2 天 |
| P4 | 测试 + 文档 + 示例 A2A Server | 1-2 天 |

---

## 14. A2A Bridge Service — 远程 CLI 桥接

### 14.1 概述

对于已经在远程服务器部署了 CLI Agent（codex/claude/qoder）的场景，需要在远程服务器上部署 A2A Bridge Service，将 CLI 工具包装为标准 A2A Server。

架构：
```
Tide Backend  ──HTTP/A2A──►  A2A Bridge (远程服务器)  ──subprocess──►  CLI Agent
```

Bridge 源码位于项目 `a2a-bridge/` 目录。

### 14.2 部署方式

**方式一：一键安装脚本（推荐）**

自动检测并安装 Git / Python 3.11+ / Node.js 20+ 与各 CLI，安装 `a2a-bridge` 命令并生成 `~/.a2a-bridge/.env`，可选注册 systemd/launchd/计划任务：
```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/multica-ai/tide/main/a2a-bridge/scripts/install.sh | bash
# Windows（PowerShell）
irm https://raw.githubusercontent.com/multica-ai/tide/main/a2a-bridge/scripts/install.ps1 | iex

a2a-bridge setup      # 交互式配置 + CLI 探测
a2a-bridge start -d   # 后台守护启动
a2a-bridge status     # 查看运行状态
```

**方式二：pip 安装**
```bash
cd a2a-bridge
pip install -e .        # 或发布后：pip install tide-a2a-bridge
a2a-bridge setup && a2a-bridge start
```

**方式三：直接运行**
```bash
cd a2a-bridge
pip install -r requirements.txt
# 配置环境变量（参考 .env.example）
export BRIDGE_API_KEY="your-secret-key"
export BRIDGE_WORK_DIR="/home/deploy/workspace"
uvicorn main:app --host 0.0.0.0 --port 8720
```

**方式四：Docker 部署**
```bash
cd a2a-bridge
docker build -t tide-a2a-bridge .
docker run -d \
  --name a2a-bridge \
  -p 8720:8720 \
  -e BRIDGE_API_KEY="your-secret-key" \
  -e BRIDGE_WORK_DIR="/workspace" \
  -v /home/deploy/workspace:/workspace \
  tide-a2a-bridge
```

### 14.3 配置说明

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `BRIDGE_HOST` | `0.0.0.0` | 监听地址 |
| `BRIDGE_PORT` | `8720` | 监听端口 |
| `BRIDGE_API_KEY` | (空) | API Key 认证密钥，空则不校验 |
| `BRIDGE_WORK_DIR` | `/tmp/a2a-work` | CLI 默认工作目录 |
| `BRIDGE_MAX_CONCURRENT` | `5` | 最大并发任务数 |
| `CODEX_BIN` | `codex` | Codex CLI 路径 |
| `CLAUDE_BIN` | `claude` | Claude CLI 路径 |
| `QODER_BIN` | `qoder` | Qoder CLI 路径 |

### 14.4 在 Tide 中注册远程 Agent

1. 打开 Tide 设置页面 → Remote Agents
2. 点击"注册新 Agent"
3. 输入 Agent Card URL：`http://<服务器IP>:8720/.well-known/agent.json`
4. 系统自动发现 Bridge 并填充名称、Skills（codex/claude/qoder）
5. 设置认证：选择 API Key，填入与 Bridge 配置一致的 `BRIDGE_API_KEY`
6. 配置审批策略（建议 `on-request`）
7. 保存 → 状态变为 Active

注册成功后，即可在工作流编辑器的 Agent 节点中选择远程 Agent。

### 14.5 API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/.well-known/agent.json` | GET | Agent Card 自描述 |
| `/health` | GET | 健康检查 |
| `/a2a` | POST | JSON-RPC 入口 |

支持的 JSON-RPC 方法：
- `message/send` — 同步执行，返回最终结果
- `message/stream` — SSE 流式执行
- `tasks/get` — 查询任务状态
- `tasks/cancel` — 取消任务
- `agent/getCard` — 获取 Agent Card

### 14.6 Git 工作区同步

远程 Agent 操作项目代码时，Bridge 通过内置 GitManager 自动处理代码同步：

**执行时序：**
1. Tide 在 A2A 消息 `configuration.git` 中传入仓库 URL、基线分支、任务分支名
2. Bridge 收到任务后：`git fetch` → `git checkout -b {task_branch} origin/{base_branch}`
3. CLI Agent 在任务分支的工作目录中执行
4. Agent 完成后：Bridge 执行 `git add -A` → `git commit` → `git push origin {task_branch}`
5. A2A 响应中 `metadata.git` 返回 branch 名和 commit SHA
6. Tide 工作流后续 `git_merge` 节点根据 branch 名自动合并

**配置要点：**
- 远程服务器需有仓库的读写权限（SSH Deploy Key 或 HTTPS Token）
- 设置 `GIT_SSH_KEY_PATH` 或 `GIT_AUTH_TOKEN` 环境变量
- 如果所有任务都操作同一个仓库，可设置 `GIT_DEFAULT_REPO` 省去每次传参
- `GIT_AUTO_PUSH=true`（默认）确保变更自动推送

**与本地 Agent worktree 的对比：**

| 维度 | 本地 Agent | 远程 Agent (Bridge) |
|------|-----------|-------------------|
| 代码获取 | 直接访问本地 worktree | Bridge git fetch + checkout |
| 隔离方式 | git worktree add | 独立 task branch |
| 变更回传 | 本地 commit | Bridge auto push |
| 合并 | git_merge 节点 | 同（git_merge 节点） |

### 14.7 测试验证

```bash
# 健康检查
curl http://<IP>:8720/health

# 发现 Agent Card
curl http://<IP>:8720/.well-known/agent.json

# 同步执行任务
curl -X POST http://<IP>:8720/a2a \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{
    "jsonrpc": "2.0",
    "id": "test-1",
    "method": "message/send",
    "params": {
      "message": {
        "role": "user",
        "parts": [{"kind": "text", "text": "列出当前目录下的文件"}]
      },
      "configuration": {"skill": "codex"}
    }
  }'
```

### 14.8 Daemon WebSocket 推模式（NAT 穿透）

默认部署下 Tide 以 HTTP/A2A **主动拉取** Bridge（拉模式），要求 Tide 能直接 reach 到 Bridge。当 Bridge 部署在 **NAT/防火墙后**、Tide 无法主动连接时，可启用 Daemon WebSocket **推模式**：由 Bridge 主动出网连接 Tide 后端，上报能力并通过同一条长连接接收任务。

#### 适用场景

- Bridge 所在主机无公网 IP / 在 NAT 或防火墙后，服务端无法主动 reach；
- 希望 Agent 上下线、能力变更被服务端实时感知；
- Bridge 只需具备出网能力，无需开放入站端口。

#### 架构（推模式）

```
A2A Bridge (Daemon) ──WS 主动连接──►  Tide Backend  /ws/daemon
      ▲ 上行：register / heartbeat / capability_update / task_event / task_result
      ▼ 下行：registered / heartbeat_ack / task_dispatch / task_cancel
              （复用同一条 WS 长连接反向下推，无需 HTTP 回连）
```

#### WS 协议消息

连接：`ws(s)://<tide-host>/ws/daemon?token=<DAEMON_TOKEN>`，使用独立 `DAEMON_TOKEN` 鉴权（与前端 `/ws` 通道完全隔离）。首帧必须为 `register`。

| 方向 | type | 载荷要点 | 说明 |
|------|------|---------|------|
| Daemon→服务端 | `register` | `daemon_id, name, agents, skills, capability_tags, max_concurrency` | 连上首帧，上报身份与能力 |
| 服务端→Daemon | `registered` | `heartbeat_interval` 等 | 确认注册 |
| Daemon→服务端 | `heartbeat` | `active_tasks, load, status` | 定期保活 + 负载上报 |
| 服务端→Daemon | `heartbeat_ack` | — | 心跳确认 |
| Daemon→服务端 | `capability_update` | `skills, capability_tags` | 能力变更推送 |
| 服务端→Daemon | `task_dispatch` | `task_id, prompt, skill, git, configuration` | 反向派发任务 |
| 服务端→Daemon | `task_cancel` | `task_id` | 取消运行中任务 |
| Daemon→服务端 | `task_event` | `task_id, kind, content, state` | 执行增量输出/状态回传 |
| Daemon→服务端 | `task_result` | `task_id, state, artifacts` | 终态结果回传 |

#### 任务下发与回流链路

1. **调度**：服务端按 skill / capability_tag 与实时 load 选定一个在线 Daemon；
2. **下发**：`dispatch_task` 创建 `task_id → asyncio.Queue` 桥接管道，通过 WS 发送 `task_dispatch`；
3. **远端执行**：Daemon 收到后调用本地 executor 执行对应 CLI；
4. **回传**：Daemon 将流式事件以 `task_event` 逐步回传，终态发 `task_result`；
5. **路由**：`/ws/daemon` 按 `task_id` 将事件 `route_task_event` 投递到对应队列；
6. **接入闭环**：当远程 Agent `connection_mode='ws'` 时，Adapter 从队列取事件，复用现有事件映射接入工作流/审批/前端推送，上层无感知传输差异。

取消：服务端发 `task_cancel(task_id)` → Daemon 停本地 CLI。断线：下发时 Daemon 已离线则快速失败/重新调度；连接断开时服务端将其 `status` 置为离线。

#### 服务端注册表（DaemonRegistry）实现要点

`/ws/daemon`（[`backend/api/ws_daemon.py`](../backend/api/ws_daemon.py)）仅负责鉴权与帧路由，状态维护全部交给单例 `daemon_registry`（[`backend/services/daemon_registry.py`](../backend/services/daemon_registry.py)）：

- **鉴权与首帧**：连接携 `?token=<DAEMON_TOKEN>`，与环境变量不符则以 `4001` 关闭；首帧必须为 `register` 且携 `daemon_id`，否则以 `4002/4003` 关闭。
- **能力持久化**：`register` 后写入 `remote_agents` 表（`connection_mode='ws'`）。若注册带 `agents` 列表，则为每个 agent 创建独立记录（ID 为 `daemon-{daemon_id}-{agent_name}`，显示名 `{bridge_name}/{agent_name}`），并将本次不再包含的旧 agent 置 `offline`；否则回退为单条 `daemon-{daemon_id}` 记录。`ON CONFLICT(id) DO UPDATE` 仅更新 daemon 相关字段，不覆盖手动配置的 `auth_credentials` 等。
- **心跳与超时**：`on_heartbeat` 更新 `last_heartbeat / active_tasks / load / status`；后台 `_heartbeat_cleanup_loop` 每 15s 扫描，超过 `TIMEOUT=60s`（4×心跳间隔）无心跳则标记为 `offline` 并回写 DB。
- **任务桥接**：`dispatch_task` 创建 `task_id → asyncio.Queue`（maxsize=100）桥接管道后下发 `task_dispatch`；`route_task_event` 按 `task_id` 将回传事件投递到队列，消费者终态后调 `unregister_task` 清理。
- **重连容忍**：下发时若目标 Daemon 不在线（如后端热重启后 Bridge 尚未重连），`dispatch_task` 最多等待 10s（每 2s 重试）给重连窗口，超时则返回空。
- **启动重置**：后端启动时（`DaemonRegistry.start`）将 DB 中所有 `connection_mode='ws'` 的 agent 置 `offline`，等 Bridge 重连注册后恢复 `active`（旧 WebSocket 连接重启后不可能存活）。

#### 配置说明（Bridge 端）

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `DAEMON_ENABLED` | `false` | 是否启用 Daemon 推模式（默认关闭，向后兼容） |
| `TIDE_WS_URL` | (空) | Tide 后端 daemon WS 端点，如 `ws://localhost:8000/ws/daemon` |
| `DAEMON_TOKEN` | (空) | daemon 鉴权 token，需与后端 `DAEMON_TOKEN` 一致 |
| `DAEMON_ID` | (空) | daemon 标识，不设则首次使用时自动生成 UUID |
| `HEARTBEAT_INTERVAL` | `15` | 心跳间隔（秒） |
| `CAPABILITY_TAGS` | `code,review,docs` | 能力标签，逗号分隔 |
| `BRIDGE_NAME` | (空) | 显示名称前缀，留空回退主机名、再回退 daemon_id 前 8 位 |

> 后端侧需配置相同的 `DAEMON_TOKEN` 环境变量以通过鉴权。

#### 启用方式

```bash
# 交互式配置 Daemon 模式（写入 ~/.a2a-bridge/.env）
a2a-bridge setup --daemon

# 启动（后台守护）
a2a-bridge start -d
```

#### HTTP 拉模式 vs WS 推模式

| 维度 | HTTP 拉模式（默认） | WS 推模式（Daemon） |
|------|------------------|-------------------|
| 连接方向 | Tide 主动连 Bridge | Bridge 主动连 Tide |
| NAT 穿透 | 需 Bridge 有可达地址 | ✓ 只需 Bridge 能出网 |
| 任务下发 | HTTP JSON-RPC (`/a2a`) | WS `task_dispatch` 反向下推 |
| 能力发现 | 定期拉取 Agent Card | 上线即注册 + 实时心跳 |
| 适用场景 | Bridge 有公网/内网可达 | Bridge 在 NAT/防火墙后 |

---

## 15. 实施记录

### 实施时间
2026-06-15

### 变更文件清单

**新增文件：**
- `backend/runtime/a2a_client.py` — A2A JSON-RPC 客户端（支持同步/流式消息、任务管理、Agent Card 发现）
- `backend/api/remote_agents.py` — 远程 Agent 管理 CRUD API（8 个端点）
- `backend/services/a2a_discovery.py` — Agent Card 发现与健康检查服务
- `apps/web/app/settings/remote-agents/page.tsx` — 远程 Agent 管理页面
- `apps/web/app/settings/remote-agents/agent-dialogs.tsx` — 管理页对话框组件

**新增文件（A2A Bridge Service）：**
- `a2a-bridge/main.py` — FastAPI 应用入口，JSON-RPC 路由
- `a2a-bridge/executor.py` — CLI 子进程执行器
- `a2a-bridge/event_parser.py` — CLI 输出事件解析
- `a2a-bridge/agent_card.py` — Agent Card 生成
- `a2a-bridge/models.py` — 数据模型
- `a2a-bridge/config.py` — 配置管理
- `a2a-bridge/Dockerfile` — 容器化部署配置
- `a2a-bridge/README.md` — 部署说明文档

**修改文件：**
- `backend/db/init.sql` — 新增 `remote_agents` 和 `a2a_task_mapping` 表
- `backend/runtime/adapters.py` — 新增 `A2AAdapter` 类
- `backend/runtime/executor.py` — 增加 `a2a:` 前缀路由和 `_run_remote_a2a` 方法
- `backend/services/workflow_engine.py` — Agent 节点支持远程执行，跳过本地 CLI 检查
- `backend/api/agents.py` — `/api/agents` 返回远程 Agent 列表
- `backend/main.py` — 注册 remote_agents_router
- `packages/core/src/api/dashboard.ts` — 扩展 AgentInfo 类型
- `packages/views/src/workflows/PropertyPanel.tsx` — Agent 选择器分组显示
- `apps/web/app/settings/page.tsx` — 设置页新增 Remote Agents 入口

### 待完成项
- [ ] 集成测试：搭建示例 A2A Server 端到端验证
- [ ] 审批 UI 联调：远程 Agent INPUT_REQUIRED 状态触发审批交互
- [ ] 健康检查定时任务：将 `scheduled_check_all()` 注册到 APScheduler
- [ ] 凭据加密：`auth_credentials` 生产环境加密存储
- [ ] `a2a-sdk` 可选依赖添加到 requirements.txt
