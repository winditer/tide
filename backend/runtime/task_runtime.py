"""
任务运行时数据模型。

从 lark2agent_ws.py 提取：
- CodexTaskRuntime dataclass (L238-273)
- LarkAttachment dataclass (L275-283)
- LarkReferenceContext dataclass (L286-294)
- PendingApproval dataclass (L311-327)
- 全局运行时字典定义：TASKS, PENDING_APPROVALS, SESSION_RUN_LOCKS, LOCK
"""

import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional


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
    agent_mode: str = ""
    pause_started_at: float = 0
    paused_seconds: float = 0
    stop_requested: bool = False
    stop_status: str = ""
    stop_detail: str = ""
    card_update_failed: bool = False
    result_refresh_until: float = 0
    conversation_id: str = ""


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
    fingerprint: str = ""


# ── 全局运行时状态 ──
TASKS: dict[str, CodexTaskRuntime] = {}
PENDING_APPROVALS: dict[str, PendingApproval] = {}
SESSION_RUN_LOCKS: dict[str, threading.Lock] = {}
LOCK = threading.RLock()
