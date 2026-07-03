"""Git 审计 API 路由。

提供按项目维度的 commit 列表、变更聚合统计、单 commit diff 查看等端点。
"""

import base64
import binascii
import logging
import re
from typing import Optional

from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy import text as sa_text

from backend.core.dependencies import get_optional_user
from backend.runtime.git_utils import (
    git_command, git_log_files, git_diff_full,
    git_push, git_fetch, git_ensure_remote,
    git_list_remote_branches, git_merge_branch, git_repo_root,
)
from backend.db.engine import async_session_factory
from pathlib import Path

router = APIRouter(prefix="/api/projects", tags=["git-audit"])
logger = logging.getLogger("tide.api.git_audit")


# ── 角色过滤辅助函数 ────────────────────────────────────────────────────────────


async def _should_filter_by_user(project_id: str, current_user: Optional[dict]) -> bool:
    """判断当前用户是否需要按个人数据过滤。

    不过滤的情况：
    - 未登录（未启用强制认证）
    - 系统 admin（users.role == 'admin'）
    - 项目 admin（project_members.role == 'admin'）
    - 项目 viewer（project_members.role == 'viewer'）
    - 项目无成员记录（未配置成员管理）

    需要过滤：项目 member
    """
    if not current_user:
        return False
    # 系统 admin
    if current_user.get("role") == "admin":
        return False
    # 查询项目角色
    async with async_session_factory() as session:
        result = await session.execute(
            sa_text(
                "SELECT role FROM project_members"
                " WHERE project_id = :pid AND user_id = :uid LIMIT 1"
            ),
            {"pid": project_id, "uid": current_user["id"]},
        )
        row = result.fetchone()
    if not row:
        # 项目无成员记录，不过滤
        return False
    # admin 或 viewer 不过滤
    if row[0] in ("admin", "viewer"):
        return False
    # member 需要过滤
    return True


def _get_user_git_identities(current_user: Optional[dict]) -> list[str]:
    """获取用户可能的 git author 标识（用于 --author 匹配）。

    git --author 支持正则匹配，会匹配 author name 或 email 中包含该字符串的提交。
    返回优先级从高到低的标识列表（email > display_name > username）。
    """
    if not current_user:
        return []
    identities: list[str] = []
    if current_user.get("email"):
        identities.append(current_user["email"])
    if current_user.get("display_name"):
        identities.append(current_user["display_name"])
    if current_user.get("username") and current_user["username"] not in identities:
        identities.append(current_user["username"])
    return identities


def _decode_project_path(project_id: str) -> str:
    """将 base64 编码的 project_id 解码为实际路径。

    project_id 是 URL-safe Base64 编码，编码时 rstrip("=")，因此解码时需补齐 padding。
    """
    s = project_id or ""
    pad = "=" * (-len(s) % 4)
    try:
        decoded = base64.urlsafe_b64decode((s + pad).encode()).decode("utf-8")
        if decoded:
            return decoded
    except (binascii.Error, UnicodeDecodeError, ValueError):
        pass
    # 回退：当作裸路径处理（向后兼容）
    if project_id and Path(project_id).is_absolute():
        return project_id
    raise HTTPException(status_code=400, detail=f"无效的 project_id: {project_id}")


def _decode_git_path(path: str) -> str:
    """解码 git 输出中的八进制转义路径。

    git 对含非 ASCII 字符的文件名会输出如 "docs/\\346\\265\\213\\350\\257\\225.md" 格式，
    本方法将其解码为正常 UTF-8 字符串。
    """
    import re
    path = path.strip('"')
    if not re.search(r'\\[0-9]{3}', path):
        return path
    parts = re.split(r'(\\[0-9]{3})', path)
    result = b''
    for part in parts:
        if re.match(r'\\[0-9]{3}', part):
            result += bytes([int(part[1:], 8)])
        else:
            result += part.encode('utf-8')
    try:
        return result.decode('utf-8')
    except (UnicodeDecodeError, ValueError):
        return path


def _parse_log_output(raw: str) -> list[dict]:
    """解析 git log --numstat --format=%H|%an|%aI|%s 的输出。

    numstat 格式示例：
        abc123|Author|2024-01-01T00:00:00+08:00|commit message
        10\t5\tfile1.py
        0\t3\tfile2.py
        -\t-\tbinary.png

        def456|Author|2024-01-02T00:00:00+08:00|another commit
        0\t15\tfile3.py

    二进制文件显示 `-` 而非数字，解析时将非数字值当作 0。
    """
    commits: list[dict] = []
    current: dict | None = None

    for line in raw.splitlines():
        line = line.rstrip()
        if not line:
            continue

        # 尝试匹配 commit 行：hash|author|date|message
        if "|" in line and not line.startswith(("\t", " ")):
            parts = line.split("|", 3)
            if len(parts) == 4 and len(parts[0]) == 40:
                if current:
                    commits.append(current)
                current = {
                    "hash": parts[0],
                    "author": parts[1],
                    "date": parts[2],
                    "message": parts[3],
                    "files": [],
                }
                continue

        # numstat 行：additions\tdeletions\tpath
        if current is not None and "\t" in line:
            parts = line.split("\t")
            if len(parts) >= 3:
                raw_add = parts[0].strip()
                raw_del = parts[1].strip()
                file_path = _decode_git_path("\t".join(parts[2:]).strip())
                # 非数字值（如二进制文件的 "-"）解析为 0
                additions = int(raw_add) if raw_add.isdigit() else 0
                deletions = int(raw_del) if raw_del.isdigit() else 0
                # 从增删行数推断状态
                if additions > 0 and deletions == 0 and raw_add != "-":
                    status = "A"  # 可能是新增文件
                elif additions == 0 and deletions > 0 and raw_del != "-":
                    status = "D"  # 可能是删除文件
                else:
                    status = "M"  # 修改或二进制
                current["files"].append({
                    "path": file_path,
                    "status": status,
                    "additions": additions,
                    "deletions": deletions,
                })

    if current:
        commits.append(current)

    return commits


