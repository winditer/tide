"""AI 需求分解服务。

基于 LLM 将自然语言需求 / 上传文件 / 链接拆解为结构化工作项列表。

设计要点：
- 通过 ``AgentExecutor`` 调用项目已配置的 Agent CLI（Codex / Claude /
  Qoder），复用统一的认证与代理链路，与其他 AI 功能保持一致。
- 返回结构 ``[{title, description, priority, tags}]``，priority 范围 0-4。
- 解析健壮：纯 JSON、Markdown 代码块、含解释文本三种格式均可还原。
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from typing import Any, Optional

logger = logging.getLogger("tide.ai_decompose")


# Agent CLI 执行超时（秒）— 分解操作通常返回较短 JSON，120s 足够。
AGENT_TIMEOUT = 120

# 单文件 / 单链接片段最大字符长度，避免 prompt 过长被截断。
MAX_FILE_CHARS = 20000
MAX_TOTAL_CONTEXT_CHARS = 60000

SYSTEM_PROMPT = (
    "你是资深的项目经理与技术负责人。你的任务是把用户的需求描述（可能附带"
    "参考文件与链接）拆解成一组可直接交付的工作项（work items）。\n\n"
    "拆解要求：\n"
    "1. 每个工作项粒度适中，约 1-3 天工作量；过大需进一步拆分，过小需合并。\n"
    "2. title 简短清晰（10-30 个字符），用动宾结构。\n"
    "3. description 给出可执行的详细说明：目标、范围、关键约束、验收标准；"
    "若涉及多模块则列出步骤。\n"
    "4. priority 取 0-4 整数：0=最低/可选，1=低，2=普通，3=高，4=最高/阻塞。\n"
    "5. tags 给 1-4 个英文/中文短标签，用于分类（如 backend、frontend、bug、infra）。\n"
    "6. 工作项之间应能并行或按依赖顺序串行，避免重复。\n\n"
    "输出格式：仅返回一个 JSON 数组，不要任何解释或 Markdown 代码块包装。"
    "数组元素结构：\n"
    "{\n"
    "  \"title\": string,\n"
    "  \"description\": string,\n"
    "  \"priority\": integer (0-4),\n"
    "  \"tags\": [string]\n"
    "}"
)





def _extract_json_array(text: str) -> Optional[list[dict[str, Any]]]:
    """从 LLM 返回文本中健壮地提取 JSON 数组。

    支持：
    - 纯 JSON 数组
    - 多个 JSON 数组拼接（``[...] \n [...] ``）
    - ``{"items": [...]}`` / ``{"work_items": [...]}`` 等包装对象
    - Markdown 代码块包裹（```json ...```）
    - 前后有解释性文字（如 "Reading additional input from stdin..."）
    """
    if not text:
        return None
    # 去除常见 CLI 噪声前缀
    text = re.sub(r"^Reading additional input from stdin\.{0,3}\n?", "", text.strip()).strip()

    candidates: list[str] = []
    # 1) 直接尝试
    candidates.append(text)
    # 2) ```json ... ``` 代码块
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.IGNORECASE)
    if m:
        candidates.append(m.group(1).strip())
    # 3) 首个 JSON 数组
    arr_match = re.search(r"\[[\s\S]*\]", text)
    if arr_match:
        candidates.append(arr_match.group(0))
    # 4) 首个 JSON 对象（可能是 {"items": [...]}）
    obj_match = re.search(r"\{[\s\S]*\}", text)
    if obj_match:
        candidates.append(obj_match.group(0))

    for raw in candidates:
        try:
            parsed = json.loads(raw)
        except (json.JSONDecodeError, TypeError) as exc:
            # 处理多个 JSON 数组拼接的情况（Extra data）
            if isinstance(exc, json.JSONDecodeError) and "Extra data" in str(exc):
                merged = _try_merge_multiple_arrays(raw)
                if merged is not None:
                    return merged
            continue
        if isinstance(parsed, list):
            return parsed
        if isinstance(parsed, dict):
            for key in ("items", "work_items", "tasks", "result", "data"):
                value = parsed.get(key)
                if isinstance(value, list):
                    return value
    return None


def _try_merge_multiple_arrays(text: str) -> Optional[list[dict[str, Any]]]:
    """尝试解析拼接的多个 JSON 数组并合并为一个列表。"""
    decoder = json.JSONDecoder()
    results: list[Any] = []
    idx = 0
    text = text.strip()
    while idx < len(text):
        # 跳过空白
        while idx < len(text) and text[idx] in ' \t\n\r':
            idx += 1
        if idx >= len(text):
            break
        try:
            obj, end_idx = decoder.raw_decode(text, idx)
            if isinstance(obj, list):
                results.extend(obj)
            elif isinstance(obj, dict):
                results.append(obj)
            idx = end_idx
        except json.JSONDecodeError:
            break
    return results if results else None


def _normalize_item(raw: Any) -> Optional[dict[str, Any]]:
    """将 LLM 返回的单条数据规范化为标准工作项 dict。"""
    if not isinstance(raw, dict):
        return None
    title = (raw.get("title") or raw.get("name") or "").strip()
    if not title:
        return None

    description = raw.get("description") or raw.get("desc") or ""
    if not isinstance(description, str):
        description = str(description)
    description = description.strip()

    priority_raw = raw.get("priority", 2)
    try:
        priority = int(priority_raw)
    except (TypeError, ValueError):
        # 支持 "high" / "low" 这类字符串
        prio_map = {
            "lowest": 0, "low": 1, "normal": 2, "medium": 2,
            "high": 3, "highest": 4, "critical": 4, "blocker": 4,
            "p0": 4, "p1": 3, "p2": 2, "p3": 1, "p4": 0,
        }
        priority = prio_map.get(str(priority_raw).strip().lower(), 2)
    priority = max(0, min(4, priority))

    tags_raw = raw.get("tags") or raw.get("labels") or []
    if isinstance(tags_raw, str):
        tags = [t.strip() for t in re.split(r"[,;\s]+", tags_raw) if t.strip()]
    elif isinstance(tags_raw, list):
        tags = [str(t).strip() for t in tags_raw if str(t).strip()]
    else:
        tags = []

    return {
        "title": title[:200],
        "description": description,
        "priority": priority,
        "tags": tags[:8],
    }


def _truncate(text: str, limit: int) -> str:
    if not text:
        return ""
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n...(truncated, original length={len(text)})"


def _build_user_prompt(
    text: Optional[str],
    links: Optional[list[str]],
    file_contents: Optional[list[dict]],
    project_id: Optional[str],
) -> str:
    """构建用户侧 prompt 内容。"""
    parts: list[str] = []
    if project_id:
        parts.append(f"## 项目上下文\nproject_id: {project_id}")

    if text and text.strip():
        parts.append(f"## 需求描述\n{text.strip()}")

    if links:
        clean_links = [str(u).strip() for u in links if str(u).strip()]
        if clean_links:
            parts.append(
                "## 参考链接（请结合链接含义但无需访问网络）\n"
                + "\n".join(f"- {u}" for u in clean_links)
            )

    if file_contents:
        file_blocks: list[str] = []
        remaining = MAX_TOTAL_CONTEXT_CHARS
        for f in file_contents:
            if remaining <= 0:
                file_blocks.append("（剩余文件因长度超限被省略）")
                break
            name = str(f.get("name") or f.get("filename") or "attachment").strip()
            content = f.get("content") or ""
            if not isinstance(content, str):
                content = str(content)
            slice_len = min(MAX_FILE_CHARS, remaining)
            snippet = _truncate(content, slice_len)
            remaining -= len(snippet)
            file_blocks.append(
                f"### 文件: {name}\n```\n{snippet}\n```"
            )
        if file_blocks:
            parts.append("## 参考文件内容\n" + "\n\n".join(file_blocks))

    parts.append(
        "## 任务\n请基于以上信息输出工作项 JSON 数组，严格遵循系统指令的字段规范。"
        "若信息不足，请基于合理假设给出可执行的初版拆解。"
    )
    return "\n\n".join(parts)


class AIDecomposeService:
    """AI 需求分解服务。"""

    def __init__(self) -> None:
        pass

    async def decompose(
        self,
        text: Optional[str] = None,
        links: Optional[list[str]] = None,
        file_contents: Optional[list[dict]] = None,
        project_id: Optional[str] = None,
        agent_id: Optional[str] = None,
    ) -> dict[str, Any]:
        """将需求信息拆解为工作项列表。

        返回 ``{"items": list[dict], "raw_analysis": str}``，其中 items
        每条为 ``{title, description, priority(0-4), tags[list]}``。
        """
        has_input = bool((text and text.strip()) or links or file_contents)
        if not has_input:
            raise ValueError("缺少输入：text / links / file_contents 至少需要其一")

        user_prompt = _build_user_prompt(text, links, file_contents, project_id)
        full_prompt = f"{SYSTEM_PROMPT}\n\n---\n\n{user_prompt}"

        logger.info(
            "[ai_decompose] prompt_chars=%d",
            len(full_prompt),
        )

        try:
            raw_response = await self._call_agent_cli(full_prompt, agent_id=agent_id)
        except Exception as exc:
            logger.exception("[ai_decompose] Agent CLI 调用失败")
            raise RuntimeError(f"AI 分解调用失败：{exc}") from exc

        parsed = _extract_json_array(raw_response)
        items: list[dict[str, Any]] = []
        seen_titles: set[str] = set()
        if parsed:
            for entry in parsed:
                normalized = _normalize_item(entry)
                if normalized:
                    # 按 title 去重（多 CLI 输出合并可能产生重复项）
                    title_key = normalized["title"].strip().lower()
                    if title_key not in seen_titles:
                        seen_titles.add(title_key)
                        items.append(normalized)

        if not items:
            logger.warning(
                "[ai_decompose] 解析 LLM 输出为空，raw 前 500 字符=%r",
                raw_response[:500] if raw_response else "",
            )

        return {"items": items, "raw_analysis": raw_response or ""}

    async def _call_agent_cli(self, prompt: str, agent_id: Optional[str] = None) -> str:
        """通过 AgentExecutor 调用 Agent CLI 获取 LLM 响应。

        使用与 knowledge_service 相同的模式：full_auto=True 以跳过审批流程。
        """
        from backend.runtime.config import DEFAULT_AGENT_ID, DEFAULT_CWD
        from backend.runtime.executor import AgentExecutor

        agent_id = (agent_id or "").strip() or DEFAULT_AGENT_ID
        cwd = str(DEFAULT_CWD)
        task_id = f"ai-decompose-{uuid.uuid4().hex[:8]}"

        logger.info(
            "[ai_decompose] agent_id=%s cwd=%s task_id=%s",
            agent_id, cwd, task_id,
        )

        executor = AgentExecutor()
        output_parts: list[str] = []

        try:
            async with asyncio.timeout(AGENT_TIMEOUT):
                async for event in executor.run_task(
                    task_id=task_id,
                    agent_id=agent_id,
                    prompt=prompt,
                    cwd=cwd,
                    full_auto=True,
                ):
                    if event.type == "output":
                        output_parts.append(event.content)
                    elif event.type == "completed":
                        if event.content:
                            output_parts.append(event.content)
                    elif event.type == "failed":
                        raise RuntimeError(
                            f"Agent 执行失败：{event.content or 'unknown error'}"
                        )
        except asyncio.TimeoutError:
            # 超时时尝试取消进程
            await executor.cancel_task(task_id)
            raise RuntimeError(
                f"Agent CLI 执行超时（{AGENT_TIMEOUT}s），请稍后重试"
            )

        result = "\n".join(p for p in output_parts if p)
        if not result:
            raise RuntimeError("Agent CLI 未返回任何输出")
        return result


# 单例
ai_decompose_service = AIDecomposeService()
