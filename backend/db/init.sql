-- actors 统一身份表
CREATE TABLE IF NOT EXISTS actors (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('member', 'agent', 'lark_user')),
    name TEXT NOT NULL,
    avatar_url TEXT,
    metadata TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- workspaces 工作空间
CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    owner_id TEXT REFERENCES actors(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- tasks 统一任务表
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    plan_id TEXT,
    workflow_run_id TEXT,
    workflow_node_id TEXT,
    assignee_id TEXT REFERENCES actors(id),
    assignee_type TEXT NOT NULL DEFAULT 'agent',
    chat_id TEXT,
    parent_task_id TEXT REFERENCES tasks(id),
    prompt TEXT NOT NULL,
    cwd TEXT,
    group_id TEXT,
    model TEXT,
    agent_id TEXT,
    session_id TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    result TEXT,
    attachments TEXT,
    output_path TEXT,
    worktree_path TEXT,
    branch_name TEXT,
    diff_summary TEXT,
    test_result TEXT,
    commit_hash TEXT,
    commit_message TEXT,
    merge_status TEXT,
    priority INTEGER DEFAULT 0,
    labels TEXT,
    retry_count INTEGER DEFAULT 0,
    agent_final_output TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_plan ON tasks(plan_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
-- idx_tasks_group 索引在 engine.py 迁移后创建（兼容旧表缺少 group_id 列）

-- task_events 任务事件日志
CREATE TABLE IF NOT EXISTS task_events (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    actor_id TEXT REFERENCES actors(id),
    event_type TEXT NOT NULL,
    payload TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_events_task ON task_events(task_id);
CREATE INDEX IF NOT EXISTS idx_events_time ON task_events(workspace_id, created_at);

-- plans Plan定义
CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    chat_id TEXT,
    cwd TEXT,
    model TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    max_parallel INTEGER DEFAULT 3,
    definition TEXT,
    group_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- plan_tasks Plan子任务关联
CREATE TABLE IF NOT EXISTS plan_tasks (
    plan_id TEXT NOT NULL REFERENCES plans(id),
    task_id TEXT NOT NULL REFERENCES tasks(id),
    task_index INTEGER NOT NULL,
    phase INTEGER DEFAULT 0,
    depends_on TEXT,
    PRIMARY KEY (plan_id, task_id)
);

-- approvals 审批
CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    plan_id TEXT,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    chat_id TEXT,
    type TEXT NOT NULL DEFAULT 'unknown',
    detail TEXT DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    operator_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    resolved_at TEXT,
    FOREIGN KEY (task_id) REFERENCES tasks(id)
);
CREATE INDEX IF NOT EXISTS idx_approvals_task ON approvals(task_id);
CREATE INDEX IF NOT EXISTS idx_approvals_workspace_status ON approvals(workspace_id, status);
-- idx_approvals_unique_pending 在 engine.py 迁移后创建（兼容旧表缺少 plan_id/type 列）

-- schedules 定时任务
CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    name TEXT NOT NULL,
    description TEXT,
    trigger_type TEXT NOT NULL CHECK(trigger_type IN ('cron', 'interval', 'date')),
    trigger_config TEXT NOT NULL,
    task_type TEXT NOT NULL CHECK(task_type IN ('agent', 'plan', 'workflow', 'status', 'custom')),
    task_config TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    last_run_at TIMESTAMP,
    next_run_at TIMESTAMP,
    run_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- schedule_runs 定时任务执行记录
CREATE TABLE IF NOT EXISTS schedule_runs (
    id TEXT PRIMARY KEY,
    schedule_id TEXT NOT NULL REFERENCES schedules(id),
    task_id TEXT REFERENCES tasks(id),
    status TEXT NOT NULL DEFAULT 'running',
    trigger_type TEXT,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    result TEXT,
    error TEXT
);

-- workflows 工作流定义
CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    name TEXT NOT NULL,
    description TEXT,
    definition TEXT NOT NULL,
    version INTEGER DEFAULT 1,
    enabled INTEGER DEFAULT 1,
    created_by TEXT,
    is_system INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- workflow_runs 工作流运行实例
CREATE TABLE IF NOT EXISTS workflow_runs (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(id),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    status TEXT NOT NULL DEFAULT 'running',
    current_node_ids TEXT,
    context TEXT,
    trigger_type TEXT DEFAULT 'manual',
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- workflow_node_runs 工作流节点执行记录
CREATE TABLE IF NOT EXISTS workflow_node_runs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES workflow_runs(id),
    node_id TEXT NOT NULL,
    task_id TEXT REFERENCES tasks(id),
    status TEXT NOT NULL DEFAULT 'pending',
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    output TEXT,
    error TEXT
);

-- conversations 会话管理
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    chat_id TEXT,                    -- Lark chat_id（可为空，Web 端不需要）
    agent_id TEXT DEFAULT 'codex',   -- 当前使用的 Agent
    model TEXT DEFAULT '',           -- 当前使用的模型
    session_id TEXT,                 -- 最近一次 Agent session ID
    cwd TEXT,                        -- 工作目录
    status TEXT DEFAULT 'active',    -- active, idle, closed
    last_active_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    metadata TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_conversations_workspace ON conversations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_conversations_chat ON conversations(chat_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(workspace_id, status);

-- project_settings 项目设置（存储项目绑定的工作流等配置）
CREATE TABLE IF NOT EXISTS project_settings (
    project_id TEXT PRIMARY KEY,
    workflow_id TEXT,
    default_assignee TEXT,
    metadata TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- system_settings 全局系统配置（key-value 存储，与项目无关）
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- versions 版本（项目级版本管理）
CREATE TABLE IF NOT EXISTS versions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'active',  -- active | released | archived
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_versions_project ON versions(project_id);

-- work_items 工作项
CREATE TABLE IF NOT EXISTS work_items (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    workflow_id TEXT NOT NULL,
    current_node_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    priority INTEGER DEFAULT 0,
    assignee TEXT,
    tags TEXT,
    source_type TEXT DEFAULT 'manual',
    source_id TEXT,
    metadata TEXT,
    version_id TEXT REFERENCES versions(id),
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT,
    planned_start_date TEXT,
    planned_end_date TEXT
);
-- idx_work_items_version 索引在 engine.py 迁移后创建（兼容旧表缺少 version_id 列）

-- work_item_transitions 工作项流转记录
CREATE TABLE IF NOT EXISTS work_item_transitions (
    id TEXT PRIMARY KEY,
    work_item_id TEXT NOT NULL REFERENCES work_items(id),
    from_node_id TEXT,
    to_node_id TEXT NOT NULL,
    trigger_type TEXT DEFAULT 'manual',
    task_id TEXT,
    operator TEXT,
    output TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- work_item_assignments 工作项分配记录
CREATE TABLE IF NOT EXISTS work_item_assignments (
    id TEXT PRIMARY KEY,
    work_item_id TEXT NOT NULL REFERENCES work_items(id),
    target_type TEXT NOT NULL CHECK(target_type IN ('member', 'expert_team', 'squad')),
    target_id TEXT NOT NULL,
    role TEXT DEFAULT 'executor',
    status TEXT DEFAULT 'pending',
    assigned_by TEXT,
    dispatched_to TEXT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_wia_work_item ON work_item_assignments(work_item_id);
CREATE INDEX IF NOT EXISTS idx_wia_target ON work_item_assignments(target_type, target_id);

-- work_item_context 工作项共享记忆
CREATE TABLE IF NOT EXISTS work_item_context (
    id TEXT PRIMARY KEY,
    work_item_id TEXT NOT NULL REFERENCES work_items(id),
    context_type TEXT NOT NULL,
    content TEXT NOT NULL,
    author_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_wic_work_item ON work_item_context(work_item_id, created_at);

-- work_item_comments 工作项评论（freeform 协作核心交互）
CREATE TABLE IF NOT EXISTS work_item_comments (
    id TEXT PRIMARY KEY,
    work_item_id TEXT NOT NULL,
    author_id TEXT NOT NULL,
    content TEXT NOT NULL,
    mentions TEXT,
    task_id TEXT,
    task_status TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_wicomments_work_item ON work_item_comments(work_item_id);

-- 默认工作空间和 Agent actors（初始数据）
INSERT OR IGNORE INTO actors (id, type, name, metadata) VALUES
    ('agent-codex', 'agent', 'Codex', '{"agent_id": "codex"}'),
    ('agent-claude', 'agent', 'Claude', '{"agent_id": "claude"}'),
    ('agent-qoder', 'agent', 'Qoder', '{"agent_id": "qoder"}');

INSERT OR IGNORE INTO workspaces (id, name, slug) VALUES
    ('default', 'Default Workspace', 'default');

-- =============================================
-- 认证与权限
-- =============================================

-- 用户表
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT,            -- Lark 用户可为 NULL
    display_name TEXT,
    avatar_url TEXT,
    role TEXT DEFAULT 'member',    -- admin | member | viewer
    status TEXT DEFAULT 'active',  -- active | disabled
    lark_open_id TEXT UNIQUE,
    lark_union_id TEXT UNIQUE,
    workspace_id TEXT DEFAULT 'default',
    last_login_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 用户会话表（管理 refresh token）
CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    refresh_token_hash TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    is_active INTEGER DEFAULT 1,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP
);

-- 项目成员表（项目级隔离）
CREATE TABLE IF NOT EXISTS project_members (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id),
    role TEXT DEFAULT 'member',   -- owner | member | viewer
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(is_active, expires_at);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_users_lark_open_id ON users(lark_open_id);

-- ============================================================
-- A2A Remote Agent Support
-- ============================================================

CREATE TABLE IF NOT EXISTS remote_agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    agent_card_url TEXT NOT NULL,
    agent_card_json TEXT,
    endpoint_url TEXT NOT NULL,
    protocol_binding TEXT DEFAULT 'JSONRPC',
    protocol_version TEXT DEFAULT '1.0',
    auth_type TEXT DEFAULT 'bearer',
    auth_credentials TEXT,
    auth_header_name TEXT,
    capabilities_streaming BOOLEAN DEFAULT FALSE,
    capabilities_push_notifications BOOLEAN DEFAULT FALSE,
    skills_json TEXT,
    approval_required BOOLEAN DEFAULT TRUE,
    approval_policy TEXT DEFAULT 'on-request',
    timeout_ms INTEGER DEFAULT 300000,
    max_retries INTEGER DEFAULT 2,
    status TEXT DEFAULT 'active',
    scope TEXT DEFAULT 'global',
    scope_target TEXT DEFAULT '',
    connection_mode TEXT DEFAULT 'http',
    capability_tags TEXT,
    last_heartbeat TIMESTAMP,
    daemon_session_id TEXT,
    last_health_check TIMESTAMP,
    last_error TEXT,
    workspace_id TEXT,
    created_by TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS a2a_task_mapping (
    local_task_id TEXT PRIMARY KEY,
    remote_task_id TEXT NOT NULL,
    remote_context_id TEXT,
    agent_id TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Token 成本追踪
-- ============================================================

-- 注意: tasks 表的 token_input/token_output/estimated_cost_usd 列
-- 通过 engine.py 运行时迁移添加（ALTER TABLE IF NOT EXISTS 不被 SQLite 支持）

-- ============================================================
-- Skills 知识库
-- ============================================================

CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    category TEXT DEFAULT 'general',
    tags TEXT,
    content TEXT NOT NULL,
    version INTEGER DEFAULT 1,
    enabled INTEGER DEFAULT 1,
    source TEXT DEFAULT 'custom',
    project_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(workspace_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_skills_workspace ON skills(workspace_id);
CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(workspace_id, category);
-- idx_skills_project / idx_skills_project_category 在 engine.py 迁移后创建（兼容旧表缺少 project_id 列）

-- ============================================================
-- Rules 规则引擎
-- ============================================================

CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    name TEXT NOT NULL,
    scope TEXT DEFAULT 'global',
    scope_value TEXT,
    project_id TEXT,
    content TEXT NOT NULL,
    priority INTEGER DEFAULT 0,
    enabled INTEGER DEFAULT 1,
    source TEXT DEFAULT 'custom',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_rules_workspace ON rules(workspace_id);
CREATE INDEX IF NOT EXISTS idx_rules_scope ON rules(workspace_id, scope);
-- idx_rules_scope_project 在 engine.py 迁移后创建（兼容旧表缺少 project_id 列）

-- ============================================================
-- Hooks 事件驱动
-- ============================================================

CREATE TABLE IF NOT EXISTS hooks (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    name TEXT NOT NULL,
    event TEXT NOT NULL,
    action_type TEXT NOT NULL,
    action_config TEXT NOT NULL,
    conditions TEXT,
    project_id TEXT,
    priority INTEGER DEFAULT 0,
    enabled INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hooks_event ON hooks(workspace_id, event);
-- idx_hooks_project_event 在 engine.py 迁移后创建（兼容旧表缺少 project_id 列）

-- ============================================================
-- Security 安全审查
-- ============================================================

CREATE TABLE IF NOT EXISTS security_rules (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    pattern TEXT NOT NULL,
    severity TEXT DEFAULT 'medium',
    description TEXT,
    remediation TEXT,
    project_id TEXT,
    enabled INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_security_rules_workspace ON security_rules(workspace_id);
CREATE INDEX IF NOT EXISTS idx_security_rules_category ON security_rules(workspace_id, category);
-- idx_security_rules_project 在 engine.py 迁移后创建（兼容旧表缺少 project_id 列）

CREATE TABLE IF NOT EXISTS security_findings (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    task_id TEXT REFERENCES tasks(id),
    rule_id TEXT REFERENCES security_rules(id),
    category TEXT NOT NULL,
    severity TEXT NOT NULL,
    snippet TEXT,
    location TEXT,
    description TEXT,
    remediation TEXT,
    project_id TEXT,
    status TEXT DEFAULT 'open',
    dismissed_by TEXT,
    dismissed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_security_findings_task ON security_findings(task_id);
CREATE INDEX IF NOT EXISTS idx_security_findings_workspace ON security_findings(workspace_id, status);
-- idx_security_findings_project 在 engine.py 迁移后创建（兼容旧表缺少 project_id 列）

-- ============================================================
-- 项目组（Project Groups）
-- ============================================================

-- 项目组定义
CREATE TABLE IF NOT EXISTS project_groups (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    name TEXT NOT NULL,
    description TEXT,
    created_by TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(workspace_id, name)
);
CREATE INDEX IF NOT EXISTS idx_project_groups_workspace ON project_groups(workspace_id);

-- 项目组成员（关联项目）
CREATE TABLE IF NOT EXISTS project_group_members (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES project_groups(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    role TEXT DEFAULT 'member',
    display_order INTEGER DEFAULT 0,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(group_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_pgm_group ON project_group_members(group_id);

-- 项目组用户成员（关联用户，与 project_members 对称）
CREATE TABLE IF NOT EXISTS project_group_user_members (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id),
    role TEXT DEFAULT 'member',  -- owner | member | viewer
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_pgum_user ON project_group_user_members(user_id);
CREATE INDEX IF NOT EXISTS idx_pgum_group ON project_group_user_members(group_id);

-- ============================================================
-- Expert Teams 专家团队
-- ============================================================

CREATE TABLE IF NOT EXISTS expert_teams (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'default',
    project_id TEXT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    agent_id TEXT NOT NULL,
    model TEXT,
    skill_slugs TEXT DEFAULT '[]',
    role_prompt TEXT,
    member_agents TEXT DEFAULT '[]',
    is_squad INTEGER DEFAULT 0,
    leader_strategy TEXT DEFAULT 'capability_match',
    enabled INTEGER DEFAULT 1,
    created_by TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(workspace_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_expert_teams_project ON expert_teams(workspace_id, project_id);

-- ============================================================
-- Agent Configs 配置覆盖层
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_configs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'default',
    agent_id TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'global',
    scope_target TEXT,
    enabled INTEGER DEFAULT 1,
    display_name TEXT,
    description TEXT,
    model_override TEXT,
    timeout_override INTEGER,
    config_json TEXT,
    created_by TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(workspace_id, agent_id, scope, scope_target)
);
CREATE INDEX IF NOT EXISTS idx_agent_configs_scope ON agent_configs(workspace_id, scope, scope_target);
CREATE INDEX IF NOT EXISTS idx_agent_configs_agent ON agent_configs(agent_id);

-- ── Notifications ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    recipient_id TEXT NOT NULL,
    work_item_id TEXT NOT NULL,
    notification_type TEXT NOT NULL,
    trigger_actor_id TEXT,
    content TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notif_recipient ON notifications(recipient_id, is_read, created_at DESC);

-- ── Daemon Tokens ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS daemon_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    name TEXT,
    status TEXT DEFAULT 'active',
    last_used_at TIMESTAMP,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_daemon_tokens_user_id ON daemon_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_daemon_tokens_hash ON daemon_tokens(token_hash);

-- ── API Tokens ──────────────────────────────
CREATE TABLE IF NOT EXISTS api_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    token_hash TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    prefix TEXT NOT NULL,
    last_used_at TIMESTAMP,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user_id ON api_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);
