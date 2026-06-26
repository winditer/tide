# 数据库 Schema 图谱

> 生成时间: 2026-06-26T02:33:51Z | 表: 30 | 列: 320 | 外键: 35 | 索引: 30

## ER 关系图

```mermaid
erDiagram
    actors {
        TEXT id PK
        TEXT type
        TEXT name
        TEXT avatar_url
        TEXT metadata
        TIMESTAMP created_at
    }
    workspaces {
        TEXT id PK
        TEXT name
        TEXT slug
        TEXT owner_id FK
        TIMESTAMP created_at
    }
    tasks {
        TEXT id PK
        TEXT workspace_id FK
        TEXT plan_id
        TEXT workflow_run_id
        TEXT workflow_node_id
        TEXT assignee_id FK
        TEXT assignee_type
        TEXT chat_id
    }
    task_events {
        TEXT id PK
        TEXT task_id FK
        TEXT workspace_id FK
        TEXT actor_id FK
        TEXT event_type
        TEXT payload
        TIMESTAMP created_at
    }
    plans {
        TEXT id PK
        TEXT workspace_id FK
        TEXT chat_id
        TEXT cwd
        TEXT model
        TEXT status
        INTEGER max_parallel
        TEXT definition
    }
    plan_tasks {
        TEXT plan_id FK
        TEXT task_id FK
        INTEGER task_index
        INTEGER phase
        TEXT depends_on
    }
    approvals {
        TEXT id PK
        TEXT task_id FK
        TEXT plan_id
        TEXT workspace_id FK
        TEXT chat_id
        TEXT type
        TEXT detail
        TEXT status
    }
    schedules {
        TEXT id PK
        TEXT workspace_id FK
        TEXT name
        TEXT description
        TEXT trigger_type
        TEXT trigger_config
        TEXT task_type
        TEXT task_config
    }
    schedule_runs {
        TEXT id PK
        TEXT schedule_id FK
        TEXT task_id FK
        TEXT status
        TEXT trigger_type
        TIMESTAMP started_at
        TIMESTAMP completed_at
        TEXT result
    }
    workflows {
        TEXT id PK
        TEXT workspace_id FK
        TEXT name
        TEXT description
        TEXT definition
        INTEGER version
        INTEGER enabled
        TIMESTAMP created_at
    }
    workflow_runs {
        TEXT id PK
        TEXT workflow_id FK
        TEXT workspace_id FK
        TEXT status
        TEXT current_node_ids
        TEXT context
        TEXT trigger_type
        TIMESTAMP started_at
    }
    workflow_node_runs {
        TEXT id PK
        TEXT run_id FK
        TEXT node_id
        TEXT task_id FK
        TEXT status
        TIMESTAMP started_at
        TIMESTAMP completed_at
        TEXT output
    }
    conversations {
        TEXT id PK
        TEXT workspace_id
        TEXT chat_id
        Lark --
        当前使用的 --
        当前使用的模型 --
        最近一次 --
        工作目录 --
    }
    project_settings {
        TEXT project_id PK
        TEXT workflow_id
        TEXT default_assignee
        TEXT metadata
        TIMESTAMP updated_at
    }
    versions {
        TEXT id PK
        TEXT project_id
        TEXT name
        TEXT description
        TEXT status
        active --
        TIMESTAMP updated_at
    }
    work_items {
        TEXT id PK
        TEXT project_id
        TEXT workflow_id
        TEXT current_node_id
        TEXT title
        TEXT description
        INTEGER priority
        TEXT assignee
    }
    work_item_transitions {
        TEXT id PK
        TEXT work_item_id FK
        TEXT from_node_id
        TEXT to_node_id
        TEXT trigger_type
        TEXT task_id
        TEXT operator
        TEXT output
    }
    users {
        TEXT id PK
        TEXT username
        TEXT email
        TEXT password_hash
        Lark --
        TEXT avatar_url
        TEXT role
        admin --
    }
    user_sessions {
        TEXT id PK
        TEXT user_id FK
        TEXT refresh_token_hash
        TEXT ip_address
        TEXT user_agent
        INTEGER is_active
        TIMESTAMP expires_at
        TIMESTAMP created_at
    }
    project_members {
        TEXT id PK
        TEXT project_id
        TEXT user_id FK
        TEXT role
        owner --
    }
    remote_agents {
        TEXT id PK
        TEXT name
        TEXT description
        TEXT agent_card_url
        TEXT agent_card_json
        TEXT endpoint_url
        TEXT protocol_binding
        TEXT protocol_version
    }
    a2a_task_mapping {
        TEXT local_task_id PK
        TEXT remote_task_id
        TEXT remote_context_id
        TEXT agent_id
        TIMESTAMP created_at
    }
    skills {
        TEXT id PK
        TEXT workspace_id FK
        TEXT name
        TEXT slug
        TEXT description
        TEXT category
        TEXT tags
        TEXT content
    }
    rules {
        TEXT id PK
        TEXT workspace_id FK
        TEXT name
        TEXT scope
        TEXT scope_value
        TEXT project_id
        TEXT content
        INTEGER priority
    }
    hooks {
        TEXT id PK
        TEXT workspace_id FK
        TEXT name
        TEXT event
        TEXT action_type
        TEXT action_config
        TEXT conditions
        INTEGER priority
    }
    security_rules {
        TEXT id PK
        TEXT workspace_id FK
        TEXT name
        TEXT category
        TEXT pattern
        TEXT severity
        TEXT description
        TEXT remediation
    }
    security_findings {
        TEXT id PK
        TEXT workspace_id FK
        TEXT task_id FK
        TEXT rule_id FK
        TEXT category
        TEXT severity
        TEXT snippet
        TEXT location
    }
    project_groups {
        TEXT id PK
        TEXT workspace_id FK
        TEXT name
        TEXT description
        TEXT created_by
        TIMESTAMP created_at
        TIMESTAMP updated_at
        TEXT workflow_id
    }
    project_group_members {
        TEXT id PK
        TEXT group_id FK
        TEXT project_id
        TEXT role
        INTEGER display_order
        TIMESTAMP added_at
    }
    project_group_user_members {
        TEXT id PK
        TEXT group_id
        TEXT user_id FK
        TEXT role
        owner --
    }
    actors ||--o{ workspaces : has
    workspaces ||--o{ tasks : has
    actors ||--o{ tasks : has
    tasks ||--o{ tasks : has
    tasks ||--o{ task_events : has
    workspaces ||--o{ task_events : has
    actors ||--o{ task_events : has
    workspaces ||--o{ plans : has
    plans ||--o{ plan_tasks : has
    tasks ||--o{ plan_tasks : has
    tasks ||--o{ approvals : has
    workspaces ||--o{ approvals : has
    tasks ||--o{ approvals : has
    workspaces ||--o{ schedules : has
    schedules ||--o{ schedule_runs : has
    tasks ||--o{ schedule_runs : has
    workspaces ||--o{ workflows : has
    workflows ||--o{ workflow_runs : has
    workspaces ||--o{ workflow_runs : has
    workflow_runs ||--o{ workflow_node_runs : has
    tasks ||--o{ workflow_node_runs : has
    versions ||--o{ work_items : has
    work_items ||--o{ work_item_transitions : has
    users ||--o{ user_sessions : has
    users ||--o{ project_members : has
    workspaces ||--o{ skills : has
    workspaces ||--o{ rules : has
    workspaces ||--o{ hooks : has
    workspaces ||--o{ security_rules : has
    workspaces ||--o{ security_findings : has
    tasks ||--o{ security_findings : has
    security_rules ||--o{ security_findings : has
    workspaces ||--o{ project_groups : has
    project_groups ||--o{ project_group_members : has
    users ||--o{ project_group_user_members : has
```

