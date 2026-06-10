# Tide — 系统架构

> 版本：v2.0 | 更新日期：2026-06-08
> 状态：**已实施**（Phase 1–4 迁移完成；旧脚本 `tide_ws.py` 已废弃）

完整功能与启动方式见 [README.md](README.md)；演进路线见 [ROADMAP.md](ROADMAP.md)。

---

## 1. 概述

Tide 把 Codex / Claude Code / Qoder 等 Agent CLI 统一封装在 **单进程 FastAPI 后端** 中，前端是 **Next.js Web 工作台**，并保留 **Lark 机器人** 作为辅助通道。设计目标：

- **统一后端，单进程部署** — 不再维护两份独立的 Lark 脚本和 Web API。
- **SQLite 唯一数据源** — Web、Lark、定时器、工作流共享同一份状态。
- **Lark 可选** — 缺少 `LARK_APP_ID/SECRET` 时自动以 Web-only 模式启动。
- **不依赖 Redis** — WebSocket 推送走进程内 Hub，APScheduler 任务存 SQLite。
- **每步持久化** — 任务状态实时写库，进程重启可恢复。

---

## 2. 系统架构

```
┌────────────────────────────────────────────────────────────────┐
│                      Web 前端 (Next.js 16)                      │
│  Dashboard │ Tasks │ Plans (DAG) │ Kanban │ Schedules │ Workflows│
└──────────────┬───────────────────────────────────────┬─────────┘
               │ REST /api/*                            │ WS /ws
               ▼                                        ▼
┌────────────────────────────────────────────────────────────────┐
│                FastAPI 统一后端 (单进程, asyncio)               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ backend/api/      REST + WebSocket 路由                    │  │
│  │   tasks plans approvals conversations kanban schedules     │  │
│  │   workflows projects sessions agents events ws lark_*      │  │
│  └────────────────────────┬─────────────────────────────────┘  │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ backend/services/  业务服务层                              │  │
│  │   task plan plan_executor approval conversation            │  │
│  │   schedule workflow_engine event_emitter ws_hub            │  │
│  │   kanban card_builder card_action_handler                  │  │
│  │   lark_bridge lark_listener message_handler                │  │
│  └────────────────────────┬─────────────────────────────────┘  │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ backend/runtime/   底层执行                                │  │
│  │   executor (asyncio subprocess)  adapters (codex/claude/  │  │
│  │   qoder)  task_runtime  plan_runtime  git_utils  config   │  │
│  └────────────────────────┬─────────────────────────────────┘  │
│                           ▼                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐    │
│  │ SQLite (WAL) │  │ APScheduler  │  │ Lark Listener (线程) │    │
│  │   tide.db    │  │ 内存 jobstore │  │ lark-oapi WS         │    │
│  └──────────────┘  └──────────────┘  └────────────────────┘    │
└────────────────────────────┬───────────────────────────────────┘
                             │ Lark SDK (可选)
                             ▼
                  ┌──────────────────┐
                  │   飞书客户端     │
                  │ (机器人卡片消息) │
                  └──────────────────┘
```

### 应用入口

[backend/main.py](backend/main.py) 注册 lifespan：

1. `init_db()` — 执行 `backend/db/init.sql` 建表。
2. `schedule_service.start()` — 启动 APScheduler。
3. 检查 `lark_listener.is_configured`：若 Lark 凭据齐全，则启动 Lark WebSocket 监听线程并启动 `message_handler`；否则记录 `Web-only mode` 后跳过。
4. 注册所有 API Router。
5. 进程退出时反向 stop。

CORS 白名单默认放行 `localhost:3000–3002`，匹配 Next.js 端口自动递增策略。

---

## 3. 后端模块结构

### 3.1 `backend/runtime/` — 底层执行