@router.post("/{project_id}/git/cleanup-branches")
async def cleanup_stale_branches(
    project_id: str,
):
    """清理项目中已完成/取消工作项的残留分支和 worktree。
    
    1. 执行 git worktree prune 清理 stale worktree 引用
    2. 强制移除 tide/ 前缀分支对应的 worktree 目录
    3. 删除所有 tide/ 前缀的分支
    """
    cwd = _decode_project_path(project_id)
    if not Path(cwd).is_dir():
        raise HTTPException(status_code=404, detail=f"项目路径不存在: {cwd}")

    # 1. prune stale worktrees
    await git_command(Path(cwd), ["worktree", "prune"], timeout=10)

    # 2. 获取所有 worktree 及其分支的映射
    code_wt, wt_output = await git_command(
        Path(cwd), ["worktree", "list", "--porcelain"], timeout=10
    )
    # 解析 worktree 列表：每个 worktree 块以空行分隔
    worktree_map: dict[str, str] = {}  # branch -> worktree_path
    current_wt_path = ""
    if code_wt == 0:
        for line in wt_output.splitlines():
            if line.startswith("worktree "):
                current_wt_path = line.replace("worktree ", "").strip()
            elif line.startswith("branch refs/heads/"):
                branch = line.replace("branch refs/heads/", "").strip()
                if branch.startswith("tide/"):
                    worktree_map[branch] = current_wt_path

    # 3. 强制移除 tide/ 分支对应的 worktree
    for branch, wt_path in worktree_map.items():
        if wt_path and wt_path != cwd:  # 不要误删主 worktree
            await git_command(
                Path(cwd), ["worktree", "remove", "--force", wt_path], timeout=30
            )

    # 4. 再次 prune
    await git_command(Path(cwd), ["worktree", "prune"], timeout=10)

    # 5. 获取剩余的 tide/ 分支并删除
    code, output = await git_command(
        Path(cwd), ["branch", "--format=%(refname:short)"], timeout=10
    )
    if code != 0:
        raise HTTPException(status_code=500, detail=f"获取分支列表失败: {output[:300]}")

    branches = [b.strip() for b in output.splitlines() if b.strip()]
    tide_branches = [b for b in branches if b.startswith("tide/")]

    cleaned = []
    for branch in tide_branches:
        code3, _ = await git_command(
            Path(cwd), ["branch", "-D", branch], timeout=10
        )
        if code3 == 0:
            cleaned.append(branch)

    return {"cleaned": len(cleaned), "branches": cleaned}

@router.post("/{project_id}/git/fetch")
async def git_fetch_remote(project_id: str):
    """执行 git fetch origin --prune，同步远端分支信息。"""
    cwd = _decode_project_path(project_id)
    repo_root = await git_repo_root(Path(cwd))
    if not repo_root:
        raise HTTPException(status_code=400, detail="Not a git repository")

    code, output = await git_command(repo_root, ["fetch", "origin", "--prune"], timeout=60)
    if code != 0:
        raise HTTPException(status_code=500, detail=f"git fetch failed: {output[:500]}")

    return {"ok": True, "output": output[:500]}


@router.get("/{project_id}/git/branches")
async def get_project_branches(
    project_id: str,
):
    """获取项目的 Git 分支列表。"""
    cwd = _decode_project_path(project_id)
    if not Path(cwd).is_dir():
        raise HTTPException(status_code=404, detail=f"项目路径不存在: {cwd}")

    # 先清理已删除目录的 stale worktree 引用
    await git_command(Path(cwd), ["worktree", "prune"], timeout=10)

    code, output = await git_command(
        Path(cwd), ["branch", "--format=%(refname:short)"], timeout=10
    )
    if code != 0:
        raise HTTPException(status_code=500, detail=f"获取分支列表失败: {output[:300]}")

    branches = [b.strip() for b in output.splitlines() if b.strip()]

    # 获取当前分支
    code2, current_output = await git_command(
        Path(cwd), ["rev-parse", "--abbrev-ref", "HEAD"], timeout=5
    )
    current_branch = current_output.strip() if code2 == 0 else None

    return {"branches": branches, "current": current_branch}


@router.get("/{project_id}/git/remote-branches")
async def get_remote_branches(project_id: str):
    """获取项目远程分支列表（基于本地 tracking 信息）。"""
    cwd = _decode_project_path(project_id)
    if not Path(cwd).is_dir():
        raise HTTPException(status_code=404, detail=f"项目路径不存在: {cwd}")

    branches, error = await git_list_remote_branches(Path(cwd))
    if error:
        raise HTTPException(status_code=500, detail=f"获取远程分支失败: {error}")

    return {"branches": branches}


@router.get("/{project_id}/git/commits")
async def get_project_commits(
    project_id: str,
    branch: Optional[str] = Query(None, description="分支名"),
    since: Optional[str] = Query(None, description="起始时间 (ISO 格式)"),
    until: Optional[str] = Query(None, description="截止时间 (ISO 格式)"),
    limit: int = Query(50, ge=1, le=200, description="最大返回条数"),
    work_item_id: Optional[str] = Query(None, description="按工作项分支筛选"),
    version_id: Optional[str] = Query(None, description="按版本关联分支筛选"),
    all_branches: bool = Query(False, description="搜索所有分支（用于会话级跨分支查询）"),
):
    """获取项目的 commit 列表（含修改文件）。展示项目级全量数据，不做用户过滤。"""
    cwd = _decode_project_path(project_id)
    if not Path(cwd).is_dir():
        raise HTTPException(status_code=404, detail=f"项目路径不存在: {cwd}")

    # 如果指定了 version_id，查询版本关联的所有分支获取 commit
    if version_id:
        commits = await _get_version_commits(project_id, version_id, cwd, limit, since, until)
        return {"commits": commits, "total": len(commits)}

    # 如果指定了 work_item_id，按工作项分支筛选
    effective_branch = branch
    if work_item_id and not branch:
        from backend.runtime.git_utils import work_item_branch_name
        effective_branch = work_item_branch_name(work_item_id)

    # 当未指定具体分支时，默认查询所有分支，避免版本分支提交不可见
    effective_all_branches = all_branches or (not effective_branch)

    code, output = await git_log_files(
        cwd=cwd,
        branch=effective_branch,
        limit=limit,
        since=since,
        until=until,
        all_branches=effective_all_branches,
    )
    if code != 0:
        raise HTTPException(status_code=500, detail=f"git log 失败: {output[:500]}")

    commits = _parse_log_output(output)
    return {"commits": commits, "total": len(commits)}


