"""
计划（Plan）运行时数据模型。

从 lark2agent_ws.py 提取：
- PlanTask dataclass (L342-368)
- PlanRuntime dataclass (L371-384)
- PLANS 字典和 PLAN_LOCK
"""

import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from backend.runtime.config import PLAN_MAX_PARALLEL


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


# ── 全局运行时状态 ──
PLANS: dict[str, PlanRuntime] = {}
PLAN_LOCK = threading.RLock()