| 模块 | 职责 |
|------|------|
| [executor.py](backend/runtime/executor.py) | asyncio subprocess 包装器，统一 Agent 子进程启动、超时、stdout/stderr 流式回调 |
| [adapters.py](backend/runtime/adapters.py) | `AGENT_ADAPTERS = {codex, claude, qoder}`，封装各 CLI 的命令行参数、permission mode、resume 协议 |
| [task_runtime.py](backend/runtime/task_runtime.py) | 单个任务运行上下文：prompt 拼装、附件注入、session 锁 |
| [plan_runtime.py](backend/runtime/plan_runtime.py) | Plan 子任务运行：worktree 切换、分支命名、test 命令执行、diff 摘要 |
| [git_utils.py](backend/runtime/git_utils.py) | Git worktree / branch / cherry-pick / 冲突检测工具函数 |
| [config.py](backend/runtime/config.py) | 环境变量集中读取与默认值 |

### 3.2 `backend/services/` — 业务服务

| 模块 | 职责 |
|------|------|
| [task_service.py](backend/services/task_service.py) | 任务 CRUD、状态机、SSE 输出聚合、与 ws_hub 联动 |
| [plan_service.py](backend/services/plan_service.py) | Plan CRUD、阶段/依赖解析、子任务关联 |
| [plan_executor.py](backend/services/plan_executor.py) | Plan 并行调度器（max_parallel + DAG 拓扑序） |
| [approval_service.py](backend/services/approval_service.py) | 审批申请、状态流转、通知 Lark/Web 双端 |
| [conversation_service.py](backend/services/conversation_service.py) | 会话管理与 session resume |
| [schedule_service.py](backend/services/schedule_service.py) | APScheduler 封装、cron/interval/date 触发、schedule_runs 记录 |
| [workflow_engine.py](backend/services/workflow_engine.py) | DAG 工作流引擎，节点回调驱动 |
| [workflow_service.py](backend/services/workflow_service.py) | 工作流定义 CRUD |
| [kanban_service.py](backend/services/kanban_service.py) | 四维看板聚合（项目/会话/Agent/工作流） |
| [event_emitter.py](backend/services/event_emitter.py) | 任务事件统一出口 → task_events 表 + ws_hub |
| [ws_hub.py](backend/services/ws_hub.py) | 进程内 WebSocket 广播总线 |
| [card_builder.py](backend/services/card_builder.py) | Lark 卡片 JSON 构造 |
| [card_action_handler.py](backend/services/card_action_handler.py) | Lark 卡片按钮回调分发 |
| [lark_bridge.py](backend/services/lark_bridge.py) | Lark API 客户端封装（发送消息/卡片/下载附件） |
| [lark_listener.py](backend/services/lark_listener.py) | 后台线程托管 lark-oapi WebSocket 客户端，将事件投递到 asyncio.Queue |
| [message_handler.py](backend/services/message_handler.py) | 消费 Lark 事件队列，分发到 task / plan / 审批等业务 |

### 3.3 `backend/api/` — REST + WebSocket 路由

| 路由 | 文件 | 说明 |
|------|------|------|
| `/api/tasks` | [tasks.py](backend/api/tasks.py) | 任务 CRUD、stop、retry、approve、reject、SSE 输出 |
| `/api/plans` | [plans.py](backend/api/plans.py) | Plan CRUD、子任务、合并总览、cleanup |
| `/api/approvals` | [approvals.py](backend/api/approvals.py) | 待审批列表、批准/拒绝 |
| `/api/conversations` | [conversations.py](backend/api/conversations.py) | 会话列表、resume |
| `/api/kanban` | [kanban.py](backend/api/kanban.py) | 四维看板聚合 |
| `/api/schedules` | [schedules.py](backend/api/schedules.py) | 定时任务 CRUD、toggle、trigger、runs |
| `/api/workflows` | [workflows.py](backend/api/workflows.py) | 工作流定义、运行、节点审批 |
| `/api/projects` `/api/sessions` | [projects.py](backend/api/projects.py) [sessions.py](backend/api/sessions.py) | 项目与会话只读视图 |
| `/api/agents` | [agents.py](backend/api/agents.py) | Agent 列表与运行时状态 |
| `/api/dashboard` `/api/events` | [dashboard.py](backend/api/dashboard.py) [events.py](backend/api/events.py) | Dashboard 统计、事件流 |
| `/ws` | [ws.py](backend/api/ws.py) | 客户端 WebSocket 连接，订阅任务/计划/工作流频道 |
| `/api/lark/*` | [lark_callback.py](backend/api/lark_callback.py) [lark_bridge.py](backend/api/lark_bridge.py) | Lark 卡片回调与 webhook |

