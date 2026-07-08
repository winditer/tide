"""全局系统设置 API 路由。

当前提供全局 freeform 状态列配置：
- ``GET  /api/settings/freeform-status`` — 获取全局配置（任意登录用户可读）
- ``PUT  /api/settings/freeform-status`` — 保存全局配置（仅 admin）

数据存储在 ``system_settings`` 表，与具体项目无关。项目级配置优先于全局配置。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends

from backend.core.dependencies import get_optional_user, require_role
from backend.models.schemas import FreeformStatusListUpdate
from backend.services.work_item_service import work_item_service

logger = logging.getLogger("tide.api.settings")

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("/freeform-status")
async def get_global_freeform_status(
    current_user=Depends(get_optional_user),
):
    """获取全局 freeform 状态列表配置，无配置时返回默认值。"""
    status_list = await work_item_service.get_global_freeform_status_list()
    return {"status_list": status_list}


@router.put("/freeform-status")
async def set_global_freeform_status(
    body: FreeformStatusListUpdate,
    current_user: dict = Depends(require_role("admin")),
):
    """保存全局 freeform 状态列表配置（仅 admin）。"""
    status_list = await work_item_service.set_global_freeform_status_list(
        [it.dict() for it in body.status_list]
    )
    logger.info(
        "admin %s updated global freeform status list (%d columns)",
        current_user.get("id") if current_user else None,
        len(status_list),
    )
    return {"status_list": status_list}
