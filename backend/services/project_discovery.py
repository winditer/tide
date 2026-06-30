"""项目发现服务 - 通过扫描本地 Agent 会话文件发现项目

复用 tide_ws.py 的发现逻辑：
1. 扫描 ~/.codex/sessions, ~/.claude/projects, ~/.qoder/projects 下的 .jsonl
2. 仅 peek 文件首部以获取 cwd 元数据
3. 通过 find_project_root（查找 PROJECT_MARKERS）定位项目根
4. 聚合会话并按项目根分组

性能：
- 内存 TTL 缓存（默认 30s）避免重复扫描
- 每个 Agent 最多扫描 MAX_SESSION_FILES 个文件（按 mtime 倒序）
- 每个文件只读取前若干行直至获取到 cwd
"""

from __future__ import annotations

import json
import os
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# Agent 会话目录（保持与 tide_ws.py 一致的环境变量约定）
CODEX_HOME = Path(os.getenv("CODEX_HOME", Path.home() / ".codex")).expanduser()
CODEX_SESSIONS_DIR = Path(
    os.getenv("CODEX_SESSIONS_DIR", CODEX_HOME / "sessions")
).expanduser()

CLAUDE_HOME = Path(os.getenv("CLAUDE_HOME", Path.home() / ".claude")).expanduser()
CLAUDE_PROJECTS_DIR = Path(
    os.getenv("CLAUDE_PROJECTS_DIR", CLAUDE_HOME / "projects")
).expanduser()

QODER_HOME = Path(os.getenv("QODER_HOME", Path.home() / ".qoder")).expanduser()
QODER_PROJECTS_DIR = Path(
    os.getenv("QODER_PROJECTS_DIR", QODER_HOME / "projects")
).expanduser()

# Qoder IDE 客户端对话缓存目录（与 projects 目录格式不同，需要单独扫描）
QODER_CACHE_DIR = Path(
    os.getenv("QODER_CACHE_DIR", QODER_HOME / "cache" / "projects")
).expanduser()

MAX_SESSION_FILES = int(os.getenv("MAX_SESSION_FILES", "5000"))
PROJECT_DISCOVERY_TTL = float(os.getenv("PROJECT_DISCOVERY_TTL", "30"))
PEEK_MAX_LINES = int(os.getenv("PROJECT_DISCOVERY_PEEK_LINES", "50"))

PROJECT_MARKERS = (
    ".git",
    "package.json",
    "pyproject.toml",
    "go.mod",
    "Cargo.toml",
    "pom.xml",
    "composer.json",
    "requirements.txt",
    "README.md",
)

GENERIC_DIRS = {
    Path.home(),
    Path.home() / "Documents",
    Path("/tmp"),
    Path("/private/tmp"),
}

# 工作树目录片段：Plan 执行时会在该目录下创建 git worktree，
# 这些目录不应被识别为独立项目。
# 兼容旧命名 .lark-codex/worktrees 与新命名 .tide/worktrees。
WORKTREE_PATH_FRAGMENTS = (".tide/worktrees", ".lark-codex/worktrees")

# Codex/Qoder 客户端对话工作目录，不是真正的项目
_EXCLUDED_PROJECT_PATTERNS = [
    str(Path.home() / "Documents" / "Codex"),    # Codex Desktop 对话目录
    str(Path.home() / ".codex"),                   # Codex CLI 内部目录
    str(Path.home() / ".qoder" / "cache"),         # Qoder 缓存目录
]


def _is_excluded_path(path) -> bool:
    """判断路径是否属于客户端对话工作目录（非真实项目）。"""
    if not path:
        return False
    s = str(path)
    return any(s.startswith(pattern) for pattern in _EXCLUDED_PROJECT_PATTERNS)


