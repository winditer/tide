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
import os
import re
import shutil
from pathlib import Path

logger = logging.getLogger("tide.git_utils")


async def _build_git_env(git_config: dict | None) -> dict:
    """根据项目的 git_config 构造 git 子进程环境变量。

    支持三种认证方式：

    - ``ssh_agent``（默认）：不注入额外变量，依赖宿主上的 ssh-agent。
    - ``ssh_key``：通过 ``GIT_SSH_COMMAND`` 指定私钥路径。
    - ``token``：通过 ``GIT_CONFIG_COUNT`` 注入临时
      ``credential.helper`` 返回 HTTPS 访问令牌。

    函数本身不涉及 IO，使用 ``async`` 仅为与调用点接口保持一致。
    """
    env = os.environ.copy()
    if not git_config:
        return env

    cred_type = (git_config.get("credential_type") or "ssh_agent").strip()

    if cred_type == "ssh_key":
        key_path = (git_config.get("ssh_key_path") or "~/.ssh/id_rsa").strip()
        # Docker 中 ~ 不会自动展开，这里仅做最大努力 expand
        expanded = str(Path(key_path).expanduser())
        env["GIT_SSH_COMMAND"] = (
            f"ssh -i {expanded} -o StrictHostKeyChecking=no "
            "-o IdentitiesOnly=yes"
        )

    elif cred_type == "token":
        token = (git_config.get("access_token") or "").strip()
        if token:
            # 使用 GIT_CONFIG_COUNT 注入临时 credential.helper，
            # 避免修改全局 .gitconfig。
            # helper 同时返回 username/password，兼容 GitHub / GitLab / Gitea。
            helper = (
                "!f() { echo username=x-access-token; "
                f"echo password={token}; }}; f"
            )
            env["GIT_CONFIG_COUNT"] = "1"
            env["GIT_CONFIG_KEY_0"] = "credential.helper"
            env["GIT_CONFIG_VALUE_0"] = helper
            env["GIT_ASKPASS"] = "/bin/echo"
            env["GIT_TERMINAL_PROMPT"] = "0"

    # ssh_agent 模式下不需额外环境变量，直接返回
    return env

# ── 内部辅助 ────────────────────────────────────────────────────────────────

