"""项目版本管理 API。

每个版本归属于一个项目，可作为工作项的归档维度。
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text

from backend.core.dependencies import (
    check_project_write_permission_with_group,
    get_accessible_project_ids,
    get_optional_user,
)
from backend.db.engine import async_session_factory
from backend.models.schemas import (
    VersionCreate,
    VersionResponse,
    VersionUpdate,
)

router = APIRouter(prefix="/api/versions", tags=["versions"])


_ALLOWED_STATUSES = {"active", "released", "archived"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _ensure_not_viewer(current_user: Optional[dict]) -> None:
    if current_user and current_user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot modify resources")


def _row_to_version(row) -> dict:
    return dict(row._mapping)


@router.get("", response_model=list[VersionResponse])
async def list_versions(
    project_id: Optional[str] = Query(None, description="按项目过滤"),
    current_user=Depends(get_optional_user),
):
    """列出版本。

    - 未指定 ``project_id`` 时返回当前用户可访问项目下的所有版本；
    - 指定 ``project_id`` 时仅返回该项目的版本，并校验访问权限。
    """
    accessible_pids = await get_accessible_project_ids(current_user)
    conditions: list[str] = []
    params: dict = {}

    if project_id:
        if accessible_pids is not None and project_id not in accessible_pids:
            return []
        conditions.append("project_id = :project_id")
        params["project_id"] = project_id

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    async with async_session_factory() as session:
        result = await session.execute(
            text(
                f"""
                SELECT id, project_id, name, description, status, created_at, updated_at
                FROM versions
                {where}
                ORDER BY created_at DESC
                """
            ),
            params,
        )
        rows = result.fetchall()

    items = [_row_to_version(r) for r in rows]
    if accessible_pids is not None and not project_id:
        items = [it for it in items if it.get("project_id") in accessible_pids]
    return items


@router.post("", response_model=VersionResponse)
async def create_version(
    body: VersionCreate,
    current_user=Depends(get_optional_user),
):
    """创建版本。"""
    _ensure_not_viewer(current_user)
    await check_project_write_permission_with_group(body.project_id, current_user)

    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")

    status = body.status or "active"
    if status not in _ALLOWED_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status, expected one of {sorted(_ALLOWED_STATUSES)}",
        )

    version_id = str(uuid.uuid4())
    now = _now_iso()
    async with async_session_factory() as session:
        await session.execute(
            text(
                """
                INSERT INTO versions
                    (id, project_id, name, description, status, created_at, updated_at)
                VALUES
                    (:id, :project_id, :name, :description, :status, :created_at, :updated_at)
                """
            ),
            {
                "id": version_id,
                "project_id": body.project_id,
                "name": name,
                "description": (body.description or None),
                "status": status,
                "created_at": now,
                "updated_at": now,
            },
        )
        await session.commit()

        row = (
            await session.execute(
                text(
                    "SELECT id, project_id, name, description, status, created_at, updated_at"
                    " FROM versions WHERE id = :id"
                ),
                {"id": version_id},
            )
        ).fetchone()

    if not row:
        raise HTTPException(status_code=500, detail="Failed to create version")
    return _row_to_version(row)


@router.patch("/{version_id}", response_model=VersionResponse)
async def update_version(
    version_id: str,
    body: VersionUpdate,
    current_user=Depends(get_optional_user),
):
    """更新版本字段。"""
    _ensure_not_viewer(current_user)

    async with async_session_factory() as session:
        existing = (
            await session.execute(
                text(
                    "SELECT id, project_id, name, description, status, created_at, updated_at"
                    " FROM versions WHERE id = :id"
                ),
                {"id": version_id},
            )
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Version not found")

        existing_dict = dict(existing._mapping)
        await check_project_write_permission_with_group(
            existing_dict.get("project_id"), current_user
        )

        sets: list[str] = []
        params: dict = {"id": version_id}
        if body.name is not None:
            n = body.name.strip()
            if not n:
                raise HTTPException(status_code=400, detail="name cannot be empty")
            sets.append("name = :name")
            params["name"] = n
        if body.description is not None:
            sets.append("description = :description")
            params["description"] = body.description or None
        if body.status is not None:
            if body.status not in _ALLOWED_STATUSES:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid status, expected one of {sorted(_ALLOWED_STATUSES)}",
                )
            sets.append("status = :status")
            params["status"] = body.status

        if not sets:
            return existing_dict

        sets.append("updated_at = :updated_at")
        params["updated_at"] = _now_iso()

        await session.execute(
            text(f"UPDATE versions SET {', '.join(sets)} WHERE id = :id"),
            params,
        )
        await session.commit()

        row = (
            await session.execute(
                text(
                    "SELECT id, project_id, name, description, status, created_at, updated_at"
                    " FROM versions WHERE id = :id"
                ),
                {"id": version_id},
            )
        ).fetchone()

    return _row_to_version(row) if row else existing_dict


@router.delete("/{version_id}")
async def delete_version(
    version_id: str,
    current_user=Depends(get_optional_user),
):
    """删除版本。

    关联的工作项 ``version_id`` 字段将被置为 NULL，工作项本身保留。
    """
    _ensure_not_viewer(current_user)

    async with async_session_factory() as session:
        existing = (
            await session.execute(
                text("SELECT id, project_id FROM versions WHERE id = :id"),
                {"id": version_id},
            )
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Version not found")

        await check_project_write_permission_with_group(existing[1], current_user)

        # 解关联工作项
        await session.execute(
            text("UPDATE work_items SET version_id = NULL WHERE version_id = :id"),
            {"id": version_id},
        )
        await session.execute(
            text("DELETE FROM versions WHERE id = :id"),
            {"id": version_id},
        )
        await session.commit()

    return {"ok": True}
