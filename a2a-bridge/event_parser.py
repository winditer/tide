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


# 真实审批提示均为简短问句；超过该长度的文本视为正常回复正文。
_APPROVAL_MAX_LEN = 400


def _looks_like_approval(text: str) -> bool:
    if not text:
        return False
    # 长文本（如"实施指南"类最终回复）中偶然出现"需要审批"等词不应
    # 触发审批误判——否则最终回复会被当作 EVENT_APPROVAL，不生成
    # artifact，任务表现为"已完成但无输出"。
    if len(text) > _APPROVAL_MAX_LEN:
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
        # Codex CLI >=0.136 将最终回复以 item_type == "agent_message" 输出；
        # 旧版本（及部分分支）使用 "assistant_message"。两者均需识别，
        # 否则 AI 实际输出会落入 EVENT_RAW 被丢弃，导致任务无输出。
        if item_type in ("agent_message", "assistant_message"):
            # 仅 item.completed 携带完整最终文本；item.started/updated 为流式
            # 增量，与 backend 对齐只在 completed 输出，避免重复或半截内容。
            if t != "item.completed":
                return None
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

    # ── Codex CLI <= 0.135 旧版事件格式 ──
    # 部分 daemon 主机安装的 codex CLI 仍输出旧版 session_meta / event_msg /
    # response_item 结构；若不识别，AI 实际回复会落入 EVENT_RAW 被丢弃，
    # 导致任务只剩进度而无内容。此处与 backend/runtime/adapters.py 完整版对齐。
    payload = obj.get("payload") or {}
    if t == "session_meta":
        sid = payload.get("id") or obj.get("session_id")
        return ParsedEvent(type=EVENT_SESSION, metadata={"session_id": sid}, raw=obj)
    if t == "event_msg":
        etype = payload.get("type") or ""
        if etype == "agent_message":
            text = payload.get("message") or ""
            if _looks_like_approval(text):
                return ParsedEvent(type=EVENT_APPROVAL, text=text, role="assistant", raw=obj)
            return ParsedEvent(type=EVENT_MESSAGE, text=text, role="assistant", raw=obj)
        if etype == "task_complete":
            # 最终回复文本（旧版通过 last_agent_message 携带）
            return ParsedEvent(type=EVENT_MESSAGE, text=payload.get("last_agent_message") or "", role="assistant", raw=obj)
        if etype == "user_message":
            return None
        # 其它 event_msg（如 reasoning/exec 等）作为进度
        txt = payload.get("message") or payload.get("text") or ""
        return ParsedEvent(type=EVENT_PROGRESS, text=txt, raw=obj) if txt else None
    if t == "response_item":
        item_type = payload.get("type") or ""
        if item_type == "message" and payload.get("role") == "assistant":
            text = _extract_content_text(payload.get("content"))
            if _looks_like_approval(text):
                return ParsedEvent(type=EVENT_APPROVAL, text=text, role="assistant", raw=obj)
            return ParsedEvent(type=EVENT_MESSAGE, text=text, role="assistant", raw=obj)
        if item_type == "reasoning":
            text = _extract_content_text(payload.get("summary"))
            return ParsedEvent(type=EVENT_PROGRESS, text=text, metadata={"kind": "reasoning"}, raw=obj) if text else None
        if item_type == "function_call":
            name = payload.get("name") or "tool"
            args = payload.get("arguments") or ""
            return ParsedEvent(type=EVENT_TOOL_USE, text=f"{name} {args}".strip(), metadata={"command": name}, raw=obj)
        if item_type == "function_call_output":
            out = payload.get("output") or ""
            return ParsedEvent(type=EVENT_TOOL_RESULT, text=str(out), raw=obj) if out else None

    return ParsedEvent(type=EVENT_RAW, raw=obj)


def _extract_content_text(content: Any) -> str:
    """从 Codex 旧版 content/summary 结构中提取纯文本。

    兼容形式：字符串、[{"type":"text"|"input_text"|"output_text","text":...}]。
    """
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        return content.get("text") or ""
    if isinstance(content, list):
        texts: list[str] = []
        for piece in content:
            if isinstance(piece, str):
                texts.append(piece)
            elif isinstance(piece, dict):
                txt = piece.get("text") or piece.get("content") or ""
                if isinstance(txt, str) and txt:
                    texts.append(txt)
        return "\n".join(texts).strip()
    return ""


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
        # Claude/Qoder 在 stream-json --verbose 下会对同一回复输出多个流式
        # assistant 事件（每个都可能携带完整/累加文本），最后又以 result
        # 事件重发一次。若每个 assistant 都生成 artifact，最终内容会重复多次。
        # 因此中间 assistant 文本只作为进度事件，最终 artifact 由 result 事件生成。
        return ParsedEvent(type=EVENT_PROGRESS, text=text, role="assistant", raw=obj)
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
