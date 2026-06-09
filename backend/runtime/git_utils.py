"""
Git 异步操作工具模块。

提供 Plan 并行执行所需的 Git 操作：
- 基础命令执行（git_command / git_repo_root / git_head / git_status_entries ...）
- Worktree 管理（prepare_plan_worktree / cleanup_plan_worktree）
- 提交与合并（commit_changes / cherry_pick_task / abort_cherry_pick）

设计原则：
- 所有 git 调用基于 ``asyncio.create_subprocess_exec``，可在 FastAPI / 调度器
  事件循环中并发使用，不会阻塞主线程。
- 所有命令均带超时保护，超时后会主动 kill 子进程。
- Git 失败不抛异常给调用方，统一通过 ``(exit_code, output)`` 或 ``None``
  / 空值表示，由 PlanExecutor 自行决定如何处理。
- 不依赖数据库、不依赖 ``lark_oapi``、不依赖其他 service —— 纯工具函数。
"""

from __future__ import annotations

import asyncio
import logging
import re
import shutil
from pathlib import Path

logger = logging.getLogger("lark2agent.git_utils")


# ── 内部辅助 ────────────────────────────────────────────────────────────────

async def _run_git(
    args: list[str],
    cwd: Path | str | None,
    timeout: int,
) -> tuple[int, str]:
    """统一执行 ``git`` 子进程并返回 (returncode, stdout+stderr)。"""
    cwd_str = str(cwd) if cwd is not None else None
    try:
        proc = await asyncio.create_subprocess_exec(
            "git",
            *args,
            cwd=cwd_str,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
    except FileNotFoundError as e:
        return 1, f"git not found: {e}"
    except Exception as e:  # noqa: BLE001
        return 1, f"{type(e).__name__}: {e}"

    try:
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        try:
            proc.terminate()
        except ProcessLookupError:
            pass
        try:
            await asyncio.wait_for(proc.wait(), timeout=2)
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
        return 1, f"git command timed out after {timeout}s: git {' '.join(args)}"
    except Exception as e:  # noqa: BLE001
        return 1, f"{type(e).__name__}: {e}"

    output = stdout.decode("utf-8", errors="replace").strip() if stdout else ""
    return proc.returncode if proc.returncode is not None else 1, output


def _path_is_under(child: Path, parent: Path) -> bool:
    """判断 child 是否在 parent 目录树下（基于解析后的绝对路径）。"""
    try:
        child_resolved = child.expanduser().resolve()
        parent_resolved = parent.expanduser().resolve()
    except OSError:
        return False
    try:
        child_resolved.relative_to(parent_resolved)
        return True
    except ValueError:
        return False


# ── 基础 Git 操作 ──────────────────────────────────────────────────────────

async def git_command(cwd: Path, args: list[str], timeout: int = 20) -> tuple[int, str]:
    """执行 ``git -C <cwd> <args...>``。

    返回 ``(exit_code, combined_output)``，其中 combined_output 为 stdout 与
    stderr 的合并文本（已 strip）。任何异常都被吞下并以非零 exit_code 表示。
    """
    return await _run_git(["-C", str(cwd), *args], cwd=None, timeout=timeout)


async def git_repo_root(cwd: Path) -> Path | None:
    """获取 Git 仓库根目录；非 git 仓库或失败返回 ``None``。"""
    code, output = await git_command(cwd, ["rev-parse", "--show-toplevel"], timeout=5)
    if code != 0 or not output:
        return None
    first_line = output.splitlines()[0].strip()
    if not first_line:
        return None
    try:
        return Path(first_line).expanduser().resolve()
    except OSError:
        return None


async def git_head(cwd: Path) -> str:
    """获取当前 HEAD commit hash（完整 40 字符）；失败返回空串。"""
    code, output = await git_command(cwd, ["rev-parse", "HEAD"], timeout=5)
    if code != 0 or not output:
        return ""
    return output.splitlines()[0].strip()


def safe_git_ref_part(text: str) -> str:
    """将任意字符串转为安全的 Git ref 名称片段（同步纯函数）。

    - 非字母数字 / ``._-`` 字符替换为 ``-``
    - 去除首尾连字符
    - 截断至 80 字符
    - 空串退回到 ``"task"``
    """
    value = re.sub(r"[^A-Za-z0-9._-]+", "-", text or "").strip("-")
    return value[:80] or "task"


async def git_status_entries(cwd: Path | None) -> tuple[bool, list[str], str]:
    """运行 ``git status --short``。

    返回 ``(is_repo, entries, error_message)``：
    - ``is_repo``: cwd 是否为合法 git 仓库
    - ``entries``: status 输出的非空行列表（保留原始前缀，如 ``" M file"``）
    - ``error_message``: 不是仓库或失败时的简要原因
    """
    if not cwd:
        return False, [], "无项目目录"
    code, output = await git_command(cwd, ["status", "--short"], timeout=3)
    if code != 0:
        message = output or "不是 Git 仓库"
        return False, [], message[:160]
    entries = [line.rstrip() for line in output.splitlines() if line.strip()]
    return True, entries, ""


async def has_git_changes(cwd: Path) -> bool:
    """是否存在未提交（含未跟踪）改动。非仓库返回 ``False``。"""
    is_repo, entries, _ = await git_status_entries(cwd)
    return is_repo and bool(entries)


async def git_diff_summary(cwd: Path) -> str:
    """生成简短的 diff 摘要，用于卡片展示。

    输出包含文件状态（最多前 20 行）和 ``git diff --stat HEAD`` 的统计。
    """
    is_repo, entries, error = await git_status_entries(cwd)
    if not is_repo:
        return f"Git：{error}"
    if not entries:
        return "Git：工作区干净"

    code, stat = await git_command(cwd, ["diff", "--stat", "HEAD"], timeout=10)
    if code != 0:
        stat = (stat or "")[:1200]

    status_lines: list[str] = ["**文件状态**"]
    for line in entries[:20]:
        prefix = (line[:2].strip() or "?")
        rest = line[3:] if len(line) > 3 else line
        status_lines.append(f"`{prefix}` {rest}")
    if len(entries) > 20:
        status_lines.append(f"还有 {len(entries) - 20} 个变更未显示")
    if stat:
        status_lines.extend(["", "**Diff 统计**", stat])
    return "\n".join(status_lines)


# ── Worktree 管理 ──────────────────────────────────────────────────────────

def _plan_worktree_root(repo_root: Path) -> Path:
    """Plan worktree 在仓库内的统一存放目录。"""
    return repo_root / ".lark-codex" / "worktrees"


def _plan_worktree_path(repo_root: Path, plan_id: str, task_id: str) -> Path:
    """单个子任务对应的 worktree 路径。"""
    name = f"{safe_git_ref_part(plan_id)}-{safe_git_ref_part(task_id)}"
    return _plan_worktree_root(repo_root) / name


def _plan_branch_name(plan_id: str, task_id: str) -> str:
    """子任务对应的分支名：``lark-codex/{plan_id}-{task_id[:8]}``。"""
    short_task = safe_git_ref_part(task_id)[:8] or "task"
    return f"lark-codex/{safe_git_ref_part(plan_id)}-{short_task}"


async def prepare_plan_worktree(
    plan_id: str,
    task_id: str,
    cwd: Path,
) -> tuple[Path, str, str]:
    """创建 Git worktree + 新分支，供 PlanExecutor 隔离执行子任务。

    - 路径：``{repo_root}/.lark-codex/worktrees/{plan_id}-{task_id}``
    - 分支：``lark-codex/{plan_id}-{task_id[:8]}``

    若目标 worktree 已存在（``.git`` 目录可见），直接复用并跳过创建。

    Returns:
        ``(worktree_path, branch_name, base_head)``。当无法准备（例如 cwd 不
        是 git 仓库、worktree 创建失败）时返回 ``(Path(""), "", "")``。
    """
    repo_root = await git_repo_root(cwd)
    if repo_root is None:
        logger.warning(
            "[git_utils] prepare_plan_worktree: cwd is not a git repo: %s", cwd
        )
        return Path(""), "", ""

    base_head = await git_head(repo_root)
    branch_name = _plan_branch_name(plan_id, task_id)
    worktree = _plan_worktree_path(repo_root, plan_id, task_id)

    if (worktree / ".git").exists():
        logger.info(
            "[git_utils] reuse existing worktree: plan=%s task=%s path=%s",
            plan_id,
            task_id,
            worktree,
        )
        return worktree, branch_name, base_head

    try:
        worktree.parent.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        logger.error(
            "[git_utils] mkdir worktree root failed: %s: %s",
            worktree.parent,
            e,
        )
        return Path(""), "", ""

    code, output = await git_command(
        repo_root,
        ["worktree", "add", "-b", branch_name, str(worktree), "HEAD"],
        timeout=60,
    )
    if code != 0:
        logger.warning(
            "[git_utils] worktree add failed: plan=%s task=%s output=%s",
            plan_id,
            task_id,
            output,
        )
        return Path(""), "", ""

    logger.info(
        "[git_utils] worktree created: plan=%s task=%s branch=%s path=%s",
        plan_id,
        task_id,
        branch_name,
        worktree,
    )
    return worktree, branch_name, base_head


async def cleanup_plan_worktree(
    worktree_path: str,
    branch_name: str,
    repo_root: Path,
) -> None:
    """清理子任务 worktree 与对应分支。

    步骤：
    1. ``git worktree remove --force <path>``
    2. ``git branch -D <branch>``
    3. 若 git 命令失败但 worktree 目录仍存在且位于
       ``{repo_root}/.lark-codex/worktrees`` 下，fallback 到
       ``shutil.rmtree``。

    异常被吞下并记录日志，不会向上抛出。
    """
    if not worktree_path and not branch_name:
        return

    worktree_root = _plan_worktree_root(repo_root)
    worktree = Path(worktree_path).expanduser() if worktree_path else None

    # 1. git worktree remove
    if worktree is not None:
        code, output = await git_command(
            repo_root,
            ["worktree", "remove", "--force", str(worktree)],
            timeout=60,
        )
        if code != 0:
            logger.info(
                "[git_utils] worktree remove failed (will try rmtree): path=%s output=%s",
                worktree,
                output,
            )
            # fallback：仅当目录确实位于约定路径下，避免误删
            if worktree.exists() and _path_is_under(worktree, worktree_root):
                try:
                    shutil.rmtree(worktree)
                    logger.info(
                        "[git_utils] worktree directory removed via rmtree: %s",
                        worktree,
                    )
                except OSError as e:
                    logger.error(
                        "[git_utils] rmtree failed for %s: %s: %s",
                        worktree,
                        type(e).__name__,
                        e,
                    )

    # 2. git branch -D
    if branch_name:
        code, output = await git_command(
            repo_root,
            ["branch", "-D", branch_name],
            timeout=30,
        )
        if code != 0:
            logger.info(
                "[git_utils] branch -D failed: branch=%s output=%s",
                branch_name,
                output,
            )
        else:
            logger.info("[git_utils] branch deleted: %s", branch_name)


# ── 提交与合并 ────────────────────────────────────────────────────────────

async def commit_changes(cwd: Path, message: str) -> str | None:
    """``git add -A`` + ``git commit -m <message>``。

    Returns:
        提交后的 commit hash（短 12 字符）。若没有可提交的变更或失败返回
        ``None``。
    """
    if not await has_git_changes(cwd):
        return None

    code, output = await git_command(cwd, ["add", "-A"], timeout=60)
    if code != 0:
        logger.warning("[git_utils] git add failed: cwd=%s output=%s", cwd, output)
        return None

    # 仍可能 add 后没有暂存内容（例如 .gitignore 过滤），再次确认
    code, output = await git_command(
        cwd, ["commit", "-m", message or "lark-codex auto commit"], timeout=60
    )
    if code != 0:
        logger.warning(
            "[git_utils] git commit failed: cwd=%s output=%s", cwd, output
        )
        return None

    code, head = await git_command(cwd, ["rev-parse", "HEAD"], timeout=5)
    if code != 0 or not head:
        return None
    return head.splitlines()[0].strip()[:12]


async def cherry_pick_task(repo_root: Path, commit_hash: str) -> tuple[bool, str]:
    """在 ``repo_root`` 上执行 ``git cherry-pick <commit_hash>``。

    失败时**不会**自动 ``--abort``，由调用方根据冲突情况决定后续动作
    （继续解决冲突 / 调用 :func:`abort_cherry_pick`）。

    Returns:
        ``(success, output)``。
    """
    if not commit_hash:
        return False, "empty commit hash"
    code, output = await git_command(
        repo_root, ["cherry-pick", commit_hash], timeout=120
    )
    return code == 0, output


async def git_conflict_files(cwd: Path) -> list[str]:
    """检测 git status 中处于冲突状态的文件。

    冲突状态码：``UU / AA / DD / AU / UA / DU / UD``。
    """
    is_repo, entries, _ = await git_status_entries(cwd)
    if not is_repo:
        return []
    conflict_codes = {"UU", "AA", "DD", "AU", "UA", "DU", "UD"}
    files: list[str] = []
    for entry in entries:
        if entry[:2] in conflict_codes:
            files.append(entry[3:] if len(entry) > 3 else entry)
    return files


async def git_cherry_pick_in_progress(cwd: Path) -> bool:
    """是否存在进行中的 cherry-pick（``CHERRY_PICK_HEAD`` 是否存在）。"""
    code, _ = await git_command(
        cwd, ["rev-parse", "--verify", "CHERRY_PICK_HEAD"], timeout=5
    )
    return code == 0


async def abort_cherry_pick(cwd: Path) -> None:
    """中止进行中的 cherry-pick；非进行中状态下静默跳过。"""
    if not await git_cherry_pick_in_progress(cwd):
        return
    code, output = await git_command(cwd, ["cherry-pick", "--abort"], timeout=30)
    if code != 0:
        logger.warning(
            "[git_utils] cherry-pick --abort failed: cwd=%s output=%s",
            cwd,
            output,
        )
    else:
        logger.info("[git_utils] cherry-pick aborted: cwd=%s", cwd)
