import atexit
import hashlib
import json
import logging
import os
import queue
import re
import shlex
import shutil
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
    GetMessageResourceRequest,
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

_ORIG_ARGV = list(sys.argv)  # 保存原始 argv，防止重启时使用被修改的 sys.argv
APP_NAME = "Lark2Agent"

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
CLAUDE_HOME = Path(os.getenv("CLAUDE_HOME", Path.home() / ".claude")).expanduser()
CLAUDE_PROJECTS_DIR = Path(
    os.getenv("CLAUDE_PROJECTS_DIR", CLAUDE_HOME / "projects")
).expanduser()
QODER_HOME = Path(os.getenv("QODER_HOME", Path.home() / ".qoder")).expanduser()
QODER_PROJECTS_DIR = Path(
    os.getenv("QODER_PROJECTS_DIR", QODER_HOME / "projects")
).expanduser()
DEFAULT_CWD = Path(os.getenv("CODEX_DEFAULT_CWD", os.getcwd())).expanduser().resolve()
CODEX_BIN = os.getenv("CODEX_BIN", "codex")
CLAUDE_BIN = os.getenv("CLAUDE_BIN", "claude")
QODER_BIN = os.getenv("QODER_BIN", "qodercli")
CODEX_TIMEOUT_SECONDS = int(os.getenv("CODEX_TIMEOUT_SECONDS", "1800"))
CLAUDE_TIMEOUT_SECONDS = int(os.getenv("CLAUDE_TIMEOUT_SECONDS", str(CODEX_TIMEOUT_SECONDS)))
QODER_TIMEOUT_SECONDS = int(os.getenv("QODER_TIMEOUT_SECONDS", str(CODEX_TIMEOUT_SECONDS)))
CODEX_MODEL = os.getenv("CODEX_MODEL", "")
CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "")
QODER_MODEL = os.getenv("QODER_MODEL", "")
CLAUDE_PERMISSION_MODE = os.getenv("CLAUDE_PERMISSION_MODE", "dontAsk")
APPROVED_CLAUDE_PERMISSION_MODE = os.getenv("APPROVED_CLAUDE_PERMISSION_MODE", "acceptEdits")
CLAUDE_EXTRA_ARGS = os.getenv("CLAUDE_EXTRA_ARGS", "")
QODER_PERMISSION_MODE = os.getenv("QODER_PERMISSION_MODE", "dont_ask")
APPROVED_QODER_PERMISSION_MODE = os.getenv("APPROVED_QODER_PERMISSION_MODE", "accept_edits")
QODER_EXTRA_ARGS = os.getenv("QODER_EXTRA_ARGS", "")
DEFAULT_AGENT_ID = os.getenv("DEFAULT_AGENT_ID", "codex").strip().lower() or "codex"
CODEX_PROJECTS_ROOT_VALUE = os.getenv("CODEX_PROJECTS_ROOT", "")
CODEX_PROJECTS_ROOT = Path(CODEX_PROJECTS_ROOT_VALUE).expanduser() if CODEX_PROJECTS_ROOT_VALUE else DEFAULT_CWD.parent
CODEX_APPROVAL_POLICY = os.getenv("CODEX_APPROVAL_POLICY", "on-request")
CODEX_SANDBOX_MODE = os.getenv("CODEX_SANDBOX_MODE", "workspace-write")
APPROVED_CODEX_APPROVAL_POLICY = os.getenv("APPROVED_CODEX_APPROVAL_POLICY", "on-request")
APPROVED_CODEX_SANDBOX_MODE = os.getenv("APPROVED_CODEX_SANDBOX_MODE", "workspace-write")
CODEX_ALLOWED_ROOTS_VALUE = os.getenv("CODEX_ALLOWED_ROOTS", "")

MESSAGE_CHUNK_SIZE = int(os.getenv("LARK_MESSAGE_CHUNK_SIZE", "1800"))
FINAL_REPLY_MAX_CHARS = int(os.getenv("LARK_FINAL_REPLY_MAX_CHARS", "4000"))
FINAL_QUESTION_MAX_CHARS = int(os.getenv("LARK_FINAL_QUESTION_MAX_CHARS", "1200"))
MAX_PROJECTS_IN_PANEL = int(os.getenv("MAX_PROJECTS_IN_PANEL", "8"))
MAX_CONVERSATIONS_IN_PANEL = int(os.getenv("MAX_CONVERSATIONS_IN_PANEL", "8"))
MAX_SESSION_FILES = int(os.getenv("MAX_SESSION_FILES", "300"))
MAX_RUNNING_TASKS = int(os.getenv("MAX_RUNNING_TASKS", "6"))
MAX_RUNNING_TASKS_PER_CHAT = int(os.getenv("MAX_RUNNING_TASKS_PER_CHAT", "4"))
LARK_EVENT_QUEUE_MAXSIZE = int(os.getenv("LARK_EVENT_QUEUE_MAXSIZE", "200"))
LARK_ATTACHMENTS_DIR = os.getenv("LARK_ATTACHMENTS_DIR", ".lark2agent/attachments")
LARK_ATTACHMENT_MAX_BYTES = int(os.getenv("LARK_ATTACHMENT_MAX_BYTES", str(50 * 1024 * 1024)))
LARK_PENDING_ATTACHMENT_TTL_SECONDS = int(os.getenv("LARK_PENDING_ATTACHMENT_TTL_SECONDS", "900"))
MAX_LARK_ATTACHMENTS_PER_MESSAGE = int(os.getenv("MAX_LARK_ATTACHMENTS_PER_MESSAGE", "8"))
STATUS_INTERVAL_SECONDS = int(os.getenv("STATUS_INTERVAL_SECONDS", "0"))
TASK_CARD_REFRESH_INTERVAL_SECONDS = int(os.getenv("TASK_CARD_REFRESH_INTERVAL_SECONDS", "15"))
PENDING_APPROVAL_WAIT_SECONDS = int(os.getenv("PENDING_APPROVAL_WAIT_SECONDS", "300"))
PENDING_APPROVAL_POLL_SECONDS = int(os.getenv("PENDING_APPROVAL_POLL_SECONDS", "2"))
PLAN_MAX_PARALLEL = int(os.getenv("PLAN_MAX_PARALLEL", "3"))
PLAN_TASK_OUTPUT_MAX_CHARS = int(os.getenv("PLAN_TASK_OUTPUT_MAX_CHARS", "1200"))
PLAN_USE_WORKTREES = os.getenv("PLAN_USE_WORKTREES", "1") == "1"
PLAN_WORKTREE_ROOT = os.getenv("PLAN_WORKTREE_ROOT", "")
PLAN_TEST_COMMAND = os.getenv("PLAN_TEST_COMMAND", "git diff --check")
PLAN_TEST_COMMAND_SHELL = os.getenv("PLAN_TEST_COMMAND_SHELL", "0") == "1"
PLAN_TEST_TIMEOUT_SECONDS = int(os.getenv("PLAN_TEST_TIMEOUT_SECONDS", "120"))
DAILY_REPORT_TIME = os.getenv("DAILY_REPORT_TIME", "19:00")
STATE_FILE = Path(os.getenv("LARK2AGENT_STATE_FILE", os.getenv("LARK_CODEX_STATE_FILE", ".lark2agent_state.json")))
LARK2AGENT_SHOW_ARCHIVED = os.getenv("LARK2AGENT_SHOW_ARCHIVED", os.getenv("LARK_CODEX_SHOW_ARCHIVED", "0")) == "1"
LARK2AGENT_INCLUDE_PLAN_WORKTREES = os.getenv(
    "LARK2AGENT_INCLUDE_PLAN_WORKTREES",
    os.getenv("LARK_CODEX_INCLUDE_PLAN_WORKTREES", "0"),
) == "1"
MAX_LARK_MESSAGE_REFS = int(os.getenv("MAX_LARK_MESSAGE_REFS", "1000"))
LARK2AGENT_WELCOME_MESSAGE = os.getenv(
    "LARK2AGENT_WELCOME_MESSAGE",
    os.getenv(
        "LARK_CODEX_WELCOME_MESSAGE",
        "I'm Lark2Agent, a lightweight multi-agent bridge for Lark.",
    ),
)
SYNC_DESKTOP_SESSIONS = os.getenv("SYNC_DESKTOP_SESSIONS", "0") == "1"
SESSION_WATCH_INTERVAL_SECONDS = int(os.getenv("SESSION_WATCH_INTERVAL_SECONDS", "3"))
KEEP_AWAKE_ON_AC_POWER = os.getenv("KEEP_AWAKE_ON_AC_POWER", "1") == "1"
KEEP_AWAKE_CHECK_INTERVAL_SECONDS = int(os.getenv("KEEP_AWAKE_CHECK_INTERVAL_SECONDS", "60"))
KEEP_AWAKE_DISABLE_SLEEP = os.getenv("KEEP_AWAKE_DISABLE_SLEEP", "0") == "1"
LARK_ALLOWED_CHAT_IDS_VALUE = os.getenv("LARK_ALLOWED_CHAT_IDS", "")
LARK_ALLOWED_OPEN_IDS_VALUE = os.getenv("LARK_ALLOWED_OPEN_IDS", "")
LARK_ADMIN_OPEN_IDS_VALUE = os.getenv("LARK_ADMIN_OPEN_IDS", "")
LARK_REQUIRE_KNOWN_CHAT = os.getenv("LARK_REQUIRE_KNOWN_CHAT", "1") == "1"
LARK_CARD_ENABLE_FORWARD = os.getenv("LARK_CARD_ENABLE_FORWARD", "0") == "1"
LOG_MESSAGE_CONTENT = os.getenv("LOG_MESSAGE_CONTENT", "0") == "1"
# =================================================


def parse_csv_set(value: str) -> set[str]:
    return {
        item.strip()
        for item in re.split(r"[,;\s]+", str(value or ""))
        if item.strip()
    }


LARK_ALLOWED_CHAT_IDS = parse_csv_set(LARK_ALLOWED_CHAT_IDS_VALUE)
LARK_ALLOWED_OPEN_IDS = parse_csv_set(LARK_ALLOWED_OPEN_IDS_VALUE)
LARK_ADMIN_OPEN_IDS = parse_csv_set(LARK_ADMIN_OPEN_IDS_VALUE)

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(threadName)s %(message)s",
)
logger = logging.getLogger("lark2agent-ws")


@dataclass
class ConversationInfo:
    session_id: str
    file: Path
    agent_id: str = "codex"
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
    active_agent_id: str = DEFAULT_AGENT_ID
    active_project_key: str = ""
    active_session_id: str = ""
    task_message_id: str = ""
    task_prompt: str = ""
    task_status: str = ""
    task_output: str = ""
    task_agent_id: str = DEFAULT_AGENT_ID
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
    guidance_task_id: str = ""


@dataclass
class CodexTaskRuntime:
    task_id: str
    chat_id: str
    cwd: Path
    prompt: str
    agent_id: str = "codex"
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
    permission_mode: str = ""
    approved_retry: bool = False
    force_ordinary: bool = False
    last_message_path: str = ""
    source_message_id: str = ""
    queued_for_session: bool = False
    guidance_requested: bool = False
    guidance_messages: list[str] = field(default_factory=list)
    cancel_requested: bool = False
    attachments: list[dict[str, Any]] = field(default_factory=list)
    one_shot_agent: bool = False


@dataclass
class LarkAttachment:
    kind: str
    file_key: str
    message_id: str
    file_name: str = ""
    local_path: str = ""
    size: int = 0
    content_type: str = ""


@dataclass
class LarkReferenceContext:
    message_id: str = ""
    task_id: str = ""
    session_id: str = ""
    cwd: str = ""
    text: str = ""
    source: str = ""
    attachments: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class DesktopSyncRuntime:
    chat_id: str
    session_id: str
    cwd: str
    title: str = ""
    message_id: str = ""
    prompt: str = ""
    status: str = "监听中"
    output: str = ""
    updated_at: float = field(default_factory=time.time)
    last_card_update_at: float = 0


@dataclass
class PendingApproval:
    approval_id: str
    chat_id: str
    task_id: str
    agent_id: str
    session_id: str
    cwd: str
    command: str
    reason: str
    model: str = ""
    original_prompt: str = ""
    resume_prompt: str = ""
    status: str = "pending"
    created_at: float = field(default_factory=time.time)
    one_shot_agent: bool = False


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
    phase: str = ""
    depends_on: list[str] = field(default_factory=list)
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
    retry_count: int = 0
    merge_status: str = ""
    cleanup_status: str = ""
    branch_cleanup_status: str = ""


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
    merge_status: str = ""
    merge_output: str = ""


RUNTIMES: dict[str, ChatRuntime] = {}
TASKS: dict[str, CodexTaskRuntime] = {}
DESKTOP_SYNCS: dict[tuple[str, str], DesktopSyncRuntime] = {}
PENDING_APPROVALS: dict[str, PendingApproval] = {}
PENDING_RESTARTS: dict[str, PendingRestart] = {}
PLANS: dict[str, PlanRuntime] = {}
LOCK = threading.RLock()
SEND_LOCK = threading.RLock()
PLAN_LOCK = threading.RLock()
SESSION_RUN_LOCKS: dict[str, threading.Lock] = {}
PENDING_LARK_ATTACHMENTS: dict[str, list[dict[str, Any]]] = {}
CLIENT = None
EVENT_HANDLER = None
STOP_SCHEDULER = threading.Event()
EVENT_QUEUE: queue.Queue[tuple[str, tuple[Any, ...]]] = queue.Queue(maxsize=max(1, LARK_EVENT_QUEUE_MAXSIZE))
SESSION_WATCH_OFFSETS: dict[tuple[str, str], int] = {}
SESSION_SYNC_SEEN: set[str] = set()
KEEP_AWAKE_PROCESS: Optional[subprocess.Popen] = None
KEEP_AWAKE_LOCK = threading.RLock()
DISABLE_SLEEP_APPLIED = False


def normalize_agent_id(agent_id: str = "") -> str:
    value = str(agent_id or "").strip().lower()
    aliases = {
        "": DEFAULT_AGENT_ID,
        "code": "codex",
        "codexcli": "codex",
        "codex-cli": "codex",
        "claude-code": "claude",
        "claudecode": "claude",
        "claudecli": "claude",
        "claude-cli": "claude",
        "qoder": "qoder",
        "qoder-cli": "qoder",
        "qodercli": "qoder",
    }
    value = aliases.get(value, value)
    return value if value in AGENT_ADAPTERS else "codex"


def conversation_key(agent_id: str, session_id: str) -> str:
    agent_id = normalize_agent_id(agent_id)
    session_id = str(session_id or "")
    if not session_id:
        return ""
    return session_id if agent_id == "codex" else f"{agent_id}:{session_id}"


def split_conversation_key(value: str) -> tuple[str, str]:
    text = str(value or "")
    if ":" in text:
        prefix, rest = text.split(":", 1)
        agent_id = normalize_agent_id(prefix)
        if agent_id != "codex" and rest:
            return agent_id, rest
    return "codex", text


def agent_label(agent_id: str) -> str:
    return AGENT_ADAPTERS[normalize_agent_id(agent_id)].label


def active_agent_id(runtime: ChatRuntime) -> str:
    return normalize_agent_id(runtime.active_agent_id or DEFAULT_AGENT_ID)


def set_runtime_agent(runtime: ChatRuntime, agent_id: str):
    agent_id = normalize_agent_id(agent_id)
    previous_agent_id = normalize_agent_id(runtime.active_agent_id)
    current_conv = get_active_conversation(runtime.active_session_id or runtime.task_session_id)
    runtime.active_agent_id = agent_id
    runtime.task_agent_id = agent_id
    if previous_agent_id != agent_id and (not current_conv or normalize_agent_id(current_conv.agent_id) != agent_id):
        runtime.active_session_id = ""
        runtime.task_session_id = ""
        runtime.task_message_id = ""
        runtime.task_prompt = ""
        runtime.task_status = ""
        runtime.task_output = ""


def task_agent_id(task: Optional[CodexTaskRuntime], runtime: Optional[ChatRuntime] = None) -> str:
    if task:
        return normalize_agent_id(task.agent_id)
    if runtime:
        return normalize_agent_id(runtime.task_agent_id or runtime.active_agent_id)
    return normalize_agent_id(DEFAULT_AGENT_ID)


def agent_model_label(agent_id: str, model: str = "") -> str:
    adapter = AGENT_ADAPTERS[normalize_agent_id(agent_id)]
    return model or adapter.default_model or "默认"


def default_permission_mode(agent_id: str) -> str:
    agent_id = normalize_agent_id(agent_id)
    if agent_id == "claude":
        return CLAUDE_PERMISSION_MODE
    if agent_id == "qoder":
        return QODER_PERMISSION_MODE
    return ""


def approved_permission_mode(agent_id: str) -> str:
    agent_id = normalize_agent_id(agent_id)
    if agent_id == "claude":
        return APPROVED_CLAUDE_PERMISSION_MODE
    if agent_id == "qoder":
        return APPROVED_QODER_PERMISSION_MODE
    return ""


def approved_retry_text(agent_id: str, label: str = "") -> str:
    agent_id = normalize_agent_id(agent_id)
    label = label or agent_label(agent_id)
    if agent_id == "codex":
        return f"批准后会用 `{APPROVED_CODEX_SANDBOX_MODE}` / `{APPROVED_CODEX_APPROVAL_POLICY}` 单次重试；"
    permission_mode = approved_permission_mode(agent_id)
    if permission_mode:
        return f"批准后会用 {label} 适配器和 `{permission_mode}` permission mode 重试原任务；"
    return f"批准后会用 {label} 适配器单次重试原任务；"


class AgentAdapter:
    id = "agent"
    label = "Agent"
    bin_name = ""
    default_model = ""
    timeout_seconds = CODEX_TIMEOUT_SECONDS
    supports_resume = True

    def build_command(self, task: CodexTaskRuntime, last_message_file: Optional[Path] = None) -> list[str]:
        raise NotImplementedError

    def parse_events(self, line: str) -> list[tuple[str, str]]:
        raise NotImplementedError

    def is_resumable(self, conv: Optional[ConversationInfo]) -> bool:
        return bool(conv and conv.agent_id == self.id)

    def raw_session_id(self, value: str) -> str:
        agent_id, session_id = split_conversation_key(value)
        return session_id if agent_id == self.id else value


class CodexAdapter(AgentAdapter):
    id = "codex"
    label = "Codex"
    bin_name = CODEX_BIN
    default_model = CODEX_MODEL
    timeout_seconds = CODEX_TIMEOUT_SECONDS

    def build_command(self, task: CodexTaskRuntime, last_message_file: Optional[Path] = None) -> list[str]:
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
        if self.is_resumable(conv):
            return common + ["resume", "--json", "--skip-git-repo-check", task.session_id, task.prompt]
        return common + ["--json", "--skip-git-repo-check", "-C", str(task.cwd), task.prompt]

    def parse_events(self, line: str) -> list[tuple[str, str]]:
        return [parse_codex_json_event(line)]

    def is_resumable(self, conv: Optional[ConversationInfo]) -> bool:
        if not conv or conv.agent_id != self.id:
            return False
        return conv.originator == "codex_exec" or conv.source == "exec"


