# Tide 无工作流默认流程方案（参考 Multica）

## 背景与目标

Tide 当前任务推进强依赖用户预先设计的 DAG 工作流。无工作流时的唯一兜底是 [_find_default_workflow_id](file:///Users/haifeng/Documents/tide/backend/services/work_item_service.py#L458-L474)——借用"系统中最早创建且 enabled"的工作流，节点/分支未必匹配，且系统无任何 enabled 工作流时直接抛异常。

目标：参考 Multica 的"Issue 是人机统一协作界面，Agent 被指派后自动领取→执行→报告→关闭"，为无工作流项目提供**零配置默认流程**，并逐步补齐 Squad 多 Agent 分工、Daemon 能力发现、工作项记忆共享、Skill 语义复用四项能力。

## 现状与差距（已调研）

| 能力 | Tide 现状 | 目标 | 落点 |
|------|----------|------|------|
| 默认流程 | 借用最早 enabled 工作流，无 seed | 系统内建默认工作流模板 | workflow_service / work_item_service |
| 多 Agent 协作 | 专家团 = 单 agent_id + skills + role | Squad = Leader + 多 Worker 分工 | expert_team_service |
| Agent 能力发现 | 本地 CLI 硬编码；远程 A2A 仅 HTTP 健康检查（拉） | Daemon 主动 WebSocket 上报能力（推） | 新增 ws_daemon / daemon_registry |
| 工作项记忆 | 项目级静态知识图谱；会话仅单工作项内 | 跨工作项结构化记忆库 | 新建 task_memories |
| Skill 复用 | slug 精确匹配 | 语义相似度推荐 | skill_service |

**关键约束**：Tide 后端是 **SQLite**（见 [init.sql](file:///Users/haifeng/Documents/tide/backend/db/init.sql)），非 Multica 的 pgvector。语义检索需采用 SQLite 适配方案（应用层向量余弦，或引入 `sqlite-vec` 扩展），不能直接照搬 pgvector。

## 默认流程状态机

内建默认工作流（线性，覆盖 Multica Issue 生命周期），复用现有 [WorkflowEngine](file:///Users/haifeng/Documents/tide/backend/services/workflow_engine.py) 与 12 种节点，无需新引擎：

```
start → agent(triage/leader) → agent(execute) → approval(review) → git_merge → end
```

- triage/leader 节点：分诊，选定 Squad 成员与 Skill（Task 2/5 增强，初期可退化为直接进入 execute）
- approval(review)：可配置自动通过（快速模式）或人工确认
- git_merge：复用现有 worktree + 自动合并能力（见 Worktree 流转机制）

## 实施任务

### Task 1（P0）内建默认工作流模板 + 兜底改造
- [workflows](file:///Users/haifeng/Documents/tide/backend/db/init.sql#L152-L163) 表增列 `is_system INTEGER DEFAULT 0`（通过 `backend/db/engine.py` 运行时迁移，SQLite 不支持 `ALTER ... IF NOT EXISTS`，需先探测列存在性）。
- 在 `workflow_service.py` 定义常量 `DEFAULT_WORKFLOW_DEFINITION`（上面的线性 DAG，agent 节点 `agentId` 缺省 codex，approval 节点 `data.autoApprove` 可配）。
- 启动时 seed：在 engine 初始化或新增 `backend/scripts/seed_default_workflow.py`，若不存在 `is_system=1` 的工作流则插入。
- 改造 [_find_default_workflow_id](file:///Users/haifeng/Documents/tide/backend/services/work_item_service.py#L458-L474)：优先返回 `is_system=1` 的内建工作流，而非借用用户工作流。
- 验证：无任何用户工作流的新项目可直接创建工作项并自动跑通 triage→execute→review→merge。

### Task 2（P1）专家团升级为 Squad
- [expert_teams](file:///Users/haifeng/Documents/tide/backend/db/init.sql#L527-L543) 表增列：`member_agents TEXT DEFAULT '[]'`（JSON：`[{agent_id, role, skill_slugs, capability_tags, priority}]`）、`is_squad INTEGER DEFAULT 0`、`leader_strategy TEXT`（如 `capability_match`/`round_robin`）。
- [expert_team_service.py](file:///Users/haifeng/Documents/tide/backend/services/expert_team_service.py) 增 `resolve_squad()`，返回 Leader + 成员列表。
- [_execute_agent_node](file:///Users/haifeng/Documents/tide/backend/services/workflow_engine.py#L511-L552) 扩展：节点为 Squad 时，Leader 先按任务描述+能力标签分诊，将子任务分配给匹配成员（可串行/并行）。
- 兼容：非 Squad 专家团走原单 agent 逻辑不变。

### Task 3（P1）Daemon 能力发现（WebSocket 推模式）

**架构决策：采用 WebSocket 推模式。** Daemon（a2a-bridge）作为 WS **客户端**主动上连 Tide 后端新增的 `/ws/daemon` 端点，完成能力注册、心跳保活、能力变更推送。相比 HTTP 拉模式，推模式能穿透 NAT/防火墙（Daemon 只要能出网即可，无需公网入口），且上下线/能力变更实时感知。**与前端 [ws_hub](file:///Users/haifeng/Documents/tide/backend/services/ws_hub.py) 隔离**，新建专用 DaemonRegistry。

#### 3.1 WS 协议设计（JSON 消息）
连接：`ws(s)://<tide-host>/ws/daemon?token=<DAEMON_TOKEN>`，鉴权复用 bridge 侧共享密钥（或专用 daemon token）。消息帧：

| 方向 | type | 载荷 | 说明 |
|------|------|------|------|
| Daemon→服务端 | `register` | `{daemon_id, name, endpoint_url, version, max_concurrency, agents:[{skill, model}], skills:[...], capability_tags:[code,review,docs,...]}` | 连上首帧，上报身份与能力 |
| 服务端→Daemon | `registered` | `{server_time, heartbeat_interval}` | 确认注册，下发心跳间隔 |
| Daemon→服务端 | `heartbeat` | `{active_tasks, load, status}` | 定期保活 + 负载上报 |
| 服务端→Daemon | `heartbeat_ack` | `{}` | 心跳确认 |
| Daemon→服务端 | `capability_update` | `{skills, capability_tags}` | 能力变更时主动推 |
| 服务端→Daemon | `task_dispatch` | `{task_id, prompt, skill, context_parts, git, configuration}` | 反向派发任务（核心下发通道） |
| 服务端→Daemon | `task_cancel` | `{task_id}` | 取消运行中任务 |
| Daemon→服务端 | `task_event` | `{task_id, kind, content, state}` | 执行增量输出/状态（流式回传） |
| Daemon→服务端 | `task_result` | `{task_id, state, artifacts}` | 终态结果回传 |

#### 3.2 后端改动
- 新增 `backend/api/ws_daemon.py`：`@router.websocket("/ws/daemon")`，独立鉴权（校验 `DAEMON_TOKEN`，**不复用**前端 `verify_token` 的 access 逻辑），接入后交给 DaemonRegistry 处理消息循环。main.py 注册该 router。
- 新增 `backend/services/daemon_registry.py`：DaemonRegistry 单例，维护 `daemon_id -> {ws, capabilities, last_heartbeat, load}` 内存表；提供 `register()`/`on_heartbeat()`/`disconnect()`/`get_online_agents()`；注册与心跳时 upsert 到 `remote_agents` 表并刷新 `status`/`last_heartbeat`。
- 断线检测：`WebSocketDisconnect` 或心跳超时（> N×interval）→ 标记 `remote_agents.status='offline'`，从内存表移除。
- 能力缓存供 Task 2 Leader 读取：`get_online_agents()` 返回在线 Daemon + capability_tags，作为分配决策依据。

#### 3.3 Daemon（a2a-bridge）侧改动
- `config.py` 新增：`TIDE_WS_URL`（后端 ws 地址）、`DAEMON_TOKEN`、`DAEMON_ENABLED`（默认 false，向后兼容）、`HEARTBEAT_INTERVAL`（默认 15s）、`CAPABILITY_TAGS`。
- 新增 `a2a-bridge/daemon_client.py`：WS 客户端后台任务，流程：连接→发 `register`（从 `config.AGENTS` + Agent Card skills 组装 capability_tags）→心跳循环→断线指数退避重连。
- `main.py` lifespan：`DAEMON_ENABLED` 为真时启动/停止 daemon_client 后台任务。
- `requirements.txt` 新增 `websockets` 依赖。

#### 3.4 任务下发与事件回流链路（核心）

**关键前提**：Daemon 走 WS 正是因为它在 NAT/防火墙后不可被主动 reach，因此任务下发**不能再用 HTTP 回连**，必须复用 Daemon 已建立的**同一条 WS 长连接反向下推**。

下发执行完整链路：
1. **选型/调度**：工作流 Agent 节点（或 Squad Leader）根据 agentId/skill 在 `DaemonRegistry.get_online_agents()` 中匹配声明了该 skill/capability_tag 且在线的 Daemon；多候选时按 `load`/`max_concurrency` 负载均衡。
2. **下发**：通过 DaemonRegistry 找到该 Daemon 的 ws 连接，发送 `task_dispatch`（task_id、prompt、skill、context_parts、git、configuration），并注册 `task_id -> asyncio.Queue` 桥接管道。
3. **远端执行**：Daemon 侧 [daemon_client](file:///Users/haifeng/Documents/tide/a2a-bridge/daemon_client.py) 收到 `task_dispatch` → 调用本地 [executor](file:///Users/haifeng/Documents/tide/a2a-bridge/executor.py)（已有 `create_task`/`run_streaming`）执行对应 CLI。
4. **回传**：Daemon 把执行中的流式事件通过**同一条 WS** 以 `task_event` 逐步回传，终态发 `task_result`（含 artifacts）。
5. **投递**：`/ws/daemon` 端点收到 `task_event`/`task_result` → 按 task_id 投递到对应 Queue。
6. **接入现有闭环**：新增一个 WS 传输分支——当 `remote_agent.connection_mode=='ws'` 时，[A2AAdapter](file:///Users/haifeng/Documents/tide/backend/runtime/adapters.py#L1191-L1316) 不再用 [A2AClient](file:///Users/haifeng/Documents/tide/backend/runtime/a2a_client.py#L84) 发 HTTP，而是从 Queue 异步取事件，**复用现有 `_map_to_internal_event`** 映射为 Tide 内部事件流（`status_changed`/`output_chunk`/`completed`/`failed`）。上层 executor/工作流引擎/前端推送**零改动**。

**关键机制**：
- **请求-响应关联**：以 `task_id` 为键，DaemonRegistry 维护 `task_id -> Queue`，桥接下行派发与上行回传。
- **取消**：Tide 侧取消 → 发 `task_cancel(task_id)` → Daemon 停本地 CLI（复用 executor.cancel）。
- **并发/背压**：Daemon 上报 `max_concurrency` 与实时 `load`，调度时超载则排队或选其他 Daemon。
- **断线处理**：下发时 Daemon 已离线 → 快速失败/重新调度；执行中断线 → task 标记 failed（可后续接重连恢复）。

#### 3.5 表结构迁移（走 engine.py 探列后 ALTER）
[remote_agents](file:///Users/haifeng/Documents/tide/backend/db/init.sql#L329-L355) 增列：`connection_mode TEXT DEFAULT 'http'`（http/ws）、`capability_tags TEXT`、`last_heartbeat TIMESTAMP`、`daemon_session_id TEXT`。

#### 3.6 降级与共存
- `DAEMON_ENABLED=false` 时完全退回原 HTTP 拉模式，[scheduled_check_all](file:///Users/haifeng/Documents/tide/backend/services/a2a_discovery.py#L372-L489) 仍照常工作。
- WS 在线的 Daemon 标记 `connection_mode='ws'`，HTTP 巡检自动跳过，避免双重探测。
- 本地 CLI（同机）仍用 `shutil.which` 探测，不走 WS；WS 推模式专用于远程 Daemon。

### Task 4（P2）工作项记忆共享
- 新建 `task_memories` 表：`id, work_item_id, project_id, memory_type(result/error/lesson/artifact), content, tags, embedding(可选), created_at`。
- Task 完成回调（[on_task_completed](file:///Users/haifeng/Documents/tide/backend/services/workflow_engine.py) 路径）自动抽取结果摘要入库。
- 新增 `_build_prompt_with_memories()`（与现有 [_build_prompt_with_knowledge](file:///Users/haifeng/Documents/tide/backend/runtime/adapters.py#L800-L822) 同级），在 Agent 节点启动前检索相关历史记忆注入 prompt。

### Task 5（P2）Skill 语义复用
- 因 SQLite 无 pgvector，采用二选一：(a) 应用层：`skill_embeddings` 表存向量 + 内存余弦 Top-K；(b) 引入 `sqlite-vec` 扩展。建议先 (a)。
- 新增 `skill_embedding_service`：Skill CRUD 时调用 embedding API 生成向量。
- [skill_service.py](file:///Users/haifeng/Documents/tide/backend/services/skill_service.py) 增 `search_similar_skills(query, top_k)`。
- triage/Leader 节点据任务描述自动推荐 Skill，替代纯手工 slug 选择。

## 分期与优先级

- P0：Task 1（内建默认流程，独立可交付，立即解决"无工作流无法推进"）
- P1：Task 2 + Task 3（Squad 分工 + 能力发现，二者配套）
- P2：Task 4 + Task 5（记忆共享 + Skill 语义复用，体验增强）

## 风险与兼容性

- 所有改动与现有显式工作流**并存**，默认流程仅在项目未绑定工作流时生效。
- SQLite 迁移统一走 `engine.py` 运行时"探测列后 ALTER"模式，兼容旧库。
- 向量能力为可选增强，缺 embedding API 时自动退化为关键词匹配，不阻塞主流程。
- 内建默认工作流标记 `is_system=1`，禁止普通用户删除，避免兜底失效。