async def _run_git(
    args: list[str],
    cwd: Path | str | None,
    timeout: int,
    env: dict | None = None,
) -> tuple[int, str]:
    """统一执行 ``git`` 子进程并返回 (returncode, stdout+stderr)。"""
    cwd_str = str(cwd) if cwd is not None else None
    try:
        proc = await asyncio.create_subprocess_exec(
            "git",
            *args,
            cwd=cwd_str,
            env=env,
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


# ── .gitignore 维护 ────────────────────────────────────────────────────────

def ensure_tide_gitignore(repo_root: Path) -> None:
    """确保 .gitignore 包含 Tide 和常见构建缓存条目。

    检查并追加以下条目（若缺失）：
    - .tide/        — Tide 内部目录
    - .pnpm-store/  — pnpm 本地 store

    该函数为同步操作（仅本地文件读写），在 worktree 准备前调用。
    """
    REQUIRED_ENTRIES = [
        ".tide/",
        ".pnpm-store/",
    ]

    gitignore_path = repo_root / ".gitignore"

    try:
        content = gitignore_path.read_text(encoding="utf-8") if gitignore_path.exists() else ""
        lines = {line.strip() for line in content.splitlines()}

        missing = [entry for entry in REQUIRED_ENTRIES if entry not in lines]
        if not missing:
            return

        # 追加缺失条目
        if content and not content.endswith("\n"):
            content += "\n"
        content += "\n".join(missing) + "\n"
        gitignore_path.write_text(content, encoding="utf-8")
    except OSError as e:
        logger.warning(
            "[git_utils] ensure_tide_gitignore failed: repo_root=%s error=%s",
            repo_root,
            e,
        )


# ── Worktree 管理 ──────────────────────────────────────────────────────────

def _plan_worktree_root(repo_root: Path) -> Path:
    """Plan worktree 在仓库内的统一存放目录。"""
    return repo_root / ".tide" / "worktrees"


def _plan_worktree_path(repo_root: Path, plan_id: str, task_id: str) -> Path:
    """单个子任务对应的 worktree 路径。"""
    name = f"{safe_git_ref_part(plan_id)}-{safe_git_ref_part(task_id)}"
    return _plan_worktree_root(repo_root) / name


def _plan_branch_name(plan_id: str, task_id: str) -> str:
    """子任务对应的分支名：``tide/{plan_id}-{task_id[:8]}``。"""
    short_task = safe_git_ref_part(task_id)[:8] or "task"
    return f"tide/{safe_git_ref_part(plan_id)}-{short_task}"


async def _resolve_base_ref(repo_root: Path) -> str:
    """优先使用 main/master 作为新分支基点，都不存在时 fallback 到 HEAD。"""
    for candidate in ("main", "master"):
        code, _ = await git_command(repo_root, ["rev-parse", "--verify", candidate], timeout=10)
        if code == 0:
            return candidate
    return "HEAD"


async def prepare_plan_worktree(
    plan_id: str,
    task_id: str,
    cwd: Path,
) -> tuple[Path, str, str]:
    """创建 Git worktree + 新分支，供 PlanExecutor 隔离执行子任务。

    - 路径：``{repo_root}/.tide/worktrees/{plan_id}-{task_id}``
    - 分支：``tide/{plan_id}-{task_id[:8]}``

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

    # 确保 .tide/ 在 .gitignore 中
    ensure_tide_gitignore(repo_root)

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

    base_ref = await _resolve_base_ref(repo_root)
    code, output = await git_command(
        repo_root,
        ["worktree", "add", "-b", branch_name, str(worktree), base_ref],
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

    logger.info("prepare_plan_worktree: branch=%s base=%s", branch_name, base_ref)
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
       ``{repo_root}/.tide/worktrees`` 下，fallback 到
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
    # 使用 --no-verify 跳过 pre-commit/commit-msg hooks，
    # 避免外部 hooks（如 husky/lint-staged）阻断系统自动提交。
    code, output = await git_command(
        cwd, ["commit", "--no-verify", "-m", message or "tide auto commit"], timeout=60
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


# ── 分支合并 ──────────────────────────────────────────────────────────────

async def _git_merge_in_progress(cwd: Path) -> bool:
    """是否存在进行中的 merge（``MERGE_HEAD`` 是否存在）。"""
    code, _ = await git_command(
        cwd, ["rev-parse", "--verify", "MERGE_HEAD"], timeout=5
    )
    return code == 0


async def find_worktree_for_branch(repo_root: Path, branch: str) -> str | None:
    """查找某个分支对应的 worktree 路径。

    解析 ``git worktree list --porcelain`` 输出，找到 checkout 了指定分支的
    worktree 路径。如果未找到返回 ``None``。
    """
    code, output = await git_command(repo_root, ["worktree", "list", "--porcelain"], timeout=10)
    if code != 0 or not output:
        return None

    # porcelain 格式示例：
    # worktree /path/to/worktree
    # HEAD abc123
    # branch refs/heads/some-branch
    # <blank line>
    current_path: str | None = None
    for line in output.splitlines():
        if line.startswith("worktree "):
            current_path = line[len("worktree "):].strip()
        elif line.startswith("branch "):
            ref = line[len("branch "):].strip()
            # ref 格式为 refs/heads/branch-name
            branch_name = ref.removeprefix("refs/heads/")
            if branch_name == branch and current_path:
                # 排除主仓库自身（主仓库的 worktree 路径 == repo_root）
                if Path(current_path).resolve() != repo_root.resolve():
                    return current_path
        elif line.strip() == "":
            current_path = None

    return None


async def git_merge_branch(
    repo_root: Path,
    source_branch: str,
    target_branch: str,
    strategy: str = "merge",
    delete_source: bool = False,
) -> tuple[bool, str, list[str]]:
    """在 ``repo_root`` 中将 ``source_branch`` 合入 ``target_branch``。

    策略：
    - ``merge``: ``git checkout target && git merge source``
    - ``squash``: ``git checkout target && git merge --squash source && git commit``
    - ``rebase``: ``git checkout source && git rebase target &&
      git checkout target && git merge --ff-only source``

    Returns:
        ``(success, output_message, conflict_files)``。冲突时会自动
        ``git merge --abort`` / ``git rebase --abort`` 恢复仓库状态，
        ``conflict_files`` 仅在失败时填充。
    """
    if not source_branch or not target_branch:
        return False, "empty source/target branch", []
    if source_branch == target_branch:
        return False, f"source and target are the same: {source_branch}", []

    strategy = (strategy or "merge").lower()
    if strategy not in {"merge", "squash", "rebase"}:
        return False, f"unsupported merge strategy: {strategy}", []

    # 记录当前分支，merge 完成后恢复
    code_orig, original_branch_raw = await git_command(
        repo_root, ["rev-parse", "--abbrev-ref", "HEAD"], timeout=10
    )
    original_branch = original_branch_raw.strip() if code_orig == 0 else ""

    outputs: list[str] = []

    async def _restore_original_branch() -> None:
        """尝试恢复到 merge 前的分支。"""
        if original_branch and original_branch != target_branch:
            await git_command(repo_root, ["checkout", original_branch], timeout=60)

    async def _abort_and_collect(kind: str) -> list[str]:
        """收集冲突文件并中止进行中的 merge/rebase。"""
        conflicts = await git_conflict_files(repo_root)
        if kind == "rebase":
            await git_command(repo_root, ["rebase", "--abort"], timeout=30)
        else:
            if await _git_merge_in_progress(repo_root):
                await git_command(repo_root, ["merge", "--abort"], timeout=30)
        return conflicts

    async def _checkout_or_create_branch(branch: str) -> tuple[int, list[str]]:
        """checkout 目标分支，若不存在则自动从 main/master 创建。

        Returns:
            (return_code, output_lines) — 0 表示成功。
        """
        lines: list[str] = []
        code, output = await git_command(repo_root, ["checkout", branch], timeout=60)
        lines.append(output)
        if code == 0:
            return 0, lines

        # 分支不存在，尝试从 main 或 master 自动创建
        logger.info(
            "[git_utils] branch '%s' does not exist, attempting auto-create from main/master",
            branch,
        )
        base_branch: str | None = None
        for candidate in ("main", "master"):
            chk_code, _ = await git_command(
                repo_root, ["rev-parse", "--verify", candidate], timeout=10
            )
            if chk_code == 0:
                base_branch = candidate
                break

        if base_branch is None:
            lines.append(
                "Target branch does not exist and no main/master branch found to create from"
            )
            return 1, lines

        create_code, create_output = await git_command(
            repo_root, ["checkout", "-b", branch, base_branch], timeout=60
        )
        lines.append(create_output)
        if create_code != 0:
            return create_code, lines

        logger.info(
            "[git_utils] auto-created branch '%s' from '%s'", branch, base_branch
        )
        lines.append(f"Auto-created branch '{branch}' from '{base_branch}'")
        return 0, lines

    if strategy == "rebase":
        # 1. checkout source
        code, output = await git_command(
            repo_root, ["checkout", source_branch], timeout=60
        )
        outputs.append(output)
        if code != 0:
            return False, "\n".join(outputs), []

        # 2. rebase target
        code, output = await git_command(
            repo_root, ["rebase", target_branch], timeout=300
        )
        outputs.append(output)
        if code != 0:
            conflicts = await _abort_and_collect("rebase")
            logger.warning(
                "[git_utils] rebase failed: source=%s target=%s conflicts=%s",
                source_branch,
                target_branch,
                conflicts,
            )
            await _restore_original_branch()
            return False, "\n".join(outputs), conflicts

        # 3. checkout target (auto-create if not exists)
        code, co_lines = await _checkout_or_create_branch(target_branch)
        outputs.extend(co_lines)
        if code != 0:
            return False, "\n".join(outputs), []

        # 4. ff-only merge source
        code, output = await git_command(
            repo_root, ["merge", "--ff-only", source_branch], timeout=120
        )
        outputs.append(output)
        if code != 0:
            return False, "\n".join(outputs), []
    else:
        # merge / squash 共用：先 checkout target (auto-create if not exists)
        code, co_lines = await _checkout_or_create_branch(target_branch)
        outputs.extend(co_lines)
        if code != 0:
            return False, "\n".join(outputs), []

        if strategy == "squash":
            code, output = await git_command(
                repo_root, ["merge", "--squash", source_branch], timeout=300
            )
            outputs.append(output)
            if code != 0:
                conflicts = await _abort_and_collect("merge")
                logger.warning(
                    "[git_utils] squash merge failed: source=%s target=%s conflicts=%s",
                    source_branch,
                    target_branch,
                    conflicts,
                )
                await _restore_original_branch()
                return False, "\n".join(outputs), conflicts
            # squash 后需要手动 commit
            commit_msg = f"Merge branch '{source_branch}' (squash)"
            code, output = await git_command(
                repo_root, ["commit", "-m", commit_msg], timeout=60
            )
            outputs.append(output)
            if code != 0:
                # 没有任何变更产生时 commit 会失败，视为成功（无差异）
                if "nothing to commit" in output.lower():
                    logger.info(
                        "[git_utils] squash merge produced no changes: source=%s target=%s",
                        source_branch,
                        target_branch,
                    )
                else:
                    return False, "\n".join(outputs), []
        else:  # merge
            code, output = await git_command(
                repo_root, ["merge", "--no-ff", source_branch], timeout=300
            )
            outputs.append(output)
            if code != 0:
                conflicts = await _abort_and_collect("merge")
                logger.warning(
                    "[git_utils] merge failed: source=%s target=%s conflicts=%s",
                    source_branch,
                    target_branch,
                    conflicts,
                )
                await _restore_original_branch()
                return False, "\n".join(outputs), conflicts

    logger.info(
        "[git_utils] merge succeeded: strategy=%s source=%s target=%s",
        strategy,
        source_branch,
        target_branch,
    )

    if delete_source:
        code, output = await git_command(
            repo_root, ["branch", "-D", source_branch], timeout=30
        )
        outputs.append(output)
        if code != 0:
            logger.info(
                "[git_utils] delete source branch failed: branch=%s output=%s",
                source_branch,
                output,
            )
        else:
            logger.info("[git_utils] source branch deleted: %s", source_branch)

    # 恢复到 merge 前的分支
    await _restore_original_branch()

    return True, "\n".join(o for o in outputs if o), []


# ── 工作项 Worktree 管理 ───────────────────────────────────────────────────

def _work_item_worktree_path(repo_root: Path, work_item_id: str) -> Path:
    """工作项 worktree 路径：``{repo_root}/.tide/worktrees/wi-{safe_id}``。"""
    name = f"wi-{safe_git_ref_part(work_item_id)}"
    return _plan_worktree_root(repo_root) / name


def _work_item_branch_name(work_item_id: str) -> str:
    """工作项分支名：``tide/wi-{work_item_id[:8]}``。"""
    short = safe_git_ref_part(work_item_id)[:8] or "item"
    return f"tide/wi-{short}"


# 公开别名，供外部模块导入使用
work_item_branch_name = _work_item_branch_name


def version_branch_name(version_name: str) -> str:
    """版本分支名：feature/{version_name}，如 feature/v1.0。"""
    safe_name = safe_git_ref_part(version_name) or "unknown"
    return f"feature/{safe_name}"


async def prepare_work_item_worktree(
    work_item_id: str,
    project_path: Path,
) -> tuple[Path, str, str]:
    """为工作项创建隔离 worktree（与 plan worktree 通过 ``wi-`` 前缀区分）。

    - 路径：``{repo_root}/.tide/worktrees/wi-{safe_work_item_id}``
    - 分支：``tide/wi-{work_item_id[:8]}``

    若目标 worktree 已存在（``.git`` 可见），直接复用。

    Returns:
        ``(worktree_path, branch_name, base_head)``，失败返回
        ``(Path(""), "", "")``。
    """
    if not work_item_id:
        logger.warning("[git_utils] prepare_work_item_worktree: empty work_item_id")
        return Path(""), "", ""

    repo_root = await git_repo_root(project_path)
    if repo_root is None:
        logger.warning(
            "[git_utils] prepare_work_item_worktree: project_path is not a git repo: %s",
            project_path,
        )
        return Path(""), "", ""

    # 确保 .tide/ 在 .gitignore 中
    ensure_tide_gitignore(repo_root)

    base_head = await git_head(repo_root)
    branch_name = _work_item_branch_name(work_item_id)
    worktree = _work_item_worktree_path(repo_root, work_item_id)

    if (worktree / ".git").exists():
        logger.info(
            "[git_utils] reuse existing work_item worktree: id=%s path=%s",
            work_item_id,
            worktree,
        )
        return worktree, branch_name, base_head

    try:
        worktree.parent.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        logger.error(
            "[git_utils] mkdir work_item worktree root failed: %s: %s",
            worktree.parent,
            e,
        )
        return Path(""), "", ""

    base_ref = await _resolve_base_ref(repo_root)
    code, output = await git_command(
        repo_root,
        ["worktree", "add", "-b", branch_name, str(worktree), base_ref],
        timeout=60,
    )
    if code != 0:
        logger.warning(
            "[git_utils] work_item worktree add failed: id=%s output=%s",
            work_item_id,
            output,
        )
        return Path(""), "", ""

    logger.info("prepare_work_item_worktree: branch=%s base=%s", branch_name, base_ref)
    logger.info(
        "[git_utils] work_item worktree created: id=%s branch=%s path=%s",
        work_item_id,
        branch_name,
        worktree,
    )
    return worktree, branch_name, base_head


async def cleanup_work_item_worktree(
    worktree_path: str,
    branch_name: str,
    repo_root: Path,
) -> None:
    """清理工作项 worktree 及对应分支（合并完成后调用）。

    步骤：
    1. ``git worktree remove --force <path>``
    2. ``git branch -D <branch>``
    3. 若 git 命令失败但 worktree 目录仍存在且位于
       ``{repo_root}/.tide/worktrees`` 下，fallback 到 ``shutil.rmtree``。

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
                "[git_utils] work_item worktree remove failed (will try rmtree): path=%s output=%s",
                worktree,
                output,
            )
            # fallback：仅当目录确实位于约定路径下，避免误删
            if worktree.exists() and _path_is_under(worktree, worktree_root):
                try:
                    shutil.rmtree(worktree)
                    logger.info(
                        "[git_utils] work_item worktree directory removed via rmtree: %s",
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
                "[git_utils] work_item branch -D failed: branch=%s output=%s",
                branch_name,
                output,
            )
        else:
            logger.info("[git_utils] work_item branch deleted: %s", branch_name)


