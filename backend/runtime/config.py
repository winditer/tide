"""
环境变量配置与常量。

从 tide_ws.py L54-151 提取的所有配置常量。
"""

import os
import re
from pathlib import Path


def load_dotenv(path: Path = Path(".env")):
    """从 .env 文件加载环境变量（不覆盖已有值）。"""
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


# 在模块加载时自动调用
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
CODEX_TIMEOUT_SECONDS = int(os.getenv("CODEX_TIMEOUT_SECONDS", "3600"))
CLAUDE_TIMEOUT_SECONDS = int(os.getenv("CLAUDE_TIMEOUT_SECONDS", str(CODEX_TIMEOUT_SECONDS)))
QODER_TIMEOUT_SECONDS = int(os.getenv("QODER_TIMEOUT_SECONDS", str(CODEX_TIMEOUT_SECONDS)))
QODER_QUEST_TIMEOUT_SECONDS = int(os.getenv("QODER_QUEST_TIMEOUT_SECONDS", str(12 * 60 * 60)))
CODEX_MODEL = os.getenv("CODEX_MODEL", "")
CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "")
QODER_MODEL = os.getenv("QODER_MODEL", "")
CLAUDE_PERMISSION_MODE = os.getenv("CLAUDE_PERMISSION_MODE", "dontAsk")
APPROVED_CLAUDE_PERMISSION_MODE = os.getenv("APPROVED_CLAUDE_PERMISSION_MODE", "acceptEdits")
CLAUDE_EXTRA_ARGS = os.getenv("CLAUDE_EXTRA_ARGS", "")
QODER_PERMISSION_MODE = os.getenv("QODER_PERMISSION_MODE", "dont_ask")
APPROVED_QODER_PERMISSION_MODE = os.getenv("APPROVED_QODER_PERMISSION_MODE", "bypass_permissions")
QODER_EXTRA_ARGS = os.getenv("QODER_EXTRA_ARGS", "")
QODER_PROCESS_HOME = os.getenv("QODER_PROCESS_HOME", "")
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
LARK_ATTACHMENTS_DIR = os.getenv("LARK_ATTACHMENTS_DIR", ".tide/attachments")
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
STATE_FILE = Path(os.getenv("TIDE_STATE_FILE", ".tide_state.json"))
TIDE_SHOW_ARCHIVED = os.getenv("TIDE_SHOW_ARCHIVED", "0") == "1"
TIDE_INCLUDE_PLAN_WORKTREES = os.getenv("TIDE_INCLUDE_PLAN_WORKTREES", "0") == "1"
MAX_LARK_MESSAGE_REFS = int(os.getenv("MAX_LARK_MESSAGE_REFS", "1000"))
TIDE_WELCOME_MESSAGE = os.getenv(
    "TIDE_WELCOME_MESSAGE",
    "I'm Tide, a lightweight multi-agent bridge for Lark.",
)
SYNC_DESKTOP_SESSIONS = os.getenv("SYNC_DESKTOP_SESSIONS", "0") == "1"
SESSION_WATCH_INTERVAL_SECONDS = int(os.getenv("SESSION_WATCH_INTERVAL_SECONDS", "3"))
KEEP_AWAKE_ON_AC_POWER = os.getenv("KEEP_AWAKE_ON_AC_POWER", "1") == "1"
KEEP_AWAKE_CHECK_INTERVAL_SECONDS = int(os.getenv("KEEP_AWAKE_CHECK_INTERVAL_SECONDS", "60"))
KEEP_AWAKE_DISABLE_SLEEP = os.getenv("KEEP_AWAKE_DISABLE_SLEEP", "0") == "1"
LARK_ALLOWED_CHAT_IDS_VALUE = os.getenv("LARK_ALLOWED_CHAT_IDS", "")
LARK_ALLOWED_OPEN_IDS_VALUE = os.getenv("LARK_ALLOWED_OPEN_IDS", "")
LARK_ALLOWED_OPEN_IDS: list[str] = [
    x.strip() for x in LARK_ALLOWED_OPEN_IDS_VALUE.split(",") if x.strip()
]
LARK_ADMIN_OPEN_IDS_VALUE = os.getenv("LARK_ADMIN_OPEN_IDS", "")
LARK_REQUIRE_KNOWN_CHAT = os.getenv("LARK_REQUIRE_KNOWN_CHAT", "1") == "1"
LARK_CARD_ENABLE_FORWARD = os.getenv("LARK_CARD_ENABLE_FORWARD", "0") == "1"
LOG_MESSAGE_CONTENT = os.getenv("LOG_MESSAGE_CONTENT", "0") == "1"