## 实体分组

### 核心实体

#### `actors`
> actors 统一身份表

| 列 | 类型 | 约束 | 默认 | 外键 |
|----|------|------|------|------|
| `id` | `TEXT` | PK | — | — |
| `type` | `TEXT` | NOT NULL | — | — |
| `name` | `TEXT` | NOT NULL | — | — |
| `avatar_url` | `TEXT` | — | — | — |
| `metadata` | `TEXT` | — | — | — |
| `created_at` | `TIMESTAMP` | — | CURRENT_TIMESTAMP | — |

#### `workspaces`
> workspaces 工作空间

| 列 | 类型 | 约束 | 默认 | 外键 |
|----|------|------|------|------|
| `id` | `TEXT` | PK | — | — |
| `name` | `TEXT` | NOT NULL | — | — |
| `slug` | `TEXT` | NOT NULL | — | — |
| `owner_id` | `TEXT` | — | — | actors(id) |
| `created_at` | `TIMESTAMP` | — | CURRENT_TIMESTAMP | — |

#### `tasks`
> tasks 统一任务表

| 列 | 类型 | 约束 | 默认 | 外键 |
|----|------|------|------|------|
| `id` | `TEXT` | PK | — | — |
| `workspace_id` | `TEXT` | NOT NULL | — | workspaces(id) |
| `plan_id` | `TEXT` | — | — | — |
| `workflow_run_id` | `TEXT` | — | — | — |
| `workflow_node_id` | `TEXT` | — | — | — |
| `assignee_id` | `TEXT` | — | — | actors(id) |
| `assignee_type` | `TEXT` | NOT NULL | 'agent' | — |
| `chat_id` | `TEXT` | — | — | — |
| `parent_task_id` | `TEXT` | — | — | tasks(id) |
| `prompt` | `TEXT` | NOT NULL | — | — |
| `cwd` | `TEXT` | — | — | — |
| `group_id` | `TEXT` | — | — | — |
| `model` | `TEXT` | — | — | — |
| `agent_id` | `TEXT` | — | — | — |
| `session_id` | `TEXT` | — | — | — |
| `status` | `TEXT` | NOT NULL | 'queued' | — |
| `result` | `TEXT` | — | — | — |
| `attachments` | `TEXT` | — | — | — |
| `output_path` | `TEXT` | — | — | — |
| `worktree_path` | `TEXT` | — | — | — |
| `branch_name` | `TEXT` | — | — | — |
| `diff_summary` | `TEXT` | — | — | — |
| `test_result` | `TEXT` | — | — | — |
| `commit_hash` | `TEXT` | — | — | — |
| `commit_message` | `TEXT` | — | — | — |
| `merge_status` | `TEXT` | — | — | — |
| `priority` | `INTEGER` | — | 0 | — |
| `labels` | `TEXT` | — | — | — |
| `created_at` | `TIMESTAMP` | — | CURRENT_TIMESTAMP | — |
| `started_at` | `TIMESTAMP` | — | — | — |
| `completed_at` | `TIMESTAMP` | — | — | — |
| `duration_ms` | `INTEGER` | — | — | — |
| `token_input` | `INTEGER` | via engine.py:ALTER | — | — |
| `token_output` | `INTEGER` | via engine.py:ALTER | — | — |
| `estimated_cost_usd` | `REAL` | via engine.py:ALTER | — | — |
| `synced_message_count` | `INTEGER` | via engine.py:ALTER | — | — |