# ── Remote 操作 ──────────────────────────────────────────────────────────

async def git_push(
    repo_root: Path,
    branch: str,
    remote: str = "origin",
    git_config: dict | None = None,
) -> tuple[bool, str]:
    """推送分支到远程。返回 ``(success, output)``。

    可选参数 ``git_config`` 按项目认证配置注入环境变量。
    """
    env = await _build_git_env(git_config)
    code, output = await _run_git(
        ["-C", str(repo_root), "push", remote, branch],
        cwd=None,
        timeout=60,
        env=env,
    )
    return code == 0, output


async def git_fetch(
    repo_root: Path,
    remote: str = "origin",
    git_config: dict | None = None,
) -> tuple[bool, str]:
    """从远程拉取更新。返回 ``(success, output)``。

    可选参数 ``git_config`` 按项目认证配置注入环境变量。
    """
    env = await _build_git_env(git_config)
    code, output = await _run_git(
        ["-C", str(repo_root), "fetch", remote],
        cwd=None,
        timeout=60,
        env=env,
    )
    return code == 0, output


async def git_remote_url(
    repo_root: Path, remote: str = "origin"
) -> str | None:
    """获取 remote URL；不存在或失败返回 ``None``。"""
    code, output = await git_command(
        repo_root, ["remote", "get-url", remote], timeout=5
    )
    if code != 0 or not output:
        return None
    return output.strip()


