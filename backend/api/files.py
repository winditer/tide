"""
文件读取 API 路由。

提供本地文件内容读取、写入、目录树、diff、冲突解决等端点。
"""

import asyncio
import logging
import os
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from backend.runtime.git_utils import (
    git_command,
    git_diff_full,
    git_conflict_content,
)

router = APIRouter(prefix="/api/files", tags=["files"])
logger = logging.getLogger("tide.api.files")

# 最大允许读取的文件大小：2 MB
MAX_FILE_SIZE = 2 * 1024 * 1024

# 目录树过滤名单（仅排除 .git）
IGNORED_DIRS = {".git"}

# 安全路径黑名单前缀
BLOCKED_PREFIXES = ("/proc", "/sys", "/dev", "/etc/shadow", "/etc/passwd")


def _check_path_security(path_str: str) -> None:
    """路径安全检查：禁止访问系统敏感目录。"""
    for prefix in BLOCKED_PREFIXES:
        if path_str.startswith(prefix):
            raise HTTPException(status_code=403, detail="不允许访问该路径")


def _resolve_and_validate(path: str) -> Path:
    """解析路径并执行基础安全校验。"""
    if not path:
        raise HTTPException(status_code=400, detail="缺少 path 参数")
    resolved = Path(path).resolve()
    if not resolved.is_absolute():
        raise HTTPException(status_code=400, detail="仅支持绝对路径")
    _check_path_security(str(resolved))
    return resolved


# ── 文件读取 ─────────────────────────────────────────────────────────────────

@router.get("/content")
async def read_file_content(
    path: str = Query(..., description="文件的绝对路径"),
):
    """读取本地文件内容并返回纯文本。"""
    resolved = _resolve_and_validate(path)

    if not resolved.exists():
        raise HTTPException(status_code=404, detail=f"文件不存在: {path}")

    if not resolved.is_file():
        raise HTTPException(status_code=400, detail="路径不是文件")

    try:
        size = resolved.stat().st_size
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"无法读取文件信息: {e}")

    if size > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"文件过大 ({size} bytes)，最大允许 {MAX_FILE_SIZE} bytes",
        )

    try:
        content = resolved.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=415, detail="文件不是 UTF-8 文本")
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"读取文件失败: {e}")

    return PlainTextResponse(content)


# ── 目录树 ─────────────────────────────────────────────────────────────────

@router.get("/tree")
async def list_directory_tree(
    path: str = Query(..., description="绝对路径"),
    depth: int = Query(1, ge=1, le=5, description="遍历深度"),
):
    """列出目录树，返回目录结构 JSON。"""
    resolved = _resolve_and_validate(path)

    if not resolved.exists():
        raise HTTPException(status_code=404, detail=f"路径不存在: {path}")
    if not resolved.is_dir():
        raise HTTPException(status_code=400, detail="路径不是目录")

    def _scan(dir_path: Path, current_depth: int) -> list[dict]:
        items: list[dict] = []
        try:
            entries = sorted(dir_path.iterdir(), key=lambda p: (p.is_file(), p.name.lower()))
        except PermissionError:
            return items

        for entry in entries:
            if entry.name in IGNORED_DIRS:
                continue

            item: dict = {
                "name": entry.name,
                "path": str(entry),
                "type": "dir" if entry.is_dir() else "file",
            }

            if entry.is_file():
                try:
                    item["size"] = entry.stat().st_size
                except OSError:
                    item["size"] = 0
            elif entry.is_dir() and current_depth < depth:
                item["children"] = _scan(entry, current_depth + 1)

            items.append(item)
        return items

    tree = _scan(resolved, 1)
    return {"path": str(resolved), "children": tree}


# ── 文件写入 ─────────────────────────────────────────────────────────────────

class SaveFileRequest(BaseModel):
    path: str
    content: str


@router.put("/content")
async def save_file_content(req: SaveFileRequest):
    """保存文件内容。"""
    resolved = _resolve_and_validate(req.path)

    # 确保父目录存在
    try:
        resolved.parent.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"创建目录失败: {e}")

    try:
        resolved.write_text(req.content, encoding="utf-8")
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"写入文件失败: {e}")

    return {"ok": True, "path": str(resolved)}


# ── Diff ───────────────────────────────────────────────────────────────────

@router.get("/diff")
async def get_diff(
    cwd: str = Query(..., description="仓库路径"),
    ref1: Optional[str] = Query(None, description="起始 ref"),
    ref2: Optional[str] = Query(None, description="结束 ref"),
    path: Optional[str] = Query(None, description="特定文件路径"),
):
    """获取 unified diff。不传 ref 时返回工作区未提交的 diff。"""
    _resolve_and_validate(cwd)
    code, output = await git_diff_full(cwd, ref1=ref1, ref2=ref2, path=path)
    if code != 0:
        raise HTTPException(status_code=500, detail=f"git diff 失败: {output}")

    # 如果 diff 为空但文件确实有变更，检查是否为权限/元数据变化
    if code == 0 and not output.strip() and path:
        raw_args = ["diff", "--raw"]
        if ref1:
            raw_args.append(ref1)
        if ref2:
            raw_args.append(ref2)
        raw_args.extend(["--", path])
        raw_code, raw_output = await git_command(Path(cwd), raw_args, timeout=10)
        if raw_code == 0 and raw_output.strip():
            output = f"# 文件元数据变更（无内容差异）\n{raw_output.strip()}"

    return PlainTextResponse(output)