def is_worktree_path(path) -> bool:
    """判断给定路径是否位于 worktrees 目录下（兼容 .tide 和 .lark-codex 命名）。"""
    if not path:
        return False
    try:
        s = str(path).replace("\\", "/")
    except Exception:
        return False
    return any(fragment in s for fragment in WORKTREE_PATH_FRAGMENTS)


@dataclass
class SessionRecord:
    agent_id: str
    session_id: str
    cwd: Optional[Path]
    file: Path
    updated_at: float
    session_source: Optional[str] = None


@dataclass
class DiscoveredProject:
    id: str  # 使用项目根路径作为 id（与 DB 聚合保持一致）
    name: str
    cwd: str
    sessions: List[SessionRecord] = field(default_factory=list)
    last_active_ts: float = 0.0
    agents: set = field(default_factory=set)


# ---------- 工具函数 ----------


def _normalize_path(path: Path) -> Path:
    try:
        return path.expanduser().resolve()
    except OSError:
        return path.expanduser()


def _is_generic_dir(path: Optional[Path]) -> bool:
    if not path:
        return True
    p = _normalize_path(path)
    return p in {_normalize_path(g) for g in GENERIC_DIRS}


def _has_project_marker(path: Path) -> bool:
    return any((path / marker).exists() for marker in PROJECT_MARKERS)


def find_project_root(cwd: Optional[Path]) -> Optional[Path]:
    """从给定 cwd 向上查找项目根（含 PROJECT_MARKERS 任一）。"""
    if not cwd:
        return None
    try:
        path = _normalize_path(cwd)
    except OSError:
        return None
    if _is_generic_dir(path):
        return None
    current = path
    stop_at = _normalize_path(Path.home())
    while True:
        if _is_generic_dir(current):
            break
        if _has_project_marker(current):
            return current
        if current == stop_at or current.parent == current:
            break
        current = current.parent
    return None


def _project_name(root: Path) -> str:
    return root.name or str(root)


# ---------- 文件扫描 ----------


def _list_jsonl(directory: Path) -> List[Path]:
    if not directory.exists():
        return []
    try:
        files = list(directory.glob("**/*.jsonl"))
    except OSError:
        return []
    files.sort(key=lambda p: p.stat().st_mtime if p.exists() else 0, reverse=True)
    return files[:MAX_SESSION_FILES]


def _peek_cwd(path: Path, agent_id: str) -> Tuple[Optional[Path], Optional[str], Optional[str]]:
    """只读取前若干行以提取 cwd、session_id 与 session_source。"""
    cwd: Optional[Path] = None
    session_id: Optional[str] = None
    session_source: Optional[str] = None
    try:
        with path.open("r", encoding="utf-8", errors="ignore") as f:
            for i, line in enumerate(f):
                if i >= PEEK_MAX_LINES:
                    break
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(obj, dict):
                    continue
                if agent_id == "codex":
                    typ = obj.get("type")
                    payload = obj.get("payload") or {}
                    if typ == "session_meta":
                        if not session_id:
                            session_id = payload.get("id") or session_id
                        c = payload.get("cwd")
                        if c and not cwd:
                            cwd = Path(str(c))
                        if not session_source:
                            session_source = payload.get("session_source")
                    elif typ == "turn_context":
                        c = payload.get("cwd")
                        if c and not cwd:
                            cwd = Path(str(c))
                else:
                    # Claude / Qoder：每行可能直接含 cwd
                    if obj.get("isMeta"):
                        continue
                    raw_sid = obj.get("sessionId") or obj.get("session_id")
                    if raw_sid and not session_id:
                        session_id = str(raw_sid)
                    c = obj.get("cwd")
                    if c and not cwd:
                        cwd = Path(str(c))
                if cwd and session_id:
                    break
    except OSError:
        return None, None, None
    return cwd, session_id, session_source


