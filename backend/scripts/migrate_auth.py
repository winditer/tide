"""
迁移脚本：将现有 Lark 用户关联到 users 表。

扫描 conversations 表，从以下来源中收集唯一的 Lark 标识（lark_open_id）：
- conversations.chat_id（非空时直接作为 lark_open_id 使用）
- conversations.metadata 中的 sender_open_id / open_id 字段（如有）

每个唯一的 lark_open_id 会在 users 表中创建一条记录（已存在则跳过）：
- username: lark_{open_id[:8]}
- role: member
- status: active
- password_hash: NULL（Lark 用户无密码登录）
- workspace_id: default

幂等运行：使用 INSERT OR IGNORE + 显式预检，重复执行不会报错。

用法：
    cd /Users/haifeng/Documents/tide
    python -m backend.scripts.migrate_auth

可选环境变量：
    MIGRATE_DB_PATH        SQLite 文件路径（默认 ./tide.db）
    MIGRATE_WORKSPACE_ID   目标 workspace（默认 default）
    MIGRATE_DRY_RUN=1      只打印不写入
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("migrate_auth")

PROJECT_ROOT = Path(__file__).resolve().parents[2]

DB_PATH = Path(os.getenv("MIGRATE_DB_PATH", str(PROJECT_ROOT / "tide.db")))
WORKSPACE_ID = os.getenv("MIGRATE_WORKSPACE_ID", "default")
DRY_RUN = os.getenv("MIGRATE_DRY_RUN", "0") == "1"
INIT_SQL = PROJECT_ROOT / "backend" / "db" / "init.sql"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _ensure_schema(conn: sqlite3.Connection) -> None:
    """保证目标库 users 表已存在（执行 init.sql 中的 CREATE TABLE IF NOT EXISTS）。"""
    if not INIT_SQL.exists():
        logger.warning("init.sql 不存在: %s，跳过 schema 初始化", INIT_SQL)
        return
    with INIT_SQL.open("r", encoding="utf-8") as fp:
        conn.executescript(fp.read())
    conn.commit()


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    cur = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (table,),
    )
    return cur.fetchone() is not None


def collect_open_ids(conn: sqlite3.Connection) -> list[str]:
    """从 conversations 表中提取唯一的 Lark open_id 列表。"""
    if not _table_exists(conn, "conversations"):
        logger.warning("conversations 表不存在，无可迁移数据")
        return []

    seen: set[str] = set()
    ordered: list[str] = []

    cur = conn.execute(
        "SELECT chat_id, metadata FROM conversations"
        " WHERE chat_id IS NOT NULL OR metadata IS NOT NULL"
    )
    for chat_id, metadata in cur.fetchall():
        candidates: list[str] = []
        if chat_id:
            candidates.append(str(chat_id).strip())
        if metadata:
            try:
                meta = json.loads(metadata) if isinstance(metadata, str) else (metadata or {})
            except (json.JSONDecodeError, TypeError):
                meta = {}
            for key in ("sender_open_id", "lark_open_id", "open_id", "user_open_id"):
                value = meta.get(key) if isinstance(meta, dict) else None
                if value:
                    candidates.append(str(value).strip())

        for value in candidates:
            if not value or value in seen:
                continue
            seen.add(value)
            ordered.append(value)

    return ordered


def upsert_lark_users(conn: sqlite3.Connection, open_ids: list[str]) -> tuple[int, int]:
    """为 open_ids 在 users 表中创建记录，返回 (created, skipped)。"""
    if not _table_exists(conn, "users"):
        logger.error("users 表不存在，请先执行 init_db / init.sql")
        return 0, 0

    created = 0
    skipped = 0
    cur = conn.cursor()

    for open_id in open_ids:
        # 已存在同 lark_open_id 的用户则跳过
        cur.execute(
            "SELECT id FROM users WHERE lark_open_id = ? LIMIT 1",
            (open_id,),
        )
        if cur.fetchone():
            skipped += 1
            continue

        username = f"lark_{open_id[:8]}"
        # username 唯一约束：若意外重名则补 open_id 更长前缀以降低冲突概率
        cur.execute("SELECT id FROM users WHERE username = ? LIMIT 1", (username,))
        if cur.fetchone():
            username = f"lark_{open_id[:12]}"
            cur.execute("SELECT id FROM users WHERE username = ? LIMIT 1", (username,))
            if cur.fetchone():
                # 仍冲突则附加随机后缀
                username = f"lark_{open_id[:8]}_{uuid.uuid4().hex[:4]}"

        if DRY_RUN:
            logger.info("DRY-RUN: 将创建 user username=%s lark_open_id=%s", username, open_id)
            created += 1
            continue

        now = _now_iso()
        cur.execute(
            """
            INSERT OR IGNORE INTO users
                (id, username, email, password_hash, display_name, avatar_url,
                 role, status, lark_open_id, lark_union_id, workspace_id,
                 last_login_at, created_at, updated_at)
            VALUES
                (?, ?, NULL, NULL, ?, NULL,
                 'member', 'active', ?, NULL, ?,
                 NULL, ?, ?)
            """,
            (
                str(uuid.uuid4()),
                username,
                username,
                open_id,
                WORKSPACE_ID,
                now,
                now,
            ),
        )
        if cur.rowcount > 0:
            created += 1
        else:
            skipped += 1

    if not DRY_RUN:
        conn.commit()
    return created, skipped


def main() -> int:
    logger.info(
        "db=%s workspace=%s dry_run=%s",
        DB_PATH, WORKSPACE_ID, DRY_RUN,
    )

    if not DB_PATH.exists():
        logger.error("数据库文件不存在: %s", DB_PATH)
        return 2

    conn = sqlite3.connect(str(DB_PATH))
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        _ensure_schema(conn)

        open_ids = collect_open_ids(conn)
        logger.info("发现唯一 Lark open_id: %d 个", len(open_ids))

        if not open_ids:
            logger.info("无可迁移的 Lark 用户，结束")
            return 0

        created, skipped = upsert_lark_users(conn, open_ids)
        logger.info("迁移完成: 新建 %d 个, 已存在跳过 %d 个", created, skipped)
    finally:
        conn.close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