# ── 冲突详情 ─────────────────────────────────────────────────────────────────

@router.get("/conflict-detail")
async def get_conflict_detail(
    cwd: str = Query(..., description="仓库/worktree路径"),
    file_path: str = Query(..., description="冲突文件相对路径"),
):
    """获取冲突文件详情（base/ours/theirs/conflict_markers）。"""
    _resolve_and_validate(cwd)

    # 确认合并进行中
    code, _ = await git_command(Path(cwd), ["rev-parse", "--verify", "MERGE_HEAD"], timeout=5)
    if code != 0:
        raise HTTPException(status_code=409, detail="当前没有进行中的合并")

    result = await git_conflict_content(cwd, file_path)
    return result


# ── 解决冲突 ─────────────────────────────────────────────────────────────────

class ResolveConflictRequest(BaseModel):
    cwd: str
    file_path: str
    resolved_content: str


@router.post("/resolve-conflict")
async def resolve_conflict(req: ResolveConflictRequest):
    """解决单个文件冲突：写入 resolved_content 并 git add。"""
    _resolve_and_validate(req.cwd)

    target = Path(req.cwd) / req.file_path
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(req.resolved_content, encoding="utf-8")
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"写入文件失败: {e}")

    code, output = await git_command(Path(req.cwd), ["add", req.file_path], timeout=15)
    if code != 0:
        raise HTTPException(status_code=500, detail=f"git add 失败: {output}")

    return {"ok": True, "file_path": req.file_path}


# ── AI 解决冲突 ──────────────────────────────────────────────────────────────

AI_RESOLVE_TIMEOUT = 120

AI_MERGE_SYSTEM_PROMPT = (
    "你是一位精通 Git 合并的代码专家。给定一个文件的三个版本（base、ours、theirs），"
    "请智能合并为一个无冲突的最终版本。\n\n"
    "要求：\n"
    "1. 保留双方的有意义修改\n"
    "2. 不要删除任何一方的新增功能\n"
    "3. 确保代码语法正确、可编译\n"
    "4. 输出格式：先输出合并后的完整文件内容（在 ```merged 代码块中），"
    "然后用一行 '---EXPLANATION---' 分隔，最后给出简要解释。"
)


class AIResolveConflictRequest(BaseModel):
    project_id: str
    work_item_id: Optional[str] = None
    file_path: str
    base_content: str
    ours_content: str
    theirs_content: str


@router.post("/ai-resolve-conflict")
async def ai_resolve_conflict(req: AIResolveConflictRequest):
    """AI 解决冲突：通过 Agent CLI 分析三方内容并返回合并结果。"""
    from backend.runtime.config import DEFAULT_AGENT_ID, DEFAULT_CWD
    from backend.runtime.executor import AgentExecutor

    user_prompt = (
        f"## 文件: {req.file_path}\n\n"
        f"### BASE 版本\n```\n{req.base_content}\n```\n\n"
        f"### OURS 版本 (当前分支)\n```\n{req.ours_content}\n```\n\n"
        f"### THEIRS 版本 (合入分支)\n```\n{req.theirs_content}\n```\n\n"
        "请合并以上三个版本，输出完整的合并结果。"
    )
    full_prompt = f"{AI_MERGE_SYSTEM_PROMPT}\n\n---\n\n{user_prompt}"

    executor = AgentExecutor()
    task_id = f"ai-merge-{uuid.uuid4().hex[:8]}"
    agent_id = DEFAULT_AGENT_ID
    cwd = str(DEFAULT_CWD)

    output_parts: list[str] = []
    try:
        async with asyncio.timeout(AI_RESOLVE_TIMEOUT):
            async for event in executor.run_task(
                task_id=task_id,
                agent_id=agent_id,
                prompt=full_prompt,
                cwd=cwd,
                full_auto=True,
            ):
                if event.type == "output":
                    output_parts.append(event.content)
                elif event.type == "completed":
                    if event.content:
                        output_parts.append(event.content)
                elif event.type == "failed":
                    raise HTTPException(
                        status_code=502,
                        detail=f"Agent 执行失败: {event.content or 'unknown'}",
                    )
    except asyncio.TimeoutError:
        await executor.cancel_task(task_id)
        raise HTTPException(status_code=504, detail=f"AI 合并超时 ({AI_RESOLVE_TIMEOUT}s)")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("[ai-resolve-conflict] Agent CLI 调用异常")
        raise HTTPException(status_code=502, detail=f"AI 服务调用失败: {e}")

    raw_result = "\n".join(p for p in output_parts if p)

    # 解析输出：提取 ```merged ... ``` 代码块和解释
    import re
    resolved_content = ""
    explanation = ""

    # 尝试提取代码块
    code_match = re.search(r"```(?:merged)?\s*\n(.*?)```", raw_result, re.DOTALL)
    if code_match:
        resolved_content = code_match.group(1)
    else:
        # fallback: 如果没有代码块，取分隔符前的全部内容
        if "---EXPLANATION---" in raw_result:
            resolved_content = raw_result.split("---EXPLANATION---")[0].strip()
        else:
            resolved_content = raw_result

    if "---EXPLANATION---" in raw_result:
        explanation = raw_result.split("---EXPLANATION---", 1)[1].strip()

    return {"resolved_content": resolved_content, "explanation": explanation}
