"""工作项 API 路由。

提供工作项 CRUD + 流转操作，对接 ``work_item_service``。
"""

import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel

from backend.core.dependencies import (
    check_project_write_permission,
    get_accessible_project_ids,
    get_optional_user,
)
from backend.models.schemas import (
    WorkItemCreate,
    WorkItemResponse,
    WorkItemTransitionRequest,
    WorkItemTransitionResponse,
    WorkItemUpdate,
)
from backend.services.work_item_service import work_item_service

router = APIRouter(prefix="/api/work-items", tags=["work-items"])


# ── Artifact Schema ──────────────────────────────────────────

class ArtifactCreate(BaseModel):
    label: str
    url: str
    stage: str = ""
    type: str = "link"


def _ensure_not_viewer(current_user: Optional[dict]) -> None:
    """写操作权限检查：viewer 角色禁止修改资源。"""
    if current_user and current_user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot modify resources")


@router.post("", response_model=WorkItemResponse)
async def create_work_item(
    body: WorkItemCreate,
    current_user=Depends(get_optional_user),
):
    """创建工作项。"""
    _ensure_not_viewer(current_user)
    # 项目级 viewer 写权限检查：与 move/transition 保持一致。
    await check_project_write_permission(body.project_id, current_user)
    try:
        result = await work_item_service.create_work_item(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not result:
        raise HTTPException(status_code=500, detail="Failed to create work item")
    return result


@router.get("", response_model=list[WorkItemResponse])
async def list_work_items(
    project_id: Optional[str] = Query(None, description="按项目过滤"),
    status: Optional[str] = Query(None, description="状态筛选：active/completed/pending/in_progress/pending_approval/failed/stopped/waiting"),
    search: Optional[str] = Query(None, description="标题+描述模糊搜索"),
    assignee: Optional[str] = Query(None, description="负责人筛选"),
    version_id: Optional[str] = Query(None, description="版本筛选"),
    current_user=Depends(get_optional_user),
):
    """列出工作项。"""
    accessible_pids = await get_accessible_project_ids(current_user)
    if accessible_pids is not None:
        if project_id is not None:
            if project_id not in accessible_pids:
                return []
            return await work_item_service.list_work_items(
                project_id=project_id, status=status,
                search=search, assignee=assignee, version_id=version_id,
            )
        items = await work_item_service.list_work_items(
            project_id=None, status=status,
            search=search, assignee=assignee, version_id=version_id,
        )
        return [it for it in items if (
            (it.get("project_id") if isinstance(it, dict) else getattr(it, "project_id", None))
            in accessible_pids
        )]
    return await work_item_service.list_work_items(
        project_id=project_id, status=status,
        search=search, assignee=assignee, version_id=version_id,
    )


@router.get("/{item_id}", response_model=WorkItemResponse)
async def get_work_item(
    item_id: str,
    current_user=Depends(get_optional_user),
):
    """工作项详情。"""
    result = await work_item_service.get_work_item(item_id)
    if not result:
        raise HTTPException(status_code=404, detail="Work item not found")
    return result


@router.patch("/{item_id}", response_model=WorkItemResponse)
async def update_work_item(
    item_id: str,
    body: WorkItemUpdate,
    current_user=Depends(get_optional_user),
):
    """更新工作项基本信息。"""
    _ensure_not_viewer(current_user)
    existing = await work_item_service.get_work_item(item_id)
    if existing:
        await check_project_write_permission(
            existing.get("project_id"), current_user
        )
    result = await work_item_service.update_work_item(item_id, body)
    if not result:
        raise HTTPException(status_code=404, detail="Work item not found")
    return result


@router.delete("/{item_id}")
async def delete_work_item(
    item_id: str,
    current_user=Depends(get_optional_user),
):
    """删除工作项。"""
    _ensure_not_viewer(current_user)
    existing = await work_item_service.get_work_item(item_id)
    if existing:
        await check_project_write_permission(
            existing.get("project_id"), current_user
        )
    ok = await work_item_service.delete_work_item(item_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Work item not found")
    return {"ok": True}


@router.post("/{item_id}/transition", response_model=WorkItemTransitionResponse)
async def transition_work_item(
    item_id: str,
    body: WorkItemTransitionRequest,
    current_user=Depends(get_optional_user),
):
    """流转工作项到目标节点。"""
    _ensure_not_viewer(current_user)
    existing = await work_item_service.get_work_item(item_id)
    if existing:
        await check_project_write_permission(
            existing.get("project_id"), current_user
        )
    if not body.target_node_id:
        raise HTTPException(status_code=400, detail="target_node_id is required")
    try:
        transition = await work_item_service.transition_work_item(
            item_id=item_id,
            target_node_id=body.target_node_id,
            operator=body.operator or "system",
            trigger_type="manual",
        )
    except ValueError as exc:
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(status_code=404, detail=message)
        raise HTTPException(status_code=400, detail=message)
    return transition


@router.get("/{item_id}/transitions", response_model=list[WorkItemTransitionResponse])
async def get_transitions(
    item_id: str,
    current_user=Depends(get_optional_user),
):
    """获取工作项流转历史。"""
    item = await work_item_service.get_work_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Work item not found")
    return await work_item_service.get_transitions(item_id)


# ── Git Merge 冲突解决 ────────────────────────────────────────


class MergeResolveRequest(BaseModel):
    resolved: bool = True
    message: str = ""


@router.post("/{item_id}/resolve-merge")
async def resolve_work_item_merge(
    item_id: str,
    body: MergeResolveRequest | None = None,
    current_user=Depends(get_optional_user),
):
    """解决工作项 git_merge 节点冲突后推进。

    当工作项的 git_merge 节点因冲突暂停后，用户手动解决冲突
    并调用此接口清除 merge_conflict 状态、推进到下游节点。
    """
    _ensure_not_viewer(current_user)
    item = await work_item_service.get_work_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Work item not found")
    await check_project_write_permission(item.get("project_id"), current_user)

    body = body or MergeResolveRequest()

    # 检查 metadata 中是否存在 merge_conflict 状态
    metadata = item.get("metadata") or {}
    if isinstance(metadata, str):
        import json
        try:
            metadata = json.loads(metadata)
        except (json.JSONDecodeError, TypeError):
            metadata = {}
    if not metadata.get("merge_conflict"):
        raise HTTPException(status_code=400, detail="No merge conflict pending for this work item")

    if not body.resolved:
        # 放弃合并：仅清除 merge_conflict 标记
        metadata.pop("merge_conflict", None)
        metadata.pop("conflicts", None)
        update_body = WorkItemUpdate(metadata=metadata)
        await work_item_service.update_work_item(item_id, update_body)
        return {"ok": True, "item_id": item_id, "resolved": False, "message": "Merge aborted"}

    # 解决合并：清除 metadata 并推进到下游节点
    metadata.pop("merge_conflict", None)
    metadata.pop("conflicts", None)
    metadata.pop("source_branch", None)
    metadata.pop("target_branch", None)
    metadata.pop("worktree_path", None)
    update_body = WorkItemUpdate(metadata=metadata)
    await work_item_service.update_work_item(item_id, update_body)

    # 推进到下游节点：找到当前 git_merge 节点并触发 advance
    current_node_id = item.get("current_node_id") or ""
    if current_node_id:
        try:
            await work_item_service.transition_work_item(
                item_id=item_id,
                target_node_id="",  # 空目标让 service 自动推进
                operator="system",
                trigger_type="merge_resolved",
            )
        except (ValueError, Exception):
            pass  # 推进失败不影响 resolve 结果

    return {"ok": True, "item_id": item_id, "resolved": True}


# ── Artifacts 管理 ──────────────────────────────────────────


def _get_artifacts(item: dict) -> list:
    """从工作项 metadata 中安全提取 artifacts 列表。"""
    metadata = item.get("metadata")
    if not metadata or not isinstance(metadata, dict):
        return []
    artifacts = metadata.get("artifacts")
    if not isinstance(artifacts, list):
        return []
    return artifacts


@router.post("/{item_id}/artifacts")
async def add_artifact(
    item_id: str,
    body: ArtifactCreate,
    current_user=Depends(get_optional_user),
):
    """添加产物链接。"""
    _ensure_not_viewer(current_user)
    item = await work_item_service.get_work_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Work item not found")
    await check_project_write_permission(item.get("project_id"), current_user)

    metadata = item.get("metadata") or {}
    if not isinstance(metadata, dict):
        metadata = {}
    artifacts = metadata.get("artifacts", [])
    if not isinstance(artifacts, list):
        artifacts = []

    new_artifact = {
        "id": str(uuid.uuid4()),
        "label": body.label,
        "url": body.url,
        "stage": body.stage,
        "type": body.type,
        "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    artifacts.append(new_artifact)
    metadata["artifacts"] = artifacts

    update_body = WorkItemUpdate(metadata=metadata)
    await work_item_service.update_work_item(item_id, update_body)
    return {"artifacts": artifacts}


@router.delete("/{item_id}/artifacts/{artifact_id}")
async def remove_artifact(
    item_id: str,
    artifact_id: str,
    current_user=Depends(get_optional_user),
):
    """删除产物链接。"""
    _ensure_not_viewer(current_user)
    item = await work_item_service.get_work_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Work item not found")
    await check_project_write_permission(item.get("project_id"), current_user)

    metadata = item.get("metadata") or {}
    if not isinstance(metadata, dict):
        metadata = {}
    artifacts = metadata.get("artifacts", [])
    if not isinstance(artifacts, list):
        artifacts = []

    new_artifacts = [a for a in artifacts if a.get("id") != artifact_id]
    if len(new_artifacts) == len(artifacts):
        raise HTTPException(status_code=404, detail="Artifact not found")

    metadata["artifacts"] = new_artifacts
    update_body = WorkItemUpdate(metadata=metadata)
    await work_item_service.update_work_item(item_id, update_body)
    return {"artifacts": new_artifacts}


# 产物文件扩展名 → Content-Type 映射
TEXT_CONTENT_TYPES = {
    ".md": "text/markdown; charset=utf-8",
    ".markdown": "text/markdown; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".log": "text/plain; charset=utf-8",
}


@router.get("/{item_id}/artifacts/{artifact_id}/content")
async def get_artifact_content(
    item_id: str,
    artifact_id: str,
    current_user=Depends(get_optional_user),
):
    """获取产物文件内容，用于在线查看。

    根据 artifact 中的 file_path（相对路径）与所属项目的绝对路径拼接出真实路径，
    然后返回文件内容。为防止目录遍历攻击，拼接后的绝对路径必须仍在项目
    根目录下。
    """
    item = await work_item_service.get_work_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Work item not found")

    artifacts = _get_artifacts(item)
    target = next(
        (a for a in artifacts if isinstance(a, dict) and a.get("id") == artifact_id),
        None,
    )
    if not target:
        raise HTTPException(status_code=404, detail="Artifact not found")

    file_path = (target.get("file_path") or "").strip()
    if not file_path:
        raise HTTPException(status_code=400, detail="Artifact has no file_path")

    project_id = item.get("project_id") or ""
    project_path = await work_item_service._get_project_path(project_id)
    if not project_path:
        raise HTTPException(status_code=404, detail="Project path not found")

    try:
        project_root = Path(project_path).resolve()
        target_path = (project_root / file_path.lstrip("/")).resolve()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid file path")

    # 安全校验：resolve 后的路径必须仍位于项目根目录下
    try:
        target_path.relative_to(project_root)
    except ValueError:
        raise HTTPException(status_code=403, detail="Path traversal forbidden")

    if not target_path.exists() or not target_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    suffix = target_path.suffix.lower()
    content_type = TEXT_CONTENT_TYPES.get(suffix)
    if content_type:
        try:
            text = target_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            text = target_path.read_text(encoding="utf-8", errors="replace")
        return PlainTextResponse(content=text, media_type=content_type)

    return FileResponse(
        path=str(target_path),
        media_type="application/octet-stream",
        filename=target_path.name,
    )
