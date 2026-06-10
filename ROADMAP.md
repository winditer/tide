# Tide Web 工作台 — 实施路线图

> 版本：v1.0 | 更新日期：2026-06-05
> 状态：**P1-P10 已完成，P11-P12 规划中**

---

## 阶段总览

| Phase | 名称 | 天数 | 状态 | 核心交付 |
|-------|------|------|------|---------|
| P1 | 项目骨架 | 2 | ✅ 完成 | Next.js + FastAPI + SQLite + WS |
| P2 | 任务 CRUD + Agent 执行 | 3 | ✅ 完成 | 任务创建/列表/详情/执行/停止 |
| P3 | WebSocket 实时推送 | 2 | ✅ 完成 | 状态变更 + 输出流实时广播 |
| P4 | Dashboard 工作台 | 3 | ✅ 完成 | 首页统计 + 快捷输入 + 项目面板 |
| P5 | Plan DAG 视图 | 4 | ✅ 完成 | React Flow DAG + 分文件 Diff |
| P6 | Kanban 四维看板 | 4 | ✅ 完成 | 项目/会话/Agent/工作流看板 |
| P7 | Schedule 定时调度 | 3 | ✅ 完成 | APScheduler + 管理 UI |
| P8 | Workflow 引擎 | 5 | ✅ 完成 | DAG 执行引擎 + YAML 解析 |
| P9 | Workflow 可视化编辑器 | 5 | ✅ 完成 | React Flow 编辑器 + 属性面板 |
| P10 | Lark 双通道联动 | 3 | ✅ 完成 | Web ↔ Lark 状态同步 |
| P11 | 认证与权限 | 3 | ⬜ 未开始 | JWT + 工作空间隔离 |
| P12 | 部署与打包 | 2 | ⬜ 未开始 | Docker Compose + Self-host |

**总计：39 人天**

---

## Phase 1：项目骨架（2 天）

**状态**：✅ 已完成

### 任务清单

| # | 任务 | 状态 | 说明 |
|---|------|------|------|
| 1.1 | 初始化 Next.js 项目 | ✅ | Next.js 15 App Router + TypeScript + Tailwind |
| 1.2 | 配置 Yarn workspaces monorepo | ✅ | packages/core, packages/ui, packages/views |
| 1.3 | 安装基础 UI 组件 | ✅ | Button, Card, Badge, Input, Select 等 |
| 1.4 | 初始化 FastAPI 项目 | ✅ | 目录结构：api/, services/, models/, db/ |
| 1.5 | 配置 SQLite + SQLAlchemy | ✅ | 异步引擎，创建 actors/workspaces/tasks 表 |
| 1.6 | 实现 DB migration 脚本 | ✅ | Alembic 或手写 SQL init |
| 1.7 | 实现 FastAPI WebSocket Hub | ✅ | 进程内连接管理，支持 subscribe/broadcast |
| 1.8 | 前端 WebSocket Provider | ✅ | React Context + auto-reconnect |
| 1.9 | 前端 API client + React Query | ✅ | 统一 api/ 目录，TanStack Query 配置 |
| 1.10 | 端到端验证 | ✅ | 前端发 API → 后端写 SQLite → WS 推送 → 前端更新 |

### 目录结构