### 3.4 `backend/db/` — 数据库

| 文件 | 说明 |
|------|------|
| [engine.py](backend/db/engine.py) | aiosqlite 引擎、`init_db()`、连接池 |
| [init.sql](backend/db/init.sql) | 建表 SQL：`actors / workspaces / tasks / task_events / plans / plan_tasks / approvals / schedules / schedule_runs / workflows / workflow_runs / workflow_node_runs / conversations` |

### 3.5 `backend/models/`

[schemas.py](backend/models/schemas.py) — Pydantic 请求/响应模型，所有 API 共享。

---

## 4. 前端结构（Monorepo）

```
apps/web/                Next.js 16 应用（App Router）
  app/
    page.tsx             Dashboard
    tasks/               任务列表与详情
    plans/               Plan 列表与 DAG 详情
    kanban/              四维看板
    schedules/           定时调度
    workflows/           工作流可视化
    projects/ sessions/  辅助视图
    app-shell.tsx        全局布局壳
  next.config.ts postcss.config.js tsconfig.json

packages/
  core/                  Headless 逻辑（Zustand store + TanStack Query + API client + 类型）
  ui/                    shadcn/ui 原子组件
  views/                 业务页面组件（被 apps/web 引用）
```

三层分离原则：

- `core/` 零 `react-dom`、零 `localStorage`、零 `process.env`。
- `ui/` 零业务逻辑、零 `@core` 导入。
- `views/` 零 `next/*`、零直接 store 导入；通过 hooks 与 core 交互。

主要技术栈：Next.js 16 + React 19 + TypeScript 5.9 + Tailwind CSS v4 + Zustand 5 + TanStack Query 5 + React Flow + Monaco Editor + @hello-pangea/dnd。

---

## 5. 数据流

### 5.1 Web → 后端 → 数据库

```
浏览器                Next.js                FastAPI               Service             SQLite
  │  用户操作 (新建任务) │                      │                     │                   │
  │ ───────────────►  │  POST /api/tasks    │                     │                   │
  │                   │ ──────────────────► │ TaskService.create  │                   │
  │                   │                     │ ───────────────────►│  INSERT tasks     │
  │                   │                     │                     │ ─────────────────►│
  │                   │                     │ event_emitter.emit  │                   │
  │                   │                     │ ───────────────────►│ INSERT task_events│
  │                   │                     │ ws_hub.broadcast    │                   │
  │  WS task.created  │ ◄────────────────── │                     │                   │
  │ ◄──────────────── │  TanStack invalidate│                     │                   │
```

### 5.2 Lark → 后端 → 数据库

```
飞书客户端          lark_listener (线程)        message_handler        Service           SQLite
  │  发消息          │                          │                      │                 │
  │ ───────────────►│ asyncio.Queue.put         │                      │                 │
  │                 │ ────────────────────────► │ 解析指令              │                 │
  │                 │                           │ ────────────────────►│ INSERT tasks    │
  │                 │                           │ event_emitter.emit   │ ───────────────►│
  │                 │                           │ ws_hub.broadcast     │                 │
  │ 卡片回调按钮     │                          │                      │                 │
  │ ───────────────►│ 转发到 message_handler    │                      │                 │
  │                 │                           │ approval/stop/retry  │                 │
```