**索引**：
- `idx_tasks_workspace` (workspace_id)
- `idx_tasks_status` (workspace_id, status)
- `idx_tasks_plan` (plan_id)
- `idx_tasks_assignee` (assignee_id)

#### `task_events`
> task_events 任务事件日志

| 列 | 类型 | 约束 | 默认 | 外键 |
|----|------|------|------|------|
| `id` | `TEXT` | PK | — | — |
| `task_id` | `TEXT` | NOT NULL | — | tasks(id) |
| `workspace_id` | `TEXT` | NOT NULL | — | workspaces(id) |
| `actor_id` | `TEXT` | — | — | actors(id) |
| `event_type` | `TEXT` | NOT NULL | — | — |
| `payload` | `TEXT` | — | — | — |
| `created_at` | `TIMESTAMP` | — | CURRENT_TIMESTAMP | — |

**索引**：
- `idx_events_task` (task_id)
- `idx_events_time` (workspace_id, created_at)

#### `plans`
> plans Plan定义

| 列 | 类型 | 约束 | 默认 | 外键 |
|----|------|------|------|------|
| `id` | `TEXT` | PK | — | — |
| `workspace_id` | `TEXT` | NOT NULL | — | workspaces(id) |
| `chat_id` | `TEXT` | — | — | — |
| `cwd` | `TEXT` | — | — | — |
| `model` | `TEXT` | — | — | — |
| `status` | `TEXT` | NOT NULL | 'active' | — |
| `max_parallel` | `INTEGER` | — | 3 | — |
| `definition` | `TEXT` | — | — | — |
| `group_id` | `TEXT` | — | — | — |
| `created_at` | `TIMESTAMP` | — | CURRENT_TIMESTAMP | — |
| `completed_at` | `TIMESTAMP` | — | — | — |

#### `plan_tasks`
> plan_tasks Plan子任务关联

