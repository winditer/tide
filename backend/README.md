# Tide 后端

FastAPI 后端，SQLite 数据库，WebSocket 实时推送。

## 启动

```bash
pip install -r backend/requirements.txt
cd /path/to/tide && uvicorn backend.main:app --reload --port 8000
```

启动后访问：

- API 文档：http://localhost:8000/docs
- 健康检查：http://localhost:8000/health

## API 端点

### 任务管理

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/tasks` | 创建任务 |
| GET | `/api/tasks` | 任务列表（筛选 + 分页） |
| GET | `/api/tasks/{task_id}` | 任务详情 |
| POST | `/api/tasks/{task_id}/stop` | 停止任务 |
| POST | `/api/tasks/{task_id}/approve` | 批准审批 |
| POST | `/api/tasks/{task_id}/reject` | 拒绝审批 |
| POST | `/api/tasks/{task_id}/retry` | 重试失败任务 |
| GET | `/api/tasks/{task_id}/output` | SSE 流式输出 |

### Dashboard

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/dashboard/stats` | 统计数据（运行中/排队中/待审批/今日完成） |
| GET | `/api/dashboard/recent-tasks` | 最近任务列表 |

### 项目

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/projects` | 项目列表（按 cwd 聚合） |
| GET | `/api/projects/{project_id}/tasks` | 项目下的任务 |

### 会话

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/sessions` | 会话列表（按 session_id 聚合） |

### Agent

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/agents` | 可用 Agent 列表 + 运行时状态 |

### 事件

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/events` | 事件列表（重连后补偿） |

### Plan DAG (P5)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/plans` | 创建 Plan |
| GET | `/api/plans` | Plan 列表 |
| GET | `/api/plans/{plan_id}` | Plan 详情 |
| GET | `/api/plans/{plan_id}/dag` | DAG 结构（React Flow 格式） |
| GET | `/api/plans/{plan_id}/timeline` | 时间线数据 |
| POST | `/api/plans/{plan_id}/stop` | 停止 Plan |

### Kanban 看板 (P6)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/kanban/projects` | 项目看板 |
| GET | `/api/kanban/sessions` | 会话看板 |
| GET | `/api/kanban/agents` | Agent 看板 |
| GET | `/api/kanban/workflows` | 工作流看板 |
| POST | `/api/kanban/move` | 拖拽更新状态 |

### Schedule 定时调度 (P7)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/schedules` | 创建定时任务 |
| GET | `/api/schedules` | 定时任务列表 |
| GET | `/api/schedules/{id}` | 定时任务详情 |
| PUT | `/api/schedules/{id}` | 更新定时任务 |
| DELETE | `/api/schedules/{id}` | 删除定时任务 |
| POST | `/api/schedules/{id}/toggle` | 启停切换 |
| POST | `/api/schedules/{id}/trigger` | 手动触发一次 |
| GET | `/api/schedules/{id}/runs` | 执行历史 |

### Workflow (P8/P9)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/workflows` | 创建工作流 |
| GET | `/api/workflows` | 工作流列表 |
| GET | `/api/workflows/{id}` | 工作流详情 |
| PUT | `/api/workflows/{id}` | 更新工作流 |
| DELETE | `/api/workflows/{id}` | 删除工作流 |
| POST | `/api/workflows/{id}/run` | 启动工作流运行 |
| GET | `/api/workflows/{id}/runs` | 运行历史 |
| GET | `/api/workflows/runs/{run_id}` | 运行详情 |
| POST | `/api/workflows/runs/{run_id}/cancel` | 取消运行 |
| POST | `/api/workflows/runs/{run_id}/approve` | 审批节点 |

### Lark Bridge (P10)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/lark/notify` | 发送通知到 Lark |
| GET | `/api/lark/status` | Lark 连接状态 |

### WebSocket

| 路径 | 说明 |
|------|------|
| `/ws` | WebSocket 连接，支持 subscribe/ping |

消息格式：

```json
{"type": "subscribe", "channels": ["tasks", "plans"]}
{"type": "ping"}
```

## 数据库表概览

| 表名 | 说明 |
|------|------|
| `actors` | 统一身份表（member/agent/lark_user） |
| `workspaces` | 工作空间 |
| `tasks` | 统一任务表 |
| `task_events` | 任务事件日志 |
| `plans` | Plan 定义 |
| `plan_tasks` | Plan 子任务关联 |
| `approvals` | 审批 |
| `schedules` | 定时任务 |
| `schedule_runs` | 定时任务执行记录 |
| `workflows` | 工作流定义 |
| `workflow_runs` | 工作流运行实例 |
| `workflow_node_runs` | 工作流节点执行记录 |

数据库文件：`tide.db`（SQLite WAL 模式）

初始化 SQL：`backend/db/init.sql`

## 测试

```bash
python -m pytest backend/tests/ -v
```
