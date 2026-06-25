"""知识图谱 API。

路由：
- ``GET    /api/knowledge/{scope}/{target_id}/files``       — 列出仓库 ``.knowledge/`` 下文件
- ``GET    /api/knowledge/{scope}/{target_id}/file``        — 读取单个文件（query: ``path``, 可选 ``project_id``）
- ``PUT    /api/knowledge/{scope}/{target_id}/file``        — 写入 / 覆盖 markdown（仅 ``.md``）
- ``DELETE /api/knowledge/{scope}/{target_id}/file``        — 删除文件
- ``POST   /api/knowledge/{scope}/{target_id}/generate``    — 触发异步生成任务
- ``GET    /api/knowledge/{scope}/{target_id}/status``      — 查询最近一次任务状态

``scope ∈ {"project", "group"}``：
- ``project``: ``target_id`` 为 project_id（base64-cwd），仅一个仓库。
- ``group``:   ``target_id`` 为 group_id，聚合组内所有项目；多仓库时需通过 ``project_id`` 指定具体仓库。
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.core.dependencies import get_optional_user
from backend.services.knowledge_service import knowledge_service

logger = logging.getLogger("tide.api.knowledge")

router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])


_ALLOWED_SCOPES = {"project", "group"}


class WriteFilePayload(BaseModel):
    content: str


class GenerateRequest(BaseModel):
    graph_type: str = "all"
    agent_id: Optional[str] = None


def _ensure_not_viewer(current_user: Optional[dict]) -> None:
    if current_user and current_user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot modify resources")


def _validate_scope(scope: str) -> None:
    if scope not in _ALLOWED_SCOPES:
        raise HTTPException(status_code=400, detail=f"Invalid scope, expected one of {sorted(_ALLOWED_SCOPES)}")


async def _resolve_one_repo(
    scope: str,
    target_id: str,
    project_id: Optional[str],
) -> Dict[str, str]:
    """解析单个仓库。

    - ``project`` scope: 使用 ``target_id``。
    - ``group`` scope: 若 ``project_id`` 给出则定位组内对应成员；否则要求组只有一个成员。
    """
    repos = await knowledge_service.resolve_repos(scope, target_id)
    if not repos:
        raise HTTPException(status_code=404, detail="no accessible repository for the given scope/target")
    if scope == "project":
        return repos[0]
    # group
    if project_id:
        for r in repos:
            if r["project_id"] == project_id:
                return r
        raise HTTPException(status_code=404, detail=f"project_id {project_id} not in group {target_id}")
    if len(repos) == 1:
        return repos[0]
    raise HTTPException(
        status_code=400,
        detail="group has multiple repos, please specify project_id",
    )


# ── 列表 / 读取 ─────────────────────────────────────


@router.get("/{scope}/{target_id}/files")
async def list_files(
    scope: str,
    target_id: str,
    project_id: Optional[str] = Query(None, description="group scope 下用于指定具体仓库"),
    current_user=Depends(get_optional_user),
) -> Dict[str, Any]:
    """列出仓库 ``.knowledge/`` 下的文件树。

    - ``project`` scope: 返回单仓库文件列表。
    - ``group`` scope: 若未指定 ``project_id``，返回组内所有仓库的聚合视图（按仓库分组）。
    """
    _validate_scope(scope)
    repos = await knowledge_service.resolve_repos(scope, target_id)
    if not repos:
        raise HTTPException(status_code=404, detail="no accessible repository")

    if scope == "project" or (scope == "group" and project_id):
        repo = await _resolve_one_repo(scope, target_id, project_id)
        files = knowledge_service.list_files(repo["cwd"])
        meta = knowledge_service.get_meta(repo["cwd"])
        return {
            "scope": scope,
            "target_id": target_id,
            "repos": [
                {
                    "project_id": repo["project_id"],
                    "name": repo["name"],
                    "cwd": repo["cwd"],
                    "files": files,
                    "meta": meta,
                }
            ],
        }

    # group 聚合
    result_repos: List[Dict[str, Any]] = []
    for r in repos:
        result_repos.append(
            {
                "project_id": r["project_id"],
                "name": r["name"],
                "cwd": r["cwd"],
                "files": knowledge_service.list_files(r["cwd"]),
                "meta": knowledge_service.get_meta(r["cwd"]),
            }
        )
    return {"scope": scope, "target_id": target_id, "repos": result_repos}


@router.get("/{scope}/{target_id}/file")
async def read_file(
    scope: str,
    target_id: str,
    path: str = Query(..., description="相对 .knowledge/ 的文件路径"),
    project_id: Optional[str] = Query(None),
    current_user=Depends(get_optional_user),
) -> Dict[str, Any]:
    _validate_scope(scope)
    repo = await _resolve_one_repo(scope, target_id, project_id)
    try:
        return {**knowledge_service.read_file(repo["cwd"], path), "project_id": repo["project_id"]}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/{scope}/{target_id}/file")
async def write_file(
    scope: str,
    target_id: str,
    body: WriteFilePayload,
    path: str = Query(..., description="相对 .knowledge/ 的文件路径，仅允许 .md"),
    project_id: Optional[str] = Query(None),
    current_user=Depends(get_optional_user),
) -> Dict[str, Any]:
    _validate_scope(scope)
    _ensure_not_viewer(current_user)
    repo = await _resolve_one_repo(scope, target_id, project_id)
    try:
        result = knowledge_service.write_file(repo["cwd"], path, body.content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {**result, "project_id": repo["project_id"]}


@router.delete("/{scope}/{target_id}/file")
async def delete_file(
    scope: str,
    target_id: str,
    path: str = Query(..., description="相对 .knowledge/ 的文件路径"),
    project_id: Optional[str] = Query(None),
    current_user=Depends(get_optional_user),
) -> Dict[str, Any]:
    _validate_scope(scope)
    _ensure_not_viewer(current_user)
    repo = await _resolve_one_repo(scope, target_id, project_id)
    try:
        knowledge_service.delete_file(repo["cwd"], path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True}


# ── 异步生成 ────────────────────────────────────────


@router.post("/{scope}/{target_id}/generate")
async def trigger_generate(
    scope: str,
    target_id: str,
    body: Optional[GenerateRequest] = Body(default=None),
    current_user=Depends(get_optional_user),
) -> Dict[str, Any]:
    """触发异步生成任务。

    返回当前任务状态快照。前端可轮询 ``/status`` 获取进度。
    """
    _validate_scope(scope)
    _ensure_not_viewer(current_user)
    graph_type = (body.graph_type if body else "all") or "all"
    agent_id = body.agent_id if body else None
    try:
        return await knowledge_service.trigger_generate(scope, target_id, graph_type, agent_id=agent_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{scope}/{target_id}/status")
async def get_status(
    scope: str,
    target_id: str,
    current_user=Depends(get_optional_user),
) -> Dict[str, Any]:
    _validate_scope(scope)
    status = knowledge_service.get_status(scope, target_id)
    if not status:
        return {"scope": scope, "target_id": target_id, "status": "idle"}
    return status


@router.get("/{scope}/{target_id}/export")
async def export_knowledge(
    scope: str,
    target_id: str,
    project_id: Optional[str] = Query(None),
    current_user=Depends(get_optional_user),
) -> StreamingResponse:
    """导出 .knowledge/ 目录为 zip 压缩包下载。"""
    _validate_scope(scope)
    repo = await _resolve_one_repo(scope, target_id, project_id)
    try:
        zip_bytes = knowledge_service.export_zip(repo["cwd"])
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    from io import BytesIO
    meta = knowledge_service.get_meta(repo["cwd"])
    version = meta.get("version", 0) if meta else 0
    filename = f"{repo['name']}-knowledge-v{version}.zip"
    return StreamingResponse(
        BytesIO(zip_bytes),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
