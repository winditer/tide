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

        await db.commit()
