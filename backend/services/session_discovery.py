"""会话发现服务 - 从本地 Agent 会话文件提供历史会话/任务数据。

复用 ``project_discovery.py`` 的扫描能力，提供 *会话* 级别（而非项目级别）的视图，
使后端 ``/api/tasks`` 与 ``/api/sessions`` 能够补充 SQLite 中尚未记录的历史数据，
从而与 Lark 端 ``/tasks``、``/chats``、``/convos`` 展示保持一致。

关键点：
- 仅 peek 文件首部若干行提取 cwd / session_id / 首条用户消息（不完整解析整个文件）
- 30s TTL 内存缓存，避免每次请求都扫盘
- 每个 Agent 最多扫描 ``MAX_SESSION_FILES`` 个文件（按 mtime 倒序）
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger("tide.session_discovery")

from backend.services.project_discovery import (
    CLAUDE_PROJECTS_DIR,
    CODEX_SESSIONS_DIR,
    PEEK_MAX_LINES,
    PROJECT_DISCOVERY_TTL,
    QODER_CACHE_DIR,
    QODER_PROJECTS_DIR,
    _list_jsonl,
    _normalize_path,
    find_project_root,
)

# ---------- Worktree 路径归一化 ----------


def _resolve_worktree_to_project(cwd: str) -> str:
    """将 worktree 路径解析为其源项目路径。

    当 CWD 位于 .tide/worktrees/ 或 .lark-codex/worktrees/ 下时，
    提取该标记之前的部分作为真实项目根路径。

    示例:
        /Users/haifeng/.tide/users/xxx/fms-server/.tide/worktrees/wi-yyy
        → /Users/haifeng/.tide/users/xxx/fms-server
    """
    for marker in ("/.tide/worktrees/", "/.lark-codex/worktrees/"):
        idx = cwd.find(marker)
        if idx != -1:
            return cwd[:idx]
    return cwd


# ---------- 数据提取 ----------

# 摘要标题最大长度
TITLE_MAX_LEN = 120

# 测试/无意义会话标题集合（小写）
# 这些通常是用户测试桥接链路时的随手输入，不构成有意义的工作会话
# ---------- Qoder IDE 缓存 CWD 解析 ----------


def _build_qoder_project_cwd_map() -> Dict[str, Path]:
    """从 ~/.qoder/projects/ 目录名反推项目名→实际路径映射。

    目录名编码规则：`/Users/haifeng/Documents/tide` → `-Users-haifeng-Documents-tide`
    """
    project_map: Dict[str, Path] = {}
    if not QODER_PROJECTS_DIR.exists():
        return project_map
    try:
        for entry in QODER_PROJECTS_DIR.iterdir():
            if not entry.is_dir():
                continue
            # 解码：'-Users-haifeng-Documents-tide' → '/Users/haifeng/Documents/tide'
            decoded = "/" + entry.name.lstrip("-").replace("-", "/")
            p = Path(decoded)
            try:
                if p.exists() and p.is_dir():
                    project_map[p.name] = p
            except OSError:
                pass
    except OSError:
        pass
    return project_map


def _resolve_cache_project_cwd(
    cache_path: Path, project_map: Dict[str, Path]
) -> Optional[Path]:
    """从 Qoder 缓存文件路径推导项目 CWD。

    缓存路径结构：
        ~/.qoder/cache/projects/<name>-<8hex>/conversation-history/<id>/<id>.jsonl
    """
    parts = cache_path.parts
    for i, part in enumerate(parts):
        if part == "conversation-history" and i > 0:
            project_dir_name = parts[i - 1]  # e.g., 'tide-e1f17a2a'
            # 移除 8 位 hex 后缀：'tide-e1f17a2a' → 'tide'
            if (
                len(project_dir_name) > 9
                and project_dir_name[-9] == "-"
                and all(c in "0123456789abcdef" for c in project_dir_name[-8:])
            ):
                project_name = project_dir_name[:-9]
            else:
                project_name = project_dir_name
            return project_map.get(project_name)
    return None


_JUNK_TITLES = {
    "hi", "hello", "hey", "yo",
    "x", "y", "n", "a", "b", "c",
    "ok", "okay", "yes", "no",
    "test", "测试", "pwd", "ls", "echo",
    "在", "在吗", "你好",
}


def _truncate(text: str, limit: int = TITLE_MAX_LEN) -> str:
    text = (text or "").strip().replace("\n", " ").replace("\r", " ")
    if len(text) > limit:
        return text[: limit - 1] + "…"
    return text


def _extract_text(content, *, skip_tool_results: bool = False) -> str:
    """从 Claude/Codex/Qoder 的 message.content 中抽取纯文本。

    Args:
        content: message.content 字段（可能是 str / list[dict] / dict）
        skip_tool_results: 是否跳过 tool_result 类型的 content block。
            设为 True 时，工具返回的中间结果（如文件列表、命令输出）不会被提取，
            从而避免 tool_result 被当作 "user" 消息显示的噪音问题。
    """
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: List[str] = []
        for item in content:
            if isinstance(item, dict):
                # 跳过 tool_result / tool_use / thinking 等非文本 block
                if skip_tool_results:
                    block_type = item.get("type", "")
                    if block_type in ("tool_result", "tool_use", "thinking", "redacted_thinking"):
                        continue
                t = item.get("text") or item.get("content")
                if isinstance(t, str):
                    parts.append(t)
            elif isinstance(item, str):
                parts.append(item)
        return "\n".join(parts)
    if isinstance(content, dict):
        t = content.get("text") or content.get("content")
        if isinstance(t, str):
            return t
    return ""


def _peek_session_meta(
    path: Path, agent_id: str
) -> Tuple[Optional[Path], Optional[str], Optional[str], Optional[str], bool, Optional[str]]:
    """读取前若干行，提取 cwd, session_id, title (首个用户 prompt), created_at, is_sub_session, session_source。"""
    cwd: Optional[Path] = None
    session_id: Optional[str] = None
    title: Optional[str] = None
    created_at: Optional[str] = None
    is_sub_session: bool = False
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
                        if not created_at:
                            created_at = (
                                payload.get("timestamp")
                                or obj.get("timestamp")
                                or None
                            )
                        c = payload.get("cwd")
                        if c and not cwd:
                            cwd = Path(str(c))
                        # 提取 session source（exec/cli/vscode）
                        raw_source = payload.get("source")
                        if isinstance(raw_source, str) and not session_source:
                            session_source = raw_source
                        # 子会话判断：仅当 cwd 在 worktrees 目录下才视为子会话
                        # source="exec" 不再作为过滤条件（用户通过 Lark 发起的也是 exec）
                        cwd_str = str(payload.get("cwd", "") or "").replace("\\", "/")
                        if ".tide/worktrees" in cwd_str or ".lark-codex/worktrees" in cwd_str:
                            is_sub_session = True
                        elif isinstance(raw_source, dict) and "subagent" in str(raw_source):
                            is_sub_session = True
                        continue
                    if typ == "turn_context":
                        c = payload.get("cwd")
                        if c and not cwd:
                            cwd = Path(str(c))
                        continue
                    # 首个用户消息作为 title
                    if not title:
                        if typ == "event_msg" and payload.get("type") == "user_message":
                            msg = payload.get("message") or ""
                            if msg and not msg.startswith("<"):
                                title = _truncate(msg)
                        elif typ == "response_item" and payload.get("type") == "message":
                            if payload.get("role") == "user":
                                text = _extract_text(payload.get("content"))
                                if text and not text.startswith("<"):
                                    title = _truncate(text)
                else:
                    # Claude / Qoder：每行 JSON 直接含 cwd / sessionId / message
                    if obj.get("isMeta"):
                        continue
                    raw_sid = obj.get("sessionId") or obj.get("session_id")
                    if raw_sid and not session_id:
                        session_id = str(raw_sid)
                    c = obj.get("cwd")
                    if c and not cwd:
                        cwd = Path(str(c))
                    if not created_at:
                        ts = obj.get("timestamp") or obj.get("created_at")
                        if isinstance(ts, str):
                            created_at = ts
                    if not title:
                        msg = obj.get("message")
                        if isinstance(msg, dict) and msg.get("role") == "user":
                            text = _extract_text(msg.get("content"))
                            if text and not text.startswith("<"):
                                title = _truncate(text)
                        elif obj.get("type") == "user":
                            text = _extract_text(obj.get("content") or obj.get("message"))
                            if text and not text.startswith("<"):
                                title = _truncate(text)
                        elif obj.get("role") == "user":
                            # Qoder IDE 缓存格式：{role, message: {content}}
                            msg_data = obj.get("message")
                            if isinstance(msg_data, dict):
                                text = _extract_text(msg_data.get("content"))
                            else:
                                text = _extract_text(msg_data)
                            if text:
                                # 提取 <user_query> 标签中的实际用户输入
                                uq = re.search(r"<user_query>(.*?)</user_query>", text, re.DOTALL)
                                if uq:
                                    title = _truncate(uq.group(1).strip())
                                elif not text.startswith("<"):
                                    title = _truncate(text)

                if cwd and session_id and title:
                    break
    except OSError:
        return None, None, None, None, False, None

    # Plan 步骤子任务检测：title 仅为 "p1"/"p2"/"P3" 等 plan 步骤标识符
    # 这些是 /plan 功能自动拆分执行的，不是真实用户对话
    if agent_id == "codex" and title and re.match(r'^[Pp]\d+$', title.strip()):
        is_sub_session = True

    # 测试/无意义会话过滤：用户测试桥接链路时的单字符或问候语输入
    # 这些会话不是有意义的工作会话（如 "hi"/"x"/"test"/"pwd" 等）
    # 对所有 agent (codex/claude/qoder) 统一生效
    if title:
        normalized = title.strip().lower()
        if normalized in _JUNK_TITLES or len(normalized) <= 1:
            is_sub_session = True

    return cwd, session_id, title, created_at, is_sub_session, session_source


# ---------- 时间工具 ----------


def _ts_to_iso(ts: float) -> Optional[str]:
    if not ts:
        return None
    try:
        return datetime.fromtimestamp(ts).isoformat()
    except (OverflowError, OSError, ValueError):
        return None


# ---------- 缓存 ----------

_cache_lock = threading.Lock()
_cache: Dict[str, object] = {"ts": 0.0, "data": []}


def _scan_all() -> List[Dict]:
    """扫描所有 Agent 的会话文件，返回会话字典列表（未过滤）。"""
    results: List[Dict] = []

    # 构建 Qoder 项目名→CWD 映射（用于缓存目录 CWD 解析）
    _qoder_project_cwds = _build_qoder_project_cwd_map()

    scan_targets = (
        ("codex", CODEX_SESSIONS_DIR),
        ("claude", CLAUDE_PROJECTS_DIR),
        ("qoder", QODER_PROJECTS_DIR),
        ("qoder", QODER_CACHE_DIR),  # Qoder IDE 客户端缓存对话
    )

    for agent_id, directory in scan_targets:
        for path in _list_jsonl(directory):
            # 跳过 subagents 子目录中的文件（它们是子 agent 会话，不是顶层会话）
            if "/subagents/" in str(path) or "\\subagents\\" in str(path):
                continue
            try:
                stat = path.stat()
            except OSError:
                continue
            mtime = stat.st_mtime
            ctime = stat.st_ctime
            cwd, sid, title, created_at_iso, is_sub, session_source = _peek_session_meta(path, agent_id)
            # 对 Qoder 缓存文件，文件内无 cwd 字段，从目录结构推导
            if not cwd and directory == QODER_CACHE_DIR:
                cwd = _resolve_cache_project_cwd(path, _qoder_project_cwds)
            # 跳过子会话（codex exec/subagent）
            if is_sub:
                continue
            if not sid:
                sid = path.stem
            # Worktree 路径归一化：将 .tide/worktrees/wi-xxx 路径解析为源项目路径
            resolved_cwd = cwd
            if cwd:
                resolved = _resolve_worktree_to_project(str(cwd))
                resolved_path = Path(resolved)
                if resolved_path.exists():
                    resolved_cwd = resolved_path
            project_root = find_project_root(resolved_cwd) if resolved_cwd else None
            project_name = project_root.name if project_root else None
            cwd_str = str(_normalize_path(cwd)) if cwd else None
            project_root_str = str(project_root) if project_root else None

            results.append(
                {
                    "id": sid,
                    "session_id": sid,
                    "agent_id": agent_id,
                    "cwd": cwd_str,
                    "project_root": project_root_str,
                    "project_name": project_name,
                    "title": title or path.stem,
                    "status": "completed",
                    "last_active": _ts_to_iso(mtime),
                    "last_active_ts": mtime,
                    "created_at": created_at_iso or _ts_to_iso(ctime),
                    "file": str(path),
                    "source": "file",
                    "session_source": session_source or ("cli" if agent_id != "codex" else None),
                }
            )

    results.sort(key=lambda r: r.get("last_active_ts") or 0.0, reverse=True)
    logger.debug(
        "session_discovery scanned %d sessions: codex=%d claude=%d qoder=%d",
        len(results),
        sum(1 for r in results if r.get("agent_id") == "codex"),
        sum(1 for r in results if r.get("agent_id") == "claude"),
        sum(1 for r in results if r.get("agent_id") == "qoder"),
    )
    return results


def _load(force: bool = False) -> List[Dict]:
    now = time.time()
    with _cache_lock:
        cached_ts = float(_cache.get("ts", 0))
        if not force and cached_ts and (now - cached_ts) < PROJECT_DISCOVERY_TTL:
            return list(_cache.get("data", []))  # type: ignore[arg-type]

    data = _scan_all()
    with _cache_lock:
        _cache["ts"] = now
        _cache["data"] = data
    return list(data)



# _session_references_project 已移除：
# 该函数通过在会话文件内容中搜索项目路径片段（如 "/tide"）来判断归属，
# 但过于宽泛，会将仅在系统提示或偶然上下文中提到项目名的无关会话错误关联。
# 会话归属应严格依据其 project_root 或 cwd 字段判定。

# ---------- 公开 API ----------


def discover_sessions(
    project_cwd: Optional[str] = None,
    agent_id: Optional[str] = None,
    limit: Optional[int] = None,
    offset: int = 0,
    force: bool = False,
) -> List[Dict]:
    """发现所有会话，可选按项目 cwd（项目根或子目录）和 agent_id 过滤。

    返回字段：
      id, session_id, agent_id, cwd, project_root, project_name, title,
      status, last_active, created_at, file, source="file"
    """
    items = _load(force=force)

    if project_cwd:
        try:
            target = str(_normalize_path(Path(project_cwd)))
        except OSError:
            target = project_cwd
        # 去除末尾斜杠以便前缀匹配
        target = target.rstrip("/")
        
        filtered_items = []
        for it in items:
            # 过滤逻辑：严格通过 project_root 或 cwd 精确/子目录匹配
            pr = (it.get("project_root") or "").rstrip("/")
            cwd_val = (it.get("cwd") or "").rstrip("/")
            if pr and (pr == target or pr.startswith(target + "/")):
                filtered_items.append(it)
            elif cwd_val and (cwd_val == target or cwd_val.startswith(target + "/")):
                filtered_items.append(it)
        
        items = filtered_items

    if agent_id:
        items = [it for it in items if it.get("agent_id") == agent_id]

    if offset:
        items = items[offset:]
    if limit is not None:
        items = items[:limit]

    # 移除内部排序辅助字段
    return [{k: v for k, v in it.items() if k != "last_active_ts"} for it in items]


def discover_chats(
    project_cwd: Optional[str] = None,
    agent_id: Optional[str] = None,
    limit: Optional[int] = None,
    offset: int = 0,
    force: bool = False,
) -> List[Dict]:
    """发现不绑定项目的普通对话（Chat）。

    Chat 判定：``project_root`` 为 None（不绑定任何项目）。
    复用 ``_load()`` 的 TTL 缓存，不会重复扫描。

    Args:
        project_cwd: 可选项目路径。传入时仅返回 cwd 在该路径下的对话。
        agent_id: 可选 agent 过滤。
        limit: 分页限制。
        offset: 分页偏移。
        force: 强制刷新缓存。

    Returns:
        与 ``discover_sessions`` 同结构的字典列表。
    """
    items = _load(force=force)

    # 仅保留 project_root 为空的会话
    items = [it for it in items if not it.get("project_root")]

    # 按项目 cwd 路径过滤：仅保留 cwd 在项目目录下的对话
    if project_cwd:
        try:
            target = str(_normalize_path(Path(project_cwd)))
        except OSError:
            target = project_cwd
        target = target.rstrip("/")

        filtered_items = []
        for it in items:
            cwd_val = (it.get("cwd") or "").rstrip("/")
            if cwd_val and (cwd_val == target or cwd_val.startswith(target + "/")):
                filtered_items.append(it)
        items = filtered_items

    if agent_id:
        items = [it for it in items if it.get("agent_id") == agent_id]

    if offset:
        items = items[offset:]
    if limit is not None:
        items = items[:limit]

    # 移除内部排序辅助字段
    return [{k: v for k, v in it.items() if k != "last_active_ts"} for it in items]


def clear_cache() -> None:
    with _cache_lock:
        _cache["ts"] = 0.0
        _cache["data"] = []


# ---------- 单会话查找 ----------


def find_session(session_id: str, force: bool = False) -> Optional[Dict]:
    """按 session_id 在已扫描的会话中查找单条记录。

    返回字段同 ``discover_sessions``（含 file 路径），未命中时返回 None。
    """
    if not session_id:
        return None
    items = _load(force=force)
    for it in items:
        if it.get("session_id") == session_id or it.get("id") == session_id:
            return {k: v for k, v in it.items() if k != "last_active_ts"}
    return None


# ---------- 消息抽取 ----------

MAX_MESSAGES = 1000


def _coerce_iso(ts) -> Optional[str]:
    if not ts:
        return None
    if isinstance(ts, str):
        return ts
    if isinstance(ts, (int, float)):
        try:
            # 毫秒/秒兼容
            value = float(ts)
            if value > 1e12:
                value = value / 1000.0
            return datetime.fromtimestamp(value).isoformat()
        except (OverflowError, OSError, ValueError):
            return None
    return None


def _parse_codex_line(obj: Dict) -> Optional[Dict]:
    typ = obj.get("type")
    payload = obj.get("payload") or {}
    ts = obj.get("timestamp") or payload.get("timestamp")
    if typ == "event_msg":
        sub = payload.get("type")
        if sub == "user_message":
            msg = payload.get("message") or ""
            if msg and not msg.startswith("<"):
                return {"role": "user", "content": str(msg), "timestamp": _coerce_iso(ts)}
        if sub == "agent_message":
            msg = payload.get("message") or ""
            if msg:
                return {"role": "assistant", "content": str(msg), "timestamp": _coerce_iso(ts)}
        if sub == "agent_reasoning":
            text = payload.get("text") or payload.get("message") or ""
            if text:
                return {"role": "assistant", "content": str(text), "timestamp": _coerce_iso(ts), "kind": "reasoning"}
    if typ == "response_item" and payload.get("type") == "message":
        role = payload.get("role")
        content = _extract_text(payload.get("content"))
        if content and role in ("user", "assistant", "system") and not content.startswith("<"):
            return {"role": role, "content": content, "timestamp": _coerce_iso(ts)}
    return None


def _parse_claude_line(obj: Dict) -> Optional[Dict]:
    if obj.get("isMeta"):
        return None
    # 跳过非消息类型的行（文件快照、last-prompt 等）
    line_type = obj.get("type", "")
    if line_type in ("file-history-snapshot", "last-prompt"):
        return None
    ts = obj.get("timestamp") or obj.get("created_at")
    msg = obj.get("message")
    if isinstance(msg, dict):
        role = msg.get("role")
        # 对 user 角色的消息跳过 tool_result 块，避免工具输出显示为 "用户" 消息
        skip_tools = (role == "user")
        content = _extract_text(msg.get("content"), skip_tool_results=skip_tools)
        if content and role in ("user", "assistant", "system") and not content.startswith("<"):
            return {"role": role, "content": content, "timestamp": _coerce_iso(ts)}
    typ = obj.get("type")
    if typ in ("user", "assistant", "system"):
        skip_tools = (typ == "user")
        content = _extract_text(obj.get("content") or obj.get("message"), skip_tool_results=skip_tools)
        if content and not content.startswith("<"):
            return {"role": typ, "content": content, "timestamp": _coerce_iso(ts)}
    # Qoder IDE 缓存格式：{role: "user"|"assistant", message: {content: [...]}}
    role_field = obj.get("role")
    if role_field in ("user", "assistant", "system"):
        msg_data = obj.get("message")
        if isinstance(msg_data, dict):
            skip_tools = (role_field == "user")
            raw = _extract_text(msg_data.get("content"), skip_tool_results=skip_tools)
        else:
            raw = _extract_text(msg_data)
        if raw:
            # 对 user 消息提取 <user_query> 内容，跳过系统提示
            if role_field == "user":
                uq = re.search(r"<user_query>(.*?)</user_query>", raw, re.DOTALL)
                if uq:
                    raw = uq.group(1).strip()
                elif raw.startswith("<"):
                    return None  # 纯系统提示，跳过
            if raw and not raw.startswith("<"):
                return {"role": role_field, "content": raw, "timestamp": _coerce_iso(ts)}
    return None


def read_session_messages(
    file_path: str, agent_id: str, limit: int = MAX_MESSAGES
) -> List[Dict]:
    """解析 JSONL 会话文件，返回标准化的消息列表。

    返回元素：``{role, content, timestamp, kind?}``
    无法读取或文件不存在时返回 []。
    """
    p = Path(file_path)
    if not p.exists() or not p.is_file():
        return []
    out: List[Dict] = []
    try:
        with p.open("r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(obj, dict):
                    continue
                msg: Optional[Dict] = None
                if agent_id == "codex":
                    msg = _parse_codex_line(obj)
                else:
                    msg = _parse_claude_line(obj)
                if msg:
                    out.append(msg)
                    if len(out) >= limit:
                        break
    except OSError:
        return []
    return out


# ---------- Token 估算与同步 ----------

# 复用全局 tiktoken 编码器实例，避免每次调用都重新创建
_tiktoken_encoder = None
_tiktoken_lock = threading.Lock()


def _get_tiktoken_encoder():
    """懒加载 tiktoken 编码器（线程安全）。"""
    global _tiktoken_encoder
    if _tiktoken_encoder is not None:
        return _tiktoken_encoder
    with _tiktoken_lock:
        if _tiktoken_encoder is not None:
            return _tiktoken_encoder
        try:
            import tiktoken
            _tiktoken_encoder = tiktoken.get_encoding("cl100k_base")
        except Exception:
            _tiktoken_encoder = None
    return _tiktoken_encoder


def _estimate_tokens(text: str) -> int:
    """使用缓存的 tiktoken 编码器估算 token 数，不可用时按 4 字符/token 粗估。"""
    if not text:
        return 0
    enc = _get_tiktoken_encoder()
    if enc is not None:
        try:
            return len(enc.encode(text))
        except Exception:
            pass
    return max(1, len(text) // 4)


def _estimate_tokens_chunked(parts: List[str]) -> int:
    """分段估算 token 数，避免拼接超大字符串。"""
    if not parts:
        return 0
    enc = _get_tiktoken_encoder()
    total = 0
    if enc is not None:
        try:
            for part in parts:
                if part:
                    total += len(enc.encode(part))
            return total
        except Exception:
            pass
    # fallback: 字符数 / 4
    for part in parts:
        if part:
            total += max(1, len(part) // 4)
    return total


def _collect_content_text(content, role: str) -> str:
    """从 message.content 中提取所有文本内容（包含 tool_use/tool_result），用于 token 估算。

    与 _extract_text 不同，此函数不跳过任何内容类型。
    """
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: List[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
                continue
            if not isinstance(block, dict):
                continue
            block_type = block.get("type", "")
            # redacted_thinking 不计费
            if block_type == "redacted_thinking":
                continue
            if block_type in ("text", "input_text", "output_text"):
                t = block.get("text", "")
                if t:
                    parts.append(t)
            elif block_type == "tool_use":
                # tool_use 的 input 是结构化 JSON
                inp = block.get("input")
                if inp:
                    try:
                        parts.append(json.dumps(inp, ensure_ascii=False))
                    except (TypeError, ValueError):
                        parts.append(str(inp))
                # tool name 也计入
                name = block.get("name", "")
                if name:
                    parts.append(name)
            elif block_type == "tool_result":
                # tool_result 的 content 可能是字符串或数组
                tr_content = block.get("content")
                if isinstance(tr_content, str):
                    parts.append(tr_content)
                elif isinstance(tr_content, list):
                    for sub in tr_content:
                        if isinstance(sub, str):
                            parts.append(sub)
                        elif isinstance(sub, dict):
                            t = sub.get("text", "")
                            if t:
                                parts.append(t)
            elif block_type == "thinking":
                t = block.get("thinking", "") or block.get("text", "")
                if t:
                    parts.append(t)
            else:
                # 其他类型（image 等），尝试提取 text
                t = block.get("text") or block.get("content", "")
                if isinstance(t, str) and t:
                    parts.append(t)
        return "\n".join(parts)
    if isinstance(content, dict):
        return _collect_content_text(content.get("content") or content.get("text", ""), role)
    return str(content) if content else ""


def _estimate_session_file_tokens(file_path: str, start_line: int = 0) -> Tuple[int, int, int]:
    """估算会话文件的 token 用量，计入所有内容类型（含 tool_use/tool_result）。

    Args:
        file_path: JSONL 文件路径
        start_line: 从第几行开始（增量处理，基于文件行数）

    Returns:
        (input_tokens, output_tokens, total_lines_in_file)
    """
    p = Path(file_path)
    if not p.exists() or not p.is_file():
        return (0, 0, 0)

    input_parts: List[str] = []
    output_parts: List[str] = []
    total_lines = 0

    try:
        with p.open("r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                total_lines += 1
                if total_lines <= start_line:
                    continue
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(obj, dict):
                    continue

                # 跳过非对话类型
                line_type = obj.get("type", "")
                if line_type in ("file-history-snapshot", "last-prompt"):
                    continue
                if obj.get("isMeta"):
                    continue

                # ---- 确定 role 和 content ----
                role = None
                content = None

                # Codex 格式: {type: "event_msg", payload: {...}}
                if line_type == "event_msg":
                    payload = obj.get("payload") or {}
                    sub = payload.get("type", "")
                    if sub == "user_message":
                        role = "user"
                        content = payload.get("message", "")
                    elif sub == "agent_message":
                        role = "assistant"
                        content = payload.get("message", "")
                    elif sub == "agent_reasoning":
                        role = "assistant"
                        content = payload.get("text") or payload.get("message", "")
                elif line_type == "response_item":
                    payload = obj.get("payload") or {}
                    payload_type = payload.get("type", "")
                    if payload_type == "message":
                        role = payload.get("role")
                        content = payload.get("content")
                    elif payload_type == "function_call":
                        # Codex function call: arguments 计为 assistant output
                        role = "assistant"
                        args = payload.get("arguments", "")
                        name = payload.get("name", "")
                        content = (name + "\n" + args) if name else args
                    elif payload_type == "function_call_output":
                        # Codex function call result: output 计为 input
                        role = "user"
                        content = payload.get("output", "")

                # Claude/Qoder 格式: {message: {role, content}, ...}
                elif "message" in obj and isinstance(obj.get("message"), dict):
                    msg = obj["message"]
                    role = msg.get("role") or obj.get("role")
                    content = msg.get("content")

                # 顶层 role 字段: {role: "user", content: [...]}
                elif obj.get("role") in ("user", "assistant", "system"):
                    role = obj["role"]
                    content = obj.get("content") or obj.get("message")
                    # Qoder IDE 缓存: {role, message: {content: [...]}}
                    if isinstance(content, dict):
                        content = content.get("content")

                # 顶层 type 作为 role: {type: "user", content: [...]}
                elif line_type in ("user", "assistant", "system"):
                    role = line_type
                    content = obj.get("content") or obj.get("message")

                if not role or role not in ("user", "assistant", "system", "developer"):
                    continue

                # 提取全量文本
                text = _collect_content_text(content, role)
                if not text:
                    continue

                if role in ("user", "system", "developer"):
                    input_parts.append(text)
                else:
                    output_parts.append(text)

    except OSError:
        return (0, 0, 0)

    # 分段估算 token
    input_tokens = _estimate_tokens_chunked(input_parts)
    output_tokens = _estimate_tokens_chunked(output_parts)

    return (input_tokens, output_tokens, total_lines)


async def sync_session_token_usage() -> dict:
    """扫描所有 Qoder/Codex/Claude IDE 会话，估算 token 并写入 DB。

    增量策略：通过 tasks.synced_message_count 记录已处理的文件行数，
    仅对新增行进行估算，避免重复计算。
    使用 _estimate_session_file_tokens 专用函数，计入所有内容类型
    （tool_use / tool_result / thinking 等），解决之前仅覆盖 ~14% 实际用量的问题。

    Returns:
        统计信息 dict: synced / skipped / created / errors
    """
    from sqlalchemy import text as sa_text
    from backend.db.engine import async_session_factory
    from backend.services.cost_service import cost_service

    stats = {"synced": 0, "skipped": 0, "created": 0, "errors": 0}

    # 获取所有已发现的 Qoder/Codex/Claude IDE 会话
    all_sessions = _load(force=False)
    target_sessions = [
        s for s in all_sessions
        if s.get("agent_id") in ("qoder", "codex", "claude") and s.get("file")
    ]

    for sess in target_sessions:
        session_id = sess.get("session_id") or sess.get("id")
        file_path = sess.get("file")
        if not session_id or not file_path:
            continue

        try:
            # 查找或创建关联的 task
            task_id: Optional[str] = None
            synced_count = 0

            async with async_session_factory() as db_session:
                r = await db_session.execute(
                    sa_text(
                        "SELECT id, COALESCE(synced_message_count, 0) "
                        "FROM tasks WHERE session_id = :sid "
                        "ORDER BY created_at DESC LIMIT 1"
                    ),
                    {"sid": session_id},
                )
                row = r.fetchone()
                if row:
                    task_id = row[0]
                    synced_count = int(row[1] or 0)

            # 使用专用函数估算 token（计入 tool_use/tool_result 等全部内容）
            # synced_count 语义为已处理的文件行数
            input_tokens, output_tokens, total_lines = _estimate_session_file_tokens(
                file_path, start_line=synced_count
            )

            # 增量检查：文件行数未变则跳过
            if total_lines <= synced_count:
                stats["skipped"] += 1
                continue

            # 如果没有关联 task，创建占位任务
            if not task_id:
                from backend.services.task_service import task_service
                title = sess.get("title") or "Qoder IDE session"
                cwd = sess.get("cwd") or ""
                task = await task_service.create_task(
                    workspace_id="default",
                    prompt=title,
                    agent_id=sess.get("agent_id", "qoder"),
                    model=sess.get("model", "auto"),
                    cwd=cwd,
                    attachments=[],
                    session_id=session_id,
                )
                if task:
                    task_id = task.get("id")
                    stats["created"] += 1
                else:
                    stats["errors"] += 1
                    continue

            if input_tokens == 0 and output_tokens == 0:
                stats["skipped"] += 1
                continue

            # 写入 cost_service（累加到 task 的 token 计数）
            await cost_service.update_task_cost(
                task_id=task_id,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                model=sess.get("model", "auto"),
            )

            # 更新 synced_message_count（语义：已处理的文件行数）+ completed_at（最后活跃时间）
            async with async_session_factory() as db_session:
                await db_session.execute(
                    sa_text(
                        "UPDATE tasks SET synced_message_count = :cnt, "
                        "completed_at = :now WHERE id = :tid"
                    ),
                    {"cnt": total_lines, "tid": task_id, "now": datetime.utcnow().isoformat()},
                )
                await db_session.commit()

            stats["synced"] += 1

        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "sync_session_token_usage failed for session=%s: %s",
                session_id, exc,
            )
            stats["errors"] += 1

    logger.info(
        "sync_session_token_usage completed: synced=%d skipped=%d created=%d errors=%d",
        stats["synced"], stats["skipped"], stats["created"], stats["errors"],
    )
    return stats
