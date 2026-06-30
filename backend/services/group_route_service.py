"""智能路由决策服务 — 分析工作项需求与项目组内各子项目的相关度"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import tempfile
from dataclasses import dataclass
from typing import Dict, List, Optional

logger = logging.getLogger("tide.group_route")

# Agent CLI 执行超时（秒）— 从环境变量读取，默认 30s
SMART_ROUTING_TIMEOUT = int(os.getenv("WORKITEM_SMART_ROUTING_TIMEOUT", "30"))


@dataclass
class RoutingResult:
    """路由决策结果"""

    recommended_project_ids: List[str]
    confidence: float  # 0.0 - 1.0
    reasoning: str


ROUTING_SYSTEM_PROMPT = """你是项目架构师。根据需求描述和各项目的模块职责摘要，判断哪些项目需要修改代码。

## 输出要求
返回 JSON（无额外文本）：
{"projects": ["project_id_1", ...], "confidence": 0.0-1.0, "reasoning": "简要说明"}

仅返回确实需要修改代码的项目。如果无法判断，confidence 设为 0。"""


class GroupRouteService:
    """工作项智能路由服务"""

    async def analyze_routing(
        self,
        work_item: dict,  # {title, description}
        projects: List[dict],  # [{project_id, name, cwd, role}]
        knowledge_summaries: Dict[str, str],  # {project_id: summary_text}
    ) -> Optional[RoutingResult]:
        """
        分析工作项需求与各项目的相关度。

        返回 RoutingResult 或 None（触发 fallback）。
        所有异常内部捕获，不向外抛出。
        """
        if not projects:
            return None

        user_prompt = self._build_user_prompt(work_item, projects, knowledge_summaries)
        full_prompt = f"{ROUTING_SYSTEM_PROMPT}\n\n---\n\n{user_prompt}"

        logger.info(
            "[group_route] analyze_routing prompt_chars=%d projects=%d",
            len(full_prompt),
            len(projects),
        )

        try:
            raw_response = await self._call_agent_cli(full_prompt)
        except Exception as exc:
            logger.warning("[group_route] Agent CLI 调用失败: %s", exc)
            return None

        if not raw_response:
            logger.warning("[group_route] Agent CLI 未返回内容")
            return None

        valid_project_ids = {p["project_id"] for p in projects if p.get("project_id")}
        result = self._parse_routing_response(raw_response, valid_project_ids)

        if result:
            logger.info(
                "[group_route] routing result: projects=%s confidence=%.2f",
                result.recommended_project_ids,
                result.confidence,
            )
        else:
            logger.warning(
                "[group_route] 解析路由结果失败, raw前200字符=%r",
                raw_response[:200],
            )

        return result

    def _build_user_prompt(
        self,
        work_item: dict,
        projects: List[dict],
        knowledge_summaries: Dict[str, str],
    ) -> str:
        """构建用户 prompt"""
        parts: List[str] = []

        # 工作项信息
        title = work_item.get("title", "").strip()
        description = work_item.get("description", "").strip()
        parts.append(f"## 工作项需求\n标题：{title}\n描述：{description or '（无详细描述）'}")

        # 项目列表及知识图谱摘要
        project_sections: List[str] = []
        for p in projects:
            pid = p.get("project_id", "")
            name = p.get("name", "")
            role = p.get("role", "")
            summary = knowledge_summaries.get(pid, "").strip()

            section = f"### 项目: {name} (id: {pid})"
            if role:
                section += f"\n职责: {role}"
            if summary:
                # 截断过长摘要，避免 prompt 过长
                if len(summary) > 2000:
                    summary = summary[:2000] + "...(truncated)"
                section += f"\n模块摘要:\n{summary}"
            else:
                section += "\n模块摘要: （无可用知识图谱摘要）"
            project_sections.append(section)

        parts.append("## 项目组内子项目\n" + "\n\n".join(project_sections))

        parts.append(
            "## 任务\n请分析上述工作项需求应该由哪些项目承接，返回 JSON 结果。"
        )
        return "\n\n".join(parts)

    def _parse_routing_response(
        self, output: str, valid_project_ids: set
    ) -> Optional[RoutingResult]:
        """从 LLM 输出中解析路由决策 JSON"""
        if not output:
            return None

        # 去除常见 CLI 噪声前缀
        text = re.sub(
            r"^Reading additional input from stdin\.{0,3}\n?", "", output.strip()
        ).strip()

        # 尝试多种方式提取 JSON 对象
        candidates: List[str] = []
        candidates.append(text)

        # ```json ... ``` 代码块
        m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.IGNORECASE)
        if m:
            candidates.append(m.group(1).strip())

        # 首个 JSON 对象
        obj_match = re.search(r"\{[\s\S]*\}", text)
        if obj_match:
            candidates.append(obj_match.group(0))

        parsed: Optional[dict] = None
        for raw in candidates:
            try:
                result = json.loads(raw)
                if isinstance(result, dict):
                    parsed = result
                    break
            except (json.JSONDecodeError, TypeError):
                continue

        if not parsed:
            return None

        # 提取字段
        raw_projects = parsed.get("projects") or parsed.get("project_ids") or []
        if not isinstance(raw_projects, list):
            raw_projects = []

        # 过滤无效 project_id
        recommended = [
            str(pid) for pid in raw_projects if str(pid) in valid_project_ids
        ]

        # 解析 confidence
        try:
            confidence = float(parsed.get("confidence", 0))
        except (TypeError, ValueError):
            confidence = 0.0
        confidence = max(0.0, min(1.0, confidence))

        reasoning = str(parsed.get("reasoning") or parsed.get("reason") or "")

        # 如果没有推荐的项目且 confidence 为 0，视为无法判断
        if not recommended and confidence == 0:
            return None

        return RoutingResult(
            recommended_project_ids=recommended,
            confidence=confidence,
            reasoning=reasoning,
        )

    async def _call_agent_cli(self, prompt: str) -> str:
        """直接通过 subprocess 调用 Agent CLI 获取 LLM 响应。

        使用临时会话目录隔离 CLI 产生的 session 文件，避免被 session_discovery
        扫描到从而在 UI 上生成可见的任务记录。
        """
        from backend.runtime.config import (
            CODEX_BIN, CODEX_MODEL,
            CLAUDE_BIN, CLAUDE_MODEL,
            QODER_BIN, QODER_MODEL,
            DEFAULT_AGENT_ID, DEFAULT_CWD,
        )

        agent_id = DEFAULT_AGENT_ID
        cwd = str(DEFAULT_CWD)

        # 构建 CLI 命令（full_auto 模式）
        if agent_id == "claude":
            cmd = [CLAUDE_BIN, "--print", "--output-format", "stream-json",
                   "--verbose", "--permission-mode", "bypassPermissions"]
            if CLAUDE_MODEL:
                cmd.extend(["--model", CLAUDE_MODEL])
            cmd.append(prompt)
        elif agent_id == "qoder":
            cmd = [QODER_BIN, "--print", "--output-format", "stream-json",
                   "--cwd", cwd, "--permission-mode", "bypass_permissions"]
            if QODER_MODEL:
                cmd.extend(["--model", QODER_MODEL])
            cmd.append(prompt)
        else:
            # codex (default)
            cmd = [CODEX_BIN]
            if CODEX_MODEL:
                cmd.extend(["-m", CODEX_MODEL])
            cmd.extend(["-a", "never", "-s", "danger-full-access"])
            cmd.extend(["exec", "--json", "--skip-git-repo-check", "-C", cwd])
            cmd.append(prompt)

        # 检查 CLI binary 是否可用
        bin_name = cmd[0]
        if not shutil.which(bin_name):
            raise RuntimeError(f"Agent CLI not found: {bin_name}")

        logger.info("[group_route] agent_id=%s cwd=%s cmd[0]=%s", agent_id, cwd, bin_name)

        # 使用临时目录作为 CLI home，防止 session 文件污染真实会话目录
        tmp_home = tempfile.mkdtemp(prefix="tide-route-")
        try:
            env = os.environ.copy()
            env["CODEX_HOME"] = tmp_home
            env["CLAUDE_HOME"] = tmp_home
            env["QODER_HOME"] = tmp_home

            proc = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=cwd,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                env=env,
                limit=4 * 1024 * 1024,
            )

            try:
                stdout_bytes, _ = await asyncio.wait_for(
                    proc.communicate(), timeout=SMART_ROUTING_TIMEOUT
                )
            except asyncio.TimeoutError:
                try:
                    proc.terminate()
                    await asyncio.wait_for(proc.wait(), timeout=5)
                except (ProcessLookupError, asyncio.TimeoutError):
                    try:
                        proc.kill()
                    except ProcessLookupError:
                        pass
                raise RuntimeError(
                    f"智能路由 Agent CLI 执行超时（{SMART_ROUTING_TIMEOUT}s）"
                )

            raw_output = stdout_bytes.decode("utf-8", errors="replace") if stdout_bytes else ""
        finally:
            # 清理临时目录
            shutil.rmtree(tmp_home, ignore_errors=True)

        if proc.returncode != 0:
            logger.warning(
                "[group_route] CLI exited with code %d, output[:200]=%r",
                proc.returncode, raw_output[:200],
            )

        # 从 JSON stream 或纯文本中提取有效内容
        result = self._extract_output(raw_output, agent_id)
        if not result:
            raise RuntimeError("Agent CLI 未返回任何输出")
        return result

    def _extract_output(self, raw: str, agent_id: str) -> str:
        """从 CLI stdout 提取有效文本内容。

        Codex (--json): 逐行 JSON 事件，提取 message/text 类型的 content。
        Claude/Qoder (stream-json): 逐行 JSON 事件，提取 assistant message content。
        Fallback: 返回原始文本。
        """
        if not raw:
            return ""
        parts: List[str] = []
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except (json.JSONDecodeError, ValueError):
                # 非 JSON 行，可能是纯文本输出或噪声
                if not line.startswith("Reading additional input"):
                    parts.append(line)
                continue
            if not isinstance(obj, dict):
                continue
            # Codex JSON events
            etype = obj.get("type", "")
            if etype == "message" and obj.get("role") == "assistant":
                content = obj.get("content")
                if isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict) and block.get("type") == "output_text":
                            text = block.get("text", "")
                            if text:
                                parts.append(text)
                elif isinstance(content, str) and content:
                    parts.append(content)
            # Claude/Qoder stream-json events
            elif etype == "assistant" or etype == "result":
                content = obj.get("content") or obj.get("result") or ""
                if isinstance(content, str) and content:
                    parts.append(content)
                elif isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict) and block.get("type") == "text":
                            text = block.get("text", "")
                            if text:
                                parts.append(text)
        return "\n".join(p for p in parts if p)


# 单例
group_route_service = GroupRouteService()