```
tide/
├── apps/
│   └── web/                    # Next.js App Router
│       ├── app/
│       │   ├── layout.tsx
│       │   ├── page.tsx        # Dashboard
│       │   ├── tasks/
│       │   ├── plans/
│       │   ├── kanban/
│       │   ├── workflows/
│       │   └── schedules/
│       └── ...
├── packages/
│   ├── core/                   # Headless 逻辑
│   │   ├── stores/             # Zustand
│   │   ├── hooks/              # React Query
│   │   ├── api/                # API client
│   │   └── types/              # TypeScript 类型
│   ├── ui/                     # 基础 UI 原子组件
│   └── views/                  # 业务组件
├── backend/
│   ├── main.py                 # FastAPI 入口
│   ├── api/                    # 路由
│   │   ├── tasks.py
│   │   ├── plans.py
│   │   ├── kanban.py
│   │   ├── workflows.py
│   │   └── schedules.py
│   ├── services/               # 业务逻辑
│   │   ├── task_service.py
│   │   ├── plan_service.py
│   │   ├── kanban_service.py
│   │   ├── workflow_engine.py
│   │   └── schedule_service.py
│   ├── models/                 # SQLAlchemy 模型
│   ├── db/                     # 数据库配置 + migration
│   └── ws/                     # WebSocket Hub
├── tide_ws.py                  # 现有 Lark Bridge（保留）
└── ...
```

### 交付物

- [x] 前后端均可启动
- [x] API 调用可写入 SQLite
- [x] WebSocket 推送前端可接收
- [x] monorepo 三层分离结构就绪

---

## Phase 2：任务 CRUD + Agent 执行（3 天）

**状态**：✅ 已完成

### 目标

实现核心任务管理，将现有 `CodexTaskRuntime` 桥接到 Web API。

### 任务清单

| # | 任务 | 状态 | 说明 |
|---|------|------|------|
| 2.1 | 实现 TaskService | ✅ | 复用 AGENT_ADAPTERS，创建/停止/审批 |
| 2.2 | 任务 API 路由 | ✅ | CRUD + approve/reject/stop/retry |
| 2.3 | 任务列表页 | ✅ | 筛选 + 分页 + 状态标签 |
| 2.4 | 任务详情页 | ✅ | prompt、输出、审批面板 |
| 2.5 | 任务创建表单 | ✅ | Agent 选择、模型选择、附件上传 |
| 2.6 | Agent 运行时状态 API | ✅ | 检测可用 CLI + 当前运行数 |
| 2.7 | 审批流程 Web 版 | ✅ | 审批面板 + 批准/拒绝操作 |
| 2.8 | 任务事件写入 task_events | ✅ | 所有状态变更记录事件日志 |

### 核心桥接逻辑

```python
# backend/services/task_service.py

class TaskService:
    """桥接现有 AGENT_ADAPTERS 到 Web API"""

    def __init__(self):
        # 直接导入 tide_ws.py 中的运行时
        from tide_ws import AGENT_ADAPTERS, TASKS, SESSION_RUN_LOCKS
        self.agent_adapters = AGENT_ADAPTERS
        self.running_tasks = TASKS

    async def create_task(self, prompt, agent_id=None, model=None, cwd=None):
        # 1. 写入 tasks 表
        # 2. 创建 CodexTaskRuntime（复用现有类）
        # 3. 启动 Agent 线程
        # 4. 写入 task_events
        # 5. WS 广播 task.created
```

### 交付物

- [x] Web 可创建 Agent 任务并查看实时输出
- [x] 审批可在 Web 端操作
- [x] 任务列表支持筛选和分页

---

## Phase 3：WebSocket 实时推送（2 天）

**状态**：✅ 已完成

### 目标

所有任务/Plan/工作流状态变更通过 WebSocket 实时推送前端。

### 任务清单

| # | 任务 | 状态 | 说明 |
|---|------|------|------|
| 3.1 | WebSocket Hub 完善 | ✅ | subscribe channel、broadcast、heartbeat |
| 3.2 | 事件发射器集成 | ✅ | TaskService/PlanService 状态变更 → WS 广播 |
| 3.3 | 前端 WS → Query invalidation | ✅ | 收到事件后 invalidate 对应 query key |
| 3.4 | 任务输出 SSE 流 | ✅ | GET /api/tasks/{id}/output (SSE) |
| 3.5 | 连接状态指示器 | ✅ | Header 显示 WS 连接状态 |
| 3.6 | 重连与消息补偿 | ✅ | 断线重连后拉取缺失事件 |