| 列 | 类型 | 约束 | 默认 | 外键 |
|----|------|------|------|------|
| `plan_id` | `TEXT` | NOT NULL | — | plans(id) |
| `task_id` | `TEXT` | NOT NULL | — | tasks(id) |
| `task_index` | `INTEGER` | NOT NULL | — | — |
| `phase` | `INTEGER` | — | 0 | — |
| `depends_on` | `TEXT` | — | — | — |

#### `approvals`
> approvals 审批

| 列 | 类型 | 约束 | 默认 | 外键 |
|----|------|------|------|------|
| `id` | `TEXT` | PK | — | — |
| `task_id` | `TEXT` | NOT NULL | — | tasks(id) |
| `plan_id` | `TEXT` | — | — | — |
| `workspace_id` | `TEXT` | NOT NULL | — | workspaces(id) |
| `chat_id` | `TEXT` | — | — | — |
| `type` | `TEXT` | NOT NULL | 'unknown' | — |
| `detail` | `TEXT` | — | '{}' | — |
| `status` | `TEXT` | NOT NULL | 'pending' | — |
| `operator_id` | `TEXT` | — | — | — |
| `created_at` | `TEXT` | — | (datetime('now')) | — |
| `resolved_at` | `TEXT` | — | — | — |

**索引**：
- `idx_approvals_task` (task_id)
- `idx_approvals_workspace_status` (workspace_id, status)

#### `schedules`
> schedules 定时任务

| 列 | 类型 | 约束 | 默认 | 外键 |
|----|------|------|------|------|
| `id` | `TEXT` | PK | — | — |
| `workspace_id` | `TEXT` | NOT NULL | — | workspaces(id) |
| `name` | `TEXT` | NOT NULL | — | — |
| `description` | `TEXT` | — | — | — |
| `trigger_type` | `TEXT` | NOT NULL | — | — |
| `trigger_config` | `TEXT` | NOT NULL | — | — |
| `task_type` | `TEXT` | NOT NULL | — | — |
| `task_config` | `TEXT` | NOT NULL | — | — |
| `enabled` | `INTEGER` | — | 1 | — |
| `last_run_at` | `TIMESTAMP` | — | — | — |
| `next_run_at` | `TIMESTAMP` | — | — | — |
| `run_count` | `INTEGER` | — | 0 | — |
| `created_at` | `TIMESTAMP` | — | CURRENT_TIMESTAMP | — |
| `updated_at` | `TIMESTAMP` | — | CURRENT_TIMESTAMP | — |

#### `schedule_runs`
> schedule_runs 定时任务执行记录

| 列 | 类型 | 约束 | 默认 | 外键 |
|----|------|------|------|------|
| `id` | `TEXT` | PK | — | — |
| `schedule_id` | `TEXT` | NOT NULL | — | schedules(id) |
| `task_id` | `TEXT` | — | — | tasks(id) |
| `status` | `TEXT` | NOT NULL | 'running' | — |
| `trigger_type` | `TEXT` | — | — | — |
| `started_at` | `TIMESTAMP` | — | CURRENT_TIMESTAMP | — |
| `completed_at` | `TIMESTAMP` | — | — | — |
| `result` | `TEXT` | — | — | — |
| `error` | `TEXT` | — | — | — |

#### `workflows`
> workflows 工作流定义

| 列 | 类型 | 约束 | 默认 | 外键 |
|----|------|------|------|------|
| `id` | `TEXT` | PK | — | — |
| `workspace_id` | `TEXT` | NOT NULL | — | workspaces(id) |
| `name` | `TEXT` | NOT NULL | — | — |
| `description` | `TEXT` | — | — | — |
| `definition` | `TEXT` | NOT NULL | — | — |
| `version` | `INTEGER` | — | 1 | — |
| `enabled` | `INTEGER` | — | 1 | — |
| `created_at` | `TIMESTAMP` | — | CURRENT_TIMESTAMP | — |
| `updated_at` | `TIMESTAMP` | — | CURRENT_TIMESTAMP | — |

#### `workflow_runs`
> workflow_runs 工作流运行实例

| 列 | 类型 | 约束 | 默认 | 外键 |
|----|------|------|------|------|
| `id` | `TEXT` | PK | — | — |
| `workflow_id` | `TEXT` | NOT NULL | — | workflows(id) |
| `workspace_id` | `TEXT` | NOT NULL | — | workspaces(id) |
| `status` | `TEXT` | NOT NULL | 'running' | — |
| `current_node_ids` | `TEXT` | — | — | — |
| `context` | `TEXT` | — | — | — |
| `trigger_type` | `TEXT` | — | 'manual' | — |
| `started_at` | `TIMESTAMP` | — | CURRENT_TIMESTAMP | — |
| `completed_at` | `TIMESTAMP` | — | — | — |

