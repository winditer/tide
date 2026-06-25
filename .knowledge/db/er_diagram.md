# ER 关系图

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