### WebSocket 事件分类

```typescript
// 前端 WS 事件处理器
function handleWsEvent(event: WsEvent) {
  switch (event.type) {
    case 'task.status_changed':
    case 'task.output':
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['task', event.task_id] });
      break;
    case 'plan.task.started':
    case 'plan.task.completed':
      queryClient.invalidateQueries({ queryKey: ['plan', event.plan_id] });
      break;
    case 'workflow.node.started':
    case 'workflow.node.completed':
      queryClient.invalidateQueries({ queryKey: ['workflow-run', event.run_id] });
      break;
    case 'approval.requested':
    case 'approval.resolved':
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      break;
  }
}
```

### 交付物

- [x] 任务状态变更毫秒级同步到前端
- [x] Plan/工作流状态实时更新
- [x] 断线重连后不丢事件

---

## Phase 4：Dashboard 工作台（3 天）

**状态**：✅ 已完成

### 目标

实现首页 Dashboard，复刻 Lark `/panel`、`/status`、`/daily` 的 Web 版。

### 任务清单

| # | 任务 | 状态 | 说明 |
|---|------|------|------|
| 4.1 | 统计卡片组件 | ✅ | 运行中/排队中/待审批/今日完成 |
| 4.2 | 最近任务列表 | ✅ | 实时更新，支持快捷操作 |
| 4.3 | Agent 状态面板 | ✅ | 每个 Agent 的运行数/空闲状态 |
| 4.4 | 快捷输入栏 | ✅ | 输入指令 + Agent 选择 + 执行 |
| 4.5 | 项目列表页 | ✅ | 复刻 `/projects`，支持归档 |
| 4.6 | 会话列表页 | ✅ | 复刻 `/convos`，支持续写 |
| 4.7 | 日报页面 | ✅ | 复刻 `/daily`，图表增强 |
| 4.8 | 全局布局 + 侧边导航 | ✅ | 响应式，移动端适配 |

### 交付物

- [x] Dashboard 首页完整可用
- [x] 项目/对话管理功能齐备
- [x] 日报页面图表化展示

---

## Phase 5：Plan DAG 视图（4 天） ✅

**状态**：✅ 已完成

### 目标

Plan 功能 Web 端增强：DAG 可视化、时间线、分文件 Diff。

### 任务清单

| # | 任务 | 状态 | 说明 |
|---|------|------|------|
| 5.1 | Plan 列表页 | ⬜ | 所有 Plan 状态总览 |
| 5.2 | React Flow DAG 组件 | ⬜ | 自定义节点（颜色=状态）、边（依赖） |
| 5.3 | DAG 自动布局 | ⬜ | ELK.js 层次布局算法 |
| 5.4 | 阶段泳道可视化 | ⬜ | 同阶段节点用虚线框分组 |
| 5.5 | 节点点击 → 侧滑详情 | ⬜ | prompt、输出、diff、审批 |
| 5.6 | Gantt 时间线 | ⬜ | 子任务执行耗时可视化 |
| 5.7 | 分文件 Diff 视图 | ⬜ | Monaco Editor diff 模式 + 文件树 |
| 5.8 | Plan 操作 UI | ⬜ | 停止/重试/合并/清理 |
| 5.9 | Plan 创建增强 | ⬜ | Web 端输入任务清单，预览 DAG |

### 节点颜色规范

```
queued     → slate (#94a3b8)
running    → blue  (#3b82f6) + pulse 动画
review     → amber (#f59e0b)
approved   → green (#22c55e)
completed  → emerald (#10b981)
failed     → red   (#ef4444)
stopped    → gray  (#6b7280)
cancelled  → light gray (#9ca3af)
```

### 交付物

- [x] Plan DAG 可视化渲染
- [x] 分文件 Diff 查看
- [x] Gantt 时间线
- [x] Web 端创建和操作 Plan

---

## Phase 6：Kanban 四维看板（4 天） ✅