#### `workflow_node_runs`
> workflow_node_runs 工作流节点执行记录

| 列 | 类型 | 约束 | 默认 | 外键 |
|----|------|------|------|------|
| `id` | `TEXT` | PK | — | — |
| `run_id` | `TEXT` | NOT NULL | — | workflow_runs(id) |
| `node_id` | `TEXT` | NOT NULL | — | — |
| `task_id` | `TEXT` | — | — | tasks(id) |
| `status` | `TEXT` | NOT NULL | 'pending' | — |
| `started_at` | `TIMESTAMP` | — | — | — |
| `completed_at` | `TIMESTAMP` | — | — | — |
| `output` | `TEXT` | — | — | — |
| `error` | `TEXT` | — | — | — |

#### `conversations`
> conversations 会话管理

| 列 | 类型 | 约束 | 默认 | 外键 |
|----|------|------|------|------|
| `id` | `TEXT` | PK | — | — |
| `workspace_id` | `TEXT` | NOT NULL | — | — |
| `chat_id` | `TEXT` | — | — | — |
| `--` | `Lark` | — | 'codex' | — |
| `--` | `当前使用的` | — | '' | — |
| `--` | `当前使用的模型` | — | — | — |
| `--` | `最近一次` | — | — | — |
| `--` | `工作目录` | — | 'active' | — |
| `--` | `active` | — | — | — |
| `closed` | `last_active_at` | — | (datetime('now')) | — |
| `created_at` | `TEXT` | — | (datetime('now')) | — |
| `metadata` | `TEXT` | — | '{}' | — |
| `cwd` | `TEXT` | via engine.py:ALTER | — | — |

**索引**：
- `idx_conversations_workspace` (workspace_id)
- `idx_conversations_chat` (chat_id)
- `idx_conversations_status` (workspace_id, status)

#### `project_settings`
> project_settings 项目设置（存储项目绑定的工作流等配置）

| 列 | 类型 | 约束 | 默认 | 外键 |
|----|------|------|------|------|
| `project_id` | `TEXT` | PK | — | — |
| `workflow_id` | `TEXT` | — | — | — |
| `default_assignee` | `TEXT` | — | — | — |
| `metadata` | `TEXT` | — | — | — |
| `updated_at` | `TIMESTAMP` | — | CURRENT_TIMESTAMP | — |

#### `versions`
> versions 版本（项目级版本管理）

| 列 | 类型 | 约束 | 默认 | 外键 |
|----|------|------|------|------|
| `id` | `TEXT` | PK | — | — |
| `project_id` | `TEXT` | NOT NULL | — | — |
| `name` | `TEXT` | NOT NULL | — | — |
| `description` | `TEXT` | — | — | — |
| `status` | `TEXT` | — | 'active' | — |
| `--` | `active` | — | CURRENT_TIMESTAMP | — |
| `updated_at` | `TIMESTAMP` | — | CURRENT_TIMESTAMP | — |

**索引**：
- `idx_versions_project` (project_id)

#### `work_items`
> work_items 工作项

| 列 | 类型 | 约束 | 默认 | 外键 |
|----|------|------|------|------|
| `id` | `TEXT` | PK | — | — |
| `project_id` | `TEXT` | NOT NULL | — | — |
| `workflow_id` | `TEXT` | NOT NULL | — | — |
| `current_node_id` | `TEXT` | NOT NULL | — | — |
| `title` | `TEXT` | NOT NULL | — | — |
| `description` | `TEXT` | — | — | — |
| `priority` | `INTEGER` | — | 0 | — |
| `assignee` | `TEXT` | — | — | — |
| `tags` | `TEXT` | — | — | — |
| `source_type` | `TEXT` | — | 'manual' | — |
| `source_id` | `TEXT` | — | — | — |
| `metadata` | `TEXT` | — | — | — |
| `version_id` | `TEXT` | — | — | versions(id) |
| `started_at` | `TIMESTAMP` | — | — | — |
| `completed_at` | `TIMESTAMP` | — | — | — |
| `created_at` | `TIMESTAMP` | — | CURRENT_TIMESTAMP | — |
| `updated_at` | `TIMESTAMP` | — | CURRENT_TIMESTAMP | — |
| `group_id` | `TEXT` | via engine.py:ALTER | — | — |

