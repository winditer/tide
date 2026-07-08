from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
import os

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./tide.db")

engine = create_async_engine(DATABASE_URL, echo=False)
async_session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_session():
    async with async_session_factory() as session:
        yield session


async def init_db():
    """执行 init.sql 初始化数据库表"""
    import aiosqlite

    db_path = DATABASE_URL.replace("sqlite+aiosqlite:///", "")
    sql_path = os.path.join(os.path.dirname(__file__), "init.sql")
    async with aiosqlite.connect(db_path) as db:
        with open(sql_path) as f:
            await db.executescript(f.read())
        cursor = await db.execute("PRAGMA table_info(tasks)")
        task_columns = {row[1] for row in await cursor.fetchall()}
        if "attachments" not in task_columns:
            await db.execute("ALTER TABLE tasks ADD COLUMN attachments TEXT")
        if "commit_hash" not in task_columns:
            await db.execute("ALTER TABLE tasks ADD COLUMN commit_hash TEXT")
        if "commit_message" not in task_columns:
            await db.execute("ALTER TABLE tasks ADD COLUMN commit_message TEXT")
        if "merge_status" not in task_columns:
            await db.execute("ALTER TABLE tasks ADD COLUMN merge_status TEXT")
        if "token_input" not in task_columns:
            await db.execute("ALTER TABLE tasks ADD COLUMN token_input INTEGER DEFAULT 0")
        if "token_output" not in task_columns:
            await db.execute("ALTER TABLE tasks ADD COLUMN token_output INTEGER DEFAULT 0")
        if "estimated_cost_usd" not in task_columns:
            await db.execute("ALTER TABLE tasks ADD COLUMN estimated_cost_usd REAL DEFAULT 0")
        if "group_id" not in task_columns:
            await db.execute("ALTER TABLE tasks ADD COLUMN group_id TEXT")
        if "synced_message_count" not in task_columns:
            await db.execute("ALTER TABLE tasks ADD COLUMN synced_message_count INTEGER DEFAULT 0")
        if "retry_count" not in task_columns:
            await db.execute("ALTER TABLE tasks ADD COLUMN retry_count INTEGER DEFAULT 0")
        if "agent_final_output" not in task_columns:
            await db.execute("ALTER TABLE tasks ADD COLUMN agent_final_output TEXT")
        if "source_message_id" not in task_columns:
            await db.execute("ALTER TABLE tasks ADD COLUMN source_message_id TEXT")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_tasks_group ON tasks(group_id)")

        # approvals 表升级（兑容旧版 schema）
        cursor = await db.execute("PRAGMA table_info(approvals)")
        approval_columns = {row[1] for row in await cursor.fetchall()}
        if approval_columns:  # 表已存在时才进行补列
            if "plan_id" not in approval_columns:
                await db.execute("ALTER TABLE approvals ADD COLUMN plan_id TEXT")
            if "type" not in approval_columns:
                await db.execute("ALTER TABLE approvals ADD COLUMN type TEXT NOT NULL DEFAULT 'unknown'")
            if "detail" not in approval_columns:
                await db.execute("ALTER TABLE approvals ADD COLUMN detail TEXT DEFAULT '{}'")
            if "operator_id" not in approval_columns:
                await db.execute("ALTER TABLE approvals ADD COLUMN operator_id TEXT")

        # conversations 表兼容性迁移（已有数据库可能缺少此表或部分列）
        cursor = await db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'"
        )
        if not await cursor.fetchone():
            await db.execute("""
                CREATE TABLE conversations (
                    id TEXT PRIMARY KEY,
                    workspace_id TEXT NOT NULL,
                    chat_id TEXT,
                    agent_id TEXT DEFAULT 'codex',
                    model TEXT DEFAULT '',
                    session_id TEXT,
                    cwd TEXT,
                    status TEXT DEFAULT 'active',
                    last_active_at TEXT DEFAULT (datetime('now')),
                    created_at TEXT DEFAULT (datetime('now')),
                    metadata TEXT DEFAULT '{}'
                )
            """)
        else:
            cursor = await db.execute("PRAGMA table_info(conversations)")
            conv_columns = {row[1] for row in await cursor.fetchall()}
            if "cwd" not in conv_columns:
                await db.execute("ALTER TABLE conversations ADD COLUMN cwd TEXT")
            if "metadata" not in conv_columns:
                await db.execute("ALTER TABLE conversations ADD COLUMN metadata TEXT DEFAULT '{}'")

        # work_items 表补列：version_id（已有数据库兼容）
        cursor = await db.execute("PRAGMA table_info(work_items)")
        wi_columns = {row[1] for row in await cursor.fetchall()}
        if wi_columns and "version_id" not in wi_columns:
            await db.execute("ALTER TABLE work_items ADD COLUMN version_id TEXT")

        # 确保 version_id 索引存在（迁移后安全创建）
        await db.execute("CREATE INDEX IF NOT EXISTS idx_work_items_version ON work_items(version_id)")

        # work_items 补列 group_id（项目组关联）
        if wi_columns and "group_id" not in wi_columns:
            await db.execute("ALTER TABLE work_items ADD COLUMN group_id TEXT")

        # work_items 补列 flow_mode（协作模式：default_workflow | freeform）
        # SQLite 不支持在 ALTER TABLE 上加 CHECK 约束，取值约束在应用层校验
        if wi_columns and "flow_mode" not in wi_columns:
            await db.execute("ALTER TABLE work_items ADD COLUMN flow_mode TEXT DEFAULT 'default_workflow'")

        # work_items 增加 status 列（用于 freeform 模式手动状态设置）
        if wi_columns and "status" not in wi_columns:
            await db.execute("ALTER TABLE work_items ADD COLUMN status TEXT DEFAULT NULL")

        # project_settings 补列 flow_mode（项目默认协作模式）
        cursor = await db.execute("PRAGMA table_info(project_settings)")
        ps_columns = {row[1] for row in await cursor.fetchall()}
        if ps_columns and "flow_mode" not in ps_columns:
            await db.execute("ALTER TABLE project_settings ADD COLUMN flow_mode TEXT DEFAULT 'default_workflow'")

        # plans 补列 group_id（项目组关联，与 work_items.group_id 模式一致）
        cursor = await db.execute("PRAGMA table_info(plans)")
        plan_columns = {row[1] for row in await cursor.fetchall()}
        if plan_columns and "group_id" not in plan_columns:
            await db.execute("ALTER TABLE plans ADD COLUMN group_id TEXT")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_plans_group ON plans(group_id)")

        # project_groups 表兼容性迁移
        cursor = await db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='project_groups'"
        )
        if not await cursor.fetchone():
            await db.execute("""
                CREATE TABLE project_groups (
                    id TEXT PRIMARY KEY,
                    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
                    name TEXT NOT NULL,
                    description TEXT,
                    created_by TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(workspace_id, name)
                )
            """)
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_project_groups_workspace ON project_groups(workspace_id)"
            )

        cursor = await db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='project_group_members'"
        )
        if not await cursor.fetchone():
            await db.execute("""
                CREATE TABLE project_group_members (
                    id TEXT PRIMARY KEY,
                    group_id TEXT NOT NULL REFERENCES project_groups(id) ON DELETE CASCADE,
                    project_id TEXT NOT NULL,
                    role TEXT DEFAULT 'member',
                    display_order INTEGER DEFAULT 0,
                    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(group_id, project_id)
                )
            """)
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_pgm_group ON project_group_members(group_id)"
            )

        # project_groups 补列：workflow_id（项目组绑定的工作流模板）
        cursor = await db.execute("PRAGMA table_info(project_groups)")
        pg_columns = {row[1] for row in await cursor.fetchall()}
        if pg_columns and "workflow_id" not in pg_columns:
            await db.execute("ALTER TABLE project_groups ADD COLUMN workflow_id TEXT")

        # project_groups 补列：flow_mode（项目组协作模式）
        # 取值：default_workflow | custom_workflow | freeform；NULL 表示未设置
        if pg_columns and "flow_mode" not in pg_columns:
            await db.execute("ALTER TABLE project_groups ADD COLUMN flow_mode TEXT DEFAULT NULL")

        # project_group_user_members 表（与 project_members 对称的用户级成员）
        await db.execute("""
            CREATE TABLE IF NOT EXISTS project_group_user_members (
                id TEXT PRIMARY KEY,
                group_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                role TEXT DEFAULT 'member',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(group_id, user_id)
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_pgum_user ON project_group_user_members(user_id)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_pgum_group ON project_group_user_members(group_id)"
        )

        # 组合索引：加速按版本分组的工作项聚合查询
        await db.execute("CREATE INDEX IF NOT EXISTS idx_work_items_project_version ON work_items(project_id, version_id)")

        # approvals 防重复唯一索引（兼容旧库迁移）
        # 先清理旧的重复 pending 记录，保留每组最新一条，其余标记为 cancelled
        await db.execute("""
            UPDATE approvals SET status = 'cancelled', resolved_at = datetime('now')
            WHERE status = 'pending' AND id NOT IN (
                SELECT id FROM (
                    SELECT id, ROW_NUMBER() OVER (
                        PARTITION BY task_id, COALESCE(plan_id, ''), type
                        ORDER BY created_at DESC
                    ) AS rn
                    FROM approvals
                    WHERE status = 'pending'
                ) WHERE rn = 1
            )
        """)
        # 创建唯一索引（已在 init.sql 中定义，此处确保旧库也能补建）
        await db.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_approvals_unique_pending
            ON approvals(task_id, COALESCE(plan_id, ''), type) WHERE status = 'pending'
        """)

        # skills 表补列 project_id（项目级隔离）
        cursor = await db.execute("PRAGMA table_info(skills)")
        skills_columns = {row[1] for row in await cursor.fetchall()}
        if skills_columns and "project_id" not in skills_columns:
            await db.execute("ALTER TABLE skills ADD COLUMN project_id TEXT")

        # hooks 表补列 project_id
        cursor = await db.execute("PRAGMA table_info(hooks)")
        hooks_columns = {row[1] for row in await cursor.fetchall()}
        if hooks_columns and "project_id" not in hooks_columns:
            await db.execute("ALTER TABLE hooks ADD COLUMN project_id TEXT")

        # security_rules 表补列 project_id
        cursor = await db.execute("PRAGMA table_info(security_rules)")
        sr_columns = {row[1] for row in await cursor.fetchall()}
        if sr_columns and "project_id" not in sr_columns:
            await db.execute("ALTER TABLE security_rules ADD COLUMN project_id TEXT")

        # security_findings 表补列 project_id
        cursor = await db.execute("PRAGMA table_info(security_findings)")
        sf_columns = {row[1] for row in await cursor.fetchall()}
        if sf_columns and "project_id" not in sf_columns:
            await db.execute("ALTER TABLE security_findings ADD COLUMN project_id TEXT")

        # rules 表补列 project_id（旧数据库兼容）
        cursor = await db.execute("PRAGMA table_info(rules)")
        rules_columns = {row[1] for row in await cursor.fetchall()}
        if rules_columns and "project_id" not in rules_columns:
            await db.execute("ALTER TABLE rules ADD COLUMN project_id TEXT")

        # 项目级隔离索引（在 ALTER TABLE 之后安全创建）
        await db.execute("CREATE INDEX IF NOT EXISTS idx_skills_project ON skills(workspace_id, project_id)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_skills_project_category ON skills(workspace_id, project_id, category)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_hooks_project_event ON hooks(workspace_id, project_id, event)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_security_rules_project ON security_rules(workspace_id, project_id)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_security_findings_project ON security_findings(workspace_id, project_id)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_rules_scope_project ON rules(workspace_id, scope, project_id)")

        # expert_teams 表（专家团队）
        await db.execute("""
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
                enabled INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(workspace_id, slug)
            )
        """)
        await db.execute("CREATE INDEX IF NOT EXISTS idx_expert_teams_project ON expert_teams(workspace_id, project_id)")

        # expert_teams 补列 model（旧数据库兼容）
        cursor = await db.execute("PRAGMA table_info(expert_teams)")
        et_columns = {row[1] for row in await cursor.fetchall()}
        if et_columns and "model" not in et_columns:
            await db.execute("ALTER TABLE expert_teams ADD COLUMN model TEXT")

        # expert_teams 补列：Squad 多 Agent 支持
        if et_columns and "member_agents" not in et_columns:
            await db.execute("ALTER TABLE expert_teams ADD COLUMN member_agents TEXT DEFAULT '[]'")
        if et_columns and "is_squad" not in et_columns:
            await db.execute("ALTER TABLE expert_teams ADD COLUMN is_squad INTEGER DEFAULT 0")
        if et_columns and "leader_strategy" not in et_columns:
            await db.execute("ALTER TABLE expert_teams ADD COLUMN leader_strategy TEXT DEFAULT 'capability_match'")

        # workflows 表补列 created_by（工作流权限模型）
        cursor = await db.execute("PRAGMA table_info(workflows)")
        wf_columns = {row[1] for row in await cursor.fetchall()}
        if wf_columns and "created_by" not in wf_columns:
            await db.execute("ALTER TABLE workflows ADD COLUMN created_by TEXT")

        # workflows 表补列 is_system（内建系统工作流标记）
        if wf_columns and "is_system" not in wf_columns:
            await db.execute("ALTER TABLE workflows ADD COLUMN is_system INTEGER DEFAULT 0")
        await db.execute("""
            CREATE INDEX IF NOT EXISTS idx_workflows_system_default
            ON workflows(workspace_id, is_system DESC, created_at ASC)
            WHERE enabled = 1
        """)

        # remote_agents 表补列 scope / scope_target（远程 Agent 作用域）
        cursor = await db.execute("PRAGMA table_info(remote_agents)")
        ra_columns = {row[1] for row in await cursor.fetchall()}
        if ra_columns and "scope" not in ra_columns:
            await db.execute("ALTER TABLE remote_agents ADD COLUMN scope TEXT DEFAULT 'global'")
        if ra_columns and "scope_target" not in ra_columns:
            await db.execute("ALTER TABLE remote_agents ADD COLUMN scope_target TEXT DEFAULT ''")

        # remote_agents 补列：Daemon WebSocket 推模式
        if ra_columns and "connection_mode" not in ra_columns:
            await db.execute("ALTER TABLE remote_agents ADD COLUMN connection_mode TEXT DEFAULT 'http'")
        if ra_columns and "capability_tags" not in ra_columns:
            await db.execute("ALTER TABLE remote_agents ADD COLUMN capability_tags TEXT")
        if ra_columns and "last_heartbeat" not in ra_columns:
            await db.execute("ALTER TABLE remote_agents ADD COLUMN last_heartbeat TIMESTAMP")
        if ra_columns and "daemon_session_id" not in ra_columns:
            await db.execute("ALTER TABLE remote_agents ADD COLUMN daemon_session_id TEXT")

        # work_item_comments 表（freeform 协作评论，旧库兼容建表）
        await db.execute("""
            CREATE TABLE IF NOT EXISTS work_item_comments (
                id TEXT PRIMARY KEY,
                work_item_id TEXT NOT NULL,
                author_id TEXT NOT NULL,
                content TEXT NOT NULL,
                mentions TEXT,
                task_id TEXT,
                task_status TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_wicomments_work_item ON work_item_comments(work_item_id)"
        )

        # notifications 表（站内通知，旧库兼容建表）
        await db.execute("""
            CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY,
                recipient_id TEXT NOT NULL,
                work_item_id TEXT NOT NULL,
                notification_type TEXT NOT NULL,
                trigger_actor_id TEXT,
                content TEXT NOT NULL,
                is_read INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_notif_recipient ON notifications(recipient_id, is_read, created_at DESC)"
        )

        await db.commit()