**状态**：✅ 已完成

### 目标

实现项目/会话/Agent/工作流四维看板，支持拖拽和实时更新。

### 任务清单

| # | 任务 | 状态 | 说明 |
|---|------|------|------|
| 6.1 | Kanban 通用组件 | ⬜ | 拖拽看板（@hello-pangea/dnd） |
| 6.2 | 项目看板 | ⬜ | 活跃/待审批/已完成/已归档 |
| 6.3 | 会话看板 | ⬜ | 按项目分组，按状态分列 |
| 6.4 | Agent 看板 | ⬜ | 泳道式，每 Agent 一行 |
| 6.5 | 工作流任务看板 | ⬜ | 工作流节点按状态分列 |
| 6.6 | 筛选与分组 | ⬜ | 按项目/Agent/状态/日期/标签 |
| 6.7 | 视图切换 | ⬜ | Board / List / Timeline |
| 6.8 | 拖拽状态变更 | ⬜ | 拖拽卡片 → 更新状态 → WS 广播 |
| 6.9 | 卡片详情侧滑 | ⬜ | prompt、输出、审批面板 |

### 交付物

- [x] 四种看板视图完整可用
- [x] 拖拽交互流畅
- [x] 筛选和视图切换正常

---

## Phase 7：Schedule 定时调度（3 天） ✅

**状态**：✅ 已完成

### 目标

实现通用定时任务调度，支持 Cron/Interval/Date 触发器。

### 任务清单

| # | 任务 | 状态 | 说明 |
|---|------|------|------|
| 7.1 | APScheduler 集成 | ⬜ | AsyncIOScheduler + SQLAlchemyJobStore (SQLite) |
| 7.2 | ScheduleService 实现 | ⬜ | CRUD + 启停 + 手动触发 |
| 7.3 | Schedule API 路由 | ⬜ | RESTful CRUD + toggle + trigger + runs |
| 7.4 | 执行回调集成 | ⬜ | 定时触发 → TaskService/PlanService |
| 7.5 | Schedule 列表页 | ⬜ | 名称/触发类型/下次运行/启停开关 |
| 7.6 | Schedule 创建/编辑表单 | ⬜ | Cron 可视化编辑器 + Agent/Plan 选择 |
| 7.7 | 执行历史页 | ⬜ | 每次触发的结果和日志 |
| 7.8 | WS 事件广播 | ⬜ | schedule.run.started / schedule.run.completed |

### 交付物

- [x] Cron/Interval/Date 三种触发器可用
- [x] 定时创建 Agent 任务 / Plan
- [x] 管理 UI 完整

---

## Phase 8：Workflow 引擎（5 天） ✅

**状态**：✅ 已完成

### 目标

实现多 Agent 协作 DAG 工作流执行引擎。

### 任务清单

| # | 任务 | 状态 | 说明 |
|---|------|------|------|
| 8.1 | WorkflowService 实现 | ⬜ | CRUD + 版本管理 |
| 8.2 | WorkflowEngine 核心 | ⬜ | DAG 解析、节点调度、上下文传递 |
| 8.3 | Agent 节点执行 | ⬜ | 创建 TaskService 任务 + 模板渲染 |
| 8.4 | 审批节点执行 | ⬜ | 等待审批 + Lark 通知 |
| 8.5 | 条件分支评估 | ⬜ | 解析条件表达式，选择分支 |
| 8.6 | 并行网关 | ⬜ | fork 并行 + join 汇聚 |
| 8.7 | 延时节点 | ⬜ | asyncio.sleep |
| 8.8 | 失败策略 | ⬜ | retry / skip / abort / fallback |
| 8.9 | 上下文传递机制 | ⬜ | {{context.node_id.output}} 模板渲染 |
| 8.10 | WorkflowRun 持久化 | ⬜ | 每步状态写 DB，crash-safe |
| 8.11 | Workflow API 路由 | ⬜ | CRUD + run + cancel + approve/reject |
| 8.12 | YAML 定义解析 | ⬜ | 兼容 Microsoft Conductor 格式 |
| 8.13 | WS 事件广播 | ⬜ | workflow.node.started / completed |

