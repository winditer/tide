"""工作项 API 路由。

提供工作项 CRUD + 流转操作，对接 ``work_item_service``。
"""

import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel

from backend.core.dependencies import (
    check_project_write_permission,
    get_accessible_project_ids,
    get_current_user,
    get_optional_user,
)
from backend.models.schemas import (
    AssignmentUpdateRequest,
    WorkItemAssignRequest,
    WorkItemCommentCreate,
    WorkItemContextCreate,
    WorkItemCreate,
    WorkItemDispatchRequest,
    WorkItemResponse,
    WorkItemTransitionRequest,
    WorkItemTransitionResponse,
    WorkItemUpdate,
)
from backend.runtime.config import DEFAULT_AGENT_ID, OPTIMIZE_AGENT_ID
from backend.services.ai_decompose_service import ai_decompose_service
from backend.services.work_item_service import work_item_service
from backend.db.engine import async_session_factory

logger = logging.getLogger("tide.api.work_items")

# AI 分解上传文件大小上限（10MB）
AI_DECOMPOSE_MAX_FILE_BYTES = 10 * 1024 * 1024
# 支持的文本扩展名（直接 UTF-8 读取）
_TEXT_FILE_SUFFIXES = {".md", ".markdown", ".txt", ".log", ".rst", ".csv", ".json", ".yaml", ".yml"}

# 描述优化 Agent 调用超时（秒）
_OPTIMIZE_TIMEOUT = 60


class OptimizeDescriptionRequest(BaseModel):
    description: str
    agent_id: Optional[str] = None


async def _call_llm_for_text(agent_id: str, prompt: str) -> str:
    """通过 AgentExecutor 调用 Agent CLI 获取纯文本响应。

    与 ai_decompose_service._call_agent_cli 同模式，但更简化：
    不解析 JSON，只收集纯文本输出。
    """
    from backend.runtime.executor import AgentExecutor

    task_id = f"optimize-desc-{uuid.uuid4().hex[:8]}"
    executor = AgentExecutor()
    output_parts: list[str] = []

    try:
        async with asyncio.timeout(_OPTIMIZE_TIMEOUT):
            async for event in executor.run_task(
                task_id=task_id,
                agent_id=agent_id,
                prompt=prompt,
                cwd=str(Path.cwd()),
                model=None,
                full_auto=True,
            ):
                if event.type == "output":
                    output_parts.append(event.content)
                elif event.type == "completed":
                    # completed 事件的 content 是最终汇总，已包含流式 output 内容
                    # 仅在没有收到任何流式输出时使用它作为 fallback
                    if not output_parts and event.content:
                        output_parts.append(event.content)
                elif event.type == "failed":
                    raise RuntimeError(
                        f"Agent 执行失败：{event.content or 'unknown error'}"
                    )
    except asyncio.TimeoutError:
        await executor.cancel_task(task_id)
        raise RuntimeError(f"Agent CLI 执行超时（{_OPTIMIZE_TIMEOUT}s）")

    result = "\n".join(str(p) for p in output_parts if p).strip()
    # 过滤 CLI 噪声提示
    result = re.sub(r"^Reading additional input from stdin\.{0,3}\n?", "", result, flags=re.MULTILINE).strip()
    if not result:
        raise RuntimeError("Agent 未返回有效输出")
    return result

router = APIRouter(prefix="/api/work-items", tags=["work-items"])


# ── Work Item Attachments ────────────────────────────────────

WI_ATTACHMENTS_DIR = Path(".tide/attachments/work-items")
WI_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024  # 20MB
WI_ATTACHMENT_MAX_COUNT = 10

_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif"}

_ATTACHMENT_CONTENT_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".avif": "image/avif",
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".zip": "application/zip",
    ".rar": "application/x-rar-compressed",
    ".7z": "application/x-7z-compressed",
    ".tar": "application/x-tar",
    ".gz": "application/gzip",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".json": "application/json",
    ".xml": "application/xml",
    ".mp4": "video/mp4",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
}


def _safe_upload_name(filename: str) -> str:
    name = Path(filename or "attachment").name
    return "".join(ch if ch.isalnum() or ch in ".-_" else "_" for ch in name) or "attachment"


