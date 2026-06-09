"""归档状态服务 — 维护项目/会话的软删除标记。

存储方案：独立的 JSON 文件（避免与 Lark Bridge 的 ``.lark2agent_state.json`` 互相干扰）。
默认路径由 ``LARK2AGENT_ARCHIVE_FILE`` 环境变量控制，落在仓库根目录下的
``.lark2agent_archived.json``。

JSON 结构::

    {
      "archived_projects": ["<project_id>", ...],
      "archived_sessions": ["<session_id>", ...]
    }

``project_id`` 采用与 ``backend/api/projects.py`` 一致的 URL-safe base64(cwd)；
``session_id`` 直接使用 ``session_discovery`` 暴露的字符串。

读写均加进程内锁，并按 mtime 做轻量缓存，避免高频访问反复打开文件。
"""

from __future__ import annotations

import json
import logging
import os
import threading
from pathlib import Path
from typing import Iterable, List, Set

logger = logging.getLogger("lark2agent.archive_service")

DEFAULT_ARCHIVE_FILE = ".lark2agent_archived.json"


def _resolve_path() -> Path:
    raw = os.getenv("LARK2AGENT_ARCHIVE_FILE", DEFAULT_ARCHIVE_FILE)
    return Path(raw).expanduser()


class ArchiveStore:
    """归档状态持久化。"""

    def __init__(self, path: Path | None = None) -> None:
        self._path = path or _resolve_path()
        self._lock = threading.RLock()
        self._mtime: float = 0.0
        self._projects: Set[str] = set()
        self._sessions: Set[str] = set()
        self._loaded = False

    # ---------- 内部 IO ----------

    def _load_locked(self, force: bool = False) -> None:
        path = self._path
        try:
            mtime = path.stat().st_mtime if path.exists() else 0.0
        except OSError:
            mtime = 0.0
        if not force and self._loaded and mtime == self._mtime:
            return

        projects: Set[str] = set()
        sessions: Set[str] = set()
        if path.exists():
            try:
                data = json.loads(path.read_text("utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                logger.warning("archive_service: failed to load %s: %s", path, exc)
                data = {}
            if isinstance(data, dict):
                for sid in data.get("archived_projects") or []:
                    if isinstance(sid, str) and sid:
                        projects.add(sid)
                for sid in data.get("archived_sessions") or []:
                    if isinstance(sid, str) and sid:
                        sessions.add(sid)
        self._projects = projects
        self._sessions = sessions
        self._mtime = mtime
        self._loaded = True

    def _save_locked(self) -> None:
        path = self._path
        payload = {
            "archived_projects": sorted(self._projects),
            "archived_sessions": sorted(self._sessions),
        }
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, path)
        try:
            self._mtime = path.stat().st_mtime
        except OSError:
            self._mtime = 0.0
        self._loaded = True

    # ---------- 公开 API ----------

    @property
    def path(self) -> Path:
        return self._path

    def reload(self) -> None:
        with self._lock:
            self._load_locked(force=True)

    def list_archived_projects(self) -> List[str]:
        with self._lock:
            self._load_locked()
            return sorted(self._projects)

    def list_archived_sessions(self) -> List[str]:
        with self._lock:
            self._load_locked()
            return sorted(self._sessions)

    def is_project_archived(self, project_id: str) -> bool:
        if not project_id:
            return False
        with self._lock:
            self._load_locked()
            return project_id in self._projects

    def is_session_archived(self, session_id: str) -> bool:
        if not session_id:
            return False
        with self._lock:
            self._load_locked()
            return session_id in self._sessions

    def archive_project(self, project_id: str) -> bool:
        if not project_id:
            return False
        with self._lock:
            self._load_locked()
            if project_id in self._projects:
                return False
            self._projects.add(project_id)
            self._save_locked()
            return True

    def unarchive_project(self, project_id: str) -> bool:
        if not project_id:
            return False
        with self._lock:
            self._load_locked()
            if project_id not in self._projects:
                return False
            self._projects.discard(project_id)
            self._save_locked()
            return True

    def archive_session(self, session_id: str) -> bool:
        if not session_id:
            return False
        with self._lock:
            self._load_locked()
            if session_id in self._sessions:
                return False
            self._sessions.add(session_id)
            self._save_locked()
            return True

    def unarchive_session(self, session_id: str) -> bool:
        if not session_id:
            return False
        with self._lock:
            self._load_locked()
            if session_id not in self._sessions:
                return False
            self._sessions.discard(session_id)
            self._save_locked()
            return True

    def filter_projects(self, project_ids: Iterable[str]) -> Set[str]:
        """返回已归档的 project_id 子集。"""
        with self._lock:
            self._load_locked()
            return {pid for pid in project_ids if pid in self._projects}

    def filter_sessions(self, session_ids: Iterable[str]) -> Set[str]:
        """返回已归档的 session_id 子集。"""
        with self._lock:
            self._load_locked()
            return {sid for sid in session_ids if sid in self._sessions}


def _env_show_archived_default() -> bool:
    """读取默认的 ``show_archived`` 配置（环境变量）。"""
    raw = os.getenv("LARK2AGENT_SHOW_ARCHIVED", os.getenv("LARK_CODEX_SHOW_ARCHIVED", "0"))
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def resolve_show_archived(override: bool | None) -> bool:
    """合并显式 query 参数与环境变量。

    显式传入 ``True``/``False`` 时优先使用，否则取环境变量。
    """
    if override is None:
        return _env_show_archived_default()
    return bool(override)


# 进程内单例
archive_store = ArchiveStore()
