"""
Agent 适配器：AgentAdapter 基类及 Codex / Claude / Qoder 三个子类。

从 tide_ws.py L626-853 提取。
适配器内部引用的辅助函数（如 get_active_conversation、parse_codex_json_event 等）
目前以 stub 形式标记，待后续模块提取完成后替换为正式导入。
"""

import asyncio
import json
import logging
import os
import re
import shlex
import shutil
from pathlib import Path
from typing import Any, AsyncGenerator, Optional

from backend.runtime.a2a_client import A2AClient, A2AAgentConfig, A2ATask
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
    resolve_auto_model,
)
from backend.runtime.task_runtime import CodexTaskRuntime

logger = logging.getLogger("tide-ws")


# ── CLI 噪声过滤 ──

_STDIN_NOISE_RE = re.compile(
    r"^Reading additional input from stdin\.{0,3}\n?|^Reading from stdin\.{0,3}\n?",
    re.MULTILINE,
)


def _filter_cli_noise(text: str) -> str:
    """移除 CLI stdin 噪声提示。"""
    if not text:
        return text
    return _STDIN_NOISE_RE.sub("", text).strip()


_FILTERABLE_EVENT_TYPES = {"message", "text", "tool_output", "complete"}


def _apply_noise_filter(events: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """对事件列表中的文本内容做噪声过滤；过滤后为空则降级为 skip。"""
    result: list[tuple[str, str]] = []
    for event_type, text in events:
        if event_type in _FILTERABLE_EVENT_TYPES:
            text = _filter_cli_noise(text)
            if not text:
                result.append(("skip", ""))
                continue
        result.append((event_type, text))
    return result


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

    从 tide_ws.py L1983 提取。
    """
    text = re.sub(r"\s+", " ", str(text or "")).strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


def final_reply_text(text: str, limit: int = FINAL_REPLY_MAX_CHARS) -> str:
    """格式化最终回复文本，超长则截断并附带提示。

    从 tide_ws.py L1990 提取。
    """
    text = str(text or "").strip()
    if not text:
        return ""
    if limit <= 0 or len(text) <= limit:
        return text
    omitted = len(text) - limit
    return text[:limit].rstrip() + f"\n\n...（已截断，剩余 {omitted} 字）"


async def _build_prompt_with_rules(
    prompt: str,
    workspace_id: str,
    cwd: str,
    project_id: Optional[str] = None,
) -> str:
    """将匹配的 Rules 内容注入到 prompt 前缀（在 Skills 之前）。

    Rules 是强制约束（mandatory），按 priority 排序后以 Markdown 段落形式
    注入到 prompt 顶部；Skills 是参考指南，应在 Rules 之后追加。
    匹配失败或加载异常时静默回退到原始 prompt。
    """
    try:
        from backend.services.rule_service import rule_service
        rules = await rule_service.get_matching_rules(
            workspace_id=workspace_id,
            cwd=cwd,
            project_id=project_id,
        )
    except Exception:  # noqa: BLE001
        logger.exception("_build_prompt_with_rules: failed to load rules")
        return prompt
    if not rules:
        return prompt
    rule_sections: list[str] = []
    for r in rules:
        name = r.get("name") or ""
        scope = r.get("scope") or "global"
        content = r.get("content") or ""
        rule_sections.append(f"## Rule: {name} [{scope}]\n{content}")
    prefix = "# Mandatory Rules (always follow)\n\n" + "\n\n---\n\n".join(rule_sections)
    return f"{prefix}\n\n---\n\n{prompt}"


def extract_text_content(content: Any) -> str:
    """提取 Codex JSON 消息列表中的文本片段。

    从 tide_ws.py L2222 提取。
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

    从 tide_ws.py L5257 提取。
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

    从 tide_ws.py L5277 提取。
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

# stub: ConversationInfo — 后续从 tide_ws.py L174 提取
class ConversationInfo:
    """Stub: 待从 tide_ws.py 提取 ConversationInfo。"""
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
    db_url = os.environ.get("DATABASE_URL", "sqlite+aiosqlite:///./tide.db")
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

    从 tide_ws.py L5207 提取。
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
        # 过滤已知的 CLI 噪声提示
        if "Reading additional input from stdin" in raw or "Reading from stdin" in raw:
            return "skip", ""
        # 过滤 Codex CLI (Rust) tracing 日志行，避免混入回复内容
        if re.match(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+', raw):
            return "skip", ""
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
        return "session_id", str(payload.get("id", ""))

    if typ == "event_msg":
        event_type = payload.get("type", "")
        if event_type == "agent_message":
            return "message", str(payload.get("message", ""))
        if event_type == "task_complete":
            return "complete", str(payload.get("last_agent_message", ""))
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
            args = short_text(str(payload.get("arguments", "")), 240)
            return "progress", f"调用工具：{name}\n{args}".strip()
        if item_type == "function_call_output":
            output = payload.get("output", "")
            return "tool_output", f"工具结果：\n{short_text(str(output), 900)}"

    if typ in ("agent_message", "assistant_message", "message"):
        msg = obj.get("message") or obj.get("text") or ""
        return "message", str(msg)
    if typ in ("exec_command_begin", "command_begin", "tool_call"):
        return "progress", short_text(line.strip(), 500)
    if typ in ("exec_command_output", "command_output", "tool_output"):
        return "tool_output", short_text(line.strip(), 900)

    return "skip", ""


# ── Codex CLI 有效模型 key（抽象 tier 名而非原始模型名） ──
CODEX_VALID_MODEL_KEYS = {"auto", "ultimate", "performance", "efficient", "lite"}

# ── Qoder CLI 有效模型 key（从 qodercli --help 获取） ──
QODER_VALID_MODEL_KEYS = {
    "auto", "ultimate", "performance", "efficient", "lite",
    "qmodel_latest", "qmodel", "gm51model", "kmodel",
    "dmodel", "dfmodel", "mmodel",
}

# ── Adapter 注册表（延迟填充，在类定义之后） ──
_ADAPTER_REGISTRY: dict[str, "AgentAdapter"] = {}


# ── Token usage 解析 ────────────────────────────────────────────
# 不同 CLI（Codex / Claude / Qoder）输出格式差异较大，这里实现
# 通用的 JSON 行提取逻辑：扫描嵌套字段中常见的 token 计数键名。

_TOKEN_INPUT_KEYS = (
    "input_tokens",
    "prompt_tokens",
    "prompt_token_count",
    "input_token_count",
    "in_tokens",
    # camelCase 经过 .lower() 处理后的键名（CLI 输出可能为 inputTokens 等）
    "inputtokens",
    "prompttokens",
    # Claude CLI 的 cache 相关 token，需计入 input 总量
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
    "cachecreationinputtokens",
    "cachereadinputtokens",
)
_TOKEN_OUTPUT_KEYS = (
    "output_tokens",
    "completion_tokens",
    "completion_token_count",
    "output_token_count",
    "out_tokens",
    # camelCase 经过 .lower() 处理后的键名
    "outputtokens",
    "completiontokens",
)
_TOKEN_USAGE_CONTAINER_KEYS = (
    "usage",
    "token_usage",
    "tokens",
    "stats",
    "metrics",
)


def _coerce_int(value: Any) -> int:
    try:
        v = int(value)
        return v if v >= 0 else 0
    except (TypeError, ValueError):
        return 0


def estimate_token_count(text: str, encoding_name: str = "cl100k_base") -> int:
    """使用 tiktoken 估算文本的 token 数量。

    当 Agent CLI 不报告 token 用量时（如当前 Codex CLI 的 ``--json`` 输出不携带
    token 字段、Qoder CLI 输出 ``input_tokens=0``），作为降级估算方案使用。

    注意：
    - 该函数只统计可见文本的 token，不包含 CLI 内部注入的 system prompt、
      工具定义、上下文 cache 等隐式输入，因此估算值通常会低于真实计费值。
    - tiktoken 不可用时退化为按 4 字符 ≈ 1 token 的粗略估算。
    """
    if not text:
        return 0
    try:
        import tiktoken  # 局部导入：避免可选依赖未安装时模块加载失败

        enc = tiktoken.get_encoding(encoding_name)
        return len(enc.encode(text))
    except Exception:
        # tiktoken 不可用时使用字符比例粗估（~4 char/token）
        return max(1, len(text) // 4)


def _scan_token_usage(obj: Any) -> tuple[int, int]:
    """递归扫描任意嵌套结构，提取 (input, output) token 数。

    返回找到的最大值（多次 turn 累加由调用方处理）。
    """
    if not isinstance(obj, (dict, list)):
        return 0, 0
    found_in, found_out = 0, 0
    if isinstance(obj, dict):
        for key, value in obj.items():
            kl = str(key).lower()
            if kl in _TOKEN_INPUT_KEYS and isinstance(value, (int, float, str)):
                found_in = max(found_in, _coerce_int(value))
            elif kl in _TOKEN_OUTPUT_KEYS and isinstance(value, (int, float, str)):
                found_out = max(found_out, _coerce_int(value))
            elif kl in _TOKEN_USAGE_CONTAINER_KEYS or isinstance(value, (dict, list)):
                ci, co = _scan_token_usage(value)
                found_in = max(found_in, ci)
                found_out = max(found_out, co)
    else:  # list
        for item in obj:
            ci, co = _scan_token_usage(item)
            found_in = max(found_in, ci)
            found_out = max(found_out, co)
    return found_in, found_out


def try_parse_token_usage(line: str) -> tuple[int, int]:
    """尝试从单行 Agent 输出中解析 token 使用量。

    返回 ``(input_tokens, output_tokens)``；解析失败返回 ``(0, 0)``，
    调用方应忽略返回值为 0 的情况以避免覆盖真实数据。

    备注：
    - Codex CLI 的 ``--json`` 输出当前不携带 token 计数（CLI 限制），此处会返回 (0, 0)。
      TODO: 待 Codex CLI 后续版本暴露 token 字段后再扩展。
    - Qoder CLI 当前输出 ``input_tokens: 0`` 为客户端 Bug，后续 CLI 修复后无需改动本函数。
    """
    if not line:
        return 0, 0
    raw = line.strip()
    if not raw or raw[0] not in "{[":
        return 0, 0
    try:
        obj = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return 0, 0
    return _scan_token_usage(obj)


def try_parse_claude_result(line: str) -> tuple[float, int, int]:
    """从 Claude CLI ``result`` 事件解析精确的成本和 token 用量。

    Claude CLI 在任务结束时输出形如 ``{"type": "result", "total_cost_usd": ...,
    "modelUsage": {"<model>": {"inputTokens": ..., "outputTokens": ...,
    "cacheCreationInputTokens": ..., "cacheReadInputTokens": ...}}}`` 的事件。
    本函数汇总所有模型的 token 计数（含 cache 部分），并直接返回 CLI 报告的成本。

    Args:
        line: Agent 输出的单行内容。

    Returns:
        ``(cost_usd, total_input_tokens, total_output_tokens)``；非 result 事件或
        解析失败时返回 ``(0.0, 0, 0)``，调用方应忽略全 0 结果以免覆盖通用解析数据。
    """
    if not line:
        return 0.0, 0, 0
    raw = line.strip()
    if not raw or raw[0] != "{":
        return 0.0, 0, 0
    try:
        obj = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return 0.0, 0, 0
    if not isinstance(obj, dict) or obj.get("type") != "result":
        return 0.0, 0, 0

    try:
        cost = float(obj.get("total_cost_usd") or 0)
    except (TypeError, ValueError):
        cost = 0.0

    model_usage = obj.get("modelUsage") or {}
    total_in = 0
    total_out = 0
    if isinstance(model_usage, dict):
        for usage in model_usage.values():
            if not isinstance(usage, dict):
                continue
            total_in += (
                _coerce_int(usage.get("inputTokens"))
                + _coerce_int(usage.get("cacheCreationInputTokens"))
                + _coerce_int(usage.get("cacheReadInputTokens"))
            )
            total_out += _coerce_int(usage.get("outputTokens"))

    return cost, total_in, total_out


# ── Skills prompt 注入 ──

async def _build_prompt_with_skills(
    prompt: str,
    skill_slugs: list[str],
    workspace_id: str = "default",
    project_id: Optional[str] = None,
) -> str:
    """将选中的 Skills 内容注入到 prompt 前缀。

    工作流 Agent 节点可在 ``data.skills`` 中配置启用的 Skill slug 列表，
    引擎在构造 prompt 时调用本方法将 Skills 全文以可读 Markdown 段落注入。
    若 ``skill_slugs`` 为空或查不到任何 Skill，则原样返回 ``prompt``。

    当提供 ``project_id`` 时，使用 ``get_skills_for_project()`` 加载全局+项目
    技能并按 slug 合并（项目覆盖全局），再从合并结果中过滤出指定 slugs。
    """
    if not skill_slugs:
        return prompt
    # 局部导入避免循环依赖（services 反过来不依赖 adapters）
    from backend.services.skill_service import skill_service

    if project_id:
        # 加载全局+项目 Skills 合并后，按 slug 过滤
        all_skills = await skill_service.get_skills_for_project(workspace_id, project_id)
        slug_set = set(skill_slugs)
        skills = [s for s in all_skills if s["slug"] in slug_set]
        # 保持与传入 slug 顺序一致
        index = {s["slug"]: s for s in skills}
        skills = [index[slug] for slug in skill_slugs if slug in index]
    else:
        skills = await skill_service.get_by_slugs(workspace_id, skill_slugs)

    if not skills:
        return prompt

    skill_sections: list[str] = []
    for s in skills:
        skill_sections.append(f"## Skill: {s['name']}\n{s['content']}")
    prefix = (
        "# Active Skills (follow these guidelines)\n\n"
        + "\n\n---\n\n".join(skill_sections)
    )
    return f"{prefix}\n\n---\n\n# Task\n\n{prompt}"


# ── Knowledge prompt 注入 ──


async def _build_prompt_with_knowledge(
    prompt: str,
    cwd: str,
    project_id: Optional[str] = None,
) -> str:
    """将项目知识库模块摘要注入到 prompt 前缀（在 Rules 之后、Skills 之前）。

    知识库是项目结构的参考信息，加载失败或缺失时静默回退到原始 prompt，
    不阻塞主流程。
    """
    if not cwd:
        return prompt

    try:
        from backend.services.knowledge_service import knowledge_service

        summary = await knowledge_service.get_project_modules_summary(cwd)
        if not summary:
            return prompt
        return f"# Project Knowledge (模块结构)\n\n{summary}\n\n---\n\n{prompt}"
    except Exception as e:
        logger.debug("_build_prompt_with_knowledge failed: %s", e)
        return prompt


# ── Adapter 类定义 ──

class AgentAdapter:
    id = "agent"
    label = "Agent"
    bin_name = ""
    default_model = ""
    timeout_seconds = CODEX_TIMEOUT_SECONDS
    supports_resume = True
    valid_model_keys: set[str] = set()  # 空集表示接受任意模型名

    def normalize_model(self, model: str) -> str:
        """校验并规范化模型名。

        如果 valid_model_keys 非空且 model 不在其中，回退到随机可用模型。
        当 model 为 'auto' 时，从配置的可用模型列表中随机选择一个实际模型名，
        避免将 "auto" 字面量传给 LLM API 网关导致 503 错误。
        子类可覆盖以实现 adapter 特定的校验逻辑。
        """
        if not model:
            return ""
        # "auto" → 从可用模型列表中随机选择实际模型
        if model.strip().lower() == "auto":
            resolved = resolve_auto_model(model)
            logger.info("[%s] Resolved model 'auto' → %r", self.id, resolved)
            return resolved
        if not self.valid_model_keys:
            # 无限制列表，直接透传（Claude/Qoder 接受任意模型名）
            return model
        if model.lower() in self.valid_model_keys:
            return model.lower()
        # 无效 model key —— 回退到随机可用模型
        resolved = resolve_auto_model("auto")
        logger.warning(
            "[%s] Invalid model %r, falling back to %r. Valid keys: %s",
            self.id, model, resolved, ", ".join(sorted(self.valid_model_keys)),
        )
        return resolved

    def build_command(self, task: CodexTaskRuntime, last_message_file: Optional[Path] = None) -> list[str]:
        raise NotImplementedError

    def parse_events(self, line: str) -> list[tuple[str, str]]:
        raise NotImplementedError

    def is_resumable(self, conv: Optional[ConversationInfo]) -> bool:
        return bool(conv and conv.agent_id == self.id)

    def raw_session_id(self, value: str) -> str:
        agent_id, session_id = split_conversation_key(value)
        return session_id if agent_id == self.id else value

    def prepare_attachments(self, task: CodexTaskRuntime) -> None:
        """把任务 attachments 中的图片附件复制到 cwd，并在 prompt 顶部追加引用说明。

        仅处理本地存在的图片类附件；复制失败时记录 warning 并跳过。
        如果 prompt 中已存在 ``## 附件图片`` 标记，则不再重复注入。
        """
        attachments = getattr(task, "attachments", None) or []
        if not attachments:
            return
        cwd = getattr(task, "cwd", None)
        if not cwd:
            return

        image_suffixes = {
            ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif"
        }
        copied: list[str] = []
        for att in attachments:
            if isinstance(att, dict):
                src = (att.get("path") or att.get("local_path") or "").strip()
                att_type = att.get("type") or ""
            else:
                src = str(att).strip()
                att_type = ""
            if not src:
                continue
            src_path = Path(src)
            if not src_path.exists() or not src_path.is_file():
                logger.warning("Task attachment not found: %s", src)
                continue
            is_image = att_type == "image" or src_path.suffix.lower() in image_suffixes
            if not is_image:
                continue
            dst = cwd / src_path.name
            if dst.exists():
                stem, suffix = dst.stem, dst.suffix
                for i in range(2, 1000):
                    cand = cwd / f"{stem}-{i}{suffix}"
                    if not cand.exists():
                        dst = cand
                        break
            try:
                shutil.copy2(src_path, dst)
                copied.append(dst.name)
            except Exception as exc:
                logger.warning(
                    "Failed to copy task attachment %s to %s: %s", src, cwd, exc
                )

        if copied and "## 附件图片" not in (task.prompt or ""):
            task.prompt = (
                "## 附件图片\n"
                "以下图片已复制到当前工作目录，请按需读取并参考：\n"
                + "\n".join(f"- ./{p}" for p in copied)
                + "\n\n---\n\n"
                + (task.prompt or "")
            )


class CodexAdapter(AgentAdapter):
    id = "codex"
    label = "Codex"
    bin_name = CODEX_BIN
    default_model = CODEX_MODEL
    timeout_seconds = CODEX_TIMEOUT_SECONDS
    valid_model_keys = CODEX_VALID_MODEL_KEYS

    def build_command(self, task: CodexTaskRuntime, last_message_file: Optional[Path] = None) -> list[str]:
        common = [CODEX_BIN]
        if task.model is None:
            pass  # 不传 -m，让 CLI 自行决定模型
        else:
            model = task.model or CODEX_MODEL
            if model:
                common.extend(["-m", model])
        approval_policy = task.approval_policy or CODEX_APPROVAL_POLICY
        sandbox_mode = task.sandbox_mode or CODEX_SANDBOX_MODE
        if approval_policy:
            common.extend(["-a", approval_policy])
        if sandbox_mode:
            common.extend(["-s", sandbox_mode])
        common.extend(["exec"])
        if last_message_file:
            common.extend(["--output-last-message", str(last_message_file)])
        # 简化 resume 逻辑，与 Claude/Qoder 一致：直接检查 session_id
        if task.session_id:
            _, raw_sid = split_conversation_key(task.session_id)
            if raw_sid:
                return common + ["resume", "--json", "--skip-git-repo-check", raw_sid, task.prompt]
        return common + ["--json", "--skip-git-repo-check", "-C", str(task.cwd), task.prompt]

    def parse_events(self, line: str) -> list[tuple[str, str]]:
        return _apply_noise_filter([parse_codex_json_event(line)])

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
        if task.model is None:
            pass  # 不传 --model，让 CLI 自行决定模型
        else:
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
            return _apply_noise_filter([("text", raw)])

        events: list[tuple[str, str]] = []
        session_id = obj.get("session_id") or obj.get("sessionId")
        if session_id:
            events.append(("session_id", str(session_id)))

        typ = str(obj.get("type") or "")
        if typ == "system":
            subtype = obj.get("subtype") or obj.get("event") or "init"
            if subtype not in ("init", "ready"):
                content = extract_claude_text_content(obj.get("content"))
                # 仅当系统事件带有实际内容时才作为进度输出；
                # 空内容的控制信号直接跳过，避免占位符 "Claude 系统事件：xxx" 污染任务结果
                if content:
                    events.append(("progress", content))
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
        return _apply_noise_filter(events or [("skip", "")])


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
            # 仅当系统事件带有实际内容时才作为进度输出；
            # 空内容的控制信号（task_progress/task_started 等）直接跳过，
            # 避免占位符 "Qoder 系统事件：xxx" 反复污染任务结果
            if content:
                events.append(("progress", content))
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
    valid_model_keys = QODER_VALID_MODEL_KEYS

    def normalize_model(self, model: str) -> str:  # noqa: D102
        """Qoder CLI 只接受 tier 名称；'auto' 或无效值不传递给 CLI。

        与 Codex/Claude 不同，Qoder CLI 不接受原始模型名（如 gpt-4o），
        只接受 tier 名称（如 ultimate, performance）。因此 'auto' 不应被
        解析为原始模型名，而应留空让 CLI 使用自身环境配置（极致模式）。
        """
        if not model:
            return ""
        key = model.strip().lower()
        if key == "auto":
            # Qoder CLI 使用自身环境配置（极致模式），不传 --model
            return ""
        if key in self.valid_model_keys:
            return key
        # 无效的模型名 → 不传 --model，避免 CLI 因无法识别而 fallback
        logger.warning(
            "[qoder] normalize_model: invalid model %r, clearing. Valid keys: %s",
            model, ", ".join(sorted(self.valid_model_keys)),
        )
        return ""

    def build_command(self, task: CodexTaskRuntime, last_message_file: Optional[Path] = None) -> list[str]:
        argv = [QODER_BIN, "--print", "--output-format", "stream-json", "--cwd", str(task.cwd)]
        # 最终校验：只有有效的 qoder tier 名称才传 --model
        model = (task.model or "").strip().lower()
        if model and model != "auto" and model in QODER_VALID_MODEL_KEYS:
            argv.extend(["--model", model])
        elif model and model not in QODER_VALID_MODEL_KEYS:
            # 兜底：如果上游传了无效模型名（如 "gpt-4o"），不传给 CLI
            logger.warning("[qoder] build_command: skipping invalid model %r", task.model)
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
        return _apply_noise_filter(parse_qoder_json_event(line))

    def is_resumable(self, conv: Optional[ConversationInfo]) -> bool:
        return bool(conv and conv.agent_id == self.id and conv.session_id)


# ── 填充注册表 ──
AGENT_ADAPTERS: dict[str, AgentAdapter] = {
    "codex": CodexAdapter(),
    "claude": ClaudeAdapter(),
    "qoder": QoderAdapter(),
}
_ADAPTER_REGISTRY.update(AGENT_ADAPTERS)


# ── A2A 远程 Agent 适配器 ──

# A2A 轮询配置
_A2A_POLL_INTERVAL_SECONDS = 1.0
_A2A_TERMINAL_STATES = {"completed", "failed", "canceled", "rejected"}
_A2A_INTERACTIVE_STATES = {"input_required", "auth_required"}


class A2AAdapter:
    """远程 A2A Agent 适配器 - 将 A2A 协议映射为 Tide 内部事件流。

    与 CLI 类适配器不同，A2A 通过 HTTP 协议与远程 Agent 通信。
    因此该类不继承 AgentAdapter（无 build_command / parse_events 概念），
    而是提供 ``execute`` 异步生成器，由上层 executor 走单独的执行路径。
    """

    id = "a2a"
    label = "A2A Remote Agent"

    async def execute(
        self,
        runtime: CodexTaskRuntime,
        config: A2AAgentConfig,
    ) -> AsyncGenerator[dict, None]:
        """通过 HTTP 执行远程 Agent，产出内部事件流。

        Args:
            runtime: CodexTaskRuntime 实例，包含 prompt、conversation_id 等。
            config:  A2AAgentConfig 远程 Agent 配置。

        Yields:
            dict: 内部事件 dict（``status_changed`` / ``output_chunk`` /
            ``approval_request`` / ``completed`` / ``failed`` / ``unknown``）。
        """

        prompt = str(getattr(runtime, "prompt", "") or "")
        context_id = str(getattr(runtime, "conversation_id", "") or "") or None
        task_id = str(getattr(runtime, "session_id", "") or "") or None
        context_parts = self._build_context_parts(runtime)

        # ── Daemon WebSocket 推模式：对现有 HTTP 模式的增补 ──
        # connection_mode == 'ws' 时走 DaemonRegistry 下发；否则照常走 HTTP。
        if getattr(config, "connection_mode", "http") == "ws":
            async for evt in self._execute_ws(runtime, config, prompt, context_parts):
                yield evt
            return

        capabilities = config.capabilities or {}
        supports_streaming = bool(capabilities.get("streaming"))

        logger.info(
            "[A2AAdapter] execute agent_id=%s streaming=%s task_id=%s context_id=%s",
            config.agent_id,
            supports_streaming,
            task_id,
            context_id,
        )

        client = A2AClient(config)
        try:
            if supports_streaming:
                async for raw_event in client.send_streaming_message(
                    prompt,
                    task_id=task_id,
                    context_id=context_id,
                    context_parts=context_parts,
                ):
                    mapped = self._map_to_internal_event(raw_event)
                    if mapped:
                        yield mapped
                return

            # ── 非流式：同步发送 + 轮询 ──
            try:
                task = await client.send_message(
                    prompt,
                    task_id=task_id,
                    context_id=context_id,
                    context_parts=context_parts,
                )
            except Exception as exc:  # noqa: BLE001
                logger.exception(
                    "[A2AAdapter] send_message failed agent_id=%s",
                    config.agent_id,
                )
                yield {"type": "failed", "error": str(exc)}
                return

            yield self._map_task_to_event(task, task.state)
            last_state = task.state
            current_task: A2ATask = task

            while last_state not in _A2A_TERMINAL_STATES and last_state not in _A2A_INTERACTIVE_STATES:
                await asyncio.sleep(_A2A_POLL_INTERVAL_SECONDS)
                if getattr(runtime, "cancel_requested", False) or getattr(runtime, "stop_requested", False):
                    logger.info(
                        "[A2AAdapter] cancel requested, stopping poll agent_id=%s task_id=%s",
                        config.agent_id,
                        current_task.id,
                    )
                    try:
                        await client.cancel_task(current_task.id)
                    except Exception:  # noqa: BLE001
                        logger.exception(
                            "[A2AAdapter] cancel_task failed agent_id=%s task_id=%s",
                            config.agent_id,
                            current_task.id,
                        )
                    yield {"type": "failed", "error": "canceled by user"}
                    return

                try:
                    current_task = await client.get_task(current_task.id)
                except Exception as exc:  # noqa: BLE001
                    logger.exception(
                        "[A2AAdapter] get_task failed agent_id=%s task_id=%s",
                        config.agent_id,
                        current_task.id,
                    )
                    yield {"type": "failed", "error": str(exc)}
                    return

                if current_task.state != last_state:
                    yield self._map_task_to_event(current_task, current_task.state)
                    last_state = current_task.state

            # 终态后产出 artifact 文本片段
            if last_state == "completed":
                for artifact in current_task.artifacts or []:
                    if not isinstance(artifact, dict):
                        continue
                    text = self._extract_artifact_text(artifact)
                    if text:
                        yield {
                            "type": "output_chunk",
                            "content": text,
                            "artifact_id": artifact.get("artifactId") or artifact.get("id") or "",
                            "is_final": True,
                        }
        finally:
            await client.close()

    # --------------------------------------------------------------- ws mode

    async def _execute_ws(
        self,
        runtime: CodexTaskRuntime,
        config: A2AAgentConfig,
        prompt: str,
        context_parts: list,
    ) -> AsyncGenerator[dict, None]:
        """Daemon WebSocket 推模式执行：通过 DaemonRegistry 下发任务并回流事件。"""

        from backend.services.daemon_registry import daemon_registry

        daemon_session_id = str(getattr(config, "daemon_session_id", "") or "")
        # 任务事件桥接以 task_id 为键，优先使用 runtime.task_id
        task_id = str(getattr(runtime, "task_id", "") or getattr(runtime, "session_id", "") or "")

        logger.info(
            "[A2AAdapter] execute(ws) agent_id=%s daemon=%s task_id=%s",
            config.agent_id,
            daemon_session_id[:8] if daemon_session_id else "",
            task_id,
        )

        queue = await daemon_registry.dispatch_task(
            daemon_id=daemon_session_id,
            task_id=task_id,
            payload={
                "prompt": prompt,
                "context_parts": context_parts,
                "context_id": str(getattr(runtime, "conversation_id", "") or ""),
                "cwd": str(getattr(runtime, "cwd", "") or ""),
                "model": str(getattr(runtime, "model", "") or ""),
            },
        )
        if not queue:
            # Daemon 不在线，快速失败
            yield {"type": "failed", "error": f"Daemon {daemon_session_id} is not online"}
            return

        try:
            while True:
                if getattr(runtime, "cancel_requested", False) or getattr(runtime, "stop_requested", False):
                    await daemon_registry.cancel_task(daemon_session_id, task_id)
                    yield {"type": "failed", "error": "canceled by user"}
                    return

                try:
                    event = await asyncio.wait_for(queue.get(), timeout=3600)
                except asyncio.TimeoutError:
                    yield {"type": "failed", "error": "daemon task timeout"}
                    return

                if not isinstance(event, dict):
                    continue

                # task_result 为终态信号
                if event.get("type") == "task_result":
                    state = str(event.get("state", "") or "")
                    if state == "failed":
                        yield {"type": "failed", "error": str(event.get("error", "") or "")}
                    else:
                        # 从 artifacts 提取文本结果（Bridge 发送 artifacts 而非 result 字段）
                        result_text = str(event.get("result", "") or "")
                        if not result_text:
                            artifacts = event.get("artifacts") or []
                            parts_texts = []
                            for art in artifacts:
                                if not isinstance(art, dict):
                                    continue
                                for part in (art.get("parts") or []):
                                    # A2A 协议 part 使用 "kind": "text"，旧格式使用 "type": "text"，
                                    # 同时兼容两种字段以防 Bridge/内部事件格式不一致
                                    if isinstance(part, dict) and (part.get("kind") == "text" or part.get("type") == "text"):
                                        t = (part.get("text") or "").strip()
                                        if t:
                                            parts_texts.append(t)
                            result_text = "\n".join(parts_texts)
                        yield {"type": "completed", "result": result_text}
                    break

                # task_event：Bridge 通过 WS 直接推送的流式事件（kind=artifact/output/status）
                # 该格式不被 _map_to_internal_event 识别，需要在此直接处理，否则会被静默丢弃
                if event.get("type") == "task_event":
                    kind = str(event.get("kind", "") or "")
                    content = str(event.get("content", "") or "")
                    if kind == "artifact":
                        # content 为空时，尝试从嵌套的 payload/artifacts 中提取
                        # artifacts[].parts[].text（与 task_result 提取逻辑保持一致）
                        if not content:
                            nested = event.get("payload") or event
                            artifacts = nested.get("artifacts") if isinstance(nested, dict) else None
                            if not artifacts:
                                artifacts = event.get("artifacts") or []
                            parts_texts = []
                            for art in (artifacts or []):
                                if not isinstance(art, dict):
                                    continue
                                for part in (art.get("parts") or []):
                                    if isinstance(part, dict) and (part.get("kind") == "text" or part.get("type") == "text"):
                                        t = (part.get("text") or "").strip()
                                        if t:
                                            parts_texts.append(t)
                            content = "\n".join(parts_texts)
                        if content:
                            yield {"type": "output_chunk", "content": content}
                    elif kind == "output" and content:
                        # "output" 表示实际输出内容，应作为流式内容而非状态
                        yield {"type": "output_chunk", "content": content}
                    elif kind == "status" and content:
                        yield {"type": "status_changed", "status": content}
                    # 空事件跳过
                    continue

                # 其他事件：映射内部承载的 A2A 事件为 Tide 内部事件
                a2a_event = event.get("event") or event.get("payload") or event
                mapped = self._map_to_internal_event(a2a_event)
                if mapped:
                    yield mapped
        finally:
            await daemon_registry.unregister_task(task_id)

    # ------------------------------------------------------------------ map

    def _map_to_internal_event(self, a2a_event: dict) -> dict:
        """将 A2A 流式事件映射为 Tide 内部事件格式。"""

        if not isinstance(a2a_event, dict):
            return {"type": "unknown", "raw": a2a_event}

        event_type = a2a_event.get("type")

        if event_type == "task":
            status = a2a_event.get("status") or {}
            state = (
                (status.get("state") if isinstance(status, dict) else None)
                or a2a_event.get("state")
                or "submitted"
            )
            return {"type": "status_changed", "status": str(state)}

        if event_type == "statusUpdate":
            status = a2a_event.get("status") or {}
            state = (
                (status.get("state") if isinstance(status, dict) else None)
                or a2a_event.get("state")
                or ""
            )
            state = str(state)

            if state == "input_required":
                message_obj = (
                    (status.get("message") if isinstance(status, dict) else None)
                    or a2a_event.get("message")
                    or {}
                )
                return {
                    "type": "approval_request",
                    "message": self._extract_text(message_obj) if isinstance(message_obj, dict) else str(message_obj),
                }
            if state == "completed":
                return {"type": "completed", "result": ""}
            if state == "failed":
                error = a2a_event.get("error")
                if not error and isinstance(status, dict):
                    msg = status.get("message")
                    error = self._extract_text(msg) if isinstance(msg, dict) else (msg or "")
                return {"type": "failed", "error": str(error or "")}
            return {"type": "status_changed", "status": state}

        if event_type == "artifactUpdate":
            artifact = a2a_event.get("artifact") or {}
            if not isinstance(artifact, dict):
                artifact = {}
            return {
                "type": "output_chunk",
                "content": self._extract_artifact_text(artifact),
                "artifact_id": artifact.get("artifactId") or artifact.get("id") or "",
                "is_final": bool(
                    a2a_event.get("lastChunk")
                    or a2a_event.get("is_final")
                    or a2a_event.get("final")
                ),
            }

        if event_type == "message":
            return {
                "type": "output_chunk",
                "content": self._extract_text(a2a_event),
            }

        return {"type": "unknown", "raw": a2a_event}

    def _map_task_to_event(self, task: A2ATask, state: str) -> dict:
        """将轮询获得的 A2ATask 对象映射为事件 dict。"""

        state = str(state or task.state or "")
        if state == "completed":
            text_chunks: list[str] = []
            for artifact in task.artifacts or []:
                if not isinstance(artifact, dict):
                    continue
                text = self._extract_artifact_text(artifact)
                if text:
                    text_chunks.append(text)
            return {"type": "completed", "result": "\n".join(text_chunks)}
        if state == "failed":
            error = (task.metadata or {}).get("error") if isinstance(task.metadata, dict) else ""
            return {"type": "failed", "error": str(error or "")}
        if state == "input_required":
            return {"type": "approval_request", "message": ""}
        return {"type": "status_changed", "status": state}

    # -------------------------------------------------------- context parts

    def _build_context_parts(self, runtime: CodexTaskRuntime) -> list:
        """构建传递给远程 Agent 的上下文 Parts。"""

        parts: list[dict[str, Any]] = []

        prev_output = getattr(runtime, "prev_output", None)
        workflow_context = getattr(runtime, "workflow_context", None)
        if prev_output:
            parts.append({
                "kind": "data",
                "data": prev_output if isinstance(prev_output, (dict, list)) else {"text": str(prev_output)},
            })
        if workflow_context:
            parts.append({
                "kind": "data",
                "data": workflow_context if isinstance(workflow_context, (dict, list)) else {"text": str(workflow_context)},
            })

        cwd = getattr(runtime, "cwd", None)
        if cwd:
            parts.append({"kind": "text", "text": f"cwd: {cwd}"})

        return parts

    # -------------------------------------------------------------- helpers

    def _extract_text(self, message: dict) -> str:
        """从 A2A Message 对象中提取文本内容。"""

        if not isinstance(message, dict):
            return ""
        parts = message.get("parts") or []
        if not isinstance(parts, list):
            return ""
        chunks: list[str] = []
        for part in parts:
            if not isinstance(part, dict):
                continue
            text = part.get("text")
            if text:
                chunks.append(str(text))
        return "\n".join(chunks).strip()

    def _extract_artifact_text(self, artifact: dict) -> str:
        """从 Artifact 中提取文本/数据内容。"""

        if not isinstance(artifact, dict):
            return ""
        parts = artifact.get("parts") or []
        if not isinstance(parts, list):
            return ""
        chunks: list[str] = []
        for part in parts:
            if not isinstance(part, dict):
                continue
            kind = part.get("kind") or part.get("type") or ""
            if kind == "text" or part.get("text"):
                text = part.get("text")
                if text:
                    chunks.append(str(text))
                    continue
            if kind == "data" or part.get("data") is not None:
                data = part.get("data")
                try:
                    chunks.append(json.dumps(data, ensure_ascii=False))
                except (TypeError, ValueError):
                    chunks.append(str(data))
        return "\n".join(chunks).strip()