### 5.3 双向同步保证

- SQLite 是**唯一数据源**，Web 与 Lark 共享。
- Lark 卡片按钮回调 → 更新 SQLite → ws_hub 广播 → Web 自动刷新。
- Web 操作 → 更新 SQLite → 通过 `lark_bridge` 主动刷新原 Lark 卡片。
- `event_emitter` 把所有状态变更写入 `task_events` 表，供事件回放和 Dashboard 时间线使用。

---

## 6. SQLite 表结构概览

完整建表 SQL 见 [backend/db/init.sql](backend/db/init.sql)。核心表：

| 表 | 主键/唯一 | 关键字段 | 说明 |
|----|----------|---------|------|
| `actors` | `id` | `type` (member/agent/lark_user), `name`, `metadata` | Polymorphic 身份表，统一人和 Agent |
| `workspaces` | `id`, `slug` | `name`, `owner_id` | 工作空间，所有数据按 `workspace_id` 隔离 |
| `tasks` | `id` | `workspace_id`, `plan_id`, `workflow_run_id`, `assignee_id`, `status`, `prompt`, `agent_id`, `session_id`, `worktree_path`, `branch_name`, `commit_hash`, `merge_status` | 统一任务表，所有 Agent 执行都落到这里 |
| `task_events` | `id` | `task_id`, `event_type`, `payload`, `created_at` | 状态变更事件流，驱动 Dashboard 时间线 |
| `plans` | `id` | `workspace_id`, `status`, `max_parallel`, `definition` | Plan 定义 |
| `plan_tasks` | `(plan_id, task_id)` | `task_index`, `phase`, `depends_on` | Plan ↔ tasks 多对多关系 + DAG 阶段依赖 |
| `approvals` | `id` | `task_id`, `plan_id`, `chat_id`, `type`, `detail`, `status`, `operator_id` | 审批记录，复用 Web/Lark 双端 |
| `conversations` | `id` | `workspace_id`, `chat_id`, `agent_id`, `model`, `session_id`, `cwd`, `status` | 会话管理与 resume 索引 |
| `schedules` | `id` | `trigger_type` (cron/interval/date), `trigger_config`, `task_type` (agent/plan/status/custom), `task_config`, `enabled`, `next_run_at` | APScheduler 持久化定义 |
| `schedule_runs` | `id` | `schedule_id`, `task_id`, `status`, `started_at`, `error` | 定时任务执行历史 |
| `workflows` | `id` | `workspace_id`, `definition` (JSON), `version` | 工作流图定义（节点 + 连线） |
| `workflow_runs` | `id` | `workflow_id`, `status`, `current_node_ids`, `context` | 工作流运行实例 |
| `workflow_node_runs` | `id` | `run_id`, `node_id`, `task_id`, `status`, `output`, `error` | 节点级执行记录 |

初始数据：`actors` 内置三个 Agent（codex/claude/qoder），`workspaces` 内置 `default`。

---

## 7. WebSocket 协议

```
WS /ws

# 客户端 → 服务端
{ "type": "subscribe", "channels": ["tasks", "plan:xxx", "workflow_run:xxx"] }
{ "type": "ping" }

# 服务端 → 客户端
{ "type": "task.status_changed", "task_id": "...", "old_status": "...", "new_status": "...", "timestamp": ... }
{ "type": "task.output", "task_id": "...", "chunk": "...", "timestamp": ... }
{ "type": "plan.task.started", "plan_id": "...", "task_id": "...", "timestamp": ... }
{ "type": "plan.task.completed", "plan_id": "...", "task_id": "...", "result": "...", "timestamp": ... }
{ "type": "workflow.node.started", "run_id": "...", "node_id": "..." }
{ "type": "workflow.node.completed", "run_id": "...", "node_id": "...", "output": "..." }
{ "type": "schedule.run.started" / "schedule.run.completed", ... }
{ "type": "approval.requested" / "approval.resolved", ... }
{ "type": "pong" }
```

