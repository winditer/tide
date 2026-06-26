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

### Knowledge Graph 知识图谱

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/knowledge/{scope}/{id}/files` | 列出 `.knowledge/` 全部文件 |
| GET | `/api/knowledge/{scope}/{id}/file` | 读取单个文件内容 |
| PUT | `/api/knowledge/{scope}/{id}/file` | 保存 Markdown 编辑 |
| DELETE | `/api/knowledge/{scope}/{id}/file` | 删除文件 |
| GET | `/api/knowledge/{scope}/{id}/status` | 查询生成任务状态（含 done/total 进度） |
| POST | `/api/knowledge/{scope}/{id}/generate` | 触发生成（body: `graph_type`, `agent_id`） |
| GET | `/api/knowledge/{scope}/{id}/export` | ZIP 导出 `.knowledge/` 目录 |

> `scope` 支持 `project` 或 `group`；`graph_type` 可选 `all` / `module` / `api` / `db` / `concept` / `architecture` / `tech-stack` / `coding-style` / `data-flow` / `test-coverage` / `event-bus`（共 11 个，含 all）。
> 不传 `agent_id` 时使用 Python 静态分析（支持全部 10 类图谱）；传入 `agent_id` 则通过 Agent 驱动分析（支持全部 10 类及任意语言）。
> Agent 生成的 JSON 若不是 dict 类型，服务层自动降级使用 Agent 直接生成的 `.md` 文件。

### Work Items 工作项

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/work-items` | 工作项列表（支持按项目/项目组/状态筛选） |
| POST | `/api/work-items` | 创建工作项 |
| PUT | `/api/work-items/{id}` | 更新工作项 |
| DELETE | `/api/work-items/{id}` | 删除工作项 |
| POST | `/api/work-items/ai-decompose` | AI 分解（multipart/form-data：文本/链接/附件） |
| POST | `/api/work-items/batch` | 批量创建工作项 |

### Project Groups 项目组

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/project-groups` | 列出项目组 |
| POST | `/api/project-groups` | 创建项目组 |
| GET | `/api/project-groups/{id}` | 项目组详情 |
| PUT | `/api/project-groups/{id}` | 更新项目组 |
| DELETE | `/api/project-groups/{id}` | 删除项目组 |
| POST | `/api/project-groups/{id}/members` | 添加成员项目 |
| DELETE | `/api/project-groups/{id}/members/{pid}` | 移除成员项目 |
| GET/POST/PUT/DELETE | `/api/project-groups/{id}/users[/{uid}]` | 用户成员管理 |
| GET | `/api/project-groups/{id}/conversations` | 聚合查询对话 |
| GET | `/api/project-groups/{id}/tasks` | 聚合查询任务 |
| GET | `/api/project-groups/{id}/versions` | 聚合查询版本 |
| GET/PUT/DELETE | `/api/project-groups/{id}/workflow` | 工作流绑定管理 |

### ECC 企业能力中心

| 方法 | 路径 | 说明 |
|------|------|------|
| CRUD | `/api/skills` | 技能库管理 |
| CRUD | `/api/rules` | 规则引擎（global/language/project 三层） |
| CRUD | `/api/hooks` | 事件钩子（事件/条件/动作） |
| POST | `/api/security/scan` | 安全扫描 |
| CRUD | `/api/security/rules` | 安全规则管理 |
| GET/PUT | `/api/security/findings` | 扫描发现管理 |

### Auth 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 用户名密码登录 |
| POST | `/api/auth/refresh` | 刷新 JWT token |
| GET | `/api/auth/lark/login` | Lark OAuth2 SSO |

### Files & Git 审计

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/files/tree` | 文件树结构 |
| GET/PUT | `/api/files/content` | 读取/写入文件内容 |
| GET | `/api/files/diff` | 文件 diff |
| GET | `/api/files/conflict-detail` | 冲突详情（base/ours/theirs） |
| POST | `/api/files/resolve-conflict` | 规则化解决冲突 |
| POST | `/api/files/ai-resolve-conflict` | AI 智能解决冲突 |
| GET | `/api/projects/{id}/git/commits` | 提交列表 |
| GET | `/api/projects/{id}/git/changes` | 变更统计 |
| GET | `/api/projects/{id}/git/diff` | Diff 内容 |
| GET | `/api/projects/{id}/git/branches` | 分支列表 |
| GET | `/api/projects/{id}/git/uncommitted` | 未提交变更 |
| POST | `/api/projects/{id}/git/commit` | 提交文件 |
| POST | `/api/projects/{id}/git/discard` | 撤销修改 |
| POST | `/api/projects/{id}/git/ignore` | 忽略文件 |

### Remote Agents 远程 Agent

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/remote-agents` | 远程 Agent 列表 |
| POST | `/api/remote-agents` | 注册远程 Agent |
| GET | `/api/remote-agents/{id}/health` | 健康检查 |

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
| `conversations` | 会话管理与 session resume |
| `schedules` | 定时任务 |
| `schedule_runs` | 定时任务执行记录 |
| `workflows` | 工作流定义 |
| `workflow_runs` | 工作流运行实例 |
| `workflow_node_runs` | 工作流节点执行记录 |
| `skills` | ECC 技能库 |
| `rules` | ECC 规则引擎 |
| `hooks` | ECC 事件钩子 |
| `security_rules` | 安全扫描规则 |
| `security_findings` | 扫描发现记录 |
| `project_groups` | 项目组定义 |
| `project_group_members` | 项目组成员项目 |
| `project_group_user_members` | 项目组用户成员 |
| `work_items` | 工作项（含 AI 分解结果） |

数据库文件：`tide.db`（SQLite WAL 模式）

初始化 SQL：`backend/db/init.sql`

## 测试

```bash
python -m pytest backend/tests/ -v
```