@router.get("/{project_id}/git/changes")
async def get_project_changes(
    project_id: str,
    group_by: str = Query("branch", description="聚合维度: work_item | session | branch | version"),
    since: Optional[str] = Query(None, description="起始时间"),
    until: Optional[str] = Query(None, description="截止时间"),
    current_user: Optional[dict] = Depends(get_optional_user),
):
    """按维度聚合变更统计。

    - group_by=work_item: 从 DB 查询当前项目工作项，按工作项关联的分支统计变更
    - group_by=session: 从 DB 查询当前项目的 tasks，按 session_id 分组统计变更
    - group_by=branch: 列出所有分支的变更统计
    - group_by=version: 从 DB 查询版本及关联工作项分支，按版本聚合变更
    """
    cwd = _decode_project_path(project_id)
    if not Path(cwd).is_dir():
        raise HTTPException(status_code=404, detail=f"项目路径不存在: {cwd}")

    if group_by not in ("work_item", "session", "branch", "version"):
        raise HTTPException(status_code=400, detail="group_by 必须为 work_item / session / branch / version")

    if group_by == "work_item":
        results = await _group_by_work_item(project_id, cwd, since, until)
    elif group_by == "session":
        # 按会话 Tab 保留用户过滤
        should_filter = await _should_filter_by_user(project_id, current_user)
        results = await _group_by_session(project_id, cwd, since, until, current_user if should_filter else None)
    elif group_by == "version":
        results = await _group_by_version(project_id, cwd, since, until)
    else:
        results = await _group_by_branch(cwd, since, until)

    return {"changes": results, "group_by": group_by}


async def _get_main_branch(cwd: str) -> Optional[str]:
    """获取主分支名称（main 或 master）。"""
    code, branches_output = await git_command(
        Path(cwd), ["branch", "--format=%(refname:short)"], timeout=10
    )
    if code != 0:
        return None
    branches = [b.strip() for b in branches_output.splitlines() if b.strip()]
    for candidate in ("main", "master"):
        if candidate in branches:
            return candidate
    return None


async def _branch_stats(
    cwd: str,
    branch_name: str,
    main_branch: Optional[str],
    since: Optional[str] = None,
    until: Optional[str] = None,
    author: Optional[str] = None,
) -> Optional[dict]:
    """统计某个分支相对于主分支的 commit 数、文件变更、增删行数。

    当 author 非空时，只统计该作者的提交。
    返回 None 表示该分支不存在或无 commits。
    """
    # 先确认分支存在
    code, _ = await git_command(
        Path(cwd), ["rev-parse", "--verify", branch_name], timeout=5
    )
    if code != 0:
        return None

    # 计算 commit 范围
    if main_branch and branch_name != main_branch:
        commit_range = f"{main_branch}..{branch_name}"
    else:
        commit_range = branch_name

    args = ["log", commit_range, "--format=%H", "--max-count=200"]
    if since:
        args.append(f"--since={since}")
    if until:
        args.append(f"--until={until}")
    if author:
        args.append(f"--author={author}")

    code, log_out = await git_command(Path(cwd), args, timeout=15)
    if code != 0:
        return None

    commit_hashes = [h.strip() for h in log_out.splitlines() if h.strip()]
    commit_count = len(commit_hashes)
    if commit_count == 0:
        return None

    # diff stat
    additions = 0
    deletions = 0
    files_changed = 0

    if main_branch and branch_name != main_branch:
        diff_args = ["log", "--numstat", "--format=", f"{main_branch}..{branch_name}"]
        if author:
            diff_args.append(f"--author={author}")
        code, stat_out = await git_command(
            Path(cwd), diff_args, timeout=15,
        )
        if code == 0 and stat_out:
            for line in stat_out.splitlines():
                line = line.strip()
                if not line or "\t" not in line:
                    continue
                parts = line.split("\t")
                if len(parts) >= 3:
                    add_str = parts[0].strip()
                    del_str = parts[1].strip()
                    additions += int(add_str) if add_str.isdigit() else 0
                    deletions += int(del_str) if del_str.isdigit() else 0
                    files_changed += 1

    return {
        "commit_count": commit_count,
        "files_changed": files_changed,
        "additions": additions,
        "deletions": deletions,
    }


async def _time_range_stats(
    cwd: str,
    time_since: Optional[str] = None,
    time_until: Optional[str] = None,
    author: Optional[str] = None,
) -> Optional[dict]:
    """统计指定时间范围内的 git commit 变更。

    使用 git log --after/--before 按时间窗口检索 commit，
    并用 --numstat 汇总文件变更、增删行数。
    当 author 非空时，只统计该作者的提交。
    适用于会话级统计（按 created_at ~ last_active 时间窗口匹配 commit）。

    Returns:
        变更统计字典，无 commit 时返回 None。
    """
    if not time_since and not time_until:
        return None

    args = ["log", "--all", "--numstat", "--format=%H"]
    if time_since:
        args.append(f"--after={time_since}")
    if time_until:
        args.append(f"--before={time_until}")
    if author:
        args.append(f"--author={author}")

    code, output = await git_command(Path(cwd), args, timeout=30)
    if code != 0:
        return None

    commit_hashes: set[str] = set()
    all_files: set[str] = set()
    total_additions = 0
    total_deletions = 0

    for line in output.splitlines():
        line = line.strip()
        if not line:
            continue
        # commit hash 行（40 个十六进制字符）
        if len(line) == 40 and all(c in "0123456789abcdef" for c in line):
            commit_hashes.add(line)
            continue
        # numstat 行：additions\tdeletions\tpath
        if "\t" in line:
            parts = line.split("\t")
            if len(parts) >= 3:
                add_str = parts[0].strip()
                del_str = parts[1].strip()
                file_path = _decode_git_path("\t".join(parts[2:]))
                total_additions += int(add_str) if add_str.isdigit() else 0
                total_deletions += int(del_str) if del_str.isdigit() else 0
                all_files.add(file_path)

    if not commit_hashes:
        return None

    return {
        "commit_count": len(commit_hashes),
        "files_changed": len(all_files),
        "additions": total_additions,
        "deletions": total_deletions,
    }


async def _group_by_work_item(
    project_id: str,
    cwd: str,
    since: Optional[str],
    until: Optional[str],
) -> list[dict]:
    """按工作项分组：从 DB 查询工作项，关联其 branch_name 统计 Git 变更。

    展示项目级全量数据，不做用户过滤。
    """
    from backend.runtime.git_utils import work_item_branch_name

    main_branch = await _get_main_branch(cwd)

    # 1. 查询当前项目的工作项及其关联的分支（通过 transitions -> tasks）
    async with async_session_factory() as session:
        base_sql = """
                SELECT wi.id, wi.title, wi.assignee,
                       t.branch_name AS task_branch
                FROM work_items wi
                LEFT JOIN work_item_transitions wit ON wit.work_item_id = wi.id
                LEFT JOIN tasks t ON t.id = wit.task_id
                    AND t.branch_name IS NOT NULL
                    AND t.branch_name != ''
                WHERE wi.project_id = :project_id
                ORDER BY wi.created_at DESC
        """
        params: dict = {"project_id": project_id}

        rows = await session.execute(sa_text(base_sql), params)
        all_rows = rows.fetchall()

    # 2. 合并：每个工作项可能有多条 transition 记录，取第一个有效 branch
    work_items: dict[str, dict] = {}  # wi_id -> {title, branch}
    for row in all_rows:
        wi_id = row[0]
        if wi_id in work_items:
            # 已有记录，若当前还没 branch 则尝试填充
            if not work_items[wi_id]["branch"] and row[3]:
                work_items[wi_id]["branch"] = row[3]
        else:
            work_items[wi_id] = {
                "title": row[1],
                "branch": row[3] or "",
            }

    # 3. 对没有从 transitions 获得 branch 的工作项，使用约定分支名
    for wi_id, info in work_items.items():
        if not info["branch"]:
            info["branch"] = work_item_branch_name(wi_id)

    # 4. 对每个工作项统计 Git 变更
    results: list[dict] = []
    for wi_id, info in work_items.items():
        branch = info["branch"]
        stats = await _branch_stats(cwd, branch, main_branch, since, until)
        if stats is None:
            # 分支不存在或无变更，仍保留条目但数据为零
            results.append({
                "name": info["title"],
                "id": wi_id,
                "branch": branch,
                "commit_count": 0,
                "files_changed": 0,
                "additions": 0,
                "deletions": 0,
            })
        else:
            results.append({
                "name": info["title"],
                "id": wi_id,
                "branch": branch,
                **stats,
            })

    return results