def _scan_agent(directory: Path, agent_id: str) -> List[SessionRecord]:
    records: List[SessionRecord] = []
    for path in _list_jsonl(directory):
        try:
            mtime = path.stat().st_mtime
        except OSError:
            continue
        cwd, sid, source = _peek_cwd(path, agent_id)
        if not sid:
            sid = path.stem
        records.append(
            SessionRecord(
                agent_id=agent_id,
                session_id=str(sid),
                cwd=cwd,
                file=path,
                updated_at=mtime,
                session_source=source,
            )
        )
    return records


def _scan_codex_sessions() -> List[SessionRecord]:
    return _scan_agent(CODEX_SESSIONS_DIR, "codex")


def _scan_claude_sessions() -> List[SessionRecord]:
    return _scan_agent(CLAUDE_PROJECTS_DIR, "claude")


def _scan_qoder_sessions() -> List[SessionRecord]:
    return _scan_agent(QODER_PROJECTS_DIR, "qoder")


# ---------- 聚合 ----------


def _aggregate(records: List[SessionRecord]) -> List[DiscoveredProject]:
    projects: Dict[str, DiscoveredProject] = {}
    for rec in records:
        # 排除 Codex 客户端的普通对话（vscode/cli），仅保留 exec 类型参与项目发现
        if rec.session_source and rec.session_source != "exec":
            continue
        # 排除位于 .tide/worktrees/ 下的会话（Plan 执行的临时工作树）
        if is_worktree_path(rec.cwd):
            continue
        # 排除客户端对话工作目录（cwd 本身即在排除路径下则无需寻根）
        if _is_excluded_path(rec.cwd):
            continue
        root = find_project_root(rec.cwd)
        if not root:
            continue
        if is_worktree_path(root):
            continue
        if _is_excluded_path(root):
            continue
        key = str(root)
        proj = projects.get(key)
        if proj is None:
            proj = DiscoveredProject(
                id=key,
                name=_project_name(root),
                cwd=key,
            )
            projects[key] = proj
        proj.sessions.append(rec)
        proj.agents.add(rec.agent_id)
        if rec.updated_at > proj.last_active_ts:
            proj.last_active_ts = rec.updated_at
    ordered = sorted(projects.values(), key=lambda p: p.last_active_ts, reverse=True)
    return ordered


# ---------- 缓存 ----------

_cache_lock = threading.Lock()
_cache: Dict[str, object] = {"ts": 0.0, "data": []}


def _ts_to_iso(ts: float) -> Optional[str]:
    if not ts:
        return None
    try:
        return datetime.fromtimestamp(ts).isoformat()
    except (OverflowError, OSError, ValueError):
        return None


def discover_projects(force: bool = False) -> List[Dict]:
    """扫描所有 Agent 会话文件，聚合为项目列表（带 TTL 缓存）。

    返回字段与前端 ProjectInfo 对齐：
      id, name, cwd, task_count, running_tasks, last_active, status,
      agents (额外字段，便于调试)
    """
    now = time.time()
    with _cache_lock:
        cached_ts = float(_cache.get("ts", 0))
        if not force and cached_ts and (now - cached_ts) < PROJECT_DISCOVERY_TTL:
            return list(_cache.get("data", []))  # type: ignore[arg-type]

    records: List[SessionRecord] = []
    records.extend(_scan_codex_sessions())
    records.extend(_scan_claude_sessions())
    records.extend(_scan_qoder_sessions())

    discovered = _aggregate(records)
    result: List[Dict] = []
    for proj in discovered:
        result.append(
            {
                "id": proj.id,
                "name": proj.name,
                "cwd": proj.cwd,
                "task_count": len(proj.sessions),
                "running_tasks": 0,
                "last_active": _ts_to_iso(proj.last_active_ts),
                "status": "idle",
                "agents": sorted(proj.agents),
            }
        )

    with _cache_lock:
        _cache["ts"] = now
        _cache["data"] = result
    return list(result)


def clear_cache() -> None:
    with _cache_lock:
        _cache["ts"] = 0.0
        _cache["data"] = []