def extract_claude_text_content(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        if value.get("type") == "text" and value.get("text"):
            return str(value.get("text"))
        if value.get("type") == "tool_use":
            name = value.get("name") or "tool"
            tool_input = short_text(value.get("input", ""), 240)
            return f"调用工具：{name}\n{tool_input}".strip()
        if value.get("type") == "tool_result":
            return f"工具结果：\n{short_text(value.get('content', ''), 900)}"
        return extract_claude_text_content(value.get("content") or value.get("message") or value.get("result") or "")
    if isinstance(value, list):
        parts = [extract_claude_text_content(item) for item in value]
        return "\n".join(part for part in parts if part).strip()
    return ""


class ClaudeAdapter(AgentAdapter):
    id = "claude"
    label = "Claude Code"
    bin_name = CLAUDE_BIN
    default_model = CLAUDE_MODEL
    timeout_seconds = CLAUDE_TIMEOUT_SECONDS

    def build_command(self, task: CodexTaskRuntime, last_message_file: Optional[Path] = None) -> list[str]:
        argv = [CLAUDE_BIN, "--print", "--output-format", "stream-json", "--verbose"]
        model = task.model or CLAUDE_MODEL
        if model:
            argv.extend(["--model", model])
        permission_mode = task.permission_mode or CLAUDE_PERMISSION_MODE
        if permission_mode:
            argv.extend(["--permission-mode", permission_mode])
        if task.session_id:
            argv.extend(["--resume", self.raw_session_id(task.session_id)])
        if CLAUDE_EXTRA_ARGS:
            for _a in shlex.split(CLAUDE_EXTRA_ARGS):
                if re.match(r'--?[\w][\w\-=./]*$', _a):
                    argv.append(_a)
                else:
                    logger.warning('CLAUDE_EXTRA_ARGS skipping unsafe arg: %r', _a)
        argv.append(task.prompt)
        return argv

    def parse_events(self, line: str) -> list[tuple[str, str]]:
        raw = line.strip()
        if not raw:
            return [("skip", "")]
        try:
            obj = json.loads(raw)
        except json.JSONDecodeError:
            return [("text", raw)]

        events: list[tuple[str, str]] = []
        session_id = obj.get("session_id") or obj.get("sessionId")
        if session_id:
            events.append(("session_id", str(session_id)))

        typ = str(obj.get("type") or "")
        if typ == "system":
            subtype = obj.get("subtype") or obj.get("event") or "init"
            if subtype not in ("init", "ready"):
                events.append(("progress", f"Claude 系统事件：{subtype}"))
        elif typ == "assistant":
            text = extract_claude_text_content(obj.get("message") or obj.get("content"))
            if text:
                events.append(("message", text))
        elif typ == "user":
            text = extract_claude_text_content(obj.get("message") or obj.get("content"))
            if text and "tool_result" in raw:
                events.append(("tool_output", text))
        elif typ == "result":
            result = obj.get("result") or obj.get("message") or ""
            error = obj.get("error") or obj.get("is_error")
            text = extract_claude_text_content(result) or short_text(raw, 1200)
            events.append(("tool_output" if error else "complete", text))
        elif typ in ("tool_use", "tool_result"):
            events.append(("tool_output", extract_claude_text_content(obj)))
        else:
            text = extract_claude_text_content(obj.get("message") or obj.get("content") or obj.get("result"))
            events.append(("message", text) if text else ("skip", ""))
        return events or [("skip", "")]

    def is_resumable(self, conv: Optional[ConversationInfo]) -> bool:
        return bool(conv and conv.agent_id == self.id and conv.session_id)


class QoderAdapter(AgentAdapter):
    id = "qoder"
    label = "Qoder CLI"
    bin_name = QODER_BIN
    default_model = QODER_MODEL
    timeout_seconds = QODER_TIMEOUT_SECONDS

    def build_command(self, task: CodexTaskRuntime, last_message_file: Optional[Path] = None) -> list[str]:
        argv = [QODER_BIN, "--print", "--output-format", "stream-json", "--cwd", str(task.cwd)]
        model = task.model or QODER_MODEL
        if model:
            argv.extend(["--model", model])
        permission_mode = task.permission_mode or QODER_PERMISSION_MODE
        if permission_mode:
            argv.extend(["--permission-mode", permission_mode])
        if task.session_id:
            argv.extend(["--resume", self.raw_session_id(task.session_id)])
        if QODER_EXTRA_ARGS:
            for _a in shlex.split(QODER_EXTRA_ARGS):
                if re.match(r'--?[\w][\w\-=./]*$', _a):
                    argv.append(_a)
                else:
                    logger.warning('QODER_EXTRA_ARGS skipping unsafe arg: %r', _a)
        argv.append(task.prompt)
        return argv

    def parse_events(self, line: str) -> list[tuple[str, str]]:
        return parse_qoder_json_event(line)

    def is_resumable(self, conv: Optional[ConversationInfo]) -> bool:
        return bool(conv and conv.agent_id == self.id and conv.session_id)


def parse_qoder_json_event(line: str) -> list[tuple[str, str]]:
    raw = line.strip()
    if not raw:
        return [("skip", "")]
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError:
        return [("text", raw)]

    events: list[tuple[str, str]] = []
    session_id = obj.get("session_id") or obj.get("sessionId")
    if session_id:
        events.append(("session_id", str(session_id)))

    typ = str(obj.get("type") or "")
    if typ == "system":
        subtype = obj.get("subtype") or obj.get("event") or "init"
        if subtype not in ("init", "ready"):
            content = extract_claude_text_content(obj.get("content"))
            events.append(("progress", content or f"Qoder 系统事件：{subtype}"))
    elif typ == "assistant":
        text = extract_claude_text_content(obj.get("message") or obj.get("content"))
        if text:
            events.append(("message", text))
    elif typ == "user":
        text = extract_claude_text_content(obj.get("message") or obj.get("content"))
        if text and "tool_result" in raw:
            events.append(("tool_output", text))
    elif typ == "result":
        result = obj.get("result") or obj.get("message") or ""
        errors = obj.get("errors") or []
        error = obj.get("error") or obj.get("is_error") or bool(errors)
        text = extract_claude_text_content(result)
        if not text and errors:
            text = "\n".join(str(item) for item in errors if item)
        text = text or short_text(raw, 1200)
        events.append(("tool_output" if error else "complete", text))
    elif typ in ("tool_use", "tool_result"):
        events.append(("tool_output", extract_claude_text_content(obj)))
    else:
        text = extract_claude_text_content(obj.get("message") or obj.get("content") or obj.get("result"))
        events.append(("message", text) if text else ("skip", ""))
    return events or [("skip", "")]


AGENT_ADAPTERS: dict[str, AgentAdapter] = {
    "codex": CodexAdapter(),
    "claude": ClaudeAdapter(),
    "qoder": QoderAdapter(),
}


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
    try:
        tmp.chmod(0o600)
    except OSError:
        logger.exception("failed to chmod state tmp file")
    tmp.replace(STATE_FILE)
    try:
        STATE_FILE.chmod(0o600)
    except OSError:
        logger.exception("failed to chmod state file")


def lark_message_ref_key(chat_id: str, message_id: str) -> str:
    return f"{chat_id}:{message_id}"


def prune_lark_message_refs(refs: dict[str, Any]):
    if MAX_LARK_MESSAGE_REFS <= 0 or len(refs) <= MAX_LARK_MESSAGE_REFS:
        return
    ordered = sorted(
        refs.items(),
        key=lambda item: float((item[1] or {}).get("updated_at", 0) or 0),
        reverse=True,
    )
    refs.clear()
    refs.update(dict(ordered[:MAX_LARK_MESSAGE_REFS]))


def record_lark_message_ref(
    chat_id: str,
    message_id: str,
    *,
    task_id: str = "",
    session_id: str = "",
    cwd: str = "",
    text: str = "",
    source: str = "",
    root_id: str = "",
    parent_id: str = "",
    thread_id: str = "",
    attachments: Optional[list[dict[str, Any]]] = None,
):
    if not is_valid_chat_id(chat_id) or not message_id:
        return
    state = read_state()
    refs = state.setdefault("message_refs", {})
    key = lark_message_ref_key(chat_id, message_id)
    existing = refs.get(key, {}) if isinstance(refs.get(key), dict) else {}
    updated = dict(existing)
    updated.update(
        {
            "chat_id": chat_id,
            "message_id": message_id,
            "updated_at": time.time(),
        }
    )
    for field_name, value in (
        ("task_id", task_id),
        ("session_id", session_id),
        ("cwd", cwd),
        ("text", final_reply_text(text, 3000) if text else ""),
        ("source", source),
        ("root_id", root_id),
        ("parent_id", parent_id),
        ("thread_id", thread_id),
    ):
        if value:
            updated[field_name] = str(value)
    if attachments is not None:
        updated["attachments"] = normalize_attachment_dicts(attachments)
    refs[key] = updated
    prune_lark_message_refs(refs)
    write_state(state)


def find_lark_message_ref(chat_id: str, message_id: str, state: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    if not chat_id or not message_id:
        return {}
    state = state or read_state()
    ref = state.get("message_refs", {}).get(lark_message_ref_key(chat_id, message_id), {})
    return ref if isinstance(ref, dict) else {}


def find_lark_thread_ref(chat_id: str, reference_ids: list[str], state: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    if not chat_id or not reference_ids:
        return {}
    state = state or read_state()
    refs = state.get("message_refs", {})
    if not isinstance(refs, dict):
        return {}
    wanted = set(reference_ids)
    candidates = []
    for ref in refs.values():
        if not isinstance(ref, dict) or ref.get("chat_id") != chat_id:
            continue
        if ref.get("root_id") in wanted or ref.get("thread_id") in wanted or ref.get("parent_id") in wanted:
            candidates.append(ref)
    if not candidates:
        return {}
    return max(candidates, key=lambda item: float(item.get("updated_at", 0) or 0))


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
            "active_agent_id": runtime.active_agent_id,
            "active_project_key": runtime.active_project_key,
            "active_session_id": runtime.active_session_id,
            "task_message_id": runtime.task_message_id,
            "task_prompt": runtime.task_prompt,
            "task_status": runtime.task_status,
            "task_output": runtime.task_output,
            "task_agent_id": runtime.task_agent_id,
            "task_model": runtime.task_model,
            "task_session_id": runtime.task_session_id,
            "task_cwd": runtime.task_cwd,
            "task_started_at": runtime.task_started_at,
            "last_daily_sent_date": runtime.last_daily_sent_date,
            "send_disabled": runtime.send_disabled,
            "last_approval_fingerprint": runtime.last_approval_fingerprint,
            "active_plan_id": runtime.active_plan_id,
            "guidance_task_id": runtime.guidance_task_id,
        }
        write_state(state)


def load_known_chats():
    state = read_state()
    now = time.time()
    for chat_id, data in state.get("chats", {}).items():
        cwd = Path(data.get("cwd") or DEFAULT_CWD).expanduser()
        RUNTIMES[chat_id] = ChatRuntime(
            cwd=cwd,
            active_agent_id=data.get("active_agent_id", DEFAULT_AGENT_ID),
            active_project_key=data.get("active_project_key", ""),
            active_session_id=data.get("active_session_id", ""),
            task_message_id=data.get("task_message_id", ""),
            task_prompt=data.get("task_prompt", ""),
            task_status=data.get("task_status", ""),
            task_output=data.get("task_output", ""),
            task_agent_id=data.get("task_agent_id", DEFAULT_AGENT_ID),
            task_model=data.get("task_model", ""),
            task_session_id=data.get("task_session_id", ""),
            task_cwd=data.get("task_cwd", ""),
            task_started_at=float(data.get("task_started_at", 0) or 0),
            last_daily_sent_date=data.get("last_daily_sent_date", ""),
            send_disabled=bool(data.get("send_disabled", False)),
            last_approval_fingerprint=data.get("last_approval_fingerprint", ""),
            active_plan_id=data.get("active_plan_id", ""),
            guidance_task_id=data.get("guidance_task_id", ""),
        )
        RUNTIMES[chat_id].last_status_sent_at = now


def plan_task_to_state(task: PlanTask) -> dict[str, Any]:
    return {
        "task_id": task.task_id,
        "title": task.title,
        "prompt": task.prompt,
        "model": task.model,
        "phase": task.phase,
        "depends_on": list(task.depends_on or []),
        "status": task.status,
        "session_id": task.session_id,
        "output": task.output,
        "started_at": task.started_at,
        "finished_at": task.finished_at,
        "approved_retry": task.approved_retry,
        "approval_required": task.approval_required,
        "worktree_path": task.worktree_path,
        "branch_name": task.branch_name,
        "base_head": task.base_head,
        "diff_summary": task.diff_summary,
        "test_summary": task.test_summary,
        "commit_message": task.commit_message,
        "commit_hash": task.commit_hash,
        "retry_count": task.retry_count,
        "merge_status": task.merge_status,
        "cleanup_status": task.cleanup_status,
        "branch_cleanup_status": task.branch_cleanup_status,
    }


def plan_task_from_state(data: dict[str, Any]) -> PlanTask:
    status = str(data.get("status", "pending") or "pending")
    if status in ("running", "pending", "approval"):
        status = "failed"
        output = str(data.get("output", "") or "")
        output = (output + "\n\n" if output else "") + "脚本重启后恢复：该子任务原本未结束，已标记为失败，需要手动重试。"
    else:
        output = str(data.get("output", "") or "")
    return PlanTask(
        task_id=str(data.get("task_id", "") or ""),
        title=str(data.get("title", "") or ""),
        prompt=str(data.get("prompt", "") or data.get("title", "") or ""),
        model=str(data.get("model", "") or ""),
        phase=str(data.get("phase", "") or ""),
        depends_on=[str(item) for item in data.get("depends_on", []) if item],
        status=status,
        session_id=str(data.get("session_id", "") or ""),
        output=output,
        started_at=float(data.get("started_at", 0) or 0),
        finished_at=float(data.get("finished_at", 0) or 0),
        approved_retry=bool(data.get("approved_retry", False)),
        approval_required=bool(data.get("approval_required", False)),
        worktree_path=str(data.get("worktree_path", "") or ""),
        branch_name=str(data.get("branch_name", "") or ""),
        base_head=str(data.get("base_head", "") or ""),
        diff_summary=str(data.get("diff_summary", "") or ""),
        test_summary=str(data.get("test_summary", "") or ""),
        commit_message=str(data.get("commit_message", "") or ""),
        commit_hash=str(data.get("commit_hash", "") or ""),
        retry_count=int(data.get("retry_count", 0) or 0),
        merge_status=str(data.get("merge_status", "") or ""),
        cleanup_status=str(data.get("cleanup_status", "") or ""),
        branch_cleanup_status=str(data.get("branch_cleanup_status", "") or ""),
    )


def plan_to_state(plan: PlanRuntime) -> dict[str, Any]:
    return {
        "plan_id": plan.plan_id,
        "chat_id": plan.chat_id,
        "cwd": str(plan.cwd),
        "tasks": [plan_task_to_state(task) for task in plan.tasks],
        "max_parallel": plan.max_parallel,
        "message_id": plan.message_id,
        "status": plan.status,
        "created_at": plan.created_at,
        "stop_requested": plan.stop_requested,
        "merge_status": plan.merge_status,
        "merge_output": plan.merge_output,
    }


def plan_from_state(data: dict[str, Any]) -> Optional[PlanRuntime]:
    plan_id = str(data.get("plan_id", "") or "")
    chat_id = str(data.get("chat_id", "") or "")
    if not plan_id or not is_valid_chat_id(chat_id):
        return None
    tasks = [
        task for task in (plan_task_from_state(item) for item in data.get("tasks", []))
        if task.task_id and task.prompt
    ]
    if not tasks:
        return None
    return PlanRuntime(
        plan_id=plan_id,
        chat_id=chat_id,
        cwd=Path(data.get("cwd") or DEFAULT_CWD).expanduser(),
        tasks=tasks,
        max_parallel=int(data.get("max_parallel", PLAN_MAX_PARALLEL) or PLAN_MAX_PARALLEL),
        message_id=str(data.get("message_id", "") or ""),
        status=str(data.get("status", "") or "pending"),
        created_at=float(data.get("created_at", time.time()) or time.time()),
        stop_requested=bool(data.get("stop_requested", False)),
        merge_status=str(data.get("merge_status", "") or ""),
        merge_output=str(data.get("merge_output", "") or ""),
    )


def save_plans_state():
    with PLAN_LOCK:
        plans = {plan_id: plan_to_state(plan) for plan_id, plan in PLANS.items()}
    state = read_state()
    state["plans"] = plans
    write_state(state)


def load_plans_state():
    state = read_state()
    restored: dict[str, PlanRuntime] = {}
    for plan_id, data in state.get("plans", {}).items():
        if not isinstance(data, dict):
            continue
        plan = plan_from_state(data)
        if plan:
            restored[plan_id] = plan
    with PLAN_LOCK:
        PLANS.update(restored)
    if restored:
        logger.info("restored %s plan runtime records from state", len(restored))


def get_runtime(chat_id: str) -> ChatRuntime:
    with LOCK:
        runtime = RUNTIMES.get(chat_id)
        if runtime is None:
            runtime = ChatRuntime(cwd=DEFAULT_CWD, last_status_sent_at=time.time())
            RUNTIMES[chat_id] = runtime
            save_runtime(chat_id)
        return runtime


def send_startup_welcome():
    message = LARK2AGENT_WELCOME_MESSAGE.strip()
    if not message:
        return
    with LOCK:
        chat_ids = [
            chat_id
            for chat_id, runtime in RUNTIMES.items()
            if chat_is_allowed(chat_id) and not runtime.send_disabled
        ]
    for chat_id in chat_ids:
        send_msg(chat_id, message)


def session_run_lock(session_id: str, agent_id: str = "codex") -> Optional[threading.Lock]:
    if not session_id:
        return None
    key = conversation_key(agent_id, session_id) or session_id
    with LOCK:
        lock = SESSION_RUN_LOCKS.get(key)
        if lock is None:
            lock = threading.Lock()
            SESSION_RUN_LOCKS[key] = lock
        return lock


def is_valid_chat_id(chat_id: str) -> bool:
    return isinstance(chat_id, str) and chat_id.startswith("oc_") and len(chat_id) > 10


def wildcard_enabled(values: set[str]) -> bool:
    return "*" in values or "all" in {item.lower() for item in values}


def known_chat_ids() -> set[str]:
    ids = {chat_id for chat_id in RUNTIMES if is_valid_chat_id(chat_id)}
    ids.update(
        chat_id
        for chat_id in read_state().get("chats", {})
        if is_valid_chat_id(chat_id)
    )
    return ids


def chat_is_allowed(chat_id: str) -> bool:
    if not is_valid_chat_id(chat_id):
        return False
    if wildcard_enabled(LARK_ALLOWED_CHAT_IDS):
        return True
    if LARK_ALLOWED_CHAT_IDS:
        return chat_id in LARK_ALLOWED_CHAT_IDS
    if not LARK_REQUIRE_KNOWN_CHAT:
        return True
    return chat_id in known_chat_ids()


def sender_is_allowed(sender_id: str) -> bool:
    if wildcard_enabled(LARK_ALLOWED_OPEN_IDS) or not LARK_ALLOWED_OPEN_IDS:
        return True
    return bool(sender_id) and sender_id in LARK_ALLOWED_OPEN_IDS


def sender_is_admin(sender_id: str) -> bool:
    if wildcard_enabled(LARK_ADMIN_OPEN_IDS):
        return True
    if LARK_ADMIN_OPEN_IDS:
        return bool(sender_id) and sender_id in LARK_ADMIN_OPEN_IDS
    if LARK_ALLOWED_OPEN_IDS:
        return sender_is_allowed(sender_id)
    return True


def is_authorized_lark_event(
    chat_id: str,
    sender_id: str = "",
    admin_required: bool = False,
) -> bool:
    if not chat_is_allowed(chat_id):
        logger.warning("reject unauthorized chat: chat_id=%s", chat_id)
        return False
    if not sender_is_allowed(sender_id):
        logger.warning("reject unauthorized sender: chat_id=%s sender_id=%s", chat_id, sender_id)
        return False
    if admin_required and not sender_is_admin(sender_id):
        logger.warning("reject non-admin action: chat_id=%s sender_id=%s", chat_id, sender_id)
        return False
    return True


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


def parse_lark_json_content(raw_content: str) -> Any:
    raw_content = (raw_content or "").strip()
    if not raw_content:
        return {}
    try:
        return json.loads(raw_content)
    except json.JSONDecodeError:
        return {}


def parse_lark_message_text(raw_content: str, message_type: str = "") -> str:
    if str(message_type or "").lower() in ("image", "file"):
        return ""
    return parse_text_message(raw_content)


def parse_int_value(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def parse_float_value(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0


def normalize_attachment_dicts(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, LarkAttachment):
        value = [value]
    if not isinstance(value, list):
        return []
    result: list[dict[str, Any]] = []
    for item in value:
        if isinstance(item, LarkAttachment):
            raw = {
                "kind": item.kind,
                "file_key": item.file_key,
                "message_id": item.message_id,
                "file_name": item.file_name,
                "local_path": item.local_path,
                "size": item.size,
                "content_type": item.content_type,
            }
        elif isinstance(item, dict):
            raw = item
        else:
            continue
        normalized = {
            "kind": str(raw.get("kind", "") or ""),
            "file_key": str(raw.get("file_key", "") or raw.get("image_key", "") or ""),
            "message_id": str(raw.get("message_id", "") or ""),
            "file_name": str(raw.get("file_name", "") or raw.get("name", "") or ""),
            "local_path": str(raw.get("local_path", "") or raw.get("path", "") or ""),
            "size": parse_int_value(raw.get("size") or raw.get("file_size")),
            "content_type": str(raw.get("content_type", "") or ""),
            "created_at": parse_float_value(raw.get("created_at", 0)),
        }
        if normalized["file_key"] or normalized["local_path"]:
            result.append(normalized)
    return result


def collect_lark_attachment_specs(value: Any, default_kind: str = "") -> list[dict[str, Any]]:
    specs: list[dict[str, Any]] = []

    def visit(node: Any):
        if isinstance(node, list):
            for child in node:
                visit(child)
            return
        if not isinstance(node, dict):
            return

        image_key = node.get("image_key") or node.get("imageKey")
        if image_key:
            specs.append(
                {
                    "kind": "image",
                    "file_key": str(image_key),
                    "file_name": node.get("file_name") or node.get("name") or "",
                    "size": parse_int_value(node.get("file_size") or node.get("size")),
                }
            )

        file_key = node.get("file_key") or node.get("fileKey")
        if file_key:
            kind = "image" if default_kind == "image" else "file"
            specs.append(
                {
                    "kind": kind,
                    "file_key": str(file_key),
                    "file_name": node.get("file_name") or node.get("name") or "",
                    "size": parse_int_value(node.get("file_size") or node.get("size")),
                }
            )

        for child in node.values():
            if isinstance(child, (dict, list)):
                visit(child)

    visit(value)

    deduped: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for spec in specs:
        key = (str(spec.get("kind", "")), str(spec.get("file_key", "")))
        if not key[1] or key in seen:
            continue
        seen.add(key)
        deduped.append(spec)
        if MAX_LARK_ATTACHMENTS_PER_MESSAGE > 0 and len(deduped) >= MAX_LARK_ATTACHMENTS_PER_MESSAGE:
            break
    return deduped


def sanitize_lark_filename(value: str, fallback: str) -> str:
    name = Path(str(value or "")).name.strip() or fallback
    name = re.sub(r"[\x00-\x1f/\\:]+", "_", name).strip(" .")
    return (name or fallback)[:180]


def default_lark_attachment_filename(kind: str, file_key: str) -> str:
    suffix = ".png" if kind == "image" else ".bin"
    safe_key = re.sub(r"[^A-Za-z0-9_-]+", "_", str(file_key or ""))[:24] or "resource"
    return f"{kind}-{safe_key}{suffix}"


def unique_lark_attachment_path(directory: Path, filename: str) -> Path:
    path = directory / filename
    if not path.exists():
        return path
    stem = path.stem
    suffix = path.suffix
    for index in range(2, 1000):
        candidate = directory / f"{stem}-{index}{suffix}"
        if not candidate.exists():
            return candidate
    return directory / f"{stem}-{int(time.time())}{suffix}"


def lark_attachment_base_dir(runtime: ChatRuntime) -> Path:
    base = Path(LARK_ATTACHMENTS_DIR).expanduser()
    if not base.is_absolute():
        base = runtime_task_cwd(runtime) / base
    base.mkdir(parents=True, exist_ok=True)
    try:
        base.chmod(0o700)
    except OSError:
        logger.exception("failed to chmod attachment dir: %s", base)
    return base


def download_lark_message_attachments(chat_id: str, msg, meta: dict[str, str]) -> tuple[list[dict[str, Any]], list[str]]:
    message_type = str(getattr(msg, "message_type", "") or "").lower()
    payload = parse_lark_json_content(getattr(msg, "content", "") or "")
    specs = collect_lark_attachment_specs(payload, default_kind=message_type)
    if not specs:
        return [], []

    runtime = get_runtime(chat_id)
    message_id = meta.get("message_id") or str(getattr(msg, "message_id", "") or "")
    if not message_id:
        return [], ["附件下载失败：缺少 Lark message_id"]
    target_dir = lark_attachment_base_dir(runtime) / chat_id / (message_id or hashlib.sha1(str(time.time()).encode()).hexdigest()[:10])
    target_dir.mkdir(parents=True, exist_ok=True)
    attachments: list[dict[str, Any]] = []
    errors: list[str] = []

    for spec in specs:
        kind = str(spec.get("kind") or "file")
        file_key = str(spec.get("file_key") or "")
        declared_size = parse_int_value(spec.get("size"))
        if not file_key:
            continue
        if LARK_ATTACHMENT_MAX_BYTES > 0 and declared_size > LARK_ATTACHMENT_MAX_BYTES:
            errors.append(f"{kind} 超过大小限制：{declared_size} bytes")
            continue

        req = (
            GetMessageResourceRequest.builder()
            .message_id(message_id)
            .file_key(file_key)
            .type(kind)
            .build()
        )
        try:
            resp = get_client().im.v1.message_resource.get(req)
            if not response_ok(resp):
                code = getattr(resp, "code", None)
                msg_text = getattr(resp, "msg", "")
                errors.append(f"{kind} 下载失败：{code} {msg_text}")
                logger.error("download lark resource failed: message_id=%s kind=%s code=%s msg=%s", message_id, kind, code, msg_text)
                continue
            source = getattr(resp, "file", None)
            if source is None:
                errors.append(f"{kind} 下载失败：响应没有文件流")
                continue
            response_name = getattr(resp, "file_name", "") or ""
            filename = sanitize_lark_filename(
                str(spec.get("file_name") or response_name),
                default_lark_attachment_filename(kind, file_key),
            )
            path = unique_lark_attachment_path(target_dir, filename)
            tmp_path = path.with_name(path.name + ".tmp")
            total = 0
            try:
                with tmp_path.open("wb") as out:
                    while True:
                        chunk = source.read(1024 * 1024)
                        if not chunk:
                            break
                        if isinstance(chunk, str):
                            chunk = chunk.encode("utf-8")
                        total += len(chunk)
                        if LARK_ATTACHMENT_MAX_BYTES > 0 and total > LARK_ATTACHMENT_MAX_BYTES:
                            raise ValueError(f"attachment exceeds {LARK_ATTACHMENT_MAX_BYTES} bytes")
                        out.write(chunk)
                tmp_path.replace(path)
                attachments.append(
                    {
                        "kind": kind,
                        "file_key": file_key,
                        "message_id": message_id,
                        "file_name": path.name,
                        "local_path": str(path),
                        "size": total,
                        "content_type": getattr(resp, "content_type", "") or "",
                    }
                )
                logger.info("downloaded lark attachment: chat_id=%s message_id=%s kind=%s path=%s size=%s", chat_id, message_id, kind, path, total)
            except Exception as e:
                tmp_path.unlink(missing_ok=True)
                errors.append(f"{filename} 保存失败：{type(e).__name__}: {e}")
                logger.exception("failed to save lark attachment: message_id=%s file_key=%s", message_id, file_key)
            finally:
                close = getattr(source, "close", None)
                if callable(close):
                    close()
        except Exception as e:
            errors.append(f"{kind} 下载异常：{type(e).__name__}: {e}")
            logger.exception("download lark resource exception: message_id=%s file_key=%s", message_id, file_key)

    return normalize_attachment_dicts(attachments), errors


def pending_lark_attachment_key(chat_id: str, sender_id: str) -> str:
    return f"{chat_id}:{sender_id or 'unknown'}"


def prune_pending_lark_attachments(now: Optional[float] = None):
    now = now or time.time()
    ttl = max(1, LARK_PENDING_ATTACHMENT_TTL_SECONDS)
    with LOCK:
        for key in list(PENDING_LARK_ATTACHMENTS):
            kept = [
                item for item in PENDING_LARK_ATTACHMENTS.get(key, [])
                if now - float(item.get("created_at", now) or now) <= ttl
            ]
            if kept:
                PENDING_LARK_ATTACHMENTS[key] = kept
            else:
                PENDING_LARK_ATTACHMENTS.pop(key, None)


def stash_pending_lark_attachments(chat_id: str, sender_id: str, attachments: list[dict[str, Any]]):
    items = normalize_attachment_dicts(attachments)
    if not items:
        return
    now = time.time()
    for item in items:
        item["created_at"] = now
    key = pending_lark_attachment_key(chat_id, sender_id)
    with LOCK:
        existing = PENDING_LARK_ATTACHMENTS.get(key, [])
        PENDING_LARK_ATTACHMENTS[key] = dedupe_lark_attachments(existing + items)
    prune_pending_lark_attachments(now)


def consume_pending_lark_attachments(chat_id: str, sender_id: str) -> list[dict[str, Any]]:
    prune_pending_lark_attachments()
    key = pending_lark_attachment_key(chat_id, sender_id)
    with LOCK:
        items = PENDING_LARK_ATTACHMENTS.pop(key, [])
    return normalize_attachment_dicts(items)


def dedupe_lark_attachments(attachments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in normalize_attachment_dicts(attachments):
        key = item.get("local_path") or f"{item.get('message_id')}:{item.get('file_key')}"
        if not key or key in seen:
            continue
        seen.add(str(key))
        result.append(item)
    return result


def existing_lark_attachments(attachments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    for item in dedupe_lark_attachments(attachments):
        path = item.get("local_path", "")
        if path and Path(path).exists():
            result.append(item)
    return result


def lark_attachment_label(item: dict[str, Any]) -> str:
    kind = "图片" if item.get("kind") == "image" else "文件"
    name = item.get("file_name") or Path(str(item.get("local_path", ""))).name or item.get("file_key") or "attachment"
    size = parse_int_value(item.get("size"))
    size_text = f" ({size} bytes)" if size else ""
    return f"{kind}: {name}{size_text}"


def lark_attachment_summary_text(attachments: list[dict[str, Any]], limit: int = 5) -> str:
    items = normalize_attachment_dicts(attachments)
    if not items:
        return ""
    labels = [lark_attachment_label(item) for item in items[:limit]]
    if len(items) > limit:
        labels.append(f"... 另有 {len(items) - limit} 个")
    return "\n".join(f"- {label}" for label in labels)


def build_lark_attachment_prompt(content: str, attachments: list[dict[str, Any]]) -> str:
    items = existing_lark_attachments(attachments)
    if not items:
        return content
    lines = [
        "用户在 Lark 发送了附件。请结合下面的本地文件路径执行指令。",
        "这些文件已经下载到本机，必要时请直接读取路径对应的文件。",
        "",
        "附件：",
    ]
    for item in items:
        label = lark_attachment_label(item)
        lines.append(f"- {label}")
        lines.append(f"  路径: {item.get('local_path')}")
        if item.get("message_id"):
            lines.append(f"  Lark message_id: {item.get('message_id')}")
    lines.extend(["", "用户指令：", content])
    return "\n".join(lines)


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
        with KEEP_AWAKE_LOCK:
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


def strip_leading_lark_mentions(content: str) -> str:
    text = str(content or "").strip()
    while True:
        updated = re.sub(r"^@\S+[\s:：,，]+", "", text, count=1).strip()
        if updated == text:
            return text
        text = updated


def lark_reference_ids(meta: dict[str, str]) -> list[str]:
    current_message_id = meta.get("message_id", "")
    result: list[str] = []
    for key in ("quote_message_id", "parent_id", "root_id", "thread_id"):
        value = str(meta.get(key, "") or "").strip()
        if value and value != current_message_id and value not in result:
            result.append(value)
    return result


def lark_message_relation_meta(meta: dict[str, str]) -> dict[str, str]:
    return {
        "root_id": meta.get("root_id", ""),
        "parent_id": meta.get("parent_id", ""),
        "thread_id": meta.get("thread_id", ""),
    }


def record_incoming_lark_message(
    chat_id: str,
    content: str,
    meta: dict[str, str],
    task_id: str = "",
    attachments: Optional[list[dict[str, Any]]] = None,
):
    message_id = meta.get("message_id", "")
    if not message_id:
        return
    runtime = get_runtime(chat_id)
    record_lark_message_ref(
        chat_id,
        message_id,
        task_id=task_id,
        session_id=runtime.active_session_id or runtime.task_session_id,
        cwd=str(runtime.cwd),
        text=content,
        source="user",
        attachments=attachments,
        **lark_message_relation_meta(meta),
    )


def record_task_lark_refs(task: Optional[CodexTaskRuntime], text: str = ""):
    if not task:
        return
    content = text or task.output or task.prompt
    for message_id, source in (
        (task.message_id, "task_card"),
        (task.source_message_id, "user"),
    ):
        if not message_id:
            continue
        record_lark_message_ref(
            task.chat_id,
            message_id,
            task_id=task.task_id,
            session_id=task.session_id,
            cwd=str(task.cwd),
            text=content,
            source=source,
        )


def resolve_lark_reference_context(chat_id: str, meta: dict[str, str]) -> Optional[LarkReferenceContext]:
    refs = lark_reference_ids(meta)
    if not refs:
        return None
    state = read_state()
    found: dict[str, Any] = {}
    for message_id in refs:
        found = find_lark_message_ref(chat_id, message_id, state)
        if found:
            break
    if not found:
        found = find_lark_thread_ref(chat_id, refs, state)
    if not found:
        return None
    return LarkReferenceContext(
        message_id=str(found.get("message_id", "") or ""),
        task_id=str(found.get("task_id", "") or ""),
        session_id=str(found.get("session_id", "") or ""),
        cwd=str(found.get("cwd", "") or ""),
        text=str(found.get("text", "") or ""),
        source=str(found.get("source", "") or ""),
        attachments=normalize_attachment_dicts(found.get("attachments", [])),
    )


def apply_lark_reference_context(chat_id: str, context: LarkReferenceContext) -> bool:
    runtime = get_runtime(chat_id)
    switched = False
    conv = get_active_conversation(context.session_id)
    if conv:
        runtime.active_session_id = conv.session_id
        if conv.cwd:
            runtime.cwd = conv.cwd
            root = conversation_project_root(conv)
            runtime.active_project_key = project_key(root) if root else ""
        switched = True
    elif context.cwd:
        try:
            cwd = Path(context.cwd).expanduser()
            if cwd.is_dir() and is_allowed_cwd(cwd):
                runtime.cwd = cwd
        except OSError:
            logger.exception("failed to apply referenced cwd: %s", context.cwd)
    save_runtime(chat_id)
    return switched


def build_lark_reference_prompt(content: str, context: LarkReferenceContext) -> str:
    lines = [
        "这条指令来自 Lark 中对历史消息或话题的回复/引用。",
        "请结合当前 Agent session 上下文和下面的 Lark 引用内容执行用户的新指令。",
        "",
        "引用信息：",
        f"- Lark message_id: {context.message_id or '-'}",
        f"- Codex session_id: {context.session_id or '-'}",
        f"- 目录: {context.cwd or '-'}",
    ]
    if context.text:
        lines.extend(["", "被引用的 Lark 内容：", context.text])
    lines.extend(["", "用户当前指令：", content])
    return "\n".join(lines)


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


def parse_path_list(value: str) -> list[Path]:
    parts: list[str] = []
    for item in str(value or "").split(os.pathsep):
        parts.extend(re.split(r"[,;]+", item))
    return [Path(part).expanduser() for part in parts if part.strip()]


def configured_allowed_roots() -> list[Path]:
    roots = parse_path_list(CODEX_ALLOWED_ROOTS_VALUE)
    if not roots:
        roots = [CODEX_PROJECTS_ROOT, DEFAULT_CWD]
    normalized: list[Path] = []
    seen: set[str] = set()
    for root in roots:
        normalized_root = normalize_path(root)
        key = str(normalized_root)
        if key not in seen:
            normalized.append(normalized_root)
            seen.add(key)
    return normalized


def path_is_under(path: Path, root: Path) -> bool:
    path = normalize_path(path)
    root = normalize_path(root)
    return path == root or root in path.parents


def is_allowed_cwd(path: Path) -> bool:
    return any(path_is_under(path, root) for root in configured_allowed_roots())


def allowed_roots_text() -> str:
    return ", ".join(f"`{root}`" for root in configured_allowed_roots())


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


def is_plan_worktree_path(cwd: Optional[Path]) -> bool:
    if not cwd:
        return False
    path = normalize_path(cwd)
    if PLAN_WORKTREE_ROOT:
        root = normalize_path(Path(PLAN_WORKTREE_ROOT))
        return path == root or root in path.parents

    parts = path.parts
    for index, part in enumerate(parts[:-1]):
        if part in (".lark2agent", ".lark-codex") and parts[index + 1] == "worktrees":
            return True
    return False


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


def conversation_project_root(conv: ConversationInfo) -> Optional[Path]:
    root = find_project_root(conv.cwd)
    if root:
        return root
    if normalize_agent_id(conv.agent_id) == "claude" and conv.cwd:
        try:
            cwd = normalize_path(conv.cwd)
        except OSError:
            return None
        if cwd.exists() and cwd.is_dir():
            return cwd
    return None


def conversation_is_project(conv: ConversationInfo) -> bool:
    if conv.session_id in marked_ordinary_sessions():
        return False
    return conversation_project_root(conv) is not None


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


def iter_claude_session_files(report_date=None) -> list[Path]:
    if not CLAUDE_PROJECTS_DIR.exists():
        return []
    files = list(CLAUDE_PROJECTS_DIR.glob("**/*.jsonl"))
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return files[:MAX_SESSION_FILES]


def iter_qoder_session_files(report_date=None) -> list[Path]:
    if not QODER_PROJECTS_DIR.exists():
        return []
    files = list(QODER_PROJECTS_DIR.glob("**/*.jsonl"))
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
    info = ConversationInfo(session_id="", file=path, agent_id="codex", updated_at=path.stat().st_mtime)
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


def parse_claude_conversation(path: Path, report_date=None) -> Optional[ConversationInfo]:
    info = ConversationInfo(session_id="", file=path, agent_id="claude", updated_at=path.stat().st_mtime)
    fallback_id = path.stem
    meaningful_users: list[str] = []
    assistant_messages: list[str] = []
    report_date = report_date or datetime.now().date()
    today_user_fingerprints: set[str] = set()
    today_failure_fingerprints: set[str] = set()

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

    def record_today_result(text: str, ts: float):
        if event_date(ts) != report_date or not text:
            return
        key = re.sub(r"\s+", " ", text).strip()
        fingerprint = hashlib.sha1(key.encode("utf-8")).hexdigest()
        if looks_failed(text) and fingerprint not in today_failure_fingerprints:
            today_failure_fingerprints.add(fingerprint)
            info.today_failed_count += 1

    try:
        with path.open("r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if obj.get("isMeta"):
                    continue
                raw_session_id = obj.get("sessionId") or obj.get("session_id")
                if raw_session_id:
                    info.session_id = conversation_key("claude", str(raw_session_id))
                ts = parse_event_timestamp(obj.get("timestamp"))
                if ts:
                    record_today_activity(ts)
                if not info.created_at and obj.get("timestamp"):
                    info.created_at = str(obj.get("timestamp"))
                if obj.get("cwd") and not info.cwd:
                    info.cwd = Path(str(obj.get("cwd")))
                info.originator = "claude_code"
                info.source = "claude"
                typ = obj.get("type")
                if typ == "user":
                    text = extract_claude_text_content(obj.get("message") or obj.get("content"))
                    if not text or text.startswith("<"):
                        continue
                    meaningful_users.append(text)
                    info.last_user = text
                    info.last_user_at = ts
                    record_today_user(text, ts)
                elif typ == "assistant":
                    text = extract_claude_text_content(obj.get("message") or obj.get("content"))
                    if not text:
                        continue
                    assistant_messages.append(text)
                    info.last_assistant = text
                    info.last_assistant_at = ts
                    if event_date(ts) == report_date:
                        info.today_assistant_messages.append(text)
                        record_today_result(text, ts)
                elif typ == "system" and obj.get("subtype") == "local_command":
                    text = extract_claude_text_content(obj.get("content"))
                    if looks_failed(text):
                        info.status = "有错误"
                        record_today_result(text, ts)
    except OSError:
        return None

    if not info.session_id:
        info.session_id = conversation_key("claude", fallback_id)
    if meaningful_users:
        info.title = short_text(meaningful_users[0], 70)
        info.turns = len(meaningful_users)
    elif assistant_messages:
        info.title = short_text(assistant_messages[0], 70)
    if info.status == "未知":
        info.status = "有记录"
    return info


def parse_qoder_conversation(path: Path, report_date=None) -> Optional[ConversationInfo]:
    info = ConversationInfo(session_id="", file=path, agent_id="qoder", updated_at=path.stat().st_mtime)
    fallback_id = path.stem
    meaningful_users: list[str] = []
    assistant_messages: list[str] = []
    report_date = report_date or datetime.now().date()
    today_user_fingerprints: set[str] = set()
    today_failure_fingerprints: set[str] = set()

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

    def record_today_result(text: str, ts: float):
        if event_date(ts) != report_date or not text:
            return
        key = re.sub(r"\s+", " ", text).strip()
        fingerprint = hashlib.sha1(key.encode("utf-8")).hexdigest()
        if looks_failed(text) and fingerprint not in today_failure_fingerprints:
            today_failure_fingerprints.add(fingerprint)
            info.today_failed_count += 1

    try:
        with path.open("r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if obj.get("isMeta"):
                    continue
                raw_session_id = obj.get("sessionId") or obj.get("session_id")
                if raw_session_id:
                    info.session_id = conversation_key("qoder", str(raw_session_id))
                ts = parse_event_timestamp(obj.get("timestamp"))
                if ts:
                    record_today_activity(ts)
                if not info.created_at and obj.get("timestamp"):
                    info.created_at = str(obj.get("timestamp"))
                if obj.get("cwd") and not info.cwd:
                    info.cwd = Path(str(obj.get("cwd")))
                info.originator = "qoder_cli"
                info.source = "qoder"
                typ = obj.get("type")
                if typ == "user":
                    text = extract_claude_text_content(obj.get("message") or obj.get("content"))
                    if not text or text.startswith("<"):
                        continue
                    meaningful_users.append(text)
                    info.last_user = text
                    info.last_user_at = ts
                    record_today_user(text, ts)
                elif typ == "assistant":
                    text = extract_claude_text_content(obj.get("message") or obj.get("content"))
                    if not text:
                        continue
                    assistant_messages.append(text)
                    info.last_assistant = text
                    info.last_assistant_at = ts
                    if event_date(ts) == report_date:
                        info.today_assistant_messages.append(text)
                        record_today_result(text, ts)
                elif typ == "system" and obj.get("subtype") == "error":
                    text = extract_claude_text_content(obj.get("content"))
                    if looks_failed(text):
                        info.status = "有错误"
                        record_today_result(text, ts)
    except OSError:
        return None

    if not info.session_id:
        info.session_id = conversation_key("qoder", fallback_id)
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

    def add_conversation(conv: ConversationInfo):
        if not conv:
            return
        if not LARK2AGENT_INCLUDE_PLAN_WORKTREES and is_plan_worktree_path(conv.cwd):
            return
        if report_date and conv.today_activity_count <= 0:
            return
        if not LARK2AGENT_SHOW_ARCHIVED and is_session_archived(conv.session_id):
            return
        conversations[conv.session_id] = conv
        root = conversation_project_root(conv)
        if conv.session_id in marked_ordinary_sessions():
            root = None
        if not LARK2AGENT_SHOW_ARCHIVED and root and is_project_archived(root):
            return
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

    for path in iter_session_files(report_date=report_date):
        add_conversation(parse_conversation(path, report_date=metric_date))

    for path in iter_claude_session_files(report_date=report_date):
        add_conversation(parse_claude_conversation(path, report_date=metric_date))

    for path in iter_qoder_session_files(report_date=report_date):
        add_conversation(parse_qoder_conversation(path, report_date=metric_date))

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
    return AGENT_ADAPTERS[normalize_agent_id(conv.agent_id)].is_resumable(conv)


def get_active_conversation(session_id: str) -> Optional[ConversationInfo]:
    if not session_id:
        return None
    _, conversations = build_index()
    if session_id in conversations:
        return conversations.get(session_id)
    agent_id, raw_session_id = split_conversation_key(session_id)
    return conversations.get(conversation_key(agent_id, raw_session_id))


def active_conversation_for_runtime(runtime: ChatRuntime) -> Optional[ConversationInfo]:
    return get_active_conversation(runtime.active_session_id or runtime.task_session_id)


def active_session_summary(runtime: ChatRuntime) -> tuple[str, str]:
    session_id = runtime.active_session_id or runtime.task_session_id
    conv = active_conversation_for_runtime(runtime)
    title = conv.title if conv else ""
    return session_id, title


def activate_conversation(chat_id: str, conv: ConversationInfo):
    runtime = get_runtime(chat_id)
    runtime.active_agent_id = normalize_agent_id(conv.agent_id)
    runtime.task_agent_id = runtime.active_agent_id
    runtime.active_session_id = conv.session_id
    runtime.task_session_id = conv.session_id
    root = find_project_root(conv.cwd)
    runtime.active_project_key = project_key(root) if root else ""
    if conv.cwd:
        runtime.cwd = conv.cwd
        runtime.task_cwd = str(conv.cwd)
    save_runtime(chat_id)


def project_conversation(project: ProjectInfo, session_id: str) -> Optional[ConversationInfo]:
    if not session_id:
        return None
    for conv in project.conversations:
        if conv.session_id == session_id:
            return conv
    return None


def activate_project(chat_id: str, project: ProjectInfo) -> Optional[ConversationInfo]:
    runtime = get_runtime(chat_id)
    selected = project_conversation(project, runtime.active_session_id) or project_conversation(project, runtime.task_session_id)
    if selected:
        activate_conversation(chat_id, selected)
        return selected

    runtime.active_project_key = project.key
    if project.cwd:
        runtime.cwd = project.cwd
        runtime.task_cwd = str(project.cwd)
    if project.conversations:
        selected = project.conversations[0]
        runtime.active_agent_id = normalize_agent_id(selected.agent_id)
        runtime.task_agent_id = runtime.active_agent_id
        runtime.active_session_id = selected.session_id
        runtime.task_session_id = selected.session_id
        if selected.cwd:
            runtime.cwd = selected.cwd
            runtime.task_cwd = str(selected.cwd)
    else:
        runtime.active_session_id = ""
        runtime.task_session_id = ""
    save_runtime(chat_id)
    return selected


def focus_project(chat_id: str, project: ProjectInfo):
    runtime = get_runtime(chat_id)
    runtime.active_project_key = project.key
    if project.cwd:
        runtime.cwd = project.cwd
        runtime.task_cwd = str(project.cwd)
    save_runtime(chat_id)


def project_session_summary(project: ProjectInfo, runtime: ChatRuntime) -> tuple[str, str]:
    conv = project_conversation(project, runtime.active_session_id) or project_conversation(project, runtime.task_session_id)
    if not conv:
        return "", ""
    return conv.session_id, conv.title


def conversation_source_label(conv: ConversationInfo) -> str:
    if conv.agent_id and conv.agent_id != "codex":
        return agent_label(conv.agent_id)
    originator_raw = conv.originator or ""
    source_raw = conv.source or ""
    originator = str(originator_raw).lower()
    source = str(source_raw).lower()
    if is_resumable_conversation(conv):
        return APP_NAME
    if "desktop" in originator or source in ("vscode", "desktop"):
        return "Codex Desktop"
    return str(originator_raw or source_raw or "未知来源")


def is_desktop_conversation(conv: Optional[ConversationInfo]) -> bool:
    if not conv or is_resumable_conversation(conv):
        return False
    originator = str(conv.originator or "").lower()
    source = str(conv.source or "").lower()
    return "desktop" in originator or source in ("vscode", "desktop")


def latest_desktop_conversation_for_cwd(cwd: Path) -> Optional[ConversationInfo]:
    _, conversations = build_index()
    candidates = [
        conv for conv in conversations.values()
        if is_desktop_conversation(conv) and same_path(conv.cwd, cwd)
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda conv: conv.updated_at)


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


def parse_agent_prefix(content: str) -> tuple[str, str]:
    text = content.strip()
    match = re.match(r"^/agent\s*=\s*(\S+)\s*(.*)$", text, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        match = re.match(r"^/agent\s+(\S+)\s*(.*)$", text, flags=re.IGNORECASE | re.DOTALL)
    if match:
        raw_agent = match.group(1).strip()
        agent_id = normalize_agent_id(raw_agent)
        if agent_id == "codex" and raw_agent.lower() not in ("codex", "code", "codexcli", "codex-cli"):
            return "", content
        rest = strip_command_separator(match.group(2) or "")
        return agent_id, rest
    match = re.match(r"^/(codex|claude|qoder)(?:\s+(.*)|$)", text, flags=re.IGNORECASE | re.DOTALL)
    if match:
        return normalize_agent_id(match.group(1)), strip_command_separator(match.group(2) or "")
    return "", content


def agent_options_text(current_agent_id: str = "") -> str:
    current_agent_id = normalize_agent_id(current_agent_id or DEFAULT_AGENT_ID)
    lines = [f"当前 Agent：`{current_agent_id}`（{agent_label(current_agent_id)}）", "", "可用 Agent："]
    for agent_id, adapter in AGENT_ADAPTERS.items():
        default_model = adapter.default_model or "默认"
        current = "（当前）" if agent_id == current_agent_id else ""
        lines.append(f"- `{agent_id}`：{adapter.label}，默认模型：{default_model}{current}")
    lines.append("用法：`/agent=qoder +指令`、`/qoder 指令`、`/claude 指令`、`/codex 指令`。")
    return "\n".join(lines)


def model_label(model: str = "") -> str:
    return model or CODEX_MODEL or "默认"


def runtime_task_cwd(runtime: ChatRuntime) -> Path:
    return Path(runtime.task_cwd).expanduser() if runtime.task_cwd else runtime.cwd


def plan_task_cwd(plan: PlanRuntime, task: PlanTask) -> Path:
    return Path(task.worktree_path).expanduser() if task.worktree_path else plan.cwd


def plan_worktree_root(repo_root: Path) -> Path:
    if PLAN_WORKTREE_ROOT:
        return Path(PLAN_WORKTREE_ROOT).expanduser().resolve()
    return repo_root / ".lark2agent" / "worktrees"


def prepare_plan_worktree(plan: PlanRuntime, task: PlanTask) -> Path:
    if not PLAN_USE_WORKTREES:
        return plan.cwd

    repo_root = git_repo_root(plan.cwd)
    if not repo_root:
        task.output = "当前目录不是 Git 仓库，已退回到原目录执行；无法启用 worktree 隔离。"
        return plan.cwd

    task.base_head = git_head(repo_root)
    task.branch_name = f"lark2agent/{safe_git_ref_part(plan.plan_id)}-{safe_git_ref_part(task.task_id)}"
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
        argv: str | list[str] = command if PLAN_TEST_COMMAND_SHELL else shlex.split(command)
        if not argv:
            return True, "未配置测试命令。"
        result = subprocess.run(
            argv,
            cwd=str(cwd),
            shell=PLAN_TEST_COMMAND_SHELL,
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
    task: Optional[CodexTaskRuntime] = None,
) -> str:
    result = "成功" if code == 0 else "失败" if code is not None else "未完成"
    agent_id = task_agent_id(task, runtime)
    adapter = AGENT_ADAPTERS[agent_id]
    task_model = task.model if task else runtime.task_model
    task_session_id = (task.session_id if task else "") or runtime.task_session_id or runtime.active_session_id
    lines = [
        f"**{adapter.label} 任务结束**",
        "",
        f"**结果**：{result}" + (f"（退出码 `{code}`）" if code not in (None, 0) else ""),
        f"**完成时间**：{datetime.now().strftime('%m-%d %H:%M')}",
        f"**耗时**：{format_duration(time.time() - started_at)}",
        f"**目录**：`{cwd}`",
        f"**Agent**：{adapter.label}",
        f"**模型**：`{agent_model_label(agent_id, task_model)}`",
    ]
    if task_session_id:
        lines.append(f"**Session**：`{task_session_id}`")
    if detail:
        lines.append(f"**说明**：{detail}")
    if user_question:
        lines.extend(["", "**用户问题**", "", final_reply_text(user_question, FINAL_QUESTION_MAX_CHARS)])
    if last_agent_message:
        lines.extend(["", f"**{adapter.label} 具体回复**", "", final_reply_text(last_agent_message)])
    elif not emitted_output:
        lines.extend(["", "**输出**", "", "没有捕获到流式输出；可发送 `/status` 查看当前对话。"])

    lines.extend(["", "**工作区**"])
    lines.extend(format_git_summary(cwd, limit=5))
    lines.extend(["", "可发送 `/status` 查看完整项目状态，或继续发送新问题。"])
    return "\n".join(lines)


def synced_task_complete_text(conv: ConversationInfo, cwd: Path, last_agent_message: str) -> str:
    label = agent_label(conv.agent_id)
    lines = [
        f"**{label} 任务结束**",
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
        lines.extend(["", f"**{label} 具体回复**", "", final_reply_text(last_agent_message)])
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
        elif label == APP_NAME:
            bridge += 1
        else:
            other += 1
    return desktop, bridge, other


def project_agent_counts_text(project: ProjectInfo) -> str:
    counts: dict[str, int] = {}
    for conv in project.conversations:
        label = agent_label(conv.agent_id)
        counts[label] = counts.get(label, 0) + 1
    if not counts:
        return "-"
    return " / ".join(f"{label} {count}" for label, count in sorted(counts.items()))


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
        return "执行中", "Agent 正在处理当前任务；完成后会主动推送项目状态。"
    if is_repo and entries:
        return "已有本地改动", "项目有未提交变更；建议先查看 /status 中的 Git 列表，再验证或提交。"
    if latest and datetime.fromtimestamp(latest.updated_at).date() == datetime.now().date():
        return "今日已推进", "今天有新的 Agent 记录；可继续发送问题，或用 /convos 切换具体对话。"
    if latest:
        return "可继续推进", "已有历史上下文；可直接发送新问题，系统会在当前项目中启动或续写桥接会话。"
    return "尚未开始", f"当前目录还没有可读取的 Agent 会话；直接发消息即可创建 {APP_NAME} 会话。"


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
        "config": {"wide_screen_mode": True, "enable_forward": LARK_CARD_ENABLE_FORWARD},
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
    status_labels = {
        "pending": "等待确认",
        "approved": "已确认，正在重启",
        "cancelled": "已取消",
    }
    template = "orange" if restart.status == "pending" else "green" if restart.status == "approved" else "grey"
    elements: list[dict[str, Any]] = [
        fields(
            [
                ("状态", status_labels.get(restart.status, restart.status or "-")),
                ("审批 ID", restart.restart_id),
                ("请求人", restart.requester_id or "-"),
                ("来源类型", restart.requester_type or "-"),
            ]
        ),
        md(
            "收到 `/restart` 请求。重启会中断当前 WebSocket 连接，并让脚本用当前 Python 解释器原地重启。\n\n"
            + (
                "请确认这是你主动触发的操作。"
                if restart.status == "pending"
                else "该重启请求已经处理，按钮已失效。"
            )
        ),
    ]
    if restart.status == "pending":
        elements.append(
            action_row(
                [
                    compact_button("确认重启", "restart_confirm", {"chat_id": restart.chat_id, "restart_id": restart.restart_id}, "primary"),
                    compact_button("取消", "restart_cancel", {"chat_id": restart.chat_id, "restart_id": restart.restart_id}, "danger"),
                ]
            )
        )
    return base_card(
        f"确认重启 {APP_NAME}",
        elements,
        template,
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
        "config": {"wide_screen_mode": True, "enable_forward": LARK_CARD_ENABLE_FORWARD},
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


def task_can_accept_guidance(task: Optional[CodexTaskRuntime]) -> bool:
    if not task or not task.queued_for_session or task.cancel_requested:
        return False
    return task.process is None or task.process.poll() is not None


def task_can_cancel(task: Optional[CodexTaskRuntime]) -> bool:
    if not task or task.cancel_requested or not task.queued_for_session:
        return False
    return task.process is None or task.process.poll() is not None


def cancel_queued_task(chat_id: str, task_id: str) -> tuple[bool, str]:
    task = find_task(task_id)
    if not task or task.chat_id != chat_id:
        return False, "找不到这条排队任务。"
    if task.cancel_requested:
        return True, "这条任务已经取消。"
    if not task_can_cancel(task):
        return False, "只有等待启动的排队任务可以取消；运行中的任务请使用停止。"
    runtime = get_runtime(chat_id)
    task.cancel_requested = True
    task.queued_for_session = False
    task.guidance_requested = False
    task.status = "已取消"
    if runtime.guidance_task_id == task.task_id:
        runtime.guidance_task_id = ""
    save_runtime(chat_id)
    update_task_card(
        chat_id,
        status="已取消",
        detail="已取消这条等待启动的排队任务。",
        force=True,
        task_id=task.task_id,
    )
    return True, "已取消排队任务。"


def request_task_guidance(chat_id: str, task_id: str) -> tuple[bool, str]:
    task = find_task(task_id)
    if not task or task.chat_id != chat_id:
        return False, "找不到这条排队任务。"
    if not task_can_accept_guidance(task):
        return False, "这条任务当前不能追加引导；可能已经开始执行。"
    runtime = get_runtime(chat_id)
    runtime.guidance_task_id = task.task_id
    task.guidance_requested = True
    save_runtime(chat_id)
    update_task_card(
        chat_id,
        detail="已进入引导模式。请直接发送一条普通消息，它会追加到这条排队任务中。",
        force=True,
        task_id=task.task_id,
    )
    return True, "请发送引导内容。"


def append_task_guidance(chat_id: str, content: str) -> bool:
    runtime = get_runtime(chat_id)
    task_id = runtime.guidance_task_id
    if not task_id:
        return False
    task = find_task(task_id)
    if not task or task.chat_id != chat_id:
        runtime.guidance_task_id = ""
        save_runtime(chat_id)
        send_msg(chat_id, "引导目标任务已不存在。")
        return True
    if not task_can_accept_guidance(task):
        runtime.guidance_task_id = ""
        task.guidance_requested = False
        save_runtime(chat_id)
        update_task_card(chat_id, detail="任务已经开始执行，不能再追加引导。", force=True, task_id=task.task_id)
        return True
    guidance = content.strip()
    if not guidance:
        return True
    task.guidance_messages.append(guidance)
    task.guidance_requested = False
    runtime.guidance_task_id = ""
    save_runtime(chat_id)
    update_task_card(
        chat_id,
        detail="已追加引导；任务排到后会带上这段补充说明一起执行。",
        force=True,
        task_id=task.task_id,
    )
    return True


def apply_guidance_to_task_prompt(task: CodexTaskRuntime):
    if not task.guidance_messages:
        return
    guidance = "\n".join(f"- {item}" for item in task.guidance_messages)
    marker = "排队期间用户追加的引导："
    if marker in task.prompt:
        return
    task.prompt = f"{task.prompt}\n\n{marker}\n{guidance}"


def task_card_state(chat_id: str, task_id: str = "") -> tuple[ChatRuntime, Optional[CodexTaskRuntime]]:
    runtime = get_runtime(chat_id)
    task = find_task(task_id) if task_id else latest_task_for_chat(chat_id)
    return runtime, task


def build_task_card(chat_id: str, status: str = "", output: str = "", detail: str = "", task_id: str = "") -> dict[str, Any]:
    runtime, task = task_card_state(chat_id, task_id)
    shown_agent_id = task_agent_id(task, runtime)
    shown_agent_label = agent_label(shown_agent_id)
    if task_id and not task:
        return base_card(
            f"{APP_NAME} 指令",
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
    task_attachments = task.attachments if task else []
    task_session_conv = get_active_conversation(task_session_id)
    task_session_title = task_session_conv.title if task_session_conv else ""

    elements: list[dict[str, Any]] = [
        fields(
            [
                ("状态", current_status),
                ("Agent", shown_agent_label),
                ("目录", short_text(str(task_cwd), 42)),
                ("模型", agent_model_label(shown_agent_id, task_model)),
                ("耗时", format_duration(time.time() - task_started_at) if task_started_at else "-"),
            ]
        ),
        md(f"**指令**\n{short_text(task_prompt, 900) or '无'}"),
    ]
    if task_attachments:
        elements.append(md(f"**附件**\n{lark_attachment_summary_text(task_attachments, 6)}"))
    if shown_task_id:
        elements.append(md(f"**指令 ID**\n`{shown_task_id}`"))
    if task_session_id:
        elements.append(
            md(
                f"**Session**\n"
                f"{task_session_title or '-'}\n"
                f"`{task_session_id}`"
            )
        )
    if task and task.queued_for_session:
        elements.append(
            md(
                f"**排队状态**\n"
                f"同一 Session `{task.session_id}` 已有任务在运行，本指令正在排队。"
            )
        )
    if task and task.guidance_messages:
        elements.append(md(f"**已追加引导**\n{final_reply_text(chr(10).join(task.guidance_messages), 900)}"))
    if task and task.guidance_requested:
        elements.append(md("**引导模式**\n请直接发送一条普通消息，作为这条排队任务的补充引导。"))
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
                    approved_retry_text(shown_agent_id, shown_agent_label)
                    + f"{format_duration(PENDING_APPROVAL_WAIT_SECONDS)} 内未处理会按当前 Agent 默认配置继续。"
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
    if task_can_accept_guidance(task):
        actions.append(compact_button("引导", "task_guide", {"chat_id": chat_id, "task_id": shown_task_id}))
    if task_can_cancel(task):
        actions.append(compact_button("取消", "task_cancel", {"chat_id": chat_id, "task_id": shown_task_id}, "danger"))
    if running:
        actions.append(compact_button("停止", "stop", {"chat_id": chat_id, "task_id": shown_task_id}, "danger"))
    elements.append(action_row(actions))
    return base_card(f"{shown_agent_label} 指令", elements, template)


def send_task_card(
    chat_id: str,
    prompt: str,
    status: str,
    model: str = "",
    agent_id: str = "",
    force_ordinary: bool = False,
    source_message_id: str = "",
    attachments: Optional[list[dict[str, Any]]] = None,
    one_shot_agent: bool = False,
) -> str:
    runtime = get_runtime(chat_id)
    agent_id = normalize_agent_id(agent_id or runtime.active_agent_id or DEFAULT_AGENT_ID)
    active_session = runtime.active_session_id if normalize_agent_id(runtime.active_agent_id) == agent_id else ""
    active_conv = get_active_conversation(active_session)
    session_id = active_session if active_conv and normalize_agent_id(active_conv.agent_id) == agent_id else ""
    task_id = generate_task_id(chat_id, prompt)
    task = CodexTaskRuntime(
        task_id=task_id,
        chat_id=chat_id,
        cwd=runtime_task_cwd(runtime),
        prompt=prompt,
        agent_id=agent_id,
        model=model,
        status=status,
        session_id=session_id,
        approval_policy=runtime.next_approval_policy,
        sandbox_mode=runtime.next_sandbox_mode,
        permission_mode=default_permission_mode(agent_id),
        force_ordinary=force_ordinary,
        source_message_id=source_message_id,
        attachments=normalize_attachment_dicts(attachments or []),
        one_shot_agent=one_shot_agent,
    )
    with LOCK:
        TASKS[task_id] = task
    runtime.task_prompt = prompt
    if not one_shot_agent:
        runtime.active_agent_id = agent_id
        runtime.active_session_id = session_id
    runtime.task_agent_id = agent_id
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
        record_task_lark_refs(task)
    else:
        logger.warning("task card sent without message_id: chat_id=%s task_id=%s", chat_id, task_id)
    if source_message_id:
        record_task_lark_refs(task)
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


def desktop_sync_key(chat_id: str, session_id: str) -> tuple[str, str]:
    return (chat_id, session_id)


def get_desktop_sync(chat_id: str, conv: ConversationInfo, runtime_cwd: Path) -> DesktopSyncRuntime:
    key = desktop_sync_key(chat_id, conv.session_id)
    with LOCK:
        sync = DESKTOP_SYNCS.get(key)
        if sync is None:
            sync = DesktopSyncRuntime(
                chat_id=chat_id,
                session_id=conv.session_id,
                cwd=str(conv.cwd or runtime_cwd),
                title=conv.title,
                prompt=conv.last_user,
                output=conv.last_assistant,
                updated_at=conv.updated_at or time.time(),
            )
            DESKTOP_SYNCS[key] = sync
        else:
            sync.cwd = str(conv.cwd or runtime_cwd)
            sync.title = conv.title or sync.title
            if conv.last_user:
                sync.prompt = conv.last_user
            if conv.last_assistant and not sync.output:
                sync.output = conv.last_assistant
            sync.updated_at = max(sync.updated_at, conv.updated_at or time.time())
    return sync


def build_desktop_sync_card(sync: DesktopSyncRuntime) -> dict[str, Any]:
    template = "green" if sync.status == "完成" else "blue"
    elements: list[dict[str, Any]] = [
        fields(
            [
                ("状态", sync.status),
                ("来源", "Codex Desktop"),
                ("目录", short_text(sync.cwd, 42)),
                ("更新时间", format_time(sync.updated_at)),
            ]
        ),
        md(f"**标题**\n{short_text(sync.title, 160) or 'Codex Desktop 会话'}"),
        md(f"**Session**\n`{sync.session_id}`"),
    ]
    if sync.prompt:
        elements.append(md(f"**指令**\n{final_reply_text(sync.prompt, 900)}"))
    if sync.output:
        elements.extend([divider(), md(f"**最新结果**\n{final_reply_text(sync.output, 2600)}")])
    elements.append(
        action_row(
            [
                compact_button("刷新", "desktop_refresh", {"chat_id": sync.chat_id, "session_id": sync.session_id}, "primary"),
                compact_button("状态", "status", {"chat_id": sync.chat_id}),
                compact_button("打开会话", "conversation", {"chat_id": sync.chat_id, "session_id": sync.session_id}),
            ]
        )
    )
    return base_card("Codex Desktop 同步", elements, template)


def update_desktop_sync_card(
    chat_id: str,
    conv: ConversationInfo,
    runtime_cwd: Path,
    kind: str = "",
    text: str = "",
    force: bool = False,
) -> bool:
    sync = get_desktop_sync(chat_id, conv, runtime_cwd)
    if kind == "user" and text:
        sync.prompt = text
        sync.status = "用户输入"
    elif kind == "agent" and text:
        sync.output = text
        sync.status = "进行中"
    elif kind == "complete":
        if text:
            sync.output = text
        sync.status = "完成"
    elif not sync.status:
        sync.status = "监听中"
    sync.updated_at = time.time()

    now = time.time()
    if not force and now - sync.last_card_update_at < 2:
        return bool(sync.message_id)
    sync.last_card_update_at = now
    card = build_desktop_sync_card(sync)
    if sync.message_id and update_card(sync.message_id, card):
        return True
    if sync.message_id:
        logger.warning(
            "desktop sync card update failed; sending a new card: chat_id=%s session_id=%s message_id=%s",
            chat_id,
            conv.session_id,
            sync.message_id,
        )
        sync.message_id = ""
    message_id = send_card(chat_id, card)
    if message_id:
        sync.message_id = message_id
        logger.info("desktop sync card sent: chat_id=%s session_id=%s message_id=%s", chat_id, conv.session_id, message_id)
        return True
    return False


def clean_plan_item(item: str) -> str:
    item = item.strip()
    item = re.sub(r"^[-*]\s+\[[ xX]\]\s+", "", item)
    item = re.sub(r"^[-*]\s+", "", item)
    item = re.sub(r"^\d+[\.)、]\s+", "", item)
    return item.strip()


def split_plan_depends(item: str) -> tuple[str, list[str]]:
    depends: list[str] = []

    def replace_depends(match: re.Match) -> str:
        raw = match.group(1)
        for value in re.split(r"[,，、\s]+", raw):
            value = value.strip()
            if value:
                depends.append(value)
        return ""

    item = re.sub(r"(?:depends|依赖)\s*[:=：]\s*([0-9,\s，、]+)", replace_depends, item, flags=re.IGNORECASE).strip()
    return re.sub(r"\s+", " ", item).strip(), depends


def parse_plan_task_specs(content: str) -> list[dict[str, Any]]:
    text = re.sub(r"^/plan\b", "", content.strip(), flags=re.IGNORECASE).strip()

    numbered_markers = list(re.finditer(r"\d+[\.)、]\s+", text))
    if len(numbered_markers) > 1 and numbered_markers[0].start() == 0:
        specs = []
        for index, marker in enumerate(numbered_markers):
            start = marker.start()
            end = numbered_markers[index + 1].start() if index + 1 < len(numbered_markers) else len(text)
            item = clean_plan_item(text[start:end])
            if item:
                prompt, depends = split_plan_depends(item)
                if prompt:
                    specs.append({"text": prompt, "phase": "", "depends_on": depends})
        if specs:
            return specs

    specs: list[dict[str, Any]] = []
    current_phase = ""
    for line in text.splitlines():
        phase_match = re.match(r"^(?:阶段|stage)\s*([^\s:：]+)\s*[:：]\s*$", line.strip(), flags=re.IGNORECASE)
        if phase_match:
            current_phase = phase_match.group(1).strip()
            continue
        item = clean_plan_item(line)
        if item:
            prompt, depends = split_plan_depends(item)
            if prompt:
                specs.append({"text": prompt, "phase": current_phase, "depends_on": depends})
    if not specs and text:
        prompt, depends = split_plan_depends(text)
        if prompt:
            specs.append({"text": prompt, "phase": "", "depends_on": depends})

    previous_phase = ""
    previous_phase_ids: list[str] = []
    current_phase_ids: list[str] = []
    for index, spec in enumerate(specs, 1):
        phase = spec.get("phase", "")
        if phase != previous_phase:
            if previous_phase:
                previous_phase_ids = current_phase_ids
            current_phase_ids = []
            previous_phase = phase
        if phase and previous_phase_ids and not spec.get("depends_on"):
            spec["depends_on"] = list(previous_phase_ids)
        current_phase_ids.append(str(index))
    return specs


def parse_plan_tasks(content: str) -> list[str]:
    return [item["text"] for item in parse_plan_task_specs(content)]


def plan_task_from_text(index: int, task: str, default_model: str = "", phase: str = "", depends_on: Optional[list[str]] = None) -> PlanTask:
    model, prompt = parse_model_prefix(task)
    prompt = prompt or task
    return PlanTask(
        task_id=str(index),
        title=prompt,
        prompt=prompt,
        model=model or default_model,
        phase=phase,
        depends_on=depends_on or [],
    )


def plan_task_successful(task: PlanTask) -> bool:
    return task.status in ("done", "committed")


def plan_task_terminal(task: PlanTask) -> bool:
    return task.status in ("done", "committed", "failed", "cancelled")


def plan_task_dependencies_satisfied(plan: PlanRuntime, task: PlanTask) -> tuple[bool, str]:
    for dep_id in task.depends_on or []:
        dep = find_plan_task(plan, dep_id)
        if not dep:
            return False, f"找不到依赖任务 {dep_id}"
        if dep.status in ("failed", "cancelled"):
            return False, f"依赖任务 {dep_id} 已{plan_status_label(dep.status)}"
        if not plan_task_successful(dep):
            return False, f"等待依赖任务 {dep_id}"
    return True, ""


def plan_status_label(status: str) -> str:
    labels = {
        "pending": "排队中",
        "running": "运行中",
        "approval": "等待审批",
        "review": "等待提交",
        "done": "完成",
        "committed": "已提交",
        "failed": "失败",
        "cancelled": "已取消",
    }
    return labels.get(status, status or "-")


def plan_summary(plan: PlanRuntime) -> tuple[int, int, int, int, int, int]:
    pending = sum(1 for task in plan.tasks if task.status == "pending")
    running = sum(1 for task in plan.tasks if task.status == "running")
    done = sum(1 for task in plan.tasks if task.status in ("done", "committed"))
    failed = sum(1 for task in plan.tasks if task.status in ("failed", "cancelled"))
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
    if any(task.status == "committed" and task.merge_status != "merged" for task in plan.tasks):
        return "等待合并"
    return "完成"


def build_plan_card(plan: PlanRuntime) -> dict[str, Any]:
    pending, running, done, failed, waiting, review = plan_summary(plan)
    plan.status = plan_status_text(plan)
    template = "green" if plan.status == "完成" else "orange" if waiting or review or failed or plan.status == "等待合并" else "blue"
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
    if plan.merge_status or plan.merge_output:
        elements.append(md(f"**合并状态**\n{plan.merge_status or '-'}\n{final_reply_text(plan.merge_output, 900)}"))
    for task in plan.tasks[:12]:
        elapsed = format_duration((task.finished_at or time.time()) - task.started_at) if task.started_at else "-"
        line = (
            f"**{task.task_id}. {short_text(task.title, 80)}**\n"
            f"状态：{plan_status_label(task.status)} · 耗时：{elapsed}"
        )
        if task.phase:
            line += f" · 阶段：{task.phase}"
        if task.depends_on:
            line += f"\n依赖：{', '.join(task.depends_on)}"
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
        task_actions = [
            compact_button("详情", "plan_task_detail", {"chat_id": plan.chat_id, "plan_id": plan.plan_id, "task_id": task.task_id}, "primary"),
        ]
        if task.status == "pending":
            task_actions.append(compact_button("取消", "plan_task_cancel", {"chat_id": plan.chat_id, "plan_id": plan.plan_id, "task_id": task.task_id}, "danger"))
        elif task.status == "running":
            task_actions.append(compact_button("停止", "plan_task_stop", {"chat_id": plan.chat_id, "plan_id": plan.plan_id, "task_id": task.task_id}, "danger"))
        elif task.status in ("failed", "cancelled"):
            task_actions.append(compact_button("重试", "plan_task_retry", {"chat_id": plan.chat_id, "plan_id": plan.plan_id, "task_id": task.task_id}))
        if task.status in ("done", "committed", "failed", "cancelled") and task.worktree_path and task.cleanup_status != "cleaned":
            task_actions.append(compact_button("清理", "plan_cleanup_confirm", {"chat_id": plan.chat_id, "plan_id": plan.plan_id, "task_id": task.task_id, "scope": "task"}))
        elements.append(action_row(task_actions))
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
                    ]
                )
            )
            elements.append(
                action_row(
                    [
                        compact_button("跳过提交", "plan_skip_commit", {"chat_id": plan.chat_id, "plan_id": plan.plan_id, "task_id": task.task_id}, "danger"),
                        compact_button("丢弃改动", "plan_discard", {"chat_id": plan.chat_id, "plan_id": plan.plan_id, "task_id": task.task_id}, "danger"),
                    ]
                )
            )
        if task.status == "committed" and task.commit_hash and task.merge_status != "merged":
            elements.append(
                action_row(
                    [
                        compact_button("合并", "plan_merge_task", {"chat_id": plan.chat_id, "plan_id": plan.plan_id, "task_id": task.task_id}, "primary"),
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
    if any(task.status == "committed" and task.commit_hash for task in plan.tasks):
        actions.append(compact_button("合并总览", "plan_merge", {"chat_id": plan.chat_id, "plan_id": plan.plan_id}, "primary"))
    if any(task.worktree_path and task.cleanup_status != "cleaned" and plan_task_terminal(task) for task in plan.tasks):
        actions.append(compact_button("清理", "plan_cleanup_confirm", {"chat_id": plan.chat_id, "plan_id": plan.plan_id, "scope": "all"}))
    elements.append(action_row(actions))
    return base_card("Agent Plan", elements, template)


def build_plan_task_card(plan: PlanRuntime, task: PlanTask) -> dict[str, Any]:
    cwd = plan_task_cwd(plan, task)
    elapsed = format_duration((task.finished_at or time.time()) - task.started_at) if task.started_at else "-"
    elements: list[dict[str, Any]] = [
        fields(
            [
                ("状态", plan_status_label(task.status)),
                ("任务", task.task_id),
                ("耗时", elapsed),
            ]
        ),
        md(
            f"**Plan**：`{plan.plan_id}`\n"
            f"**目录**：`{cwd}`\n"
            f"**标题**\n{task.title}"
        ),
    ]
    if task.phase or task.depends_on:
        elements.append(md(f"**阶段/依赖**\n阶段：{task.phase or '-'}\n依赖：{', '.join(task.depends_on) if task.depends_on else '-'}"))
    if task.model or CODEX_MODEL:
        elements.append(md(f"**模型**\n`{model_label(task.model)}`"))
    if task.session_id:
        elements.append(md(f"**Session**\n`{task.session_id}`"))
    if task.worktree_path or task.branch_name:
        elements.append(md(f"**Worktree / 分支**\n`{task.worktree_path or '-'}`\n`{task.branch_name or '-'}`"))
    if task.commit_hash or task.merge_status or task.cleanup_status:
        elements.append(
            md(
                f"**提交/合并/清理**\n"
                f"Commit：`{task.commit_hash or '-'}`\n"
                f"合并：{task.merge_status or '-'}\n"
                f"Worktree 清理：{task.cleanup_status or '-'}\n"
                f"分支清理：{task.branch_cleanup_status or '-'}"
            )
        )
    if task.test_summary:
        elements.extend([divider(), md(f"**测试**\n{task.test_summary}")])
    if task.diff_summary:
        elements.extend([divider(), md(f"**Diff 摘要**\n{final_reply_text(task.diff_summary, 1800)}")])
    if task.output:
        elements.extend([divider(), md(f"**最新输出**\n{final_reply_text(task.output, 2400)}")])

    actions = [
        compact_button("返回 Plan", "plan_refresh", {"chat_id": plan.chat_id, "plan_id": plan.plan_id}, "primary"),
    ]
    if task.status == "pending":
        actions.append(compact_button("取消", "plan_task_cancel", {"chat_id": plan.chat_id, "plan_id": plan.plan_id, "task_id": task.task_id}, "danger"))
    if task.status == "running":
        actions.append(compact_button("停止", "plan_task_stop", {"chat_id": plan.chat_id, "plan_id": plan.plan_id, "task_id": task.task_id}, "danger"))
    if task.status in ("failed", "cancelled"):
        actions.append(compact_button("重试", "plan_task_retry", {"chat_id": plan.chat_id, "plan_id": plan.plan_id, "task_id": task.task_id}))
    if task.status == "review":
        actions.extend(
            [
                compact_button("查看 Diff", "plan_diff", {"chat_id": plan.chat_id, "plan_id": plan.plan_id, "task_id": task.task_id}),
                compact_button("批准提交", "plan_commit", {"chat_id": plan.chat_id, "plan_id": plan.plan_id, "task_id": task.task_id}, "primary"),
                compact_button("丢弃改动", "plan_discard", {"chat_id": plan.chat_id, "plan_id": plan.plan_id, "task_id": task.task_id}, "danger"),
            ]
        )
    if task.status == "committed" and task.commit_hash and task.merge_status != "merged":
        actions.append(compact_button("合并", "plan_merge_task", {"chat_id": plan.chat_id, "plan_id": plan.plan_id, "task_id": task.task_id}, "primary"))
    if task.worktree_path and task.cleanup_status != "cleaned" and plan_task_terminal(task):
        actions.append(compact_button("清理", "plan_cleanup_confirm", {"chat_id": plan.chat_id, "plan_id": plan.plan_id, "task_id": task.task_id, "scope": "task"}))
    elements.append(action_row(actions))
    return base_card("Plan 子任务", elements, "orange" if task.status in ("failed", "review", "approval") else "blue")


def build_plan_merge_card(plan: PlanRuntime) -> dict[str, Any]:
    repo_root = git_repo_root(plan.cwd)
    committed = [task for task in plan.tasks if task.status == "committed" and task.commit_hash]
    cleanup_branches = [
        task for task in committed
        if task.merge_status == "merged" and task.branch_name and task.branch_cleanup_status != "cleaned"
    ]
    elements: list[dict[str, Any]] = [
        fields(
            [
                ("状态", plan.merge_status or "待合并"),
                ("可合并", str(sum(1 for task in committed if task.merge_status != "merged"))),
                ("仓库", short_text(str(repo_root or plan.cwd), 36)),
            ]
        ),
        md(f"**Plan**：`{plan.plan_id}`\n**目录**：`{plan.cwd}`"),
    ]
    if plan.merge_output:
        elements.append(md(f"**合并输出**\n{final_reply_text(plan.merge_output, 1600)}"))
    for task in committed[:12]:
        elements.append(divider())
        elements.append(
            md(
                f"**{task.task_id}. {short_text(task.title, 80)}**\n"
                f"Commit：`{task.commit_hash}`\n"
                f"合并：{task.merge_status or '待合并'}"
                + (f"\n分支：`{task.branch_name}`" if task.branch_name else "")
                + (f"\n分支清理：{task.branch_cleanup_status}" if task.branch_cleanup_status else "")
            )
        )
        if task.merge_status != "merged":
            elements.append(
                action_row(
                    [
                        compact_button("合并此项", "plan_merge_task", {"chat_id": plan.chat_id, "plan_id": plan.plan_id, "task_id": task.task_id}, "primary"),
                        compact_button("详情", "plan_task_detail", {"chat_id": plan.chat_id, "plan_id": plan.plan_id, "task_id": task.task_id}),
                    ]
                )
            )
    if len(committed) > 12:
        elements.append(note(f"还有 {len(committed) - 12} 个已提交子任务未显示。"))
    actions = [
        compact_button("返回 Plan", "plan_refresh", {"chat_id": plan.chat_id, "plan_id": plan.plan_id}, "primary"),
    ]
    if any(task.merge_status != "merged" for task in committed):
        actions.append(compact_button("合并全部", "plan_merge_all", {"chat_id": plan.chat_id, "plan_id": plan.plan_id}, "primary"))
    if plan.merge_status == "conflict":
        actions.append(compact_button("Codex 修复冲突", "plan_merge_fix", {"chat_id": plan.chat_id, "plan_id": plan.plan_id}, "primary"))
        actions.append(compact_button("中止合并", "plan_merge_abort", {"chat_id": plan.chat_id, "plan_id": plan.plan_id}, "danger"))
    if cleanup_branches:
        actions.append(compact_button("清理已合并分支", "plan_cleanup_confirm", {"chat_id": plan.chat_id, "plan_id": plan.plan_id, "scope": "branches"}))
    elements.append(action_row(actions))
    return base_card("Plan 合并总览", elements, "orange" if plan.merge_status == "conflict" else "blue")


def build_plan_cleanup_confirm_card(plan: PlanRuntime, scope: str = "all", task_id: str = "") -> dict[str, Any]:
    target_task = find_plan_task(plan, task_id) if task_id else None
    can_execute = False
    if scope == "task" and target_task:
        title = "确认清理子任务 Worktree"
        body = (
            f"将清理子任务 {target_task.task_id} 的 worktree：\n"
            f"`{target_task.worktree_path or '-'}`"
        )
        can_execute = bool(target_task.worktree_path and target_task.cleanup_status != "cleaned")
    elif scope == "task":
        title = "确认清理子任务 Worktree"
        body = "找不到要清理的子任务。"
    elif scope == "branches":
        targets = [
            task for task in plan.tasks
            if task.merge_status == "merged" and task.branch_name and task.branch_cleanup_status != "cleaned"
        ]
        title = "确认清理已合并分支"
        body = "将删除这些已通过 Plan 合并的子任务分支：\n" + "\n".join(
            f"- `{task.branch_name}`" for task in targets[:20]
        )
        if len(targets) > 20:
            body += f"\n还有 {len(targets) - 20} 个分支未显示。"
        can_execute = bool(targets)
    else:
        targets = [
            task for task in plan.tasks
            if task.worktree_path and task.cleanup_status != "cleaned" and plan_task_terminal(task)
        ]
        title = "确认清理 Plan Worktree"
        body = "将清理这些已结束子任务的 worktree：\n" + "\n".join(
            f"- {task.task_id}. `{short_text(task.worktree_path, 120)}`" for task in targets[:20]
        )
        if len(targets) > 20:
            body += f"\n还有 {len(targets) - 20} 个 worktree 未显示。"
        can_execute = bool(targets)
    actions = [
        compact_button("取消", "plan_cleanup_cancel", {"chat_id": plan.chat_id, "plan_id": plan.plan_id, "scope": scope}, "default"),
    ]
    if can_execute:
        actions.insert(
            0,
            compact_button("确认清理", "plan_cleanup_execute", {"chat_id": plan.chat_id, "plan_id": plan.plan_id, "task_id": task_id, "scope": scope}, "danger"),
        )
    elements = [
        md(f"**Plan**：`{plan.plan_id}`\n{body}\n\n该操作会修改本地 Git/worktree 状态，请确认后继续。"),
        action_row(actions),
    ]
    return base_card(title, elements, "red")


def send_plan_card(plan: PlanRuntime):
    card = build_plan_card(plan)
    message_id = send_card(plan.chat_id, card)
    if message_id:
        plan.message_id = message_id
        logger.info("plan card sent: chat_id=%s plan_id=%s message_id=%s", plan.chat_id, plan.plan_id, message_id)
        save_plans_state()


def update_plan_card(plan: PlanRuntime, force: bool = False) -> bool:
    now = time.time()
    if not force and now - plan.last_card_update_at < 2:
        return bool(plan.message_id)
    plan.last_card_update_at = now
    card = build_plan_card(plan)
    save_plans_state()
    if not plan.message_id:
        send_plan_card(plan)
        return bool(plan.message_id)
    return update_card(plan.message_id, card)


def build_dashboard_card(chat_id: str, expanded: bool = False):
    runtime = get_runtime(chat_id)
    all_groups, _ = build_index()
    projects = project_groups(all_groups)
    chats = ordinary_chat_groups(all_groups)
    total_convs = sum(len(p.conversations) for p in projects)
    running = runtime.process is not None and runtime.process.poll() is None
    latest_project = projects[0] if projects else None
    active_conv = active_conversation_for_runtime(runtime)
    active_root = conversation_project_root(active_conv) if active_conv else None
    current_project = (
        find_project(projects, project_key(active_root))
        if active_root
        else find_project(projects, runtime.active_project_key)
    )
    current_project = current_project or latest_project
    active_session_id, active_session_name = (
        project_session_summary(current_project, runtime) if current_project else ("", "")
    )

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
            f"**当前 Session**\n"
            f"{active_session_name or '-'}\n"
            f"`{active_session_id or '-'}`"
        ),
        md(
            f"**当前项目**\n"
            f"{current_project.name if current_project else '暂无'}"
            + (
                f" · {format_time(current_project.conversations[0].updated_at)}"
                if current_project and current_project.conversations
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

    _panel_pending = pending_approvals_for_chat(chat_id)
    if _panel_pending:
        _pa = sorted(_panel_pending, key=lambda a: a.created_at, reverse=True)[0]
        elements.extend([
            divider(),
            md(f"**⚠️ 待审批**\n审批 ID：`{_pa.approval_id}`\n目录：`{_pa.cwd}`\n{short_text(_pa.command, 800)}"),
            action_row([
                compact_button("批准", "approve", {"chat_id": chat_id, "approval_id": _pa.approval_id, "task_id": _pa.task_id}, "primary"),
                compact_button("拒绝", "reject", {"chat_id": chat_id, "approval_id": _pa.approval_id, "task_id": _pa.task_id}, "danger"),
            ]),
        ])

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
        return base_card(f"{APP_NAME} 看板", elements)

    elements.extend([divider(), md("**项目看板**")])
    if not projects:
        elements.append(md("还没有识别到项目会话。普通对话可发送 /chats 查看。"))
    for idx, project in enumerate(projects[:MAX_PROJECTS_IN_PANEL], 1):
        active = "（当前）" if current_project and project.key == current_project.key else ""
        latest = format_time(project.conversations[0].updated_at) if project.conversations else "-"
        cwd = str(project.cwd) if project.cwd else "无项目目录"
        desktop_count, bridge_count, other_count = project_source_counts(project)
        agent_counts = project_agent_counts_text(project)
        stage, _ = project_stage_text(project, chat_id)
        elements.append(
            md(
                f"**{idx}. {project.name}** {active}\n"
                f"阶段 {stage} · 对话 {len(project.conversations)} · 最近 {latest}\n"
                f"Agent {agent_counts}\n"
                f"Desktop {desktop_count} / {APP_NAME} {bridge_count} / 其他 {other_count}\n"
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
    return base_card(f"{APP_NAME} 看板", elements)


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

    focus_project(chat_id, project)
    runtime = get_runtime(chat_id)

    desktop_count, bridge_count, other_count = project_source_counts(project)
    agent_counts = project_agent_counts_text(project)
    stage, next_step = project_stage_text(project, chat_id)
    active_session_id, active_session_name = project_session_summary(project, runtime)
    elements = [
        fields([("项目", project.name), ("阶段", stage), ("对话", str(len(project.conversations)))]),
        md(f"**目录**\n`{project.cwd or '无项目目录'}`"),
        md(
            f"**当前 Session**\n"
            f"{active_session_name or '-'}\n"
            f"`{active_session_id or '-'}`"
        ),
        md(f"**Agent**\n{agent_counts}\n**来源**\nDesktop {desktop_count} / {APP_NAME} {bridge_count} / 其他 {other_count}\n**下一步**\n{next_step}"),
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
    active_session_id, active_session_name = active_session_summary(runtime)
    elements: list[dict[str, Any]] = [
        fields([("普通对话", str(len(chats))), ("状态", "已展开" if expanded else "已收起"), ("当前", active_session_id or "-")]),
        md(
            f"**当前 Session**\n"
            f"{active_session_name or '-'}\n"
            f"`{active_session_id or '-'}`"
        ),
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
                    compact_button("切换", "conversation", {"chat_id": chat_id, "session_id": conv.session_id}, "primary"),
                    compact_button("标为项目", "mark_project_from_chat", {"chat_id": chat_id, "session_id": conv.session_id}),
                ]
            )
        )
    if len(chats) > MAX_CONVERSATIONS_IN_PANEL:
        elements.append(note(f"仅显示最近 {MAX_CONVERSATIONS_IN_PANEL} 个普通对话。"))
    return base_card("普通对话", elements, "grey")


def build_conversation_card(chat_id: str, session_id: str, activate: bool = False):
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

    if activate:
        activate_conversation(chat_id, conv)
        runtime = get_runtime(chat_id)
    root = conversation_project_root(conv)

    is_active = conv.session_id == runtime.active_session_id
    running = is_active and runtime.process is not None and runtime.process.poll() is None
    mode = "可续写" if is_resumable_conversation(conv) else "只读展示"
    back_button = (
        compact_button("返回项目", "project", {"chat_id": chat_id, "project_key": project_key(root)})
        if root
        else compact_button("返回普通对话", "chats", {"chat_id": chat_id, "expanded": True})
    )
    action_buttons = [
        back_button,
        compact_button("刷新", "conversation_status", {"chat_id": chat_id, "session_id": conv.session_id}, "primary"),
    ]
    if not is_active:
        action_buttons.append(compact_button("切换", "conversation", {"chat_id": chat_id, "session_id": conv.session_id}, "primary"))
    action_buttons.append(compact_button("停止", "stop", {"chat_id": chat_id}, "danger"))
    elements = [
        fields([("状态", "运行中" if running else conv.status), ("Agent", agent_label(conv.agent_id)), ("来源", conversation_source_label(conv)), ("模式", mode)]),
        md(f"**标题**\n{conv.title}"),
        md(
            f"**目录**\n`{conv.cwd or runtime.cwd}`\n"
            f"**Session**：`{conv.session_id}`\n"
            f"**来源**：{conv.originator or '-'} / {conv.source or '-'}"
        ),
        action_row(action_buttons),
        divider(),
        md(f"**最近提问**\n{short_text(conv.last_user, 500) or '无'}"),
        md(f"**最近回复**\n{short_text(conv.last_assistant, 900) or '无'}"),
        md(
            "直接在聊天里发送文字会继续当前对话。"
            if is_active
            else "这是查看模式；点击“切换”后，后续文字才会继续这个对话。"
        ),
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
    return AGENT_ADAPTERS[task_agent_id(task)].build_command(task, last_message_file)


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


def conversation_matches_run(conv: ConversationInfo, cwd: Path, started_at: float, prompt: str) -> bool:
    if not same_path(conv.cwd, cwd):
        return False
    normalized_prompt = prompt.strip()
    if normalized_prompt:
        return conv.last_user.strip() == normalized_prompt
    return conv.updated_at >= started_at - 10


def agent_session_parser(agent_id: str):
    agent_id = normalize_agent_id(agent_id)
    if agent_id == "claude":
        return parse_claude_conversation
    if agent_id == "qoder":
        return parse_qoder_conversation
    return parse_conversation


def agent_session_files(agent_id: str) -> list[Path]:
    agent_id = normalize_agent_id(agent_id)
    if agent_id == "claude":
        return iter_claude_session_files()
    if agent_id == "qoder":
        return iter_qoder_session_files()
    return iter_session_files()


def find_conversation_for_run(runtime: ChatRuntime, cwd: Path, started_at: float, prompt: str, agent_id: str = "") -> Optional[ConversationInfo]:
    agent_id = normalize_agent_id(agent_id or runtime.task_agent_id or runtime.active_agent_id)
    cutoff = started_at - 10
    conv = get_active_conversation(runtime.task_session_id or runtime.active_session_id)
    if conv and normalize_agent_id(conv.agent_id) == agent_id and conv.updated_at >= cutoff and conversation_matches_run(conv, cwd, started_at, prompt):
        return conv

    fallback: Optional[ConversationInfo] = None
    normalized_prompt = prompt.strip()
    parser = agent_session_parser(agent_id)
    paths = agent_session_files(agent_id)
    for path in paths:
        try:
            if path.stat().st_mtime < cutoff:
                break
        except OSError:
            continue
        conv = parser(path)
        if not conv or not same_path(conv.cwd, cwd):
            continue
        if normalized_prompt and conv.last_user.strip() == normalized_prompt:
            return conv
        if not normalized_prompt and (fallback is None or conv.updated_at > fallback.updated_at):
            fallback = conv
    return fallback


def refresh_task_latest_reply(chat_id: str, task: CodexTaskRuntime) -> bool:
    runtime = get_runtime(chat_id)
    latest = read_last_message_file(Path(task.last_message_path)) if task.last_message_path else ""
    source = "last_message_file" if latest else ""

    if not latest:
        agent_id = task_agent_id(task, runtime)
        conv = find_conversation_for_run(runtime, task.cwd, task.started_at, task.prompt, agent_id)
        if conv:
            if conv.session_id:
                task.session_id = conv.session_id
                runtime.task_session_id = conv.session_id
                runtime.task_agent_id = agent_id
                if not task.one_shot_agent and runtime.active_session_id != conv.session_id:
                    runtime.active_session_id = conv.session_id
                    runtime.active_agent_id = agent_id
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
    agent_id: str = "",
    task: Optional[CodexTaskRuntime] = None,
) -> tuple[str, str]:
    agent_id = normalize_agent_id(agent_id or runtime.task_agent_id or runtime.active_agent_id)
    file_message = read_last_message_file(last_message_file)
    if file_message:
        last_agent_message = file_message

    user_question = prompt
    if last_agent_message and user_question:
        return last_agent_message, user_question

    for _ in range(5):
        conv = find_conversation_for_run(runtime, cwd, started_at, prompt, agent_id)
        if conv:
            if conv.session_id and runtime.task_session_id != conv.session_id:
                if task:
                    task.session_id = conv.session_id
                runtime.task_session_id = conv.session_id
                runtime.task_agent_id = agent_id
                if not (task and task.one_shot_agent) and runtime.active_session_id != conv.session_id:
                    runtime.active_session_id = conv.session_id
                    runtime.active_agent_id = agent_id
                save_runtime(chat_id)
            user_question = user_question or conv.last_user
            last_agent_message = last_agent_message or conv.last_assistant
            if last_agent_message and user_question:
                break
        time.sleep(0.2)

    if not last_agent_message:
        conv = find_conversation_for_run(runtime, cwd, started_at, prompt, agent_id)
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
        "permission was denied",
        "auto-denied",
        "auto denied",
        "can't modify",
        "cannot modify",
        "denied by user",
        "unable to create",
        ".git/index.lock",
        "终端权限",
        "权限弹窗",
    ]
    return any(signal in haystack for signal in signals)


APPROVAL_RETRY_NOTE_RE = re.compile(
    r"\s*审批结果：用户已在 Lark 批准审批 [0-9a-f]+。"
    r"请继续执行原始任务，必要时重试刚才因权限、审批或 sandbox 限制失败的操作。\s*",
    flags=re.IGNORECASE,
)


def strip_approval_retry_notes(prompt: str) -> str:
    return APPROVAL_RETRY_NOTE_RE.sub("\n\n", str(prompt or "")).strip()


def maybe_create_pending_approval(chat_id: str, runtime: ChatRuntime, text: str, task: Optional[CodexTaskRuntime] = None) -> bool:
    if task and task.approved_retry:
        return False
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
    agent_id = task_agent_id(task, runtime)
    adapter = AGENT_ADAPTERS[agent_id]
    approval = PendingApproval(
        approval_id=approval_id,
        chat_id=chat_id,
        task_id=task.task_id if task else "",
        agent_id=agent_id,
        session_id=(task.session_id if task else "") or runtime.task_session_id or runtime.active_session_id,
        cwd=str(task.cwd if task else runtime_task_cwd(runtime)),
        command=short_text(text, 1000),
        reason=f"{adapter.label} 输出中检测到需要人工批准的内容",
        model=(task.model if task else "") or runtime.task_model,
        original_prompt=(task.prompt if task else "") or runtime.task_prompt,
        resume_prompt=(
            "用户已在 Lark 审批通过。请继续执行刚才等待审批的操作；"
            "如果无法自动继续，请给出用户需要在本机执行的准确命令。"
        ),
        one_shot_agent=bool(task and task.one_shot_agent),
    )
    with LOCK:
        PENDING_APPROVALS[approval_id] = approval
    updated = update_task_card(
        chat_id,
        status="等待审批",
        output=text,
        detail=f"{adapter.label} 请求人工确认。可直接在这张任务卡里批准或拒绝；{format_duration(PENDING_APPROVAL_WAIT_SECONDS)} 内未处理会按当前 Agent 默认配置继续。",
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
        fd, name = tempfile.mkstemp(prefix="lark2agent-plan-", suffix=".txt")
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
        if not is_allowed_cwd(task_cwd):
            raise RuntimeError(f"Plan 子任务目录不在允许范围内：{task_cwd}")
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
        short_text(task.prompt, 120) if LOG_MESSAGE_CONTENT else f"<hidden len={len(task.prompt)}>",
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
        ready: list[PlanTask] = []
        for task in pending:
            satisfied, reason = plan_task_dependencies_satisfied(plan, task)
            if satisfied:
                ready.append(task)
            elif reason.startswith("依赖任务") or reason.startswith("找不到依赖"):
                task.status = "failed"
                task.output = reason
                task.finished_at = time.time()
            else:
                task.output = reason
        slots = max(0, plan.max_parallel - len(running))
        for task in ready[:slots]:
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
    if not is_allowed_cwd(runtime.cwd):
        send_msg(chat_id, f"当前目录不在允许范围内：`{runtime.cwd}`\n允许范围：{allowed_roots_text()}")
        return
    task_specs = parse_plan_task_specs(content)
    if not task_specs:
        send_msg(chat_id, "请发送任务清单，例如：\n/plan\n- 任务一\n- 任务二")
        return
    slots = min(len(task_specs), max(1, PLAN_MAX_PARALLEL))
    allowed, reason = can_start_work(chat_id, slots=slots)
    if not allowed:
        send_msg(chat_id, reason)
        return
    plan_id = hashlib.sha1(f"{chat_id}:{time.time()}:{content}".encode("utf-8")).hexdigest()[:10]
    plan = PlanRuntime(
        plan_id=plan_id,
        chat_id=chat_id,
        cwd=runtime.cwd,
        tasks=[
            plan_task_from_text(
                index,
                spec["text"],
                model,
                phase=str(spec.get("phase", "") or ""),
                depends_on=[str(item) for item in spec.get("depends_on", []) if item],
            )
            for index, spec in enumerate(task_specs, 1)
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


def restart_plan_runner(plan: PlanRuntime):
    plan.stop_requested = False
    threading.Thread(target=plan_runner_loop, args=(plan.plan_id,), name=f"plan-runner-{plan.plan_id}", daemon=True).start()


def retry_plan_task(chat_id: str, plan_id: str, task_id: str) -> bool:
    plan = find_plan(plan_id)
    if not plan or plan.chat_id != chat_id:
        return False
    task = find_plan_task(plan, task_id)
    if not task:
        return False
    if task.process and task.process.poll() is None:
        task.output = "子任务正在运行，不能重试。"
        update_plan_card(plan, force=True)
        return True
    if task.status not in ("failed", "cancelled"):
        task.output = f"当前状态 {plan_status_label(task.status)} 不能重试。"
        update_plan_card(plan, force=True)
        return True
    task.retry_count += 1
    task.status = "pending"
    task.finished_at = 0
    task.started_at = 0
    task.approval_required = False
    task.approved_retry = False
    task.diff_summary = ""
    task.test_summary = ""
    task.commit_message = ""
    task.commit_hash = ""
    task.merge_status = ""
    task.output = f"已重新排队，重试次数：{task.retry_count}"
    update_plan_card(plan, force=True)
    restart_plan_runner(plan)
    return True


def stop_or_cancel_plan_task(chat_id: str, plan_id: str, task_id: str) -> bool:
    plan = find_plan(plan_id)
    if not plan or plan.chat_id != chat_id:
        return False
    task = find_plan_task(plan, task_id)
    if not task:
        return False
    if task.process and task.process.poll() is None:
        task.process.terminate()
        task.status = "cancelled"
        task.output = "子任务已停止。"
        task.finished_at = time.time()
    elif task.status in ("pending", "approval"):
        task.status = "cancelled"
        task.output = "子任务已取消。"
        task.finished_at = time.time()
    else:
        task.output = f"当前状态 {plan_status_label(task.status)} 不能取消或停止。"
    update_plan_card(plan, force=True)
    return True


def discard_plan_task_changes(chat_id: str, plan_id: str, task_id: str) -> bool:
    plan = find_plan(plan_id)
    if not plan or plan.chat_id != chat_id:
        return False
    task = find_plan_task(plan, task_id)
    if not task:
        return False
    cwd = plan_task_cwd(plan, task)
    if task.process and task.process.poll() is None:
        task.output = "子任务仍在运行，不能丢弃改动。"
        update_plan_card(plan, force=True)
        return True
    if not git_repo_root(cwd):
        task.output = "当前子任务目录不是 Git 仓库，不能自动丢弃改动。"
        update_plan_card(plan, force=True)
        return True
    code, output = git_command(cwd, ["reset", "--hard"], timeout=30)
    if code == 0:
        clean_code, clean_output = git_command(cwd, ["clean", "-fd"], timeout=30)
        code = clean_code
        output = clean_output
    if code != 0:
        task.output = f"丢弃改动失败。\n{short_text(output, 1200)}"
    else:
        task.status = "done"
        task.diff_summary = ""
        task.output = "已丢弃该子任务 worktree 中的未提交改动。"
    update_plan_card(plan, force=True)
    return True


def cleanup_plan_task_worktree(chat_id: str, plan_id: str, task_id: str) -> bool:
    plan = find_plan(plan_id)
    if not plan or plan.chat_id != chat_id:
        return False
    task = find_plan_task(plan, task_id)
    if not task:
        return False
    if task.process and task.process.poll() is None:
        task.output = "子任务仍在运行，不能清理 worktree。"
        update_plan_card(plan, force=True)
        return True
    if not task.worktree_path:
        task.cleanup_status = "cleaned"
        task.output = "没有可清理的 worktree。"
        update_plan_card(plan, force=True)
        return True
    worktree = Path(task.worktree_path).expanduser()
    repo_root = git_repo_root(plan.cwd)
    output = ""
    code = 1
    if repo_root:
        code, output = git_command(repo_root, ["worktree", "remove", "--force", str(worktree)], timeout=60)
    if code != 0 and worktree.exists() and path_is_under(worktree, plan_worktree_root(repo_root or plan.cwd)):
        try:
            shutil.rmtree(worktree)
            code = 0
            output = "已直接删除 worktree 目录。"
        except OSError as e:
            output = f"{output}\n直接删除也失败：{type(e).__name__}: {e}"
    if code != 0:
        task.output = f"清理 worktree 失败。\n{short_text(output, 1200)}"
    else:
        task.cleanup_status = "cleaned"
        task.worktree_path = ""
        task.output = "已清理 worktree。"
    update_plan_card(plan, force=True)
    return True


def cleanup_plan_worktrees(chat_id: str, plan_id: str) -> bool:
    plan = find_plan(plan_id)
    if not plan or plan.chat_id != chat_id:
        return False
    count = 0
    for task in plan.tasks:
        if task.worktree_path and task.cleanup_status != "cleaned" and plan_task_terminal(task):
            cleanup_plan_task_worktree(chat_id, plan_id, task.task_id)
            count += 1
    plan.merge_output = f"已尝试清理 {count} 个已结束子任务 worktree。"
    update_plan_card(plan, force=True)
    return True


def cleanup_plan_branches(chat_id: str, plan_id: str) -> bool:
    plan = find_plan(plan_id)
    if not plan or plan.chat_id != chat_id:
        return False
    repo_root = git_repo_root(plan.cwd)
    if not repo_root:
        plan.merge_status = "failed"
        plan.merge_output = "当前 Plan 目录不是 Git 仓库，不能清理分支。"
        update_plan_card(plan, force=True)
        return True
    cleaned = 0
    failures: list[str] = []
    for task in plan.tasks:
        if task.merge_status != "merged" or not task.branch_name or task.branch_cleanup_status == "cleaned":
            continue
        code, output = git_command(repo_root, ["branch", "-D", task.branch_name], timeout=30)
        if code == 0:
            task.branch_cleanup_status = "cleaned"
            cleaned += 1
        else:
            failures.append(f"{task.task_id}. `{task.branch_name}`\n{short_text(output, 600)}")
    plan.merge_output = f"已清理 {cleaned} 个已合并子任务分支。"
    if failures:
        plan.merge_output += "\n\n清理失败：\n" + "\n".join(failures[:6])
    update_plan_card(plan, force=True)
    return True


def execute_plan_cleanup(chat_id: str, plan_id: str, scope: str = "all", task_id: str = "") -> bool:
    if scope == "task":
        return cleanup_plan_task_worktree(chat_id, plan_id, task_id)
    if scope == "branches":
        return cleanup_plan_branches(chat_id, plan_id)
    return cleanup_plan_worktrees(chat_id, plan_id)


def git_conflict_files(cwd: Path) -> list[str]:
    is_repo, entries, _ = git_status_entries(cwd)
    if not is_repo:
        return []
    return [entry[3:] if len(entry) > 3 else entry for entry in entries if entry[:2] in ("UU", "AA", "DD", "AU", "UA", "DU", "UD")]


def git_cherry_pick_in_progress(cwd: Path) -> bool:
    code, _ = git_command(cwd, ["rev-parse", "--verify", "CHERRY_PICK_HEAD"], timeout=5)
    return code == 0


def plan_conflict_task(plan: PlanRuntime) -> Optional[PlanTask]:
    for task in plan.tasks:
        if task.merge_status == "conflict":
            return task
    return None


def cherry_pick_plan_task(chat_id: str, plan_id: str, task_id: str) -> bool:
    plan = find_plan(plan_id)
    if not plan or plan.chat_id != chat_id:
        return False
    task = find_plan_task(plan, task_id)
    if not task:
        return False
    repo_root = git_repo_root(plan.cwd)
    if not repo_root:
        plan.merge_status = "failed"
        plan.merge_output = "当前 Plan 目录不是 Git 仓库，不能合并。"
        update_plan_card(plan, force=True)
        return True
    if task.status != "committed" or not task.commit_hash:
        task.output = "只有已提交的子任务可以合并。"
        update_plan_card(plan, force=True)
        return True
    is_repo, entries, _ = git_status_entries(repo_root)
    if is_repo and entries:
        plan.merge_status = "blocked"
        plan.merge_output = "主工作区存在未提交改动或冲突，合并前请先处理。\n" + "\n".join(entries[:20])
        update_plan_card(plan, force=True)
        return True
    code, output = git_command(repo_root, ["cherry-pick", task.commit_hash], timeout=120)
    if code == 0:
        task.merge_status = "merged"
        plan.merge_status = "merged"
        plan.merge_output = f"已合并子任务 {task.task_id}：`{task.commit_hash}`"
    else:
        conflicts = git_conflict_files(repo_root)
        task.merge_status = "conflict" if conflicts else "failed"
        plan.merge_status = "conflict" if conflicts else "failed"
        conflict_text = "\n冲突文件：\n" + "\n".join(conflicts[:20]) if conflicts else ""
        plan.merge_output = f"合并子任务 {task.task_id} 失败。\n{short_text(output, 1600)}{conflict_text}"
    update_plan_card(plan, force=True)
    return True


def merge_all_plan_tasks(chat_id: str, plan_id: str) -> bool:
    plan = find_plan(plan_id)
    if not plan or plan.chat_id != chat_id:
        return False
    merged = 0
    for task in plan.tasks:
        if task.status == "committed" and task.commit_hash and task.merge_status != "merged":
            cherry_pick_plan_task(chat_id, plan_id, task.task_id)
            if task.merge_status == "merged":
                merged += 1
                continue
            return True
    plan.merge_status = "merged" if merged else (plan.merge_status or "noop")
    plan.merge_output = f"合并全部完成，本次合并 {merged} 个子任务。"
    update_plan_card(plan, force=True)
    return True


def plan_merge_conflict_prompt(plan: PlanRuntime, task: Optional[PlanTask], conflicts: list[str]) -> str:
    task_text = f"{task.task_id}. {task.title}" if task else "未知子任务"
    conflict_text = "\n".join(f"- {path}" for path in conflicts[:30])
    return (
        "当前仓库正在执行 Plan 子任务 cherry-pick，并发生 Git 冲突。\n"
        "请直接修改工作区文件解决冲突，移除冲突标记，保留正确的业务改动。\n"
        "不要执行 git add、git commit、git cherry-pick --continue、git cherry-pick --abort，也不要删除无关文件。\n\n"
        f"Plan：{plan.plan_id}\n"
        f"子任务：{task_text}\n"
        f"冲突文件：\n{conflict_text}\n\n"
        "完成后请简要说明解决思路。"
    )


def start_plan_merge_conflict_fix(chat_id: str, plan_id: str) -> bool:
    plan = find_plan(plan_id)
    if not plan or plan.chat_id != chat_id:
        return False
    repo_root = git_repo_root(plan.cwd)
    if not repo_root:
        plan.merge_status = "failed"
        plan.merge_output = "当前 Plan 目录不是 Git 仓库，不能自动修复冲突。"
        update_plan_card(plan, force=True)
        return True
    conflicts = git_conflict_files(repo_root)
    if not conflicts or not git_cherry_pick_in_progress(repo_root):
        plan.merge_status = "failed"
        plan.merge_output = "当前没有可自动修复的 cherry-pick 冲突。"
        update_plan_card(plan, force=True)
        return True
    if plan.merge_status == "fixing":
        return True
    plan.merge_status = "fixing"
    plan.merge_output = "已启动 Codex 自动修复合并冲突。"
    update_plan_card(plan, force=True)
    threading.Thread(
        target=run_plan_merge_conflict_fix,
        args=(chat_id, plan_id),
        name=f"plan-merge-fix-{plan_id}",
        daemon=True,
    ).start()
    return True


def run_plan_merge_conflict_fix(chat_id: str, plan_id: str):
    plan = find_plan(plan_id)
    if not plan or plan.chat_id != chat_id:
        return
    repo_root = git_repo_root(plan.cwd)
    if not repo_root:
        return
    task = plan_conflict_task(plan)
    conflicts = git_conflict_files(repo_root)
    if not conflicts:
        plan.merge_status = "failed"
        plan.merge_output = "没有检测到冲突文件，自动修复已停止。"
        update_plan_card(plan, force=True)
        return

    last_message_path: Optional[Path] = None
    try:
        fd, name = tempfile.mkstemp(prefix="lark2agent-merge-fix-", suffix=".txt")
        os.close(fd)
        last_message_path = Path(name)
    except OSError:
        logger.exception("failed to create merge fix last message file")

    runtime = ChatRuntime(cwd=repo_root)
    runtime.next_approval_policy = APPROVED_CODEX_APPROVAL_POLICY
    runtime.next_sandbox_mode = APPROVED_CODEX_SANDBOX_MODE
    prompt = plan_merge_conflict_prompt(plan, task, conflicts)
    argv = codex_command(runtime, prompt, last_message_path)
    output_parts: list[str] = []
    code: Optional[int] = None
    try:
        proc = subprocess.Popen(
            argv,
            cwd=str(repo_root),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        assert proc.stdout is not None
        last_flush = time.time()
        while True:
            line = proc.stdout.readline()
            if not line:
                if proc.poll() is not None:
                    break
                time.sleep(0.1)
                continue
            kind, text = parse_codex_json_event(line)
            if kind == "skip" or kind == "session_id" or not text:
                continue
            output_parts.append(text)
            if time.time() - last_flush >= 3:
                plan.merge_output = "Codex 正在修复冲突。\n" + final_reply_text("\n".join(output_parts[-4:]), 1200)
                update_plan_card(plan)
                last_flush = time.time()
        code = proc.wait(timeout=5)
    except Exception as e:
        logger.exception("plan merge conflict fix failed: plan_id=%s", plan_id)
        plan.merge_status = "conflict"
        plan.merge_output = f"Codex 修复冲突执行异常：{type(e).__name__}: {e}"
        update_plan_card(plan, force=True)
        return
    finally:
        latest = read_last_message_file(last_message_path)
        if latest:
            output_parts.append(latest)
        if last_message_path:
            last_message_path.unlink(missing_ok=True)

    summary = final_reply_text("\n".join(part for part in output_parts if part), 1600)
    if code != 0:
        plan.merge_status = "conflict"
        plan.merge_output = f"Codex 修复冲突失败，退出码 {code}。\n{summary}"
        update_plan_card(plan, force=True)
        return

    conflicts = git_conflict_files(repo_root)
    if conflicts:
        plan.merge_status = "conflict"
        if task:
            task.merge_status = "conflict"
        plan.merge_output = "Codex 已返回，但仍存在冲突文件：\n" + "\n".join(conflicts[:20])
        if summary:
            plan.merge_output += "\n\n" + summary
        update_plan_card(plan, force=True)
        return

    test_ok, test_summary = run_plan_test_command(repo_root)
    if not test_ok:
        plan.merge_status = "conflict"
        plan.merge_output = f"冲突文件已解决，但测试未通过，暂不继续 cherry-pick。\n{test_summary}"
        if summary:
            plan.merge_output += "\n\n" + summary
        update_plan_card(plan, force=True)
        return

    add_code, add_output = git_command(repo_root, ["add", "-A"], timeout=30)
    if add_code != 0:
        plan.merge_status = "conflict"
        plan.merge_output = f"冲突已解决，但 git add 失败。\n{short_text(add_output, 1200)}"
        update_plan_card(plan, force=True)
        return

    continue_code, continue_output = git_command(repo_root, ["-c", "core.editor=true", "cherry-pick", "--continue"], timeout=120)
    if continue_code == 0:
        if task:
            task.merge_status = "merged"
        plan.merge_status = "merged"
        plan.merge_output = f"Codex 已修复冲突并完成 cherry-pick。\n\n**测试**\n{test_summary}"
        if summary:
            plan.merge_output += "\n\n" + summary
    else:
        conflicts = git_conflict_files(repo_root)
        plan.merge_status = "conflict" if conflicts or git_cherry_pick_in_progress(repo_root) else "failed"
        if task:
            task.merge_status = plan.merge_status
        conflict_text = "\n冲突文件：\n" + "\n".join(conflicts[:20]) if conflicts else ""
        plan.merge_output = f"冲突修复后继续 cherry-pick 失败。\n{short_text(continue_output, 1600)}{conflict_text}"
    update_plan_card(plan, force=True)


def abort_plan_merge(chat_id: str, plan_id: str) -> bool:
    plan = find_plan(plan_id)
    if not plan or plan.chat_id != chat_id:
        return False
    repo_root = git_repo_root(plan.cwd)
    if not repo_root:
        return False
    code, output = git_command(repo_root, ["cherry-pick", "--abort"], timeout=30)
    if code == 0:
        plan.merge_status = "aborted"
        plan.merge_output = "已中止 cherry-pick。"
    else:
        plan.merge_output = f"中止 cherry-pick 失败。\n{short_text(output, 1200)}"
    update_plan_card(plan, force=True)
    return True


def running_process_counts(chat_id: str = "") -> tuple[int, int]:
    pids: set[int] = set()
    chat_pids: set[int] = set()
    with LOCK:
        tasks = list(TASKS.values())
    with PLAN_LOCK:
        plans = list(PLANS.values())

    def add_proc(proc: Optional[subprocess.Popen], owner_chat_id: str):
        if proc is None or proc.poll() is not None or proc.pid is None:
            return
        pids.add(proc.pid)
        if chat_id and owner_chat_id == chat_id:
            chat_pids.add(proc.pid)

    for task in tasks:
        add_proc(task.process, task.chat_id)
    for plan in plans:
        for task in plan.tasks:
            add_proc(task.process, plan.chat_id)
    return len(pids), len(chat_pids)


def can_start_work(chat_id: str, slots: int = 1) -> tuple[bool, str]:
    total, per_chat = running_process_counts(chat_id)
    slots = max(1, slots)
    if MAX_RUNNING_TASKS > 0 and total + slots > MAX_RUNNING_TASKS:
        return False, f"当前运行任务数已达上限：{total}/{MAX_RUNNING_TASKS}"
    if MAX_RUNNING_TASKS_PER_CHAT > 0 and per_chat + slots > MAX_RUNNING_TASKS_PER_CHAT:
        return False, f"当前会话运行任务数已达上限：{per_chat}/{MAX_RUNNING_TASKS_PER_CHAT}"
    return True, ""


def stop_plan(chat_id: str, plan_id: str = ""):
    plan = find_plan(plan_id) if plan_id else latest_plan_for_chat(chat_id)
    if not plan:
        send_msg(chat_id, "当前没有可停止的 Plan。")
        return
    plan.stop_requested = True
    update_plan_card(plan, force=True)


def restart_bridge(chat_id: str):
    logger.info("restart requested: chat_id=%s argv=%s", chat_id, sys.argv)
    send_msg(chat_id, f"正在重启 {APP_NAME} WebSocket；请稍后发送 /status 确认。")
    save_runtime(chat_id)
    STOP_SCHEDULER.set()
    stop_power_management()
    time.sleep(0.5)
    os.execv(sys.executable, [sys.executable, *_ORIG_ARGV])


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
        agent_id = active_agent_id(runtime)
        adapter = AGENT_ADAPTERS[agent_id]
        task_id = send_task_card(
            chat_id,
            prompt,
            "等待启动",
            runtime.next_model or runtime.task_model or adapter.default_model,
            agent_id=agent_id,
            force_ordinary=force_ordinary,
        )
        task = find_task(task_id)
    if task is None:
        send_msg(chat_id, "创建任务运行态失败。")
        return
    agent_id = task_agent_id(task, runtime)
    adapter = AGENT_ADAPTERS[agent_id]

    with LOCK:
        cwd = task.cwd

    if not cwd.is_dir():
        text = f"当前目录不存在：{cwd}\n请先用 /cd 切换到有效目录。"
        if not update_task_card(chat_id, status="失败", output=text, force=True, task_id=task.task_id):
            send_msg(chat_id, text)
        return
    if not is_allowed_cwd(cwd):
        text = f"当前目录不在允许范围内：`{cwd}`\n允许范围：{allowed_roots_text()}"
        if not update_task_card(chat_id, status="失败", output=text, force=True, task_id=task.task_id):
            send_msg(chat_id, text)
        return

    task_session_id = task.session_id
    selected_conv = get_active_conversation(task_session_id)
    if task_session_id and not adapter.is_resumable(selected_conv):
        notice = (
            f"当前选中的会话不能由 {adapter.label} CLI 可靠续写。\n"
            "我会在同一目录启动一个新的 bridge 会话，并把结果同步到这里。"
        )
        update_task_card(chat_id, status="准备中", detail=notice, force=True, task_id=task.task_id)
        task.session_id = ""
        if not task.one_shot_agent and runtime.active_session_id == task_session_id:
            runtime.active_session_id = ""
        save_runtime(chat_id)

    last_message_path: Optional[Path] = None
    try:
        fd, name = tempfile.mkstemp(prefix="lark2agent-last-", suffix=".txt")
        os.close(fd)
        last_message_path = Path(name)
        task.last_message_path = str(last_message_path)
    except OSError:
        logger.exception("failed to create codex last message file")

    run_lock = session_run_lock(task.session_id, agent_id)
    lock_acquired = False
    if run_lock:
        if not run_lock.acquire(blocking=False):
            task.queued_for_session = True
            update_task_card(
                chat_id,
                status="等待启动",
                detail=f"同一 Session `{task.session_id}` 已有任务在运行，本指令会排队执行。",
                force=True,
                task_id=task.task_id,
            )
            run_lock.acquire()
        lock_acquired = True

    if task.cancel_requested:
        task.queued_for_session = False
        task.guidance_requested = False
        if lock_acquired and run_lock:
            run_lock.release()
            lock_acquired = False
        update_task_card(
            chat_id,
            status="已取消",
            detail="这条任务在排队期间已取消，未启动 Codex。",
            force=True,
            task_id=task.task_id,
        )
        return

    task.queued_for_session = False
    task.guidance_requested = False
    apply_guidance_to_task_prompt(task)
    prompt = task.prompt
    runtime.task_prompt = task.prompt
    runtime.task_agent_id = agent_id
    runtime.task_session_id = task.session_id
    runtime.task_cwd = str(task.cwd)
    argv = codex_task_command(task, last_message_path)
    selected_model = task.model or adapter.default_model
    selected_permission_mode = task.permission_mode or default_permission_mode(agent_id)
    runtime.next_approval_policy = ""
    runtime.next_sandbox_mode = ""
    runtime.next_model = ""
    save_runtime(chat_id)
    logger.info(
        "starting agent: agent=%s chat_id=%s cwd=%s model=%s permission_mode=%s resume=%s prompt=%r",
        agent_id,
        chat_id,
        cwd,
        selected_model or "default",
        selected_permission_mode or "-",
        bool(task.session_id),
        short_text(prompt, 120) if LOG_MESSAGE_CONTENT else f"<hidden len={len(prompt)}>",
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
        env_names = {"codex": "CODEX_BIN", "claude": "CLAUDE_BIN", "qoder": "QODER_BIN"}
        env_name = env_names.get(agent_id, "AGENT_BIN")
        text = f"找不到 {adapter.label} 命令：{adapter.bin_name}\n请设置 {env_name} 或确认命令在 PATH 中。"
        if not update_task_card(chat_id, status="失败", output=text, force=True, task_id=task.task_id):
            send_msg(chat_id, text)
        return
    except Exception as e:
        logger.exception("failed to start agent: agent=%s", agent_id)
        if last_message_path:
            last_message_path.unlink(missing_ok=True)
        if lock_acquired and run_lock:
            run_lock.release()
        text = f"启动 {adapter.label} 失败：{type(e).__name__}: {e}"
        if not update_task_card(chat_id, status="失败", output=text, force=True, task_id=task.task_id):
            send_msg(chat_id, text)
        return

    with LOCK:
        task.process = proc
        runtime.process = proc

    logger.info("agent started: agent=%s chat_id=%s pid=%s", agent_id, chat_id, proc.pid)
    update_task_card(
        chat_id,
        status="运行中",
        detail=f"{adapter.label} 已开始处理。\n目录：`{cwd}`\n模型：`{agent_model_label(agent_id, selected_model)}`",
        force=True,
        task_id=task.task_id,
    )
    buffer: list[str] = []
    last_flush = time.time()
    start = time.time()
    emitted_output = False
    last_agent_message = ""
    retry_after_approval = False

    try:
        assert proc.stdout is not None
        while True:
            if time.time() - start > adapter.timeout_seconds:
                proc.kill()
                send_stream_update(chat_id, buffer, force=True, task_id=task.task_id)
                last_agent_message, user_question = resolve_task_result(
                    chat_id, runtime, cwd, start, prompt, last_agent_message, last_message_path, agent_id, task
                )
                text = task_end_text(
                    runtime,
                    cwd,
                    None,
                    start,
                    emitted_output or bool(last_agent_message),
                    last_agent_message,
                    detail=f"超过 {format_duration(adapter.timeout_seconds)}，进程已终止。",
                    user_question=user_question,
                    task=task,
                )
                update_existing_task_card(chat_id, status="超时", output=text, task_id=task.task_id)
                return

            line = proc.stdout.readline()
            if not line:
                if proc.poll() is not None:
                    break
                time.sleep(0.1)
                continue

            for kind, text in adapter.parse_events(line):
                logger.debug("agent event: agent=%s kind=%s text=%r", agent_id, kind, short_text(text, 160))
                if kind == "session_id" and text:
                    session_key = conversation_key(agent_id, text)
                    task.session_id = session_key
                    runtime.task_session_id = session_key
                    if not task.one_shot_agent:
                        runtime.active_session_id = session_key
                        runtime.active_agent_id = agent_id
                    if task.force_ordinary:
                        def mutate(config: dict[str, Any]):
                            sessions = set(str(item) for item in config.get("ordinary_sessions", []) if item)
                            sessions.add(session_key)
                            config["ordinary_sessions"] = sorted(sessions)
                        update_classification(mutate)
                    save_runtime(chat_id)
                    record_task_lark_refs(task)
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
            chat_id, runtime, cwd, start, prompt, last_agent_message, last_message_path, agent_id, task
        )
        if not task.one_shot_agent:
            task.session_id = runtime.task_session_id or task.session_id
        emitted_output = emitted_output or bool(last_agent_message)
        logger.info("agent exited: agent=%s chat_id=%s pid=%s code=%s emitted_output=%s", agent_id, chat_id, proc.pid, code, emitted_output)
        result_status = "完成" if code == 0 else "失败"
        result_text = task_end_text(
            runtime,
            cwd,
            code,
            start,
            emitted_output,
            last_agent_message,
            user_question=user_question,
            task=task,
        )
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
                record_task_lark_refs(task, result_text)
                retry_after_approval = decision == "approved"
                return
        update_existing_task_card(chat_id, status=result_status, output=result_text, task_id=task.task_id)
        record_task_lark_refs(task, result_text)
    except Exception as e:
        logger.exception("run_codex exception")
        text = f"执行异常：{type(e).__name__}: {e}"
        update_existing_task_card(chat_id, status="异常", output=text, task_id=task.task_id)
        record_task_lark_refs(task, text)
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
        if retry_after_approval:
            threading.Thread(target=run_codex, args=(chat_id, task.prompt, False, task.task_id), daemon=True).start()


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
    label = agent_label(task_agent_id(task, runtime))
    updated = update_task_card(chat_id, status="已停止", detail=f"已停止当前 {label} 任务。", force=True, task_id=task.task_id if task else task_id)
    if not updated:
        send_msg(chat_id, f"已停止当前 {label} 任务。")
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
        if normalize_agent_id(approval.agent_id) == "codex":
            result_text += (
                "\n\n"
                f"将使用 `{APPROVED_CODEX_SANDBOX_MODE}` / `{APPROVED_CODEX_APPROVAL_POLICY}` 单次重试原始任务。"
            )
        else:
            permission_mode = approved_permission_mode(approval.agent_id)
            permission_text = f"`{permission_mode}` permission mode" if permission_mode else "默认权限模式"
            result_text += (
                f"\n\n将使用 {agent_label(approval.agent_id)} 适配器单次重试原始任务；"
                f"{permission_text}。"
            )
    else:
        result_text += "\n\n用户已拒绝，本次任务不会继续执行待审批操作。"

    runtime = get_runtime(chat_id)
    task = find_task(approval.task_id)
    agent_id = normalize_agent_id(approval.agent_id or (task.agent_id if task else "") or runtime.task_agent_id)
    if approved and approval.session_id:
        runtime.task_session_id = approval.session_id
        if not approval.one_shot_agent:
            runtime.active_session_id = approval.session_id
        if task:
            task.session_id = approval.session_id
    if approved:
        prompt = strip_approval_retry_notes(approval.original_prompt) or approval.resume_prompt or strip_approval_retry_notes(runtime.task_prompt)
        model = approval.model or runtime.task_model
        prompt = (
            f"{prompt}\n\n"
            f"审批结果：用户已在 Lark 批准审批 {approval_id}。"
            "请继续执行原始任务，必要时重试刚才因权限、审批或 sandbox 限制失败的操作。"
        )
        runtime.task_prompt = prompt
        if not approval.one_shot_agent:
            runtime.active_agent_id = agent_id
        runtime.task_agent_id = agent_id
        runtime.task_model = model
        runtime.task_cwd = approval.cwd or runtime.task_cwd
        runtime.task_status = "已批准，继续执行"
        runtime.next_approval_policy = APPROVED_CODEX_APPROVAL_POLICY if agent_id == "codex" else ""
        runtime.next_sandbox_mode = APPROVED_CODEX_SANDBOX_MODE if agent_id == "codex" else ""
        runtime.next_model = model
        if task:
            task.agent_id = agent_id
            task.prompt = prompt
            task.model = model
            task.cwd = Path(approval.cwd).expanduser() if approval.cwd else task.cwd
            task.one_shot_agent = approval.one_shot_agent
            task.status = "已批准，继续执行"
            task.approval_policy = APPROVED_CODEX_APPROVAL_POLICY if agent_id == "codex" else ""
            task.sandbox_mode = APPROVED_CODEX_SANDBOX_MODE if agent_id == "codex" else ""
            task.permission_mode = approved_permission_mode(agent_id) or task.permission_mode
            task.approved_retry = True
    approval.status = "approved" if approved else "rejected"
    updated = update_task_card(
        chat_id,
        status="已批准，继续执行" if approved else "已拒绝",
        output=result_text,
        detail=status_text,
        force=True,
        task_id=approval.task_id,
    )
    if not updated and notify:
        send_msg(chat_id, status_text)
    return updated


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
        f"**默认 Agent**：{agent_label(active_agent_id(runtime))}",
        f"**项目**：{project.name}",
        f"**阶段**：{stage}",
        f"**目录**：`{runtime.cwd}`",
        f"**对话**：{len(project.conversations)} 条（Desktop {desktop_count} / {APP_NAME} {bridge_count} / 其他 {other_count}）",
    ]
    if conv:
        lines.extend(
            [
                "",
                "**当前选中对话**",
                f"**标题**：{conv.title}",
                f"**Session**：`{conv.session_id}`",
                f"**Agent**：{agent_label(conv.agent_id)}",
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
                if not chat_is_allowed(chat_id):
                    continue
                watch_convs: dict[str, ConversationInfo] = {}
                active_conv = get_active_conversation(session_id) if session_id else None
                if is_desktop_conversation(active_conv):
                    watch_convs[active_conv.session_id] = active_conv
                latest_desktop = latest_desktop_conversation_for_cwd(runtime_cwd)
                if latest_desktop:
                    watch_convs[latest_desktop.session_id] = latest_desktop

                for conv in watch_convs.values():
                    key = (chat_id, conv.session_id)
                    try:
                        size = conv.file.stat().st_size
                    except OSError:
                        continue
                    if key not in SESSION_WATCH_OFFSETS:
                        SESSION_WATCH_OFFSETS[key] = size
                        logger.info(
                            "watch desktop session: chat_id=%s session_id=%s cwd=%s file=%s",
                            chat_id,
                            conv.session_id,
                            conv.cwd or runtime_cwd,
                            conv.file,
                        )
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
                        fingerprint = hashlib.sha1(f"{chat_id}:{conv.session_id}:{kind}:{text}".encode("utf-8")).hexdigest()
                        if fingerprint in SESSION_SYNC_SEEN:
                            continue
                        SESSION_SYNC_SEEN.add(fingerprint)
                        if len(SESSION_SYNC_SEEN) > 2000:
                            SESSION_SYNC_SEEN.clear()
                        if kind in ("user", "agent", "complete"):
                            if not update_desktop_sync_card(
                                chat_id,
                                conv,
                                runtime_cwd,
                                kind=kind,
                                text=text,
                                force=(kind == "complete"),
                            ):
                                logger.warning(
                                    "desktop sync card update failed: chat_id=%s session_id=%s kind=%s",
                                    chat_id,
                                    conv.session_id,
                                    kind,
                                )
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
                if runtime.send_disabled or not chat_is_allowed(task.chat_id):
                    continue
                if should_auto_refresh_codex_task(task, now):
                    update_task_card(task.chat_id, force=True, task_id=task.task_id)

            for chat_id in chat_ids:
                runtime = get_runtime(chat_id)
                if runtime.send_disabled or not chat_is_allowed(chat_id):
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
    if not is_allowed_cwd(path):
        send_msg(chat_id, f"目录不在允许范围内：`{path}`\n允许范围：{allowed_roots_text()}")
        return

    runtime.cwd = path
    root = find_project_root(path)
    runtime.active_project_key = project_key(root or path)
    runtime.active_session_id = ""
    runtime.task_session_id = ""
    runtime.task_cwd = ""
    runtime.task_message_id = ""
    runtime.task_prompt = ""
    runtime.task_status = ""
    runtime.task_output = ""
    save_runtime(chat_id)
    project_text = f"\n项目：`{root}`" if root and root != path else ""
    send_msg(chat_id, f"已切换目录：`{path}`{project_text}\n后续新指令会在该目录启动新的会话。")


def mark_project_path(chat_id: str, path_text: str = ""):
    runtime = get_runtime(chat_id)
    path = Path(path_text).expanduser() if path_text else runtime.cwd
    if not path.is_absolute():
        path = runtime.cwd / path
    path = normalize_path(path)
    if not path.exists() or not path.is_dir():
        send_msg(chat_id, f"不是有效目录：{path}")
        return
    if not is_allowed_cwd(path):
        send_msg(chat_id, f"目录不在允许范围内：`{path}`\n允许范围：{allowed_roots_text()}")
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
    path = conversation_project_root(conv) or normalize_path(conv.cwd)
    if is_generic_conversation_dir(path):
        return False
    if not is_allowed_cwd(path):
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
    if not is_allowed_cwd(path):
        send_msg(chat_id, f"项目目录不在允许范围内：`{path}`\n允许范围：{allowed_roots_text()}")
        return
    suffix = 2
    while path.exists():
        path = root / f"{slugify_name(name)}-{suffix}"
        suffix += 1
    path.mkdir(parents=True, exist_ok=False)
    readme = path / "README.md"
    readme.write_text(f"# {name}\n\nCreated by {APP_NAME}.\n", encoding="utf-8")

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
    allowed, reason = can_start_work(chat_id)
    if not allowed:
        send_msg(chat_id, reason)
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
    allowed, reason = can_start_work(chat_id)
    if not allowed:
        send_msg(chat_id, reason)
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


def text_command_requires_admin(content: str) -> bool:
    normalized = re.sub(r"\s+", " ", content.strip()).lower()
    admin_exact = {"/restart", "/stop"}
    if normalized in admin_exact:
        return True
    admin_prefixes = (
        "/approve ",
        "/reject ",
        "/cd ",
        "/mark-project",
        "/mark-chat",
        "/project=new",
        "/project=archive",
        "/project=achive",
        "/chat=archive",
        "/convos=archive",
        "/对话=archive",
        "/项目=archive",
    )
    if normalized.startswith(admin_prefixes):
        return True
    if normalized in ("/plan stop", "/plan 停止", "/plan merge", "/plan 合并", "/plan cleanup", "/plan clean", "/plan 清理"):
        return True
    return normalized.startswith(("/plan cleanup ", "/plan clean ", "/plan 清理 "))


def send_help(chat_id: str):
    send_msg(
        chat_id,
        "\n".join(
            [
                "可用指令：",
                f"/panel 打开 {APP_NAME} 看板（默认收起项目列表）",
                "/projects 打开项目面板（默认收起列表）",
                "/projects 展开 展开项目列表",
                "/chats 打开普通对话列表",
                "/convos 打开当前项目对话面板（默认收起列表）",
                "/convos 展开 展开当前项目对话列表",
                "/status 查看当前项目状态",
                "/daily 输出项目进展日报",
                "/daily=YYYY-MM-DD 输出指定日期项目进展日报",
                "/agent 查看可用 Agent；/agent=qoder 切换默认 Agent",
                "/codex <指令> 使用 Codex CLI 执行一次",
                "/claude <指令> 使用 Claude Code CLI 执行一次",
                "/qoder <指令> 使用 Qoder CLI 执行一次",
                "/model=<模型名> +<指令> 使用指定模型执行一次，例如 /model=gpt-5.5 +修复 README",
                "/plan 进入并行计划模式；也可发送 /plan 后跟任务清单直接执行",
                "/plan status 刷新最近的计划面板",
                "/plan stop 停止最近的计划",
                "/plan detail <子任务ID> 打开子任务详情",
                "/plan retry <子任务ID> 重试失败或取消的子任务",
                "/plan merge 打开合并总览",
                "/plan cleanup 打开已结束子任务 worktree 清理确认",
                "/plan cleanup branches 打开已合并子任务分支清理确认",
                "/cd <目录> 切换工作目录",
                "/project <编号> 打开面板中的项目",
                "/latest <编号> 打开面板中项目的最新对话",
                "/conv <session_id> 切换对话",
                "/mark-project [目录] 手动标记项目目录",
                "/mark-chat [session_id] 手动标记普通对话",
                "/approve <id> 批准待审批",
                "/reject <id> 拒绝待审批",
                "/cancel <指令ID> 取消等待启动的排队任务",
                "/stop 停止当前任务",
                f"/restart 重启 {APP_NAME} WebSocket 脚本",
                "其他文本会继续当前对话；未选对话时会在当前项目中新建对话。",
            ]
        ),
    )


def select_conversation(chat_id: str, session_id: str):
    send_card(chat_id, build_conversation_card(chat_id, session_id, activate=True))


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


def on_text(
    chat_id: str,
    content: str,
    meta: Optional[dict[str, str]] = None,
    attachments: Optional[list[dict[str, Any]]] = None,
):
    meta = meta or {}
    attachments = normalize_attachment_dicts(attachments or [])
    content = strip_leading_lark_mentions(content)
    content = normalize_text_command(content)
    content = content.strip()
    if not content:
        return
    selected_model, content = parse_model_prefix(content)
    selected_agent, content = parse_agent_prefix(content)
    one_shot_agent = bool(selected_agent and content)
    second_model, content = parse_model_prefix(content)
    selected_model = selected_model or second_model
    if selected_model and not content:
        send_msg(chat_id, "用法：`/model=<模型名> +具体指令`，例如 `/model=gpt-5.5 +修复 README`。")
        return
    runtime = get_runtime(chat_id)
    if selected_agent and not content:
        set_runtime_agent(runtime, selected_agent)
        save_runtime(chat_id)
        send_msg(chat_id, f"已切换默认 Agent：{agent_label(selected_agent)}\n\n{agent_options_text(selected_agent)}")
        return
    sender_id = meta.get("sender_id", "")
    if text_command_requires_admin(content) and not is_authorized_lark_event(chat_id, sender_id, admin_required=True):
        send_msg(chat_id, "你没有权限执行这个敏感操作。")
        return
    if content in ("/agent", "/agents", "/agent list", "/agents list"):
        send_msg(chat_id, agent_options_text(active_agent_id(runtime)))
        return
    record_incoming_lark_message(chat_id, content, meta, attachments=attachments)

    if runtime.guidance_task_id and not content.startswith("/"):
        if append_task_guidance(chat_id, content):
            return

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
            send_msg(chat_id, "还没有找到 Agent 项目或对话。")
            return
        send_card(chat_id, build_project_card(chat_id, project.key, expanded=False))
        return
    if content in ("/convos 展开", "/对话 展开"):
        project = current_or_latest_project(chat_id)
        if not project:
            send_msg(chat_id, "还没有找到 Agent 项目或对话。")
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
        if normalized_plan_command in ("merge", "合并", "merge status", "合并总览"):
            plan = latest_plan_for_chat(chat_id)
            if plan:
                send_card(chat_id, build_plan_merge_card(plan))
            else:
                send_msg(chat_id, "当前还没有 Plan。")
            return
        if normalized_plan_command in ("cleanup branches", "clean branches", "清理分支", "清理 分支"):
            plan = latest_plan_for_chat(chat_id)
            if plan:
                send_card(chat_id, build_plan_cleanup_confirm_card(plan, "branches"))
            else:
                send_msg(chat_id, "当前还没有可清理的 Plan。")
            return
        if normalized_plan_command in ("cleanup", "clean", "清理"):
            plan = latest_plan_for_chat(chat_id)
            if plan:
                send_card(chat_id, build_plan_cleanup_confirm_card(plan, "all"))
            else:
                send_msg(chat_id, "当前还没有可清理的 Plan。")
            return
        if normalized_plan_command in ("stop", "停止"):
            stop_plan(chat_id)
            return
        detail_match = re.match(r"^(?:detail|详情)\s+(\S+)$", normalized_plan_command)
        if detail_match:
            plan = latest_plan_for_chat(chat_id)
            task = find_plan_task(plan, detail_match.group(1)) if plan else None
            if plan and task:
                send_card(chat_id, build_plan_task_card(plan, task))
            else:
                send_msg(chat_id, "找不到 Plan 子任务。")
            return
        retry_match = re.match(r"^(?:retry|重试)\s+(\S+)$", normalized_plan_command)
        if retry_match:
            plan = latest_plan_for_chat(chat_id)
            if plan and retry_plan_task(chat_id, plan.plan_id, retry_match.group(1)):
                send_plan_card(plan)
            else:
                send_msg(chat_id, "找不到 Plan 子任务。")
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
    if content.startswith("/cancel "):
        ok, message = cancel_queued_task(chat_id, content[8:].strip())
        send_msg(chat_id, message)
        return
    if content.startswith("/"):
        send_msg(chat_id, "未知指令。发送 /help 查看可用指令。")
        return

    allowed, reason = can_start_work(chat_id)
    if not allowed:
        send_msg(chat_id, reason)
        return

    prompt = content
    prompt_attachments = normalize_attachment_dicts(attachments)
    reference_context = resolve_lark_reference_context(chat_id, meta)
    if reference_context:
        apply_lark_reference_context(chat_id, reference_context)
        prompt = build_lark_reference_prompt(content, reference_context)
        prompt_attachments.extend(reference_context.attachments)
        logger.info(
            "resolved lark reference: chat_id=%s message_id=%s session_id=%s task_id=%s",
            chat_id,
            reference_context.message_id,
            reference_context.session_id,
            reference_context.task_id,
        )
    prompt_attachments.extend(consume_pending_lark_attachments(chat_id, sender_id))
    prompt_attachments = existing_lark_attachments(prompt_attachments)
    if prompt_attachments:
        prompt = build_lark_attachment_prompt(prompt, prompt_attachments)

    task_id = send_task_card(
        chat_id,
        prompt,
        "等待启动",
        selected_model,
        agent_id=selected_agent or runtime.active_agent_id,
        one_shot_agent=one_shot_agent,
        source_message_id=meta.get("message_id", ""),
        attachments=prompt_attachments,
    )
    record_incoming_lark_message(chat_id, content, meta, task_id, attachments=prompt_attachments or attachments)
    threading.Thread(target=run_codex, args=(chat_id, prompt, False, task_id), daemon=True).start()


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


def obj_value(obj: Any, name: str) -> Any:
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(name)
    return getattr(obj, name, None)


def first_nested_value(obj: Any, paths: list[tuple[str, ...]]) -> str:
    for path in paths:
        current = obj
        for name in path:
            current = obj_value(current, name)
            if current is None:
                break
        if current:
            if isinstance(current, dict):
                current = current.get("open_id") or current.get("user_id") or current.get("union_id") or current.get("chat_id")
            if current:
                return str(current)
    return ""


def card_action_meta(data) -> dict[str, str]:
    event = getattr(data, "event", None)
    return {
        "chat_id": first_nested_value(
            event,
            [
                ("context", "open_chat_id"),
                ("context", "chat_id"),
                ("message", "chat_id"),
                ("open_chat_id",),
                ("chat_id",),
            ],
        ),
        "sender_id": first_nested_value(
            event,
            [
                ("operator", "open_id"),
                ("operator", "user_id"),
                ("operator", "union_id"),
                ("operator", "operator_id", "open_id"),
                ("operator", "operator_id", "user_id"),
            ],
        ),
        "message_id": first_nested_value(
            event,
            [
                ("context", "open_message_id"),
                ("context", "message_id"),
                ("message", "message_id"),
                ("open_message_id",),
                ("message_id",),
            ],
        ),
    }


def on_card_action(data):
    action = normalize_action_value(getattr(getattr(data.event, "action", None), "value", None))
    meta = card_action_meta(data)
    logger.info(
        "card action received: action=%s chat_id=%s sender_id=%s message_id=%s",
        action.get("action", ""),
        action.get("chat_id", "") or meta.get("chat_id", ""),
        meta.get("sender_id", ""),
        meta.get("message_id", ""),
    )
    return handle_card_action(action, meta)


CARD_ADMIN_ACTIONS = {
    "approve",
    "reject",
    "plan_approve",
    "plan_reject",
    "plan_commit",
    "plan_skip_commit",
    "plan_discard",
    "plan_task_cancel",
    "plan_task_stop",
    "plan_task_cleanup",
    "plan_cleanup",
    "plan_cleanup_execute",
    "plan_merge_task",
    "plan_merge_all",
    "plan_merge_fix",
    "plan_merge_abort",
    "stop",
    "plan_stop",
    "restart",
    "restart_confirm",
    "restart_cancel",
    "mark_project_from_chat",
}


def handle_card_action(action: dict[str, Any], meta: Optional[dict[str, str]] = None):
    meta = meta or {}
    action_chat_id = str(action.get("chat_id") or "")
    event_chat_id = meta.get("chat_id", "")
    if event_chat_id and action_chat_id and event_chat_id != action_chat_id:
        logger.warning("reject card action with mismatched chat_id: event=%s action=%s", event_chat_id, action_chat_id)
        return action_toast("卡片来源不匹配，已拒绝。", "error")

    chat_id = event_chat_id or action_chat_id
    if not chat_id:
        logger.error("card action missing chat_id: %s", action)
        return action_toast("缺少 chat_id", "error")

    name = action.get("action", "")
    if not is_authorized_lark_event(
        chat_id,
        meta.get("sender_id", ""),
        admin_required=name in CARD_ADMIN_ACTIONS,
    ):
        return action_toast("你没有权限执行这个操作。", "error")
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
            return action_card(
                build_conversation_card(
                    chat_id,
                    action.get("session_id", ""),
                    activate=name == "conversation",
                )
            )
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
        elif name == "task_guide":
            task_id = action.get("task_id", "")
            ok, message = request_task_guidance(chat_id, task_id)
            return action_card(build_task_card(chat_id, task_id=task_id), message, "success" if ok else "error")
        elif name == "task_cancel":
            task_id = action.get("task_id", "")
            ok, message = cancel_queued_task(chat_id, task_id)
            return action_card(build_task_card(chat_id, task_id=task_id), message, "success" if ok else "error")
        elif name == "desktop_refresh":
            session_id = action.get("session_id", "")
            conv = get_active_conversation(session_id)
            if not is_desktop_conversation(conv):
                return action_toast("找不到 Codex Desktop 会话。", "error")
            sync = get_desktop_sync(chat_id, conv, get_runtime(chat_id).cwd)
            sync.prompt = conv.last_user or sync.prompt
            sync.output = conv.last_assistant or sync.output
            sync.status = "完成" if conv.status == "完成" else "监听中"
            sync.updated_at = conv.updated_at or time.time()
            return action_card(build_desktop_sync_card(sync), "已刷新")
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
            restart_id = action.get("restart_id", "")
            ok, message = handle_restart_confirmation(chat_id, restart_id, True)
            restart = PENDING_RESTARTS.get(restart_id)
            if restart and restart.chat_id == chat_id:
                return action_card(build_restart_confirm_card(restart), message, "success" if ok else "error")
            return action_toast(message, "success" if ok else "error")
        elif name == "restart_cancel":
            restart_id = action.get("restart_id", "")
            ok, message = handle_restart_confirmation(chat_id, restart_id, False)
            restart = PENDING_RESTARTS.get(restart_id)
            if restart and restart.chat_id == chat_id:
                return action_card(build_restart_confirm_card(restart), message, "success" if ok else "error")
            return action_toast(message, "success" if ok else "error")
        elif name == "plan_refresh":
            plan = find_plan(action.get("plan_id", "")) or latest_plan_for_chat(chat_id)
            if not plan:
                return action_toast("找不到 Plan。", "error")
            return action_card(build_plan_card(plan), "已刷新")
        elif name == "plan_task_detail":
            plan = find_plan(action.get("plan_id", "")) or latest_plan_for_chat(chat_id)
            task = find_plan_task(plan, action.get("task_id", "")) if plan else None
            if not plan or not task:
                return action_toast("找不到 Plan 子任务。", "error")
            return action_card(build_plan_task_card(plan, task), "已打开详情")
        elif name == "plan_task_retry":
            if not retry_plan_task(chat_id, action.get("plan_id", ""), action.get("task_id", "")):
                return action_toast("找不到 Plan 子任务。", "error")
            plan = find_plan(action.get("plan_id", ""))
            return action_card(build_plan_card(plan), "已重试") if plan else action_toast("已重试")
        elif name in ("plan_task_cancel", "plan_task_stop"):
            if not stop_or_cancel_plan_task(chat_id, action.get("plan_id", ""), action.get("task_id", "")):
                return action_toast("找不到 Plan 子任务。", "error")
            plan = find_plan(action.get("plan_id", ""))
            return action_card(build_plan_card(plan), "已处理") if plan else action_toast("已处理")
        elif name == "plan_stop":
            plan = find_plan(action.get("plan_id", "")) or latest_plan_for_chat(chat_id)
            if not plan:
                return action_toast("找不到 Plan。", "error")
            plan.stop_requested = True
            save_plans_state()
            return action_card(build_plan_card(plan), "已停止")
        elif name == "plan_discard":
            if not discard_plan_task_changes(chat_id, action.get("plan_id", ""), action.get("task_id", "")):
                return action_toast("找不到 Plan 子任务。", "error")
            plan = find_plan(action.get("plan_id", ""))
            task = find_plan_task(plan, action.get("task_id", "")) if plan else None
            return action_card(build_plan_task_card(plan, task), "已丢弃") if plan and task else action_toast("已丢弃")
        elif name == "plan_task_cleanup":
            plan = find_plan(action.get("plan_id", ""))
            if not plan:
                return action_toast("找不到 Plan 子任务。", "error")
            return action_card(build_plan_cleanup_confirm_card(plan, "task", action.get("task_id", "")), "请确认清理")
        elif name == "plan_cleanup":
            plan = find_plan(action.get("plan_id", ""))
            if not plan:
                return action_toast("找不到 Plan。", "error")
            return action_card(build_plan_cleanup_confirm_card(plan, action.get("scope", "all"), action.get("task_id", "")), "请确认清理")
        elif name == "plan_cleanup_confirm":
            plan = find_plan(action.get("plan_id", ""))
            if not plan:
                return action_toast("找不到 Plan。", "error")
            return action_card(build_plan_cleanup_confirm_card(plan, action.get("scope", "all"), action.get("task_id", "")), "请确认清理")
        elif name == "plan_cleanup_execute":
            scope = action.get("scope", "all")
            if not execute_plan_cleanup(chat_id, action.get("plan_id", ""), scope, action.get("task_id", "")):
                return action_toast("找不到 Plan。", "error")
            plan = find_plan(action.get("plan_id", ""))
            if not plan:
                return action_toast("已清理")
            card = build_plan_merge_card(plan) if scope == "branches" else build_plan_card(plan)
            return action_card(card, "已清理")
        elif name == "plan_cleanup_cancel":
            plan = find_plan(action.get("plan_id", "")) or latest_plan_for_chat(chat_id)
            if not plan:
                return action_toast("找不到 Plan。", "error")
            card = build_plan_merge_card(plan) if action.get("scope") == "branches" else build_plan_card(plan)
            return action_card(card, "已取消")
        elif name == "plan_merge":
            plan = find_plan(action.get("plan_id", "")) or latest_plan_for_chat(chat_id)
            if not plan:
                return action_toast("找不到 Plan。", "error")
            return action_card(build_plan_merge_card(plan), "已打开合并总览")
        elif name == "plan_merge_task":
            if not cherry_pick_plan_task(chat_id, action.get("plan_id", ""), action.get("task_id", "")):
                return action_toast("找不到 Plan 子任务。", "error")
            plan = find_plan(action.get("plan_id", ""))
            return action_card(build_plan_merge_card(plan), "已合并") if plan else action_toast("已合并")
        elif name == "plan_merge_all":
            if not merge_all_plan_tasks(chat_id, action.get("plan_id", "")):
                return action_toast("找不到 Plan。", "error")
            plan = find_plan(action.get("plan_id", ""))
            return action_card(build_plan_merge_card(plan), "已合并") if plan else action_toast("已合并")
        elif name == "plan_merge_fix":
            if not start_plan_merge_conflict_fix(chat_id, action.get("plan_id", "")):
                return action_toast("找不到 Plan。", "error")
            plan = find_plan(action.get("plan_id", ""))
            return action_card(build_plan_merge_card(plan), "已开始修复") if plan else action_toast("已开始修复")
        elif name == "plan_merge_abort":
            if not abort_plan_merge(chat_id, action.get("plan_id", "")):
                return action_toast("找不到 Plan。", "error")
            plan = find_plan(action.get("plan_id", ""))
            return action_card(build_plan_merge_card(plan), "已中止") if plan else action_toast("已中止")
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
            approval_id = action.get("approval_id", "")
            threading.Thread(target=approve_pending, args=(chat_id, approval_id, True, True), daemon=True).start()
            return action_toast("已收到批准，正在处理")
        elif name == "reject":
            approval_id = action.get("approval_id", "")
            threading.Thread(target=approve_pending, args=(chat_id, approval_id, False, True), daemon=True).start()
            return action_toast("已收到拒绝，正在处理")
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


def event_sender(data, message):
    event = getattr(data, "event", None)
    return getattr(event, "sender", None) or getattr(message, "sender", None)


def is_bot_message(data, message) -> bool:
    sender = event_sender(data, message)
    return getattr(sender, "sender_type", "") == "app"


def sender_meta_from_message(data, message) -> dict[str, str]:
    sender = event_sender(data, message)
    header = getattr(data, "header", None)
    sender_id = first_nested_value(
        sender,
        [
            ("sender_id", "open_id"),
            ("sender_id", "user_id"),
            ("sender_id", "union_id"),
            ("sender_id",),
            ("id", "open_id"),
            ("id", "user_id"),
            ("id", "union_id"),
            ("id",),
            ("open_id",),
            ("user_id",),
            ("union_id",),
        ],
    )
    return {
        "sender_id": str(sender_id or ""),
        "sender_type": str(getattr(sender, "sender_type", "") or ""),
        "message_id": str(getattr(message, "message_id", "") or ""),
        "root_id": first_nested_value(
            message,
            [
                ("root_id",),
                ("message_root_id",),
                ("open_root_id",),
            ],
        ),
        "parent_id": first_nested_value(
            message,
            [
                ("parent_id",),
                ("message_parent_id",),
                ("open_parent_id",),
            ],
        ),
        "thread_id": first_nested_value(
            message,
            [
                ("thread_id",),
                ("message_thread_id",),
                ("open_thread_id",),
            ],
        ),
        "quote_message_id": first_nested_value(
            message,
            [
                ("quote_message_id",),
                ("quoted_message_id",),
                ("reply_message_id",),
            ],
        ),
        "event_id": str(getattr(header, "event_id", "") or ""),
    }


def on_message(data: lark.im.v1.P2ImMessageReceiveV1):
    if is_duplicate_event(data):
        return

    msg = data.event.message
    meta = sender_meta_from_message(data, msg)
    if is_bot_message(data, msg):
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
    if not is_authorized_lark_event(chat_id, meta.get("sender_id", "")):
        return
    get_runtime(chat_id)
    message_type = str(getattr(msg, "message_type", "") or "")
    attachments, attachment_errors = download_lark_message_attachments(chat_id, msg, meta)
    content = parse_lark_message_text(msg.content, message_type)
    if attachment_errors:
        send_msg(chat_id, "附件处理有问题：\n" + "\n".join(f"- {item}" for item in attachment_errors[:5]))
    if not content:
        if attachments:
            summary = lark_attachment_summary_text(attachments)
            record_incoming_lark_message(
                chat_id,
                f"附件消息：\n{summary}",
                meta,
                attachments=attachments,
            )
            stash_pending_lark_attachments(chat_id, meta.get("sender_id", ""), attachments)
            send_msg(
                chat_id,
                "已收到并暂存附件。请直接发送下一条 Agent 指令，或回复/引用这条附件消息下指令。\n"
                + summary,
            )
            return
        raw_for_log = getattr(msg, "content", "") if LOG_MESSAGE_CONTENT else "<hidden>"
        logger.warning(
            "message received with empty parsed content: chat_id=%s sender_id=%s sender_type=%s message_id=%s event_id=%s message_type=%s raw_content=%r",
            chat_id,
            meta.get("sender_id", ""),
            meta.get("sender_type", ""),
            meta.get("message_id", ""),
            meta.get("event_id", ""),
            getattr(msg, "message_type", ""),
            raw_for_log,
        )
        return
    content_for_log = content[:80] if LOG_MESSAGE_CONTENT else f"<hidden len={len(content)}>"
    logger.info(
        "message received: chat_id=%s sender_id=%s sender_type=%s message_id=%s event_id=%s attachments=%s content=%r",
        chat_id,
        meta.get("sender_id", ""),
        meta.get("sender_type", ""),
        meta.get("message_id", ""),
        meta.get("event_id", ""),
        len(attachments),
        content_for_log,
    )
    try:
        EVENT_QUEUE.put_nowait(("text", (chat_id, content, meta, attachments)))
    except queue.Full:
        logger.error("drop message because event queue is full: chat_id=%s", chat_id)


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
            logger.exception("event worker failed: kind=%s", kind)
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
    if STATE_FILE.exists():
        try:
            STATE_FILE.chmod(0o600)
        except OSError:
            logger.exception("failed to chmod state file")
    if LARK_REQUIRE_KNOWN_CHAT and not LARK_ALLOWED_CHAT_IDS and not known_chat_ids():
        logger.warning(
            "LARK_REQUIRE_KNOWN_CHAT=1 but no known chat is stored; set LARK_ALLOWED_CHAT_IDS for first-time setup"
        )


def main():
    validate_config()
    load_known_chats()
    load_plans_state()
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

    print(f"{APP_NAME} WebSocket 启动成功")
    print("指令：/panel | /projects | /convos | /status | /daily | /stop | 直接发消息")
    print(f"默认目录：{DEFAULT_CWD}")
    print(f"Codex 会话目录：{CODEX_SESSIONS_DIR}")
    print(f"Claude 会话目录：{CLAUDE_PROJECTS_DIR}")
    print(f"Qoder 会话目录：{QODER_PROJECTS_DIR}")
    print("Lark 卡片回调：使用 WebSocket 长连接事件 card.action.trigger")
    send_startup_welcome()
    cli.start()


if __name__ == "__main__":
    main()