async def _group_by_version(
    project_id: str,
    cwd: str,
    since: Optional[str],
    until: Optional[str],
) -> list[dict]:
    """按版本分组：从 DB 查询版本及关联工作项分支，聚合 Git 变更统计。"""
    from backend.runtime.git_utils import work_item_branch_name, version_branch_name

    main_branch = await _get_main_branch(cwd)

    # 1. 查询项目所有版本 + 关联工作项 + 工作项分支（一次 JOIN 查询）
    async with async_session_factory() as session:
        rows = await session.execute(
            sa_text("""
                SELECT v.id, v.name, wi.id, wi.title, t.branch_name
                FROM versions v
                LEFT JOIN work_items wi ON wi.version_id = v.id
                LEFT JOIN work_item_transitions wit ON wit.work_item_id = wi.id
                LEFT JOIN tasks t ON t.id = wit.task_id AND t.branch_name IS NOT NULL
                WHERE v.project_id = :project_id
                ORDER BY v.created_at DESC, wi.created_at DESC
            """),
            {"project_id": project_id},
        )
        all_rows = rows.fetchall()

    # 2. 按版本分组，收集每个版本下所有工作项的分支
    version_map: dict[str, dict] = {}  # version_id -> {name, branches: set}
    for row in all_rows:
        v_id, v_name, wi_id, wi_title, branch_name = row[0], row[1], row[2], row[3], row[4]
        if v_id not in version_map:
            version_map[v_id] = {"name": v_name, "branches": set()}
        if branch_name:
            version_map[v_id]["branches"].add(branch_name)
        elif wi_id:
            # 无分支记录时使用约定分支名
            version_map[v_id]["branches"].add(work_item_branch_name(wi_id))

    # 额外添加版本对应的 feature 分支本身
    for v_id, info in version_map.items():
        vb = version_branch_name(info["name"])
        info["branches"].add(vb)

    # 3. 对每个版本的分支集合调用 _branch_stats 聚合统计
    results: list[dict] = []
    for v_id, info in version_map.items():
        total_commits = 0
        total_files = 0
        total_additions = 0
        total_deletions = 0
        used_branch = ""

        for branch in info["branches"]:
            stats = await _branch_stats(cwd, branch, main_branch, since, until)
            if stats:
                total_commits += stats["commit_count"]
                total_files += stats["files_changed"]
                total_additions += stats["additions"]
                total_deletions += stats["deletions"]
                if not used_branch:
                    used_branch = branch

        results.append({
            "id": v_id,
            "name": info["name"],
            "branch": used_branch,
            "branches": list(info["branches"]),
            "commit_count": total_commits,
            "files_changed": total_files,
            "additions": total_additions,
            "deletions": total_deletions,
        })

    return results


async def _get_version_commits(
    project_id: str,
    version_id: str,
    cwd: str,
    limit: int,
    since: Optional[str],
    until: Optional[str],
) -> list[dict]:
    """获取版本关联的所有分支上的 commit，去重并按时间倒序排列。"""
    from backend.runtime.git_utils import work_item_branch_name, version_branch_name

    # 1. 查询版本名称
    async with async_session_factory() as session:
        row = await session.execute(
            sa_text("SELECT name FROM versions WHERE id = :vid"),
            {"vid": version_id},
        )
        version_row = row.fetchone()

    if not version_row:
        return []

    version_name = version_row[0]
    branches: set[str] = set()

    # 2. 添加版本对应的 feature 分支
    vb = version_branch_name(version_name)
    branches.add(vb)

    # 3. 查询版本关联工作项的分支
    async with async_session_factory() as session:
        rows = await session.execute(
            sa_text("""
                SELECT DISTINCT t.branch_name
                FROM work_items wi
                JOIN work_item_transitions wit ON wit.work_item_id = wi.id
                JOIN tasks t ON t.id = wit.task_id
                WHERE wi.version_id = :version_id
                  AND t.branch_name IS NOT NULL AND t.branch_name != ''
            """),
            {"version_id": version_id},
        )
        for r in rows.fetchall():
            branches.add(r[0])

    # 4. 查询版本关联工作项（无分支记录时使用约定分支名）
    async with async_session_factory() as session:
        rows = await session.execute(
            sa_text("""
                SELECT wi.id FROM work_items wi
                WHERE wi.version_id = :version_id
                  AND wi.id NOT IN (
                      SELECT wit2.work_item_id FROM work_item_transitions wit2
                      JOIN tasks t2 ON t2.id = wit2.task_id
                      WHERE t2.branch_name IS NOT NULL AND t2.branch_name != ''
                  )
            """),
            {"version_id": version_id},
        )
        for r in rows.fetchall():
            branches.add(work_item_branch_name(r[0]))

    # 5. 对每个分支执行 git log 获取 commit 列表
    seen_hashes: set[str] = set()
    all_commits: list[dict] = []

    for branch in branches:
        # 先确认分支存在
        code, _ = await git_command(
            Path(cwd), ["rev-parse", "--verify", branch], timeout=5
        )
        if code != 0:
            continue

        code, output = await git_log_files(
            cwd=cwd,
            branch=branch,
            limit=limit,
            since=since,
            until=until,
        )
        if code != 0:
            continue

        commits = _parse_log_output(output)
        for commit in commits:
            if commit["hash"] not in seen_hashes:
                seen_hashes.add(commit["hash"])
                all_commits.append(commit)

    # 6. 按时间倒序排列
    all_commits.sort(key=lambda c: c.get("date", ""), reverse=True)

    # 7. 截取 limit
    return all_commits[:limit]


