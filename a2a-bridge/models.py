"""数据模型定义。

包含 A2A 协议中的核心实体（Task / Message / Artifact）以及 JSON-RPC
请求/响应的 Pydantic 模型。
"""
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


# ---------------- A2A 任务状态 ----------------
class TaskState(str, Enum):
    SUBMITTED = "submitted"
    WORKING = "working"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELED = "canceled"
    INPUT_REQUIRED = "input_required"


# ---------------- 内部任务对象 ----------------
@dataclass
class A2ATask:
    """Bridge 内部维护的任务对象。"""

    id: str
    context_id: Optional[str] = None
    skill: str = ""
    state: TaskState = TaskState.SUBMITTED
    artifacts: list[dict[str, Any]] = field(default_factory=list)
    history: list[dict[str, Any]] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    error: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "contextId": self.context_id,
            "kind": "task",
            "status": {
                "state": self.state.value,
                "timestamp": self.updated_at,
                "message": self.error if self.state == TaskState.FAILED else None,
            },
            "artifacts": self.artifacts,
            "history": self.history,
            "metadata": {**self.metadata, "skill": self.skill},
        }

    def touch(self) -> None:
        self.updated_at = time.time()


# ---------------- JSON-RPC 模型 ----------------
class JsonRpcRequest(BaseModel):
    jsonrpc: Literal["2.0"] = "2.0"
    id: Optional[Any] = None
    method: str
    params: dict[str, Any] = Field(default_factory=dict)


class JsonRpcError(BaseModel):
    code: int
    message: str
    data: Optional[Any] = None


class JsonRpcResponse(BaseModel):
    jsonrpc: Literal["2.0"] = "2.0"
    id: Optional[Any] = None
    result: Optional[Any] = None
    error: Optional[JsonRpcError] = None


# JSON-RPC 错误码（参考 A2A 规范）
ERR_PARSE_ERROR = -32700
ERR_INVALID_REQUEST = -32600
ERR_METHOD_NOT_FOUND = -32601
ERR_INVALID_PARAMS = -32602
ERR_INTERNAL = -32603

ERR_TASK_NOT_FOUND = -32001
ERR_TASK_NOT_CANCELABLE = -32002
ERR_UNAUTHORIZED = -32401
ERR_AGENT_UNAVAILABLE = -32010


# ---------------- 工具方法 ----------------
def gen_id(prefix: str = "") -> str:
    suffix = uuid.uuid4().hex
    return f"{prefix}{suffix}" if prefix else suffix


def make_text_part(text: str) -> dict[str, Any]:
    return {"kind": "text", "text": text}


def make_message(role: str, text: str, message_id: Optional[str] = None) -> dict[str, Any]:
    return {
        "messageId": message_id or gen_id("msg-"),
        "role": role,
        "parts": [make_text_part(text)],
        "kind": "message",
    }


def make_artifact(text: str, name: str = "result", artifact_id: Optional[str] = None) -> dict[str, Any]:
    return {
        "artifactId": artifact_id or gen_id("art-"),
        "name": name,
        "parts": [make_text_part(text)],
    }


def status_update_event(task: A2ATask, *, final: bool = False, message: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """生成 statusUpdate 事件（A2A 协议 task-status-update 形式）。"""
    return {
        "kind": "status-update",
        "taskId": task.id,
        "contextId": task.context_id,
        "status": {
            "state": task.state.value,
            "timestamp": task.updated_at,
            "message": message,
        },
        "final": final,
    }


def artifact_update_event(task: A2ATask, artifact: dict[str, Any], *, append: bool = False, last_chunk: bool = False) -> dict[str, Any]:
    return {
        "kind": "artifact-update",
        "taskId": task.id,
        "contextId": task.context_id,
        "artifact": artifact,
        "append": append,
        "lastChunk": last_chunk,
    }