**原则**：WebSocket 事件只触发 TanStack Query cache invalidation，不直接写 store。状态以 SQLite 为准，REST 拉取为最终一致性入口。

---

## 8. Plan 执行细节

1. 用户提交 `/plan` 文本或 Web 表单 → `PlanService.create_plan` 解析阶段与依赖（`depends:1,2`） → 写 `plans` + `plan_tasks` + 关联 `tasks(status=queued)`。
2. `PlanExecutor` 按 `max_parallel` + DAG 拓扑序调度：
   - 在 Git 仓库下使用 `git_utils` 创建 `.tide/worktrees/<plan_id>-<task_id>` worktree 与 `tide/<plan_id>-<task_id>` 分支。
   - 调用 `task_runtime` 启动 Agent 子进程；输出通过 `event_emitter` → `ws_hub` 流式广播。
3. 子任务结束执行 `PLAN_TEST_COMMAND`，生成 diff_summary，写回 `tasks` 并推送到 Plan DAG 视图。
4. 进入「等待提交」状态 → Web/Lark 审批后 commit 到子任务分支；不会自动合并主干。
5. 合并总览支持逐个/批量 cherry-pick，冲突时可丢回 Codex 自动修复或终止合并。
6. 状态全程持久化在 SQLite，进程重启可恢复未结束 Plan 的卡片操作。

非 Git 仓库或 worktree 创建失败时，子任务在原目录直接执行（`PLAN_USE_WORKTREES=0` 也可全局关闭）。

---

## 9. Lark 双通道联动

### 9.1 启动条件

- 配置 `LARK_APP_ID` + `LARK_APP_SECRET` → `lark_listener.is_configured == True` → 后端启动 `lark_listener` 线程与 `message_handler`。
- 缺凭据 → 日志输出 `Lark credentials not set, running in Web-only mode`，所有 Web 功能照常工作。

### 9.2 Lark → Web

```
Lark 消息/卡片回调
  → lark_listener (线程, lark-oapi WS) → asyncio.Queue
  → message_handler 解析指令
  → TaskService / PlanService / ApprovalService 写 SQLite
  → ws_hub 广播 → Web 自动刷新
```

### 9.3 Web → Lark

```
Web 操作 → REST API → Service 写 SQLite
  → 调用 lark_bridge 发送/更新卡片
  → 用户在 Lark 上看到状态变化
```

---

## 10. 部署架构

### 10.1 开发环境

```bash
# 后端（含 Lark Listener / Scheduler / WS Hub）
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000

# 前端（端口被占用时自动 3001/3002 …）
cd apps/web && yarn dev
```

### 10.2 生产部署

单进程后端 + 静态前端最小化部署：

```
docker-compose.yml
  ├── api          (FastAPI, uvicorn workers=1, 端口 8000)
  ├── web          (Next.js standalone build, 端口 3000)
  └── data         (持久化卷: tide.db, .tide/)
```

不依赖 Redis、PostgreSQL；如有水平扩展需求，可将 SQLite 替换为 PostgreSQL 并将 ws_hub 升级为 Pub/Sub。

---

## 11. 设计原则回顾

1. **不重造 Agent 运行时** — 复用 `AGENT_ADAPTERS`（codex/claude/qoder），后端只做控制面。
2. **Polymorphic Actor** — `actor_type + actor_id` 统一人和 Agent，避免特殊端点。
3. **WebSocket 事件只做 Cache Invalidation** — 不直接写 Store，避免状态分裂。
4. **不依赖 Redis** — 单节点自托管只需 SQLite + 进程内 Hub。
5. **每步持久化** — 节点状态实时写 DB，crash-safe。
6. **双入口并存** — Web 是第一入口，Lark Bridge 保留为辅助通道；缺凭据自动降级。