### 执行流程

```
start_run(workflow_id, input)
  → 解析 DAG
  → 执行 start 下游
  → Agent 节点 → TaskService.create_task()
  → on_task_completed() → 继续下游
  → 审批节点 → 等待
  → on_approval_resolved() → 继续下游
  → 条件节点 → 评估 → 选择分支
  → 并行网关 → 同时执行所有下游
  → join → 等所有上游完成
  → end → 标记完成
```

### 交付物

- [x] 工作流可通过 API 创建和执行
- [x] Agent/审批/条件/并行/延时节点全部可用
- [x] YAML 定义可解析执行
- [x] crash-safe 持久化

---

## Phase 9：Workflow 可视化编辑器（5 天） ✅

**状态**：✅ 已完成

### 目标

实现基于 React Flow 的拖拽式工作流可视化编辑器。

### 任务清单

| # | 任务 | 状态 | 说明 |
|---|------|------|------|
| 9.1 | React Flow 基础画布 | ⬜ | 节点 + 连线 + 缩放 + 平移 |
| 9.2 | 自定义节点组件 | ⬜ | start/end/agent/approval/condition/parallel/delay |
| 9.3 | 左侧节点面板 | ⬜ | 拖拽添加节点 |
| 9.4 | 右侧属性面板 | ⬜ | 编辑节点属性（Agent、prompt、model） |
| 9.5 | 连线交互 | ⬜ | 拖拽连线 + 条件标签 |
| 9.6 | 自动布局 (ELK.js) | ⬜ | 一键自动排列 |
| 9.7 | 定义导入/导出 | ⬜ | JSON ↔ React Flow 双向同步 |
| 9.8 | YAML 导入/导出 | ⬜ | YAML ↔ JSON 转换 |
| 9.9 | 运行时视图 | ⬜ | 节点颜色随状态变化，边动画 |
| 9.10 | 运行历史 + 详情 | ⬜ | 查看每次运行的节点状态和输出 |
| 9.11 | 保存/版本管理 | ⬜ | 保存定义、版本号自增 |

### 交付物

- [x] 拖拽式工作流编辑器完整可用
- [x] 运行时可视化（节点着色 + 边动画）
- [x] YAML/JSON 导入导出

---

## Phase 10：Lark 双通道联动（3 天） ✅

**状态**：✅ 已完成

### 目标

实现 Web 和 Lark 双入口状态同步，用户可从任一入口操作。

### 任务清单

| # | 任务 | 状态 | 说明 |
|---|------|------|------|
| 10.1 | Lark Bridge 写 SQLite 适配 | ⬜ | 现有 tide_ws.py 状态变更加 SQLite 写入 |
| 10.2 | Web 操作 → Lark 卡片刷新 | ⬜ | Web 审批/停止 → Lark 卡片更新 |
| 10.3 | Lark 卡片回调 → Web 刷新 | ⬜ | Lark 审批/停止 → WS 广播 |
| 10.4 | 双通道任务列表 | ⬜ | 任务详情展示来源（Web/Lark） |
| 10.5 | 附件同步 | ⬜ | Lark 附件可在 Web 查看 |
| 10.6 | 日报双端推送 | ⬜ | Web 日报页 + Lark 定时推送 |

### 交付物

- [x] Web 和 Lark 状态完全一致
- [x] 任一端操作另一端自动同步

---

## Phase 11：认证与权限（3 天）

**状态**：⬜ 未开始

### 目标

实现用户认证和工作空间级权限隔离。

### 任务清单

