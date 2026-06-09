"""
Agent 适配器：AgentAdapter 基类及 Codex / Claude / Qoder 三个子类。

从 lark2agent_ws.py L626-853 提取。
适配器内部引用的辅助函数（如 get_active_conversation、parse_codex_json_event 等）
目前以 stub 形式标记，待后续模块提取完成后替换为正式导入。
"""

import json
import logging
import os
import re
import shlex
from pathlib import Path
from typing import Any, Optional

from backend.runtime.config import (
    APPROVED_CLAUDE_PERMISSION_MODE,
    APPROVED_CODEX_APPROVAL_POLICY,
    APPROVED_CODEX_SANDBOX_MODE,
    APPROVED_QODER_PERMISSION_MODE,
    CLAUDE_BIN,
    CLAUDE_EXTRA_ARGS,
    CLAUDE_MODEL,
    CLAUDE_PERMISSION_MODE,
    CLAUDE_TIMEOUT_SECONDS,
    CODEX_APPROVAL_POLICY,
    CODEX_BIN,
    CODEX_MODEL,
    CODEX_SANDBOX_MODE,
    CODEX_TIMEOUT_SECONDS,
    DEFAULT_AGENT_ID,
    FINAL_REPLY_MAX_CHARS,
    QODER_BIN,
    QODER_EXTRA_ARGS,
    QODER_MODEL,
    QODER_PERMISSION_MODE,
    QODER_PROCESS_HOME,
    QODER_TIMEOUT_SECONDS,
)
from backend.runtime.task_runtime import CodexTaskRuntime

logger = logging.getLogger("lark2agent-ws")


# ── Qoder permission mode 常量与工具函数 ──

QODER_PERMISSION_MODE_CHOICES = {"default", "accept_edits", "bypass_permissions", "dont_ask", "auto"}
QODER_PERMISSION_MODE_ALIASES = {
    "accept": "accept_edits",
    "accept_edit": "accept_edits",
    "accept-edits": "accept_edits",
    "bypass": "bypass_permissions",
    "bypass_permission": "bypass_permissions",
    "bypass-permissions": "bypass_permissions",
    "dontask": "dont_ask",
    "dont-ask": "dont_ask",
    "do_not_ask": "dont_ask",
    "do-not-ask": "dont_ask",
    # qodercli has no "ask" mode. In the bridge, dont_ask is the right first
    # pass because it fails fast and lets Lark approval retry with the approved mode.
    "ask": "dont_ask",
}


def normalize_agent_id(agent_id: str = "") -> str:
    """将 agent_id 规范化为 codex / claude / qoder 之一。"""
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
    return value if value in _ADAPTER_REGISTRY else "codex"


def split_conversation_key(value: str) -> tuple[str, str]:
    """拆分 'agent_id:session_id' 形式的会话键。"""
    text = str(value or "")
    if ":" in text:
        prefix, rest = text.split(":", 1)
        agent_id = normalize_agent_id(prefix)
        if agent_id != "codex" and rest:
            return agent_id, rest
    return "codex", text


def normalize_qoder_permission_mode(value: str, env_name: str = "QODER_PERMISSION_MODE") -> str:
    """校验并规范化 qoder permission mode。"""
    raw = str(value or "").strip()
    if not raw:
        return ""
    key = raw.lower()
    normalized = QODER_PERMISSION_MODE_ALIASES.get(key, key.replace("-", "_"))
    if normalized in QODER_PERMISSION_MODE_CHOICES:
        if normalized != raw:
            logger.warning("%s=%r is not a qodercli permission-mode choice; using %r", env_name, raw, normalized)
        return normalized
    choices = ", ".join(sorted(QODER_PERMISSION_MODE_CHOICES))
    raise ValueError(f"{env_name}={raw!r} 不是 qodercli 支持的 permission mode；可选值：{choices}")


def is_qoder_quest_task(task: Optional[CodexTaskRuntime]) -> bool:
    """判断是否为 Qoder Quest 模式任务。"""
    if not task:
        return False
    agent_id = normalize_agent_id(task.agent_id)
    mode = str(task.agent_mode or "").strip().lower().lstrip("/")
    return agent_id == "qoder" and mode == "quest"