#### `work_item_transitions`
> work_item_transitions 工作项流转记录

| 列 | 类型 | 约束 | 默认 | 外键 |
|----|------|------|------|------|
| `id` | `TEXT` | PK | — | — |
| `work_item_id` | `TEXT` | NOT NULL | — | work_items(id) |
| `from_node_id` | `TEXT` | — | — | — |
| `to_node_id` | `TEXT` | NOT NULL | — | — |
| `trigger_type` | `TEXT` | — | 'manual' | — |
| `task_id` | `TEXT` | — | — | — |
| `operator` | `TEXT` | — | — | — |
| `output` | `TEXT` | — | — | — |
| `created_at` | `TIMESTAMP` | — | CURRENT_TIMESTAMP | — |

### 认证与权限

#### `users`
> 用户表

| 列 | 类型 | 约束 | 默认 | 外键 |
|----|------|------|------|------|
| `id` | `TEXT` | PK | — | — |
| `username` | `TEXT` | NOT NULL | — | — |
| `email` | `TEXT` | — | — | — |
| `password_hash` | `TEXT` | — | — | — |
| `--` | `Lark` | — | — | — |
| `avatar_url` | `TEXT` | — | — | — |
| `role` | `TEXT` | — | 'member' | — |
| `--` | `admin` | — | 'active' | — |
| `--` | `active` | — | — | — |
| `lark_union_id` | `TEXT` | — | — | — |
| `workspace_id` | `TEXT` | — | 'default' | — |
| `last_login_at` | `TIMESTAMP` | — | — | — |
| `created_at` | `TIMESTAMP` | — | CURRENT_TIMESTAMP | — |
| `updated_at` | `TIMESTAMP` | — | CURRENT_TIMESTAMP | — |

**索引**：
- `idx_users_lark_open_id` (lark_open_id)

#### `user_sessions`
> 用户会话表（管理 refresh token）

| 列 | 类型 | 约束 | 默认 | 外键 |
|----|------|------|------|------|
| `id` | `TEXT` | PK | — | — |
| `user_id` | `TEXT` | NOT NULL | — | users(id) |
| `refresh_token_hash` | `TEXT` | NOT NULL | — | — |
| `ip_address` | `TEXT` | — | — | — |
| `user_agent` | `TEXT` | — | — | — |
| `is_active` | `INTEGER` | — | 1 | — |
| `expires_at` | `TIMESTAMP` | NOT NULL | — | — |
| `created_at` | `TIMESTAMP` | — | CURRENT_TIMESTAMP | — |
| `last_used_at` | `TIMESTAMP` | — | — | — |

**索引**：
- `idx_user_sessions_user_id` (user_id)
- `idx_user_sessions_active` (is_active, expires_at)

#### `project_members`
> 项目成员表（项目级隔离）

| 列 | 类型 | 约束 | 默认 | 外键 |
|----|------|------|------|------|
| `id` | `TEXT` | PK | — | — |
| `project_id` | `TEXT` | NOT NULL | — | — |
| `user_id` | `TEXT` | NOT NULL | — | users(id) |
| `role` | `TEXT` | — | 'member' | — |
| `--` | `owner` | — | CURRENT_TIMESTAMP | — |

**索引**：
- `idx_project_members_user` (user_id)
- `idx_project_members_project` (project_id)

### A2A Remote Agent Support

#### `remote_agents`
> A2A Remote Agent Support