async def _group_by_session(
    project_id: str,
    cwd: str,
    since: Optional[str],
    until: Optional[str],
    filter_user: Optional[dict] = None,
) -> list[dict]:
    """按会话分组：复用 session_discovery 获取项目下所有会话，补充 Git 变更统计。

    数据源与主菜单会话列表一致（DB + 文件系统扫描合并），确保展示一致性。
    当 filter_user 非空时，只统计该用户的 git 提交，并隐藏无关会话。
    """
    from backend.services.session_discovery import discover_sessions

    main_branch = await _get_main_branch(cwd)

    # 1. 从 session_discovery 获取项目下的所有会话（与主菜单一致）
    file_sessions = discover_sessions(project_cwd=cwd)

    # 2. 从 DB tasks 表查询项目下有 session_id 的记录（补充 DB-only 会话）
    cwd_pattern = cwd.rstrip("/") + "%"
    async with async_session_factory() as session:
        rows = await session.execute(
            sa_text("""
                SELECT session_id,
                       branch_name,
                       commit_hash,
                       prompt,
                       MAX(created_at) as last_active,
                       COUNT(*) as task_count
                FROM tasks
                WHERE session_id IS NOT NULL
                  AND session_id != ''
                  AND (cwd = :cwd OR cwd LIKE :cwd_pattern)
                GROUP BY session_id
                ORDER BY last_active DESC
            """),
            {"cwd": cwd.rstrip("/"), "cwd_pattern": cwd_pattern},
        )
        db_rows = rows.fetchall()

    # 3. 构建 session_id -> DB 信息映射
    db_session_map: dict[str, dict] = {}
    for row in db_rows:
        sid = row[0]
        db_session_map[sid] = {
            "branch": row[1] or "",
            "commit_hash": row[2] or "",
            "prompt": row[3] or "",
            "last_active": row[4] or "",
            "task_count": row[5] or 0,
        }

    # 4. 查询每个 session 的所有分支和 commit（用于 git 统计）
    session_branches: dict[str, set] = {}  # session_id -> set of branches
    session_commits: dict[str, set] = {}   # session_id -> set of commit_hashes
    if db_session_map:
        async with async_session_factory() as session:
            rows2 = await session.execute(
                sa_text("""
                    SELECT session_id, branch_name, commit_hash
                    FROM tasks
                    WHERE session_id IS NOT NULL
                      AND session_id != ''
                      AND (cwd = :cwd OR cwd LIKE :cwd_pattern)
                """),
                {"cwd": cwd.rstrip("/"), "cwd_pattern": cwd_pattern},
            )
            for r in rows2.fetchall():
                sid = r[0]
                if sid not in session_branches:
                    session_branches[sid] = set()
                    session_commits[sid] = set()
                if r[1]:
                    session_branches[sid].add(r[1])
                if r[2]:
                    session_commits[sid].add(r[2])

    # 5. 合并：以 file_sessions 为基础，补充 DB-only 会话
    seen_sids: set[str] = set()
    merged_sessions: list[dict] = []

    for fs in file_sessions:
        sid = fs.get("session_id") or fs.get("id") or ""
        if not sid or sid in seen_sids:
            continue
        seen_sids.add(sid)
        db_info = db_session_map.get(sid, {})
        merged_sessions.append({
            "session_id": sid,
            "title": fs.get("title") or db_info.get("prompt") or f"会话 {sid[:8]}",
            "last_active": fs.get("last_active") or db_info.get("last_active") or "",
            "task_count": db_info.get("task_count", 0),
            "created_at": fs.get("created_at") or "",
        })

    # DB 中存在但文件扫描未覆盖的会话
    for sid, db_info in db_session_map.items():
        if sid in seen_sids:
            continue
        seen_sids.add(sid)
        title = db_info.get("prompt") or ""
        if len(title) > 80:
            title = title[:79] + "…"
        merged_sessions.append({
            "session_id": sid,
            "title": title or f"会话 {sid[:8]}",
            "last_active": db_info.get("last_active") or "",
            "task_count": db_info.get("task_count", 0),
            "created_at": "",
        })

    # 6. 按 last_active 倒序排列
    merged_sessions.sort(key=lambda x: x.get("last_active") or "", reverse=True)

    # 7. 对每个会话统计 git 变更
    author_filter: Optional[str] = None
    if filter_user:
        identities = _get_user_git_identities(filter_user)
        if identities:
            author_filter = identities[0]

    results: list[dict] = []
    for s in merged_sessions:
        sid = s["session_id"]
        branches = session_branches.get(sid, set())

        best_stats: Optional[dict] = None
        used_branch = ""

        # 方式 1：尝试用关联的分支统计（tasks 表中有 branch_name 的情况）
        for branch in branches:
            stats = await _branch_stats(cwd, branch, main_branch, since, until, author=author_filter)
            if stats and (best_stats is None or stats["commit_count"] > best_stats["commit_count"]):
                best_stats = stats
                used_branch = branch

        # 方式 2：通过会话时间范围查询 git log（主要路径）
        if best_stats is None:
            sess_start = s.get("created_at") or ""
            sess_end = s.get("last_active") or ""
            if sess_start or sess_end:
                # 取 API 层面 since/until 与会话时间的交集
                effective_since = sess_start
                effective_until = sess_end
                if since and (not effective_since or since > effective_since):
                    effective_since = since
                if until and (not effective_until or until < effective_until):
                    effective_until = until
                best_stats = await _time_range_stats(
                    cwd, effective_since, effective_until, author=author_filter
                )

        if best_stats is None:
            best_stats = {
                "commit_count": 0,
                "files_changed": 0,
                "additions": 0,
                "deletions": 0,
            }

        # 当启用过滤时，跳过无提交的会话
        if filter_user and best_stats["commit_count"] == 0:
            continue

        results.append({
            "name": s["title"],
            "id": sid,
            "branch": used_branch,
            "task_count": s["task_count"],
            "last_active": s["last_active"],
            "created_at": s.get("created_at") or "",
            **best_stats,
        })

    return results


async def _group_by_branch(
    cwd: str,
    since: Optional[str],
    until: Optional[str],
) -> list[dict]:
    """按分支分组：列出所有分支的变更统计。展示项目级全量数据，不做用户过滤。"""
    code, branches_output = await git_command(
        Path(cwd), ["branch", "--format=%(refname:short)"], timeout=10
    )
    if code != 0:
        return []

    branches = [b.strip() for b in branches_output.splitlines() if b.strip()]
    main_branch = None
    for candidate in ("main", "master"):
        if candidate in branches:
            main_branch = candidate
            break

    results: list[dict] = []
    for branch_name in branches:
        stats = await _branch_stats(cwd, branch_name, main_branch, since, until)
        if stats is None:
            continue
        results.append({
            "name": branch_name,
            "branch": branch_name,
            **stats,
        })

    return results