def qoder_task_prompt(task: CodexTaskRuntime) -> str:
    """为 Qoder 任务构建 prompt（Quest 模式自动加前缀）。"""
    prompt = str(task.prompt or "").strip()
    if is_qoder_quest_task(task) and not re.match(r"^/quest(?:\s|$)", prompt, flags=re.IGNORECASE):
        return f"/quest {prompt}".strip()
    return prompt


def short_text(text: str, limit: int = 120) -> str:
    """截断过长文本，合并空白后保留 limit 个字符。

    从 lark2agent_ws.py L1983 提取。
    """
    text = re.sub(r"\s+", " ", str(text or "")).strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


def final_reply_text(text: str, limit: int = FINAL_REPLY_MAX_CHARS) -> str:
    """格式化最终回复文本，超长则截断并附带提示。

    从 lark2agent_ws.py L1990 提取。
    """
    text = str(text or "").strip()
    if not text:
        return ""
    if limit <= 0 or len(text) <= limit:
        return text
    omitted = len(text) - limit
    return text[:limit].rstrip() + f"\n\n...（已截断，剩余 {omitted} 字）"


def extract_text_content(content: Any) -> str:
    """提取 Codex JSON 消息列表中的文本片段。

    从 lark2agent_ws.py L2222 提取。
    """
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


def is_internal_codex_error(text: str) -> bool:
    """判断是否为 Codex 内部错误（router/policy 类）。

    从 lark2agent_ws.py L5257 提取。
    """
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
    """判断输出是否表明需要创建审批请求。

    从 lark2agent_ws.py L5277 提取。
    """
    haystack = str(text or "").lower()
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
        "permission mode",
        "auto-denied",
        "auto denied",
        "automatically denied",
        "can't modify",
        "cannot modify",
        "denied by user",
        "unable to create",
        "dont_ask",
        "don't ask",
        "自动拒绝",
        "权限模式",
        "终端权限",
        "权限弹窗",
    ]
    return any(signal in haystack for signal in signals)


def approved_permission_mode(agent_id: str) -> str:
    """返回指定 agent 批准后的 permission mode。"""
    agent_id = normalize_agent_id(agent_id)
    if agent_id == "claude":
        return APPROVED_CLAUDE_PERMISSION_MODE
    if agent_id == "qoder":
        mode = normalize_qoder_permission_mode(APPROVED_QODER_PERMISSION_MODE, "APPROVED_QODER_PERMISSION_MODE")
        if mode == "auto":
            logger.warning(
                "APPROVED_QODER_PERMISSION_MODE=%r is ambiguous after Lark approval; using 'bypass_permissions'",
                APPROVED_QODER_PERMISSION_MODE,
            )
            return "bypass_permissions"
        return mode
    return ""


# ── stub / placeholder：待后续模块提取完成后替换为正式导入 ──

# stub: ConversationInfo — 后续从 lark2agent_ws.py L174 提取
class ConversationInfo:
    """Stub: 待从 lark2agent_ws.py 提取 ConversationInfo。"""
    def __init__(self, session_id: str = "", file: Path = Path("."), agent_id: str = "codex",
                 cwd: Optional[Path] = None, originator: str = "", source: str = "", **_kwargs: Any):
        self.session_id = session_id
        self.file = file
        self.agent_id = agent_id
        self.cwd = cwd
        self.originator = originator
        self.source = source


def get_active_conversation(session_id: str, conversation_id: str = "") -> Optional[ConversationInfo]:
    """获取可恢复的会话信息。

    如果有活跃的 conversation_id 且 agent 支持 resume，尝试从 DB 获取 session_id。
    如果直接传入了 session_id（旧逻辑）也兼容。
    """
    # 如果直接传入 session_id（已知场景），直接返回
    if session_id:
        agent_id, raw_sid = split_conversation_key(session_id)
        return ConversationInfo(
            session_id=raw_sid,
            agent_id=agent_id,
            originator="codex_exec" if agent_id == "codex" else "",
            source="exec" if agent_id == "codex" else "",
        )
    # 如果有 conversation_id，从 DB 获取
    if conversation_id:
        import asyncio
        try:
            from backend.services.conversation_service import conversation_service
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # 从同步上下文调用异步函数——使用 run_coroutine_threadsafe 不合适，
                # 因为这里在同一事件循环中。使用同步 DB 查询作为 fallback。
                return _get_conversation_sync(conversation_id)
            else:
                sid = loop.run_until_complete(
                    conversation_service.get_active_session(conversation_id)
                )
                if sid:
                    return ConversationInfo(session_id=sid, agent_id="codex", originator="codex_exec", source="exec")
        except Exception:
            logger.debug("get_active_conversation: failed to query conversation %s", conversation_id[:8])
    return None


