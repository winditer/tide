"""
将旧数据库 `lark2agent.db` 中的 plans / plan_tasks / conversations 数据
迁移到新数据库 `tide.db`。

项目重命名后默认数据库切换为 `tide.db`，本脚本将历史 Plan 数据搬迁过来。
plan_tasks 依赖 tasks 表的外键，所以同时迁移被引用的 tasks 记录。

幂等运行：使用 INSERT OR IGNORE，重复执行不会报错。

运行方式：
    cd /Users/haifeng/Documents/tide
    python -m backend.scripts.migrate_plans

可选环境变量：
    MIGRATE_SRC_DB   旧数据库路径（默认 ./lark2agent.db）
    MIGRATE_DST_DB   新数据库路径（默认 ./tide.db）
    MIGRATE_DRY_RUN=1  只打印不写入
"""

from __future__ import annotations

import logging
import os
import sqlite3
import sys
from pathlib import Path

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("migrate_plans")

PROJECT_ROOT = Path(__file__).resolve().parents[2]

SRC_DB = Path(os.getenv("MIGRATE_SRC_DB", str(PROJECT_ROOT / "lark2agent.db")))
DST_DB = Path(os.getenv("MIGRATE_DST_DB", str(PROJECT_ROOT / "tide.db")))
INIT_SQL = PROJECT_ROOT / "backend" / "db" / "init.sql"
DRY_RUN = os.getenv("MIGRATE_DRY_RUN", "0") == "1"


def _ensure_schema(conn: sqlite3.Connection) -> None:
    """确保目标库存在所需表结构（执行 init.sql，使用 CREATE TABLE IF NOT EXISTS）。"""
    if not INIT_SQL.exists():
        logger.warning("init.sql 不存在: %s，跳过 schema 初始化", INIT_SQL)
        return
    with INIT_SQL.open("r", encoding="utf-8") as fp:
        conn.executescript(fp.read())
    conn.commit()


def _table_columns(conn: sqlite3.Connection, table: str) -> list[str]:
    cur = conn.execute(f"PRAGMA table_info({table})")
    return [row[1] for row in cur.fetchall()]


def _copy_table(
    src: sqlite3.Connection,
    dst: sqlite3.Connection,
    table: str,
    *,
    where: str = "",
    params: tuple = (),
) -> int:
    """按目标表的列集复制数据，使用 INSERT OR IGNORE。返回成功插入的行数。"""
    src_cols = _table_columns(src, table)
    dst_cols = _table_columns(dst, table)
    if not src_cols:
        logger.warning("源库不存在表 %s，跳过", table)
        return 0
    if not dst_cols:
        logger.warning("目标库不存在表 %s，跳过", table)
        return 0

    common = [c for c in dst_cols if c in src_cols]
    if not common:
        logger.warning("表 %s 在两库间无共同列，跳过", table)
        return 0

    select_cols = ", ".join(common)
    placeholders = ", ".join(["?"] * len(common))
    sql = f"SELECT {select_cols} FROM {table}"
    if where:
        sql += f" WHERE {where}"

    rows = list(src.execute(sql, params).fetchall())
    if not rows:
        logger.info("表 %s 源库无数据", table)
        return 0

    if DRY_RUN:
        logger.info("DRY-RUN: 将向 %s 插入 %d 行（共同列 %d 个）", table, len(rows), len(common))
        return 0

    cur = dst.cursor()
    insert_sql = f"INSERT OR IGNORE INTO {table} ({select_cols}) VALUES ({placeholders})"
    inserted = 0
    for row in rows:
        cur.execute(insert_sql, row)
        inserted += cur.rowcount if cur.rowcount > 0 else 0
    dst.commit()
    return inserted


def main() -> int:
    logger.info("src=%s dst=%s dry_run=%s", SRC_DB, DST_DB, DRY_RUN)

    if not SRC_DB.exists():
        logger.error("源数据库不存在: %s", SRC_DB)
        return 2

    src = sqlite3.connect(str(SRC_DB))
    dst = sqlite3.connect(str(DST_DB))
    try:
        # 暂时关闭目标库外键检查，避免 plan_tasks 引用 tasks 时的瞬态约束失败
        dst.execute("PRAGMA foreign_keys = OFF")
        _ensure_schema(dst)

        # 1) plans
        plans_inserted = _copy_table(src, dst, "plans")
        logger.info("plans: 新增 %d 条", plans_inserted)

        # 2) 迁移 plan_tasks 所引用的 tasks（避免外键悬挂）
        # 收集旧库中 plan_tasks.task_id 集合
        plan_task_ids = [
            row[0] for row in src.execute("SELECT DISTINCT task_id FROM plan_tasks").fetchall()
        ]
        tasks_inserted = 0
        if plan_task_ids:
            placeholders = ",".join("?" for _ in plan_task_ids)
            tasks_inserted = _copy_table(
                src,
                dst,
                "tasks",
                where=f"id IN ({placeholders})",
                params=tuple(plan_task_ids),
            )
        logger.info("tasks (被 plan_tasks 引用): 新增 %d 条", tasks_inserted)

        # 3) plan_tasks
        plan_tasks_inserted = _copy_table(src, dst, "plan_tasks")
        logger.info("plan_tasks: 新增 %d 条", plan_tasks_inserted)

        # 4) conversations（如有）
        conversations_inserted = _copy_table(src, dst, "conversations")
        logger.info("conversations: 新增 %d 条", conversations_inserted)

        total = plans_inserted + tasks_inserted + plan_tasks_inserted + conversations_inserted
        logger.info(
            "迁移完成: plans=%d, tasks=%d, plan_tasks=%d, conversations=%d, 合计=%d",
            plans_inserted,
            tasks_inserted,
            plan_tasks_inserted,
            conversations_inserted,
            total,
        )
    finally:
        src.close()
        dst.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