@router.get("/{project_id}/git/uncommitted")
async def get_uncommitted_changes(
    project_id: str,
):
    """获取项目当前工作区未提交的改动（包含未暂存和已暂存文件）。"""
    cwd = _decode_project_path(project_id)
    if not Path(cwd).is_dir():
        raise HTTPException(status_code=404, detail=f"项目路径不存在: {cwd}")

    # 获取当前分支名
    code_br, branch_output = await git_command(
        Path(cwd), ["rev-parse", "--abbrev-ref", "HEAD"], timeout=5
    )
    current_branch = branch_output.strip() if code_br == 0 else None

    code, output = await git_command(
        Path(cwd), ["status", "--porcelain", "-uall"], timeout=10
    )
    if code != 0:
        raise HTTPException(status_code=500, detail=f"获取 git status 失败: {output[:300]}")

    files: list[dict] = []
    for line in output.splitlines():
        if not line or len(line) < 4:
            continue
        # porcelain 格式: XY path 或 XY path -> new_path
        index_status = line[0]  # 暂存区状态
        work_status = line[1]   # 工作区状态
        file_path = _decode_git_path(line[3:].strip())

        # 确定文件状态
        if index_status == "?" and work_status == "?":
            status = "untracked"
            staged = False
        elif index_status != " " and index_status != "?":
            # 已暂存
            staged = True
            if index_status == "A":
                status = "added"
            elif index_status == "D":
                status = "deleted"
            elif index_status == "R":
                status = "renamed"
            else:
                status = "modified"
        else:
            # 未暂存的工作区变更
            staged = False
            if work_status == "D":
                status = "deleted"
            else:
                status = "modified"

        files.append({
            "path": file_path,
            "status": status,
            "staged": staged,
        })

    return {"files": files, "total": len(files), "current_branch": current_branch}


@router.get("/{project_id}/git/diff/{commit_hash}")
async def get_commit_diff(
    project_id: str,
    commit_hash: str,
):
    """获取特定 commit 的完整 diff。"""
    cwd = _decode_project_path(project_id)
    if not Path(cwd).is_dir():
        raise HTTPException(status_code=404, detail=f"项目路径不存在: {cwd}")

    # 验证 commit hash 格式
    if not re.match(r"^[0-9a-fA-F]{7,40}$", commit_hash):
        raise HTTPException(status_code=400, detail="无效的 commit hash 格式")

    # git show --format= 只显示 diff
    code, output = await git_command(
        Path(cwd), ["show", "--format=", commit_hash], timeout=30
    )
    if code != 0:
        raise HTTPException(status_code=404, detail=f"获取 commit diff 失败: {output[:300]}")

    return PlainTextResponse(output)


# ── Git 操作端点 ─────────────────────────────────────────────────────────────

class GitCommitRequest(BaseModel):
    files: list[str] | None = None
    message: str


class GitDiscardRequest(BaseModel):
    files: list[str] | None = None


class GitIgnoreRequest(BaseModel):
    files: list[str]


class GitBranchCreateRequest(BaseModel):
    branch_name: str
    start_point: str = "HEAD"


class GitPushRequest(BaseModel):
    branch_name: str
    remote: str = "origin"


class GitPullRequest(BaseModel):
    branch_name: Optional[str] = None
    remote: str = "origin"


class GitLocalMergeRequest(BaseModel):
    source_branch: str
    target_branch: str
    strategy: str = "merge"  # merge | squash | rebase
    delete_source: bool = False


class GitMergeRequestCreate(BaseModel):
    source_branch: str
    target_branch: str
    title: str
    description: Optional[str] = None


@router.post("/{project_id}/git/commit")
async def git_commit_files(
    project_id: str,
    req: GitCommitRequest,
):
    """提交文件：git add <files> && git commit -m <message>。"""
    cwd = _decode_project_path(project_id)
    if not Path(cwd).is_dir():
        raise HTTPException(status_code=404, detail=f"项目路径不存在: {cwd}")

    if not req.message or not req.message.strip():
        raise HTTPException(status_code=400, detail="commit message 不能为空")

    # git add 指定文件或全部
    if req.files:
        for f in req.files:
            code, output = await git_command(Path(cwd), ["add", "--", f], timeout=10)
            if code != 0:
                raise HTTPException(status_code=500, detail=f"git add 失败 ({f}): {output[:300]}")
    else:
        code, output = await git_command(Path(cwd), ["add", "-A"], timeout=30)
        if code != 0:
            raise HTTPException(status_code=500, detail=f"git add -A 失败: {output[:300]}")

    # git commit
    code, output = await git_command(
        Path(cwd), ["commit", "-m", req.message.strip()], timeout=30
    )
    if code != 0:
        raise HTTPException(status_code=500, detail=f"git commit 失败: {output[:300]}")

    return {"ok": True, "message": output[:500]}


@router.post("/{project_id}/git/discard")
async def git_discard_files(
    project_id: str,
    req: GitDiscardRequest,
):
    """撤销文件修改：对 tracked 文件用 git restore，对 untracked 文件删除。"""
    cwd = _decode_project_path(project_id)
    if not Path(cwd).is_dir():
        raise HTTPException(status_code=404, detail=f"项目路径不存在: {cwd}")

    # 获取当前 status 以判断哪些文件是 untracked
    code, status_output = await git_command(Path(cwd), ["status", "--porcelain", "-uall"], timeout=10)
    if code != 0:
        raise HTTPException(status_code=500, detail=f"git status 失败: {status_output[:300]}")

    untracked_files: set[str] = set()
    staged_files: set[str] = set()
    for line in status_output.splitlines():
        if not line or len(line) < 4:
            continue
        index_status = line[0]
        work_status = line[1]
        file_path = _decode_git_path(line[3:].strip())
        if index_status == "?" and work_status == "?":
            untracked_files.add(file_path)
        elif index_status != " " and index_status != "?":
            staged_files.add(file_path)

    target_files = req.files if req.files else None
    errors: list[str] = []

    if target_files:
        for f in target_files:
            if f in untracked_files:
                # 删除 untracked 文件
                full_path = Path(cwd) / f
                try:
                    if full_path.exists():
                        full_path.unlink()
                except OSError as e:
                    errors.append(f"删除 {f} 失败: {e}")
            else:
                # restore staged + unstaged changes
                if f in staged_files:
                    code, output = await git_command(
                        Path(cwd), ["restore", "--staged", "--", f], timeout=10
                    )
                    if code != 0:
                        errors.append(f"restore --staged {f}: {output[:200]}")
                code, output = await git_command(
                    Path(cwd), ["restore", "--", f], timeout=10
                )
                if code != 0:
                    errors.append(f"restore {f}: {output[:200]}")
    else:
        # 全部撤销
        # 先 unstage 已暂存的
        if staged_files:
            code, output = await git_command(Path(cwd), ["restore", "--staged", "."], timeout=30)
            if code != 0:
                errors.append(f"restore --staged .: {output[:200]}")
        # restore tracked changes
        code, output = await git_command(Path(cwd), ["restore", "."], timeout=30)
        if code != 0:
            errors.append(f"restore .: {output[:200]}")
        # 清理 untracked
        code, output = await git_command(Path(cwd), ["clean", "-fd"], timeout=30)
        if code != 0:
            errors.append(f"clean -fd: {output[:200]}")

    if errors:
        raise HTTPException(status_code=500, detail="; ".join(errors))

    return {"ok": True}


