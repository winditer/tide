import hashlib
import json
import logging
import os
import queue
import re
import subprocess
import tempfile
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import lark_oapi as lark
from lark_oapi.api.im.v1 import (
    CreateMessageRequest,
    CreateMessageRequestBody,
    PatchMessageRequest,
    PatchMessageRequestBody,
)
from lark_oapi.event.callback.model.p2_card_action_trigger import (
    P2CardActionTriggerResponse,
)


def load_dotenv(path: Path = Path(".env")):
    if not path.exists():
        return

    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'\"")
        if key and key not in os.environ:
            os.environ[key] = value


load_dotenv()

# ===================== 配置 =====================
# 不要把 app secret 写进代码；用环境变量或 .env 注入。
APP_ID = os.getenv("LARK_APP_ID", "")
APP_SECRET = os.getenv("LARK_APP_SECRET", "")
LARK_DOMAIN = os.getenv("LARK_DOMAIN", "https://open.larksuite.com")
LARK_ENCRYPT_KEY = os.getenv("LARK_ENCRYPT_KEY", "")
LARK_VERIFICATION_TOKEN = os.getenv("LARK_VERIFICATION_TOKEN", "")

CODEX_HOME = Path(os.getenv("CODEX_HOME", Path.home() / ".codex")).expanduser()
CODEX_SESSIONS_DIR = Path(
    os.getenv("CODEX_SESSIONS_DIR", CODEX_HOME / "sessions")
).expanduser()
DEFAULT_CWD = Path(os.getenv("CODEX_DEFAULT_CWD", os.getcwd())).expanduser().resolve()
CODEX_BIN = os.getenv("CODEX_BIN", "codex")
CODEX_TIMEOUT_SECONDS = int(os.getenv("CODEX_TIMEOUT_SECONDS", "1800"))
CODEX_APPROVAL_POLICY = os.getenv("CODEX_APPROVAL_POLICY", "on-request")
CODEX_SANDBOX_MODE = os.getenv("CODEX_SANDBOX_MODE", "workspace-write")
APPROVED_CODEX_APPROVAL_POLICY = os.getenv("APPROVED_CODEX_APPROVAL_POLICY", "never")
APPROVED_CODEX_SANDBOX_MODE = os.getenv("APPROVED_CODEX_SANDBOX_MODE", "danger-full-access")
CODEX_SEND_STATUS_AFTER_TASK = os.getenv("CODEX_SEND_STATUS_AFTER_TASK", "0") == "1"

MESSAGE_CHUNK_SIZE = int(os.getenv("LARK_MESSAGE_CHUNK_SIZE", "1800"))
FINAL_REPLY_MAX_CHARS = int(os.getenv("LARK_FINAL_REPLY_MAX_CHARS", "4000"))
FINAL_QUESTION_MAX_CHARS = int(os.getenv("LARK_FINAL_QUESTION_MAX_CHARS", "1200"))
MAX_PROJECTS_IN_PANEL = int(os.getenv("MAX_PROJECTS_IN_PANEL", "8"))
MAX_CONVERSATIONS_IN_PANEL = int(os.getenv("MAX_CONVERSATIONS_IN_PANEL", "8"))
MAX_SESSION_FILES = int(os.getenv("MAX_SESSION_FILES", "300"))
STATUS_INTERVAL_SECONDS = int(os.getenv("STATUS_INTERVAL_SECONDS", "1800"))
TASK_CARD_REFRESH_INTERVAL_SECONDS = int(os.getenv("TASK_CARD_REFRESH_INTERVAL_SECONDS", "15"))
PENDING_APPROVAL_WAIT_SECONDS = int(os.getenv("PENDING_APPROVAL_WAIT_SECONDS", "300"))
PENDING_APPROVAL_POLL_SECONDS = int(os.getenv("PENDING_APPROVAL_POLL_SECONDS", "2"))
DAILY_REPORT_TIME = os.getenv("DAILY_REPORT_TIME", "19:00")
STATE_FILE = Path(os.getenv("LARK_CODEX_STATE_FILE", ".lark_codex_state.json"))
SYNC_DESKTOP_SESSIONS = os.getenv("SYNC_DESKTOP_SESSIONS", "1") == "1"
SESSION_WATCH_INTERVAL_SECONDS = int(os.getenv("SESSION_WATCH_INTERVAL_SECONDS", "3"))
# =================================================

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(threadName)s %(message)s",
)
logger = logging.getLogger("lark-codex-ws")


@dataclass
class ConversationInfo:
    session_id: str
    file: Path
    cwd: Optional[Path] = None
    created_at: str = ""
    updated_at: float = 0
    title: str = "未命名对话"
    last_user: str = ""
    last_assistant: str = ""
    status: str = "未知"
    turns: int = 0
    originator: str = ""
    source: str = ""


@dataclass
class ProjectInfo:
    key: str
    name: str
    cwd: Optional[Path]
    conversations: list[ConversationInfo] = field(default_factory=list)


@dataclass
class ChatRuntime:
    cwd: Path
    process: Optional[subprocess.Popen] = None
    active_project_key: str = ""
    active_session_id: str = ""
    task_message_id: str = ""
    task_prompt: str = ""
    task_status: str = ""
    task_output: str = ""
    task_started_at: float = 0
    last_task_card_update_at: float = 0
    last_status_sent_at: float = 0
    last_daily_sent_date: str = ""
    send_disabled: bool = False
    last_approval_fingerprint: str = ""
    next_approval_policy: str = ""
    next_sandbox_mode: str = ""


@dataclass
class PendingApproval:
    approval_id: str
    chat_id: str
    session_id: str
    cwd: str
    command: str
    reason: str
    original_prompt: str = ""
    resume_prompt: str = ""
    status: str = "pending"
    created_at: float = field(default_factory=time.time)


RUNTIMES: dict[str, ChatRuntime] = {}
PENDING_APPROVALS: dict[str, PendingApproval] = {}
LOCK = threading.RLock()
SEND_LOCK = threading.RLock()
CLIENT = None
EVENT_HANDLER = None
STOP_SCHEDULER = threading.Event()
EVENT_QUEUE: queue.Queue[tuple[str, tuple[Any, ...]]] = queue.Queue()
SESSION_WATCH_OFFSETS: dict[tuple[str, str], int] = {}
SESSION_SYNC_SEEN: set[str] = set()


def get_client():
    global CLIENT
    if CLIENT is None:
        CLIENT = (
            lark.Client.builder()
            .app_id(APP_ID)
            .app_secret(APP_SECRET)
            .domain(LARK_DOMAIN)
            .build()
        )
    return CLIENT


def read_state() -> dict[str, Any]:
    if not STATE_FILE.exists():
        return {"chats": {}}
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        logger.exception("failed to read state file")
        return {"chats": {}}


def write_state(state: dict[str, Any]):
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(STATE_FILE)


def save_runtime(chat_id: str):
    if not is_valid_chat_id(chat_id):
        logger.warning("skip saving invalid chat_id: %s", chat_id)
        return

    with LOCK:
        runtime = RUNTIMES.get(chat_id)
        if not runtime:
            return
        state = read_state()
        chats = state.setdefault("chats", {})
        chats[chat_id] = {
            "cwd": str(runtime.cwd),
            "active_project_key": runtime.active_project_key,
            "active_session_id": runtime.active_session_id,
            "task_message_id": runtime.task_message_id,
            "task_prompt": runtime.task_prompt,
            "task_status": runtime.task_status,
            "task_output": runtime.task_output,
            "task_started_at": runtime.task_started_at,
            "last_daily_sent_date": runtime.last_daily_sent_date,
            "send_disabled": runtime.send_disabled,
            "last_approval_fingerprint": runtime.last_approval_fingerprint,
        }
        write_state(state)


def load_known_chats():
    state = read_state()
    for chat_id, data in state.get("chats", {}).items():
        cwd = Path(data.get("cwd") or DEFAULT_CWD).expanduser()
        RUNTIMES[chat_id] = ChatRuntime(
            cwd=cwd,
            active_project_key=data.get("active_project_key", ""),
            active_session_id=data.get("active_session_id", ""),
            task_message_id=data.get("task_message_id", ""),
            task_prompt=data.get("task_prompt", ""),
            task_status=data.get("task_status", ""),
            task_output=data.get("task_output", ""),
            task_started_at=float(data.get("task_started_at", 0) or 0),
            last_daily_sent_date=data.get("last_daily_sent_date", ""),
            send_disabled=bool(data.get("send_disabled", False)),
            last_approval_fingerprint=data.get("last_approval_fingerprint", ""),
        )


def get_runtime(chat_id: str) -> ChatRuntime:
    with LOCK:
        runtime = RUNTIMES.get(chat_id)
        if runtime is None:
            runtime = ChatRuntime(cwd=DEFAULT_CWD)
            RUNTIMES[chat_id] = runtime
            save_runtime(chat_id)
        return runtime


def is_valid_chat_id(chat_id: str) -> bool:
    return isinstance(chat_id, str) and chat_id.startswith("oc_") and len(chat_id) > 10


def disable_chat_send(chat_id: str, reason: str):
    if not is_valid_chat_id(chat_id):
        return
    runtime = get_runtime(chat_id)
    runtime.send_disabled = True
    logger.error("disable sending to chat_id=%s: %s", chat_id, reason)
    save_runtime(chat_id)


def response_ok(resp) -> bool:
    success = getattr(resp, "success", None)
    if callable(success):
        return bool(success())
    if success is not None:
        return bool(success)
    code = getattr(resp, "code", 0)
    return code in (0, None)


def get_event_handler():
    global EVENT_HANDLER
    if EVENT_HANDLER is None:
        EVENT_HANDLER = (
            lark.EventDispatcherHandler.builder(LARK_ENCRYPT_KEY, LARK_VERIFICATION_TOKEN)
            .register_p2_im_message_receive_v1(on_message)
            .register_p2_im_message_message_read_v1(on_message_read)
            .register_p2_card_action_trigger(on_card_action)
            .build()
        )
    return EVENT_HANDLER


