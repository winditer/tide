import atexit
import hashlib
import json
import logging
import os
import queue
import re
import subprocess
import sys
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
CODEX_MODEL = os.getenv("CODEX_MODEL", "")
CODEX_PROJECTS_ROOT_VALUE = os.getenv("CODEX_PROJECTS_ROOT", "")
CODEX_PROJECTS_ROOT = Path(CODEX_PROJECTS_ROOT_VALUE).expanduser() if CODEX_PROJECTS_ROOT_VALUE else DEFAULT_CWD.parent
CODEX_APPROVAL_POLICY = os.getenv("CODEX_APPROVAL_POLICY", "on-request")
CODEX_SANDBOX_MODE = os.getenv("CODEX_SANDBOX_MODE", "workspace-write")
APPROVED_CODEX_APPROVAL_POLICY = os.getenv("APPROVED_CODEX_APPROVAL_POLICY", "never")
APPROVED_CODEX_SANDBOX_MODE = os.getenv("APPROVED_CODEX_SANDBOX_MODE", "danger-full-access")

MESSAGE_CHUNK_SIZE = int(os.getenv("LARK_MESSAGE_CHUNK_SIZE", "1800"))
FINAL_REPLY_MAX_CHARS = int(os.getenv("LARK_FINAL_REPLY_MAX_CHARS", "4000"))
FINAL_QUESTION_MAX_CHARS = int(os.getenv("LARK_FINAL_QUESTION_MAX_CHARS", "1200"))
MAX_PROJECTS_IN_PANEL = int(os.getenv("MAX_PROJECTS_IN_PANEL", "8"))
MAX_CONVERSATIONS_IN_PANEL = int(os.getenv("MAX_CONVERSATIONS_IN_PANEL", "8"))
MAX_SESSION_FILES = int(os.getenv("MAX_SESSION_FILES", "300"))
STATUS_INTERVAL_SECONDS = int(os.getenv("STATUS_INTERVAL_SECONDS", "0"))
TASK_CARD_REFRESH_INTERVAL_SECONDS = int(os.getenv("TASK_CARD_REFRESH_INTERVAL_SECONDS", "15"))
PENDING_APPROVAL_WAIT_SECONDS = int(os.getenv("PENDING_APPROVAL_WAIT_SECONDS", "300"))
PENDING_APPROVAL_POLL_SECONDS = int(os.getenv("PENDING_APPROVAL_POLL_SECONDS", "2"))
PLAN_MAX_PARALLEL = int(os.getenv("PLAN_MAX_PARALLEL", "3"))
PLAN_TASK_OUTPUT_MAX_CHARS = int(os.getenv("PLAN_TASK_OUTPUT_MAX_CHARS", "1200"))
PLAN_USE_WORKTREES = os.getenv("PLAN_USE_WORKTREES", "1") == "1"
PLAN_WORKTREE_ROOT = os.getenv("PLAN_WORKTREE_ROOT", "")
PLAN_TEST_COMMAND = os.getenv("PLAN_TEST_COMMAND", "git diff --check")
PLAN_TEST_TIMEOUT_SECONDS = int(os.getenv("PLAN_TEST_TIMEOUT_SECONDS", "120"))
DAILY_REPORT_TIME = os.getenv("DAILY_REPORT_TIME", "19:00")
STATE_FILE = Path(os.getenv("LARK_CODEX_STATE_FILE", ".lark_codex_state.json"))
LARK_CODEX_SHOW_ARCHIVED = os.getenv("LARK_CODEX_SHOW_ARCHIVED", "0") == "1"
LARK_CODEX_WELCOME_MESSAGE = os.getenv(
    "LARK_CODEX_WELCOME_MESSAGE",
    "I'm Lark Codex, a lightweight agent that helps you use lark to work perfectly with Codex!",
)
SYNC_DESKTOP_SESSIONS = os.getenv("SYNC_DESKTOP_SESSIONS", "1") == "1"
SESSION_WATCH_INTERVAL_SECONDS = int(os.getenv("SESSION_WATCH_INTERVAL_SECONDS", "3"))
KEEP_AWAKE_ON_AC_POWER = os.getenv("KEEP_AWAKE_ON_AC_POWER", "1") == "1"
KEEP_AWAKE_CHECK_INTERVAL_SECONDS = int(os.getenv("KEEP_AWAKE_CHECK_INTERVAL_SECONDS", "60"))
KEEP_AWAKE_DISABLE_SLEEP = os.getenv("KEEP_AWAKE_DISABLE_SLEEP", "0") == "1"
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
    last_user_at: float = 0
    last_assistant: str = ""
    last_assistant_at: float = 0
    status: str = "未知"
    turns: int = 0
    duration_seconds: float = 0
    today_turns: int = 0
    today_duration_seconds: float = 0
    today_failed_count: int = 0
    today_approval_count: int = 0
    today_assistant_messages: list[str] = field(default_factory=list)
    today_activity_count: int = 0
    originator: str = ""
    source: str = ""


@dataclass
class ProjectInfo:
    key: str
    name: str
    cwd: Optional[Path]
    is_project: bool = True
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
    task_model: str = ""
    task_session_id: str = ""
    task_cwd: str = ""
    task_started_at: float = 0
    last_task_card_update_at: float = 0
    last_status_sent_at: float = 0
    last_daily_sent_date: str = ""
    send_disabled: bool = False
    last_approval_fingerprint: str = ""
    next_approval_policy: str = ""
    next_sandbox_mode: str = ""
    next_model: str = ""
    plan_input_mode: bool = False
    active_plan_id: str = ""


@dataclass
class CodexTaskRuntime:
    task_id: str
    chat_id: str
    cwd: Path
    prompt: str
    model: str = ""
    message_id: str = ""
    process: Optional[subprocess.Popen] = None
    status: str = ""
    output: str = ""
    session_id: str = ""
    started_at: float = field(default_factory=time.time)
    last_card_update_at: float = 0
    approval_policy: str = ""
    sandbox_mode: str = ""
    approved_retry: bool = False
    force_ordinary: bool = False
    last_message_path: str = ""


@dataclass
class PendingApproval:
    approval_id: str
    chat_id: str
    task_id: str
    session_id: str
    cwd: str
    command: str
    reason: str
    model: str = ""
    original_prompt: str = ""
    resume_prompt: str = ""
    status: str = "pending"
    created_at: float = field(default_factory=time.time)


@dataclass
class PendingRestart:
    restart_id: str
    chat_id: str
    requester_id: str = ""
    requester_type: str = ""
    message_id: str = ""
    event_id: str = ""
    status: str = "pending"
    created_at: float = field(default_factory=time.time)


@dataclass
class PlanTask:
    task_id: str
    title: str
    prompt: str
    model: str = ""
    status: str = "pending"
    process: Optional[subprocess.Popen] = None
    session_id: str = ""
    output: str = ""
    started_at: float = 0
    finished_at: float = 0
    approved_retry: bool = False
    approval_required: bool = False
    worktree_path: str = ""
    branch_name: str = ""
    base_head: str = ""
    diff_summary: str = ""
    test_summary: str = ""
    commit_message: str = ""
    commit_hash: str = ""


@dataclass
class PlanRuntime:
    plan_id: str
    chat_id: str
    cwd: Path
    tasks: list[PlanTask]
    max_parallel: int = PLAN_MAX_PARALLEL
    message_id: str = ""
    status: str = "pending"
    created_at: float = field(default_factory=time.time)
    last_card_update_at: float = 0
    stop_requested: bool = False


RUNTIMES: dict[str, ChatRuntime] = {}
TASKS: dict[str, CodexTaskRuntime] = {}
PENDING_APPROVALS: dict[str, PendingApproval] = {}
PENDING_RESTARTS: dict[str, PendingRestart] = {}
PLANS: dict[str, PlanRuntime] = {}
LOCK = threading.RLock()
SEND_LOCK = threading.RLock()
PLAN_LOCK = threading.RLock()
SESSION_RUN_LOCKS: dict[str, threading.Lock] = {}
CLIENT = None
EVENT_HANDLER = None
STOP_SCHEDULER = threading.Event()
EVENT_QUEUE: queue.Queue[tuple[str, tuple[Any, ...]]] = queue.Queue()
SESSION_WATCH_OFFSETS: dict[tuple[str, str], int] = {}
SESSION_SYNC_SEEN: set[str] = set()
KEEP_AWAKE_PROCESS: Optional[subprocess.Popen] = None
KEEP_AWAKE_LOCK = threading.RLock()
DISABLE_SLEEP_APPLIED = False


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
            "task_model": runtime.task_model,
            "task_session_id": runtime.task_session_id,
            "task_cwd": runtime.task_cwd,
            "task_started_at": runtime.task_started_at,
            "last_daily_sent_date": runtime.last_daily_sent_date,
            "send_disabled": runtime.send_disabled,
            "last_approval_fingerprint": runtime.last_approval_fingerprint,
            "active_plan_id": runtime.active_plan_id,
        }
        write_state(state)


def load_known_chats():
    state = read_state()
    now = time.time()
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
            task_model=data.get("task_model", ""),
            task_session_id=data.get("task_session_id", ""),
            task_cwd=data.get("task_cwd", ""),
            task_started_at=float(data.get("task_started_at", 0) or 0),
            last_daily_sent_date=data.get("last_daily_sent_date", ""),
            send_disabled=bool(data.get("send_disabled", False)),
            last_approval_fingerprint=data.get("last_approval_fingerprint", ""),
            active_plan_id=data.get("active_plan_id", ""),
        )
        RUNTIMES[chat_id].last_status_sent_at = now


def get_runtime(chat_id: str) -> ChatRuntime:
    with LOCK:
        runtime = RUNTIMES.get(chat_id)
        if runtime is None:
            runtime = ChatRuntime(cwd=DEFAULT_CWD, last_status_sent_at=time.time())
            RUNTIMES[chat_id] = runtime
            save_runtime(chat_id)
        return runtime


def send_startup_welcome():
    message = LARK_CODEX_WELCOME_MESSAGE.strip()
    if not message:
        return
    with LOCK:
        chat_ids = [
            chat_id
            for chat_id, runtime in RUNTIMES.items()
            if is_valid_chat_id(chat_id) and not runtime.send_disabled
        ]
    for chat_id in chat_ids:
        send_msg(chat_id, message)


def session_run_lock(session_id: str) -> Optional[threading.Lock]:
    if not session_id:
        return None
    with LOCK:
        lock = SESSION_RUN_LOCKS.get(session_id)
        if lock is None:
            lock = threading.Lock()
            SESSION_RUN_LOCKS[session_id] = lock
        return lock


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


def is_macos() -> bool:
    return os.uname().sysname == "Darwin"