def _infer_attachment_type(filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    return "image" if suffix in _IMAGE_SUFFIXES else "file"


def _attachment_content_type(filename: str) -> str:
    return _ATTACHMENT_CONTENT_TYPES.get(Path(filename).suffix.lower(), "application/octet-stream")


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


@router.post("/optimize-description")
async def optimize_description(
    body: OptimizeDescriptionRequest,
    current_user=Depends(get_optional_user),
):
    """调用 Agent 优化工作项描述文本。"""
    # Agent 选择优先级：body.agent_id > OPTIMIZE_AGENT_ID > DEFAULT_AGENT_ID
    agent_id = (
        body.agent_id
        or OPTIMIZE_AGENT_ID
        or DEFAULT_AGENT_ID
    )

    # 构造优化提示词
    prompt = (
        "你是资深项目管理专家。请润色以下工作项描述，要求：\n"
        "1. 保持原意不变\n"
        "2. 表述更清晰、专业、简洁\n"
        "3. 突出关键要点和验收标准\n"
        "4. 仅返回润色后的描述文本，不要任何其他解释\n\n"
        f"原始描述：\n{body.description}"
    )

    try:
        result = await _call_llm_for_text(agent_id, prompt)
    except RuntimeError as exc:
        logger.error("[optimize-description] LLM 调用失败: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        logger.exception("[optimize-description] 未预期异常")
        raise HTTPException(status_code=500, detail=f"描述优化失败：{type(exc).__name__}: {exc}")

    return {"optimized": result, "agent_id": agent_id}


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
    group_id: Optional[str] = Query(None, description="按项目组过滤"),
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
                group_id=group_id,
            )
        items = await work_item_service.list_work_items(
            project_id=None, status=status,
            search=search, assignee=assignee, version_id=version_id,
            group_id=group_id,
        )
        return [it for it in items if (
            (it.get("project_id") if isinstance(it, dict) else getattr(it, "project_id", None))
            in accessible_pids
        )]
    return await work_item_service.list_work_items(
        project_id=project_id, status=status,
        search=search, assignee=assignee, version_id=version_id,
        group_id=group_id,
    )


# ── Freeform: 当前用户的分配视图 ────────────────────────────
# 注意：此路由必须放在 /{item_id} 动态路由之前，避免 "assignments" 被
# 误当作 item_id 匹配。

@router.get("/assignments/mine")
async def get_my_assignments(status: Optional[str] = None, user=Depends(get_optional_user)):
    """获取当前用户的所有分配。"""
    from backend.services.no_workflow_service import no_workflow_service

    user_id = user.get("id") if user else None
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    return await no_workflow_service.get_my_assignments(user_id, status)


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

    # 负责人变更 → 通知新负责人（不通知自己）
    try:
        from backend.services.notification_service import notification_service

        actor_id = current_user.get("id") if current_user else None
        old_assignee = (existing or {}).get("assignee") if existing else None
        new_assignee = result.get("assignee")
        if new_assignee and new_assignee != old_assignee and new_assignee != actor_id:
            await notification_service.create_notification(
                recipient_id=new_assignee,
                work_item_id=item_id,
                notification_type="assigned",
                trigger_actor_id=actor_id,
                content=f"您被指定为工作项「{result.get('title', '')}」的负责人",
            )
    except Exception:
        logger.debug("create assigned notification failed", exc_info=True)

    return result


@router.patch("/{item_id}/status")
async def update_work_item_status(
    item_id: str,
    body: dict = Body(...),
    current_user=Depends(get_optional_user),
):
    """Freeform 模式下手动更新工作项状态（用于看板拖拽）。"""
    _ensure_not_viewer(current_user)
    from sqlalchemy import text

    status = (body.get("status") or "").strip()
    if not status:
        raise HTTPException(status_code=400, detail="status is required")

    item = await work_item_service.get_work_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Work item not found")
    await check_project_write_permission(item.get("project_id"), current_user)

    # 仅 freeform 模式允许直接设置 status
    is_freeform = (
        item.get("flow_mode") == "freeform"
        or item.get("workflow_id") == "__freeform__"
    )
    if not is_freeform:
        raise HTTPException(
            status_code=400,
            detail="Only freeform work items support manual status update",
        )

    async with async_session_factory() as session:
        if status == "completed":
            await session.execute(
                text(
                    "UPDATE work_items SET status = :s, completed_at = CURRENT_TIMESTAMP, "
                    "updated_at = CURRENT_TIMESTAMP WHERE id = :id"
                ),
                {"s": status, "id": item_id},
            )
        else:
            await session.execute(
                text(
                    "UPDATE work_items SET status = :s, completed_at = NULL, "
                    "updated_at = CURRENT_TIMESTAMP WHERE id = :id"
                ),
                {"s": status, "id": item_id},
            )
        await session.commit()

    updated = await work_item_service.get_work_item(item_id)

    # 工作项完成 → 通知创建者/负责人（不通知自己）
    if status == "completed":
        try:
            from backend.services.notification_service import notification_service

            async with async_session_factory() as session:
                row = await session.execute(
                    text("SELECT assignee, title FROM work_items WHERE id = :id"),
                    {"id": item_id},
                )
                wi = row.fetchone()
            actor_id = current_user.get("id") if current_user else None
            if wi and wi[0] and wi[0] != actor_id:
                await notification_service.create_notification(
                    recipient_id=wi[0],
                    work_item_id=item_id,
                    notification_type="completed",
                    trigger_actor_id=actor_id,
                    content=f"工作项「{wi[1]}」已完成",
                )
        except Exception:
            logger.debug("create completed notification failed", exc_info=True)

    # 广播看板更新，确保其他客户端实时同步
    try:
        from backend.services.ws_hub import ws_hub

        await ws_hub.broadcast("work_items", {
            "type": "work_item.updated",
            "work_item_id": item_id,
            "project_id": item.get("project_id"),
        })
    except Exception:
        pass

    return updated


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


@router.post("/{item_id}/rollback")
async def rollback_work_item(
    item_id: str,
    body: dict = Body(...),
    current_user=Depends(get_optional_user),
):
    """回退工作项到指定节点并重新触发。"""
    _ensure_not_viewer(current_user)
    existing = await work_item_service.get_work_item(item_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Work item not found")
    await check_project_write_permission(existing.get("project_id"), current_user)

    target_node_id = body.get("target_node_id")
    if not target_node_id:
        raise HTTPException(status_code=400, detail="target_node_id is required")

    result = await work_item_service.rollback_to_node(item_id, target_node_id)
    if not result:
        raise HTTPException(status_code=400, detail="Rollback failed: target node invalid or not found")
    return result


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


@router.get("/{item_id}/cross-repo-results")
async def get_cross_repo_results(
    item_id: str,
    current_user=Depends(get_optional_user),
):
    """跨仓库执行结果聚合。

    当工作项关联项目组（``group_id``）时，返回该工作项驱动的跨仓库
    Plan 下所有子任务的 diff/commit 汇总，按仓库分组返回；未关联项目组
    或尚未生成 Plan 时，``results`` 为空数组（不报错）。
    """
    item = await work_item_service.get_work_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Work item not found")
    try:
        return await work_item_service.get_cross_repo_results(item_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


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

    # 优先从持久化的产物内容读取。freeform 模式（无 worktree/无 git commit）下，
    # Agent 在 cwd 生成的源文件会在任务结束后丢失，此时磁盘/ git 均无法回读，
    # 只能依赖产物搜集时持久化到 .tide/attachments/artifacts 的副本。
    stored_path = (target.get("stored_path") or "").strip()
    if stored_path:
        stored_abs = Path(stored_path)
        if not stored_abs.is_absolute():
            stored_abs = (Path.cwd() / stored_path).resolve()
        if stored_abs.exists() and stored_abs.is_file():
            suffix = (Path(target.get("file_path") or "").suffix or stored_abs.suffix).lower()
            content_type = TEXT_CONTENT_TYPES.get(suffix)
            if content_type:
                try:
                    stored_text = stored_abs.read_text(encoding="utf-8")
                except UnicodeDecodeError:
                    stored_text = stored_abs.read_text(encoding="utf-8", errors="replace")
                return PlainTextResponse(content=stored_text, media_type=content_type)
            return FileResponse(
                path=str(stored_abs),
                media_type="application/octet-stream",
                filename=Path(target.get("label") or stored_abs.name).name,
            )

    file_path = (target.get("file_path") or "").strip()
    if not file_path:
        raise HTTPException(status_code=400, detail="Artifact has no file_path")

    # 优先级 0：Bridge 回传并已持久化的产物内容（freeform 模式无 worktree/无 commit，
    # 源文件在任务结束后丢失，仅靠 file_path 会 404）。stored_path 由
    # work_item_service._persist_artifact_content 写入 .tide/attachments/artifacts/ 下。
    stored_path = (target.get("stored_path") or "").strip()
    if stored_path:
        try:
            sp = Path(stored_path)
            if sp.exists() and sp.is_file():
                suffix = Path(file_path).suffix.lower()
                content_type = TEXT_CONTENT_TYPES.get(suffix)
                if content_type:
                    try:
                        text = sp.read_text(encoding="utf-8")
                    except UnicodeDecodeError:
                        text = sp.read_text(encoding="utf-8", errors="replace")
                    return PlainTextResponse(content=text, media_type=content_type)
                return FileResponse(
                    path=str(sp),
                    media_type="application/octet-stream",
                    filename=Path(file_path).name,
                )
        except Exception:
            pass

    project_id = item.get("project_id") or ""
    project_path = await work_item_service._get_project_path(project_id)

    # 保留原始项目根路径，用于 file_path 已包含 worktree 前缀的情况
    original_project_path = project_path

    # 项目组场景：产物可能来自不同子项目，优先从关联 task 的 cwd 定位 project root
    task_id = target.get("task_id") or ""
    if task_id:
        async with async_session_factory() as session:
            from sqlalchemy import text
            task_row = (await session.execute(
                text("SELECT cwd FROM tasks WHERE id = :id"),
                {"id": task_id},
            )).fetchone()
            if task_row:
                task_cwd = dict(task_row._mapping).get("cwd", "")
                if task_cwd and Path(task_cwd).is_dir():
                    project_path = task_cwd

    if not project_path:
        raise HTTPException(status_code=404, detail="Project path not found")

    try:
        project_root = Path(project_path).resolve()
        # 判断 file_path 是绝对路径还是相对路径
        if Path(file_path).is_absolute():
            target_path = Path(file_path).resolve()
        elif ".tide/worktrees/" in file_path:
            # file_path 已包含 worktree 路径前缀，说明它是从项目根开始的相对路径
            # 应使用原始项目根路径拼接，避免与 task_cwd 重复嵌套
            effective_project_root = Path(original_project_path).resolve() if original_project_path else project_root
            target_path = (effective_project_root / file_path.lstrip("/")).resolve()
            # 同步更新 project_root 供后续安全校验和 git fallback 使用
            project_root = effective_project_root
        else:
            target_path = (project_root / file_path.lstrip("/")).resolve()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid file path")

    # 安全校验：
    # - 相对路径：resolve 后必须仍位于项目根目录下
    # - 绝对路径：路径来源是后端 metadata，可信，仅检查文件存在性即可
    if not Path(file_path).is_absolute():
        try:
            target_path.relative_to(project_root)
        except ValueError:
            raise HTTPException(status_code=403, detail="Path traversal forbidden")

    if not target_path.exists() or not target_path.is_file():
        # 文件不在磁盘上（worktree 已清理），尝试从 git 对象读取
        commit_hash = (target.get("commit_hash") or "").strip()

        # 用相对路径从 git show 读取
        rel_path = file_path
        if Path(file_path).is_absolute():
            try:
                rel_path = str(Path(file_path).relative_to(project_root))
            except ValueError:
                raise HTTPException(status_code=404, detail="File not found")

        # 构建候选路径列表（worktree 前缀路径 → 去除前缀后的纯相对路径）
        import re as _re
        git_ref_paths = [rel_path]
        wt_prefix_match = _re.match(r"\.tide/worktrees/[^/]+/(.+)", rel_path)
        if wt_prefix_match:
            git_ref_paths.insert(0, wt_prefix_match.group(1))

        # 如果没有 commit_hash，尝试从 git log 查找包含该文件的最新 commit
        if not commit_hash:
            for ref_path in git_ref_paths:
                try:
                    log_result = subprocess.run(
                        ["git", "log", "--all", "-1", "--pretty=format:%H", "--", ref_path],
                        capture_output=True, timeout=10,
                        cwd=str(project_root),
                    )
                    if log_result.returncode == 0 and log_result.stdout.strip():
                        commit_hash = log_result.stdout.strip().decode()
                        break
                except Exception:
                    continue

        if not commit_hash:
            raise HTTPException(status_code=404, detail="File not found and cannot locate in git history")

        content: Optional[bytes] = None
        for ref_path in git_ref_paths:
            try:
                result = subprocess.run(
                    ["git", "show", f"{commit_hash}:{ref_path}"],
                    capture_output=True, timeout=10,
                    cwd=str(project_root),
                )
                if result.returncode == 0:
                    content = result.stdout
                    break
            except Exception:
                continue

        # Fallback（方案 C）：从关联 task 的输出文本中重新提取 Bridge 回传的
        # 文件内容块（--- File: <path> ---\n<content>）。适用于早期未持久化
        # stored_path 的历史产物，且源文件已丢失、git 中也无法定位的情况。
        if content is None and task_id:
            try:
                async with async_session_factory() as session:
                    from sqlalchemy import text as _sqltext
                    tr = (await session.execute(
                        _sqltext("SELECT result FROM tasks WHERE id = :id"),
                        {"id": task_id},
                    )).fetchone()
                task_output = dict(tr._mapping).get("result") if tr else None
                if task_output and isinstance(task_output, str):
                    fname = Path(file_path).name
                    for m in re.finditer(
                        r"---\s*File:\s*(.+?)\s*---\n(.*?)(?=\n---\s*File:|\Z)",
                        task_output, re.DOTALL,
                    ):
                        blk_path = (m.group(1) or "").strip()
                        if blk_path == file_path or Path(blk_path).name == fname:
                            content = (m.group(2) or "").encode("utf-8")
                            break
            except Exception:
                content = None

        if content is None:
            raise HTTPException(status_code=404, detail="File not found on disk or in git history")

        suffix = Path(file_path).suffix.lower()
        content_type = TEXT_CONTENT_TYPES.get(suffix)
        if content_type:
            try:
                text = content.decode("utf-8")
            except UnicodeDecodeError:
                text = content.decode("utf-8", errors="replace")
            return PlainTextResponse(content=text, media_type=content_type)

        from fastapi.responses import Response
        return Response(
            content=content,
            media_type="application/octet-stream",
            headers={"Content-Disposition": f'attachment; filename="{Path(file_path).name}"'},
        )

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


# ── Attachments 管理 ─────────────────────────────────────────


def _get_attachments(item: dict) -> list:
    """从工作项 metadata 中安全提取 attachments 列表。"""
    metadata = item.get("metadata")
    if not metadata or not isinstance(metadata, dict):
        return []
    attachments = metadata.get("attachments")
    if not isinstance(attachments, list):
        return []
    return attachments


@router.post("/{item_id}/attachments")
async def upload_work_item_attachments(
    item_id: str,
    files: list[UploadFile] = File(...),
    current_user=Depends(get_optional_user),
):
    """上传图片/文件附件到工作项，并持久化到 metadata.attachments。"""
    _ensure_not_viewer(current_user)
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")

    item = await work_item_service.get_work_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Work item not found")
    await check_project_write_permission(item.get("project_id"), current_user)

    attachments = _get_attachments(item)
    if len(attachments) + len(files) > WI_ATTACHMENT_MAX_COUNT:
        raise HTTPException(
            status_code=400,
            detail=f"Work item attachments limit is {WI_ATTACHMENT_MAX_COUNT}",
        )

    target_dir = WI_ATTACHMENTS_DIR / item_id
    target_dir.mkdir(parents=True, exist_ok=True)

    created = []
    for upload in files:
        safe_name = _safe_upload_name(upload.filename or "attachment")
        stored_name = f"{uuid.uuid4().hex[:12]}-{safe_name}"
        target = target_dir / stored_name
        try:
            with target.open("wb") as out:
                shutil.copyfileobj(upload.file, out)
        finally:
            await upload.close()

        size = target.stat().st_size
        if size > WI_ATTACHMENT_MAX_BYTES:
            target.unlink(missing_ok=True)
            raise HTTPException(
                status_code=400,
                detail=f"File {upload.filename} exceeds {WI_ATTACHMENT_MAX_BYTES} bytes",
            )

        attachment = {
            "id": str(uuid.uuid4()),
            "name": upload.filename or stored_name,
            "path": str(target),
            "type": _infer_attachment_type(upload.filename or ""),
            "size": size,
            "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
        attachments.append(attachment)
        created.append(attachment)

    metadata = item.get("metadata") or {}
    if not isinstance(metadata, dict):
        metadata = {}
    metadata["attachments"] = attachments
    await work_item_service.update_work_item(item_id, WorkItemUpdate(metadata=metadata))
    return {"attachments": created}


@router.delete("/{item_id}/attachments/{attachment_id}")
async def remove_work_item_attachment(
    item_id: str,
    attachment_id: str,
    current_user=Depends(get_optional_user),
):
    """删除工作项附件。"""
    _ensure_not_viewer(current_user)
    item = await work_item_service.get_work_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Work item not found")
    await check_project_write_permission(item.get("project_id"), current_user)

    attachments = _get_attachments(item)
    target = next(
        (a for a in attachments if isinstance(a, dict) and a.get("id") == attachment_id),
        None,
    )
    if not target:
        raise HTTPException(status_code=404, detail="Attachment not found")

    # 尝试删除磁盘文件（忽略失败）
    try:
        path = Path(target.get("path", ""))
        if path.exists():
            path.unlink()
    except Exception:
        pass

    new_attachments = [a for a in attachments if a.get("id") != attachment_id]
    metadata = item.get("metadata") or {}
    if not isinstance(metadata, dict):
        metadata = {}
    metadata["attachments"] = new_attachments
    await work_item_service.update_work_item(item_id, WorkItemUpdate(metadata=metadata))
    return {"attachments": new_attachments}


@router.get("/{item_id}/attachments/{attachment_id}/content")
async def get_work_item_attachment_content(
    item_id: str,
    attachment_id: str,
):
    """获取工作项附件内容，用于图片预览/下载。

    注意：此端点不要求认证，因为附件 ID 为 UUID 不可猜测，
    前端 <img src="..."> 无法附带 Authorization header。
    """
    item = await work_item_service.get_work_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Work item not found")

    attachments = _get_attachments(item)
    target = next(
        (a for a in attachments if isinstance(a, dict) and a.get("id") == attachment_id),
        None,
    )
    if not target:
        raise HTTPException(status_code=404, detail="Attachment not found")

    file_path = (target.get("path") or "").strip()
    if not file_path:
        raise HTTPException(status_code=400, detail="Attachment has no path")

    try:
        target_path = Path(file_path).resolve()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid file path")

    if not target_path.exists() or not target_path.is_file():
        raise HTTPException(status_code=404, detail="Attachment file not found")

    content_type = _attachment_content_type(target_path.name)
    if content_type.startswith("image/"):
        return FileResponse(
            path=str(target_path),
            media_type=content_type,
        )

    return FileResponse(
        path=str(target_path),
        media_type=content_type,
        filename=target_path.name,
    )


# ── AI 需求分解 & 批量创建 ────────────────────────────────────


def _extract_text_from_docx(blob: bytes) -> Optional[str]:
    """尝试用 python-docx 解析 .docx 文件文本；未安装库则返回 None。"""
    try:
        from io import BytesIO

        import docx  # type: ignore  # python-docx
    except ImportError:
        return None
    try:
        document = docx.Document(BytesIO(blob))
        return "\n".join(p.text for p in document.paragraphs if p.text)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[ai-decompose] docx 解析失败: %s", exc)
        return None


async def _read_upload_file(upload: UploadFile) -> dict:
    """读取上传文件并返回 ``{name, content, skipped, reason}``。

    - 大小超过 :data:`AI_DECOMPOSE_MAX_FILE_BYTES` 抛出 400。
    - 二进制 / 未支持类型返回 ``skipped=True``。
    """
    filename = upload.filename or "attachment"
    blob = await upload.read()
    if len(blob) > AI_DECOMPOSE_MAX_FILE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"File {filename!r} exceeds 10MB limit",
        )

    suffix = Path(filename).suffix.lower()
    # 文本类
    if suffix in _TEXT_FILE_SUFFIXES or not suffix:
        try:
            text = blob.decode("utf-8")
        except UnicodeDecodeError:
            text = blob.decode("utf-8", errors="replace")
        return {"name": filename, "content": text, "skipped": False}

    # docx
    if suffix == ".docx":
        text = _extract_text_from_docx(blob)
        if text is None:
            return {
                "name": filename,
                "content": "",
                "skipped": True,
                "reason": "python-docx not installed; .docx skipped",
            }
        return {"name": filename, "content": text, "skipped": False}

    # 其他类型暂不解析
    return {
        "name": filename,
        "content": "",
        "skipped": True,
        "reason": f"Unsupported file type: {suffix or 'unknown'}",
    }


@router.post("/ai-decompose")
async def ai_decompose_work_items(
    text: Optional[str] = Form(None),
    links: Optional[str] = Form(None),
    project_id: str = Form(...),
    group_id: Optional[str] = Form(None),
    agent_id: Optional[str] = Form(None),
    files: Optional[list[UploadFile]] = File(None),
    user=Depends(get_current_user),
):
    """AI 需求分解：将文本/文件/链接拆解为结构化工作项列表。

    返回 ``{"items": [...], "raw_analysis": str, "skipped_files": [...]}``。
    本端点仅返回分析结果，不写库；写库走 ``/batch``。
    """
    _ensure_not_viewer(user)
    await check_project_write_permission(project_id, user)

    # 解析 links（JSON 数组字符串）
    parsed_links: list[str] = []
    if links:
        try:
            data = json.loads(links)
            if isinstance(data, list):
                parsed_links = [str(u).strip() for u in data if str(u).strip()]
            else:
                raise HTTPException(status_code=400, detail="`links` must be a JSON array of strings")
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="`links` is not valid JSON")

    # 处理文件
    file_contents: list[dict] = []
    skipped_files: list[dict] = []
    for upload in files or []:
        if not upload or not upload.filename:
            continue
        info = await _read_upload_file(upload)
        if info.get("skipped"):
            skipped_files.append({"name": info["name"], "reason": info.get("reason", "")})
            continue
        if info.get("content"):
            file_contents.append({"name": info["name"], "content": info["content"]})

    # 至少需要 text/links/files 其一
    if not (text and text.strip()) and not parsed_links and not file_contents:
        raise HTTPException(
            status_code=400,
            detail="At least one of `text`, `links`, or readable `files` is required",
        )

    try:
        result = await ai_decompose_service.decompose(
            text=text,
            links=parsed_links or None,
            file_contents=file_contents or None,
            project_id=project_id,
            agent_id=agent_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        logger.warning("[ai-decompose] LLM 调用失败: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "[ai-decompose] 内部错误: %s, result_type=%s, result_preview=%s",
            exc,
            type(result).__name__ if 'result' in dir() else 'undefined',
            repr(result)[:200] if 'result' in dir() and result is not None else 'N/A',
        )
        raise HTTPException(status_code=500, detail=f"内部错误：{type(exc).__name__}: {str(exc)}")

    return {
        "items": result.get("items", []),
        "raw_analysis": result.get("raw_analysis", ""),
        "skipped_files": skipped_files,
    }


@router.post("/batch")
async def batch_create_work_items(
    payload: dict,
    user=Depends(get_current_user),
):
    """批量创建工作项。

    请求体：``{"items": [...], "project_id": str, "group_id": str?}``。
    每条 item 至少需要 ``title``，可选 ``description / priority / tags``。
    返回 ``{"created": [WorkItemResponse...], "failed": [{index, title, error}...]}``。
    """
    _ensure_not_viewer(user)

    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")

    project_id = (payload.get("project_id") or "").strip()
    if not project_id:
        raise HTTPException(status_code=400, detail="`project_id` is required")
    await check_project_write_permission(project_id, user)

    items_raw = payload.get("items")
    if not isinstance(items_raw, list) or not items_raw:
        raise HTTPException(status_code=400, detail="`items` must be a non-empty list")

    group_id = payload.get("group_id") or None

    created: list[dict] = []
    failed: list[dict] = []
    for idx, raw in enumerate(items_raw):
        if not isinstance(raw, dict):
            failed.append({"index": idx, "title": "", "error": "item is not an object"})
            continue
        title = (raw.get("title") or "").strip()
        if not title:
            failed.append({"index": idx, "title": "", "error": "title is required"})
            continue

        try:
            body = WorkItemCreate(
                project_id=project_id,
                title=title,
                description=raw.get("description") or None,
                priority=int(raw.get("priority") or 0),
                assignee=raw.get("assignee") or None,
                tags=raw.get("tags") or None,
                source_type=raw.get("source_type") or "ai_decompose",
                source_id=raw.get("source_id") or None,
                metadata=raw.get("metadata") or None,
                version_id=raw.get("version_id") or None,
                group_id=group_id or raw.get("group_id"),
            )
        except Exception as exc:  # noqa: BLE001
            failed.append({"index": idx, "title": title, "error": f"invalid payload: {exc}"})
            continue

        try:
            result = await work_item_service.create_work_item(body)
        except ValueError as exc:
            failed.append({"index": idx, "title": title, "error": str(exc)})
            continue
        except Exception as exc:  # noqa: BLE001
            logger.exception("[work-items/batch] create_work_item failed idx=%d", idx)
            failed.append({"index": idx, "title": title, "error": f"{type(exc).__name__}: {exc}"})
            continue
        if not result:
            failed.append({"index": idx, "title": title, "error": "create returned empty result"})
            continue
        created.append(result)

    return {"created": created, "failed": failed}


# ── Freeform Assignment Endpoints ──────────────────────────


@router.post("/{item_id}/assign")
async def assign_work_item(
    item_id: str,
    body: WorkItemAssignRequest,
    user=Depends(get_optional_user),
):
    """分配工作项给成员/专家团/小队。"""
    _ensure_not_viewer(user)
    from backend.services.no_workflow_service import no_workflow_service

    actor_id = user.get("id", "anonymous") if user else "anonymous"

    try:
        if body.target_type == "member":
            result = await no_workflow_service.assign_to_member(
                item_id, body.target_id, actor_id, body.role
            )
        elif body.target_type == "expert_team":
            result = await no_workflow_service.assign_to_expert_team(
                item_id, body.target_id, actor_id
            )
        elif body.target_type == "squad":
            result = await no_workflow_service.assign_to_squad(
                item_id, body.target_id, actor_id
            )
        else:
            raise HTTPException(
                status_code=400, detail=f"Invalid target_type: {body.target_type}"
            )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return result


@router.post("/{item_id}/assignments/{assignment_id}/dispatch")
async def dispatch_assignment(
    item_id: str,
    assignment_id: str,
    body: WorkItemDispatchRequest,
    user=Depends(get_optional_user),
):
    """Squad Leader 派遣任务给成员。"""
    _ensure_not_viewer(user)
    from backend.services.no_workflow_service import no_workflow_service

    leader_id = user.get("id", "anonymous") if user else "anonymous"
    try:
        result = await no_workflow_service.dispatch_to_members(
            item_id, assignment_id, body.member_ids, leader_id
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"dispatched": result}


@router.patch("/{item_id}/assignments/{assignment_id}")
async def update_assignment(
    item_id: str,
    assignment_id: str,
    body: AssignmentUpdateRequest,
    user=Depends(get_optional_user),
):
    """更新分配状态（接受/进行中/完成/拒绝）。"""
    _ensure_not_viewer(user)
    from backend.services.no_workflow_service import no_workflow_service

    actor_id = user.get("id", "anonymous") if user else "anonymous"

    try:
        if body.status == "accepted":
            result = await no_workflow_service.accept_assignment(assignment_id, actor_id)
        elif body.status == "completed":
            result = await no_workflow_service.complete_assignment(
                assignment_id, actor_id, body.notes
            )
        else:
            result = await no_workflow_service.update_progress(
                assignment_id, body.status, body.notes
            )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return result


@router.get("/{item_id}/assignments")
async def get_assignments(item_id: str, user=Depends(get_optional_user)):
    """获取工作项的分配列表。"""
    from backend.services.no_workflow_service import no_workflow_service
    return await no_workflow_service.get_assignments(item_id)


@router.post("/{item_id}/context")
async def add_work_item_context(
    item_id: str,
    body: WorkItemContextCreate,
    user=Depends(get_optional_user),
):
    """添加工作项共享上下文条目。"""
    _ensure_not_viewer(user)
    from backend.services.no_workflow_service import no_workflow_service

    author_id = user.get("id", "anonymous") if user else "anonymous"
    try:
        result = await no_workflow_service.add_context(
            item_id, body.context_type, body.content, author_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return result


@router.get("/{item_id}/context")
async def get_work_item_context(item_id: str, user=Depends(get_optional_user)):
    """获取工作项共享上下文流。"""
    from backend.services.no_workflow_service import no_workflow_service
    return await no_workflow_service.get_context_stream(item_id)


@router.post("/{item_id}/comments")
async def create_work_item_comment(
    item_id: str,
    body: WorkItemCommentCreate,
    current_user=Depends(get_current_user),
):
    """创建评论。若 mentions 含 expert_team/squad/agent，触发 Agent 执行。"""
    _ensure_not_viewer(current_user)
    from backend.services.no_workflow_service import no_workflow_service
    from backend.services.event_emitter import event_emitter

    author_id = current_user.get("id", "anonymous") if current_user else "anonymous"
    mentions = [m.dict() for m in (body.mentions or [])]

    # 1. 插入 comment 记录
    comment = await no_workflow_service.create_comment(
        work_item_id=item_id,
        author_id=author_id,
        content=body.content,
        mentions=mentions,
    )

    # 2. 解析 mentions：若有 expert_team/squad/agent 类型 → 触发 Agent 执行
    task_id = None
    for mention in mentions:
        if mention.get("type") in ("expert_team", "squad", "agent"):
            try:
                task_id = await no_workflow_service.execute_from_comment(
                    work_item_id=item_id,
                    comment_id=comment["id"],
                    mention=mention,
                    prompt=body.content,
                )
            except Exception as exc:
                logger.warning("execute_from_comment failed: %s", exc)
            break

    if task_id:
        comment = await no_workflow_service.get_comment(comment["id"]) or comment

    # 3. 广播 WORK_ITEM_COMMENT_ADDED 事件
    try:
        await event_emitter.emit_work_item_comment(item_id, comment)
    except Exception:
        pass

    # 3.5 评论 @成员 → 通知被提及的用户（不通知自己）
    try:
        from sqlalchemy import text

        member_mentions = [
            m
            for m in mentions
            if m.get("type") == "member" and m.get("id") != author_id
        ]
        if member_mentions:
            from backend.services.notification_service import notification_service

            async with async_session_factory() as session:
                trow = await session.execute(
                    text("SELECT title FROM work_items WHERE id = :id"),
                    {"id": item_id},
                )
                title_row = trow.fetchone()
            wi_title = (title_row[0] if title_row else None) or item_id
            actor_name = (
                (
                    current_user.get("display_name")
                    or current_user.get("username")
                    or "某用户"
                )
                if current_user
                else "某用户"
            )
            for m in member_mentions:
                await notification_service.create_notification(
                    recipient_id=m.get("id"),
                    work_item_id=item_id,
                    notification_type="mentioned",
                    trigger_actor_id=author_id,
                    content=f"{actor_name} 在工作项「{wi_title}」中提到了您",
                )
                # 异步发送Lark @提及通知（不阻塞主流程）
                asyncio.create_task(
                    notification_service.send_lark_mention_notification(
                        recipient_id=m.get("id"),
                        work_item_id=item_id,
                        actor_name=actor_name,
                        comment_content=body.content[:200],
                    )
                )
    except Exception:
        logger.debug("create mention notification failed", exc_info=True)

    # 4. 返回 comment（含 task_id）
    return comment


@router.get("/{item_id}/comments")
async def list_work_item_comments(item_id: str, current_user=Depends(get_optional_user)):
    """获取评论列表。"""
    from backend.services.no_workflow_service import no_workflow_service
    return await no_workflow_service.get_comments(item_id)


@router.patch("/{item_id}/comments/{comment_id}")
async def update_comment_task_status(
    item_id: str,
    comment_id: str,
    body: dict = Body(...),
    current_user=Depends(get_optional_user),
):
    """更新评论关联任务状态（内部调用）。"""
    from backend.services.no_workflow_service import no_workflow_service
    comment = await no_workflow_service.update_comment_task(
        comment_id,
        task_id=body.get("task_id"),
        task_status=body.get("task_status"),
    )
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    return comment