async def git_ensure_remote(
    repo_root: Path, url: str, remote: str = "origin"
) -> bool:
    """确保 remote 存在且 URL 正确。

    - 不存在 → ``git remote add``
    - 已存在但 URL 不同 → ``git remote set-url``
    - 已存在且 URL 一致 → 直接返回成功

    Returns:
        操作是否成功。
    """
    current_url = await git_remote_url(repo_root, remote)
    if current_url == url:
        return True
    if current_url is None:
        code, _ = await git_command(
            repo_root, ["remote", "add", remote, url], timeout=5
        )
    else:
        code, _ = await git_command(
            repo_root, ["remote", "set-url", remote, url], timeout=5
        )
    return code == 0


# ── Clone ─────────────────────────────────────────────────────────────────

async def git_clone(
    repo_url: str,
    target_dir: str | Path,
    branch: str | None = None,
    git_config: dict | None = None,
) -> tuple[bool, str]:
    """
    克隆远程仓库到目标目录。

    Args:
        repo_url: 远程仓库 URL
        target_dir: 本地目标目录（不应已存在）
        branch: 可选指定分支，None 则使用默认分支
        git_config: 可选项目 Git 配置，用于构造认证环境变量

    Returns:
        (success, output_or_error_message)
    """
    cmd = ["git", "clone"]
    if branch:
        cmd += ["--branch", branch]
    cmd += [repo_url, str(target_dir)]

    env = await _build_git_env(git_config)
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    output = (stdout or b"").decode() + (stderr or b"").decode()

    if proc.returncode == 0:
        return True, output.strip()
    return False, output.strip()


