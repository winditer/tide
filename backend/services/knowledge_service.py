"""知识图谱服务。

职责：
- 解析 ``project`` / ``group`` scope 到具体的仓库根目录（cwd）。
- 维护各仓库 ``.knowledge/`` 目录下的 Markdown / JSON 产物（列表、读取、写入、删除）。
- 提供异步触发 ``scripts/gen_knowledge_graph.py`` 的能力，任务状态保存在进程内存。

仅依赖标准库 + 现有 ``project_group_service``。
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import logging
import os
import shutil
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.services.project_group_service import project_group_service

try:
    from scripts.code_collector import detect_languages, build_repo_context
    _COLLECTOR_AVAILABLE = True
except ImportError:
    _COLLECTOR_AVAILABLE = False

try:
    from scripts.llm_analyzer import (
        SYSTEM_PROMPT,
        MODULE_ANALYSIS_PROMPT,
        API_ANALYSIS_PROMPT,
        SCHEMA_ANALYSIS_PROMPT,
        CONCEPT_ANALYSIS_PROMPT,
        ARCHITECTURE_ANALYSIS_PROMPT,
        TECH_STACK_ANALYSIS_PROMPT,
        CODING_STYLE_ANALYSIS_PROMPT,
        DATA_FLOW_ANALYSIS_PROMPT,
        TEST_COVERAGE_ANALYSIS_PROMPT,
        EVENT_BUS_ANALYSIS_PROMPT,
    )
    _PROMPTS_AVAILABLE = True
except ImportError:
    _PROMPTS_AVAILABLE = False

logger = logging.getLogger("tide.knowledge_service")


# 仓库内存放知识图谱的目录名（相对仓库根）
KNOWLEDGE_DIR_NAME = ".knowledge"

# 生成脚本（相对 repo root 的相对路径，但脚本位于本 monorepo 根）
_REPO_ROOT = Path(__file__).resolve().parents[2]
_GEN_SCRIPT = _REPO_ROOT / "scripts" / "gen_knowledge_graph.py"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _decode_project_id(project_id: str) -> Optional[str]:
    """解码 ``project_id``（base64 编码的 cwd）为绝对路径。失败返回 None。"""
    if not project_id:
        return None
    s = project_id
    pad = "=" * (-len(s) % 4)
    try:
        decoded = base64.urlsafe_b64decode((s + pad).encode()).decode()
        if decoded and os.path.isabs(decoded):
            return decoded
    except (binascii.Error, UnicodeDecodeError, ValueError):
        pass
    # 兼容裸路径
    if os.path.isabs(s):
        return s
    return None


class KnowledgeService:
    """跨 project / group 的知识图谱文件管理 + 生成任务调度。"""

    def __init__(self) -> None:
        # job_id -> {scope, target_id, status, started_at, finished_at, error, output}
        self._jobs: Dict[str, Dict[str, Any]] = {}
        # 每个 (scope, target_id) 当前活跃 job_id，用于查询最新状态
        self._latest: Dict[str, str] = {}
        self._lock = asyncio.Lock()

    # ── scope 解析 ────────────────────────────────────

    async def resolve_repos(self, scope: str, target_id: str) -> List[Dict[str, str]]:
        """根据 scope 返回需要处理的仓库列表。

        返回元素结构: ``{"project_id": str, "cwd": str, "name": str}``。
        - ``scope == "project"``: 单仓库（target_id 即 project_id）。
        - ``scope == "group"``:   组内所有成员项目。
        """
        if scope == "project":
            cwd = _decode_project_id(target_id)
            if not cwd:
                return []
            return [{"project_id": target_id, "cwd": cwd, "name": Path(cwd).name}]
        if scope == "group":
            members = await project_group_service.get_group_projects(target_id)
            return [
                {
                    "project_id": m["project_id"],
                    "cwd": m["cwd"],
                    "name": m["name"],
                }
                for m in members
                if m.get("cwd") and os.path.isdir(m["cwd"])
            ]
        return []

    # ── 文件 IO ──────────────────────────────────────

    def _knowledge_root(self, cwd: str) -> Path:
        return Path(cwd) / KNOWLEDGE_DIR_NAME

    def get_meta(self, cwd: str) -> Optional[Dict[str, Any]]:
        """读取 ``.knowledge/_meta.json``，返回 dict 或 None。"""
        import json as _json
        meta_path = self._knowledge_root(cwd) / "_meta.json"
        if not meta_path.exists():
            return None
        try:
            return _json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def _safe_resolve(self, root: Path, rel_path: str) -> Path:
        """安全解析 ``rel_path`` 到 ``root`` 之内，拒绝越界访问。"""
        if not rel_path:
            raise ValueError("path is required")
        # 规范化分隔符
        rel = rel_path.replace("\\", "/").lstrip("/")
        candidate = (root / rel).resolve()
        try:
            candidate.relative_to(root.resolve())
        except ValueError as e:
            raise ValueError(f"path escapes knowledge root: {rel_path}") from e
        return candidate

    def list_files(self, cwd: str) -> List[Dict[str, Any]]:
        """列出仓库 ``.knowledge/`` 下的全部文件（递归）。

        返回扁平列表，按 path 排序。
        """
        root = self._knowledge_root(cwd)
        if not root.exists() or not root.is_dir():
            return []
        items: List[Dict[str, Any]] = []
        for p in sorted(root.rglob("*")):
            if p.is_dir():
                continue
            try:
                rel = p.relative_to(root).as_posix()
            except ValueError:
                continue
            try:
                stat = p.stat()
                size = stat.st_size
                mtime = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat().replace("+00:00", "Z")
            except OSError:
                size = 0
                mtime = None
            items.append(
                {
                    "path": rel,
                    "name": p.name,
                    "ext": p.suffix.lstrip("."),
                    "size": size,
                    "modified_at": mtime,
                }
            )
        return items

    def read_file(self, cwd: str, rel_path: str) -> Dict[str, Any]:
        root = self._knowledge_root(cwd)
        if not root.exists():
            raise FileNotFoundError(f".knowledge/ not exists in {cwd}")
        target = self._safe_resolve(root, rel_path)
        if not target.exists() or not target.is_file():
            raise FileNotFoundError(rel_path)
        content = target.read_text(encoding="utf-8")
        try:
            mtime = datetime.fromtimestamp(target.stat().st_mtime, tz=timezone.utc).isoformat().replace("+00:00", "Z")
        except OSError:
            mtime = None
        return {
            "path": rel_path,
            "name": target.name,
            "ext": target.suffix.lstrip("."),
            "content": content,
            "size": len(content.encode("utf-8")),
            "modified_at": mtime,
        }

    def write_file(self, cwd: str, rel_path: str, content: str) -> Dict[str, Any]:
        """写入 / 覆盖 markdown 内容。目录会自动创建。

        约定：仅允许 ``.md`` 文件被前端编辑；其他扩展名拒绝。
        """
        if not rel_path.lower().endswith(".md"):
            raise ValueError("Only .md files can be edited via API")
        root = self._knowledge_root(cwd)
        root.mkdir(parents=True, exist_ok=True)
        target = self._safe_resolve(root, rel_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return self.read_file(cwd, rel_path)

    def delete_file(self, cwd: str, rel_path: str) -> None:
        root = self._knowledge_root(cwd)
        if not root.exists():
            return
        target = self._safe_resolve(root, rel_path)
        if target.is_dir():
            shutil.rmtree(target, ignore_errors=True)
        elif target.exists():
            try:
                target.unlink()
            except OSError as e:
                logger.warning("delete_file failed: %s %s", target, e)

    def export_zip(self, cwd: str) -> bytes:
        """将仓库 ``.knowledge/`` 目录打包为 zip，返回字节内容。"""
        import io
        import zipfile

        root = self._knowledge_root(cwd)
        if not root.exists() or not root.is_dir():
            raise FileNotFoundError(".knowledge/ not exists")

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for p in sorted(root.rglob("*")):
                if p.is_dir():
                    continue
                try:
                    rel = p.relative_to(root).as_posix()
                except ValueError:
                    continue
                zf.write(p, arcname=rel)
        return buf.getvalue()

    # ── 异步生成任务 ────────────────────────────────

    def _job_key(self, scope: str, target_id: str) -> str:
        return f"{scope}:{target_id}"

    def get_status(self, scope: str, target_id: str) -> Optional[Dict[str, Any]]:
        """获取该 scope 最近一次生成任务的状态。"""
        key = self._job_key(scope, target_id)
        job_id = self._latest.get(key)
        if not job_id:
            return None
        job = self._jobs.get(job_id)
        if not job:
            return None
        # 浅拷贝（避免外部修改内部状态）
        return dict(job)

    async def trigger_generate(
        self,
        scope: str,
        target_id: str,
        graph_type: str = "all",
        agent_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """触发异步生成任务。

        同一 (scope, target_id) 若已有任务在 running，则拒绝新触发（返回该任务）。
        """
        if graph_type not in {
            "all", "module", "api", "db", "concept",
            "architecture", "tech-stack", "coding-style",
            "data-flow", "test-coverage", "event-bus",
        }:
            raise ValueError(f"invalid graph_type: {graph_type}")

        repos = await self.resolve_repos(scope, target_id)
        if not repos:
            raise ValueError(f"no repos resolved for scope={scope} target_id={target_id}")

        async with self._lock:
            key = self._job_key(scope, target_id)
            existing_id = self._latest.get(key)
            if existing_id:
                existing = self._jobs.get(existing_id)
                if existing and existing.get("status") in ("pending", "running"):
                    return dict(existing)

            job_id = str(uuid.uuid4())
            job = {
                "job_id": job_id,
                "scope": scope,
                "target_id": target_id,
                "graph_type": graph_type,
                "status": "pending",
                "started_at": _now_iso(),
                "finished_at": None,
                "error": None,
                "repos": [{"project_id": r["project_id"], "cwd": r["cwd"], "name": r["name"]} for r in repos],
                "progress": {"total": len(repos), "done": 0, "current": None},
                "logs": [],
            }
            self._jobs[job_id] = job
            self._latest[key] = job_id

        # 后台执行（不等待）
        asyncio.create_task(self._run_job(job_id, repos, graph_type, agent_id))
        return dict(job)

    async def _run_job(
        self,
        job_id: str,
        repos: List[Dict[str, str]],
        graph_type: str,
        agent_id: Optional[str] = None,
    ) -> None:
        job = self._jobs.get(job_id)
        if not job:
            return
        job["status"] = "running"
        try:
            if agent_id:
                await self._run_agent_job(job_id, repos, graph_type, agent_id)
            else:
                loop = asyncio.get_running_loop()
                for idx, repo in enumerate(repos):
                    cwd = repo["cwd"]
                    name = repo["name"]
                    job["progress"]["current"] = name
                    logger.info("[knowledge] generating job=%s repo=%s (%d/%d)", job_id, name, idx + 1, len(repos))
                    rc, out, err = await loop.run_in_executor(None, _run_gen_script, cwd, graph_type)
                    tail = (out or "")[-2000:] if out else ""
                    err_tail = (err or "")[-2000:] if err else ""
                    job["logs"].append(
                        {
                            "repo": name,
                            "cwd": cwd,
                            "returncode": rc,
                            "stdout_tail": tail,
                            "stderr_tail": err_tail,
                        }
                    )
                    if rc != 0:
                        raise RuntimeError(f"gen_knowledge_graph.py failed for {name}: rc={rc}")
                    job["progress"]["done"] = idx + 1
            job["status"] = "completed"
        except Exception as e:  # noqa: BLE001
            logger.exception("[knowledge] job=%s failed", job_id)
            job["status"] = "failed"
            job["error"] = str(e)
        finally:
            job["finished_at"] = _now_iso()
            job["progress"]["current"] = None

    async def _run_agent_job(
        self,
        job_id: str,
        repos: List[Dict[str, str]],
        graph_type: str,
        agent_id: str,
    ) -> None:
        """Use AgentExecutor to generate knowledge graph via agent."""
        from backend.runtime.executor import AgentExecutor

        if not _COLLECTOR_AVAILABLE:
            raise RuntimeError("code_collector not available (scripts/ import failed)")
        if not _PROMPTS_AVAILABLE:
            raise RuntimeError("llm_analyzer prompts not available (scripts/ import failed)")

        job = self._jobs[job_id]
        executor = AgentExecutor()

        for idx, repo in enumerate(repos):
            cwd = repo["cwd"]
            name = repo["name"]
            job["progress"]["current"] = name
            logger.info(
                "[knowledge] agent generating job=%s repo=%s agent=%s (%d/%d)",
                job_id, name, agent_id, idx + 1, len(repos),
            )

            # 1. Build context (知识图谱分析不需要完整文件内容，降低 token 上限)
            languages = detect_languages(cwd)
            lang_names = [lang for lang, _ in languages[:3]]
            repo_context = build_repo_context(cwd, lang_names, max_tokens=20_000)

            # 2. Build prompt
            prompt = self._build_analysis_prompt(repo_context, graph_type)

            # 3. Run agent
            task_id = f"knowledge-{job_id}-{idx}"
            output_parts: List[str] = []
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
                        f"Agent generation failed for {name}: {event.content}"
                    )

            # 4. Render results from agent-written JSON files
            self._render_agent_results(cwd, graph_type)

            job["logs"].append({
                "repo": name,
                "cwd": cwd,
                "returncode": 0,
                "stdout_tail": "\n".join(output_parts[-3:])[-2000:],
                "stderr_tail": "",
            })
            job["progress"]["done"] = idx + 1

    def _build_analysis_prompt(self, repo_context: str, graph_type: str) -> str:
        """Build analysis prompt for agent based on graph type.

        repo_context 仅在开头放置一次，各分析任务通过引用访问，避免重复嵌入。
        """
        prompts: List[str] = []
        prompts.append(SYSTEM_PROMPT)
        prompts.append("")

        # 仓库上下文只放一次
        prompts.append("## 仓库信息")
        prompts.append(repo_context)
        prompts.append("")
        prompts.append("---")
        prompts.append("")
        prompts.append("请基于以上仓库信息，完成以下分析任务：")
        prompts.append("")

        # 各分析任务的指令（不再嵌入 repo_info）
        graph_info = {
            "module": ("module/module_graph", MODULE_ANALYSIS_PROMPT, "模块依赖"),
            "api": ("api/api_graph", API_ANALYSIS_PROMPT, "API 接口"),
            "db": ("db/schema_graph", SCHEMA_ANALYSIS_PROMPT, "数据库 Schema"),
            "architecture": ("architecture/architecture_graph", ARCHITECTURE_ANALYSIS_PROMPT, "系统架构"),
            "tech-stack": ("tech-stack/tech_stack_graph", TECH_STACK_ANALYSIS_PROMPT, "技术栈"),
            "coding-style": ("coding-style/coding_style_graph", CODING_STYLE_ANALYSIS_PROMPT, "编码风格"),
            "data-flow": ("data-flow/data_flow_graph", DATA_FLOW_ANALYSIS_PROMPT, "数据流"),
            "test-coverage": ("test-coverage/test_coverage_graph", TEST_COVERAGE_ANALYSIS_PROMPT, "测试覆盖"),
            "event-bus": ("event-bus/event_bus_graph", EVENT_BUS_ANALYSIS_PROMPT, "事件总线"),
        }

        for gt in ("module", "api", "db", "architecture", "tech-stack", "coding-style", "data-flow", "test-coverage", "event-bus"):
            if graph_type not in ("all", gt):
                continue
            rel_path, prompt_template, label = graph_info[gt]
            # 传入空 repo_info，因为仓库信息已在上方统一提供
            prompts.append(prompt_template.format(repo_info=f"（见上方「仓库信息」章节）"))
            prompts.append("")
            prompts.append(
                f"请将{label}分析结果写入 `.knowledge/{rel_path}.json`（JSON 格式）"
                f"或 `.knowledge/{rel_path}.md`（Markdown 格式）。"
            )
            prompts.append("")

        if graph_type in ("all", "concept"):
            prompts.append(CONCEPT_ANALYSIS_PROMPT.format(
                module_graph="参见 .knowledge/module/module_graph.json 或 .md",
                api_graph="参见 .knowledge/api/api_graph.json 或 .md",
                schema_graph="参见 .knowledge/db/schema_graph.json 或 .md",
            ))
            prompts.append("")
            prompts.append(
                "请将业务概念分析结果写入 `.knowledge/concept/concept_graph.json`（JSON 格式）"
                "或 `.knowledge/concept/concept_graph.md`（Markdown 格式）。"
            )
            prompts.append("")

        prompts.append(
            "请使用文件系统工具在 `.knowledge/` 目录下创建上述文件。"
            "你可以选择 JSON 或 Markdown 格式，也可以同时生成两种格式。"
            "完成后输出 'DONE'。"
        )

        return "\n".join(prompts)

    def _render_agent_results(self, cwd: str, graph_type: str) -> None:
        """Read agent-generated files (JSON or Markdown) and ensure Markdown output exists."""
        from scripts.gen_knowledge_graph import (
            MarkdownRenderer,
            SCHEMA_VERSION,
            _get_git_info,
        )

        root = self._knowledge_root(cwd)
        renderer = MarkdownRenderer()

        # Version increment
        prev_version = 0
        meta_path = root / "_meta.json"
        if meta_path.exists():
            try:
                old_meta = json.loads(meta_path.read_text(encoding="utf-8"))
                prev_version = int(old_meta.get("version", 0))
            except (json.JSONDecodeError, ValueError, OSError):
                pass
        new_version = prev_version + 1

        all_types = {"module", "api", "db", "concept", "architecture", "tech-stack", "coding-style", "data-flow", "test-coverage", "event-bus"}
        wanted = all_types if graph_type == "all" else {graph_type}
        sections: List[str] = []

        render_map = {
            "module": ("module/module_graph", renderer.render_module_graph),
            "api": ("api/api_graph", renderer.render_api_graph),
            "db": ("db/schema_graph", renderer.render_schema_graph),
            "concept": ("concept/concept_graph", renderer.render_concept_graph),
            "architecture": ("architecture/architecture_graph", renderer.render_architecture_graph),
            "tech-stack": ("tech-stack/tech_stack_graph", renderer.render_tech_stack_graph),
            "coding-style": ("coding-style/coding_style_graph", renderer.render_coding_style_graph),
            "data-flow": ("data-flow/data_flow_graph", renderer.render_data_flow_graph),
            "test-coverage": ("test-coverage/test_coverage_graph", renderer.render_test_coverage_graph),
            "event-bus": ("event-bus/event_bus_graph", renderer.render_event_bus_graph),
        }

        for section in wanted:
            if section not in render_map:
                continue
            rel_path, md_func = render_map[section]
            json_file = root / f"{rel_path}.json"
            md_file = root / f"{rel_path}.md"

            if json_file.exists():
                # Agent 生成了 JSON → 渲染为 Markdown
                try:
                    data = json.loads(json_file.read_text(encoding="utf-8"))
                    # 确保 data 是 dict，否则渲染器会失败
                    if not isinstance(data, dict):
                        logger.warning(
                            "JSON file %s is not a dict (got %s), skipping render",
                            json_file, type(data).__name__
                        )
                        # 如果有对应的 .md 文件则使用它
                        if md_file.exists():
                            sections.append(section)
                            logger.info("Using existing Markdown: %s", md_file)
                        continue
                    md_file.parent.mkdir(parents=True, exist_ok=True)
                    md_file.write_text(md_func(data), encoding="utf-8")
                    sections.append(section)
                    logger.info("Rendered %s from JSON → Markdown", section)
                except (json.JSONDecodeError, OSError, AttributeError, TypeError, KeyError) as e:
                    logger.warning("Failed to parse/render %s: %s", json_file, e)
                    # 如果 JSON 渲染失败但有 .md 文件，使用它
                    if md_file.exists():
                        sections.append(section)
                        logger.info("Fallback to existing Markdown: %s", md_file)
            elif md_file.exists():
                # Agent 直接生成了 Markdown → 直接使用
                sections.append(section)
                logger.info("Agent created Markdown directly: %s", md_file)
            else:
                logger.warning("Agent did not create %s.json or %s.md", rel_path, rel_path)

        # Update meta
        git_info = _get_git_info(Path(cwd))
        meta = {
            "schema_version": SCHEMA_VERSION,
            "version": new_version,
            "repo_name": Path(cwd).name,
            "repo_path": cwd,
            "git_commit": git_info.get("commit"),
            "git_branch": git_info.get("branch"),
            "generated_at": _now_iso(),
            "generator": "agent",
            "sections": sections,
        }
        meta_path.parent.mkdir(parents=True, exist_ok=True)
        meta_path.write_text(
            json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        index_path = root / "_index.md"
        index_path.write_text(renderer.render_index(meta, sections), encoding="utf-8")


    # ── 模块摘要聚合 ─────────────────────────────────

    async def get_project_modules_summary(self, cwd: str) -> str:
        """从 .knowledge/module/module_graph.json 提取项目模块职责摘要（纯文本，200字内）

        返回格式示例：
        "API层: auth, tasks, work_items, projects; 服务层: workflow_engine, plan_service, task_service; 运行时: executor, git_utils"

        知识图谱文件不存在时返回空字符串。
        """
        graph_path = Path(cwd) / ".knowledge" / "module" / "module_graph.json"
        try:
            loop = asyncio.get_running_loop()
            content = await loop.run_in_executor(None, graph_path.read_text, "utf-8")
            data = json.loads(content)
        except (OSError, json.JSONDecodeError, ValueError):
            return ""

        modules = data.get("modules")
        if not isinstance(modules, list):
            return ""

        # 按 layer 分组
        layer_map: Dict[str, List[str]] = {}
        for mod in modules:
            layer = mod.get("layer", "other")
            name = mod.get("name", "")
            if not name or name == "__init__":
                continue
            layer_map.setdefault(layer, []).append(name)

        # 构建 layer 显示名映射
        layers_meta = data.get("layers", [])
        layer_labels: Dict[str, str] = {}
        for l in layers_meta:
            if isinstance(l, dict) and l.get("name"):
                layer_labels[l["name"]] = l.get("description", l["name"])

        # 生成摘要
        parts: List[str] = []
        for layer_name, mod_names in layer_map.items():
            if layer_name == "other":
                continue
            label = layer_labels.get(layer_name, layer_name)
            display_names = mod_names[:8]
            parts.append(f"{label}: {', '.join(display_names)}")

        summary = "; ".join(parts)
        # 截断到 200 字符
        if len(summary) > 200:
            summary = summary[:197] + "..."
        return summary

    async def get_group_modules_summaries(self, group_id: str) -> Dict[str, str]:
        """并行获取项目组内所有项目的模块摘要

        返回: {project_id: summary_text, ...}
        """
        members = await project_group_service.get_group_projects(group_id)
        if not members:
            return {}

        async def _fetch(project: dict) -> tuple:
            cwd = project.get("cwd", "")
            if not cwd or not os.path.isdir(cwd):
                return (project["project_id"], "")
            summary = await self.get_project_modules_summary(cwd)
            return (project["project_id"], summary)

        results = await asyncio.gather(*[_fetch(m) for m in members])
        return {pid: s for pid, s in results}


def _run_gen_script(repo_cwd: str, graph_type: str) -> tuple[int, str, str]:
    """阻塞地调用生成脚本，返回 (returncode, stdout, stderr)。

    在线程池中执行，避免阻塞事件循环。
    """
    if not _GEN_SCRIPT.exists():
        return 1, "", f"gen script missing: {_GEN_SCRIPT}"
    cmd = [
        sys.executable,
        str(_GEN_SCRIPT),
        "--repo-path",
        repo_cwd,
        "--type",
        graph_type,
        "--format",
        "both",
    ]
    try:
        proc = subprocess.run(
            cmd,
            cwd=repo_cwd,
            capture_output=True,
            text=True,
            timeout=600,
        )
        return proc.returncode, proc.stdout, proc.stderr
    except subprocess.TimeoutExpired as e:
        return 124, e.stdout or "", (e.stderr or "") + "\n[timeout]"
    except Exception as e:  # noqa: BLE001
        return 1, "", f"{type(e).__name__}: {e}"


knowledge_service = KnowledgeService()