def _get_conversation_sync(conversation_id: str) -> Optional[ConversationInfo]:
    """同步从 DB 获取会话 session_id（用于在同步上下文中调用）。"""
    import sqlite3
    db_url = os.environ.get("DATABASE_URL", "sqlite+aiosqlite:///./lark2agent.db")
    db_path = db_url.replace("sqlite+aiosqlite:///", "")
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.execute(
            "SELECT session_id, agent_id, status FROM conversations WHERE id = ?",
            (conversation_id,),
        )
        row = cursor.fetchone()
        conn.close()
        if row and row[0] and row[2] != "closed":
            return ConversationInfo(
                session_id=row[0],
                agent_id=row[1] or "codex",
                originator="codex_exec" if (row[1] or "codex") == "codex" else "",
                source="exec" if (row[1] or "codex") == "codex" else "",
            )
    except Exception:
        logger.debug("_get_conversation_sync: DB query failed for %s", conversation_id[:8])
    return None


def _parse_codex_item_event(typ: str, item: dict) -> tuple[str, str]:
    """解析 Codex CLI 0.136+ 的 item.* 事件（item.started/updated/completed）。"""
    item_type = str(item.get("type") or "")
    is_completed = typ == "item.completed"

    if item_type == "agent_message":
        # 仅 item.completed 携带 text
        text = item.get("text") or ""
        return ("message", str(text)) if (is_completed and text) else ("skip", "")

    if item_type == "reasoning":
        text = item.get("text") or ""
        if not text:
            return ("progress", "思考中…")
        return ("progress", f"思考中：{short_text(str(text), 300)}")

    if item_type == "command_execution":
        command = short_text(item.get("command", ""), 240)
        if is_completed:
            output = item.get("aggregated_output") or ""
            exit_code = item.get("exit_code")
            status = item.get("status") or ("completed" if exit_code == 0 else "failed")
            head = f"命令完成（{status}, exit={exit_code}）：{command}"
            body = short_text(str(output), 900)
            return "tool_output", f"{head}\n{body}".strip() if body else head
        # started / updated
        return "progress", f"运行命令：{command}".strip()

    if item_type == "file_change":
        changes = item.get("changes") or []
        parts: list[str] = []
        for ch in changes:
            if not isinstance(ch, dict):
                continue
            kind = ch.get("kind") or ""
            path = ch.get("path") or ""
            parts.append(f"{kind}: {path}".strip(": "))
        summary = short_text("; ".join(parts), 500) or "(no changes)"
        status = item.get("status") or ""
        prefix = "文件变更" + (f"（{status}）" if status else "")
        return "tool_output", f"{prefix}：{summary}"

    if item_type == "mcp_tool_call":
        server = item.get("server", "")
        tool = item.get("tool", "tool")
        name = f"{server}.{tool}" if server else str(tool)
        if is_completed:
            err = item.get("error") or {}
            if isinstance(err, dict) and err.get("message"):
                return "tool_output", f"工具失败：{name}\n{short_text(err.get('message', ''), 900)}"
            result = item.get("result") or {}
            content = ""
            if isinstance(result, dict):
                content = extract_text_content(result.get("content"))
            return "tool_output", f"工具结果：{name}\n{short_text(content, 900)}".rstrip()
        args = short_text(json.dumps(item.get("arguments"), ensure_ascii=False), 240) if item.get("arguments") is not None else ""
        return "progress", f"调用工具：{name}\n{args}".strip()

    if item_type == "web_search":
        query = short_text(item.get("query", ""), 240)
        return "progress", f"网络搜索：{query}".strip()

    if item_type == "todo_list":
        items_list = item.get("items") or []
        lines: list[str] = []
        for it in items_list:
            if not isinstance(it, dict):
                continue
            mark = "x" if it.get("completed") else " "
            lines.append(f"[{mark}] {it.get('text', '')}")
        body = short_text("\n".join(lines), 500) or "(empty)"
        return "progress", f"TODO：\n{body}"

    if item_type == "error":
        msg = item.get("message") or ""
        return "tool_output", f"错误：{short_text(str(msg), 900)}"

    return "skip", ""