# ── 扩展：Diff / Show / Log / Conflict ─────────────────────────────────────

async def git_diff_full(
    cwd: str,
    ref1: str | None = None,
    ref2: str | None = None,
    path: str | None = None,
) -> tuple[int, str]:
    """获取完整 unified diff。

    - ref1/ref2 均为空：工作区未暂存 diff（git diff）
    - 仅 ref1：ref1 与工作区的 diff（git diff ref1）
    - ref1 + ref2：两个 ref 之间的 diff（git diff ref1 ref2）
    - path 非空时仅返回指定文件的 diff
    """
    args: list[str] = ["diff"]
    if ref1:
        args.append(ref1)
    if ref2:
        args.append(ref2)
    if path:
        args.extend(["--", path])
    return await git_command(Path(cwd), args, timeout=30)


async def git_show_file(
    cwd: str,
    ref: str,
    path: str,
) -> tuple[int, str]:
    """获取指定 ref (commit/branch) 下特定文件的内容。

    使用 ``git show ref:path``。
    """
    return await git_command(Path(cwd), ["show", f"{ref}:{path}"], timeout=30)


async def git_log_files(
    cwd: str,
    branch: str | None = None,
    limit: int = 50,
    since: str | None = None,
    until: str | None = None,
    all_branches: bool = False,
    author: str | None = None,
) -> tuple[int, str]:
    """获取 commit 列表及每个 commit 修改的文件（含增删行数）。

    使用 ``git log --numstat --format=...``，输出格式可由调用方解析。
    numstat 每行格式：additions\tdeletions\tpath（二进制文件为 -\t-\tpath）。

    当 all_branches=True 时添加 ``--all`` 以搜索所有分支（用于会话级跨分支查询）。
    当 author 非空时添加 ``--author=<author>`` 过滤提交作者。
    """
    args: list[str] = [
        "log",
        f"--max-count={limit}",
        "--numstat",
        "--format=%H|%an|%aI|%s",
    ]
    if all_branches:
        args.append("--all")
    if since:
        args.append(f"--since={since}")
    if until:
        args.append(f"--until={until}")
    if author:
        args.append(f"--author={author}")
    if branch:
        args.append(branch)
    return await git_command(Path(cwd), args, timeout=30)