@router.post("/{project_id}/git/ignore")
async def git_ignore_files(
    project_id: str,
    req: GitIgnoreRequest,
):
    """将文件路径追加到 .gitignore。"""
    cwd = _decode_project_path(project_id)
    if not Path(cwd).is_dir():
        raise HTTPException(status_code=404, detail=f"项目路径不存在: {cwd}")

    if not req.files:
        raise HTTPException(status_code=400, detail="files 不能为空")

    gitignore_path = Path(cwd) / ".gitignore"

    # 读取现有内容
    existing_lines: set[str] = set()
    if gitignore_path.exists():
        try:
            content = gitignore_path.read_text(encoding="utf-8")
            existing_lines = {line.strip() for line in content.splitlines() if line.strip()}
        except OSError:
            pass

    # 追加新条目
    new_entries = [f for f in req.files if f.strip() not in existing_lines]
    if new_entries:
        try:
            with open(gitignore_path, "a", encoding="utf-8") as fh:
                # 确保前一行有换行
                if gitignore_path.stat().st_size > 0:
                    fh.write("\n")
                fh.write("\n".join(new_entries) + "\n")
        except OSError as e:
            raise HTTPException(status_code=500, detail=f"写入 .gitignore 失败: {e}")

    return {"ok": True, "added": new_entries}


# ── 辅助函数 ─────────────────────────────────────────────────────────────────


async def _get_project_git_config(project_id: str) -> dict:
    """获取项目的 Git 仓库配置。"""
    async with async_session_factory() as session:
        row = await session.execute(
            sa_text("SELECT metadata FROM project_settings WHERE project_id = :pid"),
            {"pid": project_id},
        )
        result = row.fetchone()
        if not result or not result[0]:
            return {}
        import json
        metadata = json.loads(result[0]) if isinstance(result[0], str) else result[0]
        return metadata.get("git_config", {}) if isinstance(metadata, dict) else {}


_BRANCH_NAME_RE = re.compile(r"^[a-zA-Z0-9._/\-]+$")


# ── 分支管理 API ──────────────────────────────────────────────────────────────


@router.post("/{project_id}/git/branches")
async def create_branch(
    project_id: str,
    req: GitBranchCreateRequest,
    current_user: Optional[dict] = Depends(get_optional_user),
):
    """创建本地分支。"""
    cwd = _decode_project_path(project_id)
    if not Path(cwd).is_dir():
        raise HTTPException(status_code=404, detail=f"项目路径不存在: {cwd}")

    if not _BRANCH_NAME_RE.match(req.branch_name):
        raise HTTPException(status_code=400, detail="分支名不合法，只允许字母、数字、. _ / -")

    code, output = await git_command(
        Path(cwd), ["branch", req.branch_name, req.start_point], timeout=10
    )
    if code != 0:
        raise HTTPException(status_code=500, detail=f"创建分支失败: {output[:300]}")

    return {"ok": True, "branch": req.branch_name}


@router.delete("/{project_id}/git/branches/{branch_name:path}")
async def delete_branch(
    project_id: str,
    branch_name: str,
    current_user: Optional[dict] = Depends(get_optional_user),
):
    """删除本地分支（不允许删除当前分支）。
    
    如果分支被 worktree 占用，会先移除 worktree 再删除分支。
    """
    cwd = _decode_project_path(project_id)
    if not Path(cwd).is_dir():
        raise HTTPException(status_code=404, detail=f"项目路径不存在: {cwd}")

    # 检查是否为当前分支
    code, current_output = await git_command(
        Path(cwd), ["rev-parse", "--abbrev-ref", "HEAD"], timeout=5
    )
    if code == 0 and current_output.strip() == branch_name:
        raise HTTPException(status_code=400, detail="不能删除当前所在分支")

    # 检查分支是否被 worktree 占用，如果是则先移除 worktree
    from backend.runtime.git_utils import find_worktree_for_branch
    wt_path = await find_worktree_for_branch(Path(cwd), branch_name)
    if wt_path:
        # 强制移除 worktree
        await git_command(Path(cwd), ["worktree", "remove", "--force", wt_path], timeout=30)
        # prune 清理残留引用
        await git_command(Path(cwd), ["worktree", "prune"], timeout=10)

    # 先尝试安全删除
    code, output = await git_command(Path(cwd), ["branch", "-d", branch_name], timeout=10)
    if code != 0:
        # 强制删除
        code, output = await git_command(Path(cwd), ["branch", "-D", branch_name], timeout=10)
        if code != 0:
            raise HTTPException(status_code=500, detail=f"删除分支失败: {output[:300]}")

    return {"ok": True}


# ── Push / Pull / MR API ───────────────────────────────────────────────────────


@router.post("/{project_id}/git/push")
async def git_push_branch(
    project_id: str,
    req: GitPushRequest,
    current_user: Optional[dict] = Depends(get_optional_user),
):
    """推送分支到远程仓库。"""
    cwd = _decode_project_path(project_id)
    if not Path(cwd).is_dir():
        raise HTTPException(status_code=404, detail=f"项目路径不存在: {cwd}")

    git_config = await _get_project_git_config(project_id)
    repo_url = git_config.get("repo_url", "")
    if not repo_url:
        raise HTTPException(status_code=400, detail="项目未配置 Git 仓库 URL")

    repo_root = Path(cwd)
    # 确保 remote 存在且 URL 正确
    await git_ensure_remote(repo_root, repo_url, req.remote)

    success, output = await git_push(repo_root, req.branch_name, req.remote, git_config=git_config)
    if not success:
        raise HTTPException(status_code=500, detail=f"push 失败: {output[:500]}")

    return {"ok": True, "output": output[:500]}


