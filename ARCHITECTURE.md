# Tide — 系统架构

> 版本：v2.4 | 更新日期：2026-06-26
> 状态：**已实施**（Phase 1–4 迁移完成；旧脚本 `tide_ws.py` 已废弃；知识图谱扩展至 10 类）

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
│  Dashboard │ Tasks │ Plans │ Kanban │ Schedules │ Workflows     │
│  Code Editor │ Git Audit │ Merge Conflict │ Work Items          │
│  Knowledge Graph (10 types) │ Progress Indicator                │
└──────────────┬───────────────────────────────────────┬─────────┘
               │ REST /api/*                            │ WS /ws
               ▼                                        ▼
┌────────────────────────────────────────────────────────────────┐
│                FastAPI 统一后端 (单进程, asyncio)               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ backend/api/      REST + WebSocket 路由                    │  │
│  │   tasks plans approvals conversations kanban schedules     │  │
│  │   workflows projects sessions agents events ws lark_*      │  │
│  │   skills rules hooks security dashboard git_audit files    │  │
│  └────────────────────────┬─────────────────────────────────┘  │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ backend/services/  业务服务层                              │  │
│  │   task plan plan_executor approval conversation            │  │
│  │   schedule workflow_engine event_emitter ws_hub            │  │
│  │   kanban card_builder card_action_handler                  │  │
│  │   lark_bridge lark_listener message_handler                │  │
│  │   skill_service rule_service hook_engine                   │  │
│  │   security_scanner cost_service session_discovery          │  │
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
| [kanban_service.py](backend/services/kanban_service.py) | 四维看板聚合（项目/会话/Agent/工作流）+ 工作项看板，项目看板支持项目组 |
| [event_emitter.py](backend/services/event_emitter.py) | 任务事件统一出口 → task_events 表 + ws_hub |
| [ws_hub.py](backend/services/ws_hub.py) | 进程内 WebSocket 广播总线 |
| [card_builder.py](backend/services/card_builder.py) | Lark 卡片 JSON 构造 |
| [card_action_handler.py](backend/services/card_action_handler.py) | Lark 卡片按钮回调分发 |
| [lark_bridge.py](backend/services/lark_bridge.py) | Lark API 客户端封装（发送消息/卡片/下载附件） |
| [lark_listener.py](backend/services/lark_listener.py) | 后台线程托管 lark-oapi WebSocket 客户端，将事件投递到 asyncio.Queue |
| [message_handler.py](backend/services/message_handler.py) | 消费 Lark 事件队列，分发到 task / plan / 审批等业务 |
| [skill_service.py](backend/services/skill_service.py) | 技能库存储检索、按 slug 批量获取、启用状态管理 |
| [rule_service.py](backend/services/rule_service.py) | 规则三层分级匹配（global → language → project） |
| [hook_engine.py](backend/services/hook_engine.py) | 事件触发 / 条件匹配 / 异步动作执行（script/webhook/notification/skill） |
| [security_scanner.py](backend/services/security_scanner.py) | 正则模式匹配扫描引擎，检测密钥/质量/合规问题 |
| [cost_service.py](backend/services/cost_service.py) | 多模型定价 + 多维度成本计算与聚合 |
| [project_group_service.py](backend/services/project_group_service.py) | 项目组 CRUD、成员管理、跨仓库聚合、上下文 prompt 生成 |
| [knowledge_service.py](backend/services/knowledge_service.py) | 知识图谱文件管理、异步生成任务调度（静态分析 + Agent 双路径，支持 10 类图谱）、Agent JSON 类型检查与渲染降级 |
| [ai_decompose_service.py](backend/services/ai_decompose_service.py) | 工作项 AI 分解：通过 httpx 异步调用 LLM API（OpenAI 兼容 / Anthropic），将长文本需求/PRD/链接/附件拆解为多个工作项草稿；复用 `KNOWLEDGE_LLM_*` 环境变量 |
| [work_item_service.py](backend/services/work_item_service.py) | 工作项 CRUD、批量创建、AI 分解结果落库；同时收集会话产物（task result 中的文件路径与文档链接） |
| [session_discovery.py](backend/services/session_discovery.py) | 会话发现服务：支持 Qoder IDE（~/.qoder/cache/projects/）、Codex CLI 对话、精确项目路径匹配、DB + 文件系统合成去重 |

### 3.3 `backend/api/` — REST + WebSocket 路由

| 路由 | 文件 | 说明 |
|------|------|------|
| `/api/tasks` | [tasks.py](backend/api/tasks.py) | 任务 CRUD、stop、retry、approve、reject、SSE 输出 |
| `/api/plans` | [plans.py](backend/api/plans.py) | Plan CRUD、子任务、合并总览、cleanup |
| `/api/approvals` | [approvals.py](backend/api/approvals.py) | 待审批列表、批准/拒绝 |
| `/api/conversations` | [conversations.py](backend/api/conversations.py) | 会话列表、resume |
| `/api/kanban` | [kanban.py](backend/api/kanban.py) | 四维看板聚合 + 工作项看板（支持项目组、多维筛选） |
| `/api/schedules` | [schedules.py](backend/api/schedules.py) | 定时任务 CRUD、toggle、trigger、runs |
| `/api/workflows` | [workflows.py](backend/api/workflows.py) | 工作流定义、运行、节点审批 |
| `/api/projects` `/api/sessions` | [projects.py](backend/api/projects.py) [sessions.py](backend/api/sessions.py) | 项目与会话只读视图 |
| `/api/agents` | [agents.py](backend/api/agents.py) | Agent 列表与运行时状态 |
| `/api/dashboard` `/api/events` | [dashboard.py](backend/api/dashboard.py) [events.py](backend/api/events.py) | Dashboard 统计、事件流、成本概览 |
| `/api/skills` | [skills.py](backend/api/skills.py) | 技能库 CRUD、按 workspace/slug 查询 |
| `/api/rules` | [rules.py](backend/api/rules.py) | 规则 CRUD、三层分级匹配 |
| `/api/hooks` | [hooks.py](backend/api/hooks.py) | 事件钩子 CRUD、条件/动作配置 |
| `/api/security` | [security.py](backend/api/security.py) | 安全扫描、规则 CRUD、Findings 管理 |
| `/ws` | [ws.py](backend/api/ws.py) | 客户端 WebSocket 连接，订阅任务/计划/工作流频道 |
| `/api/project-groups` | [project_groups.py](backend/api/project_groups.py) | 项目组 CRUD、成员项目/用户管理、聚合查询、工作流绑定 |
| `/api/work-items` | [work_items.py](backend/api/work_items.py) | 工作项 CRUD、AI 分解（`POST /api/work-items/ai-decompose`，multipart/form-data 接受文本/链接/文件）、批量创建（`POST /api/work-items/batch`） |
| `/api/sessions/{id}/artifacts` | [sessions.py](backend/api/sessions.py) | 会话产物收集：从 task result 解析文件路径与链接，返回汇总产物列表 |
| `/api/sessions/{id}/usage` `/api/usage/batch` | [sessions.py](backend/api/sessions.py) | Token 上报 API（单个/批量），外部客户端主动上报 token 消耗 |
| `/api/knowledge` | [knowledge.py](backend/api/knowledge.py) | 知识图谱文件 CRUD、触发生成、状态查询、ZIP 导出 |
| `/api/projects/{id}/git/*` | [git_audit.py](backend/api/git_audit.py) | Git 审计：提交列表、变更统计、diff、分支、未提交变更、提交/撤销/忽略 |
| `/api/files/*` | [files.py](backend/api/files.py) | 文件操作：文件树、内容读写、diff、冲突详情、解决冲突、AI 解决冲突 |
| `/api/lark/*` | [lark_callback.py](backend/api/lark_callback.py) [lark_bridge.py](backend/api/lark_bridge.py) | Lark 卡片回调与 webhook |

### 3.4 `backend/db/` — 数据库

| 文件 | 说明 |
|------|------|
| [engine.py](backend/db/engine.py) | aiosqlite 引擎、`init_db()`、连接池 |
| [init.sql](backend/db/init.sql) | 建表 SQL：`actors / workspaces / tasks / task_events / plans / plan_tasks / approvals / schedules / schedule_runs / workflows / workflow_runs / workflow_node_runs / conversations` |

### 3.5 `backend/models/`

[schemas.py](backend/models/schemas.py) — Pydantic 请求/响应模型，所有 API 共享.

### 3.6 认证与权限体系

#### 认证流程

系统支持双认证方式，由环境变量 `TIDE_REQUIRE_AUTH` 控制是否强制启用：

- **JWT Token 认证**：用户名密码登录 → 签发 access_token + refresh_token
- **Lark OAuth2 SSO**：飞书扫码 → OIDC 三步验证 → 自动创建/关联用户

#### 角色体系

| 角色 | 全局权限 | 项目级权限 |
|------|---------|------------|
| admin | 全部操作，跳过项目级检查 | — |
| member | 需按项目配置 | owner/member: 读写; viewer: 只读 |
| viewer | 全局只读 | 只读 |

#### 权限检查链路

```
请求 → get_optional_user() → 解析 JWT → 返回 user dict
                                          ↓
                              check_project_write_permission()
                                          ↓
                              查 project_members 表 → 允许/拒绝
```

关键依赖注入（`backend/core/dependencies.py`）：
- `get_optional_user(request)` — 可选认证（TIDE_REQUIRE_AUTH=0 时放行）
- `get_current_user(request)` — 强制认证
- `check_project_write_permission(project_id, user)` — 项目级写权限
- `check_cwd_write_permission(cwd, user)` — 基于工作目录的权限检查

#### Lark 端权限过滤

Lark 消息处理链路（message_handler、card_action_handler）集成了独立的权限检查：

```
Lark 消息/按钮 → LARK_ALLOWED_OPEN_IDS 白名单
                        ↓
              resolve_lark_user(open_id) → 查 users.lark_open_id
                        ↓
              check_lark_permission() → 身份+项目权限校验
                        ↓
                  允许执行 / 回复权限提示
```

- 白名单为空时不启用过滤
- `TIDE_REQUIRE_AUTH=0` 时权限检查为 best-effort，不阻止操作
- 权限不足时向 Lark 用户回复友好提示消息

#### 项目级配置继承

Skills、Rules、Hooks、Security 四个 ECC 模块均支持项目级配置，采用继承+覆盖模式：

- 存储：`project_id IS NULL` = 全局配置；`project_id = <pid>` = 项目级配置
- 合并：运行时加载全局 + 项目配置，按 slug/name 合并（项目覆盖全局同名项）
- 权限：通过 `check_project_config_permission()` 函数（`backend/core/dependencies.py`）统一检查
  - 全局 admin：管理所有层级
  - 项目 admin/owner：管理本项目配置
  - 项目 member/viewer：只读使用

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
    projects/            项目列表与详情
      [id]/files/        代码查看编辑器（Monaco Editor 多标签）
      [id]/audit/        Git 审计信息展示（提交/文件/工作项/会话四维）
    sessions/            辅助视图
    settings/
      skills/            ECC 技能库管理
      rules/             ECC 规则管理
      hooks/             ECC 事件钩子管理
      security/          ECC 安全审查
    work-items/          工作项列表（含 AIDecomposeDialog 入口）
    app-shell.tsx        全局布局壳
  next.config.ts postcss.config.js tsconfig.json

packages/
  core/                  Headless 逻辑（Zustand store + TanStack Query + API client + 类型）
  ui/                    shadcn/ui 原子组件
  views/                 业务页面组件（被 apps/web 引用）

scripts/                 仓库级脚本
  gen_knowledge_graph.py 知识图谱生成脚本（10 个分析器：Python AST 静态分析 + 文件启发式推断）
  code_collector.py      代码收集器（语言检测、文件树、上下文构建）
  llm_analyzer.py        Prompt 模板（10 个）与 JSON 提取工具（供 Agent 生成路径使用）
```

主要业务组件包含：

- `AIDecomposeDialog` — 工作项 AI 分解三步弹窗（输入 → 结果校对 → 确认创建），支持长文本粘贴、链接输入与 .md/.txt/.docx/.pdf 附件上传（单文件 10MB 限制）。
- `ChatArtifactPanel` — 浮动聊天窗口可折叠产物汇总面板，嵌入窗口 header 下方；会话产物状态由 `use-chat` hook 维护（监听 `task.artifact` WS 事件并从消息内容提取文件链接）。
- `ChatMessageList` — 消息气泡底部渲染产物卡片；配合增强后的文档查看器（`/docs/view`）支持 JSON / 代码 / 图片预览与「在新标签页打开」。

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
| `skills` | `id` | `workspace_id`, `name`, `slug`, `category`, `tags`, `content`, `version`, `enabled`, `source` | ECC 技能库 |
| `rules` | `id` | `workspace_id`, `name`, `scope`, `scope_value`, `project_id`, `content`, `priority`, `enabled` | ECC 规则引擎 |
| `hooks` | `id` | `workspace_id`, `name`, `event`, `action_type`, `action_config`, `conditions`, `priority`, `enabled` | ECC 事件钩子 |
| `security_rules` | `id` | `workspace_id`, `name`, `pattern`, `severity`, `category`, `enabled` | 安全扫描规则 |
| `security_findings` | `id` | `rule_id`, `task_id`, `file_path`, `line`, `match`, `severity`, `status` | 扫描发现记录 |
| `project_groups` | `id`, `UNIQUE(workspace_id, name)` | `workspace_id`, `name`, `description`, `created_by`, `workflow_id` | 项目组定义 |
| `project_group_members` | `id`, `UNIQUE(group_id, project_id)` | `group_id`, `project_id`, `role`(primary/member), `display_order` | 项目组成员项目 |
| `project_group_user_members` | `id`, `UNIQUE(group_id, user_id)` | `group_id`, `user_id`, `role`(owner/member/viewer) | 项目组用户成员 |

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
{ "type": "task.artifact", "task_id": "...", "session_id": "...", "artifacts": [{"type":"file|link","path|url":"...","name":"..."}], "timestamp": ... }
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

## 10. ECC 企业能力中心（Enterprise Capability Center）

ECC 是 Tide 的 **可扩展能力层**，为 Agent 执行提供企业级治理能力。六大能力（Skills / Rules / Hooks / Security / Cost Tracking / Expert Teams）以统一的 API + Service + DB 三层架构实现，并通过 Prompt 注入和事件驱动与工作流引擎深度集成。

### 10.1 架构总览

```
┌──────────────────────────────────────────────────────────────────────┐
│                        ECC 企业能力中心                               │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌──────────────┐  │
│  │   Skills    │ │    Rules    │ │    Hooks    │ │   Security   │  │
│  │   技能库    │ │  规则引擎   │ │  事件驱动   │ │   安全审查   │  │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └──────┬───────┘  │
│         │               │               │               │           │
│         ▼               ▼               ▼               ▼           │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              Prompt Injection & Event Pipeline               │   │
│  │  Skills → 追加到 system prompt (上下文增强)                   │   │
│  │  Rules  → 注入 prompt 顶部 (强制约束, 优先级最高)             │   │
│  │  Hooks  → 事件触发 → 异步执行动作 (不阻塞主流程)             │   │
│  │  Security → Hook 回调 → 自动扫描 Agent 输出                  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    Cost Tracking 成本追踪                     │   │
│  │  tasks 表扩展字段 → cost_service 定价计算 → Dashboard 展示    │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌──────────────┐    ┌──────────────────┐    ┌──────────────┐
│ workflow_engine│    │    adapters.py    │    │  hook_engine │
│ (技能选择)    │    │ (规则+技能注入)   │    │ (事件分发)   │
└──────────────┘    └──────────────────┘    └──────────────┘
```

#### 能力总览

| 能力 | 说明 | 管理入口 |
|------|------|---------|
| **Skills 技能库** | 可复用知识/指令，以 Markdown 编写，运行时追加到 Agent prompt | Settings → Skills |
| **Rules 规则引擎** | 三层分级强制约束（global/language/project），注入 prompt 顶部 | Settings → Rules |
| **Hooks 事件驱动** | 事件触发 + 条件匹配 → 异步执行动作（不阻塞主流程） | Settings → Hooks |
| **Security 安全审查** | 正则模式匹配扫描引擎，检测密钥/质量/合规问题 | Settings → Security |
| **Cost Tracking 成本追踪** | 多模型定价 + 多维度成本计算与 Dashboard 展示 | Dashboard → Cost |
| **Expert Teams 专家团** | 定义领域专家预设（Agent + Skills + 角色提示词），工作流节点引用后自动展开注入 | Settings → Expert Teams |

### 10.2 六大能力架构设计

#### Skills 技能库

| 层 | 模块 | 职责 |
|----|------|------|
| API | [backend/api/skills.py](backend/api/skills.py) | GET/POST/PUT/DELETE `/api/skills`，支持按 workspace 过滤 |
| Service | [backend/services/skill_service.py](backend/services/skill_service.py) | 技能存储检索、按 slug 批量获取、启用状态管理 |
| DB | `skills` 表 | `id, workspace_id, name, slug, description, category, tags, content, version, enabled, source` |
| 集成 | [workflow_engine.py](backend/services/workflow_engine.py) | `_build_prompt_with_skills()` 将选中技能内容追加到 Agent prompt |
| 前端 | [apps/web/app/settings/skills/page.tsx](apps/web/app/settings/skills/page.tsx) | 管理 UI（列表/创建/编辑/删除/Markdown 预览） |
| 导入 | [import_ecc_skills.py](backend/scripts/import_ecc_skills.py) | 批量导入外部技能文件 |

**数据流**：工作流编辑器 Agent 节点 → PropertyPanel 多选技能 → 运行时 `_build_prompt_with_skills(selected_slugs)` → 技能 Markdown 追加到 system prompt。

#### Rules 规则引擎

| 层 | 模块 | 职责 |
|----|------|------|
| API | [backend/api/rules.py](backend/api/rules.py) | GET/POST/PUT/DELETE `/api/rules`，支持按 scope 过滤 |
| Service | [backend/services/rule_service.py](backend/services/rule_service.py) | **三层分级匹配**：global → language → project |
| DB | `rules` 表 | `id, workspace_id, name, scope, scope_value, project_id, content, priority, enabled, source` |
| 集成 | [adapters.py](backend/runtime/adapters.py) | `_build_prompt_with_rules()` 按 cwd/project_id 匹配规则注入 prompt **顶部**（优先级最高） |
| 前端 | [apps/web/app/settings/rules/page.tsx](apps/web/app/settings/rules/page.tsx) | 管理 UI |

**三层匹配策略**：
1. `global` — 对所有任务生效
2. `language` — 根据工作目录文件扩展名自动推断语言（`.py→python`, `.ts→typescript`, `.go→golang`, `.rs→rust`）
3. `project` — 绑定到特定 `project_id`

**数据流**：Agent 执行前 → `_build_prompt_with_rules(cwd, project_id)` → 按优先级合并匹配规则 → 注入 prompt 顶部作为强制约束。

#### Hooks 事件驱动

| 层 | 模块 | 职责 |
|----|------|------|
| API | [backend/api/hooks.py](backend/api/hooks.py) | GET/POST/PUT/DELETE `/api/hooks` |
| Service | [backend/services/hook_engine.py](backend/services/hook_engine.py) | 事件触发 / 条件匹配 / 动作执行 |
| DB | `hooks` 表 | `id, workspace_id, name, event, action_type, action_config, conditions, priority, enabled` |
| 前端 | [apps/web/app/settings/hooks/page.tsx](apps/web/app/settings/hooks/page.tsx) | 管理 UI |

**支持事件**：`task.created` / `task.status_changed` / `workflow.completed` 等

**支持动作类型**：
| 类型 | 说明 |
|------|------|
| `script` | 脚本执行 |
| `webhook` | HTTP 回调 |
| `notification` | 通知推送 |
| `skill` | 技能调用（如 `security-scan`） |

**执行策略**：异步触发、30 秒超时、失败不阻塞主流程。

#### Security 安全审查

| 层 | 模块 | 职责 |
|----|------|------|
| API | [backend/api/security.py](backend/api/security.py) | POST `/api/security/scan` + 规则 CRUD + Findings 管理 |
| Service | [backend/services/security_scanner.py](backend/services/security_scanner.py) | 正则模式匹配扫描引擎 |
| DB | `security_rules` + `security_findings` 表 | 扫描规则定义 + 发现记录 |
| Hook 集成 | [hook_engine.py](backend/services/hook_engine.py) | `_invoke_skill("security-scan")` 自动在 Agent 输出后触发扫描 |
| 前端 | [apps/web/app/settings/security/page.tsx](apps/web/app/settings/security/page.tsx) | 双 Tab UI（规则管理 + 扫描发现） |
| 导入 | [import_security_rules.py](backend/scripts/import_security_rules.py) | 批量导入预置安全规则 |

**预置规则**：18 个规则覆盖 `secret_detection` / `code_quality` / `compliance` 三大类别。

**数据流**：Agent 输出 → hook_engine 捕获 `task.status_changed` 事件 → 条件匹配 → `_invoke_skill("security-scan")` → `security_scanner` 执行正则扫描 → 写入 `security_findings` 表 → 前端展示。

#### Cost Tracking 成本追踪

| 层 | 模块 | 职责 |
|------|------|------|
| API | [backend/api/dashboard.py](backend/api/dashboard.py) | GET `/api/dashboard/cost-summary` + `/api/dashboard/cost-by-dimension` |
| API | [backend/api/sessions.py](backend/api/sessions.py) | POST `/api/sessions/{session_id}/usage`（Token 上报）+ POST `/api/usage/batch`（批量上报） |
| Service | [backend/services/cost_service.py](backend/services/cost_service.py) | 定价模型 + 成本计算 + `reported_cost_usd` 直报成本支持 |
| Service | [backend/services/session_discovery.py](backend/services/session_discovery.py) | `sync_session_token_usage()` — Qoder/Codex/Claude IDE 会话 token 自动同步（APScheduler 每 5 分钟） |
| 前端 | [packages/views/src/dashboard/CostOverview.tsx](packages/views/src/dashboard/CostOverview.tsx) | 成本概览卡片 |
| DB | `tasks` 表扩展字段 | `token_input, token_output, estimated_cost_usd, synced_message_count` |

**Token 采集三路径**（优先级从高到低）：

| 路径 | 适用 CLI | 数据来源 | 精度 |
|------|----------|----------|------|
| 1. 精确采集 | Claude CLI | CLI `result` 事件中的 `total_cost_usd` + `modelUsage`（含 cache token） | 精确 |
| 2. 通用 JSON 解析 | Codex CLI / 通用 | 流式 stdout JSON 行中 `try_parse_token_usage()` 累计 | 较高 |
| 3. tiktoken 估算 | 所有 CLI（兜底） | 对 prompt 和累积 output 使用 `tiktoken`（cl100k_base）编码计数 | 估算（不含系统 prompt 和工具定义） |

当路径 1 和 2 均未报告有效 token 时，自动降级至 tiktoken 估算路径，日志标记 `token estimated` 以区分。
若 tiktoken 未安装，进一步退化为字符比例粗估（~4 char/token）。

**cost_model 降级策略**：确定成本计算所用的模型名，按 `model 参数 → adapter.default_model → adapter.id` 三级降级。

**定价表 + 模糊匹配**：`MODEL_PRICING` 精确匹配失败时，通过 `keyword_map` 关键词模糊匹配（如 `claude-3-5-sonnet-20241022` → `claude-sonnet`）。

**支持的定价模型**：claude-sonnet / opus / haiku, claude-sonnet-4 / opus-4, gpt-4o / gpt-4o-mini / gpt-5, o3 / o3-mini / o4-mini, codex-mini, qoder

**`reported_cost_usd`**：当 CLI（如 Claude）直接上报精确成本时，`update_task_cost()` 优先使用上报值，不再由定价表计算。

**Token 自动同步机制**：

```
APScheduler (每 5 分钟)
  └─ sync_session_token_usage()
       ├─ 扫描 ~/.codex/ ~/.claude/ ~/.qoder/ 会话文件
       ├─ 增量策略：对比 tasks.synced_message_count 与实际消息数
       ├─ 仅对新增消息 tiktoken 估算 → cost_service.update_task_cost()
       └─ 无关联 task 时自动创建占位任务
```

**Token 上报 API**：外部客户端（如 Qoder IDE 插件）可直接调用 `POST /api/sessions/{session_id}/usage` 主动上报本地 token 消耗，支持累加。批量上报使用 `POST /api/usage/batch`。

**维度聚合**：支持 today / week / month 时间范围，按 agent / model / project 维度分组统计。

### 10.3 看板系统增强（Kanban Enhancements）

看板服务 [kanban_service.py](backend/services/kanban_service.py) 最新扩展：

- **项目看板支持项目组**：卡片区分 `type: "group"` 与 `type: "project"`，项目组卡片展示成员项目列表、统计数据、最近活动。权限过滤时，项目组只要成员项目中任一可访问即可见。
- **工作项看板视图**：`GET /api/kanban/work-items` 支持 `version_id`、`status`、`search`、`assignee`、`group_id` 多维度筛选。
- **移除了 scope 筛选**：看板页面不再提供 scope 过滤器，简化交互。

### 10.4 任务恢复（Task Recovery）

后端服务重启时，[task_service.py](backend/services/task_service.py) 的 `recover_orphaned_tasks()` 在 lifespan 阶段自动执行：

- 扫描 DB 中 `status IN ('running', 'queued')` 的任务（进程已丢失）
- 将它们标记为 `cancelled`，并通过 `event_emitter` 广播状态变更
- `cancelled` 状态任务默认不在前端任务列表中突出展示

### 10.5 工作台展示限制（Dashboard Limits）

Dashboard 前端组件对各模块设置展示上限，避免信息过载：

| 模块 | 限制 |
|------|------|
| 我的工作项 | 最多 4 条 |
| 活跃项目 | 最多 3 个 |
| 项目进度 | 2 个项目组 + 2 个项目 |
| 活跃时间线 | “查看更多”按钮位于标题栏右侧 |

权限规则：`admin` 角色展示所有工作项，其他角色仅展示自己拥有的。

### 10.6 工作流补充（Workflow Enhancements）

ReactFlow 画布事件过滤优化：忽略 `dimensions` 和 `select` 类型的 `onNodesChange` 事件，防止非用户编辑操作（如窗口 resize、节点选中）触发「未保存」(dirty) 状态提示。

### 10.7 扩展机制

#### 添加新技能

1. **Web UI**：Settings → Skills → 创建，填写 name/slug/category/content（Markdown）。
2. **批量导入**：`python3 -m backend.scripts.import_ecc_skills <skills_dir> --workspace default`
3. **工作流绑定**：在工作流编辑器 Agent 节点 PropertyPanel 中勾选所需技能。

#### 添加新规则

1. **Web UI**：Settings → Rules → 创建，选择 scope（global/language/project）并编写规则内容。
2. 规则内容以纯文本/Markdown 编写，运行时自动注入到 Agent prompt 顶部。
3. `priority` 字段控制多规则冲突时的合并顺序（数值越大优先级越高）。

#### 添加新 Hook

1. 定义触发事件（如 `task.status_changed`）。
2. 设置条件（JSON 格式，如 `{"new_status": "completed"}`）。
3. 配置动作（script/webhook/notification/skill）。

#### 添加新安全规则

1. **Web UI**：Settings → Security → Rules Tab → 创建。
2. **批量导入**：`python3 -m backend.scripts.import_security_rules --workspace default`
3. 规则格式：正则模式 + 严重级别 + 类别标签。

### 10.8 专家团管理 (Expert Teams)

#### 设计定位

专家团是 Agent 节点的"快捷预设"——将 Agent 选择、技能配置和角色提示词封装为可复用的领域专家配置。它不引入新的工作流节点类型，而是在现有 Agent 节点中通过 `expert_team_id` 引用，运行时自动展开。

#### 数据模型

```sql
CREATE TABLE expert_teams (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'default',
    project_id TEXT,              -- NULL = 全局专家团
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    agent_id TEXT NOT NULL,       -- "codex"|"claude"|"qoder"|"a2a:{slug}"
    skill_slugs TEXT DEFAULT '[]', -- JSON array of skill slugs
    role_prompt TEXT,             -- 角色系统提示词
    enabled INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(workspace_id, slug)
);
```

#### API 路由

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/expert-teams` | 列出专家团（支持 project_id 过滤，返回全局+项目合并结果） |
| GET | `/api/expert-teams/{id}` | 专家团详情 |
| POST | `/api/expert-teams` | 创建专家团（需 `check_project_config_permission`） |
| PUT | `/api/expert-teams/{id}` | 更新专家团 |
| DELETE | `/api/expert-teams/{id}` | 删除专家团 |

#### Service 层（`backend/services/expert_team_service.py`）

核心方法：
- `list_expert_teams(workspace_id, project_id)` — 列表查询
- `get_expert_teams_for_project(workspace_id, project_id)` — 继承合并（项目覆盖全局同 slug 项）
- `resolve_expert_team(team_id, workspace_id)` — 运行时解析，返回 agent_id + skills 内容 + role_prompt

#### 工作流集成

在 `workflow_engine.py` 的 Agent 节点执行前：
1. 检查 `data.expert_team_id` 是否存在
2. 调用 `resolve_expert_team()` 获取完整配置
3. 覆盖 `agent_id`
4. 合并 `skills`（专家团技能 + 节点手动选择的技能，去重保序）
5. 注入 `role_prompt` 到 prompt 前缀

**Prompt 注入顺序**：`Role Prompt（角色定位）→ Rules（强制约束）→ Skills（参考指南）→ Original Prompt（任务指令）`

#### 前端集成

- 管理页面：`apps/web/app/settings/expert-teams/page.tsx`（CRUD + 项目选择器）
- 工作流编辑器：`PropertyPanel.tsx` 中 Agent 节点属性面板添加专家团选择器

---

## 11. 项目组（Project Groups）

项目组是 Tide 中 **多仓库协作** 的核心抽象。一个项目组把多个关联项目聚合在一起，统一管理成员、聚合对话/任务/版本数据，并支持跨仓库 Plan 自动生成与执行。

### 11.1 架构设计

```
┌─────────────────────────────────────────────────────────────────────┐
│                        项目组 (Project Groups)                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────────────┐ │
│  │  成员项目管理   │  │  用户成员管理   │  │   聚合数据查询         │ │
│  │  (primary /    │  │  (owner /      │  │  对话 / 任务 / 版本    │ │
│  │   member)      │  │   member /     │  │  跨仓库聚合            │ │
│  │                │  │   viewer)      │  │                        │ │
│  └───────┬────────┘  └───────┬────────┘  └───────┬────────────────┘ │
│          │                   │                   │                  │
│          ▼                   ▼                   ▼                  │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              成员自动同步 & 权限过滤                           │   │
│  │  添加用户/项目 → 级联同步 project_members（幂等）              │   │
│  │  非 admin → 只能看到自己有 membership 的项目组                 │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              跨仓库 Plan & 工作流绑定                          │   │
│  │  Plan 指定 group_id → 子任务自动分发到成员项目                 │   │
│  │  项目组绑定工作流 → 触发跨仓库编排                             │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
        │                    │                    │
        ▼                    ▼                    ▼
┌──────────────┐    ┌──────────────────┐    ┌──────────────┐
│ plan_service │    │ project_group_   │    │  前端统一     │
│ (group_id)   │    │ service          │    │  选择器       │
└──────────────┘    └──────────────────┘    └──────────────┘
```

### 11.2 数据模型

| 表 | 主键/唯一 | 关键字段 | 说明 |
|----|----------|---------|------|
| `project_groups` | `id`, `UNIQUE(workspace_id, name)` | `workspace_id`, `name`, `description`, `created_by`, `workflow_id` | 项目组定义 |
| `project_group_members` | `id`, `UNIQUE(group_id, project_id)` | `group_id`, `project_id`, `role`(primary/member), `display_order` | 成员项目关联 |
| `project_group_user_members` | `id`, `UNIQUE(group_id, user_id)` | `group_id`, `user_id`, `role`(owner/member/viewer) | 用户成员 |
| `plans.group_id` | — | Plan 关联的项目组 ID | Plan 创建时可绑定项目组 |
| `tasks.group_id` | — | Task 关联的项目组 ID | 任务所属项目组 |

### 11.3 API 路由

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/project-groups` | GET | 列出项目组（受用户成员权限过滤） |
| `/api/project-groups` | POST | 创建项目组，自动将创建者加为 owner |
| `/api/project-groups/{id}` | GET | 获取项目组详情（含成员列表） |
| `/api/project-groups/{id}` | PUT | 更新项目组（name/description） |
| `/api/project-groups/{id}` | DELETE | 删除项目组（级联删除成员关系） |
| `/api/project-groups/{id}/members` | POST | 添加成员项目（自动同步用户） |
| `/api/project-groups/{id}/members/{project_id}` | DELETE | 移除成员项目 |
| `/api/project-groups/{id}/users` | GET | 列出用户成员（JOIN users） |
| `/api/project-groups/{id}/users` | POST | 添加用户成员（自动同步到项目） |
| `/api/project-groups/{id}/users/{user_id}` | PUT | 修改用户成员角色 |
| `/api/project-groups/{id}/users/{user_id}` | DELETE | 移除用户成员 |
| `/api/project-groups/{id}/conversations` | GET | 聚合组内所有项目的会话 |
| `/api/project-groups/{id}/tasks` | GET | 聚合组内所有项目的任务 |
| `/api/project-groups/{id}/versions` | GET | 聚合组内所有项目的版本 |
| `/api/project-groups/{id}/workflow` | GET/PUT/DELETE | 工作流绑定管理 |

### 11.4 服务层

| 模块 | 职责 |
|------|------|
| [project_group_service.py](backend/services/project_group_service.py) | 项目组 CRUD、成员管理、项目路径聚合、上下文 prompt 生成 |
| [project_groups.py](backend/api/project_groups.py) | API 路由、权限检查、成员自动同步、聚合查询 |

### 11.5 成员自动同步机制

```
添加用户到项目组                    添加项目到项目组
      │                                  │
      ▼                                  ▼
写入 project_group_user_members     写入 project_group_members
      │                                  │
      ▼                                  ▼
遍历组内所有 project_group_members   遍历组内所有 project_group_user_members
      │                                  │
      ▼                                  ▼
INSERT OR IGNORE → project_members  INSERT OR IGNORE → project_members
（幂等，已存在则跳过）               （幂等，已存在则跳过）
```

### 11.6 权限过滤规则

- 未启用 `TIDE_REQUIRE_AUTH` → 不过滤，返回全部项目组。
- 全局 `admin` → 不过滤，返回全部。
- 其他认证用户 → 仅返回其在 `project_group_user_members` 中有记录的项目组。
- 用户成员管理操作（添加/修改/删除）→ 仅全局 admin 或项目组 `owner` 可执行。
- 查看用户列表 → 需为项目组成员（任意角色）。

### 11.7 跨仓库 Plan

- Plan 创建时可指定 `group_id`，子任务可单独指定 `project_id`/`cwd` 覆盖。
- 未指定 `cwd` 时，自动使用项目组 primary 项目的路径。
- Plan 列表支持按 `group_id` 过滤。
- 跨仓库 Plan 自动生成：工作项绑定项目组时，Agent 执行完毕后按 phase 编排依赖（后端 phase=0 并行，前端 phase=1 依赖后端）。

### 11.8 前端统一选择器编码

前端所有创建入口（浮动聊天、独立任务、对话/Session）使用统一选择器：

| 编码格式 | 含义 |
|----------|------|
| `project:{cwd}` | 选择单个项目，值为项目的工作目录路径 |
| `group:{id}` | 选择项目组，值为项目组 ID |

选择项目组时，自动使用 primary 项目的 `cwd` 作为实际执行路径。Session 和 Task 的 `group_id` 字段用于标记其所属项目组。

### 11.9 工作项智能路由

#### 概述

当项目组工作项进入工作流的 Agent 节点时，系统会基于工作项需求和项目知识图谱，通过 LLM 分析推荐合适的目标子项目，避免全量派发造成的资源浪费。

#### 触发条件

智能路由在以下条件同时满足时触发：
1. 工作项关联了项目组（存在 `group_id`）
2. 环境变量 `WORKITEM_SMART_ROUTING=true`
3. 当前 Agent 节点的 `routingTrigger` 配置未显式设为 `false`

#### 两阶段工作流（方案 C）

为提升路由准确度，支持在工作流中配置两阶段 Agent 节点：

```
┌─────────────┐     ┌─────────────────┐     ┌──────────────┐
│  Stage 节点  │ ──▶ │ Agent① 方案生成  │ ──▶ │ Agent② 路由  │ ──▶ ...
│             │     │ routingTrigger   │     │ routingTrigger│
│             │     │ = false          │     │ = true       │
└─────────────┘     └─────────────────┘     └──────────────┘
```

- **Agent① (routingTrigger=false)**：走单仓模式，在主项目 cwd 下生成技术方案，输出保存到 `work_item_transitions.output`
- **Agent② (routingTrigger=true)**：获取前序 Agent 输出（技术方案），结合项目知识图谱做路由决策，然后向选中的子项目派发跨仓库 Plan

#### 路由决策流程

1. 从知识图谱获取项目组各子项目的模块摘要
2. 构建路由 prompt：工作项标题 + 描述 + 前序技术方案（截断至 `ROUTING_PROPOSAL_MAX_CHARS`，默认 3000 字符）
3. 调用 Agent CLI（subprocess 隔离）执行 LLM 分析
4. 解析返回的 JSON 结构获取推荐项目列表和置信度
5. 置信度 ≥ 阈值时采纳推荐结果；否则 fallback 为全量派发

#### 核心服务

| 服务 | 文件 | 职责 |
|------|------|------|
| `GroupRouteService` | `backend/services/group_route_service.py` | LLM 路由分析、prompt 构建、结果解析 |
| `WorkItemService._trigger_group_agent_node()` | `backend/services/work_item_service.py` | 路由触发入口、Plan 派发 |
| `WorkItemService._extract_prev_agent_output()` | `backend/services/work_item_service.py` | 从 workflow context 提取前序 Agent 输出 |

#### 环境变量配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `WORKITEM_SMART_ROUTING` | `true` | 启用/禁用智能路由 |
| `WORKITEM_SMART_ROUTING_TIMEOUT` | `30` | LLM 调用超时（秒）|
| `WORKITEM_SMART_ROUTING_CONFIDENCE` | `0.6` | 置信度阈值 |
| `ROUTING_PROPOSAL_MAX_CHARS` | `3000` | 前序技术方案截断长度 |

#### 工作流节点配置

Agent 节点的 `data` 中新增 `routingTrigger` 布尔字段：
- `true` 或未设置（默认）：执行路由决策
- `false`：跳过路由，走单仓模式（适用于方案生成等前置节点）

向后兼容：旧工作流节点无此字段时保持原有行为（自动路由）。

---

## 12. 工作项 AI 分解 与 浮动聊天产物展示

Tide 在工作项营运与交付现场提供两项面向日常需求的能力：工作项的 AI 自动分解与浮动聊天的产物汇总。

### 12.1 工作项 AI 自动分解

用户在工作项页面点击「AI 分解」后，可输入长文本需求 / PRD / 链接 / 附件，后端调用 LLM 将其拆解为多个合适粒度的工作项草稿，经人工校对后一键批量创建。

```
前端 AIDecomposeDialog（三步）
  ├─ 输入：长文本 / 链接 / 附件（.md/.txt/.docx/.pdf，单文件 10MB）
  ├─ 结果校对：可编辑标题 / 描述 / 优先级 / 估工
  └─ 确认创建 → POST /api/work-items/batch
        │
        ▼
  POST /api/work-items/ai-decompose  (multipart/form-data)
        │  text? / link? / files[]?
        ▼
  ai_decompose_service → httpx 异步调用 LLM
        │  复用 KNOWLEDGE_LLM_BASE_URL / API_KEY / MODEL / PROVIDER
        └─ 返回草稿列表 (title / description / priority / estimate / labels)
```

关键实现点：

- 后端新增两个路由：`POST /api/work-items/ai-decompose`（拆解，multipart/form-data 同时接受文本/链接/文件）、`POST /api/work-items/batch`（批量创建）。
- 服务层 [ai_decompose_service.py](backend/services/ai_decompose_service.py) 封装 LLM 调用，同时兼容 OpenAI Chat Completions 与 Anthropic Messages 两种协议，复用现有 `KNOWLEDGE_LLM_*` 环境变量。
- 附件仅进行临时解析（.md/.txt 直接读取，.docx/.pdf 抽取文本）后载入 prompt，不落盘。
- 前端 `AIDecomposeDialog` 提供「输入 → 结果校对 → 确认创建」三步交互，校对页可编辑/删除/调整顺序。

### 12.2 浮动聊天产物展示

浮动聊天窗口在对话过程中自动汇总 Agent 生成的产物文件（文档 / 代码片段 / 生成链接），支持在线查看与「在新标签页打开」。

```
Agent 子进程输出 / task 完成
  └─ task_runtime 解析 result 中的文件路径与文档链接
        └─ event_emitter 推送 task.artifact
              └─ ws_hub 广播
                    └─ 前端 use-chat hook
                          ├─ 合并进 session.artifacts 状态
                          ├─ ChatArtifactPanel 汇总展示
                          └─ ChatMessageList 在消息底部渲染卡片

GET /api/sessions/{session_id}/artifacts
  └─ 聊天窗口打开 / 刷新时拉取历史产物，作为 WS 推送的冷启动打底
```

关键实现点：

- 后端新增 `GET /api/sessions/{session_id}/artifacts`，聚合本 session 历史 task 的产物，以 `{type, name, path|url, source_task_id, created_at}` 统一返回。
- task 完成时以 `task.artifact` 事件广播增量产物，遵循「WS 只做 invalidation/增量补丁」原则，不作为唯一数据源。
- 前端 `use-chat` hook 同时从消息文本中提取文件链接（如 Markdown 链接、代码块路径）作为补充，与 WS 推送去重后合并。
- `ChatArtifactPanel` 以可折叠面板的形式嵌入聊天窗口 header 下方；`ChatMessageList` 在每条消息底部渲染产物卡片；点击后调起 `/docs/view` 增强后的查看器（支持 JSON / 代码高亮 / 图片预览，并提供「在新标签页打开」快捷入口）。

---

## 13. 知识图谱（Knowledge Graph）

知识图谱为每个仓库自动生成代码结构的可视化文档，支持 **10 类图谱**，通过 Python 静态分析和 Agent 驱动两种路径生成，并配有前端进度指示器实时反馈生成状态。

### 13.1 架构设计

```
┌──────────────────────────────────────────────────────────────────────┐
│                        知识图谱生成流程                                │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  前端 KnowledgeGraphCard（含生成进度指示器）                           │
│  ┌───────────────────────────────────┐                               │
│  │ 选择图谱类型（10 类）+ 分析方式    │                               │
│  │ • 静态分析（Python，全部 10 类）   │  ← 旋转图标 + 进度弹窗        │
│  │ • Agent（Codex/Claude/Qoder）     │                               │
│  └──────────────┬────────────────────┘                               │
│                 │ POST /api/knowledge/{scope}/{id}/generate           │
│                 ▼                                                      │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ knowledge_service.py                                          │    │
│  │  ┌─────────────────────────┐  ┌────────────────────────────┐  │    │
│  │  │ 静态分析路径             │  │ Agent 驱动路径             │  │    │
│  │  │ (无 agent_id)            │  │ (有 agent_id)              │  │    │
│  │  │                          │  │                            │  │    │
│  │  │ gen_knowledge_graph.py   │  │ code_collector 构建上下文  │  │    │
│  │  │ 10 个分析器：            │  │ → 组装 Prompt（10 个模板） │  │    │
│  │  │  Module/Api/Db/Concept/  │  │ → AgentExecutor.run_task() │  │    │
│  │  │  Architecture/TechStack/ │  │ → 读取 Agent 生成的 JSON   │  │    │
│  │  │  CodingStyle/DataFlow/   │  │ → 类型检查 + 渲染降级     │  │    │
│  │  │  TestCoverage/EventBus   │  │                            │  │    │
│  │  └──────────┬───────────────┘  └──────────┬─────────────────┘  │    │
│  │             └──────────┬──────────────────┘                   │    │
│  │                        ▼                                      │    │
│  │         MarkdownRenderer 渲染 .md + 写入 _meta.json           │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                 │                                                      │
│                 ▼                                                      │
│         <repo>/.knowledge/                                            │
│         ├── _meta.json        (版本号、生成时间、git 信息)             │
│         ├── _index.md         (索引页)                                 │
│         ├── module/module_graph.json + .md                            │
│         ├── api/api_graph.json + .md                                  │
│         ├── db/schema_graph.json + .md + er_diagram.md                │
│         ├── concept/concept_graph.json + .md                          │
│         ├── architecture/architecture_graph.json + .md                │
│         ├── tech-stack/tech_stack_graph.json + .md                    │
│         ├── coding-style/coding_style_graph.json + .md                │
│         ├── data-flow/data_flow_graph.json + .md                      │
│         ├── test-coverage/test_coverage_graph.json + .md              │
│         └── event-bus/event_bus_graph.json + .md                      │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 13.2 十类图谱

| 类型 | 标识 | 内容 | 产物 |
|------|------|------|------|
| 模块依赖图 | `module` | import 关系、架构分层、被依赖统计 | `module/module_graph.json` + `.md` |
| API 接口图谱 | `api` | 路由、HTTP 方法、参数、关联 Service | `api/api_graph.json` + `.md` |
| 数据库 Schema | `db` | 表结构、外键、索引、ER 关系图 | `db/schema_graph.json` + `.md` + `er_diagram.md` |
| 业务概念图 | `concept` | 核心实体、关系、领域划分 | `concept/concept_graph.json` + `.md` |
| 系统架构 | `architecture` | 目录结构、层次划分、Docker 配置推断 | `architecture/architecture_graph.json` + `.md` |
| 技术栈 | `tech-stack` | 语言/框架/工具链/依赖推断 | `tech-stack/tech_stack_graph.json` + `.md` |
| 编码风格 | `coding-style` | 命名约定、代码组织、测试实践推断 | `coding-style/coding_style_graph.json` + `.md` |
| 数据流 | `data-flow` | API 路由推断请求链路、actor/action/target | `data-flow/data_flow_graph.json` + `.md` |
| 测试覆盖 | `test-coverage` | 测试文件分析、覆盖率推断 | `test-coverage/test_coverage_graph.json` + `.md` |
| 事件总线 | `event-bus` | WebSocket/EventEmitter 事件机制分析 | `event-bus/event_bus_graph.json` + `.md` |

### 13.3 双路径设计

| 路径 | 触发条件 | 实现 | 适用项目 |
|------|---------|------|----------|
| 静态分析 | `agent_id` 为空 | `gen_knowledge_graph.py` 子进程，Python AST + 文件启发式分析 | Python 项目（全部 10 类） |
| Agent 驱动 | `agent_id` 非空 | `AgentExecutor` + 10 个 Prompt 模板 + `code_collector` 上下文 | 任意语言（全部 10 类） |

**静态分析路径**复用 `scripts/gen_knowledge_graph.py`，内置 10 个分析器：

| 分析器 | 数据来源 | 推断方式 |
|--------|---------|----------|
| `ModuleGraphParser` | Python AST | 解析 import 语句和类/函数符号 |
| `ApiGraphParser` | Python AST | FastAPI 路由装饰器扫描 |
| `DbSchemaParser` | SQL DDL + ORM 模型 | SQLite DDL 解析 + 字段/外键推断 |
| `ConceptGraphParser` | 前三类数据 | 业务概念推导（实体/关系/领域） |
| `ArchitectureAnalyzer` | 目录结构 + Docker 配置 | 系统层次划分、部署架构推断 |
| `TechStackAnalyzer` | package.json / requirements.txt 等 | 语言/框架/工具链推断 |
| `CodingStyleAnalyzer` | 代码文件命名与组织 | 命名约定、代码规范、测试实践推断 |
| `DataFlowAnalyzer` | API 路由定义 | 请求链路 actor → action → target |
| `TestCoverageAnalyzer` | 测试文件扫描 | 覆盖率推断、测试文件分布统计 |
| `EventBusAnalyzer` | WebSocket/EventEmitter 代码 | 事件注册/发射/监听关系分析 |

**Agent 驱动路径**通过 `AgentExecutor` 调用已配置的 Agent CLI（Codex/Claude/Qoder），Agent 在仓库目录下读取代码文件并生成 JSON，服务层读取 JSON 后进行类型检查（确保为 dict），通过 `MarkdownRenderer` 渲染 Markdown 并写入 `_meta.json`。若 JSON 不是 dict 或渲染失败，自动降级使用 Agent 直接生成的 `.md` 文件。

### 13.4 前端进度指示器

知识图谱生成过程中，前端 `KnowledgeGraphCard` 展示实时进度：

- **旋转图标** — 标题旁显示 spinning SVG，附「生成中」文字和 done/total 计数
- **进度弹窗** — 点击图标弹出进度对话框，含进度条、实时日志和错误信息
- **自动弹出** — 点击「立即生成」按钮后自动打开进度窗口
- **状态轮询** — 定时调用 `GET /api/knowledge/{scope}/{id}/status` 获取进度

### 13.5 服务层

| 模块 | 职责 |
|------|------|
| [knowledge_service.py](backend/services/knowledge_service.py) | 图谱文件 CRUD、异步生成任务调度、版本管理、ZIP 导出、Agent JSON 类型检查与渲染降级 |
| [knowledge.py](backend/api/knowledge.py) | REST API 路由、scope 解析（project/group） |
| [KnowledgeGraphCard.tsx](packages/views/src/knowledge/KnowledgeGraphCard.tsx) | 前端图谱文件浏览、Markdown 编辑、Agent 选择器、生成进度指示器 |

### 13.6 版本号管理

每次成功生成后 `_meta.json` 中的 `version` 自动递增。前端 Header 展示当前版本号。任务状态保存在内存（`_jobs` dict），支持进度轮询。

### 13.7 API 路由

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/knowledge/{scope}/{id}/files` | GET | 列出 `.knowledge/` 全部文件 |
| `/api/knowledge/{scope}/{id}/file` | GET | 读取单个文件内容 |
| `/api/knowledge/{scope}/{id}/file` | PUT | 保存 Markdown 编辑 |
| `/api/knowledge/{scope}/{id}/file` | DELETE | 删除文件 |
| `/api/knowledge/{scope}/{id}/status` | GET | 查询生成任务状态（含 done/total 进度） |
| `/api/knowledge/{scope}/{id}/generate` | POST | 触发生成（参数：`graph_type`, `agent_id`） |
| `/api/knowledge/{scope}/{id}/export` | GET | ZIP 导出 `.knowledge/` 目录 |

`graph_type` 可选值：`all` / `module` / `api` / `db` / `concept` / `architecture` / `tech-stack` / `coding-style` / `data-flow` / `test-coverage` / `event-bus`（共 11 个，含 all）。

### 13.8 Prompt 模板

Agent 驱动路径使用 `scripts/llm_analyzer.py` 中的 10 个 Prompt 模板：

| 模板 | 用途 | 格式化变量 |
|------|------|----------|
| `MODULE_ANALYSIS_PROMPT` | 模块依赖分析 | `{repo_info}` |
| `API_ANALYSIS_PROMPT` | API 接口分析 | `{repo_info}` |
| `SCHEMA_ANALYSIS_PROMPT` | 数据库 Schema 分析 | `{repo_info}` |
| `ARCHITECTURE_ANALYSIS_PROMPT` | 系统架构分析 | `{repo_info}` |
| `TECH_STACK_ANALYSIS_PROMPT` | 技术栈分析 | `{repo_info}` |
| `CODING_STYLE_ANALYSIS_PROMPT` | 编码风格分析 | `{repo_info}` |
| `DATA_FLOW_ANALYSIS_PROMPT` | 数据流分析 | `{repo_info}` |
| `TEST_COVERAGE_ANALYSIS_PROMPT` | 测试覆盖分析 | `{repo_info}` |
| `EVENT_BUS_ANALYSIS_PROMPT` | 事件总线分析 | `{repo_info}` |
| `CONCEPT_ANALYSIS_PROMPT` | 业务概念推导 | `{module_graph}`, `{api_graph}`, `{schema_graph}` |

仓库上下文由 `scripts/code_collector.py` 的 `build_repo_context()` 构建（语言检测 + 文件树 + 关键文件内容截断）。

---

## 14. 代码查看编辑器、Git 审计与冲突解决

### 14.1 代码查看编辑器

独立页面 `/projects/[id]/files`，提供仓库级代码浏览与编辑能力：

- **文件树浏览** — 左侧目录树，支持展开/折叠、文件名搜索
- **Monaco Editor 多标签** — 同时打开多个文件，标签页切换
- **主题切换** — 白底/黑底两种主题
- **全屏模式** — 沉浸式编辑
- **Ctrl+S 保存** — 快捷键直接写回文件

**后端 API**：

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/files/tree` | GET | 获取文件树结构 |
| `/api/files/content` | GET/PUT | 读取/写入文件内容 |

### 14.2 Git 审计信息展示

独立页面 `/projects/[id]/audit`，提供四个维度的 Git 变更审计：

| Tab | 功能 | 筛选能力 |
|-----|------|----------|
| 按提交 | 提交列表 + 点击查看 diff | 分支、工作项、时间范围 |
| 按文件 | 文件粒度变更统计 | 分支、工作项、时间范围 |
| 按工作项 | 工作项关联的变更汇总 | 时间范围 |
| 按会话 | 会话关联的 commit + diff | 时间范围 |

**核心交互**：

- 时间范围筛选：今天 / 最近3天 / 7天 / 30天 / 全部
- 未提交变更展示：支持提交、撤销、忽略操作
- Diff 查看：左右分栏模式（文件列表 + diff 内容）
- DiffViewer：支持 Inline/Side-by-side 切换、全屏、文件目录可折叠/展开

**后端 API**：

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/projects/{id}/git/commits` | GET | 提交列表（支持分支/工作项/时间筛选） |
| `/api/projects/{id}/git/changes` | GET | 变更分组统计（按分支/工作项/会话） |
| `/api/projects/{id}/git/diff` | GET | 获取 diff 内容 |
| `/api/projects/{id}/git/branches` | GET | 分支列表 |
| `/api/projects/{id}/git/uncommitted` | GET | 未提交变更列表 |
| `/api/projects/{id}/git/commit` | POST | 提交文件 |
| `/api/projects/{id}/git/discard` | POST | 撤销修改 |
| `/api/projects/{id}/git/ignore` | POST | 忽略文件 |

**数据源**：

直接调用 `git log` / `git diff` 命令，基于项目 `root` 路径执行。支持通过 commit message 中的 `[task:xxx]` / `[session:xxx]` 标记关联到 Tide 实体，实现按工作项/会话维度的变更聚合。

**权限过滤**：

- 项目级查看需具备项目成员权限
- Session 维度聚合按用户过滤（仅显示该用户的 git 提交）

### 14.3 合并冲突解决 UI

与工作流 `git_merge` 节点集成，提供可视化冲突解决能力：

- **冲突文件列表** — 展示所有冲突文件及状态
- **三方 diff 查看** — base / ours / theirs 对比
- **规则化解决** — 保留源分支 / 保留目标分支 / 手动编辑
- **AI 智能解决** — Agent + 规则混合模式，自动分析并解决冲突

**后端 API**：

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/files/diff` | GET | 获取文件 diff |
| `/api/files/conflict-detail` | GET | 获取冲突详情（base/ours/theirs） |
| `/api/files/resolve-conflict` | POST | 规则化解决冲突 |
| `/api/files/ai-resolve-conflict` | POST | AI 智能解决冲突 |

### 14.4 会话发现增强

会话发现服务 [session_discovery.py](backend/services/session_discovery.py) 支持多源合成：

- **Qoder IDE 客户端** — 扫描 `~/.qoder/cache/projects/` 目录
- **Codex CLI** — 解析 Codex 会话文件
- **精确路径匹配** — 以项目工作目录为准，移除宽泛内容匹配
- **DB + 文件系统去重** — 数据库 conversations 表与文件系统合成，按 session_id 去重

### 14.5 数据流：Git 审计

```
浏览器 (/projects/[id]/audit)          FastAPI                  Git CLI
  │  选择 Tab / 筛选条件         │                          │
  │ ───────────────────────► │ GET /git/commits          │
  │                          │   ?branch=&since=&work_item= │
  │                          │ ──────────────────────► │ git log --format
  │                          │ ◄────────────────────── │ 解析结果
  │  JSON commits[]          │                          │
  │ ◄─────────────────────── │                          │
  │                          │                          │
  │  点击 commit 查看 diff    │ GET /git/diff?commit=     │
  │ ───────────────────────► │ ──────────────────────► │ git diff / git show
  │  diff content             │ ◄────────────────────── │
  │ ◄─────────────────────── │                          │
  │                          │                          │
  │  未提交变更操作           │ POST /git/commit          │
  │  (提交/撤销/忽略)       │ POST /git/discard          │
  │ ───────────────────────► │ ──────────────────────► │ git add + commit / checkout
  │  操作结果               │ ◄────────────────────── │
  │ ◄─────────────────────── │                          │
```

---

## 15. A2A Bridge 远程 Agent

支持通过 A2A（Agent-to-Agent）协议在远程服务器部署 Agent CLI，实现多进程扩展和跨机器执行。

### 15.1 架构

```
Tide Backend ←→ A2A Client ←→ HTTP/SSE ←→ A2A Bridge ←→ Agent CLI
     │                                         │
     └── task 状态同步                          └── Git 自动同步
```

### 15.2 Bridge 核心模块（`a2a-bridge/`）

| 模块 | 职责 |
|------|------|
| [main.py](a2a-bridge/main.py) | FastAPI 入口 + JSON-RPC 2.0 路由 |
| [executor.py](a2a-bridge/executor.py) | CLI 子进程执行器 + 生命周期管理 |
| [git_manager.py](a2a-bridge/git_manager.py) | Git worktree 管理（fetch/checkout/push） |
| [agent_card.py](a2a-bridge/agent_card.py) | Agent Card 自描述（能力声明） |
| [event_parser.py](a2a-bridge/event_parser.py) | CLI stream-json 输出解析 |

### 15.3 执行时序

1. Tide 创建任务 → A2A Client 发送 `tasks/send` RPC
2. Bridge 接收 → git fetch + checkout task branch
3. Bridge 启动 CLI → SSE 流式返回执行事件
4. CLI 完成 → Bridge auto commit + push
5. Tide 接收完成事件 → 更新任务状态

### 15.4 与本地 Agent 对比

| 维度 | 本地 Agent | 远程 Agent (A2A) |
|------|-----------|------------------|
| 代码获取 | 直接访问本地 worktree | Bridge git fetch + checkout |
| 隔离方式 | git worktree add | 独立 task branch |
| 变更回传 | 本地 commit | Bridge auto push |
| 并发控制 | 单进程受限 | 多 Pod 独立扩缩容 |

### 15.5 集成层

| 模块 | 职责 |
|------|------|
| [backend/runtime/a2a_client.py](backend/runtime/a2a_client.py) | A2A 客户端封装，JSON-RPC 调用 + SSE 流接收 |
| [backend/runtime/adapters.py](backend/runtime/adapters.py) | `A2AAdapter` 统一适配，与本地 Agent 共享接口 |
| [backend/api/remote_agents.py](backend/api/remote_agents.py) | 远程 Agent 管理 API（注册/列表/健康检查） |
| [backend/services/a2a_discovery.py](backend/services/a2a_discovery.py) | 服务发现与健康检查（定期心跳 + Agent Card 拉取） |

---

## 16. 部署架构

### 16.1 开发环境

```bash
# 后端（含 Lark Listener / Scheduler / WS Hub）
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000

# 前端（端口被占用时自动 3001/3002 …）
cd apps/web && yarn dev
```

### 16.2 生产部署

单进程后端 + 静态前端最小化部署：

```
docker-compose.yml
  ├── api          (FastAPI, uvicorn workers=1, 端口 8000)
  ├── web          (Next.js standalone build, 端口 3000)
  └── data         (持久化卷: tide.db, .tide/)
```

不依赖 Redis、PostgreSQL；如有水平扩展需求，可将 SQLite 替换为 PostgreSQL 并将 ws_hub 升级为 Pub/Sub。

---

## 17. 设计原则回顾

1. **不重造 Agent 运行时** — 复用 `AGENT_ADAPTERS`（codex/claude/qoder），后端只做控制面。
2. **Polymorphic Actor** — `actor_type + actor_id` 统一人和 Agent，避免特殊端点。
3. **WebSocket 事件只做 Cache Invalidation** — 不直接写 Store，避免状态分裂。
4. **不依赖 Redis** — 单节点自托管只需 SQLite + 进程内 Hub。
5. **每步持久化** — 节点状态实时写 DB，crash-safe。
6. **双入口并存** — Web 是第一入口，Lark Bridge 保留为辅助通道；缺凭据自动降级。

---

## 18. 分支流转机制

### 18.1 概述

Tide 工作流系统通过 Git Worktree 实现代码隔离，确保不同 Agent 任务在独立分支上工作，最终通过 Git Merge 节点合入目标分支。

### 18.2 工作区隔离（useWorktree）

Agent 节点支持 `useWorktree` 配置（默认 `true`），决定 Agent 的工作方式：

| 配置 | 工作目录 | 工作分支 | branch_name | 自动提交 |
|------|---------|---------|-------------|----------|
| `useWorktree=true` | `.tide/worktrees/wi-{id[:8]}` | `tide/wi-{id[:8]}` | 有值 | ✓ 任务完成后自动 commit |
| `useWorktree=false` | 项目根目录 | 当前 HEAD 分支 | NULL | ✗ 不自动提交 |

#### 启用隔离（默认）

- 创建独立 worktree 和分支
- Agent 所有改动在隔离分支上
- 任务完成后自动 `git add -A && git commit`
- 分支信息持久化到 `tasks.branch_name`，供下游 Git Merge 使用

#### 未启用隔离

- Agent 直接在项目主分支（当前 HEAD）上工作
- 不创建 worktree/分支，不自动提交
- `tasks.branch_name = NULL`
- Git Merge 节点无法识别该任务的分支

### 18.3 Plan 任务的分支

Plan 任务始终创建独立 worktree：

- 路径：`.tide/worktrees/{plan_id}-{task_id}`
- 分支：`tide/{plan_id}-{task_id}`
- Plan 完成后通过 cherry-pick 合并到主分支
- Plan 的 worktree 留存（需手动清理）

### 18.4 Git Merge 节点

#### 源分支解析（sourceBranch）

按优先级查找：

1. 从 `work_item_transitions` 表查询最近一个 `branch_name` 不为空的关联任务
2. 节点配置的 `sourceBranch` 手动值
3. Fallback：`tide/wi-{工作项ID[:8]}`（工作项默认分支名）

#### 目标分支（targetBranch）

- 未配置时默认为 `tide/wi-{工作项ID[:8]}`（工作项分支）
- **建议显式配置为 `main` 或其他目标分支**，避免自合并

#### 合并后清理

合并成功后自动执行：

- `git worktree remove --force`
- `git branch -D`（如果配置了 deleteSource）

### 18.5 推荐配置

#### ✅ 推荐：方案输出 + 代码执行分离

```
agent1(useWorktree=false, 仅输出方案文本)
  → agent2(useWorktree=true 或 Plan, 写代码)
  → git_merge(targetBranch=main)
```

- 方案 Agent 无需隔离（不修改代码文件）
- 代码 Agent 在隔离分支工作
- Git Merge 显式指定合入 main

#### ✅ 推荐：全隔离模式

```
agent1(useWorktree=true)
  → agent2(useWorktree=true)
  → git_merge(targetBranch=main)
```

#### ⚠️ 避免：全无隔离 + 无配置

```
agent1(useWorktree=false)
  → agent2(useWorktree=false)
  → git_merge(未配置)
```

所有改动在主分支，git_merge 无法找到源分支，会失败。

### 18.6 常见场景分析

| 场景 | agent1 | agent2 | git_merge 行为 |
|------|--------|--------|---------------|
| 项目组 + 方案(隔离) + Plan | 有分支 | Plan 独立分支 | Plan分支 → 工作项分支 ✅ |
| 项目组 + 方案(无隔离) + Plan | NULL | Plan 独立分支 | Plan分支 → fallback分支 ⚠️ |
| 项目 + 双无隔离 | NULL | NULL | 无源分支，失败 ❌ |
| 项目 + 方案(隔离) + 代码(无隔离) | 有分支 | NULL | 自合并（源=目标）⚠️ |
| 项目 + 方案(无隔离) + 代码(隔离) | NULL | 有分支 | 自合并（源=目标）⚠️ |