async def git_conflict_content(cwd: str, path: str) -> dict[str, str]:
    """获取冲突文件的三个版本：base (:1:path), ours (:2:path), theirs (:3:path)。

    返回 dict 包含 base / ours / theirs 三个键，获取失败的版本为空字符串。
    同时尝试读取文件当前内容（含冲突标记）作为 conflict_markers。
    """
    result: dict[str, str] = {"base": "", "ours": "", "theirs": "", "conflict_markers": ""}

    stages = [("base", "1"), ("ours", "2"), ("theirs", "3")]
    for key, stage in stages:
        code, output = await git_command(
            Path(cwd), ["show", f":{stage}:{path}"], timeout=15
        )
        if code == 0:
            result[key] = output

    # 读取含冲突标记的文件内容
    full_path = Path(cwd) / path
    try:
        if full_path.exists() and full_path.is_file():
            result["conflict_markers"] = full_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        pass

    return result


async def git_list_remote_branches(
    repo_root: Path,
    remote: str = "origin",
) -> tuple[list[str], str]:
    """获取远程分支列表（基于本地 tracking 信息，不发起网络请求）。

    Returns: (branch_names, error_message)
    """
    code, output = await git_command(
        repo_root, ["branch", "-r", "--format=%(refname:short)"],
        timeout=10,
    )
    if code != 0:
        return [], output[:200]

    prefix = f"{remote}/"
    branches = []
    for line in output.splitlines():
        name = line.strip()
        if name.startswith(prefix) and not name.endswith("/HEAD"):
            branches.append(name[len(prefix):])
    return branches, ""