| # | 任务 | 状态 | 说明 |
|---|------|------|------|
| 11.1 | JWT 认证 | ⬜ | 注册/登录/token 刷新 |
| 11.2 | API Token | ⬜ | 长期 token 供 CLI/自动化使用 |
| 11.3 | 工作空间隔离 | ⬜ | 所有查询强制 WHERE workspace_id = ? |
| 11.4 | 角色权限 | ⬜ | owner/admin/member/viewer |
| 11.5 | WS 认证 | ⬜ | 连接时验证 token |
| 11.6 | Lark 用户映射 | ⬜ | open_id → actor 记录 |
| 11.7 | 前端路由守卫 | ⬜ | 未登录重定向 + 角色路由 |

### 交付物

- [x] 用户登录/注册可用
- [x] 工作空间隔离生效
- [x] 角色权限正确

---

## Phase 12：部署与打包（2 天）

**状态**：⬜ 未开始

### 目标

Docker Compose 一键部署，支持自托管。

### 任务清单

| # | 任务 | 状态 | 说明 |
|---|------|------|------|
| 12.1 | FastAPI Dockerfile | ⬜ | Python 基础镜像 |
| 12.2 | Next.js Dockerfile | ⬜ | 多阶段构建 |
| 12.3 | docker-compose.yml | ⬜ | api + web + lark-bridge + sqlite-data |
| 12.4 | 环境变量文档 | ⬜ | .env.example 完整版 |
| 12.5 | 健康检查 | ⬜ | /health 端点 |
| 12.6 | 日志配置 | ⬜ | 结构化日志 + 文件轮转 |

### 交付物

- [x] `docker-compose up` 一键启动
- [x] 生产环境可用

---

## 依赖关系

```
P1 (骨架)
 ├──> P2 (任务 CRUD)
 │     ├──> P3 (WS 实时)
 │     │     ├──> P4 (Dashboard)
 │     │     ├──> P5 (Plan DAG)
 │     │     └──> P6 (Kanban)
 │     ├──> P7 (Schedule)
 │     └──> P8 (Workflow 引擎)
 │           └──> P9 (Workflow 编辑器)
 ├──> P10 (Lark 联动) ←── P3
 └──> P11 (认证权限) ←── P2
       └──> P12 (部署) ←── P4-P9, P10, P11
```

### 可并行阶段

- P5 (Plan DAG) 与 P6 (Kanban) 与 P7 (Schedule) 可并行
- P9 (Workflow 编辑器) 依赖 P8 (Workflow 引擎)
- P10 (Lark 联动) 和 P11 (认证权限) 可与 P5-P7 并行

### 最短路径（MVP）

```
P1 → P2 → P3 → P4 → P11 → P12
```

约 **15 天**即可完成包含认证和部署的 Web 工作台 MVP。

---

## 里程碑

| 里程碑 | 包含 Phase | 预计天数 | 核心价值 |
|--------|-----------|---------|---------|
| **M1: 可运行的 Web 工作台** | P1-P4 | 10 | Web 替代 Lark 卡片 |
| **M2: Plan + Kanban 增强** | P5-P6 | 8 | DAG 可视化 + 看板管理 |
| **M3: Schedule + Workflow** | P7-P9 | 13 | 定时调度 + 流程编排 |
| **M4: 双通道 + 权限 + 部署** | P10-P12 | 8 | 生产就绪 |

---

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 现有 tide_ws.py 重构范围大 | P2 延期 | TaskService 先桥接不重构；后期渐进式拆分 |
| React Flow 自定义节点复杂度 | P5/P9 延期 | 先用简单矩形节点，后期逐步美化 |
| Workflow 引擎状态一致性 | P8 质量风险 | 每步写 DB + 事件日志 + 单元测试覆盖 |
| SQLite 并发写入性能 | 生产稳定性 | WAL 模式 + 写入串行化；后期可迁移 PostgreSQL |
| 多 Agent 执行资源竞争 | 运行稳定性 | 复用现有 MAX_RUNNING_TASKS 限流 |