# 认证配置
TIDE_JWT_SECRET = os.environ.get("TIDE_JWT_SECRET", "tide-dev-secret-change-in-production")
TIDE_JWT_ALGORITHM = os.environ.get("TIDE_JWT_ALGORITHM", "HS256")
TIDE_JWT_EXPIRE_MINUTES = int(os.environ.get("TIDE_JWT_EXPIRE_MINUTES", "15"))
TIDE_REFRESH_TOKEN_EXPIRE_DAYS = int(os.environ.get("TIDE_REFRESH_TOKEN_EXPIRE_DAYS", "30"))
TIDE_REQUIRE_AUTH = os.environ.get("TIDE_REQUIRE_AUTH", "0") == "1"
TIDE_ADMIN_USERNAME = os.environ.get("TIDE_ADMIN_USERNAME", "admin")
TIDE_ADMIN_PASSWORD = os.environ.get("TIDE_ADMIN_PASSWORD", "")
LARK_APP_REDIRECT_URI = os.environ.get("LARK_APP_REDIRECT_URI", "")
TIDE_PASSWORD_MIN_LENGTH = int(os.environ.get("TIDE_PASSWORD_MIN_LENGTH", "8"))
TIDE_DATA_DIR: str = os.getenv("TIDE_DATA_DIR", str(Path.home() / ".tide" / "data"))

# ─── Work Item Smart Routing ───────────────────────────────────────────
WORKITEM_SMART_ROUTING = os.getenv("WORKITEM_SMART_ROUTING", "false").lower() == "true"
WORKITEM_SMART_ROUTING_TIMEOUT = int(os.getenv("WORKITEM_SMART_ROUTING_TIMEOUT", "30"))
WORKITEM_SMART_ROUTING_CONFIDENCE = float(os.getenv("WORKITEM_SMART_ROUTING_CONFIDENCE", "0.6"))
ROUTING_PROPOSAL_MAX_CHARS = int(os.getenv("ROUTING_PROPOSAL_MAX_CHARS", "3000"))
# =================================================


def get_config() -> dict:
    """返回当前所有配置常量（快照）。"""
    import types
    import sys
    mod = sys.modules[__name__]
    return {
        k: v
        for k, v in vars(mod).items()
        if k.isupper() and not isinstance(v, types.ModuleType)
    }


def parse_csv_set(value: str) -> set[str]:
    """将逗号/分号/空白分隔的字符串解析为集合。"""
    return {
        item.strip()
        for item in re.split(r"[,;\s]+", str(value or ""))
        if item.strip()
    }


def user_projects_root(user_id: str) -> Path:
    """返回用户的项目根目录 {TIDE_DATA_DIR}/users/{user_id}"""
    return Path(TIDE_DATA_DIR) / "users" / user_id


def project_dir(user_id: str, project_name: str) -> Path:
    """返回项目目录 {TIDE_DATA_DIR}/users/{user_id}/{project_name}"""
    return Path(TIDE_DATA_DIR) / "users" / user_id / project_name


def ensure_user_dir(user_id: str) -> Path:
    """确保用户根目录存在，返回路径"""
    root = user_projects_root(user_id)
    root.mkdir(parents=True, exist_ok=True)
    return root
