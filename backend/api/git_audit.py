"""Git 审计 API 路由。

提供按项目维度的 commit 列表、变更聚合统计、单 commit diff 查看等端点。
"""

import base64
import binascii
import logging
import re
from typing import Optional

from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy import text as sa_text

from backend.runtime.git_utils import git_command, git_log_files, git_diff_full
from backend.db.engine import async_session_factory
from pathlib import Path

router = APIRouter(prefix="/api/projects", tags=["git-audit"])
logger = logging.getLogger("tide.api.git_audit")


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
                file_path = "\t".join(parts[2:]).strip()
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


@router.get("/{project_id}/git/branches")
async def get_project_branches(
    project_id: str,
):
    """获取项目的 Git 分支列表。"""
    cwd = _decode_project_path(project_id)
    if not Path(cwd).is_dir():
        raise HTTPException(status_code=404, detail=f"项目路径不存在: {cwd}")

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


@router.get("/{project_id}/git/commits")
async def get_project_commits(
    project_id: str,
    branch: Optional[str] = Query(None, description="分支名"),
    since: Optional[str] = Query(None, description="起始时间 (ISO 格式)"),
    until: Optional[str] = Query(None, description="截止时间 (ISO 格式)"),
    limit: int = Query(50, ge=1, le=200, description="最大返回条数"),
    work_item_id: Optional[str] = Query(None, description="按工作项分支筛选"),
    all_branches: bool = Query(False, description="搜索所有分支（用于会话级跨分支查询）"),
):
    """获取项目的 commit 列表（含修改文件）。"""
    cwd = _decode_project_path(project_id)
    if not Path(cwd).is_dir():
        raise HTTPException(status_code=404, detail=f"项目路径不存在: {cwd}")

    # 如果指定了 work_item_id，按工作项分支筛选
    effective_branch = branch
    if work_item_id and not branch:
        from backend.runtime.git_utils import work_item_branch_name
        effective_branch = work_item_branch_name(work_item_id)

    code, output = await git_log_files(
        cwd=cwd,
        branch=effective_branch,
        limit=limit,
        since=since,
        until=until,
        all_branches=all_branches,
    )
    if code != 0:
        raise HTTPException(status_code=500, detail=f"git log 失败: {output[:500]}")

    commits = _parse_log_output(output)
    return {"commits": commits, "total": len(commits)}


@router.get("/{project_id}/git/changes")
async def get_project_changes(
    project_id: str,
    group_by: str = Query("branch", description="聚合维度: work_item | session | branch"),
    since: Optional[str] = Query(None, description="起始时间"),
    until: Optional[str] = Query(None, description="截止时间"),
):
    """按维度聚合变更统计。

    - group_by=work_item: 从 DB 查询当前项目工作项，按工作项关联的分支统计变更
    - group_by=session: 从 DB 查询当前项目的 tasks，按 session_id 分组统计变更
    - group_by=branch: 列出所有分支的变更统计
    """
    cwd = _decode_project_path(project_id)
    if not Path(cwd).is_dir():
        raise HTTPException(status_code=404, detail=f"项目路径不存在: {cwd}")

    if group_by not in ("work_item", "session", "branch"):
        raise HTTPException(status_code=400, detail="group_by 必须为 work_item / session / branch")

    if group_by == "work_item":
        results = await _group_by_work_item(project_id, cwd, since, until)
    elif group_by == "session":
        results = await _group_by_session(project_id, cwd, since, until)
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
) -> Optional[dict]:
    """统计某个分支相对于主分支的 commit 数、文件变更、增删行数。

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
        code, stat_out = await git_command(
            Path(cwd),
            ["diff", "--shortstat", f"{main_branch}...{branch_name}"],
            timeout=15,
        )
        if code == 0 and stat_out:
            m = re.search(r"(\d+) files? changed", stat_out)
            if m:
                files_changed = int(m.group(1))
            m = re.search(r"(\d+) insertions?\(\+\)", stat_out)
            if m:
                additions = int(m.group(1))
            m = re.search(r"(\d+) deletions?\(-\)", stat_out)
            if m:
                deletions = int(m.group(1))

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
) -> Optional[dict]:
    """统计指定时间范围内的 git commit 变更。

    使用 git log --after/--before 按时间窗口检索 commit，
    并用 --numstat 汇总文件变更、增删行数。
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
                file_path = "\t".join(parts[2:])
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
    """按工作项分组：从 DB 查询工作项，关联其 branch_name 统计 Git 变更。"""
    from backend.runtime.git_utils import work_item_branch_name

    main_branch = await _get_main_branch(cwd)

    # 1. 查询当前项目的工作项及其关联的分支（通过 transitions -> tasks）
    async with async_session_factory() as session:
        rows = await session.execute(
            sa_text("""
                SELECT wi.id, wi.title,
                       t.branch_name AS task_branch
                FROM work_items wi
                LEFT JOIN work_item_transitions wit ON wit.work_item_id = wi.id
                LEFT JOIN tasks t ON t.id = wit.task_id
                    AND t.branch_name IS NOT NULL
                    AND t.branch_name != ''
                WHERE wi.project_id = :project_id
                ORDER BY wi.created_at DESC
            """),
            {"project_id": project_id},
        )
        all_rows = rows.fetchall()

    # 2. 合并：每个工作项可能有多条 transition 记录，取第一个有效 branch
    work_items: dict[str, dict] = {}  # wi_id -> {title, branch}
    for row in all_rows:
        wi_id = row[0]
        if wi_id in work_items:
            # 已有记录，若当前还没 branch 则尝试填充
            if not work_items[wi_id]["branch"] and row[2]:
                work_items[wi_id]["branch"] = row[2]
        else:
            work_items[wi_id] = {
                "title": row[1],
                "branch": row[2] or "",
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


async def _group_by_session(
    project_id: str,
    cwd: str,
    since: Optional[str],
    until: Optional[str],
) -> list[dict]:
    """按会话分组：复用 session_discovery 获取项目下所有会话，补充 Git 变更统计。

    数据源与主菜单会话列表一致（DB + 文件系统扫描合并），确保展示一致性。
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
    results: list[dict] = []
    for s in merged_sessions:
        sid = s["session_id"]
        branches = session_branches.get(sid, set())

        best_stats: Optional[dict] = None
        used_branch = ""

        # 方式 1：尝试用关联的分支统计（tasks 表中有 branch_name 的情况）
        for branch in branches:
            stats = await _branch_stats(cwd, branch, main_branch, since, until)
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
                    cwd, effective_since, effective_until
                )

        if best_stats is None:
            best_stats = {
                "commit_count": 0,
                "files_changed": 0,
                "additions": 0,
                "deletions": 0,
            }

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
    """按分支分组：列出所有分支的变更统计（原有逻辑）。"""
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

    code, output = await git_command(
        Path(cwd), ["status", "--porcelain"], timeout=10
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
        file_path = line[3:].strip()

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

    return {"files": files, "total": len(files)}


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
    code, status_output = await git_command(Path(cwd), ["status", "--porcelain"], timeout=10)
    if code != 0:
        raise HTTPException(status_code=500, detail=f"git status 失败: {status_output[:300]}")

    untracked_files: set[str] = set()
    staged_files: set[str] = set()
    for line in status_output.splitlines():
        if not line or len(line) < 4:
            continue
        index_status = line[0]
        work_status = line[1]
        file_path = line[3:].strip()
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