| 列 | 类型 | 约束 | 默认 | 外键 |
|----|------|------|------|------|
| `id` | `TEXT` | PK | — | — |
| `name` | `TEXT` | NOT NULL | — | — |
| `description` | `TEXT` | — | — | — |
| `agent_card_url` | `TEXT` | NOT NULL | — | — |
| `agent_card_json` | `TEXT` | — | — | — |
| `endpoint_url` | `TEXT` | NOT NULL | — | — |
| `protocol_binding` | `TEXT` | — | 'JSONRPC' | — |
| `protocol_version` | `TEXT` | — | '1.0' | — |
| `auth_type` | `TEXT` | — | 'bearer' | — |
| `auth_credentials` | `TEXT` | — | — | — |
| `auth_header_name` | `TEXT` | — | — | — |
| `capabilities_streaming` | `BOOLEAN` | — | FALSE | — |
| `capabilities_push_notifications` | `BOOLEAN` | — | FALSE | — |
| `skills_json` | `TEXT` | — | — | — |
| `approval_required` | `BOOLEAN` | — | TRUE | — |
| `approval_policy` | `TEXT` | — | 'on-request' | — |
| `timeout_ms` | `INTEGER` | — | 300000 | — |
| `max_retries` | `INTEGER` | — | 2 | — |
| `status` | `TEXT` | — | 'active' | — |
| `last_health_check` | `TIMESTAMP` | — | — | — |
| `last_error` | `TEXT` | — | — | — |
| `workspace_id` | `TEXT` | — | — | — |
| `created_by` | `TEXT` | — | — | — |
| `created_at` | `TIMESTAMP` | — | CURRENT_TIMESTAMP | — |
| `updated_at` | `TIMESTAMP` | — | CURRENT_TIMESTAMP | — |

#### `a2a_task_mapping`

| 列 | 类型 | 约束 | 默认 | 外键 |
|----|------|------|------|------|
| `local_task_id` | `TEXT` | PK | — | — |
| `remote_task_id` | `TEXT` | NOT NULL | — | — |
| `remote_context_id` | `TEXT` | — | — | — |
| `agent_id` | `TEXT` | NOT NULL | — | — |
| `created_at` | `TIMESTAMP` | — | CURRENT_TIMESTAMP | — |

### Skills 知识库

#### `skills`
> Skills 知识库

| 列 | 类型 | 约束 | 默认 | 外键 |
|----|------|------|------|------|
| `id` | `TEXT` | PK | — | — |
| `workspace_id` | `TEXT` | NOT NULL | — | workspaces(id) |
| `name` | `TEXT` | NOT NULL | — | — |
| `slug` | `TEXT` | NOT NULL | — | — |
| `description` | `TEXT` | — | — | — |
| `category` | `TEXT` | — | 'general' | — |
| `tags` | `TEXT` | — | — | — |
| `content` | `TEXT` | NOT NULL | — | — |
| `version` | `INTEGER` | — | 1 | — |
| `enabled` | `INTEGER` | — | 1 | — |
| `source` | `TEXT` | — | 'custom' | — |
| `created_at` | `TIMESTAMP` | — | CURRENT_TIMESTAMP | — |
| `updated_at` | `TIMESTAMP` | — | CURRENT_TIMESTAMP | — |

**索引**：
- `idx_skills_workspace` (workspace_id)
- `idx_skills_category` (workspace_id, category)

### Rules 规则引擎

#### `rules`
> Rules 规则引擎

| 列 | 类型 | 约束 | 默认 | 外键 |
|----|------|------|------|------|
| `id` | `TEXT` | PK | — | — |
| `workspace_id` | `TEXT` | NOT NULL | — | workspaces(id) |
| `name` | `TEXT` | NOT NULL | — | — |
| `scope` | `TEXT` | — | 'global' | — |
| `scope_value` | `TEXT` | — | — | — |
| `project_id` | `TEXT` | — | — | — |
| `content` | `TEXT` | NOT NULL | — | — |
| `priority` | `INTEGER` | — | 0 | — |
| `enabled` | `INTEGER` | — | 1 | — |
| `source` | `TEXT` | — | 'custom' | — |
| `created_at` | `TIMESTAMP` | — | CURRENT_TIMESTAMP | — |
| `updated_at` | `TIMESTAMP` | — | CURRENT_TIMESTAMP | — |

**索引**：
- `idx_rules_workspace` (workspace_id)
- `idx_rules_scope` (workspace_id, scope)

### Hooks 事件驱动

#### `hooks`
> Hooks 事件驱动

| 列 | 类型 | 约束 | 默认 | 外键 |
|----|------|------|------|------|
| `id` | `TEXT` | PK | — | — |
| `workspace_id` | `TEXT` | NOT NULL | — | workspaces(id) |
| `name` | `TEXT` | NOT NULL | — | — |
| `event` | `TEXT` | NOT NULL | — | — |
| `action_type` | `TEXT` | NOT NULL | — | — |
| `action_config` | `TEXT` | NOT NULL | — | — |
| `conditions` | `TEXT` | — | — | — |
| `priority` | `INTEGER` | — | 0 | — |
| `enabled` | `INTEGER` | — | 1 | — |
| `created_at` | `TIMESTAMP` | — | CURRENT_TIMESTAMP | — |
| `updated_at` | `TIMESTAMP` | — | CURRENT_TIMESTAMP | — |

