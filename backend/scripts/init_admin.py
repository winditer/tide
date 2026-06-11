"""
独立脚本：初始化管理员用户。

启动时会执行 init.sql 确保表结构存在，然后调用 AuthService.ensure_admin_exists()
按 TIDE_ADMIN_USERNAME / TIDE_ADMIN_PASSWORD 创建首个管理员（如已存在则跳过）。

幂等运行：重复执行不会重复创建管理员。

用法：
    cd /Users/haifeng/Documents/tide
    python -m backend.scripts.init_admin
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("init_admin")


async def main() -> int:
    # 延迟导入：保证 logging 已就绪、PYTHONPATH 已生效
    from backend.db.engine import init_db
    from backend.services.auth_service import auth_service

    await init_db()
    await auth_service.ensure_admin_exists()
    logger.info("Admin initialization complete.")
    print("Admin initialization complete.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
