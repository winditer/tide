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
import base64
import json
import logging
import random
import re
import shutil
import uuid
from pathlib import Path
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

    Returns:
        解析出的 dict 列表，或 None（无法解析时）。
        绝不抛出异常——所有异常内部捕获并记录日志后返回 None。
    """
    if not text:
        return None
    if not isinstance(text, str):
        try:
            text = str(text)
        except Exception:
            return None
    try:
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
            except (json.JSONDecodeError, TypeError, ValueError) as exc:
                # 处理多个 JSON 数组拼接的情况（Extra data）
                if isinstance(exc, json.JSONDecodeError) and "Extra data" in str(exc):
                    try:
                        merged = _try_merge_multiple_arrays(raw)
                        if merged is not None:
                            return merged
                    except Exception as merge_exc:
                        logger.debug("[ai_decompose] merge arrays 失败: %s", merge_exc)
                continue
            if isinstance(parsed, list):
                return parsed
            if isinstance(parsed, dict):
                for key in ("items", "work_items", "tasks", "result", "data"):
                    value = parsed.get(key)
                    if isinstance(value, list):
                        return value
        return None
    except Exception as exc:
        logger.warning("[ai_decompose] _extract_json_array 异常: %s", exc, exc_info=True)
        # 不再抛出异常——返回 None 让调用方走"解析为空"的分支
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
    """将 LLM 返回的单条数据规范化为标准工作项 dict。

    确保返回的所有字段值都是 JSON 可序列化的基本类型。
    """
    if not isinstance(raw, dict):
        return None

    # title: 确保是字符串
    title_raw = raw.get("title") or raw.get("name") or ""
    if not isinstance(title_raw, str):
        title_raw = str(title_raw)
    title = title_raw.strip()
    if not title:
        return None

    # description: 确保是字符串
    description = raw.get("description") or raw.get("desc") or ""
    if not isinstance(description, str):
        description = str(description)
    description = description.strip()

    # priority: 确保是 0-4 整数
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

    # tags: 确保是 list[str]，每个元素强制转为字符串
    tags_raw = raw.get("tags") or raw.get("labels") or []
    if isinstance(tags_raw, str):
        tags = [t.strip() for t in re.split(r"[,;\s]+", tags_raw) if t.strip()]
    elif isinstance(tags_raw, list):
        tags = [str(t).strip() for t in tags_raw if t is not None and str(t).strip()]
    else:
        # 非预期类型，尝试转字符串后分割
        try:
            tags = [str(tags_raw).strip()] if str(tags_raw).strip() else []
        except Exception:
            tags = []

    return {
        "title": str(title)[:200],
        "description": str(description),
        "priority": int(priority),
        "tags": [str(t) for t in tags[:8]],
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
    knowledge_summary: Optional[str] = None,
) -> str:
    """构建用户侧 prompt 内容。"""
    parts: list[str] = []
    if project_id:
        parts.append(f"## 项目上下文\nproject_id: {project_id}")
        if knowledge_summary:
            parts.append(f"## 项目模块结构\n{knowledge_summary}")

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

        Raises:
            ValueError: 输入参数不合法（对应 HTTP 400）。
            RuntimeError: LLM 调用或解析失败（对应 HTTP 502）。
        """
        has_input = bool((text and text.strip()) or links or file_contents)
        if not has_input:
            raise ValueError("缺少输入：text / links / file_contents 至少需要其一")

        try:
            # 获取项目知识库摘要（可选，异常时降级为空）
            knowledge_summary = ""
            if project_id:
                try:
                    from backend.services.knowledge_service import knowledge_service
                    decoded_cwd = base64.urlsafe_b64decode(project_id + "==").decode()
                    if decoded_cwd and Path(decoded_cwd).is_dir():
                        knowledge_summary = await knowledge_service.get_project_modules_summary(decoded_cwd)
                except Exception as exc:
                    logger.debug("[ai_decompose] 加载知识库摘要失败: %s", exc)

            user_prompt = _build_user_prompt(text, links, file_contents, project_id, knowledge_summary)
            full_prompt = f"{SYSTEM_PROMPT}\n\n---\n\n{user_prompt}"

            logger.info(
                "[ai_decompose] prompt_chars=%d",
                len(full_prompt),
            )

            try:
                raw_response = await self._call_agent_cli(full_prompt, agent_id=agent_id, project_id=project_id)
            except RuntimeError:
                raise
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

            # 返回前验证：确保所有值都是 JSON 可序列化的标准类型
            safe_items: list[dict[str, Any]] = []
            for item in items:
                if isinstance(item, dict):
                    safe_items.append(item)
                else:
                    logger.debug("[ai_decompose] 跳过非 dict 项: %r", type(item))

            safe_raw = str(raw_response) if raw_response else ""

            return {"items": safe_items, "raw_analysis": safe_raw}

        except ValueError:
            raise  # 保持 400
        except RuntimeError:
            raise  # 保持 502
        except Exception as exc:
            logger.exception("[ai_decompose] 未预期异常")
            raise RuntimeError(f"AI 分解内部错误：{type(exc).__name__}: {exc}") from exc

    def _get_available_agent_ids(self) -> list[str]:
        """获取本地已安装的可用 Agent CLI 列表。

        遍历 AGENT_ADAPTERS，通过 shutil.which 检测 CLI 二进制是否在 PATH 中。
        """
        from backend.runtime.adapters import AGENT_ADAPTERS

        available: list[str] = []
        for aid, adapter in AGENT_ADAPTERS.items():
            if adapter.bin_name and shutil.which(adapter.bin_name):
                available.append(aid)
        return available

    async def _call_agent_cli(self, prompt: str, agent_id: Optional[str] = None, project_id: Optional[str] = None) -> str:
        """通过 AgentExecutor 调用 Agent CLI 获取 LLM 响应。

        使用与 knowledge_service 相同的模式：full_auto=True 以跳过审批流程。
        当提供 project_id 时，查询数据库获取项目实际路径作为 CWD。

        Agent 选择策略：
        - 若调用方指定了 agent_id，直接使用；
        - 否则从本地已安装的 Agent CLI 中随机选一个；
        - fallback 到 DEFAULT_AGENT_ID。
        不指定 model，由 Agent CLI 自身配置决定使用的模型。
        """
        from backend.runtime.config import DEFAULT_AGENT_ID, DEFAULT_CWD
        from backend.runtime.executor import AgentExecutor

        # Agent 选择：优先使用调用方指定的，否则随机选一个可用的
        agent_id = (agent_id or "").strip()
        if not agent_id:
            available_agents = self._get_available_agent_ids()
            if available_agents:
                agent_id = random.choice(available_agents)
                logger.info("[ai_decompose] 随机选择 Agent CLI: %s (可用列表: %s)", agent_id, available_agents)
            else:
                agent_id = DEFAULT_AGENT_ID
                logger.info("[ai_decompose] 无可用 Agent CLI，fallback 到: %s", agent_id)

        # 计算 CWD：优先使用 project_id 对应的项目路径
        cwd = str(DEFAULT_CWD)
        if project_id:
            try:
                s = project_id
                pad = "=" * (-len(s) % 4)
                decoded_path = base64.urlsafe_b64decode((s + pad).encode()).decode("utf-8")
                if decoded_path and Path(decoded_path).is_dir():
                    cwd = decoded_path
                    logger.debug("[ai_decompose] 使用项目路径: %s", cwd)
                else:
                    logger.warning("[ai_decompose] 项目路径不存在: %s, fallback 到 DEFAULT_CWD", decoded_path)
            except Exception as exc:
                logger.warning("[ai_decompose] 解码 project_id 失败，fallback 到 DEFAULT_CWD: %s", exc)

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
                    model=None,  # 不传模型参数，由 CLI 自身配置决定
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

        result = "\n".join(str(p) for p in output_parts if p)

        # 检查是否有有效输出
        if not result or not result.strip():
            raise RuntimeError("Agent 未返回有效输出（可能被中断或超时）")

        # 检查是否只是 auto-recovery 消息（任务被服务器重启中断）
        if "[auto-recovery]" in result and len(result.strip()) < 200:
            raise RuntimeError(f"Agent 任务被中断：{result.strip()}")

        return result


# 单例
ai_decompose_service = AIDecomposeService()
