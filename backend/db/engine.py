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

        await db.commit()
