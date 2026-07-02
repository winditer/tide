"""初始化技能库、专家团、安全审查规则、Workflow 数据。

从 seed_data.json 读取数据并写入数据库，已存在的记录（按 id 判重）跳过不覆盖。

用法：
    python -m backend.scripts.seed_settings
"""

import asyncio
import json
import logging
import os
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
logger = logging.getLogger("seed_settings")

# 确保项目根目录在 sys.path
ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))


async def main():
    from backend.db.engine import async_session_factory, init_db
    from sqlalchemy import text

    # 确保表已创建
    await init_db()

    seed_file = Path(__file__).parent / "seed_data.json"
    if not seed_file.exists():
        logger.error("seed_data.json 不存在，请先在本地导出数据")
        sys.exit(1)

    with open(seed_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    stats = {"skills": 0, "expert_teams": 0, "security_rules": 0, "workflows": 0}

    async with async_session_factory() as session:
        # ─── Skills ───
        for row in data.get("skills", []):
            exists = (await session.execute(
                text("SELECT 1 FROM skills WHERE id = :id"), {"id": row["id"]}
            )).fetchone()
            if exists:
                continue
            cols = list(row.keys())
            placeholders = ", ".join(f":{c}" for c in cols)
            col_names = ", ".join(cols)
            await session.execute(
                text(f"INSERT INTO skills ({col_names}) VALUES ({placeholders})"),
                row,
            )
            stats["skills"] += 1

        # ─── Expert Teams ───
        for row in data.get("expert_teams", []):
            exists = (await session.execute(
                text("SELECT 1 FROM expert_teams WHERE id = :id"), {"id": row["id"]}
            )).fetchone()
            if exists:
                continue
            cols = list(row.keys())
            placeholders = ", ".join(f":{c}" for c in cols)
            col_names = ", ".join(cols)
            await session.execute(
                text(f"INSERT INTO expert_teams ({col_names}) VALUES ({placeholders})"),
                row,
            )
            stats["expert_teams"] += 1

        # ─── Security Rules ───
        for row in data.get("security_rules", []):
            exists = (await session.execute(
                text("SELECT 1 FROM security_rules WHERE id = :id"), {"id": row["id"]}
            )).fetchone()
            if exists:
                continue
            cols = list(row.keys())
            placeholders = ", ".join(f":{c}" for c in cols)
            col_names = ", ".join(cols)
            await session.execute(
                text(f"INSERT INTO security_rules ({col_names}) VALUES ({placeholders})"),
                row,
            )
            stats["security_rules"] += 1

        # ─── Workflows ───
        for row in data.get("workflows", []):
            exists = (await session.execute(
                text("SELECT 1 FROM workflows WHERE id = :id"), {"id": row["id"]}
            )).fetchone()
            if exists:
                continue
            cols = list(row.keys())
            placeholders = ", ".join(f":{c}" for c in cols)
            col_names = ", ".join(cols)
            await session.execute(
                text(f"INSERT INTO workflows ({col_names}) VALUES ({placeholders})"),
                row,
            )
            stats["workflows"] += 1

        await session.commit()

    print("初始化完成:")
    print(f"  技能库: {stats['skills']} 条新增")
    print(f"  专家团: {stats['expert_teams']} 条新增")
    print(f"  安全审查规则: {stats['security_rules']} 条新增")
    print(f"  Workflow: {stats['workflows']} 条新增")


if __name__ == "__main__":
    asyncio.run(main())