def is_ac_power_connected() -> bool:
    if not is_macos():
        return False
    try:
        result = subprocess.run(
            ["pmset", "-g", "batt"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except Exception:
        logger.exception("failed to inspect macOS power source")
        return False
    output = f"{result.stdout}\n{result.stderr}".lower()
    return "ac power" in output


def start_caffeinate():
    global KEEP_AWAKE_PROCESS
    if not is_macos():
        return
    with KEEP_AWAKE_LOCK:
        if KEEP_AWAKE_PROCESS and KEEP_AWAKE_PROCESS.poll() is None:
            return
        try:
            KEEP_AWAKE_PROCESS = subprocess.Popen(
                ["caffeinate", "-dimsu", "-w", str(os.getpid())],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            logger.info("caffeinate started: pid=%s", KEEP_AWAKE_PROCESS.pid)
        except FileNotFoundError:
            logger.warning("caffeinate not found; keep-awake is disabled")
        except Exception:
            logger.exception("failed to start caffeinate")


def stop_caffeinate():
    global KEEP_AWAKE_PROCESS
    with KEEP_AWAKE_LOCK:
        proc = KEEP_AWAKE_PROCESS
        KEEP_AWAKE_PROCESS = None
    if not proc or proc.poll() is not None:
        return
    try:
        proc.terminate()
        proc.wait(timeout=5)
        logger.info("caffeinate stopped")
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)
        logger.info("caffeinate killed")
    except Exception:
        logger.exception("failed to stop caffeinate")


def set_disable_sleep(enabled: bool):
    global DISABLE_SLEEP_APPLIED
    if not is_macos() or not KEEP_AWAKE_DISABLE_SLEEP:
        return
    if enabled == DISABLE_SLEEP_APPLIED:
        return
    try:
        result = subprocess.run(
            ["pmset", "-a", "disablesleep", "1" if enabled else "0"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except Exception:
        logger.exception("failed to set macOS disablesleep=%s", enabled)
        return
    if result.returncode == 0:
        DISABLE_SLEEP_APPLIED = enabled
        logger.info("macOS disablesleep set to %s", int(enabled))
    else:
        logger.warning(
            "pmset disablesleep %s failed: %s",
            int(enabled),
            short_text((result.stderr or result.stdout).strip(), 300),
        )


def stop_power_management():
    set_disable_sleep(False)
    stop_caffeinate()


def keep_awake_loop():
    if not KEEP_AWAKE_ON_AC_POWER:
        logger.info("keep-awake disabled by KEEP_AWAKE_ON_AC_POWER=0")
        return
    if not is_macos():
        logger.info("keep-awake is only supported on macOS")
        return

    while not STOP_SCHEDULER.is_set():
        ac_power = is_ac_power_connected()
        if ac_power:
            start_caffeinate()
            set_disable_sleep(True)
        else:
            set_disable_sleep(False)
            stop_caffeinate()
        STOP_SCHEDULER.wait(max(5, KEEP_AWAKE_CHECK_INTERVAL_SECONDS))

    stop_power_management()


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
        "chats": "/chats",
        "普通对话": "/chats",
        "status": "/status",
        "状态": "/status",
        "daily": "/daily",
        "日报": "/daily",
        "stop": "/stop",
    }
    if normalized in aliases:
        return aliases[normalized]
    for name in ("latest", "project", "conv", "cd", "approve", "reject", "mark-project", "mark-chat"):
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


def classification_state() -> dict[str, Any]:
    state = read_state()
    return state.setdefault("classification", {})


def marked_project_paths() -> dict[str, str]:
    data = classification_state().get("project_paths", {})
    return data if isinstance(data, dict) else {}


def marked_ordinary_sessions() -> set[str]:
    data = classification_state().get("ordinary_sessions", [])
    return {str(item) for item in data if item}


def archived_project_paths() -> set[str]:
    data = classification_state().get("archived_project_paths", [])
    return {str(item) for item in data if item}


def archived_sessions() -> set[str]:
    data = classification_state().get("archived_sessions", [])
    return {str(item) for item in data if item}


def update_classification(mutator):
    state = read_state()
    config = state.setdefault("classification", {})
    mutator(config)
    write_state(state)


def normalize_path(path: Path) -> Path:
    try:
        return path.expanduser().resolve()
    except OSError:
        return path.expanduser()


def is_generic_conversation_dir(cwd: Optional[Path]) -> bool:
    if not cwd:
        return True
    path = normalize_path(cwd)
    generic = {
        normalize_path(Path.home()),
        normalize_path(Path.home() / "Documents"),
        normalize_path(Path("/tmp")),
        normalize_path(Path("/private/tmp")),
    }
    return path in generic


def has_project_marker(path: Path) -> bool:
    return any((path / marker).exists() for marker in PROJECT_MARKERS)


def is_project_archived(root: Optional[Path]) -> bool:
    return bool(root) and str(normalize_path(root)) in archived_project_paths()


def is_session_archived(session_id: str) -> bool:
    return session_id in archived_sessions()


def archive_project_path(path: Path):
    path = normalize_path(path)

    def mutate(config: dict[str, Any]):
        archived = set(str(item) for item in config.get("archived_project_paths", []) if item)
        archived.add(str(path))
        config["archived_project_paths"] = sorted(archived)

    update_classification(mutate)


def archive_session_id(session_id: str):
    if not session_id:
        return

    def mutate(config: dict[str, Any]):
        archived = set(str(item) for item in config.get("archived_sessions", []) if item)
        archived.add(session_id)
        config["archived_sessions"] = sorted(archived)

    update_classification(mutate)


def slugify_name(text: str) -> str:
    value = re.sub(r"[^A-Za-z0-9._-]+", "-", str(text or "").strip()).strip("-")
    return value[:80] or f"project-{datetime.now().strftime('%Y%m%d-%H%M%S')}"


def find_project_root(cwd: Optional[Path]) -> Optional[Path]:
    if not cwd:
        return None
    path = normalize_path(cwd)
    marked = marked_project_paths()
    for raw_path in marked:
        marked_path = normalize_path(Path(raw_path))
        if path == marked_path or marked_path in path.parents:
            return marked_path
    if is_generic_conversation_dir(path):
        return None
    current = path
    stop_at = normalize_path(Path.home())
    while True:
        if is_generic_conversation_dir(current):
            break
        if has_project_marker(current):
            return current
        if current == stop_at or current.parent == current:
            break
        current = current.parent
    return None


def conversation_is_project(conv: ConversationInfo) -> bool:
    if conv.session_id in marked_ordinary_sessions():
        return False
    return find_project_root(conv.cwd) is not None


def project_display_name(root: Optional[Path]) -> str:
    if not root:
        return "普通对话"
    name = marked_project_paths().get(str(normalize_path(root)))
    return name or project_name(root)


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


def parse_event_timestamp(value: Any) -> float:
    if value in (None, ""):
        return 0
    if isinstance(value, (int, float)):
        timestamp = float(value)
        return timestamp / 1000 if timestamp > 10_000_000_000 else timestamp
    text = str(value).strip()
    if not text:
        return 0
    try:
        return parse_event_timestamp(float(text))
    except ValueError:
        pass
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0


def event_date(ts: float):
    return datetime.fromtimestamp(ts).date() if ts else None


def event_timestamp(obj: dict[str, Any], payload: dict[str, Any]) -> float:
    for key in ("timestamp", "completed_at", "started_at", "created_at"):
        ts = parse_event_timestamp(payload.get(key))
        if ts:
            return ts
    return parse_event_timestamp(obj.get("timestamp"))


def looks_failed(text: str) -> bool:
    haystack = str(text or "").lower()
    signals = (
        "**结果**：失败",
        "**结果**：未完成",
        "执行异常：",
        "任务失败，退出码",
        "进程已终止",
        "traceback",
        "error:",
        "退出码 1",
    )
    return any(signal.lower() in haystack for signal in signals)


def looks_approval_related(text: str) -> bool:
    value = str(text or "")
    if should_create_approval(value):
        return True
    return any(signal in value for signal in ("**待审批**", "**审批结果**", "审批 ID"))


def iter_session_files(report_date=None) -> list[Path]:
    if not CODEX_SESSIONS_DIR.exists():
        return []
    files = list(CODEX_SESSIONS_DIR.glob("**/*.jsonl"))
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return files[:MAX_SESSION_FILES]


def parse_report_date(value: str = ""):
    text = str(value or "").strip()
    if not text:
        return datetime.now().date()
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        return None


def parse_daily_command(content: str):
    match = re.match(r"^/(?:daily|日报)(?:$|\s*=\s*(\S+)\s*$|\s+(\S+)\s*$)", content.strip(), flags=re.IGNORECASE)
    if not match:
        return None, False
    value = (match.group(1) or match.group(2) or "").strip()
    return parse_report_date(value), True


def parse_conversation(path: Path, report_date=None) -> Optional[ConversationInfo]:
    info = ConversationInfo(session_id="", file=path, updated_at=path.stat().st_mtime)
    fallback_id = path.stem.split("-")[-1]
    meaningful_users: list[str] = []
    assistant_messages: list[str] = []
    report_date = report_date or datetime.now().date()
    today_user_fingerprints: set[str] = set()
    today_failure_fingerprints: set[str] = set()
    today_approval_fingerprints: set[str] = set()

    def record_today_activity(ts: float):
        if event_date(ts) == report_date:
            info.today_activity_count += 1

    def record_today_user(text: str, ts: float):
        if event_date(ts) != report_date:
            return
        key = re.sub(r"\s+", " ", text).strip()
        if not key:
            return
        fingerprint = hashlib.sha1(key.encode("utf-8")).hexdigest()
        if fingerprint in today_user_fingerprints:
            return
        today_user_fingerprints.add(fingerprint)
        info.today_turns += 1

    def record_today_result_signals(text: str, ts: float):
        if event_date(ts) != report_date or not text:
            return
        key = re.sub(r"\s+", " ", text).strip()
        if not key:
            return
        fingerprint = hashlib.sha1(key.encode("utf-8")).hexdigest()
        if looks_failed(text) and fingerprint not in today_failure_fingerprints:
            today_failure_fingerprints.add(fingerprint)
            info.today_failed_count += 1
        if looks_approval_related(text) and fingerprint not in today_approval_fingerprints:
            today_approval_fingerprints.add(fingerprint)
            info.today_approval_count += 1

    try:
        with path.open("r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue

                typ = obj.get("type")
                payload = obj.get("payload") or {}
                ts = event_timestamp(obj, payload)
                is_report_date = event_date(ts) == report_date
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
                    if event_type in ("task_started", "task_complete", "user_message", "agent_message"):
                        record_today_activity(ts)
                    if event_type == "task_complete":
                        info.status = "完成"
                        duration_ms = payload.get("duration_ms")
                        if isinstance(duration_ms, (int, float)):
                            duration = max(0, float(duration_ms) / 1000)
                            info.duration_seconds += duration
                            if is_report_date:
                                info.today_duration_seconds += duration
                        last_message = payload.get("last_agent_message", "")
                        if last_message:
                            info.last_assistant = last_message
                            info.last_assistant_at = ts
                        if is_report_date and last_message:
                            info.today_assistant_messages.append(last_message)
                            record_today_result_signals(last_message, ts)
                    elif event_type == "task_started":
                        info.status = "运行过"
                    elif event_type == "user_message":
                        text = payload.get("message", "")
                        if text and not text.startswith("<"):
                            meaningful_users.append(text)
                            info.last_user = text
                            info.last_user_at = ts
                            record_today_user(text, ts)
                    elif event_type == "agent_message":
                        text = payload.get("message", "")
                        if text:
                            assistant_messages.append(text)
                            info.last_assistant = text
                            info.last_assistant_at = ts
                            if is_report_date and payload.get("phase") != "commentary":
                                info.today_assistant_messages.append(text)
                                record_today_result_signals(text, ts)
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
                    info.last_user_at = ts
                    record_today_activity(ts)
                    record_today_user(text, ts)
                elif role == "assistant":
                    assistant_messages.append(text)
                    info.last_assistant = text
                    info.last_assistant_at = ts
                    record_today_activity(ts)
                    if is_report_date and obj.get("phase") != "commentary":
                        info.today_assistant_messages.append(text)
                        record_today_result_signals(text, ts)
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


def build_index(report_date=None) -> tuple[list[ProjectInfo], dict[str, ConversationInfo]]:
    projects: dict[str, ProjectInfo] = {}
    conversations: dict[str, ConversationInfo] = {}
    metric_date = report_date or datetime.now().date()

    for path in iter_session_files(report_date=report_date):
        conv = parse_conversation(path, report_date=metric_date)
        if not conv:
            continue
        if report_date and conv.today_activity_count <= 0:
            continue
        if not LARK_CODEX_SHOW_ARCHIVED and is_session_archived(conv.session_id):
            continue
        conversations[conv.session_id] = conv
        root = find_project_root(conv.cwd)
        if conv.session_id in marked_ordinary_sessions():
            root = None
        if not LARK_CODEX_SHOW_ARCHIVED and root and is_project_archived(root):
            continue
        if root:
            key = project_key(root)
            name = project_display_name(root)
            cwd = root
            is_project = True
        else:
            key = f"chat:{conv.session_id}"
            name = conv.title or "普通对话"
            cwd = conv.cwd
            is_project = False
        project = projects.get(key)
        if project is None:
            project = ProjectInfo(key=key, name=name, cwd=cwd, is_project=is_project)
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


def project_groups(projects: list[ProjectInfo]) -> list[ProjectInfo]:
    return [project for project in projects if project.is_project]


def ordinary_chat_groups(projects: list[ProjectInfo]) -> list[ProjectInfo]:
    return [project for project in projects if not project.is_project]


def find_project(projects: list[ProjectInfo], key: str) -> Optional[ProjectInfo]:
    for project in projects:
        if project.key == key:
            return project
    return None


def current_or_latest_project(chat_id: str) -> Optional[ProjectInfo]:
    runtime = get_runtime(chat_id)
    projects, _ = build_index()
    project_list = project_groups(projects)
    project = find_project(project_list, runtime.active_project_key)
    if project:
        return project
    return project_list[0] if project_list else None


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

    project = find_project(project_groups(projects), runtime.active_project_key)
    if project:
        return project

    root = find_project_root(runtime.cwd)
    runtime_key = project_key(root or runtime.cwd)
    project = find_project(project_groups(projects), runtime_key)
    if project:
        return project

    return ProjectInfo(
        key=runtime_key,
        name=project_display_name(root or runtime.cwd),
        cwd=root or runtime.cwd,
        is_project=bool(root),
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


def git_command(cwd: Path, args: list[str], timeout: int = 20) -> tuple[int, str]:
    try:
        result = subprocess.run(
            ["git", "-C", str(cwd), *args],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except Exception as e:
        return 1, f"{type(e).__name__}: {e}"
    return result.returncode, (result.stdout + result.stderr).strip()


def git_repo_root(cwd: Path) -> Optional[Path]:
    code, output = git_command(cwd, ["rev-parse", "--show-toplevel"], timeout=5)
    if code != 0 or not output:
        return None
    return Path(output.splitlines()[0]).expanduser().resolve()


def git_head(cwd: Path) -> str:
    code, output = git_command(cwd, ["rev-parse", "HEAD"], timeout=5)
    return output.splitlines()[0] if code == 0 and output else ""


def safe_git_ref_part(text: str) -> str:
    value = re.sub(r"[^A-Za-z0-9._-]+", "-", text).strip("-")
    return value[:80] or "task"


def strip_command_separator(text: str) -> str:
    return re.sub(r"^\s*(?:\+|[:：]|[-–—])\s*", "", text).strip()


def parse_model_prefix(content: str) -> tuple[str, str]:
    match = re.match(r"^/model\s*=\s*(\S+)\s*(.*)$", content, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        match = re.match(r"^/model\s+(\S+)\s*(.*)$", content, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        return "", content
    model = match.group(1).strip()
    rest = strip_command_separator(match.group(2) or "")
    return model, rest


def model_label(model: str = "") -> str:
    return model or CODEX_MODEL or "默认"


def runtime_task_cwd(runtime: ChatRuntime) -> Path:
    return Path(runtime.task_cwd).expanduser() if runtime.task_cwd else runtime.cwd


def plan_task_cwd(plan: PlanRuntime, task: PlanTask) -> Path:
    return Path(task.worktree_path).expanduser() if task.worktree_path else plan.cwd


def plan_worktree_root(repo_root: Path) -> Path:
    if PLAN_WORKTREE_ROOT:
        return Path(PLAN_WORKTREE_ROOT).expanduser().resolve()
    return repo_root / ".lark-codex" / "worktrees"


def prepare_plan_worktree(plan: PlanRuntime, task: PlanTask) -> Path:
    if not PLAN_USE_WORKTREES:
        return plan.cwd

    repo_root = git_repo_root(plan.cwd)
    if not repo_root:
        task.output = "当前目录不是 Git 仓库，已退回到原目录执行；无法启用 worktree 隔离。"
        return plan.cwd

    task.base_head = git_head(repo_root)
    task.branch_name = f"lark-codex/{safe_git_ref_part(plan.plan_id)}-{safe_git_ref_part(task.task_id)}"
    root = plan_worktree_root(repo_root)
    worktree = root / f"{safe_git_ref_part(plan.plan_id)}-{safe_git_ref_part(task.task_id)}"
    if (worktree / ".git").exists():
        task.worktree_path = str(worktree)
        return worktree

    root.mkdir(parents=True, exist_ok=True)
    code, output = git_command(
        repo_root,
        ["worktree", "add", "-b", task.branch_name, str(worktree), "HEAD"],
        timeout=60,
    )
    if code != 0:
        task.output = "创建 Git worktree 失败，子任务未启动。\n" f"{short_text(output, 900)}"
        logger.warning("plan worktree create failed: plan_id=%s task_id=%s output=%s", plan.plan_id, task.task_id, output)
        raise RuntimeError(task.output)

    task.worktree_path = str(worktree)
    return worktree


def has_git_changes(cwd: Path) -> bool:
    is_repo, entries, _ = git_status_entries(cwd)
    return is_repo and bool(entries)


def git_diff_summary(cwd: Path) -> str:
    is_repo, entries, error = git_status_entries(cwd)
    if not is_repo:
        return f"Git：{error}"
    if not entries:
        return "Git：工作区干净"

    code, stat = git_command(cwd, ["diff", "--stat", "HEAD"], timeout=10)
    if code != 0:
        stat = short_text(stat, 1200)
    status_lines = ["**文件状态**", *[f"`{line[:2].strip() or '?'}` {line[3:] if len(line) > 3 else line}" for line in entries[:20]]]
    if len(entries) > 20:
        status_lines.append(f"还有 {len(entries) - 20} 个变更未显示")
    if stat:
        status_lines.extend(["", "**Diff 统计**", stat])
    return "\n".join(status_lines)


def run_plan_test_command(cwd: Path) -> tuple[bool, str]:
    command = PLAN_TEST_COMMAND.strip()
    if not command:
        return True, "未配置测试命令。"
    try:
        result = subprocess.run(
            command,
            cwd=str(cwd),
            shell=True,
            capture_output=True,
            text=True,
            timeout=PLAN_TEST_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return False, f"测试命令超时：`{command}`"
    except Exception as e:
        return False, f"测试命令执行异常：{type(e).__name__}: {e}"
    output = (result.stdout + result.stderr).strip()
    status = "通过" if result.returncode == 0 else f"失败（退出码 {result.returncode}）"
    return result.returncode == 0, f"`{command}`：{status}" + (f"\n{short_text(output, 1200)}" if output else "")


def plan_commit_message(plan: PlanRuntime, task: PlanTask) -> str:
    title = re.sub(r"\s+", " ", task.title).strip()
    return short_text(f"Plan {plan.plan_id} task {task.task_id}: {title}", 120)


def finalize_plan_task_review(plan: PlanRuntime, task: PlanTask, code: int, fallback_output: str):
    cwd = plan_task_cwd(plan, task)
    test_ok, test_summary = run_plan_test_command(cwd)
    task.test_summary = test_summary
    changed = has_git_changes(cwd)
    if changed:
        task.diff_summary = git_diff_summary(cwd)
        task.commit_message = plan_commit_message(plan, task)

    parts = []
    if fallback_output:
        parts.append(final_reply_text(fallback_output, PLAN_TASK_OUTPUT_MAX_CHARS))
    parts.append(f"**测试**\n{test_summary}")
    if changed:
        parts.append(f"**改动摘要**\n{final_reply_text(task.diff_summary, 1600)}")
    if task.worktree_path:
        parts.append(f"**Worktree**\n`{task.worktree_path}`\n**分支**\n`{task.branch_name}`")

    if code != 0:
        task.status = "failed"
        if not fallback_output:
            parts.insert(0, f"任务失败，退出码 {code}。")
    elif not test_ok:
        task.status = "failed"
        parts.insert(0, "任务已结束，但测试未通过，暂不进入提交审批。")
    elif changed:
        task.status = "review"
        parts.append(f"**待提交审批**\n提交信息：`{task.commit_message}`")
    else:
        task.status = "done"
        if not fallback_output:
            parts.insert(0, "任务完成，未检测到代码改动。")

    task.output = "\n\n".join(part for part in parts if part)


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
        f"**模型**：`{model_label(runtime.task_model)}`",
    ]
    if runtime.task_session_id or runtime.active_session_id:
        lines.append(f"**Session**：`{runtime.task_session_id or runtime.active_session_id}`")
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


def pending_approvals_for_chat(chat_id: str, task_id: str = "") -> list[PendingApproval]:
    return [
        a for a in PENDING_APPROVALS.values()
        if a.chat_id == chat_id and a.status == "pending" and (not task_id or a.task_id == task_id)
    ]


def pending_approval_status_for_chat(chat_id: str, task_id: str = "") -> str:
    with LOCK:
        approvals = [
            approval
            for approval in PENDING_APPROVALS.values()
            if approval.chat_id == chat_id and (not task_id or approval.task_id == task_id)
        ]
    if not approvals:
        return ""
    latest = max(approvals, key=lambda a: a.created_at)
    return latest.status


def expire_pending_approvals(chat_id: str, task_id: str = ""):
    with LOCK:
        for approval in PENDING_APPROVALS.values():
            if approval.chat_id == chat_id and approval.status == "pending" and (not task_id or approval.task_id == task_id):
                approval.status = "expired"


def wait_for_pending_approval(chat_id: str, task_id: str = "", timeout_seconds: int = PENDING_APPROVAL_WAIT_SECONDS) -> str:
    if timeout_seconds <= 0:
        expire_pending_approvals(chat_id, task_id)
        save_runtime(chat_id)
        return "timeout"

    deadline = time.time() + timeout_seconds
    while True:
        status = pending_approval_status_for_chat(chat_id, task_id)
        if status in ("approved", "rejected", "expired"):
            return status
        if not pending_approvals_for_chat(chat_id, task_id):
            return ""
        remaining = deadline - time.time()
        if remaining <= 0:
            expire_pending_approvals(chat_id, task_id)
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
        and (
            (runtime.process is not None and runtime.process.poll() is None)
            or any(
                task.chat_id == chat_id
                and task.cwd == project.cwd
                and task.process is not None
                and task.process.poll() is None
                for task in TASKS.values()
            )
        )
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


def pending_restart_for_chat(chat_id: str) -> Optional[PendingRestart]:
    with LOCK:
        pending = [
            item for item in PENDING_RESTARTS.values()
            if item.chat_id == chat_id and item.status == "pending"
        ]
    if not pending:
        return None
    return max(pending, key=lambda item: item.created_at)


def build_restart_confirm_card(restart: PendingRestart) -> dict[str, Any]:
    return base_card(
        "确认重启 Lark-Codex",
        [
            fields(
                [
                    ("状态", "等待确认"),
                    ("审批 ID", restart.restart_id),
                    ("请求人", restart.requester_id or "-"),
                    ("来源类型", restart.requester_type or "-"),
                ]
            ),
            md(
                "收到 `/restart` 请求。重启会中断当前 WebSocket 连接，并让脚本用当前 Python 解释器原地重启。\n\n"
                "请确认这是你主动触发的操作。"
            ),
            action_row(
                [
                    compact_button("确认重启", "restart_confirm", {"chat_id": restart.chat_id, "restart_id": restart.restart_id}, "primary"),
                    compact_button("取消", "restart_cancel", {"chat_id": restart.chat_id, "restart_id": restart.restart_id}, "danger"),
                ]
            ),
        ],
        "orange",
    )


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
    back_value: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    value = {"chat_id": chat_id}
    if back_value:
        value.update(back_value)
    return base_card(
        title,
        [
            md(content or "无内容"),
            action_row(
                [
                    compact_button(back_label, back_action, value, "primary"),
                ]
            ),
        ],
        template,
    )


def generate_task_id(chat_id: str, prompt: str) -> str:
    return hashlib.sha1(f"{chat_id}:{time.time()}:{prompt}".encode("utf-8")).hexdigest()[:10]


def find_task(task_id: str) -> Optional[CodexTaskRuntime]:
    if not task_id:
        return None
    with LOCK:
        return TASKS.get(task_id)


def latest_task_for_chat(chat_id: str) -> Optional[CodexTaskRuntime]:
    with LOCK:
        tasks = [task for task in TASKS.values() if task.chat_id == chat_id]
    if not tasks:
        return None
    return max(tasks, key=lambda task: task.started_at)


def task_card_state(chat_id: str, task_id: str = "") -> tuple[ChatRuntime, Optional[CodexTaskRuntime]]:
    runtime = get_runtime(chat_id)
    task = find_task(task_id) if task_id else latest_task_for_chat(chat_id)
    return runtime, task


def build_task_card(chat_id: str, status: str = "", output: str = "", detail: str = "", task_id: str = "") -> dict[str, Any]:
    runtime, task = task_card_state(chat_id, task_id)
    if task_id and not task:
        return base_card(
            "Codex 指令",
            [
                fields([("状态", "任务不存在"), ("指令 ID", task_id)]),
                md("这条任务运行态已不存在，可能是脚本重启后内存状态被清空。可查看日志或重新发送指令。"),
                action_row([compact_button("状态", "status", {"chat_id": chat_id})]),
            ],
            "orange",
        )
    running = (
        task.process is not None and task.process.poll() is None
        if task
        else runtime.process is not None and runtime.process.poll() is None
    )
    current_status = status or (task.status if task else runtime.task_status) or ("运行中" if running else "空闲")
    template = "green" if current_status in ("完成", "成功") else "orange" if "审批" in current_status else "blue"
    shown_task_id = task.task_id if task else ""
    pending = pending_approvals_for_chat(chat_id, shown_task_id)
    shown_output = output if output else (task.output if task else runtime.task_output)
    task_session_id = task.session_id if task else runtime.task_session_id
    task_cwd = task.cwd if task else runtime_task_cwd(runtime)
    task_model = task.model if task else runtime.task_model
    task_started_at = task.started_at if task else runtime.task_started_at
    task_prompt = task.prompt if task else runtime.task_prompt

    elements: list[dict[str, Any]] = [
        fields(
            [
                ("状态", current_status),
                ("目录", short_text(str(task_cwd), 42)),
                ("模型", model_label(task_model)),
                ("耗时", format_duration(time.time() - task_started_at) if task_started_at else "-"),
            ]
        ),
        md(f"**指令**\n{short_text(task_prompt, 900) or '无'}"),
    ]
    if shown_task_id:
        elements.append(md(f"**指令 ID**\n`{shown_task_id}`"))
    if task_session_id:
        elements.append(md(f"**Session**\n`{task_session_id}`"))
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
                        compact_button("批准", "approve", {"chat_id": chat_id, "approval_id": approval.approval_id, "task_id": shown_task_id}, "primary"),
                        compact_button("拒绝", "reject", {"chat_id": chat_id, "approval_id": approval.approval_id, "task_id": shown_task_id}, "danger"),
                    ]
                ),
                note(
                    f"批准后会用 `{APPROVED_CODEX_SANDBOX_MODE}` / `{APPROVED_CODEX_APPROVAL_POLICY}` 单次重试；"
                    f"{format_duration(PENDING_APPROVAL_WAIT_SECONDS)} 内未处理会按 Codex 默认配置继续。"
                    f"按钮不可用时，发送 /approve {approval.approval_id} 或 /reject {approval.approval_id}。"
                ),
            ]
        )
    if shown_output:
        elements.extend([divider(), md(f"**最新结果**\n{final_reply_text(shown_output, 2600)}")])

    actions = [
        compact_button("刷新", "task_refresh", {"chat_id": chat_id, "task_id": shown_task_id}, "primary"),
        compact_button("状态", "status", {"chat_id": chat_id, "task_id": shown_task_id}),
    ]
    if running:
        actions.append(compact_button("停止", "stop", {"chat_id": chat_id, "task_id": shown_task_id}, "danger"))
    elements.append(action_row(actions))
    return base_card("Codex 指令", elements, template)


def send_task_card(chat_id: str, prompt: str, status: str, model: str = "", force_ordinary: bool = False) -> str:
    runtime = get_runtime(chat_id)
    task_id = generate_task_id(chat_id, prompt)
    task = CodexTaskRuntime(
        task_id=task_id,
        chat_id=chat_id,
        cwd=runtime_task_cwd(runtime),
        prompt=prompt,
        model=model,
        status=status,
        session_id=runtime.active_session_id,
        approval_policy=runtime.next_approval_policy,
        sandbox_mode=runtime.next_sandbox_mode,
        force_ordinary=force_ordinary,
    )
    with LOCK:
        TASKS[task_id] = task
    runtime.task_prompt = prompt
    runtime.task_model = model
    runtime.task_session_id = task.session_id
    runtime.task_cwd = str(task.cwd)
    runtime.task_status = status
    runtime.task_output = ""
    runtime.task_started_at = task.started_at
    runtime.last_task_card_update_at = 0
    message_id = send_card(chat_id, build_task_card(chat_id, status=status, task_id=task_id))
    if message_id:
        task.message_id = message_id
        runtime.task_message_id = message_id
        logger.info("task card sent: chat_id=%s task_id=%s message_id=%s", chat_id, task_id, message_id)
    else:
        logger.warning("task card sent without message_id: chat_id=%s task_id=%s", chat_id, task_id)
    save_runtime(chat_id)
    return task_id


def update_task_card(chat_id: str, status: str = "", output: str = "", detail: str = "", force: bool = False, task_id: str = "") -> bool:
    runtime, task = task_card_state(chat_id, task_id)
    if task_id and not task:
        logger.warning("skip task card update because task_id is unknown: chat_id=%s task_id=%s", chat_id, task_id)
        return False
    if status:
        if task:
            task.status = status
        runtime.task_status = status
    if output:
        output_text = final_reply_text(output, 5000)
        if task:
            task.output = output_text
        runtime.task_output = output_text
    elif force and task:
        refresh_task_latest_reply(chat_id, task)
    now = time.time()
    last_update = task.last_card_update_at if task else runtime.last_task_card_update_at
    message_id = task.message_id if task else runtime.task_message_id
    if not force and now - last_update < 2:
        save_runtime(chat_id)
        return bool(message_id)
    if task:
        task.last_card_update_at = now
    runtime.last_task_card_update_at = now
    card = build_task_card(
        chat_id,
        status=(task.status if task else runtime.task_status),
        output=(task.output if task else runtime.task_output),
        detail=detail,
        task_id=(task.task_id if task else task_id),
    )
    if not message_id:
        logger.warning("skip task card update without message_id: chat_id=%s task_id=%s", chat_id, task_id)
        save_runtime(chat_id)
        return False
    updated = update_card(message_id, card)
    if not updated:
        logger.warning(
            "task card update failed; keeping message_id for retry: chat_id=%s task_id=%s message_id=%s",
            chat_id,
            task_id,
            message_id,
        )
    save_runtime(chat_id)
    return updated


def parse_plan_tasks(content: str) -> list[str]:
    text = re.sub(r"^/plan\b", "", content.strip(), flags=re.IGNORECASE).strip()

    def clean_plan_item(item: str) -> str:
        item = item.strip()
        item = re.sub(r"^[-*]\s+\[[ xX]\]\s+", "", item)
        item = re.sub(r"^[-*]\s+", "", item)
        item = re.sub(r"^\d+[\.)、]\s+", "", item)
        return item.strip()

    numbered_markers = list(re.finditer(r"\d+[\.)、]\s+", text))
    if len(numbered_markers) > 1 and numbered_markers[0].start() == 0:
        tasks = []
        for index, marker in enumerate(numbered_markers):
            start = marker.start()
            end = numbered_markers[index + 1].start() if index + 1 < len(numbered_markers) else len(text)
            item = clean_plan_item(text[start:end])
            if item:
                tasks.append(item)
        if tasks:
            return tasks

    tasks: list[str] = []
    for line in text.splitlines():
        item = clean_plan_item(line)
        if item:
            tasks.append(item)
    if not tasks and text:
        tasks.append(text)
    return tasks


def plan_task_from_text(index: int, task: str, default_model: str = "") -> PlanTask:
    model, prompt = parse_model_prefix(task)
    prompt = prompt or task
    return PlanTask(
        task_id=str(index),
        title=prompt,
        prompt=prompt,
        model=model or default_model,
    )


def plan_summary(plan: PlanRuntime) -> tuple[int, int, int, int, int, int]:
    pending = sum(1 for task in plan.tasks if task.status == "pending")
    running = sum(1 for task in plan.tasks if task.status == "running")
    done = sum(1 for task in plan.tasks if task.status in ("done", "committed"))
    failed = sum(1 for task in plan.tasks if task.status == "failed")
    waiting = sum(1 for task in plan.tasks if task.status == "approval")
    review = sum(1 for task in plan.tasks if task.status == "review")
    return pending, running, done, failed, waiting, review


def plan_status_text(plan: PlanRuntime) -> str:
    if plan.stop_requested:
        return "停止中"
    pending, running, done, failed, waiting, review = plan_summary(plan)
    if running:
        return "运行中"
    if waiting:
        return "等待审批"
    if review:
        return "等待提交"
    if pending:
        return "排队中"
    if failed:
        return "部分失败" if done else "失败"
    return "完成"


def build_plan_card(plan: PlanRuntime) -> dict[str, Any]:
    pending, running, done, failed, waiting, review = plan_summary(plan)
    plan.status = plan_status_text(plan)
    template = "green" if plan.status == "完成" else "orange" if waiting or review or failed else "blue"
    elements: list[dict[str, Any]] = [
        fields(
            [
                ("状态", plan.status),
                ("并发", f"{running}/{plan.max_parallel}"),
                ("进度", f"{done}/{len(plan.tasks)}"),
            ]
        ),
        md(
            f"**目录**\n`{plan.cwd}`\n"
            f"**Plan**：`{plan.plan_id}`\n"
            f"**排队/失败/审批/待提交**：{pending} / {failed} / {waiting} / {review}"
        ),
    ]
    for task in plan.tasks[:12]:
        elapsed = format_duration((task.finished_at or time.time()) - task.started_at) if task.started_at else "-"
        line = (
            f"**{task.task_id}. {short_text(task.title, 80)}**\n"
            f"状态：{task.status} · 耗时：{elapsed}"
        )
        if task.session_id:
            line += f" · Session：`{task.session_id}`"
        if task.model or CODEX_MODEL:
            line += f"\n模型：`{model_label(task.model)}`"
        if task.worktree_path:
            line += f"\nWorktree：`{short_text(task.worktree_path, 120)}`"
        if task.commit_hash:
            line += f"\nCommit：`{task.commit_hash}`"
        if task.output:
            line += f"\n{final_reply_text(task.output, PLAN_TASK_OUTPUT_MAX_CHARS)}"
        elements.append(divider())
        elements.append(md(line))
        if task.status == "approval":
            elements.append(
                action_row(
                    [
                        compact_button("批准", "plan_approve", {"chat_id": plan.chat_id, "plan_id": plan.plan_id, "task_id": task.task_id}, "primary"),
                        compact_button("拒绝", "plan_reject", {"chat_id": plan.chat_id, "plan_id": plan.plan_id, "task_id": task.task_id}, "danger"),
                    ]
                )
            )
        if task.status == "review":
            elements.append(
                action_row(
                    [
                        compact_button("查看 Diff", "plan_diff", {"chat_id": plan.chat_id, "plan_id": plan.plan_id, "task_id": task.task_id}),
                        compact_button("批准提交", "plan_commit", {"chat_id": plan.chat_id, "plan_id": plan.plan_id, "task_id": task.task_id}, "primary"),
                        compact_button("跳过提交", "plan_skip_commit", {"chat_id": plan.chat_id, "plan_id": plan.plan_id, "task_id": task.task_id}, "danger"),
                    ]
                )
            )
    if len(plan.tasks) > 12:
        elements.append(note(f"还有 {len(plan.tasks) - 12} 个子任务未显示。"))
    actions = [
        compact_button("刷新", "plan_refresh", {"chat_id": plan.chat_id, "plan_id": plan.plan_id}, "primary"),
    ]
    if plan.status in ("运行中", "排队中", "等待审批", "停止中"):
        actions.append(compact_button("停止全部", "plan_stop", {"chat_id": plan.chat_id, "plan_id": plan.plan_id}, "danger"))
    elements.append(action_row(actions))
    return base_card("Codex Plan", elements, template)


def send_plan_card(plan: PlanRuntime):
    message_id = send_card(plan.chat_id, build_plan_card(plan))
    if message_id:
        plan.message_id = message_id
        logger.info("plan card sent: chat_id=%s plan_id=%s message_id=%s", plan.chat_id, plan.plan_id, message_id)


def update_plan_card(plan: PlanRuntime, force: bool = False) -> bool:
    now = time.time()
    if not force and now - plan.last_card_update_at < 2:
        return bool(plan.message_id)
    plan.last_card_update_at = now
    if not plan.message_id:
        send_plan_card(plan)
        return bool(plan.message_id)
    return update_card(plan.message_id, build_plan_card(plan))


def build_dashboard_card(chat_id: str, expanded: bool = False):
    runtime = get_runtime(chat_id)
    all_groups, _ = build_index()
    projects = project_groups(all_groups)
    chats = ordinary_chat_groups(all_groups)
    total_convs = sum(len(p.conversations) for p in projects)
    running = runtime.process is not None and runtime.process.poll() is None
    latest_project = projects[0] if projects else None

    elements = [
        fields(
            [
                ("项目", str(len(projects))),
                ("普通对话", str(len(chats))),
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
                compact_button("普通对话", "chats", {"chat_id": chat_id}),
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
        elements.append(md("还没有识别到项目会话。普通对话可发送 /chats 查看。"))
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
    projects = project_groups(projects)
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


def build_chats_card(chat_id: str, expanded: bool = True):
    runtime = get_runtime(chat_id)
    groups, _ = build_index()
    chats = ordinary_chat_groups(groups)
    elements: list[dict[str, Any]] = [
        fields([("普通对话", str(len(chats))), ("状态", "已展开" if expanded else "已收起"), ("当前", runtime.active_session_id or "-")]),
        action_row(
            [
                compact_button("返回看板", "dashboard", {"chat_id": chat_id}, "primary"),
                compact_button("刷新", "chats", {"chat_id": chat_id, "expanded": expanded}, "primary"),
                compact_button("展开" if not expanded else "收起", "chats", {"chat_id": chat_id, "expanded": not expanded}),
            ]
        ),
    ]
    if not expanded:
        elements.append(note("普通对话列表已收起。发送 /chats 展开。"))
        return base_card("普通对话", elements, "grey")

    if not chats:
        elements.append(md("暂未识别到普通对话。"))
        return base_card("普通对话", elements, "grey")

    for idx, group in enumerate(chats[:MAX_CONVERSATIONS_IN_PANEL], 1):
        conv = group.conversations[0]
        active = "（当前）" if conv.session_id == runtime.active_session_id else ""
        cwd = str(conv.cwd) if conv.cwd else "无目录"
        elements.append(divider())
        elements.append(
            md(
                f"**{idx}. {conv.title}** {active}\n"
                f"{conversation_source_label(conv)} · {conv.status} · {conv.turns} 轮 · {format_time(conv.updated_at)}\n"
                f"`{short_text(cwd, 100)}`\n"
                f"`{conv.session_id}`"
            )
        )
        elements.append(
            action_row(
                [
                    compact_button("打开", "conversation", {"chat_id": chat_id, "session_id": conv.session_id}, "primary"),
                    compact_button("标为项目", "mark_project_from_chat", {"chat_id": chat_id, "session_id": conv.session_id}),
                ]
            )
        )
    if len(chats) > MAX_CONVERSATIONS_IN_PANEL:
        elements.append(note(f"仅显示最近 {MAX_CONVERSATIONS_IN_PANEL} 个普通对话。"))
    return base_card("普通对话", elements, "grey")


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
    root = find_project_root(conv.cwd)
    runtime.active_project_key = project_key(root) if root else ""
    if conv.cwd:
        runtime.cwd = conv.cwd
    save_runtime(chat_id)

    running = runtime.process is not None and runtime.process.poll() is None
    mode = "可续写" if is_resumable_conversation(conv) else "只读展示"
    back_button = (
        compact_button("返回项目", "project", {"chat_id": chat_id, "project_key": project_key(root)})
        if root
        else compact_button("返回普通对话", "chats", {"chat_id": chat_id, "expanded": True})
    )
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
                back_button,
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
    model = runtime.next_model or runtime.task_model or CODEX_MODEL
    if model:
        common.extend(["-m", model])
    if approval_policy:
        common.extend(["-a", approval_policy])
    if sandbox_mode:
        common.extend(["-s", sandbox_mode])
    common.extend(["exec"])
    if last_message_file:
        common.extend(["--output-last-message", str(last_message_file)])
    task_session_id = runtime.task_session_id or runtime.active_session_id
    conv = get_active_conversation(task_session_id)
    if is_resumable_conversation(conv):
        return common + ["resume", "--json", "--skip-git-repo-check", task_session_id, prompt]
    return common + ["--json", "--skip-git-repo-check", "-C", str(runtime_task_cwd(runtime)), prompt]


def codex_task_command(task: CodexTaskRuntime, last_message_file: Optional[Path] = None) -> list[str]:
    common = [CODEX_BIN]
    model = task.model or CODEX_MODEL
    approval_policy = task.approval_policy or CODEX_APPROVAL_POLICY
    sandbox_mode = task.sandbox_mode or CODEX_SANDBOX_MODE
    if model:
        common.extend(["-m", model])
    if approval_policy:
        common.extend(["-a", approval_policy])
    if sandbox_mode:
        common.extend(["-s", sandbox_mode])
    common.extend(["exec"])
    if last_message_file:
        common.extend(["--output-last-message", str(last_message_file)])
    conv = get_active_conversation(task.session_id)
    if is_resumable_conversation(conv):
        return common + ["resume", "--json", "--skip-git-repo-check", task.session_id, task.prompt]
    return common + ["--json", "--skip-git-repo-check", "-C", str(task.cwd), task.prompt]


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
    conv = get_active_conversation(runtime.task_session_id or runtime.active_session_id)
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


def refresh_task_latest_reply(chat_id: str, task: CodexTaskRuntime) -> bool:
    runtime = get_runtime(chat_id)
    latest = read_last_message_file(Path(task.last_message_path)) if task.last_message_path else ""
    source = "last_message_file" if latest else ""

    if not latest:
        conv = find_conversation_for_run(runtime, task.cwd, task.started_at, task.prompt)
        if conv:
            if conv.session_id:
                task.session_id = conv.session_id
                runtime.task_session_id = conv.session_id
                if runtime.active_session_id != conv.session_id:
                    runtime.active_session_id = conv.session_id
            if conv.last_assistant_at >= max(task.started_at - 1, conv.last_user_at):
                latest = conv.last_assistant.strip()
            source = "session_file" if latest else ""

    if not latest:
        return False

    output_text = final_reply_text(latest, 5000)
    if output_text == task.output:
        return False

    task.output = output_text
    runtime.task_output = output_text
    logger.info(
        "task latest reply refreshed: chat_id=%s task_id=%s source=%s",
        chat_id,
        task.task_id,
        source,
    )
    save_runtime(chat_id)
    return True


def latest_panel_conversation(index: int = 0) -> Optional[ConversationInfo]:
    projects, _ = build_index()
    projects = project_groups(projects)
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
            if conv.session_id and runtime.task_session_id != conv.session_id:
                runtime.task_session_id = conv.session_id
                if runtime.active_session_id != conv.session_id:
                    runtime.active_session_id = conv.session_id
                save_runtime(chat_id)
            user_question = user_question or conv.last_user
            last_agent_message = last_agent_message or conv.last_assistant
            if last_agent_message and user_question:
                break
        time.sleep(0.2)

    if not last_agent_message:
        conv = find_conversation_for_run(runtime, cwd, started_at, prompt)
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


def maybe_create_pending_approval(chat_id: str, runtime: ChatRuntime, text: str, task: Optional[CodexTaskRuntime] = None) -> bool:
    if not should_create_approval(text):
        return False
    task_id = task.task_id if task else ""
    existing_pending = pending_approvals_for_chat(chat_id, task_id)
    if existing_pending:
        return True
    fingerprint = hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]
    if runtime.last_approval_fingerprint == fingerprint:
        logger.info("approval fingerprint matched but no pending approval exists; recreating approval: chat_id=%s", chat_id)
    runtime.last_approval_fingerprint = fingerprint
    save_runtime(chat_id)
    create_pending_approval(chat_id, runtime, text, task)
    return True


def create_pending_approval(chat_id: str, runtime: ChatRuntime, text: str, task: Optional[CodexTaskRuntime] = None) -> PendingApproval:
    approval_id = hashlib.sha1(f"{chat_id}:{time.time()}:{text}".encode()).hexdigest()[:10]
    approval = PendingApproval(
        approval_id=approval_id,
        chat_id=chat_id,
        task_id=task.task_id if task else "",
        session_id=(task.session_id if task else "") or runtime.task_session_id or runtime.active_session_id,
        cwd=str(task.cwd if task else runtime_task_cwd(runtime)),
        command=short_text(text, 1000),
        reason="Codex 输出中检测到需要人工批准的内容",
        model=(task.model if task else "") or runtime.task_model,
        original_prompt=(task.prompt if task else "") or runtime.task_prompt,
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
        task_id=task.task_id if task else "",
    )
    if not updated:
        logger.warning("task card approval update failed: chat_id=%s", chat_id)
    return approval


def send_stream_update(chat_id: str, buffer: list[str], force: bool = False, task_id: str = ""):
    if not buffer:
        return
    text = "\n".join(buffer).strip()
    if not text:
        return
    if force or len(text) >= 300:
        if not update_task_card(chat_id, status="运行中", output=text, force=force, task_id=task_id):
            logger.warning("stream task card update failed; skip fallback message: chat_id=%s task_id=%s", chat_id, task_id)
        buffer.clear()


def update_existing_task_card(chat_id: str, status: str = "", output: str = "", detail: str = "", task_id: str = "") -> bool:
    updated = update_task_card(chat_id, status=status, output=output, detail=detail, force=True, task_id=task_id)
    if not updated:
        logger.warning(
            "task card update failed; skip fallback message to avoid duplicate task panel: chat_id=%s status=%s",
            chat_id,
            status,
        )
    return updated


def find_plan(plan_id: str) -> Optional[PlanRuntime]:
    with PLAN_LOCK:
        return PLANS.get(plan_id)


def find_plan_task(plan: PlanRuntime, task_id: str) -> Optional[PlanTask]:
    for task in plan.tasks:
        if task.task_id == task_id:
            return task
    return None


def plan_task_command(plan: PlanRuntime, task: PlanTask, last_message_file: Optional[Path]) -> list[str]:
    runtime = ChatRuntime(cwd=plan_task_cwd(plan, task))
    runtime.task_model = task.model
    if task.approved_retry:
        runtime.next_approval_policy = APPROVED_CODEX_APPROVAL_POLICY
        runtime.next_sandbox_mode = APPROVED_CODEX_SANDBOX_MODE
    return codex_command(runtime, task.prompt, last_message_file)


def run_plan_task(plan_id: str, task_id: str):
    plan = find_plan(plan_id)
    if not plan:
        return
    task = find_plan_task(plan, task_id)
    if not task:
        return

    last_message_path: Optional[Path] = None
    try:
        fd, name = tempfile.mkstemp(prefix="lark-codex-plan-", suffix=".txt", dir="/tmp")
        os.close(fd)
        last_message_path = Path(name)
    except OSError:
        logger.exception("failed to create plan last message file")

    task.status = "running"
    task.started_at = time.time()
    task.finished_at = 0
    task.output = task.output or "已启动。"
    task.approval_required = False
    update_plan_card(plan, force=True)
    try:
        task_cwd = prepare_plan_worktree(plan, task)
        argv = plan_task_command(plan, task, last_message_path)
    except Exception as e:
        task.status = "failed"
        task.output = f"准备 Plan 子任务失败：{type(e).__name__}: {e}"
        task.finished_at = time.time()
        if last_message_path:
            last_message_path.unlink(missing_ok=True)
        update_plan_card(plan, force=True)
        return
    logger.info(
        "starting plan task: plan_id=%s task_id=%s cwd=%s model=%s prompt=%r",
        plan_id,
        task_id,
        task_cwd,
        model_label(task.model),
        short_text(task.prompt, 120),
    )

    try:
        proc = subprocess.Popen(
            argv,
            cwd=str(task_cwd),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
    except FileNotFoundError:
        task.status = "failed"
        task.output = f"找不到 Codex 命令：{CODEX_BIN}"
        task.finished_at = time.time()
        update_plan_card(plan, force=True)
        return
    except Exception as e:
        task.status = "failed"
        task.output = f"启动 Codex 失败：{type(e).__name__}: {e}"
        task.finished_at = time.time()
        update_plan_card(plan, force=True)
        return

    task.process = proc
    buffer: list[str] = []
    last_flush = time.time()
    try:
        assert proc.stdout is not None
        while True:
            if plan.stop_requested:
                proc.terminate()
                task.status = "cancelled"
                task.output = "计划已停止。"
                break
            line = proc.stdout.readline()
            if not line:
                if proc.poll() is not None:
                    break
                time.sleep(0.1)
                continue
            kind, text = parse_codex_json_event(line)
            if kind == "session_id" and text:
                task.session_id = text
                continue
            if kind == "skip" or not text:
                continue
            if should_create_approval(text) and not task.approved_retry:
                task.approval_required = True
                task.status = "approval"
                task.output = text
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=5)
                update_plan_card(plan, force=True)
                break
            buffer.append(text)
            if kind in ("message", "complete"):
                task.output = text
            elif time.time() - last_flush >= 2 or len("\n".join(buffer)) >= 500:
                task.output = "\n".join(buffer[-4:]).strip()
                update_plan_card(plan)
                last_flush = time.time()

        if task.status == "running":
            code = proc.wait(timeout=5)
            file_message = read_last_message_file(last_message_path)
            if file_message:
                task.output = file_message
            elif buffer and not task.output:
                task.output = "\n".join(buffer[-6:]).strip()
            if should_create_approval(task.output) and not task.approved_retry:
                task.status = "approval"
                task.approval_required = True
            else:
                finalize_plan_task_review(plan, task, code, task.output)
    except Exception as e:
        logger.exception("plan task failed: plan_id=%s task_id=%s", plan_id, task_id)
        task.status = "failed"
        task.output = f"执行异常：{type(e).__name__}: {e}"
    finally:
        if task.process is proc:
            task.process = None
        task.finished_at = time.time()
        if last_message_path:
            last_message_path.unlink(missing_ok=True)
        update_plan_card(plan, force=True)


def plan_runner_loop(plan_id: str):
    while not STOP_SCHEDULER.is_set():
        plan = find_plan(plan_id)
        if not plan:
            return
        if plan.stop_requested:
            for task in plan.tasks:
                if task.process and task.process.poll() is None:
                    task.process.terminate()
                if task.status in ("pending", "running", "approval"):
                    task.status = "cancelled"
                    task.finished_at = time.time()
            plan.status = "已停止"
            update_plan_card(plan, force=True)
            return

        running = [task for task in plan.tasks if task.status == "running"]
        pending = [task for task in plan.tasks if task.status == "pending"]
        slots = max(0, plan.max_parallel - len(running))
        for task in pending[:slots]:
            task.status = "running"
            task.started_at = time.time()
            threading.Thread(target=run_plan_task, args=(plan_id, task.task_id), name=f"plan-{plan_id}-{task.task_id}", daemon=True).start()

        active_statuses = {"pending", "running", "approval"}
        if not any(task.status in active_statuses for task in plan.tasks):
            plan.status = plan_status_text(plan)
            update_plan_card(plan, force=True)
            return

        update_plan_card(plan)
        time.sleep(1)


def start_plan(chat_id: str, content: str, model: str = ""):
    runtime = get_runtime(chat_id)
    tasks = parse_plan_tasks(content)
    if not tasks:
        send_msg(chat_id, "请发送任务清单，例如：\n/plan\n- 任务一\n- 任务二")
        return
    plan_id = hashlib.sha1(f"{chat_id}:{time.time()}:{content}".encode("utf-8")).hexdigest()[:10]
    plan = PlanRuntime(
        plan_id=plan_id,
        chat_id=chat_id,
        cwd=runtime.cwd,
        tasks=[
            plan_task_from_text(index, task, model)
            for index, task in enumerate(tasks, 1)
        ],
        max_parallel=max(1, PLAN_MAX_PARALLEL),
    )
    with PLAN_LOCK:
        PLANS[plan_id] = plan
    runtime.active_plan_id = plan_id
    runtime.plan_input_mode = False
    save_runtime(chat_id)
    send_plan_card(plan)
    threading.Thread(target=plan_runner_loop, args=(plan_id,), name=f"plan-runner-{plan_id}", daemon=True).start()


def latest_plan_for_chat(chat_id: str) -> Optional[PlanRuntime]:
    with PLAN_LOCK:
        plans = [plan for plan in PLANS.values() if plan.chat_id == chat_id]
    if not plans:
        return None
    return max(plans, key=lambda p: p.created_at)


def stop_plan(chat_id: str, plan_id: str = ""):
    plan = find_plan(plan_id) if plan_id else latest_plan_for_chat(chat_id)
    if not plan:
        send_msg(chat_id, "当前没有可停止的 Plan。")
        return
    plan.stop_requested = True
    update_plan_card(plan, force=True)


def restart_bridge(chat_id: str):
    logger.info("restart requested: chat_id=%s argv=%s", chat_id, sys.argv)
    send_msg(chat_id, "正在重启 Lark-Codex WebSocket；请稍后发送 /status 确认。")
    save_runtime(chat_id)
    STOP_SCHEDULER.set()
    stop_power_management()
    time.sleep(0.5)
    os.execv(sys.executable, [sys.executable, *sys.argv])


def request_restart_confirmation(
    chat_id: str,
    requester_id: str = "",
    requester_type: str = "",
    message_id: str = "",
    event_id: str = "",
):
    existing = pending_restart_for_chat(chat_id)
    if existing:
        send_card(chat_id, build_restart_confirm_card(existing))
        return
    restart_id = hashlib.sha1(f"{chat_id}:{time.time()}:{requester_id}:{event_id}".encode("utf-8")).hexdigest()[:10]
    restart = PendingRestart(
        restart_id=restart_id,
        chat_id=chat_id,
        requester_id=requester_id,
        requester_type=requester_type,
        message_id=message_id,
        event_id=event_id,
    )
    with LOCK:
        PENDING_RESTARTS[restart_id] = restart
    send_card(chat_id, build_restart_confirm_card(restart))


def handle_restart_confirmation(chat_id: str, restart_id: str, confirmed: bool) -> tuple[bool, str]:
    restart = PENDING_RESTARTS.get(restart_id)
    if not restart or restart.chat_id != chat_id:
        return False, "找不到重启审批。"
    if restart.status != "pending":
        return False, f"重启审批已处理：{restart.status}"
    restart.status = "approved" if confirmed else "cancelled"
    if not confirmed:
        return True, "已取消重启。"
    threading.Thread(target=restart_bridge, args=(chat_id,), name="restart-bridge", daemon=True).start()
    return True, "已确认，正在重启。"


def approve_plan_task(chat_id: str, plan_id: str, task_id: str, approved: bool) -> bool:
    plan = find_plan(plan_id)
    if not plan or plan.chat_id != chat_id:
        return False
    task = find_plan_task(plan, task_id)
    if not task:
        return False
    if task.status != "approval":
        task.output = f"子任务 {task_id} 当前不是等待审批状态。"
        update_plan_card(plan, force=True)
        return True
    if approved:
        task.status = "pending"
        task.approved_retry = True
        task.approval_required = False
        task.output = (
            f"审批已批准，将使用 `{APPROVED_CODEX_SANDBOX_MODE}` / "
            f"`{APPROVED_CODEX_APPROVAL_POLICY}` 单次重试。"
        )
    else:
        task.status = "cancelled"
        task.output = "审批已拒绝，子任务已跳过。"
        task.finished_at = time.time()
    update_plan_card(plan, force=True)
    return True


def build_plan_diff_card(plan: PlanRuntime, task: PlanTask) -> dict[str, Any]:
    cwd = plan_task_cwd(plan, task)
    content = [
        f"**Plan**：`{plan.plan_id}`",
        f"**任务**：{task.task_id}. {task.title}",
        f"**状态**：{task.status}",
        f"**目录**：`{cwd}`",
    ]
    if task.branch_name:
        content.append(f"**分支**：`{task.branch_name}`")
    if task.test_summary:
        content.extend(["", "**测试**", task.test_summary])
    content.extend(["", "**Diff 摘要**", task.diff_summary or git_diff_summary(cwd)])
    actions = [
        compact_button("返回 Plan", "plan_refresh", {"chat_id": plan.chat_id, "plan_id": plan.plan_id}, "primary"),
    ]
    if task.status == "review":
        actions.extend(
            [
                compact_button("批准提交", "plan_commit", {"chat_id": plan.chat_id, "plan_id": plan.plan_id, "task_id": task.task_id}, "primary"),
                compact_button("跳过提交", "plan_skip_commit", {"chat_id": plan.chat_id, "plan_id": plan.plan_id, "task_id": task.task_id}, "danger"),
            ]
        )
    return base_card("Plan Diff 审批", [md("\n".join(content)), action_row(actions)], "orange")


def commit_plan_task(chat_id: str, plan_id: str, task_id: str, commit: bool) -> bool:
    plan = find_plan(plan_id)
    if not plan or plan.chat_id != chat_id:
        return False
    task = find_plan_task(plan, task_id)
    if not task:
        return False
    if task.status != "review":
        task.output = f"子任务 {task_id} 当前不是等待提交状态。"
        update_plan_card(plan, force=True)
        return True

    cwd = plan_task_cwd(plan, task)
    if not commit:
        task.status = "done"
        task.output = (
            "已跳过提交；改动仍保留在子任务 worktree 中，可稍后手动处理。\n"
            f"`{cwd}`"
        )
        update_plan_card(plan, force=True)
        return True

    code, output = git_command(cwd, ["add", "-A"], timeout=30)
    if code != 0:
        task.output = f"git add 失败，仍等待提交。\n{short_text(output, 1200)}"
        update_plan_card(plan, force=True)
        return True

    message = task.commit_message or plan_commit_message(plan, task)
    code, output = git_command(cwd, ["commit", "-m", message], timeout=60)
    if code != 0:
        if not has_git_changes(cwd):
            task.status = "done"
            task.output = "没有可提交的改动，已标记完成。"
        else:
            task.output = f"git commit 失败，仍等待提交。\n{short_text(output, 1600)}"
        update_plan_card(plan, force=True)
        return True

    task.commit_hash = git_head(cwd)[:12]
    task.status = "committed"
    task.output = (
        f"已提交到子任务分支 `{task.branch_name or '-'}`。\n"
        f"Commit：`{task.commit_hash}`\n"
        f"提交信息：`{message}`"
    )
    update_plan_card(plan, force=True)
    return True


def run_codex(chat_id: str, prompt: str, force_ordinary: bool = False, task_id: str = ""):
    runtime = get_runtime(chat_id)
    task = find_task(task_id)
    if task is None:
        task_id = send_task_card(chat_id, prompt, "等待启动", runtime.next_model or runtime.task_model or CODEX_MODEL, force_ordinary)
        task = find_task(task_id)
    if task is None:
        send_msg(chat_id, "创建任务运行态失败。")
        return

    with LOCK:
        cwd = task.cwd

    if not cwd.is_dir():
        text = f"当前目录不存在：{cwd}\n请先用 /cd 切换到有效目录。"
        if not update_task_card(chat_id, status="失败", output=text, force=True, task_id=task.task_id):
            send_msg(chat_id, text)
        return

    task_session_id = task.session_id
    selected_conv = get_active_conversation(task_session_id)
    if task_session_id and not is_resumable_conversation(selected_conv):
        notice = (
            "当前选中的是 Codex Desktop 会话，`codex exec` 不能可靠续写它。\n"
            "我会在同一目录启动一个新的 Lark bridge 会话，并把结果同步到这里。"
        )
        update_task_card(chat_id, status="准备中", detail=notice, force=True, task_id=task.task_id)
        task.session_id = ""
        if runtime.active_session_id == task_session_id:
            runtime.active_session_id = ""
        save_runtime(chat_id)

    last_message_path: Optional[Path] = None
    try:
        fd, name = tempfile.mkstemp(prefix="lark-codex-last-", suffix=".txt", dir="/tmp")
        os.close(fd)
        last_message_path = Path(name)
        task.last_message_path = str(last_message_path)
    except OSError:
        logger.exception("failed to create codex last message file")

    run_lock = session_run_lock(task.session_id)
    lock_acquired = False
    if run_lock:
        if run_lock.locked():
            update_task_card(
                chat_id,
                status="等待启动",
                detail=f"同一 Session `{task.session_id}` 已有任务在运行，本指令会排队执行。",
                force=True,
                task_id=task.task_id,
            )
        run_lock.acquire()
        lock_acquired = True

    argv = codex_task_command(task, last_message_path)
    selected_model = task.model or CODEX_MODEL
    runtime.next_approval_policy = ""
    runtime.next_sandbox_mode = ""
    runtime.next_model = ""
    save_runtime(chat_id)
    logger.info(
        "starting codex: chat_id=%s cwd=%s model=%s resume=%s prompt=%r",
        chat_id,
        cwd,
        selected_model or "default",
        bool(task.session_id),
        short_text(prompt, 120),
    )
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
        if lock_acquired and run_lock:
            run_lock.release()
        text = f"找不到 Codex 命令：{CODEX_BIN}\n请设置 CODEX_BIN 或确认命令在 PATH 中。"
        if not update_task_card(chat_id, status="失败", output=text, force=True, task_id=task.task_id):
            send_msg(chat_id, text)
        return
    except Exception as e:
        logger.exception("failed to start codex")
        if last_message_path:
            last_message_path.unlink(missing_ok=True)
        if lock_acquired and run_lock:
            run_lock.release()
        text = f"启动 Codex 失败：{type(e).__name__}: {e}"
        if not update_task_card(chat_id, status="失败", output=text, force=True, task_id=task.task_id):
            send_msg(chat_id, text)
        return

    with LOCK:
        task.process = proc
        runtime.process = proc

    logger.info("codex started: chat_id=%s pid=%s", chat_id, proc.pid)
    update_task_card(
        chat_id,
        status="运行中",
        detail=f"Codex 已开始处理。\n目录：`{cwd}`\n模型：`{model_label(selected_model)}`",
        force=True,
        task_id=task.task_id,
    )
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
                send_stream_update(chat_id, buffer, force=True, task_id=task.task_id)
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
                update_existing_task_card(chat_id, status="超时", output=text, task_id=task.task_id)
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
                task.session_id = text
                runtime.task_session_id = text
                runtime.active_session_id = text
                if task.force_ordinary:
                    def mutate(config: dict[str, Any]):
                        sessions = set(str(item) for item in config.get("ordinary_sessions", []) if item)
                        sessions.add(text)
                        config["ordinary_sessions"] = sorted(sessions)
                    update_classification(mutate)
                save_runtime(chat_id)
                continue
            if kind == "skip" or not text:
                continue
            maybe_create_pending_approval(chat_id, runtime, text, task)
            if kind == "progress":
                buffer.append(text)
            elif kind in ("message", "complete", "text", "tool_output"):
                buffer.append(text)
                if kind in ("message", "complete"):
                    last_agent_message = text
            emitted_output = True

            if kind in ("progress", "tool_output") or time.time() - last_flush >= 2 or len("\n".join(buffer)) >= 500:
                send_stream_update(chat_id, buffer, force=True, task_id=task.task_id)
                last_flush = time.time()

        send_stream_update(chat_id, buffer, force=True, task_id=task.task_id)
        code = proc.wait(timeout=5)
        runtime.task_session_id = task.session_id
        last_agent_message, user_question = resolve_task_result(
            chat_id, runtime, cwd, start, prompt, last_agent_message, last_message_path
        )
        task.session_id = runtime.task_session_id or task.session_id
        emitted_output = emitted_output or bool(last_agent_message)
        logger.info("codex exited: chat_id=%s pid=%s code=%s emitted_output=%s", chat_id, proc.pid, code, emitted_output)
        result_status = "完成" if code == 0 else "失败"
        result_text = task_end_text(runtime, cwd, code, start, emitted_output, last_agent_message, user_question=user_question)
        approval_needed = bool(pending_approvals_for_chat(chat_id, task.task_id))
        if not approval_needed:
            approval_needed = maybe_create_pending_approval(chat_id, runtime, last_agent_message, task) or maybe_create_pending_approval(chat_id, runtime, result_text, task)
        if approval_needed:
            logger.info(
                "waiting for Lark approval decision: chat_id=%s timeout_seconds=%s",
                chat_id,
                PENDING_APPROVAL_WAIT_SECONDS,
            )
            decision = wait_for_pending_approval(chat_id, task.task_id)
            logger.info("Lark approval wait finished: chat_id=%s decision=%s", chat_id, decision)
            if decision in ("approved", "rejected"):
                return
        update_existing_task_card(chat_id, status=result_status, output=result_text, task_id=task.task_id)
    except Exception as e:
        logger.exception("run_codex exception")
        text = f"执行异常：{type(e).__name__}: {e}"
        update_existing_task_card(chat_id, status="异常", output=text, task_id=task.task_id)
    finally:
        with LOCK:
            if task.process is proc:
                task.process = None
            if runtime.process is proc:
                runtime.process = None
        if lock_acquired and run_lock:
            run_lock.release()
        if last_message_path:
            last_message_path.unlink(missing_ok=True)
        task.last_message_path = ""
        save_runtime(chat_id)


def latest_running_task_for_chat(chat_id: str) -> Optional[CodexTaskRuntime]:
    with LOCK:
        tasks = [
            task
            for task in TASKS.values()
            if task.chat_id == chat_id and task.process is not None and task.process.poll() is None
        ]
    if not tasks:
        return None
    return max(tasks, key=lambda task: task.started_at)


def stop_codex(chat_id: str, task_id: str = "") -> bool:
    runtime = get_runtime(chat_id)
    task = find_task(task_id) if task_id else latest_running_task_for_chat(chat_id)
    with LOCK:
        proc = task.process if task else runtime.process
    if proc is None or proc.poll() is not None:
        text = "当前没有正在运行的任务。"
        updated = update_task_card(chat_id, status=runtime.task_status or "空闲", detail=text, force=True, task_id=task_id)
        if not updated:
            send_msg(chat_id, text)
        return updated

    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)
    if task:
        task.process = None
    if runtime.process is proc:
        runtime.process = None
    updated = update_task_card(chat_id, status="已停止", detail="已停止当前 Codex 任务。", force=True, task_id=task.task_id if task else task_id)
    if not updated:
        send_msg(chat_id, "已停止当前 Codex 任务。")
    return updated


def approve_pending(chat_id: str, approval_id: str, approved: bool, notify: bool = True) -> bool:
    approval = PENDING_APPROVALS.get(approval_id)
    if not approval:
        text = f"找不到审批：{approval_id}"
        if notify or not update_task_card(chat_id, detail=text, force=True):
            send_msg(chat_id, text)
        return False
    if approval.status != "pending":
        text = f"审批 {approval_id} 已处理：{approval.status}"
        if notify or not update_task_card(chat_id, detail=text, force=True, task_id=approval.task_id):
            send_msg(chat_id, text)
        return False

    approval.status = "approved" if approved else "rejected"
    status_text = f"审批 {approval_id} 已{'批准' if approved else '拒绝'}。"
    result_text = "\n".join(
        [
            f"**审批结果**：{'已批准' if approved else '已拒绝'}",
            f"**审批 ID**：`{approval_id}`",
            f"**目录**：`{approval.cwd}`",
            f"**处理时间**：{format_time(time.time())}",
            "",
            short_text(approval.command, 1200),
        ]
    )
    if approved:
        result_text += (
            "\n\n"
            f"将使用 `{APPROVED_CODEX_SANDBOX_MODE}` / `{APPROVED_CODEX_APPROVAL_POLICY}` 单次重试原始任务。"
        )
    else:
        result_text += "\n\n用户已拒绝，本次任务不会继续执行待审批操作。"

    updated = update_task_card(
        chat_id,
        status="已批准" if approved else "已拒绝",
        output=result_text,
        detail=status_text,
        force=True,
        task_id=approval.task_id,
    )
    if not updated and notify:
        send_msg(chat_id, status_text)

    if not approved:
        return updated

    runtime = get_runtime(chat_id)
    task = find_task(approval.task_id)
    if approval.session_id:
        runtime.task_session_id = approval.session_id
        runtime.active_session_id = approval.session_id
        if task:
            task.session_id = approval.session_id
    prompt = approval.original_prompt.strip() or approval.resume_prompt or runtime.task_prompt.strip()
    model = approval.model or runtime.task_model
    prompt = (
        f"{prompt}\n\n"
        f"审批结果：用户已在 Lark 批准审批 {approval_id}。"
        "请继续执行原始任务，必要时重试刚才因权限、审批或 sandbox 限制失败的操作。"
    )
    runtime.task_prompt = prompt
    runtime.task_model = model
    runtime.task_cwd = approval.cwd or runtime.task_cwd
    runtime.task_status = "已批准，继续执行"
    runtime.next_approval_policy = APPROVED_CODEX_APPROVAL_POLICY
    runtime.next_sandbox_mode = APPROVED_CODEX_SANDBOX_MODE
    runtime.next_model = model
    if task:
        task.prompt = prompt
        task.model = model
        task.cwd = Path(approval.cwd).expanduser() if approval.cwd else task.cwd
        task.status = "已批准，继续执行"
        task.approval_policy = APPROVED_CODEX_APPROVAL_POLICY
        task.sandbox_mode = APPROVED_CODEX_SANDBOX_MODE
        task.approved_retry = True
    continued_updated = update_task_card(chat_id, status="已批准，继续执行", output=result_text, force=True, task_id=approval.task_id)
    threading.Thread(target=run_codex, args=(chat_id, prompt, False, approval.task_id), daemon=True).start()
    return updated or continued_updated


# ===================== 状态和日报 =====================
def current_status_text(chat_id: str) -> str:
    runtime = get_runtime(chat_id)
    _, conversations = build_index()
    conv = conversations.get(runtime.active_session_id)
    project = project_for_runtime(chat_id)
    running_tasks = [
        task for task in TASKS.values()
        if task.chat_id == chat_id and task.process is not None and task.process.poll() is None
    ]
    running = bool(running_tasks) or (runtime.process is not None and runtime.process.poll() is None)
    desktop_count, bridge_count, other_count = project_source_counts(project)
    stage, next_step = project_stage_text(project, chat_id)
    lines = [
        "**当前项目状态**",
        "",
        f"**状态**：{'运行中' if running else '空闲'}" + (f"（{len(running_tasks)} 个任务）" if running_tasks else ""),
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


def same_project_cwd(project: ProjectInfo, cwd_value: Any) -> bool:
    if not project.cwd or not cwd_value:
        return False
    try:
        return same_path(project.cwd, Path(str(cwd_value)))
    except Exception:
        return str(project.cwd) == str(cwd_value)


def today_project_approvals(project: ProjectInfo, chat_id: str, today) -> list[PendingApproval]:
    with LOCK:
        approvals = list(PENDING_APPROVALS.values())
    result = []
    for approval in approvals:
        if chat_id and approval.chat_id != chat_id:
            continue
        if datetime.fromtimestamp(approval.created_at).date() != today:
            continue
        if project.cwd and approval.cwd and not same_project_cwd(project, approval.cwd):
            continue
        result.append(approval)
    return result


def today_project_plans(project: ProjectInfo, chat_id: str, today) -> list[PlanRuntime]:
    with PLAN_LOCK:
        plans = list(PLANS.values())
    result = []
    for plan in plans:
        if chat_id and plan.chat_id != chat_id:
            continue
        if datetime.fromtimestamp(plan.created_at).date() != today:
            continue
        if project.cwd and not same_path(project.cwd, plan.cwd):
            continue
        result.append(plan)
    return result


def today_project_tasks(project: ProjectInfo, chat_id: str, today) -> list[CodexTaskRuntime]:
    with LOCK:
        tasks = list(TASKS.values())
    result = []
    for task in tasks:
        if chat_id and task.chat_id != chat_id:
            continue
        if datetime.fromtimestamp(task.started_at).date() != today:
            continue
        if project.cwd and task.cwd and not same_project_cwd(project, task.cwd):
            continue
        result.append(task)
    return result


def task_failed(task: CodexTaskRuntime) -> bool:
    status = str(task.status or "")
    return status in ("失败", "异常", "超时") or looks_failed(task.output)


def plan_task_failed(task: PlanTask) -> bool:
    return task.status == "failed" or looks_failed(task.output) or looks_failed(task.test_summary)


def plan_task_approval_count(task: PlanTask) -> int:
    if task.approval_required or task.status == "approval":
        return 1
    text = f"{task.output}\n{task.test_summary}"
    return 1 if "审批" in text or "待提交审批" in text else 0


def daily_instruction_count(report_convs: list[ConversationInfo], tasks: list[CodexTaskRuntime], plans: list[PlanRuntime]) -> int:
    session_turns = sum(c.today_turns for c in report_convs)
    task_count = len(tasks)
    plan_item_count = sum(len(plan.tasks) for plan in plans)
    return max(session_turns, task_count + plan_item_count)


def daily_approval_count(report_convs: list[ConversationInfo], approvals: list[PendingApproval], plans: list[PlanRuntime]) -> int:
    session_approvals = sum(c.today_approval_count for c in report_convs)
    plan_approvals = sum(plan_task_approval_count(task) for plan in plans for task in plan.tasks)
    return max(len(approvals), session_approvals) + plan_approvals


def daily_failed_count(report_convs: list[ConversationInfo], tasks: list[CodexTaskRuntime], plans: list[PlanRuntime]) -> int:
    session_failures = sum(c.today_failed_count for c in report_convs)
    task_failures = sum(1 for task in tasks if task_failed(task))
    plan_failures = sum(1 for plan in plans for task in plan.tasks if plan_task_failed(task))
    return max(session_failures, task_failures) + plan_failures


def clean_daily_item(line: str) -> str:
    line = re.sub(r"^\s*[-*]\s+", "", line)
    line = re.sub(r"^\s*\d+[\.)、]\s+", "", line)
    line = re.sub(r"^#+\s+", "", line)
    line = line.strip(" `")
    line = re.sub(r"\s+", " ", line).strip()
    return line


def extract_daily_items(texts: list[str], keywords: tuple[str, ...], limit: int = 8) -> list[str]:
    items: list[str] = []
    seen: set[str] = set()
    skip_prefixes = (
        "我会",
        "我把",
        "我先",
        "接下来",
        "试跑",
        "已验证",
        "验证过",
        "测试",
        "当前",
        "用法",
        "例如",
        "```",
        "可发送",
    )
    for text in texts:
        for raw_line in str(text or "").splitlines():
            line = clean_daily_item(raw_line)
            if len(line) < 6 or line.startswith(skip_prefixes):
                continue
            haystack = line.lower()
            if not any(keyword.lower() in haystack for keyword in keywords):
                continue
            key = re.sub(r"\W+", "", haystack)
            if key in seen:
                continue
            seen.add(key)
            items.append(short_text(line, 120))
            if len(items) >= limit:
                return items
    return items


def daily_update_items(texts: list[str]) -> list[str]:
    return extract_daily_items(
        texts,
        (
            "新增",
            "增加",
            "添加",
            "支持",
            "实现",
            "接入",
            "升级",
            "优化",
            "更新",
            "改进",
            "完成",
        ),
    )


def daily_bugfix_items(texts: list[str]) -> list[str]:
    return extract_daily_items(
        texts,
        (
            "修复",
            "bug",
            "错误",
            "异常",
            "失败",
            "报错",
            "权限",
            "审批",
            "无法",
            "不对",
            "问题",
        ),
    )


def project_progress_text(project_key_value: str = "", chat_id: str = "", report_date=None) -> str:
    report_date = report_date or datetime.now().date()
    all_groups, _ = build_index(report_date=report_date)
    projects = project_groups(all_groups)
    selected = [p for p in projects if not project_key_value or p.key == project_key_value]
    if not selected and chat_id:
        selected = [project_for_runtime(chat_id)]
    if not selected:
        return "没有找到项目进展。"

    lines = [f"**项目进展日报（{report_date.strftime('%Y-%m-%d')}）**"]
    for project in selected[:10]:
        report_convs = [
            c for c in project.conversations
            if datetime.fromtimestamp(c.updated_at).date() == report_date
        ]
        approvals = today_project_approvals(project, chat_id, report_date)
        plans = today_project_plans(project, chat_id, report_date)
        tasks = today_project_tasks(project, chat_id, report_date)
        instruction_count = daily_instruction_count(report_convs, tasks, plans)
        report_duration = sum(c.today_duration_seconds for c in report_convs)
        if not report_duration:
            report_duration = sum(
                max(0, c.updated_at - parse_event_timestamp(c.created_at))
                for c in report_convs
                if parse_event_timestamp(c.created_at)
            )
        approval_count = daily_approval_count(report_convs, approvals, plans)
        failed_count = daily_failed_count(report_convs, tasks, plans)
        summary_texts = []
        for conv in report_convs:
            summary_texts.extend(conv.today_assistant_messages[-4:] or [conv.last_assistant])
        for task in tasks:
            if task.output:
                summary_texts.append(task.output)
        for plan in plans:
            summary_texts.extend(task.output for task in plan.tasks if task.output)
        update_items = daily_update_items(summary_texts)
        bugfix_items = daily_bugfix_items(summary_texts)

        lines.append("")
        lines.append(f"### {project.name}")
        lines.append(f"**目录**：`{project.cwd or '无项目目录'}`")
        lines.append("**统计**")
        lines.append(f"- 当日活跃对话数量：{len(report_convs)}")
        lines.append(f"- 总指令数：{instruction_count}")
        lines.append(f"- 总耗时：{format_duration(report_duration)}")
        lines.append(f"- 审批总数：{approval_count}")
        lines.append(f"- 失败总数：{failed_count}")
        lines.append("")
        lines.append(f"**当日更新或新增功能（{len(update_items)}）**")
        lines.extend([f"- {item}" for item in update_items] or ["- 暂未识别到明确的功能更新。"])
        lines.append("")
        lines.append(f"**当日修复 Bug（{len(bugfix_items)}）**")
        lines.extend([f"- {item}" for item in bugfix_items] or ["- 暂未识别到明确的 Bug 修复。"])
        lines.extend(format_git_summary(project.cwd, limit=5))
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


def should_auto_refresh_codex_task(task: CodexTaskRuntime, now: float) -> bool:
    if TASK_CARD_REFRESH_INTERVAL_SECONDS <= 0 or not task.message_id:
        return False
    running = task.process is not None and task.process.poll() is None
    pending_statuses = {"等待启动", "准备中", "等待审批", "已批准，继续执行"}
    waiting = task.status in pending_statuses or "审批" in task.status
    if not running and not waiting:
        return False
    return now - task.last_card_update_at >= TASK_CARD_REFRESH_INTERVAL_SECONDS


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
                tasks = list(TASKS.values())

            for task in tasks:
                runtime = get_runtime(task.chat_id)
                if runtime.send_disabled or not is_valid_chat_id(task.chat_id):
                    continue
                if should_auto_refresh_codex_task(task, now):
                    update_task_card(task.chat_id, force=True, task_id=task.task_id)

            for chat_id in chat_ids:
                runtime = get_runtime(chat_id)
                if runtime.send_disabled or not is_valid_chat_id(chat_id):
                    continue
                if not latest_task_for_chat(chat_id) and should_auto_refresh_task_card(runtime, now):
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
    root = find_project_root(path)
    runtime.active_project_key = project_key(root or path)
    save_runtime(chat_id)
    send_msg(chat_id, f"已切换目录：{path}")


def mark_project_path(chat_id: str, path_text: str = ""):
    runtime = get_runtime(chat_id)
    path = Path(path_text).expanduser() if path_text else runtime.cwd
    if not path.is_absolute():
        path = runtime.cwd / path
    path = normalize_path(path)
    if not path.exists() or not path.is_dir():
        send_msg(chat_id, f"不是有效目录：{path}")
        return

    def mutate(config: dict[str, Any]):
        project_paths = config.setdefault("project_paths", {})
        project_paths[str(path)] = project_name(path)

    update_classification(mutate)
    runtime.active_project_key = project_key(path)
    save_runtime(chat_id)
    send_msg(chat_id, f"已标记为项目：{path}")


def mark_chat_session(chat_id: str, session_id: str = ""):
    runtime = get_runtime(chat_id)
    session_id = session_id.strip() or runtime.active_session_id
    if not session_id:
        send_msg(chat_id, "用法：/mark-chat <session_id>，或先打开一个对话后发送 /mark-chat")
        return

    def mutate(config: dict[str, Any]):
        sessions = set(str(item) for item in config.get("ordinary_sessions", []) if item)
        sessions.add(session_id)
        config["ordinary_sessions"] = sorted(sessions)

    update_classification(mutate)
    send_msg(chat_id, f"已标记为普通对话：{session_id}")


def mark_project_from_session(chat_id: str, session_id: str) -> bool:
    _, conversations = build_index()
    conv = conversations.get(session_id)
    if not conv or not conv.cwd:
        return False
    path = find_project_root(conv.cwd) or normalize_path(conv.cwd)
    if is_generic_conversation_dir(path):
        return False

    def mutate(config: dict[str, Any]):
        project_paths = config.setdefault("project_paths", {})
        project_paths[str(path)] = project_name(path)
        sessions = [item for item in config.get("ordinary_sessions", []) if item != session_id]
        config["ordinary_sessions"] = sessions

    update_classification(mutate)
    runtime = get_runtime(chat_id)
    runtime.active_project_key = project_key(path)
    save_runtime(chat_id)
    return True


def create_project(chat_id: str, name: str):
    name = name.strip()
    if not name:
        send_msg(chat_id, "用法：/project=new <项目名称>")
        return
    root = normalize_path(CODEX_PROJECTS_ROOT)
    path = root / slugify_name(name)
    suffix = 2
    while path.exists():
        path = root / f"{slugify_name(name)}-{suffix}"
        suffix += 1
    path.mkdir(parents=True, exist_ok=False)
    readme = path / "README.md"
    readme.write_text(f"# {name}\n\nCreated by Lark-Codex.\n", encoding="utf-8")

    def mutate(config: dict[str, Any]):
        project_paths = config.setdefault("project_paths", {})
        project_paths[str(path)] = name

    update_classification(mutate)
    runtime = get_runtime(chat_id)
    runtime.cwd = path
    runtime.active_project_key = project_key(path)
    runtime.active_session_id = ""
    save_runtime(chat_id)
    send_msg(chat_id, f"已新建项目：{name}\n目录：`{path}`\n后续指令会在该项目目录中执行。")


def start_new_chat(chat_id: str, prompt: str):
    prompt = prompt.strip()
    if not prompt:
        send_msg(chat_id, "用法：/chat=new <主题或指令>")
        return
    runtime = get_runtime(chat_id)
    runtime.active_session_id = ""
    runtime.task_session_id = ""
    save_runtime(chat_id)
    task_id = send_task_card(chat_id, prompt, "等待启动", force_ordinary=True)
    threading.Thread(target=run_codex, args=(chat_id, prompt, True, task_id), daemon=True).start()


def start_new_conversation(chat_id: str, prompt: str):
    prompt = prompt.strip()
    if not prompt:
        send_msg(chat_id, "用法：/convos=new <指令>")
        return
    runtime = get_runtime(chat_id)
    runtime.active_session_id = ""
    runtime.task_session_id = ""
    save_runtime(chat_id)
    task_id = send_task_card(chat_id, prompt, "等待启动", force_ordinary=False)
    threading.Thread(target=run_codex, args=(chat_id, prompt, False, task_id), daemon=True).start()


def archive_current_project(chat_id: str, target: str = ""):
    runtime = get_runtime(chat_id)
    project: Optional[ProjectInfo] = None
    if target.strip():
        try:
            index = int(target.strip()) - 1
            projects, _ = build_index()
            project_list = project_groups(projects)
            if 0 <= index < len(project_list):
                project = project_list[index]
        except ValueError:
            path = Path(target).expanduser()
            if not path.is_absolute():
                path = runtime.cwd / path
            root = find_project_root(path) or normalize_path(path)
            project = ProjectInfo(key=project_key(root), name=project_display_name(root), cwd=root)
    if not project:
        project = project_for_runtime(chat_id)
    if not project.cwd or not project.is_project:
        send_msg(chat_id, "当前没有可归档的项目。")
        return
    archive_project_path(project.cwd)
    if runtime.active_project_key == project.key:
        runtime.active_project_key = ""
    save_runtime(chat_id)
    send_msg(chat_id, f"已归档项目：{project.name}\n目录：`{project.cwd}`")


def archive_current_session(chat_id: str, target: str = "", label: str = "会话"):
    runtime = get_runtime(chat_id)
    session_id = target.strip() or runtime.active_session_id or runtime.task_session_id
    if not session_id:
        send_msg(chat_id, f"当前没有可归档的{label}。")
        return
    if session_id.isdigit():
        index = int(session_id) - 1
        groups, _ = build_index()
        chats = ordinary_chat_groups(groups)
        if 0 <= index < len(chats):
            session_id = chats[index].conversations[0].session_id
    archive_session_id(session_id)
    if runtime.active_session_id == session_id:
        runtime.active_session_id = ""
    if runtime.task_session_id == session_id:
        runtime.task_session_id = ""
    save_runtime(chat_id)
    send_msg(chat_id, f"已归档{label}：`{session_id}`")


def parse_entity_command(content: str):
    match = re.match(r"^/(project|chat|convos?|对话|项目)\s*=\s*(new|archive|achive)\b(.*)$", content.strip(), flags=re.IGNORECASE | re.DOTALL)
    if not match:
        return "", "", ""
    entity = match.group(1).lower()
    action = match.group(2).lower()
    rest = strip_command_separator(match.group(3) or "")
    if entity == "项目":
        entity = "project"
    if entity == "对话":
        entity = "convos"
    if entity == "convo":
        entity = "convos"
    if action == "achive":
        action = "archive"
    return entity, action, rest


def handle_entity_command(chat_id: str, content: str) -> bool:
    entity, action, rest = parse_entity_command(content)
    if not entity:
        return False
    if entity == "project" and action == "new":
        create_project(chat_id, rest)
    elif entity == "project" and action == "archive":
        archive_current_project(chat_id, rest)
    elif entity == "chat" and action == "new":
        start_new_chat(chat_id, rest)
    elif entity == "chat" and action == "archive":
        archive_current_session(chat_id, rest, label="普通对话")
    elif entity == "convos" and action == "new":
        start_new_conversation(chat_id, rest)
    elif entity == "convos" and action == "archive":
        archive_current_session(chat_id, rest, label="会话")
    else:
        send_msg(chat_id, "不支持的操作。")
    return True


def send_help(chat_id: str):
    send_msg(
        chat_id,
        "\n".join(
            [
                "可用指令：",
                "/panel 打开 Codex 看板（默认收起项目列表）",
                "/projects 打开项目面板（默认收起列表）",
                "/projects 展开 展开项目列表",
                "/chats 打开普通对话列表",
                "/convos 打开当前项目对话面板（默认收起列表）",
                "/convos 展开 展开当前项目对话列表",
                "/status 查看当前项目状态",
                "/daily 输出项目进展日报",
                "/daily=YYYY-MM-DD 输出指定日期项目进展日报",
                "/model=<模型名> +<指令> 使用指定模型执行一次，例如 /model=gpt-5.5 +修复 README",
                "/plan 进入并行计划模式；也可发送 /plan 后跟任务清单直接执行",
                "/plan status 刷新最近的计划面板",
                "/plan stop 停止最近的计划",
                "/cd <目录> 切换工作目录",
                "/project <编号> 打开面板中的项目",
                "/latest <编号> 打开面板中项目的最新对话",
                "/conv <session_id> 切换对话",
                "/mark-project [目录] 手动标记项目目录",
                "/mark-chat [session_id] 手动标记普通对话",
                "/approve <id> 批准待审批",
                "/reject <id> 拒绝待审批",
                "/stop 停止当前任务",
                "/restart 重启 Lark-Codex WebSocket 脚本",
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
    projects = project_groups(projects)
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
    projects = project_groups(projects)
    if index < 0 or index >= min(len(projects), MAX_PROJECTS_IN_PANEL):
        send_msg(chat_id, f"项目编号超出范围。当前面板显示 1-{min(len(projects), MAX_PROJECTS_IN_PANEL)}。")
        return
    project = projects[index]
    if not project.conversations:
        send_msg(chat_id, "这个项目没有对话。")
        return
    send_card(chat_id, build_conversation_card(chat_id, project.conversations[0].session_id))


def on_text(chat_id: str, content: str, meta: Optional[dict[str, str]] = None):
    meta = meta or {}
    content = normalize_text_command(content)
    content = content.strip()
    if not content:
        return
    selected_model, content = parse_model_prefix(content)
    if selected_model and not content:
        send_msg(chat_id, "用法：`/model=<模型名> +具体指令`，例如 `/model=gpt-5.5 +修复 README`。")
        return
    runtime = get_runtime(chat_id)

    if runtime.plan_input_mode and not content.startswith("/"):
        start_plan(chat_id, content, selected_model)
        return

    if handle_entity_command(chat_id, content):
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
    if content in ("/chats", "/普通对话"):
        send_card(chat_id, build_chats_card(chat_id, expanded=True))
        return
    if content in ("/chats 收起", "/普通对话 收起"):
        send_card(chat_id, build_chats_card(chat_id, expanded=False))
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
    report_date, is_daily_command = parse_daily_command(content)
    if is_daily_command:
        if report_date is None:
            send_msg(chat_id, "日期格式不正确。用法：`/daily=2026-06-01`")
            return
        send_msg(chat_id, project_progress_text(runtime.active_project_key, chat_id, report_date=report_date))
        return
    if content == "/plan":
        runtime.plan_input_mode = True
        save_runtime(chat_id)
        send_msg(
            chat_id,
            "已进入 Plan 模式。请发送任务清单，例如：\n"
            "- 检查 README\n"
            "- 修复审批流程\n"
            "- 运行测试\n\n"
            f"当前并发上限：{PLAN_MAX_PARALLEL}。也可以直接发送 `/plan` 后跟任务清单。",
        )
        return
    if content.startswith("/plan ") or content.startswith("/plan\n"):
        plan_content = content[5:].strip()
        normalized_plan_command = re.sub(r"\s+", " ", plan_content).strip().lower()
        if normalized_plan_command in ("status", "refresh", "状态", "刷新"):
            plan = latest_plan_for_chat(chat_id)
            if plan:
                send_plan_card(plan)
            else:
                send_msg(chat_id, "当前还没有 Plan。")
            return
        if normalized_plan_command in ("stop", "停止"):
            stop_plan(chat_id)
            return
        start_plan(chat_id, plan_content, selected_model)
        return
    if content == "/stop":
        stop_codex(chat_id)
        return
    if content == "/restart":
        request_restart_confirmation(
            chat_id,
            requester_id=meta.get("sender_id", ""),
            requester_type=meta.get("sender_type", ""),
            message_id=meta.get("message_id", ""),
            event_id=meta.get("event_id", ""),
        )
        return
    if content.startswith("/cd "):
        handle_cd(chat_id, content[4:].strip())
        return
    if content == "/mark-project" or content.startswith("/mark-project "):
        mark_project_path(chat_id, content[len("/mark-project"):].strip())
        return
    if content == "/mark-chat" or content.startswith("/mark-chat "):
        mark_chat_session(chat_id, content[len("/mark-chat"):].strip())
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

    task_id = send_task_card(chat_id, content, "等待启动", selected_model)
    threading.Thread(target=run_codex, args=(chat_id, content, False, task_id), daemon=True).start()


def action_toast(content: str, typ: str = "success"):
    return P2CardActionTriggerResponse({"toast": {"type": typ, "content": content}})


def action_card(card: dict[str, Any], content: str = "已更新", typ: str = "success"):
    return P2CardActionTriggerResponse(
        {
            "toast": {"type": typ, "content": content},
            "card": {"type": "raw", "data": card},
        }
    )


def task_card_patch_response(chat_id: str, task_id: str, content: str = "已刷新"):
    updated = update_task_card(chat_id, force=True, task_id=task_id)
    if updated:
        logger.info("task card action updated in place: chat_id=%s task_id=%s", chat_id, task_id)
        return action_toast(content)
    logger.warning("task card action fallback to callback card: chat_id=%s task_id=%s", chat_id, task_id)
    return action_card(build_task_card(chat_id, task_id=task_id), content)


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
        elif name == "chats":
            return action_card(build_chats_card(chat_id, expanded=bool(action.get("expanded", True))))
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
        elif name == "mark_project_from_chat":
            if not mark_project_from_session(chat_id, action.get("session_id", "")):
                return action_toast("无法标记项目。", "error")
            return action_card(build_chats_card(chat_id, expanded=True), "已标为项目")
        elif name == "status":
            task_id = action.get("task_id", "")
            return action_card(
                build_report_card(
                    "当前项目状态",
                    current_status_text(chat_id),
                    chat_id,
                    back_action="task_refresh" if get_runtime(chat_id).task_message_id else "dashboard",
                    back_label="返回任务卡" if get_runtime(chat_id).task_message_id else "返回看板",
                    back_value=({"task_id": task_id} if task_id else {}) | {"render": "callback"}
                    if get_runtime(chat_id).task_message_id
                    else None,
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
            task_id = action.get("task_id", "")
            if action.get("render") == "callback":
                return action_card(build_task_card(chat_id, task_id=task_id), "已返回任务卡")
            return task_card_patch_response(chat_id, task_id, "已刷新")
        elif name == "stop":
            task_id = action.get("task_id", "")
            if stop_codex(chat_id, task_id):
                return action_toast("已停止")
            return action_card(build_task_card(chat_id, task_id=task_id), "已停止")
        elif name == "restart":
            request_restart_confirmation(chat_id, requester_type="card_action")
            restart = pending_restart_for_chat(chat_id)
            return action_card(build_restart_confirm_card(restart), "请确认重启") if restart else action_toast("已发送确认")
        elif name == "restart_confirm":
            ok, message = handle_restart_confirmation(chat_id, action.get("restart_id", ""), True)
            return action_toast(message, "success" if ok else "error")
        elif name == "restart_cancel":
            ok, message = handle_restart_confirmation(chat_id, action.get("restart_id", ""), False)
            return action_toast(message, "success" if ok else "error")
        elif name == "plan_refresh":
            plan = find_plan(action.get("plan_id", "")) or latest_plan_for_chat(chat_id)
            if not plan:
                return action_toast("找不到 Plan。", "error")
            return action_card(build_plan_card(plan), "已刷新")
        elif name == "plan_stop":
            plan = find_plan(action.get("plan_id", "")) or latest_plan_for_chat(chat_id)
            if not plan:
                return action_toast("找不到 Plan。", "error")
            plan.stop_requested = True
            return action_card(build_plan_card(plan), "已停止")
        elif name == "plan_approve":
            if not approve_plan_task(chat_id, action.get("plan_id", ""), action.get("task_id", ""), True):
                return action_toast("找不到 Plan 子任务。", "error")
            plan = find_plan(action.get("plan_id", ""))
            return action_card(build_plan_card(plan), "已批准") if plan else action_toast("已批准")
        elif name == "plan_reject":
            if not approve_plan_task(chat_id, action.get("plan_id", ""), action.get("task_id", ""), False):
                return action_toast("找不到 Plan 子任务。", "error")
            plan = find_plan(action.get("plan_id", ""))
            return action_card(build_plan_card(plan), "已拒绝") if plan else action_toast("已拒绝")
        elif name == "plan_diff":
            plan = find_plan(action.get("plan_id", "")) or latest_plan_for_chat(chat_id)
            task = find_plan_task(plan, action.get("task_id", "")) if plan else None
            if not plan or not task:
                return action_toast("找不到 Plan 子任务。", "error")
            return action_card(build_plan_diff_card(plan, task), "已打开 Diff")
        elif name == "plan_commit":
            if not commit_plan_task(chat_id, action.get("plan_id", ""), action.get("task_id", ""), True):
                return action_toast("找不到 Plan 子任务。", "error")
            plan = find_plan(action.get("plan_id", ""))
            return action_card(build_plan_card(plan), "已提交") if plan else action_toast("已提交")
        elif name == "plan_skip_commit":
            if not commit_plan_task(chat_id, action.get("plan_id", ""), action.get("task_id", ""), False):
                return action_toast("找不到 Plan 子任务。", "error")
            plan = find_plan(action.get("plan_id", ""))
            return action_card(build_plan_card(plan), "已跳过提交") if plan else action_toast("已跳过提交")
        elif name == "approve":
            task_id = action.get("task_id", "")
            if approve_pending(chat_id, action.get("approval_id", ""), True, notify=False):
                return action_toast("已批准")
            return action_card(build_task_card(chat_id, task_id=task_id), "已批准")
        elif name == "reject":
            task_id = action.get("task_id", "")
            if approve_pending(chat_id, action.get("approval_id", ""), False, notify=False):
                return action_toast("已拒绝")
            return action_card(build_task_card(chat_id, task_id=task_id), "已拒绝")
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


def sender_meta_from_message(data, message) -> dict[str, str]:
    sender = getattr(message, "sender", None)
    header = getattr(data, "header", None)
    sender_id = getattr(sender, "sender_id", "") or getattr(sender, "id", "")
    if isinstance(sender_id, dict):
        sender_id = sender_id.get("open_id") or sender_id.get("user_id") or sender_id.get("union_id") or json.dumps(sender_id, ensure_ascii=False)
    return {
        "sender_id": str(sender_id or ""),
        "sender_type": str(getattr(sender, "sender_type", "") or ""),
        "message_id": str(getattr(message, "message_id", "") or ""),
        "event_id": str(getattr(header, "event_id", "") or ""),
    }


def on_message(data: lark.im.v1.P2ImMessageReceiveV1):
    if is_duplicate_event(data):
        return

    msg = data.event.message
    meta = sender_meta_from_message(data, msg)
    if is_bot_message(msg):
        logger.debug(
            "ignore bot message: chat_id=%s sender_id=%s sender_type=%s message_id=%s event_id=%s",
            getattr(msg, "chat_id", ""),
            meta.get("sender_id", ""),
            meta.get("sender_type", ""),
            meta.get("message_id", ""),
            meta.get("event_id", ""),
        )
        return

    chat_id = msg.chat_id
    get_runtime(chat_id)
    content = parse_text_message(msg.content)
    if not content:
        logger.warning(
            "message received with empty parsed content: chat_id=%s sender_id=%s sender_type=%s message_id=%s event_id=%s message_type=%s raw_content=%r",
            chat_id,
            meta.get("sender_id", ""),
            meta.get("sender_type", ""),
            meta.get("message_id", ""),
            meta.get("event_id", ""),
            getattr(msg, "message_type", ""),
            getattr(msg, "content", ""),
        )
        return
    logger.info(
        "message received: chat_id=%s sender_id=%s sender_type=%s message_id=%s event_id=%s content=%r",
        chat_id,
        meta.get("sender_id", ""),
        meta.get("sender_type", ""),
        meta.get("message_id", ""),
        meta.get("event_id", ""),
        content[:80],
    )
    EVENT_QUEUE.put(("text", (chat_id, content, meta)))


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
    atexit.register(stop_power_management)
    threading.Thread(target=keep_awake_loop, name="keep-awake", daemon=True).start()
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
    send_startup_welcome()
    cli.start()


if __name__ == "__main__":
    main()
