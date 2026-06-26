# 业务概念图

> 生成时间: 2026-06-26T02:33:51Z | 概念: 17 | 关系: 22

## 领域概览

### 核心实体

- `actors`
- `approvals`
- `conversations`
- `plans`
- `schedules`
- `tasks`
- `versions`
- `work_items`
- `workflows`
- `workspaces`

### 认证与权限

- `users`

### A2A Remote Agent Support

- `remote_agents`

### Skills 知识库

- `skills`

### Rules 规则引擎

- `rules`

### Hooks 事件驱动

- `hooks`

### Security 安全审查

- `security_rules`

### 项目组（Project Groups）

- `project_groups`

## 概念关系图

```mermaid
graph LR
    actors([执行者 (Actor)])
    workspaces([工作空间 (Workspace)])
    tasks([任务 (Task)])
    plans([计划 (Plan)])
    approvals([审批 (Approval)])
    schedules([定时任务 (Schedule)])
    workflows([工作流 (Workflow)])
    conversations([会话 (Conversation)])
    versions([版本 (Version)])
    work_items([工作项 (Work Item)])
    users([用户 (User)])
    remote_agents([远程 Agent (Remote Agent)])
    skills([技能 (Skill)])
    rules([规则 (Rule)])
    hooks([钩子 (Hook)])
    security_rules([安全规则 (Security Rule)])
    project_groups([项目组 (Project Group)])
    workspaces -->|references| actors
    tasks -->|references| workspaces
    tasks -->|references| actors
    tasks -->|references| workspaces
    tasks -->|references| actors
    plans -->|references| workspaces
    plans -->|references| tasks
    approvals -->|references| tasks
    approvals -->|references| workspaces
    approvals -->|references| tasks
    schedules -->|references| workspaces
    schedules -->|references| tasks
    workflows -->|references| workspaces
    workflows -->|references| workspaces
    workflows -->|references| tasks
    work_items -->|references| versions
    skills -->|references| workspaces
    rules -->|references| workspaces
    hooks -->|references| workspaces
    security_rules -->|references| workspaces
    project_groups -->|references| workspaces
    project_groups -->|references| users
```

## 概念详情

### 执行者 (Actor)

> actors 统一身份表

- **DB 表**: `actors`
- **API**: —
- **Service**: —
- **相关概念**: `tasks`, `workspaces`

### 工作空间 (Workspace)

> workspaces 工作空间

- **DB 表**: `workspaces`
- **API**: —
- **Service**: —
- **相关概念**: `actors`, `approvals`, `hooks`, `plans`, `project_groups`, `rules`, `schedules`, `security_rules`, `skills`, `tasks`, `workflows`

### 任务 (Task)

> tasks 统一任务表

- **DB 表**: `tasks`, `task_events`
- **API**: `/api/tasks`
- **Service**: `backend.services.task_service`
- **相关概念**: `actors`, `approvals`, `plans`, `schedules`, `workflows`, `workspaces`

### 计划 (Plan)

> plans Plan定义

- **DB 表**: `plans`, `plan_tasks`
- **API**: `/api/plans`
- **Service**: `backend.services.plan_executor`, `backend.services.plan_service`
- **相关概念**: `tasks`, `workspaces`

### 审批 (Approval)

> approvals 审批

- **DB 表**: `approvals`
- **API**: `/api/approvals`
- **Service**: `backend.services.approval_service`
- **相关概念**: `tasks`, `workspaces`

### 定时任务 (Schedule)

> schedules 定时任务

- **DB 表**: `schedules`, `schedule_runs`
- **API**: `/api/schedules`
- **Service**: `backend.services.schedule_service`
- **相关概念**: `tasks`, `workspaces`

### 工作流 (Workflow)

> workflows 工作流定义

- **DB 表**: `workflows`, `workflow_runs`, `workflow_node_runs`
- **API**: `/api/workflows`
- **Service**: `backend.services.workflow_engine`, `backend.services.workflow_service`
- **相关概念**: `tasks`, `workspaces`

### 会话 (Conversation)

> conversations 会话管理

- **DB 表**: `conversations`
- **API**: `/conversations`
- **Service**: `backend.services.conversation_service`

### 版本 (Version)

> versions 版本（项目级版本管理）

- **DB 表**: `versions`
- **API**: `/api/versions`
- **Service**: —
- **相关概念**: `work_items`

### 工作项 (Work Item)

> work_items 工作项

- **DB 表**: `work_items`, `work_item_transitions`
- **API**: `/api/work-items`
- **Service**: `backend.services.work_item_service`
- **相关概念**: `versions`

### 用户 (User)

> 用户表

- **DB 表**: `users`, `user_sessions`
- **API**: —
- **Service**: —
- **相关概念**: `project_groups`

### 远程 Agent (Remote Agent)

> A2A Remote Agent Support

- **DB 表**: `remote_agents`
- **API**: `/api/remote-agents`
- **Service**: —

### 技能 (Skill)

> Skills 知识库

- **DB 表**: `skills`
- **API**: `/api/skills`
- **Service**: `backend.services.skill_service`
- **相关概念**: `workspaces`

### 规则 (Rule)

> Rules 规则引擎

- **DB 表**: `rules`
- **API**: `/api/rules`
- **Service**: `backend.services.rule_service`
- **相关概念**: `workspaces`

### 钩子 (Hook)

> Hooks 事件驱动

- **DB 表**: `hooks`
- **API**: `/api/hooks`
- **Service**: `backend.services.hook_engine`
- **相关概念**: `workspaces`

### 安全规则 (Security Rule)

> Security 安全审查

- **DB 表**: `security_rules`
- **API**: —
- **Service**: —
- **相关概念**: `workspaces`

### 项目组 (Project Group)

> 项目组定义

- **DB 表**: `project_groups`, `project_group_members`, `project_group_user_members`
- **API**: `/api/project-groups`
- **Service**: `backend.services.project_group_service`
- **相关概念**: `users`, `workspaces`