def parse_codex_json_event(line: str) -> tuple[str, str]:
    """解析 Codex CLI 输出的一行 JSON 事件，返回 (event_type, content)。

    从 lark2agent_ws.py L5207 提取。
    event_type ∈ {"session_id", "message", "complete", "progress",
                  "tool_output", "text", "skip"}。

    兼容两套格式：
    - 旧版（≤0.135）：session_meta / event_msg / response_item …
    - 新版（≥0.136）：thread.started / turn.* / item.*
    """
    raw = line.strip()
    if is_internal_codex_error(raw):
        return ("tool_output", raw) if should_create_approval(raw) else ("skip", "")

    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        return "text", raw

    typ = obj.get("type")
    payload = obj.get("payload") or {}

    # ── Codex CLI ≥ 0.136 新版事件格式 ──
    if typ == "thread.started":
        return "session_id", str(obj.get("thread_id") or "")
    if typ == "turn.started":
        return "skip", ""
    if typ == "turn.completed":
        # 最终回复已通过 item.completed(agent_message) 输出，这里只标记完成
        return "complete", ""
    if typ == "turn.failed":
        err = obj.get("error") or {}
        msg = err.get("message") if isinstance(err, dict) else str(err)
        return "tool_output", f"任务失败：{short_text(str(msg or ''), 900)}"
    if typ in ("item.started", "item.updated", "item.completed"):
        item = obj.get("item") or {}
        if isinstance(item, dict):
            return _parse_codex_item_event(typ, item)
        return "skip", ""
    if typ == "error":
        msg = str(obj.get("message") or "")
        # 瞬时重连提示降级为 progress；其余视为工具输出/错误
        if "reconnect" in msg.lower():
            return "progress", short_text(msg, 500)
        return "tool_output", short_text(msg, 900)

    # ── Codex CLI ≤ 0.135 旧版事件格式 ──
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


# ── Adapter 注册表（延迟填充，在类定义之后） ──
_ADAPTER_REGISTRY: dict[str, "AgentAdapter"] = {}


# ── Adapter 类定义 ──

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
        conv = get_active_conversation(task.session_id, conversation_id=task.conversation_id)
        if self.is_resumable(conv):
            return common + ["resume", "--json", "--skip-git-repo-check", conv.session_id, task.prompt]
        return common + ["--json", "--skip-git-repo-check", "-C", str(task.cwd), task.prompt]

    def parse_events(self, line: str) -> list[tuple[str, str]]:
        return [parse_codex_json_event(line)]

    def is_resumable(self, conv: Optional[ConversationInfo]) -> bool:
        if not conv or conv.agent_id != self.id:
            return False
        return conv.originator == "codex_exec" or conv.source == "exec"


def extract_claude_text_content(value: Any) -> str:
    """递归提取 Claude JSON 消息中的文本内容。"""
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


def parse_qoder_json_event(line: str) -> list[tuple[str, str]]:
    """解析 Qoder CLI 输出的 stream-json 事件行。"""
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
        permission_mode = normalize_qoder_permission_mode(task.permission_mode or QODER_PERMISSION_MODE, "QODER_PERMISSION_MODE")
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
        argv.append(qoder_task_prompt(task))
        return argv

    def parse_events(self, line: str) -> list[tuple[str, str]]:
        return parse_qoder_json_event(line)

    def is_resumable(self, conv: Optional[ConversationInfo]) -> bool:
        return bool(conv and conv.agent_id == self.id and conv.session_id)


# ── 填充注册表 ──
AGENT_ADAPTERS: dict[str, AgentAdapter] = {
    "codex": CodexAdapter(),
    "claude": ClaudeAdapter(),
    "qoder": QoderAdapter(),
}
_ADAPTER_REGISTRY.update(AGENT_ADAPTERS)
