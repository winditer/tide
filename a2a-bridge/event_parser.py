"""CLI stream-json 输出事件解析器。

这是 Tide 平台 backend/runtime/adapters.py 的简化版，只关注 Bridge
需要传递的关键事件。三种 CLI 的输出格式略有不同，统一归一化为
ParsedEvent 对象，方便 executor 转换为 A2A statusUpdate / artifactUpdate。
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Iterable, Optional


# ---------------- 归一化事件类型 ----------------
EVENT_SESSION = "session"            # 记录 session_id（用于 resume）
EVENT_MESSAGE = "message"            # 文本消息片段（流式）
EVENT_TOOL_USE = "tool_use"          # 工具调用开始
EVENT_TOOL_RESULT = "tool_result"    # 工具调用结果
EVENT_PROGRESS = "progress"          # 进度信息
EVENT_APPROVAL = "approval"          # 需要人工审批
EVENT_COMPLETE = "complete"          # 任务完成（含最终输出）
EVENT_ERROR = "error"                # 错误
EVENT_RAW = "raw"                    # 未识别的原始事件


@dataclass
class ParsedEvent:
    """归一化后的事件对象。"""

    type: str
    text: str = ""
    role: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict)


# ---------------- 审批关键词检测 ----------------
_APPROVAL_KEYWORDS = (
    "approval required",
    "permission required",
    "请求批准",
    "需要审批",
    "需要批准",
    "需要授权",
    "please approve",
    "do you want to proceed",
)


def _looks_like_approval(text: str) -> bool:
    if not text:
        return False
    low = text.lower()
    return any(k in low for k in _APPROVAL_KEYWORDS)


# ---------------- Codex 解析 ----------------
def parse_codex_event(obj: dict[str, Any]) -> Optional[ParsedEvent]:
    """解析 codex exec --json 单行 JSON。

    常见 type:
      - thread.started: {"type":"thread.started","thread_id":"..."}
      - turn.started / turn.completed
      - item.started / item.updated / item.completed
        item.type 包括 assistant_message / reasoning / command_execution / file_change ...
    """
    if not isinstance(obj, dict):
        return None
    t = obj.get("type") or ""
    if t == "thread.started":
        sid = obj.get("thread_id") or obj.get("session_id")
        return ParsedEvent(type=EVENT_SESSION, metadata={"session_id": sid}, raw=obj)
    if t == "turn.completed":
        # 不当作 complete，整个 task 由 process exit 决定 complete
        usage = obj.get("usage") or {}
        return ParsedEvent(type=EVENT_PROGRESS, text="turn completed", metadata={"usage": usage}, raw=obj)
    if t in ("item.started", "item.updated", "item.completed"):
        item = obj.get("item") or {}
        item_type = item.get("type") or item.get("item_type") or ""
        if item_type == "assistant_message":
            text = item.get("text") or ""
            if _looks_like_approval(text):
                return ParsedEvent(type=EVENT_APPROVAL, text=text, role="assistant", raw=obj)
            return ParsedEvent(type=EVENT_MESSAGE, text=text, role="assistant", raw=obj)
        if item_type == "reasoning":
            text = item.get("text") or item.get("summary") or ""
            # 仅当有实际 reasoning 文本时才产生进度事件，空内容跳过
            if text:
                return ParsedEvent(type=EVENT_PROGRESS, text=text, metadata={"kind": "reasoning"}, raw=obj)
            return None
        if item_type in ("command_execution", "shell_command"):
            cmd = item.get("command") or ""
            output = item.get("output") or ""
            # 命令与输出均为空时跳过，避免产生无意义的 "$" 占位符
            if not cmd and not output:
                return None
            text = f"$ {cmd}\n{output}".strip()
            ev_type = EVENT_TOOL_USE if t == "item.started" else EVENT_TOOL_RESULT
            return ParsedEvent(type=ev_type, text=text, metadata={"command": cmd}, raw=obj)
        if item_type in ("file_change", "patch", "edit"):
            return ParsedEvent(
                type=EVENT_TOOL_RESULT,
                text=item.get("summary") or "(file change)",
                metadata={"kind": "file_change"},
                raw=obj,
            )
        # 其它 item 类型
        return ParsedEvent(type=EVENT_RAW, text=item.get("text") or "", raw=obj)
    if t == "error":
        return ParsedEvent(type=EVENT_ERROR, text=obj.get("message") or str(obj), raw=obj)
    return ParsedEvent(type=EVENT_RAW, raw=obj)


# ---------------- Claude / Qoder 解析 ----------------
def parse_claude_event(obj: dict[str, Any]) -> Optional[ParsedEvent]:
    """解析 claude / qoder stream-json 单行 JSON。

    常见 type:
      - system: {"type":"system","subtype":"init","session_id":"..."}
      - assistant: {"type":"assistant","message":{"content":[{"type":"text","text":...}]}}
      - user: tool_result
      - result: 最终汇总
    """
    if not isinstance(obj, dict):
        return None
    t = obj.get("type") or ""
    if t == "system":
        sid = obj.get("session_id")
        if sid:
            return ParsedEvent(type=EVENT_SESSION, metadata={"session_id": sid}, raw=obj)
        # 空内容的系统/控制事件不产生可见输出，返回 None 由调用方跳过，
        # 避免 subtype 占位符污染任务结果
        return None
    if t == "assistant":
        msg = obj.get("message") or {}
        contents = msg.get("content") or []
        texts: list[str] = []
        tool_use_text = ""
        for c in contents:
            if not isinstance(c, dict):
                continue
            ctype = c.get("type")
            if ctype == "text":
                texts.append(c.get("text") or "")
            elif ctype == "tool_use":
                name = c.get("name") or "tool"
                inp = c.get("input") or {}
                try:
                    inp_str = json.dumps(inp, ensure_ascii=False)
                except Exception:
                    inp_str = str(inp)
                tool_use_text = f"[tool] {name} {inp_str}"
        text = "\n".join([t for t in texts if t]).strip()
        if tool_use_text and not text:
            return ParsedEvent(type=EVENT_TOOL_USE, text=tool_use_text, role="assistant", raw=obj)
        if _looks_like_approval(text):
            return ParsedEvent(type=EVENT_APPROVAL, text=text, role="assistant", raw=obj)
        return ParsedEvent(type=EVENT_MESSAGE, text=text, role="assistant", raw=obj)
    if t == "user":
        msg = obj.get("message") or {}
        contents = msg.get("content") or []
        texts: list[str] = []
        for c in contents:
            if isinstance(c, dict) and c.get("type") == "tool_result":
                tc = c.get("content")
                if isinstance(tc, str):
                    texts.append(tc)
                elif isinstance(tc, list):
                    for piece in tc:
                        if isinstance(piece, dict) and piece.get("type") == "text":
                            texts.append(piece.get("text") or "")
        text = "\n".join([t for t in texts if t]).strip()
        return ParsedEvent(type=EVENT_TOOL_RESULT, text=text, raw=obj)
    if t == "result":
        # 最终结果
        text = obj.get("result") or ""
        if isinstance(text, dict):
            text = text.get("text") or json.dumps(text, ensure_ascii=False)
        is_error = bool(obj.get("is_error") or obj.get("subtype") == "error")
        if is_error:
            return ParsedEvent(type=EVENT_ERROR, text=str(text or "execution failed"), raw=obj)
        return ParsedEvent(type=EVENT_COMPLETE, text=str(text or ""), raw=obj)
    if t == "error":
        return ParsedEvent(type=EVENT_ERROR, text=obj.get("message") or str(obj), raw=obj)
    return ParsedEvent(type=EVENT_RAW, raw=obj)


# ---------------- 总入口 ----------------
def parse_line(skill: str, line: str) -> Optional[ParsedEvent]:
    """解析单行 stream-json 输出。"""
    line = (line or "").strip()
    if not line:
        return None
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        # 非 JSON 行：当作纯文本进度
        return ParsedEvent(type=EVENT_PROGRESS, text=line, raw={"raw_line": line})
    if skill == "codex":
        return parse_codex_event(obj)
    return parse_claude_event(obj)


def iter_parse(skill: str, lines: Iterable[str]) -> Iterable[ParsedEvent]:
    for line in lines:
        ev = parse_line(skill, line)
        if ev is not None:
            yield ev
