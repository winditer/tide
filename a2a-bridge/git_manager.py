"""Git workspace manager for A2A Bridge.

Manages repository cloning, branch operations, and change synchronization
between the Tide platform and remote CLI agents.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

logger = logging.getLogger("a2a-bridge.git")


@dataclass
class GitContext:
    """Git operation context passed from Tide via A2A configuration."""

    repo_url: str                      # git@github.com:org/project.git 或 https://...
    base_branch: str = "main"          # 基线分支
    task_branch: str = ""              # 任务分支名，为空则自动生成
    commit_message: str = ""           # 提交信息，为空则自动生成
    auth_token: Optional[str] = None   # HTTPS token（可选，优先用环境变量）
    git_username: Optional[str] = None   # HTTPS 用户名（可选）
    git_password: Optional[str] = None   # HTTPS 密码（可选）

    @classmethod
    def from_dict(cls, data: dict) -> Optional["GitContext"]:
        """从 A2A configuration.git 字段构造 GitContext。

        支持 camelCase（repoUrl/baseBranch/taskBranch/commitMessage/authToken）
        或 snake_case 两种命名风格。
        """
        if not isinstance(data, dict):
            return None
        repo_url = (
            data.get("repoUrl")
            or data.get("repo_url")
            or data.get("url")
            or ""
        )
        if not repo_url:
            return None
        return cls(
            repo_url=str(repo_url),
            base_branch=str(data.get("baseBranch") or data.get("base_branch") or "main"),
            task_branch=str(data.get("taskBranch") or data.get("task_branch") or ""),
            commit_message=str(data.get("commitMessage") or data.get("commit_message") or ""),
            auth_token=data.get("authToken") or data.get("auth_token") or None,
            git_username=data.get("gitUsername") or data.get("git_username") or None,
            git_password=data.get("gitPassword") or data.get("git_password") or None,
        )


class GitManager:
    """Manages git operations for task workspace preparation and finalization."""

    def __init__(self, repos_dir: str = "/tmp/a2a-repos"):
        """
        Args:
            repos_dir: Base directory for storing cloned repositories.
        """
        self.repos_dir = Path(repos_dir)
        self.repos_dir.mkdir(parents=True, exist_ok=True)

    def _repo_local_path(self, repo_url: str) -> Path:
        """Derive a stable local path from repo URL.

        - git@github.com:org/repo.git → org_repo
        - https://github.com/org/repo.git → org_repo
        """
        clean = re.sub(r"^(https?://[^/]+/|git@[^:]+:)", "", repo_url)
        # 去掉末尾 .git / 斜杠
        if clean.endswith(".git"):
            clean = clean[:-4]
        clean = clean.rstrip("/")
        dir_name = clean.replace("/", "_")
        return self.repos_dir / dir_name

    async def _run_git(
        self,
        *args: str,
        cwd: Optional[Path] = None,
        env: Optional[dict] = None,
    ) -> tuple[int, str, str]:
        """Run a git command asynchronously."""
        cmd = ["git"] + list(args)
        merged_env = {**os.environ, **(env or {})}

        # 如果配置了 SSH key，设置 GIT_SSH_COMMAND
        ssh_key = os.environ.get("GIT_SSH_KEY_PATH")
        if ssh_key and "GIT_SSH_COMMAND" not in merged_env:
            merged_env["GIT_SSH_COMMAND"] = (
                f"ssh -i {ssh_key} -o StrictHostKeyChecking=no"
            )

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=str(cwd) if cwd else None,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=merged_env,
        )
        stdout, stderr = await proc.communicate()
        return (
            proc.returncode if proc.returncode is not None else -1,
            stdout.decode(errors="replace").strip(),
            stderr.decode(errors="replace").strip(),
        )

    async def ensure_repo(self, ctx: GitContext) -> Path:
        """确保仓库已 clone 到本地。如果已存在则跳过。

        Returns:
            本地仓库路径
        """
        repo_path = self._repo_local_path(ctx.repo_url)

        if (repo_path / ".git").exists():
            logger.info("Repo already exists at %s", repo_path)
            return repo_path

        logger.info("Cloning repo %s → %s", ctx.repo_url, repo_path)
        repo_path.parent.mkdir(parents=True, exist_ok=True)

        # 构建 clone URL（注入 token if HTTPS）
        clone_url = self._inject_auth(ctx.repo_url, ctx.auth_token, ctx.git_username, ctx.git_password)

        code, out, err = await self._run_git("clone", clone_url, str(repo_path))
        if code != 0:
            raise RuntimeError(f"git clone failed (exit={code}): {err}")

        logger.info("Clone completed: %s", out or "(ok)")
        return repo_path

    async def prepare_workspace(self, ctx: GitContext) -> Path:
        """任务开始前：fetch 最新代码，创建并切换到任务分支。

        Returns:
            工作目录路径（即仓库路径）
        """
        repo_path = await self.ensure_repo(ctx)

        # fetch latest
        logger.info("Fetching latest from origin...")
        code, _, err = await self._run_git("fetch", "origin", cwd=repo_path)
        if code != 0:
            logger.warning("git fetch failed: %s", err)

        # 确定任务分支名
        task_branch = ctx.task_branch
        if not task_branch:
            task_branch = f"task/a2a-{uuid.uuid4().hex[:8]}"

        # 先尝试删除同名本地分支（如果有残留）
        await self._run_git("branch", "-D", task_branch, cwd=repo_path)

        # 从 base 创建新分支
        base_ref = f"origin/{ctx.base_branch}"
        code, _, err = await self._run_git(
            "checkout", "-b", task_branch, base_ref, cwd=repo_path
        )
        if code != 0:
            raise RuntimeError(
                f"git checkout -b {task_branch} failed: {err}"
            )

        logger.info(
            "Workspace ready: branch=%s base=%s path=%s",
            task_branch,
            ctx.base_branch,
            repo_path,
        )

        # 保存 task_branch 到 ctx（如果是自动生成的）
        ctx.task_branch = task_branch

        return repo_path

    async def finalize_changes(
        self, ctx: GitContext, repo_path: Path
    ) -> Optional[str]:
        """任务结束后：收集所有变更，commit + push。

        Returns:
            Push 成功返回 commit SHA，无变更返回 None。
        """
        # 检查是否有未提交变更
        _, status, _ = await self._run_git(
            "status", "--porcelain", cwd=repo_path
        )

        # 也检查 Agent 是否已经自己 commit 了新内容
        code2, ahead, _ = await self._run_git(
            "rev-list",
            "--count",
            f"origin/{ctx.base_branch}..HEAD",
            cwd=repo_path,
        )

        has_uncommitted = bool(status.strip())
        try:
            ahead_count = int(ahead or "0") if code2 == 0 else 0
        except ValueError:
            ahead_count = 0
        has_new_commits = ahead_count > 0

        if not has_uncommitted and not has_new_commits:
            logger.info("No changes to commit or push")
            return None

        # 如果有未提交的变更，兜底 commit
        if has_uncommitted:
            await self._run_git("add", "-A", cwd=repo_path)
            commit_msg = (
                ctx.commit_message
                or f"feat: changes by remote agent on {ctx.task_branch}"
            )
            code, _, err = await self._run_git(
                "commit", "-m", commit_msg, cwd=repo_path
            )
            if code != 0 and "nothing to commit" not in err:
                logger.warning("git commit failed: %s", err)

        # 获取 commit SHA
        _, sha, _ = await self._run_git("rev-parse", "HEAD", cwd=repo_path)

        # push
        logger.info("Pushing branch %s...", ctx.task_branch)
        code, _, err = await self._run_git(
            "push",
            "origin",
            ctx.task_branch,
            "--force-with-lease",
            cwd=repo_path,
        )
        if code != 0:
            raise RuntimeError(f"git push failed: {err}")

        logger.info(
            "Push completed: branch=%s sha=%s",
            ctx.task_branch,
            sha[:8] if sha else "?",
        )
        return sha or None

    async def cleanup_branch(
        self, ctx: GitContext, repo_path: Path
    ) -> None:
        """合并完成后清理：删除本地和远程任务分支。"""
        if not ctx.task_branch:
            return

        # 切回 base
        await self._run_git("checkout", ctx.base_branch, cwd=repo_path)

        # 删除本地分支
        await self._run_git("branch", "-D", ctx.task_branch, cwd=repo_path)

        # 删除远程分支
        await self._run_git(
            "push", "origin", "--delete", ctx.task_branch, cwd=repo_path
        )

        logger.info("Cleaned up branch: %s", ctx.task_branch)

    def _inject_auth(
        self, repo_url: str, token: Optional[str] = None,
        username: Optional[str] = None, password: Optional[str] = None
    ) -> str:
        """为 HTTPS URL 注入认证信息（token 或 username:password）。"""
        from urllib.parse import quote

        token = token or os.environ.get("GIT_AUTH_TOKEN") or ""
        if repo_url.startswith("https://"):
            if token:
                return repo_url.replace("https://", f"https://{token}@", 1)
            elif username and password:
                encoded_user = quote(username, safe="")
                encoded_pass = quote(password, safe="")
                return repo_url.replace(
                    "https://", f"https://{encoded_user}:{encoded_pass}@", 1
                )
        return repo_url


# 全局单例（延迟初始化，由 main.py 在 lifespan 中创建）
git_manager: Optional[GitManager] = None


def get_git_manager() -> Optional[GitManager]:
    """返回当前全局 GitManager 实例。"""
    return git_manager


def init_git_manager(repos_dir: str) -> GitManager:
    """初始化全局 GitManager。"""
    global git_manager
    git_manager = GitManager(repos_dir=repos_dir)
    return git_manager