@router.post("/{project_id}/git/pull")
async def git_pull_branch(
    project_id: str,
    req: GitPullRequest,
    current_user: Optional[dict] = Depends(get_optional_user),
):
    """从远程拉取并合并。"""
    cwd = _decode_project_path(project_id)
    if not Path(cwd).is_dir():
        raise HTTPException(status_code=404, detail=f"项目路径不存在: {cwd}")

    git_config = await _get_project_git_config(project_id)
    repo_url = git_config.get("repo_url", "")
    repo_root = Path(cwd)

    if repo_url:
        await git_ensure_remote(repo_root, repo_url, req.remote)

    # 确定分支名
    branch_name = req.branch_name
    if not branch_name:
        code, head_out = await git_command(repo_root, ["rev-parse", "--abbrev-ref", "HEAD"], timeout=5)
        if code != 0:
            raise HTTPException(status_code=500, detail="无法获取当前分支")
        branch_name = head_out.strip()

    # fetch
    success, fetch_output = await git_fetch(repo_root, req.remote, git_config=git_config)
    if not success:
        raise HTTPException(status_code=500, detail=f"fetch 失败: {fetch_output[:500]}")

    # merge
    code, merge_output = await git_command(
        repo_root, ["merge", f"{req.remote}/{branch_name}"], timeout=60
    )
    if code != 0:
        # 检测是否是合并冲突
        if "CONFLICT" in merge_output or "conflict" in merge_output.lower():
            raise HTTPException(status_code=409, detail=f"合并冲突: {merge_output[:500]}")
        raise HTTPException(status_code=500, detail=f"合并失败: {merge_output[:500]}")

    return {"ok": True, "output": merge_output[:500]}


@router.post("/{project_id}/git/merge")
async def git_local_merge(project_id: str, req: GitLocalMergeRequest):
    """执行本地分支合并。"""
    cwd = _decode_project_path(project_id)
    repo_root = await git_repo_root(Path(cwd))
    if not repo_root:
        raise HTTPException(status_code=400, detail="Not a git repository")

    success, output, conflicts = await git_merge_branch(
        repo_root, req.source_branch, req.target_branch,
        req.strategy, req.delete_source,
    )

    return {
        "ok": success,
        "output": output[:1000],
        "conflicts": conflicts,
    }


@router.post("/{project_id}/git/merge-request")
async def create_merge_request(
    project_id: str,
    req: GitMergeRequestCreate,
    current_user: Optional[dict] = Depends(get_optional_user),
):
    """创建 MR/PR（支持 GitLab 和 GitHub）。"""
    import httpx
    from urllib.parse import quote as url_quote

    git_config = await _get_project_git_config(project_id)
    repo_url = git_config.get("repo_url", "")
    access_token = git_config.get("access_token", "")

    if not repo_url:
        raise HTTPException(status_code=400, detail="项目未配置 Git 仓库 URL")
    if not access_token:
        raise HTTPException(status_code=400, detail="项目未配置 Git access_token")

    async with httpx.AsyncClient(timeout=30) as client:
        if "gitlab" in repo_url.lower():
            # GitLab MR
            # 解析 project path: 从 URL 中提取 owner/repo
            # 支持 https://gitlab.com/owner/repo.git 和 git@gitlab.com:owner/repo.git
            project_path = _parse_gitlab_project_path(repo_url)
            if not project_path:
                raise HTTPException(status_code=400, detail=f"无法从 URL 解析 GitLab 项目路径: {repo_url}")

            encoded_path = url_quote(project_path, safe="")
            # 提取 GitLab host
            gitlab_host = _parse_git_host(repo_url)
            api_url = f"https://{gitlab_host}/api/v4/projects/{encoded_path}/merge_requests"

            resp = await client.post(
                api_url,
                headers={"PRIVATE-TOKEN": access_token},
                json={
                    "source_branch": req.source_branch,
                    "target_branch": req.target_branch,
                    "title": req.title,
                    "description": req.description or "",
                },
            )
            if resp.status_code >= 400:
                raise HTTPException(
                    status_code=resp.status_code,
                    detail=f"GitLab API 错误: {resp.text[:500]}",
                )
            data = resp.json()
            return {"ok": True, "url": data.get("web_url", "")}

        elif "github" in repo_url.lower():
            # GitHub PR
            owner, repo = _parse_github_owner_repo(repo_url)
            if not owner or not repo:
                raise HTTPException(status_code=400, detail=f"无法从 URL 解析 GitHub owner/repo: {repo_url}")

            api_url = f"https://api.github.com/repos/{owner}/{repo}/pulls"
            resp = await client.post(
                api_url,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/vnd.github+json",
                },
                json={
                    "head": req.source_branch,
                    "base": req.target_branch,
                    "title": req.title,
                    "body": req.description or "",
                },
            )
            if resp.status_code >= 400:
                raise HTTPException(
                    status_code=resp.status_code,
                    detail=f"GitHub API 错误: {resp.text[:500]}",
                )
            data = resp.json()
            return {"ok": True, "url": data.get("html_url", "")}

        else:
            raise HTTPException(status_code=400, detail="不支持的 Git 平台，仅支持 GitLab 和 GitHub")


def _parse_gitlab_project_path(repo_url: str) -> str:
    """从 GitLab 仓库 URL 解析 project path（owner/repo）。"""
    # https://gitlab.com/owner/group/repo.git
    m = re.match(r"https?://[^/]+/(.+?)(\.git)?/?$", repo_url)
    if m:
        return m.group(1)
    # git@gitlab.com:owner/repo.git
    m = re.match(r"git@[^:]+:(.+?)(\.git)?$", repo_url)
    if m:
        return m.group(1)
    return ""


def _parse_github_owner_repo(repo_url: str) -> tuple[str, str]:
    """从 GitHub 仓库 URL 解析 (owner, repo)。"""
    # https://github.com/owner/repo.git
    m = re.match(r"https?://[^/]+/([^/]+)/([^/]+?)(\.git)?/?$", repo_url)
    if m:
        return m.group(1), m.group(2)
    # git@github.com:owner/repo.git
    m = re.match(r"git@[^:]+:([^/]+)/([^/]+?)(\.git)?$", repo_url)
    if m:
        return m.group(1), m.group(2)
    return "", ""


def _parse_git_host(repo_url: str) -> str:
    """从 Git URL 解析主机名。"""
    m = re.match(r"https?://([^/]+)", repo_url)
    if m:
        return m.group(1)
    m = re.match(r"git@([^:]+):", repo_url)
    if m:
        return m.group(1)
    return "gitlab.com"