**索引**：
- `idx_hooks_event` (workspace_id, event)

### Security 安全审查

#### `security_rules`
> Security 安全审查

| 列 | 类型 | 约束 | 默认 | 外键 |
|----|------|------|------|------|
| `id` | `TEXT` | PK | — | — |
| `workspace_id` | `TEXT` | NOT NULL | — | workspaces(id) |
| `name` | `TEXT` | NOT NULL | — | — |
| `category` | `TEXT` | NOT NULL | — | — |
| `pattern` | `TEXT` | NOT NULL | — | — |
| `severity` | `TEXT` | — | 'medium' | — |
| `description` | `TEXT` | — | — | — |
| `remediation` | `TEXT` | — | — | — |
| `enabled` | `INTEGER` | — | 1 | — |
| `created_at` | `TIMESTAMP` | — | CURRENT_TIMESTAMP | — |

**索引**：
- `idx_security_rules_workspace` (workspace_id)
- `idx_security_rules_category` (workspace_id, category)

#### `security_findings`

| 列 | 类型 | 约束 | 默认 | 外键 |
|----|------|------|------|------|
| `id` | `TEXT` | PK | — | — |
| `workspace_id` | `TEXT` | NOT NULL | — | workspaces(id) |
| `task_id` | `TEXT` | — | — | tasks(id) |
| `rule_id` | `TEXT` | — | — | security_rules(id) |
| `category` | `TEXT` | NOT NULL | — | — |
| `severity` | `TEXT` | NOT NULL | — | — |
| `snippet` | `TEXT` | — | — | — |
| `location` | `TEXT` | — | — | — |
| `description` | `TEXT` | — | — | — |
| `remediation` | `TEXT` | — | — | — |
| `status` | `TEXT` | — | 'open' | — |
| `dismissed_by` | `TEXT` | — | — | — |
| `dismissed_at` | `TIMESTAMP` | — | — | — |
| `created_at` | `TIMESTAMP` | — | CURRENT_TIMESTAMP | — |

**索引**：
- `idx_security_findings_task` (task_id)
- `idx_security_findings_workspace` (workspace_id, status)

### 项目组（Project Groups）

#### `project_groups`
> 项目组定义

| 列 | 类型 | 约束 | 默认 | 外键 |
|----|------|------|------|------|
| `id` | `TEXT` | PK | — | — |
| `workspace_id` | `TEXT` | NOT NULL | — | workspaces(id) |
| `name` | `TEXT` | NOT NULL | — | — |
| `description` | `TEXT` | — | — | — |
| `created_by` | `TEXT` | — | — | — |
| `created_at` | `TIMESTAMP` | — | CURRENT_TIMESTAMP | — |
| `updated_at` | `TIMESTAMP` | — | CURRENT_TIMESTAMP | — |
| `workflow_id` | `TEXT` | via engine.py:ALTER | — | — |

**索引**：
- `idx_project_groups_workspace` (workspace_id)

#### `project_group_members`
> 项目组成员（关联项目）

| 列 | 类型 | 约束 | 默认 | 外键 |
|----|------|------|------|------|
| `id` | `TEXT` | PK | — | — |
| `group_id` | `TEXT` | NOT NULL | — | project_groups(id) |
| `project_id` | `TEXT` | NOT NULL | — | — |
| `role` | `TEXT` | — | 'member' | — |
| `display_order` | `INTEGER` | — | 0 | — |
| `added_at` | `TIMESTAMP` | — | CURRENT_TIMESTAMP | — |

**索引**：
- `idx_pgm_group` (group_id)

#### `project_group_user_members`
> 项目组用户成员（关联用户，与 project_members 对称）

| 列 | 类型 | 约束 | 默认 | 外键 |
|----|------|------|------|------|
| `id` | `TEXT` | PK | — | — |
| `group_id` | `TEXT` | NOT NULL | — | — |
| `user_id` | `TEXT` | NOT NULL | — | users(id) |
| `role` | `TEXT` | — | 'member' | — |
| `--` | `owner` | — | CURRENT_TIMESTAMP | — |

**索引**：
- `idx_pgum_user` (user_id)
- `idx_pgum_group` (group_id)