def extract_text_from_lark_payload(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "".join(extract_text_from_lark_payload(item) for item in value)
    if not isinstance(value, dict):
        return ""

    direct = value.get("text") or value.get("un_escape_text") or value.get("content")
    if isinstance(direct, str):
        return direct
    if direct is not None:
        return extract_text_from_lark_payload(direct)

    parts = []
    for key in ("elements", "children"):
        if key in value:
            parts.append(extract_text_from_lark_payload(value.get(key)))
    return "".join(parts)


def parse_text_message(raw_content: str) -> str:
    raw_content = (raw_content or "").strip()
    if not raw_content:
        return ""

    try:
        payload = json.loads(raw_content)
    except json.JSONDecodeError:
        return raw_content.strip('"')

    if isinstance(payload, dict):
        text = extract_text_from_lark_payload(payload).strip()
        if text:
            return text
        return raw_content
    if isinstance(payload, str):
        return payload.strip()
    return raw_content


def strip_bridge_instruction_prefix(content: str) -> str:
    content = str(content or "").strip()
    marker = "用户问题："
    if content.startswith("执行本任务时，如果需要运行 shell 命令") and marker in content:
        return content.split(marker, 1)[1].strip()
    return content


def normalize_text_command(content: str) -> str:
    content = strip_bridge_instruction_prefix(content)
    normalized = re.sub(r"\s+", " ", content).strip()
    aliases = {
        "panel": "/panel",
        "看板": "/panel",
        "projects": "/projects",
        "项目": "/projects",
        "convos": "/convos",
        "对话": "/convos",
        "status": "/status",
        "状态": "/status",
        "daily": "/daily",
        "日报": "/daily",
        "stop": "/stop",
    }
    if normalized in aliases:
        return aliases[normalized]
    for name in ("latest", "project", "conv", "cd", "approve", "reject"):
        prefix = f"{name} "
        if normalized.startswith(prefix):
            return f"/{normalized}"
    return content


def short_text(text: str, limit: int = 120) -> str:
    text = re.sub(r"\s+", " ", str(text or "")).strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


def final_reply_text(text: str, limit: int = FINAL_REPLY_MAX_CHARS) -> str:
    text = str(text or "").strip()
    if not text:
        return ""
    if limit <= 0 or len(text) <= limit:
        return text
    omitted = len(text) - limit
    return text[:limit].rstrip() + f"\n\n...（已截断，剩余 {omitted} 字）"


def project_key(cwd: Optional[Path]) -> str:
    if not cwd:
        return "non_project"
    return hashlib.sha1(str(cwd).encode("utf-8")).hexdigest()[:12]


def project_name(cwd: Optional[Path]) -> str:
    if not cwd:
        return "非项目对话"
    parent = cwd.parent.name
    if parent and parent not in ("", str(Path.home())):
        return f"{cwd.name}"
    return cwd.name or str(cwd)


def extract_text_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts = []
    for item in content:
        if not isinstance(item, dict):
            continue
        text = item.get("text")
        if text:
            parts.append(str(text))
    return "\n".join(parts).strip()


def iter_session_files() -> list[Path]:
    if not CODEX_SESSIONS_DIR.exists():
        return []
    files = list(CODEX_SESSIONS_DIR.glob("**/*.jsonl"))
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return files[:MAX_SESSION_FILES]


def parse_conversation(path: Path) -> Optional[ConversationInfo]:
    info = ConversationInfo(session_id="", file=path, updated_at=path.stat().st_mtime)
    fallback_id = path.stem.split("-")[-1]
    meaningful_users: list[str] = []
    assistant_messages: list[str] = []

    try:
        with path.open("r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue

                typ = obj.get("type")
                payload = obj.get("payload") or {}
                if typ == "session_meta":
                    info.session_id = payload.get("id") or info.session_id
                    info.created_at = payload.get("timestamp") or obj.get("timestamp") or ""
                    info.originator = payload.get("originator", "")
                    info.source = payload.get("source", "")
                    cwd = payload.get("cwd")
                    if cwd:
                        info.cwd = Path(cwd)
                    continue

                if typ == "turn_context":
                    cwd = payload.get("cwd")
                    if cwd and not info.cwd:
                        info.cwd = Path(cwd)
                    continue

                if typ == "event_msg":
                    event_type = payload.get("type")
                    if event_type == "task_complete":
                        info.status = "完成"
                    elif event_type == "task_started":
                        info.status = "运行过"
                    elif event_type == "user_message":
                        text = payload.get("message", "")
                        if text and not text.startswith("<"):
                            meaningful_users.append(text)
                            info.last_user = text
                    elif event_type == "agent_message":
                        text = payload.get("message", "")
                        if text:
                            assistant_messages.append(text)
                            info.last_assistant = text
                    continue

                if typ != "response_item" or not isinstance(payload, dict):
                    continue

                if payload.get("type") != "message":
                    continue
                role = payload.get("role")
                text = extract_text_content(payload.get("content"))
                if not text or text.startswith("<"):
                    continue
                if role == "user":
                    meaningful_users.append(text)
                    info.last_user = text
                elif role == "assistant":
                    assistant_messages.append(text)
                    info.last_assistant = text
    except OSError:
        return None

    if not info.session_id:
        info.session_id = fallback_id
    if meaningful_users:
        info.title = short_text(meaningful_users[0], 70)
        info.turns = len(meaningful_users)
    elif assistant_messages:
        info.title = short_text(assistant_messages[0], 70)
    if info.status == "未知":
        info.status = "有记录"
    return info


def build_index() -> tuple[list[ProjectInfo], dict[str, ConversationInfo]]:
    projects: dict[str, ProjectInfo] = {}
    conversations: dict[str, ConversationInfo] = {}

    for path in iter_session_files():
        conv = parse_conversation(path)
        if not conv:
            continue
        conversations[conv.session_id] = conv
        key = project_key(conv.cwd)
        project = projects.get(key)
        if project is None:
            project = ProjectInfo(key=key, name=project_name(conv.cwd), cwd=conv.cwd)
            projects[key] = project
        project.conversations.append(conv)

    for project in projects.values():
        project.conversations.sort(key=lambda c: c.updated_at, reverse=True)

    ordered = sorted(
        projects.values(),
        key=lambda p: max((c.updated_at for c in p.conversations), default=0),
        reverse=True,
    )
    return ordered, conversations


def find_project(projects: list[ProjectInfo], key: str) -> Optional[ProjectInfo]:
    for project in projects:
        if project.key == key:
            return project
    return None


def current_or_latest_project(chat_id: str) -> Optional[ProjectInfo]:
    runtime = get_runtime(chat_id)
    projects, _ = build_index()
    project = find_project(projects, runtime.active_project_key)
    if project:
        return project
    return projects[0] if projects else None


def is_resumable_conversation(conv: Optional[ConversationInfo]) -> bool:
    if not conv:
        return False
    return conv.originator == "codex_exec" or conv.source == "exec"


def get_active_conversation(session_id: str) -> Optional[ConversationInfo]:
    if not session_id:
        return None
    _, conversations = build_index()
    return conversations.get(session_id)


def conversation_source_label(conv: ConversationInfo) -> str:
    originator_raw = conv.originator or ""
    source_raw = conv.source or ""
    originator = str(originator_raw).lower()
    source = str(source_raw).lower()
    if is_resumable_conversation(conv):
        return "Lark bridge"
    if "desktop" in originator or source in ("vscode", "desktop"):
        return "Codex Desktop"
    return str(originator_raw or source_raw or "未知来源")


def project_for_runtime(chat_id: str) -> ProjectInfo:
    runtime = get_runtime(chat_id)
    projects, _ = build_index()

    project = find_project(projects, runtime.active_project_key)
    if project:
        return project

    runtime_key = project_key(runtime.cwd)
    project = find_project(projects, runtime_key)
    if project:
        return project

    return ProjectInfo(
        key=runtime_key,
        name=project_name(runtime.cwd),
        cwd=runtime.cwd,
        conversations=[],
    )


def format_time(ts: float) -> str:
    if not ts:
        return "-"
    return datetime.fromtimestamp(ts).strftime("%m-%d %H:%M")


def format_duration(seconds: float) -> str:
    seconds = max(0, int(seconds))
    minutes, sec = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours}小时{minutes}分{sec}秒"
    if minutes:
        return f"{minutes}分{sec}秒"
    return f"{sec}秒"


def git_status_entries(cwd: Optional[Path]) -> tuple[bool, list[str], str]:
    if not cwd:
        return False, [], "无项目目录"
    try:
        result = subprocess.run(
            ["git", "-C", str(cwd), "status", "--short"],
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )
    except Exception as e:
        return False, [], f"Git 状态读取失败：{type(e).__name__}: {e}"

    if result.returncode != 0:
        message = (result.stderr or result.stdout or "不是 Git 仓库").strip()
        return False, [], short_text(message, 160)
    entries = [line.rstrip() for line in result.stdout.splitlines() if line.strip()]
    return True, entries, ""


def format_git_summary(cwd: Optional[Path], limit: int = 8) -> list[str]:
    is_repo, entries, error = git_status_entries(cwd)
    if not is_repo:
        return [f"Git：{error}"]
    if not entries:
        return ["Git：工作区干净"]

    lines = [f"Git：{len(entries)} 个未提交变更"]
    for entry in entries[:limit]:
        status = entry[:2].strip() or "?"
        path = entry[3:] if len(entry) > 3 else entry
        lines.append(f"`{status}` {path}")
    if len(entries) > limit:
        lines.append(f"还有 {len(entries) - limit} 个变更未显示")
    return lines


def task_end_text(
    runtime: ChatRuntime,
    cwd: Path,
    code: Optional[int],
    started_at: float,
    emitted_output: bool,
    last_agent_message: str = "",
    detail: str = "",
    user_question: str = "",
) -> str:
    result = "成功" if code == 0 else "失败" if code is not None else "未完成"
    lines = [
        "**Codex 任务结束**",
        "",
        f"**结果**：{result}" + (f"（退出码 `{code}`）" if code not in (None, 0) else ""),
        f"**完成时间**：{datetime.now().strftime('%m-%d %H:%M')}",
        f"**耗时**：{format_duration(time.time() - started_at)}",
        f"**目录**：`{cwd}`",
    ]
    if runtime.active_session_id:
        lines.append(f"**Session**：`{runtime.active_session_id}`")
    if detail:
        lines.append(f"**说明**：{detail}")
    if user_question:
        lines.extend(["", "**用户问题**", "", final_reply_text(user_question, FINAL_QUESTION_MAX_CHARS)])
    if last_agent_message:
        lines.extend(["", "**Codex 具体回复**", "", final_reply_text(last_agent_message)])
    elif not emitted_output:
        lines.extend(["", "**输出**", "", "没有捕获到流式输出；可发送 `/status` 查看当前对话。"])

    lines.extend(["", "**工作区**"])
    lines.extend(format_git_summary(cwd, limit=5))
    lines.extend(["", "可发送 `/status` 查看完整项目状态，或继续发送新问题。"])
    return "\n".join(lines)


def synced_task_complete_text(conv: ConversationInfo, cwd: Path, last_agent_message: str) -> str:
    lines = [
        "**Codex 任务结束**",
        "",
        "**结果**：完成（同步到已选对话）",
        f"**完成时间**：{datetime.now().strftime('%m-%d %H:%M')}",
        f"**目录**：`{cwd}`",
        f"**Session**：`{conv.session_id}`",
        f"**标题**：{short_text(conv.title, 120)}",
    ]
    if conv.last_user:
        lines.extend(["", "**用户问题**", "", final_reply_text(conv.last_user, FINAL_QUESTION_MAX_CHARS)])
    if last_agent_message:
        lines.extend(["", "**Codex 具体回复**", "", final_reply_text(last_agent_message)])
    lines.extend(["", "**工作区**"])
    lines.extend(format_git_summary(cwd, limit=5))
    lines.extend(["", "可发送 `/status` 查看完整项目状态，或继续发送新问题。"])
    return "\n".join(lines)


def project_source_counts(project: ProjectInfo) -> tuple[int, int, int]:
    desktop = 0
    bridge = 0
    other = 0
    for conv in project.conversations:
        label = conversation_source_label(conv)
        if label == "Codex Desktop":
            desktop += 1
        elif label == "Lark bridge":
            bridge += 1
        else:
            other += 1
    return desktop, bridge, other


def pending_approvals_for_chat(chat_id: str) -> list[PendingApproval]:
    return [
        a for a in PENDING_APPROVALS.values()
        if a.chat_id == chat_id and a.status == "pending"
    ]


def pending_approval_status_for_chat(chat_id: str) -> str:
    with LOCK:
        approvals = [
            approval
            for approval in PENDING_APPROVALS.values()
            if approval.chat_id == chat_id
        ]
    if not approvals:
        return ""
    latest = max(approvals, key=lambda a: a.created_at)
    return latest.status


def expire_pending_approvals(chat_id: str):
    with LOCK:
        for approval in PENDING_APPROVALS.values():
            if approval.chat_id == chat_id and approval.status == "pending":
                approval.status = "expired"


def wait_for_pending_approval(chat_id: str, timeout_seconds: int = PENDING_APPROVAL_WAIT_SECONDS) -> str:
    if timeout_seconds <= 0:
        expire_pending_approvals(chat_id)
        save_runtime(chat_id)
        return "timeout"

    deadline = time.time() + timeout_seconds
    while True:
        status = pending_approval_status_for_chat(chat_id)
        if status in ("approved", "rejected", "expired"):
            return status
        if not pending_approvals_for_chat(chat_id):
            return ""
        remaining = deadline - time.time()
        if remaining <= 0:
            expire_pending_approvals(chat_id)
            save_runtime(chat_id)
            return "timeout"
        STOP_SCHEDULER.wait(min(max(1, PENDING_APPROVAL_POLL_SECONDS), remaining))


def project_stage_text(project: ProjectInfo, chat_id: str = "") -> tuple[str, str]:
    runtime = get_runtime(chat_id) if chat_id else None
    runtime_project_key = project_key(runtime.cwd) if runtime else ""
    runtime_matches_project = bool(
        runtime and (runtime.active_project_key == project.key or runtime_project_key == project.key)
    )
    running = bool(
        runtime_matches_project
        and runtime
        and runtime.process is not None
        and runtime.process.poll() is None
    )
    pending = []
    if chat_id:
        pending = [
            approval for approval in pending_approvals_for_chat(chat_id)
            if not project.cwd or approval.cwd == str(project.cwd)
        ]
    is_repo, entries, _ = git_status_entries(project.cwd)
    latest = project.conversations[0] if project.conversations else None

    if pending:
        return "等待审批", f"有 {len(pending)} 个待审批项；可用 /approve <id> 或 /reject <id> 处理。"
    if running:
        return "执行中", "Codex 正在处理当前任务；完成后会主动推送项目状态。"
    if is_repo and entries:
        return "已有本地改动", "项目有未提交变更；建议先查看 /status 中的 Git 列表，再验证或提交。"
    if latest and datetime.fromtimestamp(latest.updated_at).date() == datetime.now().date():
        return "今日已推进", "今天有新的 Codex 记录；可继续发送问题，或用 /convos 切换具体对话。"
    if latest:
        return "可继续推进", "已有历史上下文；可直接发送新问题，系统会在当前项目中启动或续写桥接会话。"
    return "尚未开始", "当前目录还没有可读取的 Codex 会话；直接发消息即可创建 Lark bridge 会话。"


def recent_project_activity_lines(project: ProjectInfo, limit: int = 5) -> list[str]:
    if not project.conversations:
        return ["最近活动：暂无会话记录"]

    lines = ["最近活动："]
    for conv in project.conversations[:limit]:
        summary = conv.last_assistant or conv.last_user or conv.title
        lines.append(
            f"[{conversation_source_label(conv)}] {format_time(conv.updated_at)} · "
            f"{short_text(conv.title, 42)}：{short_text(summary, 120)}"
        )
    return lines


# ===================== Lark 消息和卡片 =====================
def split_message(text: str, limit: int = MESSAGE_CHUNK_SIZE) -> list[str]:
    if len(text) <= limit:
        return [text]

    chunks: list[str] = []
    remaining = text
    while len(remaining) > limit:
        split_at = remaining.rfind("\n", 0, limit)
        if split_at < max(200, limit // 3):
            split_at = limit
        chunks.append(remaining[:split_at].strip())
        remaining = remaining[split_at:].lstrip()
    if remaining:
        chunks.append(remaining)
    return chunks


def normalize_lark_md(content: str) -> str:
    """Convert common Markdown into the subset reliably rendered by Lark cards."""
    lines: list[str] = []
    in_fence = False
    fence_marker = ""

    for line in str(content or "").splitlines():
        stripped = line.lstrip()
        if stripped.startswith(("```", "~~~")):
            marker = stripped[:3]
            if not in_fence:
                in_fence = True
                fence_marker = marker
            elif marker == fence_marker:
                in_fence = False
                fence_marker = ""
            lines.append(line)
            continue

        if not in_fence:
            heading = re.match(r"^(#{1,6})\s+(.+?)\s*#*\s*$", line)
            if heading:
                line = f"**{heading.group(2).strip()}**"

        lines.append(line)

    return "\n".join(lines)


def markdown_message_card(content: str) -> dict[str, Any]:
    return {
        "config": {"wide_screen_mode": True, "enable_forward": True},
        "elements": [
            {
                "tag": "div",
                "text": {"tag": "lark_md", "content": normalize_lark_md(content)},
            }
        ],
    }


def send_msg(chat_id: str, text: str):
    if not is_valid_chat_id(chat_id):
        logger.warning("skip send_msg to invalid chat_id: %s", chat_id)
        return
    runtime = RUNTIMES.get(chat_id)
    if runtime and runtime.send_disabled:
        logger.warning("skip send_msg to disabled chat_id: %s", chat_id)
        return

    text = str(text or "") or "(无输出)"
    chunks = split_message(text)

    for chunk in chunks:
        try:
            with SEND_LOCK:
                body = (
                    CreateMessageRequestBody.builder()
                    .receive_id(chat_id)
                    .msg_type("interactive")
                    .content(json.dumps(markdown_message_card(chunk), ensure_ascii=False))
                    .build()
                )
                req = (
                    CreateMessageRequest.builder()
                    .receive_id_type("chat_id")
                    .request_body(body)
                    .build()
                )
                resp = get_client().im.v1.message.create(req)
            if not response_ok(resp):
                code = getattr(resp, "code", None)
                msg = getattr(resp, "msg", None)
                logger.error(
                    "send_msg failed: code=%s msg=%s",
                    code,
                    msg,
                )
                if str(code) == "230001" or "invalid receive_id" in str(msg):
                    disable_chat_send(chat_id, f"send_msg failed: {code} {msg}")
                    return
        except Exception:
            logger.exception("send_msg exception")


def button(text: str, action: str, value: dict[str, Any], style: str = "default"):
    payload = {"action": action, **value}
    return {
        "tag": "button",
        "text": {"tag": "plain_text", "content": text},
        "type": style,
        "value": payload,
    }


def compact_button(text: str, action: str, value: dict[str, Any], style: str = "default"):
    item = button(text, action, value, style)
    item["size"] = "small"
    return item


def divider():
    return {"tag": "hr"}


def md(content: str):
    return {"tag": "div", "text": {"tag": "lark_md", "content": normalize_lark_md(content)}}


def action_row(actions: list[dict[str, Any]]):
    return {"tag": "action", "actions": actions}


def fields(items: list[tuple[str, str]]):
    return {
        "tag": "column_set",
        "flex_mode": "none",
        "background_style": "grey",
        "columns": [
            {
                "tag": "column",
                "width": "weighted",
                "weight": 1,
                "elements": [md(f"**{label}**\n{value}")],
            }
            for label, value in items
        ],
    }


def note(content: str):
    return {
        "tag": "note",
        "elements": [{"tag": "lark_md", "content": normalize_lark_md(content)}],
    }


def find_message_id(value: Any, depth: int = 0) -> str:
    if value is None or depth > 4:
        return ""
    if isinstance(value, dict):
        found = value.get("message_id")
        if found:
            return str(found)
        for item in value.values():
            found = find_message_id(item, depth + 1)
            if found:
                return found
        return ""
    found = getattr(value, "message_id", None)
    if found:
        return str(found)
    for attr in ("data", "body"):
        nested = getattr(value, attr, None)
        found = find_message_id(nested, depth + 1)
        if found:
            return found
    raw = getattr(value, "__dict__", None)
    if isinstance(raw, dict):
        return find_message_id(raw, depth + 1)
    return ""


def response_message_id(resp) -> str:
    message_id = find_message_id(resp)
    if not message_id:
        logger.warning("send_card succeeded but message_id was not found in response: %s", type(resp).__name__)
    return message_id


def send_card(chat_id: str, card: dict[str, Any]) -> str:
    if not is_valid_chat_id(chat_id):
        logger.warning("skip send_card to invalid chat_id: %s", chat_id)
        return ""
    runtime = RUNTIMES.get(chat_id)
    if runtime and runtime.send_disabled:
        logger.warning("skip send_card to disabled chat_id: %s", chat_id)
        return ""

    try:
        with SEND_LOCK:
            body = (
                CreateMessageRequestBody.builder()
                .receive_id(chat_id)
                .msg_type("interactive")
                .content(json.dumps(card, ensure_ascii=False))
                .build()
            )
            req = (
                CreateMessageRequest.builder()
                .receive_id_type("chat_id")
                .request_body(body)
                .build()
            )
            resp = get_client().im.v1.message.create(req)
        if not response_ok(resp):
            code = getattr(resp, "code", None)
            msg = getattr(resp, "msg", None)
            logger.error(
                "send_card failed: code=%s msg=%s",
                code,
                msg,
            )
            if str(code) == "230001" or "invalid receive_id" in str(msg):
                disable_chat_send(chat_id, f"send_card failed: {code} {msg}")
            return ""
        return response_message_id(resp)
    except Exception:
        logger.exception("send_card exception")
        return ""


def update_card(message_id: str, card: dict[str, Any]) -> bool:
    if not message_id:
        return False
    try:
        with SEND_LOCK:
            body = (
                PatchMessageRequestBody.builder()
                .content(json.dumps(card, ensure_ascii=False))
                .build()
            )
            req = (
                PatchMessageRequest.builder()
                .message_id(message_id)
                .request_body(body)
                .build()
            )
            resp = get_client().im.v1.message.patch(req)
        if not response_ok(resp):
            logger.error(
                "patch_card failed: code=%s msg=%s",
                getattr(resp, "code", None),
                getattr(resp, "msg", None),
            )
            return False
        return True
    except Exception:
        logger.exception("update_card exception")
        return False


def base_card(title: str, elements: list[dict[str, Any]], template: str = "blue"):
    return {
        "config": {"wide_screen_mode": True, "enable_forward": True},
        "header": {
            "template": template,
            "title": {"tag": "plain_text", "content": title},
        },
        "elements": elements,
    }


def build_report_card(
    title: str,
    content: str,
    chat_id: str,
    back_action: str = "task_refresh",
    back_label: str = "返回任务卡",
    template: str = "blue",
) -> dict[str, Any]:
    return base_card(
        title,
        [
            md(content or "无内容"),
            action_row(
                [
                    compact_button(back_label, back_action, {"chat_id": chat_id}, "primary"),
                ]
            ),
        ],
        template,
    )


def build_task_card(chat_id: str, status: str = "", output: str = "", detail: str = "") -> dict[str, Any]:
    runtime = get_runtime(chat_id)
    running = runtime.process is not None and runtime.process.poll() is None
    current_status = status or runtime.task_status or ("运行中" if running else "空闲")
    template = "green" if current_status in ("完成", "成功") else "orange" if "审批" in current_status else "blue"
    pending = pending_approvals_for_chat(chat_id)
    shown_output = output if output else runtime.task_output

    elements: list[dict[str, Any]] = [
        fields(
            [
                ("状态", current_status),
                ("目录", short_text(str(runtime.cwd), 42)),
                ("耗时", format_duration(time.time() - runtime.task_started_at) if runtime.task_started_at else "-"),
            ]
        ),
        md(f"**指令**\n{short_text(runtime.task_prompt, 900) or '无'}"),
    ]
    if runtime.active_session_id:
        elements.append(md(f"**Session**\n`{runtime.active_session_id}`"))
    if detail:
        elements.append(md(f"**说明**\n{detail}"))
    if pending:
        approval = sorted(pending, key=lambda a: a.created_at, reverse=True)[0]
        elements.extend(
            [
                divider(),
                md(
                    f"**待审批**\n"
                    f"审批 ID：`{approval.approval_id}`\n"
                    f"目录：`{approval.cwd}`\n"
                    f"{short_text(approval.command, 1200)}"
                ),
                action_row(
                    [
                        compact_button("批准", "approve", {"chat_id": chat_id, "approval_id": approval.approval_id}, "primary"),
                        compact_button("拒绝", "reject", {"chat_id": chat_id, "approval_id": approval.approval_id}, "danger"),
                    ]
                ),
                note(f"按钮不可用时，发送 /approve {approval.approval_id} 或 /reject {approval.approval_id}。"),
            ]
        )
    if shown_output:
        elements.extend([divider(), md(f"**最新结果**\n{final_reply_text(shown_output, 2600)}")])

    actions = [
        compact_button("刷新", "task_refresh", {"chat_id": chat_id}, "primary"),
        compact_button("状态", "status", {"chat_id": chat_id}),
    ]
    if running:
        actions.append(compact_button("停止", "stop", {"chat_id": chat_id}, "danger"))
    elements.append(action_row(actions))
    return base_card("Codex 指令", elements, template)


def send_task_card(chat_id: str, prompt: str, status: str):
    runtime = get_runtime(chat_id)
    runtime.task_message_id = ""
    runtime.task_prompt = prompt
    runtime.task_status = status
    runtime.task_output = ""
    runtime.task_started_at = time.time()
    runtime.last_task_card_update_at = 0
    message_id = send_card(chat_id, build_task_card(chat_id, status=status))
    if message_id:
        runtime.task_message_id = message_id
        logger.info("task card sent: chat_id=%s message_id=%s", chat_id, message_id)
    else:
        logger.warning("task card sent without message_id: chat_id=%s", chat_id)
    save_runtime(chat_id)


def update_task_card(chat_id: str, status: str = "", output: str = "", detail: str = "", force: bool = False) -> bool:
    runtime = get_runtime(chat_id)
    if status:
        runtime.task_status = status
    if output:
        runtime.task_output = final_reply_text(output, 5000)
    now = time.time()
    if not force and now - runtime.last_task_card_update_at < 2:
        save_runtime(chat_id)
        return bool(runtime.task_message_id)
    runtime.last_task_card_update_at = now
    card = build_task_card(chat_id, status=runtime.task_status, output=runtime.task_output, detail=detail)
    if not runtime.task_message_id:
        logger.warning("skip task card update without message_id: chat_id=%s", chat_id)
        save_runtime(chat_id)
        return False
    updated = update_card(runtime.task_message_id, card)
    if not updated:
        logger.warning(
            "task card update failed; keeping message_id for retry: chat_id=%s message_id=%s",
            chat_id,
            runtime.task_message_id,
        )
    save_runtime(chat_id)
    return updated


def build_dashboard_card(chat_id: str, expanded: bool = False):
    runtime = get_runtime(chat_id)
    projects, _ = build_index()
    total_convs = sum(len(p.conversations) for p in projects)
    running = runtime.process is not None and runtime.process.poll() is None
    latest_project = projects[0] if projects else None

    elements = [
        fields(
            [
                ("项目", str(len(projects))),
                ("对话", str(total_convs)),
                ("状态", "运行中" if running else "空闲"),
            ]
        ),
        md(f"**当前目录**\n`{runtime.cwd}`"),
        md(
            f"**最近项目**\n"
            f"{latest_project.name if latest_project else '暂无'}"
            + (
                f" · {format_time(latest_project.conversations[0].updated_at)}"
                if latest_project and latest_project.conversations
                else ""
            )
        ),
        action_row(
            [
                compact_button("刷新", "dashboard", {"chat_id": chat_id, "expanded": expanded}, "primary"),
                compact_button(
                    "收起项目" if expanded else "展开项目",
                    "dashboard",
                    {"chat_id": chat_id, "expanded": not expanded},
                ),
                compact_button("状态", "status", {"chat_id": chat_id}),
                compact_button("日报", "daily", {"chat_id": chat_id}),
                compact_button("停止", "stop", {"chat_id": chat_id}, "danger"),
            ]
        ),
    ]

    if not expanded:
        elements.extend(
            [
                divider(),
                note(
                    "项目看板已收起。点击“展开项目”，或发送 /projects 展开；"
                    "按钮不可用时可继续用 /project 1、/latest 1。"
                ),
            ]
        )
        return base_card("Codex 看板", elements)

    elements.extend([divider(), md("**项目看板**")])
    if not projects:
        elements.append(md("还没有找到 Codex 历史会话。"))
    for idx, project in enumerate(projects[:MAX_PROJECTS_IN_PANEL], 1):
        active = "（当前）" if project.key == runtime.active_project_key else ""
        latest = format_time(project.conversations[0].updated_at) if project.conversations else "-"
        cwd = str(project.cwd) if project.cwd else "无项目目录"
        desktop_count, bridge_count, other_count = project_source_counts(project)
        stage, _ = project_stage_text(project, chat_id)
        elements.append(
            md(
                f"**{idx}. {project.name}** {active}\n"
                f"阶段 {stage} · 对话 {len(project.conversations)} · 最近 {latest}\n"
                f"Desktop {desktop_count} / Lark bridge {bridge_count} / 其他 {other_count}\n"
                f"`{short_text(cwd, 100)}`"
            )
        )
        elements.append(
            action_row(
                [
                    compact_button("打开项目", "project", {"chat_id": chat_id, "project_key": project.key}, "primary"),
                    compact_button("最新对话", "latest_conversation", {"chat_id": chat_id, "project_key": project.key}),
                ]
            )
        )

    if len(projects) > MAX_PROJECTS_IN_PANEL:
        elements.append(note(f"仅显示最近 {MAX_PROJECTS_IN_PANEL} 个项目；可调 MAX_PROJECTS_IN_PANEL。"))
    elements.append(note("如果按钮提示 200340，说明 Lark 未把 card.action.trigger 投递到长连接；可先用 /project 1 或 /latest 1 操作。"))
    return base_card("Codex 看板", elements)


def build_project_card(chat_id: str, project_key_value: str, expanded: bool = False):
    runtime = get_runtime(chat_id)
    projects, _ = build_index()
    project = find_project(projects, project_key_value)
    if not project:
        return base_card(
            "项目不存在",
            [
                md("该项目可能已经没有可读取的会话记录。"),
                action_row([compact_button("返回看板", "dashboard", {"chat_id": chat_id}, "primary")]),
            ],
            "red",
        )

    runtime.active_project_key = project.key
    if project.cwd:
        runtime.cwd = project.cwd
    save_runtime(chat_id)

    desktop_count, bridge_count, other_count = project_source_counts(project)
    stage, next_step = project_stage_text(project, chat_id)
    elements = [
        fields([("项目", project.name), ("阶段", stage), ("对话", str(len(project.conversations)))]),
        md(f"**目录**\n`{project.cwd or '无项目目录'}`"),
        md(f"**来源**\nDesktop {desktop_count} / Lark bridge {bridge_count} / 其他 {other_count}\n**下一步**\n{next_step}"),
        action_row(
            [
                compact_button("返回看板", "dashboard", {"chat_id": chat_id, "expanded": False}),
                compact_button(
                    "收起对话" if expanded else "展开对话",
                    "project",
                    {"chat_id": chat_id, "project_key": project.key, "expanded": not expanded},
                    "primary",
                ),
                compact_button("项目进展", "daily", {"chat_id": chat_id, "project_key": project.key}, "primary"),
            ]
        ),
    ]

    if not expanded:
        elements.extend(
            [
                divider(),
                note("对话列表已收起。点击“展开对话”，或发送 /convos 展开。"),
            ]
        )
        return base_card(f"{project.name} / 对话", elements, "turquoise")

    elements.extend([divider(), md("**最近对话**")])
    for idx, conv in enumerate(project.conversations[:MAX_CONVERSATIONS_IN_PANEL], 1):
        active = "（当前）" if conv.session_id == runtime.active_session_id else ""
        elements.append(
            md(
                f"**{idx}. {conv.title}** {active}\n"
                f"{conversation_source_label(conv)} · {conv.status} · {conv.turns} 轮 · {format_time(conv.updated_at)}\n"
                f"`{conv.session_id}`"
            )
        )
        elements.append(
            action_row(
                [
                    compact_button("切换", "conversation", {"chat_id": chat_id, "session_id": conv.session_id}, "primary"),
                    compact_button("状态", "conversation_status", {"chat_id": chat_id, "session_id": conv.session_id}),
                ]
            )
        )
    if len(project.conversations) > MAX_CONVERSATIONS_IN_PANEL:
        elements.append(note(f"仅显示最近 {MAX_CONVERSATIONS_IN_PANEL} 个对话；可调 MAX_CONVERSATIONS_IN_PANEL。"))
    return base_card(f"{project.name} / 对话", elements, "turquoise")


def build_conversation_card(chat_id: str, session_id: str):
    runtime = get_runtime(chat_id)
    _, conversations = build_index()
    conv = conversations.get(session_id)
    if not conv:
        return base_card(
            "对话不存在",
            [
                md(f"找不到对话：`{session_id}`"),
                action_row([compact_button("返回看板", "dashboard", {"chat_id": chat_id}, "primary")]),
            ],
            "red",
        )

    runtime.active_session_id = conv.session_id
    runtime.active_project_key = project_key(conv.cwd)
    if conv.cwd:
        runtime.cwd = conv.cwd
    save_runtime(chat_id)

    running = runtime.process is not None and runtime.process.poll() is None
    mode = "可续写" if is_resumable_conversation(conv) else "只读展示"
    elements = [
        fields([("状态", "运行中" if running else conv.status), ("来源", conversation_source_label(conv)), ("模式", mode)]),
        md(f"**标题**\n{conv.title}"),
        md(
            f"**目录**\n`{conv.cwd or runtime.cwd}`\n"
            f"**Session**：`{conv.session_id}`\n"
            f"**来源**：{conv.originator or '-'} / {conv.source or '-'}"
        ),
        action_row(
            [
                compact_button("返回项目", "project", {"chat_id": chat_id, "project_key": project_key(conv.cwd)}),
                compact_button("刷新", "conversation_status", {"chat_id": chat_id, "session_id": conv.session_id}, "primary"),
                compact_button("停止", "stop", {"chat_id": chat_id}, "danger"),
            ]
        ),
        divider(),
        md(f"**最近提问**\n{short_text(conv.last_user, 500) or '无'}"),
        md(f"**最近回复**\n{short_text(conv.last_assistant, 900) or '无'}"),
        md("直接在聊天里发送文字；codex_exec 会话会继续，Codex Desktop 会话会在同目录新建桥接会话。"),
    ]
    return base_card("当前对话", elements, "green")


def send_panel(chat_id: str, expanded: bool = False):
    send_card(chat_id, build_dashboard_card(chat_id, expanded=expanded))


# ===================== Codex 执行和流式输出 =====================
def codex_command(runtime: ChatRuntime, prompt: str, last_message_file: Optional[Path] = None) -> list[str]:
    common = [CODEX_BIN]
    approval_policy = runtime.next_approval_policy or CODEX_APPROVAL_POLICY
    sandbox_mode = runtime.next_sandbox_mode or CODEX_SANDBOX_MODE
    if approval_policy:
        common.extend(["-a", approval_policy])
    if sandbox_mode:
        common.extend(["-s", sandbox_mode])
    common.extend(["exec"])
    if last_message_file:
        common.extend(["--output-last-message", str(last_message_file)])
    conv = get_active_conversation(runtime.active_session_id)
    if is_resumable_conversation(conv):
        return common + ["resume", "--json", "--skip-git-repo-check", runtime.active_session_id, prompt]
    return common + ["--json", "--skip-git-repo-check", "-C", str(runtime.cwd), prompt]


def read_last_message_file(path: Optional[Path]) -> str:
    if not path or not path.exists():
        return ""
    try:
        return path.read_text(encoding="utf-8", errors="ignore").strip()
    except OSError:
        logger.exception("failed to read codex last message file: %s", path)
        return ""


def same_path(left: Optional[Path], right: Optional[Path]) -> bool:
    if not left or not right:
        return False
    try:
        return left.expanduser().resolve() == right.expanduser().resolve()
    except OSError:
        return str(left.expanduser()) == str(right.expanduser())


def find_conversation_for_run(runtime: ChatRuntime, cwd: Path, started_at: float, prompt: str) -> Optional[ConversationInfo]:
    cutoff = started_at - 10
    conv = get_active_conversation(runtime.active_session_id)
    if conv and conv.updated_at >= cutoff:
        return conv

    fallback: Optional[ConversationInfo] = None
    normalized_prompt = prompt.strip()
    for path in iter_session_files():
        try:
            if path.stat().st_mtime < cutoff:
                break
        except OSError:
            continue
        conv = parse_conversation(path)
        if not conv or not same_path(conv.cwd, cwd):
            continue
        if normalized_prompt and conv.last_user.strip() == normalized_prompt:
            return conv
        if fallback is None or conv.updated_at > fallback.updated_at:
            fallback = conv
    return fallback


def latest_panel_conversation(index: int = 0) -> Optional[ConversationInfo]:
    projects, _ = build_index()
    if index < 0 or index >= min(len(projects), MAX_PROJECTS_IN_PANEL):
        return None
    project = projects[index]
    if not project.conversations:
        return None
    return project.conversations[0]


def resolve_task_result(
    chat_id: str,
    runtime: ChatRuntime,
    cwd: Path,
    started_at: float,
    prompt: str,
    last_agent_message: str,
    last_message_file: Optional[Path],
) -> tuple[str, str]:
    file_message = read_last_message_file(last_message_file)
    if file_message:
        last_agent_message = file_message

    user_question = prompt
    if last_agent_message and user_question:
        return last_agent_message, user_question

    for _ in range(5):
        conv = find_conversation_for_run(runtime, cwd, started_at, prompt)
        if conv:
            if conv.session_id and runtime.active_session_id != conv.session_id:
                runtime.active_session_id = conv.session_id
                save_runtime(chat_id)
            user_question = user_question or conv.last_user
            last_agent_message = last_agent_message or conv.last_assistant
            if last_agent_message and user_question:
                break
        time.sleep(0.2)

    if not last_agent_message:
        conv = latest_panel_conversation(0)
        if conv:
            last_agent_message = conv.last_assistant or last_agent_message
            user_question = user_question or conv.last_user
    return last_agent_message, user_question


def parse_codex_json_event(line: str) -> tuple[str, str]:
    raw = line.strip()
    if is_internal_codex_error(raw):
        return ("tool_output", raw) if should_create_approval(raw) else ("skip", "")

    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        return "text", raw

    typ = obj.get("type")
    payload = obj.get("payload") or {}
    if typ == "session_meta":
        return "session_id", payload.get("id", "")

    if typ == "event_msg":
        event_type = payload.get("type", "")
        if event_type == "agent_message":
            return "message", payload.get("message", "")
        if event_type == "task_complete":
            return "complete", payload.get("last_agent_message", "")
        if event_type == "user_message":
            return "skip", ""

    if typ == "response_item":
        item_type = payload.get("type", "")
        if item_type == "message" and payload.get("role") == "assistant":
            return "message", extract_text_content(payload.get("content"))
        if item_type == "reasoning":
            summary = payload.get("summary") or []
            text = extract_text_content(summary)
            return ("progress", f"思考中：{short_text(text, 300)}") if text else ("progress", "思考中…")
        if item_type == "function_call":
            name = payload.get("name", "tool")
            args = short_text(payload.get("arguments", ""), 240)
            return "progress", f"调用工具：{name}\n{args}".strip()
        if item_type == "function_call_output":
            output = payload.get("output", "")
            return "tool_output", f"工具结果：\n{short_text(output, 900)}"

    if typ in ("agent_message", "assistant_message", "message"):
        return "message", obj.get("message") or obj.get("text") or ""
    if typ in ("exec_command_begin", "command_begin", "tool_call"):
        return "progress", short_text(line.strip(), 500)
    if typ in ("exec_command_output", "command_output", "tool_output"):
        return "tool_output", short_text(line.strip(), 900)

    return "skip", ""


def is_internal_codex_error(text: str) -> bool:
    if not text:
        return False
    haystack = text.lower()
    internal_sources = (
        "codex_core::tools::router",
        "codex_core::",
        "createprocess",
    )
    policy_signals = (
        "exec_command failed",
        "blocked by policy",
        "rejected(",
        "rejected:",
    )
    return any(source in haystack for source in internal_sources) and any(
        signal in haystack for signal in policy_signals
    )


def should_create_approval(text: str) -> bool:
    haystack = text.lower()
    signals = [
        "confirmation_required",
        "requires approval",
        "requires your approval",
        "permission required",
        "approval required",
        "requires confirmation",
        "command requires approval",
        "tool requires approval",
        "sandbox_permissions",
        "blocked by policy",
        "rejected(",
        "rejected:",
        "operation not permitted",
        "permission denied",
        "unable to create",
        ".git/index.lock",
    ]
    return any(signal in haystack for signal in signals)


def maybe_create_pending_approval(chat_id: str, runtime: ChatRuntime, text: str) -> bool:
    if not should_create_approval(text):
        return False
    existing_pending = pending_approvals_for_chat(chat_id)
    if existing_pending:
        return True
    fingerprint = hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]
    if runtime.last_approval_fingerprint == fingerprint:
        logger.info("approval fingerprint matched but no pending approval exists; recreating approval: chat_id=%s", chat_id)
    runtime.last_approval_fingerprint = fingerprint
    save_runtime(chat_id)
    create_pending_approval(chat_id, runtime, text)
    return True


def create_pending_approval(chat_id: str, runtime: ChatRuntime, text: str) -> PendingApproval:
    approval_id = hashlib.sha1(f"{chat_id}:{time.time()}:{text}".encode()).hexdigest()[:10]
    approval = PendingApproval(
        approval_id=approval_id,
        chat_id=chat_id,
        session_id=runtime.active_session_id,
        cwd=str(runtime.cwd),
        command=short_text(text, 1000),
        reason="Codex 输出中检测到需要人工批准的内容",
        original_prompt=runtime.task_prompt,
        resume_prompt=(
            "用户已在 Lark 审批通过。请继续执行刚才等待审批的操作；"
            "如果无法自动继续，请给出用户需要在本机执行的准确命令。"
        ),
    )
    with LOCK:
        PENDING_APPROVALS[approval_id] = approval
    updated = update_task_card(
        chat_id,
        status="等待审批",
        output=text,
        detail=f"Codex 请求人工确认。可直接在这张任务卡里批准或拒绝；{format_duration(PENDING_APPROVAL_WAIT_SECONDS)} 内未处理会按 Codex 默认配置继续。",
        force=True,
    )
    if not updated:
        logger.warning("task card approval update failed; sending standalone approval card: chat_id=%s", chat_id)
    send_approval_card(chat_id, approval)
    return approval


def send_approval_card(chat_id: str, approval: PendingApproval):
    card = base_card(
        "Codex 待审批",
        [
            md(
                f"**审批 ID**：`{approval.approval_id}`\n"
                f"**状态**：{approval.status}\n"
                f"**目录**：`{approval.cwd}`\n"
                f"**原因**：{approval.reason}"
            ),
            md(f"**待审批内容**\n{short_text(approval.command, 1200)}"),
            note(
                f"批准后会用 `{APPROVED_CODEX_SANDBOX_MODE}` / `{APPROVED_CODEX_APPROVAL_POLICY}` 单次重试；"
                f"{format_duration(PENDING_APPROVAL_WAIT_SECONDS)} 内未处理会按 Codex 默认配置继续。"
            ),
            action_row(
                [
                    button("批准", "approve", {"chat_id": chat_id, "approval_id": approval.approval_id}, "primary"),
                    button("拒绝", "reject", {"chat_id": chat_id, "approval_id": approval.approval_id}, "danger"),
                ]
            ),
        ],
        "orange",
    )
    message_id = send_card(chat_id, card)
    if message_id:
        logger.info(
            "approval card sent: chat_id=%s approval_id=%s message_id=%s",
            chat_id,
            approval.approval_id,
            message_id,
        )
    else:
        logger.error("approval card send failed: chat_id=%s approval_id=%s", chat_id, approval.approval_id)
    send_msg(
        chat_id,
        f"有 Codex 待审批：{approval.approval_id}\n"
        f"批准：/approve {approval.approval_id}\n"
        f"拒绝：/reject {approval.approval_id}",
    )


def send_stream_update(chat_id: str, buffer: list[str], force: bool = False):
    if not buffer:
        return
    text = "\n".join(buffer).strip()
    if not text:
        return
    if force or len(text) >= 300:
        if not update_task_card(chat_id, status="运行中", output=text, force=force):
            logger.warning("stream task card update failed; skip fallback message: chat_id=%s", chat_id)
        buffer.clear()


def update_existing_task_card(chat_id: str, status: str = "", output: str = "", detail: str = "") -> bool:
    updated = update_task_card(chat_id, status=status, output=output, detail=detail, force=True)
    if not updated:
        logger.warning(
            "task card update failed; skip fallback message to avoid duplicate task panel: chat_id=%s status=%s",
            chat_id,
            status,
        )
    return updated


def run_codex(chat_id: str, prompt: str):
    runtime = get_runtime(chat_id)
    with LOCK:
        if runtime.process is not None and runtime.process.poll() is None:
            text = "已有 Codex 任务在运行，请等待完成或点击/发送 /stop。"
            if not update_task_card(chat_id, status="运行中", detail=text, force=True):
                send_msg(chat_id, text)
            return
        cwd = runtime.cwd

    if not cwd.is_dir():
        text = f"当前目录不存在：{cwd}\n请先用 /cd 切换到有效目录。"
        if not update_task_card(chat_id, status="失败", output=text, force=True):
            send_msg(chat_id, text)
        return

    selected_conv = get_active_conversation(runtime.active_session_id)
    if runtime.active_session_id and not is_resumable_conversation(selected_conv):
        notice = (
            "当前选中的是 Codex Desktop 会话，`codex exec` 不能可靠续写它。\n"
            "我会在同一目录启动一个新的 Lark bridge 会话，并把结果同步到这里。"
        )
        update_task_card(chat_id, status="准备中", detail=notice, force=True)
        runtime.active_session_id = ""
        save_runtime(chat_id)

    last_message_path: Optional[Path] = None
    try:
        fd, name = tempfile.mkstemp(prefix="lark-codex-last-", suffix=".txt", dir="/tmp")
        os.close(fd)
        last_message_path = Path(name)
    except OSError:
        logger.exception("failed to create codex last message file")

    argv = codex_command(runtime, prompt, last_message_path)
    runtime.next_approval_policy = ""
    runtime.next_sandbox_mode = ""
    save_runtime(chat_id)
    logger.info("starting codex: chat_id=%s cwd=%s resume=%s prompt=%r", chat_id, cwd, bool(runtime.active_session_id), short_text(prompt, 120))
    try:
        proc = subprocess.Popen(
            argv,
            cwd=str(cwd),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
    except FileNotFoundError:
        if last_message_path:
            last_message_path.unlink(missing_ok=True)
        text = f"找不到 Codex 命令：{CODEX_BIN}\n请设置 CODEX_BIN 或确认命令在 PATH 中。"
        if not update_task_card(chat_id, status="失败", output=text, force=True):
            send_msg(chat_id, text)
        return
    except Exception as e:
        logger.exception("failed to start codex")
        if last_message_path:
            last_message_path.unlink(missing_ok=True)
        text = f"启动 Codex 失败：{type(e).__name__}: {e}"
        if not update_task_card(chat_id, status="失败", output=text, force=True):
            send_msg(chat_id, text)
        return

    with LOCK:
        runtime.process = proc

    logger.info("codex started: chat_id=%s pid=%s", chat_id, proc.pid)
    update_task_card(chat_id, status="运行中", detail=f"Codex 已开始处理。\n目录：`{cwd}`", force=True)
    buffer: list[str] = []
    last_flush = time.time()
    start = time.time()
    emitted_output = False
    last_agent_message = ""

    try:
        assert proc.stdout is not None
        while True:
            if time.time() - start > CODEX_TIMEOUT_SECONDS:
                proc.kill()
                send_stream_update(chat_id, buffer, force=True)
                last_agent_message, user_question = resolve_task_result(
                    chat_id, runtime, cwd, start, prompt, last_agent_message, last_message_path
                )
                text = task_end_text(
                    runtime,
                    cwd,
                    None,
                    start,
                    emitted_output or bool(last_agent_message),
                    last_agent_message,
                    detail=f"超过 {format_duration(CODEX_TIMEOUT_SECONDS)}，进程已终止。",
                    user_question=user_question,
                )
                update_existing_task_card(chat_id, status="超时", output=text)
                return

            line = proc.stdout.readline()
            if not line:
                if proc.poll() is not None:
                    break
                time.sleep(0.1)
                continue

            kind, text = parse_codex_json_event(line)
            logger.debug("codex event: kind=%s text=%r", kind, short_text(text, 160))
            if kind == "session_id" and text:
                runtime.active_session_id = text
                save_runtime(chat_id)
                continue
            if kind == "skip" or not text:
                continue
            maybe_create_pending_approval(chat_id, runtime, text)
            if kind == "progress":
                buffer.append(text)
            elif kind in ("message", "complete", "text", "tool_output"):
                buffer.append(text)
                if kind in ("message", "complete"):
                    last_agent_message = text
            emitted_output = True

            if kind in ("progress", "tool_output") or time.time() - last_flush >= 2 or len("\n".join(buffer)) >= 500:
                send_stream_update(chat_id, buffer, force=True)
                last_flush = time.time()

        send_stream_update(chat_id, buffer, force=True)
        code = proc.wait(timeout=5)
        last_agent_message, user_question = resolve_task_result(
            chat_id, runtime, cwd, start, prompt, last_agent_message, last_message_path
        )
        emitted_output = emitted_output or bool(last_agent_message)
        logger.info("codex exited: chat_id=%s pid=%s code=%s emitted_output=%s", chat_id, proc.pid, code, emitted_output)
        result_status = "完成" if code == 0 else "失败"
        result_text = task_end_text(runtime, cwd, code, start, emitted_output, last_agent_message, user_question=user_question)
        approval_needed = bool(pending_approvals_for_chat(chat_id))
        if not approval_needed:
            approval_needed = maybe_create_pending_approval(chat_id, runtime, last_agent_message) or maybe_create_pending_approval(chat_id, runtime, result_text)
        if approval_needed:
            logger.info(
                "waiting for Lark approval decision: chat_id=%s timeout_seconds=%s",
                chat_id,
                PENDING_APPROVAL_WAIT_SECONDS,
            )
            decision = wait_for_pending_approval(chat_id)
            logger.info("Lark approval wait finished: chat_id=%s decision=%s", chat_id, decision)
            if decision in ("approved", "rejected"):
                return
        if code == 0:
            update_existing_task_card(chat_id, status=result_status, output=result_text)
            if CODEX_SEND_STATUS_AFTER_TASK:
                send_msg(chat_id, current_status_text(chat_id))
        else:
            update_existing_task_card(chat_id, status=result_status, output=result_text)
    except Exception as e:
        logger.exception("run_codex exception")
        text = f"执行异常：{type(e).__name__}: {e}"
        update_existing_task_card(chat_id, status="异常", output=text)
    finally:
        with LOCK:
            if runtime.process is proc:
                runtime.process = None
        if last_message_path:
            last_message_path.unlink(missing_ok=True)
        save_runtime(chat_id)


def stop_codex(chat_id: str):
    runtime = get_runtime(chat_id)
    with LOCK:
        proc = runtime.process
    if proc is None or proc.poll() is not None:
        text = "当前没有正在运行的任务。"
        if not update_task_card(chat_id, status=runtime.task_status or "空闲", detail=text, force=True):
            send_msg(chat_id, text)
        return

    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)
    if not update_task_card(chat_id, status="已停止", detail="已停止当前 Codex 任务。", force=True):
        send_msg(chat_id, "已停止当前 Codex 任务。")


def approve_pending(chat_id: str, approval_id: str, approved: bool, notify: bool = True):
    approval = PENDING_APPROVALS.get(approval_id)
    if not approval:
        text = f"找不到审批：{approval_id}"
        if notify or not update_task_card(chat_id, detail=text, force=True):
            send_msg(chat_id, text)
        return
    if approval.status != "pending":
        text = f"审批 {approval_id} 已处理：{approval.status}"
        if notify or not update_task_card(chat_id, detail=text, force=True):
            send_msg(chat_id, text)
        return

    approval.status = "approved" if approved else "rejected"
    status_text = f"审批 {approval_id} 已{'批准' if approved else '拒绝'}。"
    if not update_task_card(chat_id, status="已批准" if approved else "已拒绝", detail=status_text, force=True) and notify:
        send_msg(chat_id, status_text)

    if not approved:
        return

    runtime = get_runtime(chat_id)
    if approval.session_id:
        runtime.active_session_id = approval.session_id
    prompt = approval.original_prompt.strip() or runtime.task_prompt.strip() or approval.resume_prompt
    prompt = (
        f"{prompt}\n\n"
        f"审批结果：用户已在 Lark 批准审批 {approval_id}。"
        "请继续执行原始任务，必要时重试刚才因权限、审批或 sandbox 限制失败的操作。"
    )
    runtime.task_prompt = prompt
    runtime.task_status = "已批准，继续执行"
    runtime.next_approval_policy = APPROVED_CODEX_APPROVAL_POLICY
    runtime.next_sandbox_mode = APPROVED_CODEX_SANDBOX_MODE
    update_task_card(chat_id, status="已批准，继续执行", force=True)
    threading.Thread(target=run_codex, args=(chat_id, prompt), daemon=True).start()


# ===================== 状态和日报 =====================
def current_status_text(chat_id: str) -> str:
    runtime = get_runtime(chat_id)
    _, conversations = build_index()
    conv = conversations.get(runtime.active_session_id)
    project = project_for_runtime(chat_id)
    running = runtime.process is not None and runtime.process.poll() is None
    desktop_count, bridge_count, other_count = project_source_counts(project)
    stage, next_step = project_stage_text(project, chat_id)
    lines = [
        "**当前项目状态**",
        "",
        f"**状态**：{'运行中' if running else '空闲'}",
        f"**项目**：{project.name}",
        f"**阶段**：{stage}",
        f"**目录**：`{runtime.cwd}`",
        f"**对话**：{len(project.conversations)} 条（Desktop {desktop_count} / Lark bridge {bridge_count} / 其他 {other_count}）",
    ]
    if conv:
        lines.extend(
            [
                "",
                "**当前选中对话**",
                f"**标题**：{conv.title}",
                f"**Session**：`{conv.session_id}`",
                f"**来源**：{conversation_source_label(conv)}",
                f"**最近提问**：{short_text(conv.last_user, 180)}",
                f"**最近回复**：{short_text(conv.last_assistant, 260)}",
            ]
        )
    else:
        lines.extend(["", "**当前选中对话**", "", "当前未选择历史对话。"])
    pending = pending_approvals_for_chat(chat_id)
    if pending:
        lines.extend(["", f"**待审批**：{len(pending)} 个"])
        for approval in pending[:3]:
            lines.append(f"`{approval.approval_id}`：{short_text(approval.command, 120)}")

    lines.extend(["", "**最近活动**"])
    activity = recent_project_activity_lines(project, 5)
    lines.extend(activity[1:] if activity and activity[0] == "最近活动：" else activity)
    lines.extend(["", "**工作区**", *format_git_summary(project.cwd)])
    lines.extend(["", f"**下一步**：{next_step}"])
    return "\n".join(lines)


def project_progress_text(project_key_value: str = "", chat_id: str = "") -> str:
    projects, _ = build_index()
    selected = [p for p in projects if not project_key_value or p.key == project_key_value]
    if not selected and chat_id:
        selected = [project_for_runtime(chat_id)]
    if not selected:
        return "没有找到项目进展。"

    lines = ["**项目进展日报**"]
    for project in selected[:10]:
        stage, next_step = project_stage_text(project, chat_id)
        desktop_count, bridge_count, other_count = project_source_counts(project)
        today = datetime.now().date()
        today_convs = [
            c for c in project.conversations
            if datetime.fromtimestamp(c.updated_at).date() == today
        ]
        source = today_convs or project.conversations[:3]
        lines.append("")
        lines.append(f"### {project.name}")
        lines.append(f"**目录**：`{project.cwd or '无项目目录'}`")
        lines.append(f"**阶段**：{stage}")
        lines.append(
            f"**今日活跃对话**：{len(today_convs)} / **总对话**：{len(project.conversations)} "
            f"（Desktop {desktop_count} / Lark bridge {bridge_count} / 其他 {other_count}）"
        )
        for conv in source[:3]:
            lines.append(
                f"[{conversation_source_label(conv)}] {conv.title}："
                f"{short_text(conv.last_assistant or conv.last_user, 140)}"
            )
        lines.extend(format_git_summary(project.cwd, limit=5))
        lines.append(f"**下一步**：{next_step}")
    return "\n".join(lines)


def parse_session_sync_event(line: str) -> tuple[str, str]:
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        return "skip", ""
    if obj.get("type") == "event_msg":
        payload = obj.get("payload") or {}
        event_type = payload.get("type", "")
        if event_type == "user_message":
            return "user", payload.get("message", "")
        if event_type == "agent_message":
            return "agent", payload.get("message", "")
        if event_type == "task_complete":
            return "complete", payload.get("last_agent_message", "")
    if obj.get("type") == "response_item":
        payload = obj.get("payload") or {}
        if payload.get("type") == "message" and payload.get("role") == "assistant":
            return "agent", extract_text_content(payload.get("content"))
    return "skip", ""


def session_watcher_loop():
    while not STOP_SCHEDULER.is_set():
        try:
            if not SYNC_DESKTOP_SESSIONS:
                STOP_SCHEDULER.wait(SESSION_WATCH_INTERVAL_SECONDS)
                continue
            with LOCK:
                items = [
                    (chat_id, runtime.active_session_id, runtime.cwd)
                    for chat_id, runtime in RUNTIMES.items()
                ]
            for chat_id, session_id, runtime_cwd in items:
                if not is_valid_chat_id(chat_id) or not session_id:
                    continue
                conv = get_active_conversation(session_id)
                if not conv or is_resumable_conversation(conv):
                    continue
                key = (chat_id, session_id)
                try:
                    size = conv.file.stat().st_size
                except OSError:
                    continue
                if key not in SESSION_WATCH_OFFSETS:
                    SESSION_WATCH_OFFSETS[key] = size
                    continue
                offset = SESSION_WATCH_OFFSETS[key]
                if size <= offset:
                    continue
                with conv.file.open("r", encoding="utf-8", errors="ignore") as f:
                    f.seek(offset)
                    lines = f.readlines()
                    SESSION_WATCH_OFFSETS[key] = f.tell()
                for line in lines:
                    kind, text = parse_session_sync_event(line)
                    text = short_text(text, 1200)
                    if not text or kind == "skip":
                        continue
                    fingerprint = hashlib.sha1(f"{chat_id}:{session_id}:{kind}:{text}".encode("utf-8")).hexdigest()
                    if fingerprint in SESSION_SYNC_SEEN:
                        continue
                    SESSION_SYNC_SEEN.add(fingerprint)
                    if len(SESSION_SYNC_SEEN) > 2000:
                        SESSION_SYNC_SEEN.clear()
                    if kind == "user":
                        send_msg(chat_id, f"Codex 新消息：\n{text}")
                    elif kind == "agent":
                        send_msg(chat_id, f"Codex 进展：\n{text}")
                    elif kind == "complete":
                        send_msg(chat_id, synced_task_complete_text(conv, conv.cwd or runtime_cwd, text))
        except Exception:
            logger.exception("session watcher failed")
        STOP_SCHEDULER.wait(SESSION_WATCH_INTERVAL_SECONDS)


def should_auto_refresh_task_card(runtime: ChatRuntime, now: float) -> bool:
    if TASK_CARD_REFRESH_INTERVAL_SECONDS <= 0:
        return False
    if not runtime.task_message_id or runtime.send_disabled:
        return False

    running = runtime.process is not None and runtime.process.poll() is None
    pending_statuses = {"等待启动", "准备中", "等待审批", "已批准，继续执行"}
    waiting = runtime.task_status in pending_statuses or "审批" in runtime.task_status
    if not running and not waiting:
        return False

    return now - runtime.last_task_card_update_at >= TASK_CARD_REFRESH_INTERVAL_SECONDS


def scheduler_wait_seconds() -> int:
    intervals = [60]
    if TASK_CARD_REFRESH_INTERVAL_SECONDS > 0:
        intervals.append(TASK_CARD_REFRESH_INTERVAL_SECONDS)
    return max(1, min(intervals))


def scheduler_loop():
    while not STOP_SCHEDULER.is_set():
        try:
            now = time.time()
            now_dt = datetime.now()
            hhmm = now_dt.strftime("%H:%M")
            today = now_dt.date().isoformat()

            with LOCK:
                chat_ids = list(RUNTIMES.keys())

            for chat_id in chat_ids:
                runtime = get_runtime(chat_id)
                if runtime.send_disabled or not is_valid_chat_id(chat_id):
                    continue
                if should_auto_refresh_task_card(runtime, now):
                    update_task_card(chat_id, force=True)

                if STATUS_INTERVAL_SECONDS > 0 and now - runtime.last_status_sent_at >= STATUS_INTERVAL_SECONDS:
                    send_msg(chat_id, current_status_text(chat_id))
                    runtime.last_status_sent_at = now
                    save_runtime(chat_id)

                if hhmm >= DAILY_REPORT_TIME and runtime.last_daily_sent_date != today:
                    send_msg(chat_id, project_progress_text(runtime.active_project_key, chat_id))
                    runtime.last_daily_sent_date = today
                    save_runtime(chat_id)
        except Exception:
            logger.exception("scheduler loop failed")
        STOP_SCHEDULER.wait(scheduler_wait_seconds())


# ===================== 指令和卡片操作 =====================
def handle_cd(chat_id: str, path_text: str):
    if not path_text:
        send_msg(chat_id, "用法：/cd <目录>")
        return

    runtime = get_runtime(chat_id)
    path = Path(path_text).expanduser()
    if not path.is_absolute():
        path = runtime.cwd / path
    try:
        path = path.resolve()
    except OSError as e:
        send_msg(chat_id, f"目录解析失败：{e}")
        return

    if not path.exists():
        send_msg(chat_id, f"目录不存在：{path}")
        return
    if not path.is_dir():
        send_msg(chat_id, f"不是目录：{path}")
        return

    runtime.cwd = path
    runtime.active_project_key = project_key(path)
    save_runtime(chat_id)
    send_msg(chat_id, f"已切换目录：{path}")


def send_help(chat_id: str):
    send_msg(
        chat_id,
        "\n".join(
            [
                "可用指令：",
                "/panel 打开 Codex 看板（默认收起项目列表）",
                "/projects 打开项目面板（默认收起列表）",
                "/projects 展开 展开项目列表",
                "/convos 打开当前项目对话面板（默认收起列表）",
                "/convos 展开 展开当前项目对话列表",
                "/status 查看当前项目状态",
                "/daily 输出项目进展日报",
                "/cd <目录> 切换工作目录",
                "/project <编号> 打开面板中的项目",
                "/latest <编号> 打开面板中项目的最新对话",
                "/conv <session_id> 切换对话",
                "/approve <id> 批准待审批",
                "/reject <id> 拒绝待审批",
                "/stop 停止当前任务",
                "其他文本会继续当前对话；未选对话时会在当前项目中新建对话。",
            ]
        ),
    )


def select_conversation(chat_id: str, session_id: str):
    send_card(chat_id, build_conversation_card(chat_id, session_id))


def open_project_by_number(chat_id: str, number_text: str):
    try:
        index = int(number_text.strip()) - 1
    except ValueError:
        send_msg(chat_id, "用法：/project <编号>，例如 /project 1")
        return

    projects, _ = build_index()
    if index < 0 or index >= min(len(projects), MAX_PROJECTS_IN_PANEL):
        send_msg(chat_id, f"项目编号超出范围。当前面板显示 1-{min(len(projects), MAX_PROJECTS_IN_PANEL)}。")
        return
    send_card(chat_id, build_project_card(chat_id, projects[index].key, expanded=False))


def open_latest_by_number(chat_id: str, number_text: str):
    try:
        index = int(number_text.strip()) - 1
    except ValueError:
        send_msg(chat_id, "用法：/latest <项目编号>，例如 /latest 1")
        return

    projects, _ = build_index()
    if index < 0 or index >= min(len(projects), MAX_PROJECTS_IN_PANEL):
        send_msg(chat_id, f"项目编号超出范围。当前面板显示 1-{min(len(projects), MAX_PROJECTS_IN_PANEL)}。")
        return
    project = projects[index]
    if not project.conversations:
        send_msg(chat_id, "这个项目没有对话。")
        return
    send_card(chat_id, build_conversation_card(chat_id, project.conversations[0].session_id))


def on_text(chat_id: str, content: str):
    content = normalize_text_command(content)
    content = content.strip()
    if not content:
        return

    pending = [
        a for a in PENDING_APPROVALS.values()
        if a.chat_id == chat_id and a.status == "pending"
    ]
    if pending and not content.startswith("/"):
        latest = sorted(pending, key=lambda a: a.created_at, reverse=True)[0]
        latest.resume_prompt = f"用户在 Lark 对审批 {latest.approval_id} 给出的最终指令：\n{content}"
        send_msg(
            chat_id,
            f"已记录给审批 {latest.approval_id} 的最终指令。\n"
            f"发送 /approve {latest.approval_id} 批准并继续，或 /reject {latest.approval_id} 拒绝。",
        )
        return

    if content in ("/panel", "/看板"):
        send_panel(chat_id, expanded=False)
        return
    if content in ("/panel 展开", "/panel open", "/panel full", "/看板 展开"):
        send_panel(chat_id, expanded=True)
        return
    if content in ("/help", "/帮助"):
        send_help(chat_id)
        return
    if content in ("/projects", "/项目"):
        send_panel(chat_id, expanded=False)
        return
    if content in ("/projects 展开", "/项目 展开"):
        send_panel(chat_id, expanded=True)
        return
    if content in ("/convos", "/对话"):
        project = current_or_latest_project(chat_id)
        if not project:
            send_msg(chat_id, "还没有找到 Codex 项目或对话。")
            return
        send_card(chat_id, build_project_card(chat_id, project.key, expanded=False))
        return
    if content in ("/convos 展开", "/对话 展开"):
        project = current_or_latest_project(chat_id)
        if not project:
            send_msg(chat_id, "还没有找到 Codex 项目或对话。")
            return
        send_card(chat_id, build_project_card(chat_id, project.key, expanded=True))
        return
    if content in ("/status", "/状态"):
        send_msg(chat_id, current_status_text(chat_id))
        return
    if content in ("/daily", "/日报"):
        runtime = get_runtime(chat_id)
        send_msg(chat_id, project_progress_text(runtime.active_project_key, chat_id))
        return
    if content == "/stop":
        stop_codex(chat_id)
        return
    if content.startswith("/cd "):
        handle_cd(chat_id, content[4:].strip())
        return
    if content.startswith("/conv "):
        select_conversation(chat_id, content[6:].strip())
        return
    if content.startswith("/project "):
        open_project_by_number(chat_id, content[9:].strip())
        return
    if content.startswith("/latest "):
        open_latest_by_number(chat_id, content[8:].strip())
        return
    if content.startswith("/approve "):
        approve_pending(chat_id, content[9:].strip(), True, notify=True)
        return
    if content.startswith("/reject "):
        approve_pending(chat_id, content[8:].strip(), False, notify=True)
        return
    if content.startswith("/"):
        send_msg(chat_id, "未知指令。发送 /help 查看可用指令。")
        return

    send_task_card(chat_id, content, "等待启动")
    threading.Thread(target=run_codex, args=(chat_id, content), daemon=True).start()


def action_toast(content: str, typ: str = "success"):
    return P2CardActionTriggerResponse({"toast": {"type": typ, "content": content}})


def action_card(card: dict[str, Any], content: str = "已更新", typ: str = "success"):
    return P2CardActionTriggerResponse(
        {
            "toast": {"type": typ, "content": content},
            "card": {"type": "raw", "data": card},
        }
    )


def normalize_action_value(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            return {}
    return {}


def on_card_action(data):
    action = normalize_action_value(getattr(getattr(data.event, "action", None), "value", None))
    logger.info("card action received: %s", action)
    return handle_card_action(action)


def handle_card_action(action: dict[str, Any]):
    chat_id = action.get("chat_id")
    if not chat_id:
        logger.error("card action missing chat_id: %s", action)
        return action_toast("缺少 chat_id", "error")

    name = action.get("action", "")
    try:
        if name == "dashboard":
            return action_card(build_dashboard_card(chat_id, expanded=bool(action.get("expanded"))))
        elif name == "project":
            return action_card(
                build_project_card(
                    chat_id,
                    action.get("project_key", ""),
                    expanded=bool(action.get("expanded")),
                )
            )
        elif name == "latest_conversation":
            projects, _ = build_index()
            project = find_project(projects, action.get("project_key", ""))
            if project and project.conversations:
                return action_card(build_conversation_card(chat_id, project.conversations[0].session_id))
            return action_toast("这个项目没有对话。", "error")
        elif name in ("conversation", "conversation_status"):
            return action_card(build_conversation_card(chat_id, action.get("session_id", "")))
        elif name == "status":
            return action_card(
                build_report_card(
                    "当前项目状态",
                    current_status_text(chat_id),
                    chat_id,
                    back_action="task_refresh" if get_runtime(chat_id).task_message_id else "dashboard",
                    back_label="返回任务卡" if get_runtime(chat_id).task_message_id else "返回看板",
                )
            )
        elif name == "daily":
            return action_card(
                build_report_card(
                    "项目进展日报",
                    project_progress_text(action.get("project_key", ""), chat_id),
                    chat_id,
                    back_action="dashboard",
                    back_label="返回看板",
                    template="green",
                )
            )
        elif name == "task_refresh":
            return action_card(build_task_card(chat_id), "已刷新")
        elif name == "stop":
            stop_codex(chat_id)
            return action_card(build_task_card(chat_id), "已停止")
        elif name == "approve":
            approve_pending(chat_id, action.get("approval_id", ""), True, notify=False)
            return action_card(build_task_card(chat_id), "已批准")
        elif name == "reject":
            approve_pending(chat_id, action.get("approval_id", ""), False, notify=False)
            return action_card(build_task_card(chat_id), "已拒绝")
        else:
            return action_toast("未知卡片操作。", "error")
    except Exception:
        logger.exception("card action failed")
        return action_toast("卡片操作失败，请看日志。", "error")


def is_duplicate_event(data) -> bool:
    event_id = getattr(getattr(data, "header", None), "event_id", None)
    if not event_id:
        return False

    if not hasattr(is_duplicate_event, "_seen"):
        is_duplicate_event._seen = set()
    seen = is_duplicate_event._seen
    if event_id in seen:
        return True
    seen.add(event_id)
    if len(seen) > 1000:
        seen.clear()
    return False


def is_bot_message(message) -> bool:
    sender = getattr(message, "sender", None)
    return getattr(sender, "sender_type", "") == "app"


def on_message(data: lark.im.v1.P2ImMessageReceiveV1):
    if is_duplicate_event(data):
        return

    msg = data.event.message
    if is_bot_message(msg):
        return

    chat_id = msg.chat_id
    get_runtime(chat_id)
    content = parse_text_message(msg.content)
    if not content:
        logger.warning(
            "message received with empty parsed content: chat_id=%s message_type=%s raw_content=%r",
            chat_id,
            getattr(msg, "message_type", ""),
            getattr(msg, "content", ""),
        )
        return
    logger.info("message received: chat_id=%s content=%r", chat_id, content[:80])
    EVENT_QUEUE.put(("text", (chat_id, content)))


def on_message_read(data):
    logger.debug("ignore message read event: %s", getattr(getattr(data, "header", None), "event_id", ""))


def event_worker_loop():
    while True:
        kind, args = EVENT_QUEUE.get()
        try:
            if kind == "text":
                on_text(*args)
            elif kind == "card_action":
                handle_card_action(*args)
            else:
                logger.warning("unknown queued event kind: %s", kind)
        except Exception:
            logger.exception("event worker failed: kind=%s args=%s", kind, args)
        finally:
            EVENT_QUEUE.task_done()


def validate_config():
    missing = []
    if not APP_ID:
        missing.append("LARK_APP_ID")
    if not APP_SECRET:
        missing.append("LARK_APP_SECRET")
    if missing:
        raise RuntimeError(
            "缺少配置："
            + ", ".join(missing)
            + "\n请在当前目录创建 .env，或先 export 环境变量，例如：\n"
            + "LARK_APP_ID=cli_xxx\n"
            + "LARK_APP_SECRET=xxx\n"
            + "LARK_DOMAIN=https://open.larksuite.com"
        )
    if not DEFAULT_CWD.is_dir():
        raise RuntimeError(f"CODEX_DEFAULT_CWD 不是有效目录：{DEFAULT_CWD}")


def main():
    validate_config()
    load_known_chats()
    threading.Thread(target=event_worker_loop, name="event-worker", daemon=True).start()
    threading.Thread(target=session_watcher_loop, name="session-watcher", daemon=True).start()
    threading.Thread(target=scheduler_loop, name="scheduler", daemon=True).start()

    cli = lark.ws.Client(
        app_id=APP_ID,
        app_secret=APP_SECRET,
        event_handler=get_event_handler(),
        domain=LARK_DOMAIN,
    )

    print("Lark-Codex WebSocket 启动成功")
    print("指令：/panel | /projects | /convos | /status | /daily | /stop | 直接发消息")
    print(f"默认目录：{DEFAULT_CWD}")
    print(f"Codex 会话目录：{CODEX_SESSIONS_DIR}")
    print("Lark 卡片回调：使用 WebSocket 长连接事件 card.action.trigger")
    cli.start()


if __name__ == "__main__":
    main()
