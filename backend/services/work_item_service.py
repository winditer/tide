"""
WorkItemService — 工作项 CRUD + 流转引擎。

管理工作项的生命周期，通过 workflow definition 中的节点类型自动触发动作：
- stage: 纯状态停留
- agent: 自动创建 task 并执行
- approval: 创建审批等待回调
- condition: 评估条件并递归跳转
- delay: 延时后自动推进
- end: 标记完成

依赖：
- workflow definition（React Flow 的 {nodes, edges}）
- project_settings 存储项目与工作流的绑定关系
"""

import asyncio
import json
import logging
import os
import re
import shutil
import uuid
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional
from urllib.parse import quote

from sqlalchemy import text

# 系统指令前缀：确保 Agent 直接执行，不进入交互模式
AUTO_EXEC_PREFIX = (
    "【系统指令】本任务由工作流自动触发，请直接执行所有操作，"
    "不要询问确认、不要进入规划模式、不要等待用户回复。"
    "如果需要生成文件，直接生成；如果需要修改代码，直接修改。\n\n"
)

# freeform 模式默认看板状态列表（未自定义时使用）
DEFAULT_FREEFORM_STATUS_LIST = [
    {"key": "unassigned", "label": "未分配"},
    {"key": "pending", "label": "待接受"},
    {"key": "in_progress", "label": "进行中"},
    {"key": "completed", "label": "已完成"},
]


def _title_slug(title: str, max_words: int = 6) -> str:
    """从工作项标题中提取简短英文 slug，用于文件命名。

    策略：提取标题中的英文单词（含数字），小写，连字符连接，最多 max_words 个词。
    如果没有英文单词，则对中文标题取前 20 字符做 safe 处理。
    """
    import re
    # 提取英文单词和数字
    words = re.findall(r"[a-zA-Z][a-zA-Z0-9]*", title)
    if words:
        slug = "-".join(w.lower() for w in words[:max_words])
    else:
        # 纯中文标题：取前20字符
        slug = title[:20].strip()
    # 替换文件名不安全字符（保留字母、数字、连字符、中文）
    slug = re.sub(r"[^\w\-]", "-", slug).strip("-")
    slug = re.sub(r"-{2,}", "-", slug)
    return slug or "doc"


def _doc_naming_instruction(item_id: str, title: str = "", project_name: str = "") -> str:
    """生成文档命名规范指令，确保产物文件名带工作项 ID + 标题摘要前缀。

    当 project_name 非空时（多项目组场景），文件名中加入项目名以区分不同项目的产物。
    """
    slug = _title_slug(title) if title else ""
    prefix = f"wi-{item_id[:8]}"
    if slug:
        prefix = f"{prefix}-{slug}"
    if project_name:
        full_prefix = f"{prefix}-{project_name}"
        return (
            f"\n\n【文档命名规范】生成的所有文档文件（如技术方案、测试用例、修改点等）"
            f"必须以 `{full_prefix}-` 作为文件名前缀。"
            f"例如：`{full_prefix}-技术方案.md`、`{full_prefix}-测试用例.md`、`{full_prefix}-修改点.md`。\n"
        )
    return (
        f"\n\n【文档命名规范】生成的所有文档文件（如技术方案、测试用例、修改点等）"
        f"必须以 `{prefix}-` 作为文件名前缀。"
        f"例如：`{prefix}-技术方案.md`、`{prefix}-测试用例.md`、`{prefix}-修改点.md`。\n"
    )


def _copy_work_item_attachments(item: dict, cwd: str) -> list[str]:
    """把工作项 metadata.attachments 中的附件复制到 cwd，返回相对路径列表。

    复制所有类型附件（图片、文档、PDF等）；复制失败时记录 warning 并跳过。
    """
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    attachments = metadata.get("attachments") if isinstance(metadata.get("attachments"), list) else []
    if not attachments or not cwd:
        return []

    cwd_path = Path(cwd)
    cwd_path.mkdir(parents=True, exist_ok=True)
    copied: list[str] = []

    for att in attachments:
        if not isinstance(att, dict):
            continue
        src = (att.get("path") or "").strip()
        if not src:
            continue
        src_path = Path(src)
        if not src_path.exists() or not src_path.is_file():
            logging.getLogger("tide.work_item_service").warning(
                "Work item attachment not found: %s", src
            )
            continue
        try:
            dst = cwd_path / src_path.name
            # 避免同名文件冲突，生成唯一文件名
            if dst.exists():
                stem, suffix = dst.stem, dst.suffix
                for i in range(2, 1000):
                    cand = cwd_path / f"{stem}-{i}{suffix}"
                    if not cand.exists():
                        dst = cand
                        break
            shutil.copy2(src_path, dst)
            rel = dst.name
            copied.append(rel)
        except Exception as exc:
            logging.getLogger("tide.work_item_service").warning(
                "Failed to copy attachment %s to %s: %s", src, cwd, exc
            )

    return copied


def _smart_truncate(text: str, max_chars: int) -> str:
    """智能截断：优先在段落或句子边界截断，保持内容完整性。"""
    if len(text) <= max_chars:
        return text

    truncated = text[:max_chars]
    # 优先在段落边界截断（\n\n）
    last_para = truncated.rfind("\n\n")
    if last_para > max_chars * 0.7:
        return truncated[:last_para] + "\n\n...(方案已截断)"

    # 其次在换行处截断
    last_newline = truncated.rfind("\n")
    if last_newline > max_chars * 0.8:
        return truncated[:last_newline] + "\n\n...(方案已截断)"

    # 最后直接截断
    return truncated + "\n\n...(方案已截断)"

async def _read_worktree_proposal_docs(worktree_path: str, max_total_chars: int = 8000, work_item_id: str = "") -> str:
    """从 worktree 的 docs/ 目录中读取技术方案相关文档。

    查找含有"技术方案"、"design"、"changes"、"修改点"等关键词的 .md 文件，
    读取其内容作为完整的技术方案注入到下游 prompt。

    当 work_item_id 非空时，过滤掉属于其他工作项的方案文档。

    Args:
        worktree_path: worktree 目录路径
        max_total_chars: 所有文档内容的总字符上限
        work_item_id: 当前工作项 ID，用于归属校验过滤其他工作项残留文档

    Returns:
        拼接后的文档内容，为空字符串表示未找到文档
    """
    docs_dir = Path(worktree_path) / "docs"
    if not docs_dir.is_dir():
        return ""

    # 匹配技术方案相关文档的关键词
    proposal_keywords = ["技术方案", "technical-design", "design", "修改点", "changes", "implementation"]

    # 用于检测其他工作项文档的模式
    wi_prefix = work_item_id[:8] if work_item_id else ""

    proposal_files = []
    try:
        for f in docs_dir.iterdir():
            if not f.suffix == ".md":
                continue
            fname_lower = f.name.lower()
            if not any(kw in fname_lower for kw in proposal_keywords):
                continue

            # 归属校验：过滤其他工作项的文档
            if wi_prefix and "wi-" in fname_lower:
                # 文件名包含 wi- 前缀，检查是否属于当前工作项
                if wi_prefix not in fname_lower:
                    logger.debug("[work_item] Skipping doc from other work_item: %s (current=%s)", f.name, wi_prefix)
                    continue

            proposal_files.append(f)
    except OSError:
        return ""

    if not proposal_files:
        return ""

    # 按文件名排序，优先读取"技术方案/design"类文档
    proposal_files.sort(key=lambda p: (
        0 if "技术方案" in p.name or "design" in p.name.lower() else 1,
        p.name
    ))

    # 读取文件内容
    contents = []
    total_chars = 0
    for f in proposal_files:
        try:
            content = f.read_text(encoding="utf-8")
            if total_chars + len(content) > max_total_chars:
                # 截断当前文件到剩余空间
                remaining = max_total_chars - total_chars
                if remaining > 500:  # 至少保留 500 字符才值得加入
                    content = content[:remaining] + "\n\n...(文档已截断)"
                    contents.append(f"### 文件: {f.name}\n\n{content}")
                break
            contents.append(f"### 文件: {f.name}\n\n{content}")
            total_chars += len(content)
        except (OSError, UnicodeDecodeError):
            continue

    return "\n\n---\n\n".join(contents)


from backend.db.engine import async_session_factory
from backend.services.ws_hub import ws_hub

logger = logging.getLogger("tide.work_item_service")


def _safe_json_loads(raw, default):
    if raw is None or raw == "":
        return default
    if isinstance(raw, (dict, list)):
        return raw
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return default


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


# freeform 模式（无 worktree/无 git commit）下，Agent 在 cwd 生成的产物文件会在
# 执行结束后丢失（目录被清理/覆盖/非 git 仓库无法回溯）。Bridge 回传的
# 文件内容需持久化到此目录，供 content API 回读。
_ARTIFACT_CONTENT_DIR = Path(".tide/attachments/artifacts")


def _safe_artifact_name(filename: str) -> str:
    """将产物文件名归一化为安全的磁盘文件名（保留中文/字母/数字）。"""
    name = Path(filename or "artifact").name
    cleaned = "".join(
        ch if (ch.isalnum() or ch in ".-_") else "_" for ch in name
    )
    return cleaned or "artifact"


def _persist_artifact_content(
    work_item_id: str, artifact_id: str, filename: str, content: str
) -> Optional[str]:
    """将产物文本内容持久化到 .tide/attachments/artifacts/{work_item_id}/ 下。

    返回存储的相对路径字符串（相对后端进程 cwd）；失败时返回 None。
    任何异常均不中断主流程。
    """
    if not content:
        return None
    try:
        target_dir = _ARTIFACT_CONTENT_DIR / work_item_id
        target_dir.mkdir(parents=True, exist_ok=True)
        stored_name = f"{artifact_id}-{_safe_artifact_name(filename)}"
        target = target_dir / stored_name
        target.write_text(content, encoding="utf-8")
        return str(target)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("persist artifact content failed for %s: %s", filename, exc)
        return None


# 终态节点类型（与 workflow_engine.TERMINAL_NODE_TYPES 保持同步）
_TERMINAL_NODE_TYPES = {"end", "cancel", "error", "close"}

# 可见节点类型：这些节点是工作项可以停留的阶段
VISIBLE_NODE_TYPES = {"stage", "agent", "approval", "delay", "git_merge", "parallel_join"}
# 看板列节点类型：在 VISIBLE_NODE_TYPES 基础上额外包含终态节点，
# 让已完成（completed_at != NULL）的工作项也能展示在看板上。
BOARD_COLUMN_NODE_TYPES = VISIBLE_NODE_TYPES | _TERMINAL_NODE_TYPES


class WorkItemService:
    """工作项服务：CRUD + 流转引擎 + 看板数据。"""

    # ── status 推导 ─────────────────────────────────────

    @staticmethod
    def _derive_node_status(node_type: Optional[str], has_completed: bool) -> str:
        """根据节点类型推导工作项状态。

        返回值: pending | in_progress | pending_approval | completed | waiting | failed | cancelled | closed
        """
        # 终态节点类型判断优先（即使 has_completed=True）
        if node_type in _TERMINAL_NODE_TYPES:
            _terminal_status_map = {
                "end": "completed",
                "cancel": "cancelled",
                "error": "failed",
                "close": "closed",
            }
            return _terminal_status_map.get(node_type, "completed")

        # 非终态节点，但 completed_at 已设置（可能是 freeform 模式手动完成）
        if has_completed:
            return "completed"

        if node_type == "approval":
            return "pending_approval"
        if node_type == "agent":
            return "in_progress"
        if node_type == "delay":
            return "waiting"
        # stage 或其他
        return "pending"

    async def _enrich_status(self, items: List[dict]) -> List[dict]:
        """为工作项列表批量推导 status 字段。

        1. 按 workflow_id 分组，批量加载 definition
        2. 对每个 item，根据 current_node_id 找到节点 type
        3. 调用 _derive_node_status 推导 status
        """
        if not items:
            return items

        # 收集所有 workflow_id 并批量加载 definition
        workflow_ids = {item["workflow_id"] for item in items if item.get("workflow_id")}
        definitions: dict[str, dict] = {}
        for wf_id in workflow_ids:
            defn = await self._load_workflow_definition(wf_id)
            if defn:
                definitions[wf_id] = defn

        # 为每个 item 推导 status
        for item in items:
            wf_id = item.get("workflow_id")
            defn = definitions.get(wf_id) if wf_id else None
            node_type: Optional[str] = None
            if defn:
                node_map = {n["id"]: n for n in defn.get("nodes", [])}
                current_node = node_map.get(item.get("current_node_id", ""))
                if current_node:
                    node_type = current_node.get("type")
            item["status"] = self._derive_node_status(
                node_type, bool(item.get("completed_at"))
            )

        # freeform 工作项：状态由分配（assignment）聚合推导，覆盖上面的默认值
        await self._enrich_freeform_status(items)

        # 清理仅用于推导的中间字段，避免泄露到 API 响应
        for item in items:
            item.pop("stored_status", None)

        return items

    @staticmethod
    def _derive_freeform_status(
        assignment_statuses: List[str], assignee: Optional[str]
    ) -> str:
        """根据分配聚合状态推导 freeform 工作项状态。

        与看板 freeform 分列语义一致：
        - 无分配：有 assignee 视为 pending，否则 unassigned
        - 存在 accepted/in_progress：in_progress
        - 全部 completed：completed
        - 其余（全为 pending/declined）：pending
        """
        active = {"accepted", "in_progress"}
        if not assignment_statuses:
            return "pending" if (assignee and str(assignee).strip()) else "unassigned"
        if any(s in active for s in assignment_statuses):
            return "in_progress"
        if all(s == "completed" for s in assignment_statuses):
            return "completed"
        return "pending"

    async def _enrich_freeform_status(self, items: List[dict]) -> None:
        """批量为 freeform 工作项按分配聚合重新推导 status。"""
        freeform_ids = [
            it["id"] for it in items
            if it.get("flow_mode") == "freeform" and it.get("id")
        ]
        if not freeform_ids:
            return

        placeholders = ",".join(f":fid{i}" for i in range(len(freeform_ids)))
        params = {f"fid{i}": v for i, v in enumerate(freeform_ids)}

        assignments_by_item: dict[str, list] = {}
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    f"""
                    SELECT work_item_id, status
                    FROM work_item_assignments
                    WHERE work_item_id IN ({placeholders})
                    """
                ),
                params,
            )
            for row in result.fetchall():
                m = row._mapping
                assignments_by_item.setdefault(m["work_item_id"], []).append(m["status"])

        for item in items:
            if item.get("flow_mode") != "freeform":
                continue
            # 优先使用拖拽显式设置的 status（来自 work_items.status 列）
            stored = item.get("stored_status")
            if stored:
                item["status"] = stored
                continue
            statuses = assignments_by_item.get(item["id"], [])
            item["status"] = self._derive_freeform_status(statuses, item.get("assignee"))

    # ── helpers ──────────────────────────────────────────

    def _get_visible_nodes(
        self,
        definition: dict,
        include_end: bool = False,
    ) -> List[dict]:
        """提取可见节点（stage, agent, approval, delay），按拓扑排序。

        当 include_end=True 时，end 节点也会作为看板列纳入可见节点列表。
        """
        nodes = definition.get("nodes", [])
        edges = definition.get("edges", [])

        allowed_types = BOARD_COLUMN_NODE_TYPES if include_end else VISIBLE_NODE_TYPES
        visible = [n for n in nodes if n.get("type") in allowed_types]
        if not visible:
            return []

        # 拓扑排序
        node_ids = {n["id"] for n in nodes}
        in_degree = {n["id"]: 0 for n in nodes}
        adj: dict[str, list[str]] = {n["id"]: [] for n in nodes}
        for e in edges:
            src, tgt = e.get("source"), e.get("target")
            if src in node_ids and tgt in node_ids:
                adj[src].append(tgt)
                in_degree[tgt] += 1

        queue = deque([nid for nid, d in in_degree.items() if d == 0])
        order: list[str] = []
        while queue:
            nid = queue.popleft()
            order.append(nid)
            for nxt in adj[nid]:
                in_degree[nxt] -= 1
                if in_degree[nxt] == 0:
                    queue.append(nxt)

        # 按拓扑顺序过滤可见节点
        visible_ids = {n["id"] for n in visible}
        ordered_visible = [nid for nid in order if nid in visible_ids]
        node_map = {n["id"]: n for n in visible}
        return [node_map[nid] for nid in ordered_visible if nid in node_map]

    def _get_downstream_nodes(self, definition: dict, node_id: str) -> List[dict]:
        """获取指定节点的直接下游节点。"""
        edges = definition.get("edges", [])
        nodes = definition.get("nodes", [])
        node_map = {n["id"]: n for n in nodes}

        target_ids = [e["target"] for e in edges if e.get("source") == node_id]
        return [node_map[tid] for tid in target_ids if tid in node_map]

    def _get_first_visible_node(self, definition: dict) -> Optional[dict]:
        """获取 start 之后的第一个可见节点（BFS 跳过路由节点）。"""
        nodes = definition.get("nodes", [])
        edges = definition.get("edges", [])
        node_map = {n["id"]: n for n in nodes}

        # 找 start 节点
        start_nodes = [n for n in nodes if n.get("type") == "start"]
        if not start_nodes:
            # fallback: 返回第一个可见节点
            visible = self._get_visible_nodes(definition)
            return visible[0] if visible else None

        # BFS 从 start 出发找第一个可见节点
        visited = set()
        queue = deque()
        for sn in start_nodes:
            downstream_ids = [e["target"] for e in edges if e.get("source") == sn["id"]]
            for did in downstream_ids:
                if did not in visited:
                    queue.append(did)
                    visited.add(did)

        while queue:
            nid = queue.popleft()
            node = node_map.get(nid)
            if not node:
                continue
            if node.get("type") in VISIBLE_NODE_TYPES:
                return node
            # 继续 BFS 跳过路由节点
            downstream_ids = [e["target"] for e in edges if e.get("source") == nid]
            for did in downstream_ids:
                if did not in visited:
                    queue.append(did)
                    visited.add(did)

        return None

    def _render_prompt_template(self, template: str, item: dict, context: dict = None) -> str:
        """渲染 prompt 模板。

        支持以下占位符语法：
        - 双花括号：{{title}}、{{item.description}}
        - 单花括号：{title}、{item.description}（仅匹配标识符/点路径，避免与 JSON/代码中的 `{}` 冲突）
        - 节点输出：{node_id.output}、{{node_id.output}}（需传入 context）

        缺失变量一律 fallback 为空字符串，绝不抛异常，避免静默吞掉 agent 触发。
        """
        if not template:
            return ""

        def resolve(key: str) -> str:
            try:
                key = (key or "").strip()

                # 优先尝试从 context 中按点路径导航查找（支持 {agent_1.output} 语法）
                if context and "." in key:
                    lookup_key = key
                    if lookup_key.startswith("context."):
                        lookup_key = lookup_key[len("context."):]
                    obj = context
                    for part in lookup_key.split("."):
                        if isinstance(obj, dict):
                            obj = obj.get(part, "")
                        else:
                            obj = ""
                            break
                    if obj:
                        if isinstance(obj, (dict, list)):
                            return json.dumps(obj, ensure_ascii=False)
                        return str(obj)

                # 然后从 item 中查找
                if key.startswith("item."):
                    key = key[len("item."):]
                value = item.get(key, "") if isinstance(item, dict) else ""
                if value is None:
                    return ""
                if isinstance(value, (dict, list)):
                    return json.dumps(value, ensure_ascii=False)
                return str(value)
            except Exception:
                # 任何异常都退化为空字符串，保证渲染不中断
                return ""

        try:
            # 先处理 {{...}}
            rendered = re.sub(r"\{\{\s*([^{}]+?)\s*\}\}", lambda m: resolve(m.group(1)), template)
            # 再处理 {identifier(.identifier)*}（限制为合法标识符路径，避免误伤 JSON/代码）
            rendered = re.sub(
                r"\{\s*([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\s*\}",
                lambda m: resolve(m.group(1)),
                rendered,
            )
            return rendered
        except Exception:
            logger.exception("_render_prompt_template failed, returning original template")
            return template

    # ── workflow loading ─────────────────────────────────

    async def _find_default_workflow_id(self) -> Optional[str]:
        """返回一个可作为默认值的 workflow_id：优先系统内建(is_system=1)，
        次选最早创建的 enabled 工作流。利用复合索引单次查询完成。

        当项目未绑定工作流（``project_settings`` 缺失）时，作为兜底使用，
        避免普通成员在尚未配置工作流的项目中新建工作项直接报 400。
        """
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    "SELECT id FROM workflows WHERE enabled = 1"
                    " ORDER BY is_system DESC, created_at ASC LIMIT 1"
                )
            )
            row = result.fetchone()
        if not row:
            return None
        return row[0]

    async def _load_workflow_definition(self, workflow_id: str) -> Optional[dict]:
        """加载 workflow 的 definition（{nodes, edges}）。"""
        async with async_session_factory() as session:
            result = await session.execute(
                text("SELECT definition FROM workflows WHERE id = :id"),
                {"id": workflow_id},
            )
            row = result.fetchone()
        if not row:
            return None
        return _safe_json_loads(row._mapping["definition"], {"nodes": [], "edges": []})

    async def _get_project_path(self, project_id: str) -> Optional[str]:
        """从 project_id 解码出项目路径。

        Tide 中 project_id = base64.urlsafe_b64encode(cwd).rstrip('='),
        因此直接补齐 padding 后 base64 解码即可得到项目绝对路径。
        """
        if not project_id:
            return None
        try:
            import base64
            padded = project_id + "=" * (-len(project_id) % 4)
            path = base64.urlsafe_b64decode(padded).decode()
            if path and os.path.isabs(path):
                return path
        except Exception as e:
            logger.warning(
                "Failed to decode project_id to path: %s, error: %s",
                project_id, e,
            )
        return None

    # ── CRUD ─────────────────────────────────────────────

    async def create_work_item(self, data, created_by: Optional[str] = None) -> dict:
        """
        创建工作项：
        1. 根据 project_id 查找 project_settings 获取 workflow_id
        2. 加载 workflow definition
        3. 找到 start 节点的下一个可见节点作为初始 current_node_id
        4. INSERT work_items 记录
        5. 记录首次 transition
        6. 如果初始节点是 agent 类型，触发自动化
        7. WebSocket 广播
        8. 返回创建的工作项
        """
        project_id = data.project_id if hasattr(data, "project_id") else data["project_id"]
        title = data.title if hasattr(data, "title") else data["title"]
        description = (data.description if hasattr(data, "description") else data.get("description")) or None
        priority = (data.priority if hasattr(data, "priority") else data.get("priority", 0)) or 0
        assignee = (data.assignee if hasattr(data, "assignee") else data.get("assignee")) or None
        tags = (data.tags if hasattr(data, "tags") else data.get("tags")) or None
        source_type = (data.source_type if hasattr(data, "source_type") else data.get("source_type", "manual")) or "manual"
        source_id = (data.source_id if hasattr(data, "source_id") else data.get("source_id")) or None
        metadata = (data.metadata if hasattr(data, "metadata") else data.get("metadata")) or None
        version_id = (data.version_id if hasattr(data, "version_id") else data.get("version_id")) or None
        group_id = data.get("group_id") if isinstance(data, dict) else getattr(data, "group_id", None)

        # 1. 查找 project_settings；若项目尚未绑定工作流，则尝试自动绑定一个
        #    默认（最早创建且 enabled）的工作流，避免普通成员在新项目首次创建
        #    工作项时直接 400。仅在系统中存在 enabled 工作流时才自动绑定。
        settings = await self.get_project_settings(project_id)
        workflow_id = settings.get("workflow_id") if settings else None

        # 0. freeform（无工作流）模式：跳过工作流绑定，直接创建工作项
        #    flow_mode 采用继承链（项目级 > 项目组级 > 系统默认）
        flow_mode = await self.get_effective_flow_mode(project_id, settings=settings)
        if flow_mode == "freeform":
            # 读取有效的 freeform 状态列表（项目级 > 全局 > 默认），
            # 取第一列作为新建工作项的初始状态列，避免落到非首列或看板兜底列。
            status_list = await self.get_freeform_status_list(project_id)
            first_key = "unassigned"
            if isinstance(status_list, list) and status_list:
                fk = str((status_list[0] or {}).get("key", "")).strip()
                if fk:
                    first_key = fk
            # 默认首列（unassigned）沿用按分配聚合推导，status 列保持 NULL；
            # 自定义首列则显式写入 status 列，确保工作项归入配置的第一个状态列。
            initial_status = first_key if first_key != "unassigned" else None

            item_id = str(uuid.uuid4())
            now = _now_iso()
            tags_json = json.dumps(tags, ensure_ascii=False) if tags else None
            metadata_json = json.dumps(metadata, ensure_ascii=False) if metadata else None

            async with async_session_factory() as session:
                await session.execute(
                    text("""
                        INSERT INTO work_items
                            (id, project_id, workflow_id, current_node_id, title, description,
                             priority, assignee, tags, source_type, source_id, metadata,
                             version_id, flow_mode, status, started_at, created_at, updated_at, group_id, created_by)
                        VALUES (:id, :project_id, :workflow_id, :current_node_id, :title, :description,
                                :priority, :assignee, :tags, :source_type, :source_id, :metadata,
                                :version_id, :flow_mode, :status, :started_at, :created_at, :updated_at, :group_id, :created_by)
                    """),
                    {
                        "id": item_id,
                        "project_id": project_id,
                        "workflow_id": "__freeform__",
                        "current_node_id": first_key,
                        "title": title,
                        "description": description,
                        "priority": priority,
                        "assignee": assignee,
                        "tags": tags_json,
                        "source_type": source_type,
                        "source_id": source_id,
                        "metadata": metadata_json,
                        "version_id": version_id,
                        "flow_mode": "freeform",
                        "status": initial_status,
                        "started_at": now,
                        "created_at": now,
                        "updated_at": now,
                        "group_id": group_id,
                        "created_by": created_by,
                    },
                )
                await session.commit()

            # 记录首次 transition
            await self._record_transition(
                item_id=item_id,
                from_node_id=None,
                to_node_id=first_key,
                trigger_type="create",
                operator=created_by or "Tide",
            )

            item = await self.get_work_item(item_id)

            # 若指定了负责人，通过 NoWorkflowService 创建分配
            if assignee and item:
                from backend.services.no_workflow_service import no_workflow_service
                await no_workflow_service.assign_to_member(item_id, assignee, assignee)

            # WebSocket 广播
            await ws_hub.broadcast("work_items", {
                "type": "work_item.created",
                "work_item_id": item_id,
                "project_id": project_id,
                "flow_mode": "freeform",
            })

            return item or {"id": item_id}

        if not workflow_id:
            workflow_id = await self._find_default_workflow_id()
            if not workflow_id:
                raise ValueError(
                    f"Project {project_id} has no workflow bound and no default workflow available."
                )
            await self.set_project_workflow(project_id, workflow_id)

        # 2. 加载 workflow definition
        definition = await self._load_workflow_definition(workflow_id)
        if not definition:
            raise ValueError(f"Workflow {workflow_id} not found.")

        # 3. 找到第一个可见节点
        first_node = self._get_first_visible_node(definition)
        if not first_node:
            raise ValueError(f"Workflow {workflow_id} has no visible nodes.")

        current_node_id = first_node["id"]

        # 4. INSERT work_items
        item_id = str(uuid.uuid4())
        now = _now_iso()
        tags_json = json.dumps(tags, ensure_ascii=False) if tags else None
        metadata_json = json.dumps(metadata, ensure_ascii=False) if metadata else None

        async with async_session_factory() as session:
            await session.execute(
                text("""
                    INSERT INTO work_items
                        (id, project_id, workflow_id, current_node_id, title, description,
                         priority, assignee, tags, source_type, source_id, metadata,
                         version_id, started_at, created_at, updated_at, group_id, created_by)
                    VALUES (:id, :project_id, :workflow_id, :current_node_id, :title, :description,
                            :priority, :assignee, :tags, :source_type, :source_id, :metadata,
                            :version_id, :started_at, :created_at, :updated_at, :group_id, :created_by)
                """),
                {
                    "id": item_id,
                    "project_id": project_id,
                    "workflow_id": workflow_id,
                    "current_node_id": current_node_id,
                    "title": title,
                    "description": description,
                    "priority": priority,
                    "assignee": assignee,
                    "tags": tags_json,
                    "source_type": source_type,
                    "source_id": source_id,
                    "metadata": metadata_json,
                    "version_id": version_id,
                    "started_at": now,
                    "created_at": now,
                    "updated_at": now,
                    "group_id": group_id,
                    "created_by": created_by,
                },
            )
            await session.commit()

        # 5. 记录首次 transition
        await self._record_transition(
            item_id=item_id,
            from_node_id=None,
            to_node_id=current_node_id,
            trigger_type="create",
            operator=created_by or "Tide",
        )

        # 6. 如果初始节点需要自动化处理，按节点类型触发
        item = await self.get_work_item(item_id)
        if item:
            self._dispatch_node(item, first_node, definition)

        # 7. WebSocket 广播
        await ws_hub.broadcast("work_items", {
            "type": "work_item.created",
            "work_item_id": item_id,
            "project_id": project_id,
            "current_node_id": current_node_id,
        })

        # 8. 返回
        return item or {"id": item_id}

    async def get_work_item(self, item_id: str) -> Optional[dict]:
        """获取单个工作项详情。"""
        async with async_session_factory() as session:
            result = await session.execute(
                text("""
                    SELECT id, project_id, workflow_id, current_node_id, title, description,
                           priority, assignee, tags, source_type, source_id, metadata,
                           version_id, flow_mode, started_at, completed_at, created_at, updated_at,
                           group_id, status AS stored_status,
                           created_by, planned_start_date, planned_end_date, archived
                    FROM work_items WHERE id = :id
                """),
                {"id": item_id},
            )
            row = result.fetchone()
        if not row:
            return None
        item = dict(row._mapping)
        item["tags"] = _safe_json_loads(item.get("tags"), None)
        item["metadata"] = _safe_json_loads(item.get("metadata"), None)
        item["archived"] = bool(item.get("archived", 0))
        # 推导 status
        await self._enrich_status([item])
        return item

    async def get_work_item_full(self, item_id: str) -> Optional[dict]:
        """获取工作项完整详情。对 freeform 模式额外返回 assignments 和 context_stream。"""
        item = await self.get_work_item(item_id)
        if not item:
            return None

        if item.get("flow_mode") == "freeform":
            from backend.services.no_workflow_service import no_workflow_service
            item["assignments"] = await no_workflow_service.get_assignments(item_id)
            item["context_stream"] = await no_workflow_service.get_context_stream(item_id)

        return item

    async def list_work_items(
        self,
        project_id: Optional[str] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
        assignee: Optional[str] = None,
        version_id: Optional[str] = None,
        group_id: Optional[str] = None,
        include_archived: bool = False,
    ) -> List[dict]:
        """列出工作项，支持按项目、状态、关键词、负责人、版本和项目组筛选。"""
        conditions = []
        params: dict = {}

        if not include_archived:
            conditions.append("archived = 0")

        if project_id:
            conditions.append("project_id = :project_id")
            params["project_id"] = project_id
            # 按项目查询时，排除项目组工作项（它们只在项目组视角展示）
            if not group_id:
                conditions.append("group_id IS NULL")
        if group_id:
            conditions.append("group_id = :group_id")
            params["group_id"] = group_id
        # 注意：status 为推导字段（工作流按节点、freeform 按分配聚合），
        # 统一在 _enrich_status 之后于 Python 侧过滤，见下方。
        if search:
            conditions.append("(title LIKE :search OR description LIKE :search)")
            params["search"] = f"%{search}%"
        if assignee:
            conditions.append("assignee = :assignee")
            params["assignee"] = assignee
        if version_id:
            conditions.append("version_id = :version_id")
            params["version_id"] = version_id

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        async with async_session_factory() as session:
            result = await session.execute(
                text(f"""
                    SELECT id, project_id, workflow_id, current_node_id, title, description,
                           priority, assignee, tags, source_type, source_id, metadata,
                           version_id, flow_mode, started_at, completed_at, created_at, updated_at,
                           group_id, status AS stored_status,
                           created_by, planned_start_date, planned_end_date, archived
                    FROM work_items
                    {where}
                    ORDER BY created_at DESC
                """),
                params,
            )
            rows = result.fetchall()

        items = []
        for row in rows:
            item = dict(row._mapping)
            item["tags"] = _safe_json_loads(item.get("tags"), None)
            item["metadata"] = _safe_json_loads(item.get("metadata"), None)
            item["archived"] = bool(item.get("archived", 0))
            items.append(item)
        # 批量推导 status
        await self._enrich_status(items)
        # 状态是推导出来的，需要在 Python 侧过滤（兼容工作流与 freeform）
        if status:
            if status == "active":
                _terminal_statuses = {"completed", "cancelled", "failed", "closed"}
                items = [it for it in items if it.get("status") not in _terminal_statuses]
            else:
                items = [it for it in items if it.get("status") == status]
        return items

    async def update_work_item(self, item_id: str, data) -> Optional[dict]:
        """更新工作项基本信息（不涉及流转）。"""
        existing = await self.get_work_item(item_id)
        if not existing:
            return None

        sets = []
        params: dict = {"id": item_id}

        title = data.title if hasattr(data, "title") else data.get("title")
        description = data.description if hasattr(data, "description") else data.get("description")
        priority = data.priority if hasattr(data, "priority") else data.get("priority")
        assignee = data.assignee if hasattr(data, "assignee") else data.get("assignee")
        tags = data.tags if hasattr(data, "tags") else data.get("tags")
        metadata = data.metadata if hasattr(data, "metadata") else data.get("metadata")
        version_id = data.version_id if hasattr(data, "version_id") else data.get("version_id") if isinstance(data, dict) else None
        planned_start_date = data.planned_start_date if hasattr(data, "planned_start_date") else data.get("planned_start_date") if isinstance(data, dict) else None
        planned_end_date = data.planned_end_date if hasattr(data, "planned_end_date") else data.get("planned_end_date") if isinstance(data, dict) else None

        if title is not None:
            sets.append("title = :title")
            params["title"] = title
        if description is not None:
            sets.append("description = :description")
            params["description"] = description
        if priority is not None:
            sets.append("priority = :priority")
            params["priority"] = priority
        if assignee is not None:
            sets.append("assignee = :assignee")
            # 传空字符串表示取消分配
            params["assignee"] = assignee or None
            # freeform 模式：assignee 变化时同步 current_node_id 语义状态
            if existing.get("flow_mode") == "freeform":
                new_assignee = assignee or None
                if new_assignee != existing.get("assignee"):
                    sets.append("current_node_id = :current_node_id")
                    params["current_node_id"] = "assigned" if new_assignee else "unassigned"
        if tags is not None:
            sets.append("tags = :tags")
            params["tags"] = json.dumps(tags, ensure_ascii=False)
        if metadata is not None:
            sets.append("metadata = :metadata")
            params["metadata"] = json.dumps(metadata, ensure_ascii=False)
        if version_id is not None:
            # 传空字符串表示取消关联
            sets.append("version_id = :version_id")
            params["version_id"] = version_id or None
        if planned_start_date is not None:
            sets.append("planned_start_date = :planned_start_date")
            params["planned_start_date"] = planned_start_date or None
        if planned_end_date is not None:
            sets.append("planned_end_date = :planned_end_date")
            params["planned_end_date"] = planned_end_date or None

        if not sets:
            return existing

        sets.append("updated_at = :updated_at")
        params["updated_at"] = _now_iso()

        async with async_session_factory() as session:
            await session.execute(
                text(f"UPDATE work_items SET {', '.join(sets)} WHERE id = :id"),
                params,
            )
            await session.commit()

        updated = await self.get_work_item(item_id)

        await ws_hub.broadcast("work_items", {
            "type": "work_item.updated",
            "work_item_id": item_id,
            "project_id": existing["project_id"],
        })

        return updated

    async def delete_work_item(self, item_id: str) -> bool:
        """删除工作项及其流转记录。"""
        existing = await self.get_work_item(item_id)
        if not existing:
            return False

        async with async_session_factory() as session:
            await session.execute(
                text("DELETE FROM work_item_transitions WHERE work_item_id = :id"),
                {"id": item_id},
            )
            await session.execute(
                text("DELETE FROM work_items WHERE id = :id"),
                {"id": item_id},
            )
            await session.commit()

        await ws_hub.broadcast("work_items", {
            "type": "work_item.deleted",
            "work_item_id": item_id,
            "project_id": existing["project_id"],
        })

        logger.info("Work item deleted: %s", item_id[:8])
        return True

    async def archive_work_item(self, item_id: str) -> Optional[dict]:
        """归档工作项（仅允许终态工作项）。"""
        item = await self.get_work_item(item_id)
        if not item:
            return None
        if not item.get("completed_at"):
            raise ValueError("Only completed/cancelled work items can be archived")

        async with async_session_factory() as session:
            await session.execute(
                text("UPDATE work_items SET archived = 1, updated_at = :updated_at WHERE id = :id"),
                {"updated_at": _now_iso(), "id": item_id},
            )
            await session.commit()

        updated = await self.get_work_item(item_id)

        await ws_hub.broadcast("work_items", {
            "type": "work_item.archived",
            "work_item_id": item_id,
            "project_id": item["project_id"],
        })

        return updated

    async def unarchive_work_item(self, item_id: str) -> Optional[dict]:
        """取消归档工作项。"""
        item = await self.get_work_item(item_id)
        if not item:
            return None

        async with async_session_factory() as session:
            await session.execute(
                text("UPDATE work_items SET archived = 0, updated_at = :updated_at WHERE id = :id"),
                {"updated_at": _now_iso(), "id": item_id},
            )
            await session.commit()

        updated = await self.get_work_item(item_id)

        await ws_hub.broadcast("work_items", {
            "type": "work_item.unarchived",
            "work_item_id": item_id,
            "project_id": item["project_id"],
        })

        return updated

    # ── 流转引擎 ─────────────────────────────────────────

    async def transition_work_item(
        self,
        item_id: str,
        target_node_id: str,
        operator: str = "system",
        trigger_type: str = "manual",
        output: str = "",
    ) -> dict:
        """
        将工作项推进到目标节点：
        1. 获取工作项当前状态
        2. 加载 workflow definition
        3. 验证 target_node_id 合法性（自由拖拽模式支持任意可见节点）
        4. 记录 transition
        5. 更新 current_node_id
        6. 根据节点类型触发动作
        7. WebSocket 广播
        8. 返回 transition 记录
        """
        # 1. 获取工作项
        item = await self.get_work_item(item_id)
        if not item:
            raise ValueError(f"Work item {item_id} not found.")

        from_node_id = item["current_node_id"]
        workflow_id = item["workflow_id"]

        # 2. 加载 workflow
        definition = await self._load_workflow_definition(workflow_id)
        if not definition:
            raise ValueError(f"Workflow {workflow_id} not found.")

        nodes = definition.get("nodes", [])
        node_map = {n["id"]: n for n in nodes}

        # 3. 验证 target_node_id 存在
        target_node = node_map.get(target_node_id)
        if not target_node:
            raise ValueError(f"Node {target_node_id} not found in workflow.")

        # 3.1 防护：手动流转禁止从 end 节点拖出（已完成不应被重置）
        #     仅对 trigger_type == "manual" 生效，系统/审批/agent_completed 等流转不受限。
        if trigger_type == "manual":
            from_node = node_map.get(from_node_id) if from_node_id else None
            if from_node and from_node.get("type") in _TERMINAL_NODE_TYPES:
                raise ValueError("Cannot transition from terminal node")
            # 允许手动移动到 end 节点（Done），以便用户在节点卡住时手动完成工作项

        # 4. 记录 transition
        transition = await self._record_transition(
            item_id=item_id,
            from_node_id=from_node_id,
            to_node_id=target_node_id,
            trigger_type=trigger_type,
            operator=operator,
            output=output or None,
        )

        # 5. 更新 current_node_id
        now = _now_iso()
        async with async_session_factory() as session:
            sets = ["current_node_id = :node_id", "updated_at = :updated_at"]
            params: dict = {"id": item_id, "node_id": target_node_id, "updated_at": now}

            # 终态节点标记完成
            if target_node.get("type") in _TERMINAL_NODE_TYPES:
                sets.append("completed_at = :completed_at")
                params["completed_at"] = now

            await session.execute(
                text(f"UPDATE work_items SET {', '.join(sets)} WHERE id = :id"),
                params,
            )
            await session.commit()

        # 刷新 item
        item = await self.get_work_item(item_id)

        # 6. 根据节点类型触发动作
        if item:
            self._dispatch_node(item, target_node, definition)

        # 7. WebSocket 广播
        await ws_hub.broadcast("work_items", {
            "type": "work_item.transitioned",
            "work_item_id": item_id,
            "from_node_id": from_node_id,
            "to_node_id": target_node_id,
            "trigger_type": trigger_type,
            "operator": operator,
        })

        # 7.5 终态通知：工作项完成 / 取消 → 通知负责人
        try:
            if item and target_node.get("type") in _TERMINAL_NODE_TYPES:
                from backend.services.notification_service import notification_service

                _assignee = item.get("assignee")
                _title = item.get("title") or ""
                _ttype = target_node.get("type")
                if _assignee:
                    if _ttype == "cancel":
                        if _assignee != operator:
                            await notification_service.create_notification(
                                recipient_id=_assignee,
                                work_item_id=item_id,
                                notification_type="cancelled",
                                trigger_actor_id=operator,
                                content=f"工作项「{_title}」已被取消",
                            )
                    elif _ttype in ("end", "close"):
                        await notification_service.create_notification(
                            recipient_id=_assignee,
                            work_item_id=item_id,
                            notification_type="completed",
                            trigger_actor_id="system",
                            content=f"工作项「{_title}」已完成",
                        )
        except Exception:
            logger.debug("create terminal notification failed", exc_info=True)

        # 8. 返回 transition
        return transition

    async def get_transitions(self, item_id: str) -> List[dict]:
        """获取工作项的流转历史。如果某个 transition 关联了 Plan，补充 Plan 的所有子任务信息。"""
        async with async_session_factory() as session:
            result = await session.execute(
                text("""
                    SELECT id, work_item_id, from_node_id, to_node_id,
                           trigger_type, task_id, operator, output, created_at
                    FROM work_item_transitions
                    WHERE work_item_id = :item_id
                    ORDER BY created_at ASC
                """),
                {"item_id": item_id},
            )
            rows = result.fetchall()
        transitions = [dict(row._mapping) for row in rows]

        # 为关联了 Plan 的 transition 补充子任务列表
        for t in transitions:
            task_id = t.get("task_id")
            if not task_id:
                continue
            async with async_session_factory() as session:
                plan_row = (await session.execute(
                    text("SELECT plan_id FROM tasks WHERE id = :tid AND plan_id IS NOT NULL"),
                    {"tid": task_id},
                )).fetchone()
            if not plan_row:
                # 单任务场景：查询任务状态信息
                async with async_session_factory() as session:
                    task_row = (await session.execute(
                        text("SELECT id, status, prompt FROM tasks WHERE id = :tid"),
                        {"tid": task_id},
                    )).fetchone()
                if task_row:
                    t["task_info"] = dict(task_row._mapping)
                continue
            plan_id = dict(plan_row._mapping)["plan_id"]
            async with async_session_factory() as session:
                sub_tasks = (await session.execute(
                    text("""
                        SELECT id, status, prompt, started_at, completed_at,
                               branch_name, commit_hash
                        FROM tasks
                        WHERE plan_id = :plan_id
                        ORDER BY created_at
                    """),
                    {"plan_id": plan_id},
                )).fetchall()
            if sub_tasks:
                t["plan_id"] = plan_id
                t["plan_tasks"] = [dict(row._mapping) for row in sub_tasks]

        return transitions

    async def get_cross_repo_results(self, item_id: str) -> dict:
        """跨仓库执行结果聚合。

        当工作项关联了项目组（``group_id``）时，返回该工作项
        驱动的跨仓库 Plan 下所有子任务的 diff/commit 汇总，供前端
        按仓库分组展示。未关联项目组或未生成 Plan 时返回空
        结果，调用方可友好降级处理。
        """
        item = await self.get_work_item(item_id)
        if not item:
            raise ValueError(f"Work item {item_id} not found")

        group_id = item.get("group_id")
        empty: dict = {"group_id": group_id, "results": []}
        if not group_id:
            return empty

        # 1. 通过 work_item_transitions.task_id 关联 plan_tasks 反查出 plan_id
        async with async_session_factory() as session:
            plan_row = await session.execute(
                text("""
                    SELECT DISTINCT pt.plan_id
                    FROM work_item_transitions wit
                    JOIN plan_tasks pt ON wit.task_id = pt.task_id
                    WHERE wit.work_item_id = :item_id
                      AND wit.task_id IS NOT NULL
                    ORDER BY pt.plan_id
                    LIMIT 1
                """),
                {"item_id": item_id},
            )
            row = plan_row.fetchone()
        if not row:
            return empty
        plan_id = row[0]
        if not plan_id:
            return empty

        # 2. 拉取 plan 下所有子任务与执行结果
        async with async_session_factory() as session:
            tasks_result = await session.execute(
                text("""
                    SELECT t.id           AS task_id,
                           t.status       AS status,
                           t.cwd          AS cwd,
                           t.diff_summary AS diff_summary,
                           t.commit_hash  AS commit_hash,
                           t.commit_message AS commit_message,
                           t.completed_at AS completed_at,
                           pt.task_index  AS task_index
                    FROM plan_tasks pt
                    JOIN tasks t ON pt.task_id = t.id
                    WHERE pt.plan_id = :plan_id
                    ORDER BY pt.task_index
                """),
                {"plan_id": plan_id},
            )
            task_rows = [dict(r._mapping) for r in tasks_result.fetchall()]

        if not task_rows:
            return empty

        # 3. 查项目组成员，建立 cwd → (project_id, name) 映射
        from backend.services.project_group_service import project_group_service
        try:
            group_projects = await project_group_service.get_group_projects(group_id)
        except Exception as exc:  # pragma: no cover - 防御性
            logger.warning(
                "[WorkItem] Failed to load group projects %s: %s", group_id[:8], exc,
            )
            group_projects = []

        cwd_to_project: dict = {}
        for p in group_projects:
            cwd = (p.get("cwd") or "").rstrip("/")
            if cwd:
                cwd_to_project[cwd] = {
                    "project_id": p.get("project_id"),
                    "project_name": p.get("name") or p.get("project_id"),
                }

        # 4. 按仓库组装返回结果
        results: List[dict] = []
        for r in task_rows:
            cwd = (r.get("cwd") or "").rstrip("/")
            mapped = cwd_to_project.get(cwd, {})
            results.append({
                "project_id": mapped.get("project_id"),
                "project_name": (
                    mapped.get("project_name")
                    or (Path(cwd).name if cwd else None)
                ),
                "cwd": cwd or None,
                "status": r.get("status"),
                "task_id": r.get("task_id"),
                "task_index": r.get("task_index"),
                "diff_summary": r.get("diff_summary"),
                "commit_hash": r.get("commit_hash"),
                "commit_message": r.get("commit_message"),
                "completed_at": r.get("completed_at"),
            })

        return {
            "group_id": group_id,
            "plan_id": plan_id,
            "results": results,
        }

    # ── 节点分发与回退 ─────────────────────────────────────────

    def _dispatch_node(self, item: dict, node: dict, definition: dict):
        """根据节点类型分发执行（fire-and-forget）。"""
        node_type = node.get("type", "stage")
        if node_type == "agent":
            asyncio.create_task(self._safe_trigger_agent(item, node))
        elif node_type == "approval":
            asyncio.create_task(self._trigger_approval_node(item, node))
        elif node_type == "condition":
            asyncio.create_task(self._handle_condition_node(item, node, definition))
        elif node_type == "delay":
            asyncio.create_task(self._handle_delay_node(item, node, definition))
        elif node_type == "git_merge":
            asyncio.create_task(self._safe_trigger_git_merge(item, node))
        elif node_type in _TERMINAL_NODE_TYPES:
            logger.info("Work item %s reached terminal: %s", item.get("id", "?")[:8], node_type)
        elif node_type != "stage":
            logger.warning(
                "[WorkItem] _dispatch_node: unrecognized node type %r for item %s, node %s",
                node_type, item.get("id", "?")[:8], node.get("id", "?"),
            )

    async def rollback_to_node(self, item_id: str, target_node_id: str) -> Optional[dict]:
        """回退工作项到指定节点并重新触发。"""
        # 1. 获取工作项
        item = await self.get_work_item(item_id)
        if not item:
            return None

        # 2. 获取工作流定义
        workflow_id = item.get("workflow_id")
        if not workflow_id:
            return None
        definition = await self._load_workflow_definition(workflow_id)
        if not definition:
            return None
        nodes = definition.get("nodes", [])

        # 3. 验证目标节点存在
        target_node = next((n for n in nodes if n["id"] == target_node_id), None)
        if not target_node:
            return None

        # 4. 不允许回退到 start/end 节点
        node_type = target_node.get("type", "")
        if node_type in ("start", "end"):
            return None

        # 5. 取消当前节点上进行中的任务
        current_node_id = item.get("current_node_id") or ""
        if current_node_id:
            from backend.services.task_service import task_service
            async with async_session_factory() as session:
                running_tasks = await session.execute(
                    text("""
                        SELECT t.id, t.status FROM tasks t
                        JOIN work_item_transitions wit ON wit.task_id = t.id
                        WHERE wit.work_item_id = :item_id
                          AND wit.to_node_id = :node_id
                          AND t.status IN ('queued', 'running', 'review')
                    """),
                    {"item_id": item_id, "node_id": current_node_id},
                )
                rows = running_tasks.fetchall()
            for row in rows:
                task_row = dict(row._mapping)
                try:
                    await task_service._update_status(
                        task_row["id"], "", "cancelled", old_status=task_row["status"]
                    )
                except Exception as exc:
                    logger.warning("[rollback] Failed to cancel task %s: %s", task_row["id"], exc)

        # 6. 更新 current_node_id，清除 completed_at
        now = _now_iso()
        async with async_session_factory() as session:
            await session.execute(
                text("""
                    UPDATE work_items
                    SET current_node_id = :node_id, completed_at = NULL, updated_at = :now
                    WHERE id = :id
                """),
                {"node_id": target_node_id, "now": now, "id": item_id},
            )
            await session.commit()

        # 7. 记录 rollback transition
        transition = await self._record_transition(
            item_id=item_id,
            from_node_id=current_node_id,
            to_node_id=target_node_id,
            trigger_type="rollback",
            operator="user",
        )

        # 8. 刷新 item 并触发目标节点
        item = await self.get_work_item(item_id)
        if item:
            self._dispatch_node(item, target_node, definition)

        # 9. WebSocket 广播
        await ws_hub.broadcast("work_items", {
            "type": "work_item.rollback",
            "work_item_id": item_id,
            "from_node_id": current_node_id,
            "to_node_id": target_node_id,
        })

        return transition

    # ── 自动化触发 ───────────────────────────────────────

    async def _safe_trigger_agent(self, item: dict, node: dict):
        """包装 _trigger_agent_node，确保任何异常都被记录而不会被 asyncio 静默吞掉。"""
        try:
            await self._trigger_agent_node(item, node)
        except Exception as exc:
            logger.error(
                "[WorkItem] Failed to trigger agent node %s for work item %s: %s",
                (node.get("id") or "?"),
                (item.get("id") or "?"),
                exc,
                exc_info=True,
            )

    async def _trigger_agent_node(self, item: dict, node: dict):
        """
        Agent 节点自动化：
        1. 从 node.data 提取 prompt, model, agent_id
        2. 渲染 prompt 模板
        3. 工作项级 worktree 隔离（可选）
        4. 调用 task_service.create_task()
        5. task 的 metadata 中记录 work_item_id 和 workflow_node_id
        6. 更新 transition 的 task_id
        """
        logger.info(
            "[WorkItem] Triggering agent node '%s' for item '%s' title='%s'",
            node.get("id"),
            item.get("id"),
            item.get("title"),
        )
        try:
            from backend.services.task_service import task_service

            # 项目组分支：若工作项关联了 group_id，使用跨仓库模式
            group_id = item.get("group_id")
            routing_trigger = node.get("data", {}).get("routingTrigger")

            if group_id and routing_trigger is not False:
                # 有 group_id 且未显式禁用路由 → 走项目组跨仓模式
                await self._trigger_group_agent_node(item, node, group_id)
                return
            # 否则走单仓模式（包括 group 模式下 routingTrigger=false 的方案生成节点）

            data = node.get("data", {})
            agent_id = data.get("agentId") or data.get("agent_id") or "codex"
            model = data.get("model") or None
            prompt_template = data.get("promptTemplate") or data.get("prompt") or ""

            # 专家团解析：若节点配置了 expert_team_id，覆盖 agent_id、合并 skills、注入角色提示词
            expert_role_prompt = ""
            if data.get("expert_team_id"):
                try:
                    from backend.services.expert_team_service import ExpertTeamService
                    expert_team_svc = ExpertTeamService()
                    expert_team = await expert_team_svc.resolve_expert_team(
                        data["expert_team_id"], "default"
                    )
                    if expert_team:
                        agent_id = expert_team["agent_id"]
                        if expert_team.get("model"):
                            model = expert_team["model"]
                        existing_skills = data.get("skills", []) or []
                        combined_skills = expert_team.get("skill_slugs", []) + existing_skills
                        data["skills"] = list(dict.fromkeys(combined_skills))
                        if expert_team.get("role_prompt"):
                            expert_role_prompt = expert_team["role_prompt"]
                except Exception as e:
                    logger.warning("Expert team resolution failed in _trigger_agent_node: %s", e)

            node_cwd = data.get("cwd") or ""
            project_cwd = await self._get_project_path(item["project_id"])
            if not project_cwd:
                logger.warning(
                    "Could not determine project path for project_id=%s, falling back to cwd",
                    item["project_id"],
                )
            cwd = node_cwd or project_cwd or str(Path.cwd())

            # 工作项级 worktree 隔离
            worktree_path_str = ""
            branch_name = ""
            use_worktree = data.get("useWorktree", True)  # 默认启用 worktree 隔离

            if use_worktree:
                from backend.runtime.git_utils import prepare_work_item_worktree
                # 以 project_cwd 为基准创建 worktree，避免 node_cwd 指向非项目目录
                base_path = project_cwd or cwd
                wt_path, wt_branch, _ = await prepare_work_item_worktree(
                    work_item_id=item["id"],
                    project_path=Path(base_path),
                )
                if wt_path:
                    # worktree 创建成功，使用 worktree 路径
                    worktree_path_str = str(wt_path)
                    branch_name = wt_branch
                    cwd = worktree_path_str  # 覆盖 cwd 为 worktree 路径
                    logger.info(
                        "[work_item] worktree created for item=%s branch=%s path=%s",
                        item["id"], branch_name, worktree_path_str
                    )
                else:
                    # worktree 创建失败：终止 Agent 执行，避免在主仓库操作导致 HEAD 残留
                    logger.error(
                        "[work_item] worktree creation failed for item=%s, "
                        "aborting agent execution to prevent operating on main repo. "
                        "project_path=%s",
                        item["id"], base_path,
                    )
                    # 记录错误到工作项 metadata，便于前端展示和用户感知
                    try:
                        existing_meta = {}
                        if item.get("metadata"):
                            existing_meta = json.loads(item["metadata"]) if isinstance(item["metadata"], str) else item["metadata"]
                        existing_meta["worktree_error"] = {
                            "message": f"Worktree creation failed for work item {item['id']}, agent execution aborted.",
                            "project_path": base_path,
                            "node_id": node.get("id"),
                            "timestamp": _now_iso(),
                        }
                        async with async_session_factory() as session:
                            await session.execute(
                                text("UPDATE work_items SET metadata = :meta, updated_at = :now WHERE id = :id"),
                                {
                                    "meta": json.dumps(existing_meta, ensure_ascii=False),
                                    "now": _now_iso(),
                                    "id": item["id"],
                                },
                            )
                            await session.commit()
                    except Exception as meta_exc:
                        logger.warning(
                            "[work_item] Failed to record worktree error metadata for item=%s: %s",
                            item["id"], meta_exc,
                        )
                    # 记录 transition output 标记节点执行失败
                    try:
                        await self._record_transition(
                            item_id=item["id"],
                            from_node_id=node.get("id"),
                            to_node_id=node.get("id"),
                            trigger_type="error",
                            operator="system",
                            output=f"Worktree creation failed, agent execution aborted. project_path={base_path}",
                        )
                    except Exception as tr_exc:
                        logger.warning(
                            "[work_item] Failed to record error transition for item=%s: %s",
                            item["id"], tr_exc,
                        )
                    return

            # 最终兜底：确保 cwd 是绝对路径，绝不传入空串/相对路径
            if not cwd or not os.path.isabs(cwd):
                fallback = project_cwd or str(Path.cwd())
                logger.warning(
                    "[work_item] cwd invalid (%r), fallback to project_cwd=%s",
                    cwd, fallback,
                )
                cwd = fallback

            # 构建 workflow context（用于模板变量解析）
            wf_context = None
            definition = await self._load_workflow_definition(item.get("workflow_id"))
            if definition:
                wf_context = await self._build_workflow_context(item, definition)

            # 渲染 prompt
            prompt = self._render_prompt_template(prompt_template, item, wf_context)
            if not prompt:
                prompt = f"处理工作项: {item['title']}"
                if item.get("description"):
                    prompt += f"\n\n{item['description']}"

            # 注入专家团角色提示词
            if expert_role_prompt:
                prompt = f"# 你的角色\n\n{expert_role_prompt}\n\n---\n\n{prompt}"

            # 添加自动执行系统指令前缀 + 文档命名规范
            prompt = AUTO_EXEC_PREFIX + prompt + _doc_naming_instruction(item["id"], title=item.get("title", ""))

            # 复制工作项附件到工作目录，并在 prompt 中提示 Agent 读取
            attachment_paths = _copy_work_item_attachments(item, cwd)
            if attachment_paths:
                prompt += (
                    "\n\n## 工作项附件\n"
                    "以下文件已复制到当前工作目录，请按需读取并参考：\n"
                    + "\n".join(f"- ./{p}" for p in attachment_paths)
                    + "\n"
                )

            # 注入产物链接（含Lark文档链接）
            item_meta = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
            artifacts = item_meta.get("artifacts") or []
            if artifacts:
                art_lines = "\n".join(
                    f"- [{a.get('label', a.get('type', '产物'))}]({a.get('url', '')})"
                    for a in artifacts[:10]
                    if a.get("url")
                )
                if art_lines:
                    prompt += f"\n\n## 关联产物\n\n{art_lines}\n"

            # 预获取Lark文档内容（异步，失败不阻塞）
            try:
                from backend.runtime.lark_context import fetch_all_lark_docs
                lark_docs_content = await fetch_all_lark_docs(prompt)
                if lark_docs_content:
                    prompt += "\n\n" + lark_docs_content
            except Exception:
                pass

            # 注入项目知识图谱模块结构
            try:
                from backend.services.knowledge_service import knowledge_service
                _kg_path = project_cwd or cwd
                project_knowledge = await knowledge_service.get_project_modules_summary(_kg_path)
                if project_knowledge:
                    prompt += f"\n\n## 项目模块结构（知识图谱）\n\n{project_knowledge}\n"
                    logger.info("[work_item] Injected knowledge graph modules for item=%s (len=%d)", item["id"][:8], len(project_knowledge))
            except Exception as e:
                logger.debug("[work_item] Failed to inject knowledge graph: %s", e)

            # ─── 注入项目组架构约束（方案生成阶段也需要感知） ───
            if group_id:
                try:
                    from backend.services.project_group_service import project_group_service
                    group_context = await project_group_service.get_group_context_prompt(group_id)
                    if group_context:
                        prompt = f"{group_context}\n\n---\n\n{prompt}"
                        logger.info("[work_item] Injected group architecture constraints for proposal stage, item=%s", item["id"][:8])
                except Exception as e:
                    logger.warning("[work_item] Failed to inject group context in proposal stage: %s", e)

            # 创建 task
            task = await task_service.create_task(
                workspace_id="default",
                prompt=prompt,
                agent_id=agent_id,
                model=model,
                cwd=cwd,
                full_auto=True,
            )

            task_id = task["id"] if task else None
            if task_id:
                logger.info(
                    "[WorkItem] Task created: %s for agent node '%s', item '%s'",
                    task_id, node.get("id"), item.get("id"),
                )
                # 将 worktree_path 和 branch_name 写入 tasks 表
                if worktree_path_str or branch_name:
                    async with async_session_factory() as session:
                        await session.execute(
                            text("""
                                UPDATE tasks
                                SET worktree_path = :wt_path, branch_name = :branch
                                WHERE id = :task_id
                            """),
                            {
                                "wt_path": worktree_path_str,
                                "branch": branch_name,
                                "task_id": task_id,
                            },
                        )
                        await session.commit()
            else:
                logger.error(
                    "[WorkItem] task_service.create_task returned no task for agent node '%s', item '%s'",
                    node.get("id"), item.get("id"),
                )

            # 更新最近一条 transition 的 task_id（使用子查询避免依赖 SQLite 的
            # SQLITE_ENABLE_UPDATE_DELETE_LIMIT 编译特性）
            if task_id:
                async with async_session_factory() as session:
                    await session.execute(
                        text("""
                            UPDATE work_item_transitions
                            SET task_id = :task_id
                            WHERE id = (
                                SELECT id FROM work_item_transitions
                                WHERE work_item_id = :item_id
                                  AND to_node_id = :node_id
                                  AND task_id IS NULL
                                ORDER BY created_at DESC
                                LIMIT 1
                            )
                        """),
                        {
                            "task_id": task_id,
                            "item_id": item["id"],
                            "node_id": node["id"],
                        },
                    )
                    await session.commit()

                # 后台轮询等待 task 完成（事件驱动回调是主路径，轮询为兜底）
                asyncio.create_task(self._wait_and_record_output(task_id))
                logger.info(
                    "work_item=%s node=%s linked task_id=%s, polling started.",
                    item["id"][:8], node["id"][:8], task_id[:8],
                )

            logger.info(
                "Agent node triggered for work item %s, task_id=%s",
                item["id"][:8],
                (task_id or "")[:8],
            )

        except Exception as exc:
            logger.exception(
                "Failed to trigger agent node for work item %s: %s",
                item["id"][:8], exc,
            )

    async def _trigger_group_agent_node(self, item: dict, node: dict, group_id: str):
        """项目组模式：为组内各仓库自动生成跨仓库 Plan。失败时回退到单仓库模式。"""
        if not item or not node or not group_id:
            logger.warning(
                "[WorkItem] _trigger_group_agent_node missing args: item=%s node=%s group=%s",
                bool(item), bool(node), bool(group_id),
            )
            return
        logger.info(
            "[WorkItem] Triggering GROUP agent node '%s' for item '%s' (group=%s)",
            node.get("id"),
            item.get("id"),
            group_id[:8],
        )
        try:
            from backend.services.task_service import task_service
            from backend.services.project_group_service import project_group_service
            from backend.services.plan_service import plan_service

            data = node.get("data", {})
            agent_id = data.get("agentId") or data.get("agent_id") or "codex"
            model = data.get("model") or None
            prompt_template = data.get("promptTemplate") or data.get("prompt") or ""

            # 专家团解析：若节点配置了 expert_team_id，覆盖 agent_id、合并 skills、注入角色提示词
            expert_role_prompt = ""
            if data.get("expert_team_id"):
                try:
                    from backend.services.expert_team_service import ExpertTeamService
                    expert_team_svc = ExpertTeamService()
                    expert_team = await expert_team_svc.resolve_expert_team(
                        data["expert_team_id"], "default"
                    )
                    if expert_team:
                        agent_id = expert_team["agent_id"]
                        if expert_team.get("model"):
                            model = expert_team["model"]
                        existing_skills = data.get("skills", []) or []
                        combined_skills = expert_team.get("skill_slugs", []) + existing_skills
                        data["skills"] = list(dict.fromkeys(combined_skills))
                        if expert_team.get("role_prompt"):
                            expert_role_prompt = expert_team["role_prompt"]
                except Exception as e:
                    logger.warning("Expert team resolution failed in _trigger_group_agent_node: %s", e)

            # 1. 获取项目组上下文
            group_context = await project_group_service.get_group_context_prompt(group_id)
            group_projects = await project_group_service.get_group_projects(group_id)
            if not group_projects:
                logger.warning(
                    "[WorkItem] Group %s has no projects, falling back to single-repo mode",
                    group_id[:8],
                )
                item_copy = dict(item)
                item_copy.pop("group_id", None)
                await self._trigger_agent_node(item_copy, node)
                return

            # 确定主项目
            primary_project = next(
                (p for p in group_projects if p["role"] == "primary"),
                group_projects[0],
            )
            primary_cwd = primary_project["cwd"]
            if not primary_cwd or not os.path.isabs(primary_cwd):
                primary_cwd = await self._get_project_path(item["project_id"]) or str(Path.cwd())

            # 始终构建 workflow context（用于模板变量解析）
            definition = await self._load_workflow_definition(item.get("workflow_id"))
            wf_context = None
            if definition:
                wf_context = await self._build_workflow_context(item, definition)

            # 2. 渲染基础 prompt（context 支持 {node_id.output} 变量）
            base_prompt = self._render_prompt_template(prompt_template, item, wf_context)
            if not base_prompt:
                base_prompt = f"处理工作项: {item['title']}"
                if item.get("description"):
                    base_prompt += f"\n\n{item['description']}"

            # 注入专家团角色提示词
            if expert_role_prompt:
                base_prompt = f"# 你的角色\n\n{expert_role_prompt}\n\n---\n\n{base_prompt}"

            # ─── 检查路由配置 ─────────────────────────────────────────────
            routing_trigger = data.get("routingTrigger")  # None=未配置, True=启用, False=禁用
            should_route = routing_trigger is not False  # None 或 True 都执行路由

            from backend.runtime.config import WORKITEM_SMART_ROUTING, WORKITEM_SMART_ROUTING_CONFIDENCE, ROUTING_PROPOSAL_MAX_CHARS

            # 获取前序节点输出（技术方案）作为路由辅助信息
            prev_output = ""
            # 只要不是显式禁用路由（routing_trigger=False），就提取前序方案
            if routing_trigger is not False and wf_context and definition:
                prev_output = self._extract_prev_agent_output(wf_context, definition, node["id"], work_item_id=item["id"])

            # ===== 尝试从工作项 worktree 中读取完整技术方案文档 =====
            worktree_proposal = ""
            try:
                from backend.runtime.git_utils import safe_git_ref_part
                wi_worktree = Path(primary_cwd) / ".tide" / "worktrees" / f"wi-{safe_git_ref_part(item['id'])}"
                if wi_worktree.is_dir():
                    worktree_proposal = await _read_worktree_proposal_docs(str(wi_worktree), work_item_id=item["id"])
            except Exception:
                pass

            # worktree 方案仅在 transition 中无有效前序方案时使用（作为补充而非覆盖）
            if worktree_proposal:
                if not prev_output:
                    # transition 中无方案，使用 worktree 文档
                    prev_output = worktree_proposal
                    logger.info("[work_item] Using worktree proposal (no transition output) for item=%s", item["id"][:8])
                else:
                    # transition 中有方案，将 worktree 文档作为补充附加
                    prev_output = prev_output + "\n\n## 补充参考文档\n\n" + worktree_proposal
                    logger.info("[work_item] Appending worktree proposal as supplement for item=%s", item["id"][:8])
            # ===== worktree 文档读取结束 =====

            # 注入前序节点的技术方案到 base_prompt（如果模板已引用则不重复追加）
            if prev_output:
                if prev_output[:50] not in base_prompt:
                    truncated_proposal = _smart_truncate(prev_output, ROUTING_PROPOSAL_MAX_CHARS)
                    base_prompt += (
                        f"\n\n## 参考技术方案（请严格遵循，不要重新生成方案）\n\n"
                        f"以下是前置分析产出的技术方案，请直接按照方案中涉及当前仓库的部分进行开发实施：\n\n"
                        f"{truncated_proposal}"
                    )

            # ─── 智能路由决策 ─────────────────────────────────────────────

            target_projects = group_projects  # 默认全量派发

            if not should_route:
                logger.info("[WorkItem.Routing] Node routingTrigger=false, skip routing, full dispatch")
            elif WORKITEM_SMART_ROUTING:
                try:
                    from backend.services.group_route_service import group_route_service
                    from backend.services.knowledge_service import knowledge_service

                    summaries = await knowledge_service.get_group_modules_summaries(group_id)

                    # 构建路由输入：标题 + 描述 + 前序技术方案（截断）
                    routing_description = item.get("description", "")
                    if prev_output:
                        truncated_proposal = _smart_truncate(prev_output, ROUTING_PROPOSAL_MAX_CHARS)
                        routing_description = f"{routing_description}\n\n## 技术方案\n{truncated_proposal}"

                    routing_result = await group_route_service.analyze_routing(
                        work_item={"title": item["title"], "description": routing_description},
                        projects=group_projects,
                        knowledge_summaries=summaries,
                    )

                    if routing_result and routing_result.confidence >= WORKITEM_SMART_ROUTING_CONFIDENCE:
                        filtered = [
                            p for p in group_projects
                            if p["project_id"] in routing_result.recommended_project_ids
                        ]
                        if filtered:
                            target_projects = filtered
                            logger.info(
                                "[WorkItem.Routing] Selected %d/%d projects (confidence=%.2f): %s",
                                len(target_projects), len(group_projects),
                                routing_result.confidence,
                                [p["name"] for p in target_projects],
                            )
                        else:
                            logger.info("[WorkItem.Routing] Empty recommendation, fallback to full dispatch")
                    else:
                        logger.info(
                            "[WorkItem.Routing] Low confidence (%.2f), fallback to full dispatch",
                            routing_result.confidence if routing_result else 0.0,
                        )
                except Exception as e:
                    logger.warning("[WorkItem.Routing] Failed: %s, fallback to full dispatch", e)
                    target_projects = group_projects
            # ─── 路由决策结束 ─────────────────────────────────────────────

            # ─── 跨仓库协调 ─────────────────────────────────────────────
            coordination_doc = None
            from backend.runtime.config import CROSS_REPO_COORDINATION, CROSS_REPO_COORDINATION_CONFIDENCE

            if CROSS_REPO_COORDINATION and len(target_projects) >= 2:
                try:
                    from backend.services.group_route_service import group_route_service
                    from backend.services.knowledge_service import knowledge_service

                    # 获取知识图谱摘要（如果路由阶段已获取则复用）
                    if not locals().get('summaries'):
                        summaries = await knowledge_service.get_group_modules_summaries(group_id)

                    # 解析架构配置
                    architecture_rules = None
                    constraints_list = None
                    try:
                        import json as _json
                        desc = (await project_group_service.get_group(group_id) or {}).get("description", "")
                        if desc and desc.strip().startswith("{"):
                            desc_obj = _json.loads(desc)
                            architecture_rules = desc_obj.get("architecture_rules")
                            constraints_list = desc_obj.get("constraints")
                    except Exception:
                        pass

                    coordination_doc = await group_route_service.generate_coordination(
                        work_item={"title": item["title"], "description": item.get("description", "")},
                        projects=target_projects,
                        knowledge_summaries=summaries if locals().get('summaries') else {},
                        architecture_rules=architecture_rules,
                        constraints=constraints_list,
                    )
                    if coordination_doc:
                        logger.info(
                            "[WorkItem.Coordination] Generated coordination doc: %d tasks, confidence=%.2f",
                            len(coordination_doc.get("tasks", [])),
                            coordination_doc.get("confidence", 0),
                        )
                except Exception as e:
                    logger.warning("[WorkItem.Coordination] Failed: %s, proceeding without coordination", e)
                    coordination_doc = None
            # ─── 跨仓库协调结束 ─────────────────────────────────────────────

            # 3. 构建跨仓库 Plan definition
            # 后端项目可并行（phase 0），前端项目依赖后端（phase 1）
            plan_tasks = []
            backend_indices = []
            for idx, project in enumerate(target_projects):
                project_name = project["name"]
                project_cwd = project["cwd"]
                if not project_cwd:
                    continue

                # 判断是否为前端项目（简单启发式：名称含 web/frontend/app）
                is_frontend = any(
                    kw in project_name.lower()
                    for kw in ("web", "frontend", "app", "ui", "client")
                )
                phase = 1 if is_frontend and backend_indices else 0

                # 获取项目知识图谱摘要（静默降级）
                project_knowledge = ""
                try:
                    project_knowledge = await knowledge_service.get_project_modules_summary(project_cwd)
                    if project_knowledge and len(project_knowledge) > 2000:
                        project_knowledge = project_knowledge[:2000] + "\n...(已截断)"
                except Exception:
                    pass

                task_prompt = (
                    f"{group_context}\n\n"
                    f"## 需求\n{base_prompt}\n\n"
                    f"## 当前目标仓库\n"
                    f"你现在在 `{project_name}` 仓库（{project_cwd}）中工作。\n"
                )
                # 注入跨仓库协调指令
                if coordination_doc and coordination_doc.get("tasks"):
                    repo_task = next(
                        (t for t in coordination_doc["tasks"] if t.get("project") == project_name),
                        None,
                    )
                    if repo_task:
                        task_prompt += f"\n## 本仓库职责（跨仓库协调结果，必须遵循）\n"
                        task_prompt += f"**负责实现**: {repo_task.get('responsibility', '')}\n"
                        if repo_task.get("avoids"):
                            task_prompt += "**严禁执行以下操作**（由其他仓库负责）:\n"
                            for avoid in repo_task["avoids"]:
                                task_prompt += f"- ❌ {avoid}\n"
                    if coordination_doc.get("shared_resources"):
                        task_prompt += f"\n**共享资源注意**: {', '.join(coordination_doc['shared_resources'])}\n"
                if prev_output and "参考技术方案" in base_prompt:
                    _slug = _title_slug(item.get("title", "")) if item.get("title") else ""
                    _prefix = f"wi-{item['id'][:8]}"
                    if _slug:
                        _prefix = f"{_prefix}-{_slug}"
                    if project_name:
                        _prefix = f"{_prefix}-{project_name}"
                    task_prompt += (
                        "\n请注意：上方「参考技术方案」已包含完整的实施方案，请严格遵循以下要求：\n"
                        "1. 直接按方案中涉及当前仓库的部分修改代码并自测\n"
                        "2. 不要生成规划类文档（包括但不限于：技术方案、修改点、实施计划、变更清单等），但【必须】生成测试报告\n"
                        "3. 代码改动以 git commit 体现\n"
                        f"4. 完成所有代码修改后，生成测试报告文件（命名格式：`{_prefix}-测试报告.md`），内容包含：改动点摘要、自测结果、需要重点验证的场景\n"
                        "5. 如方案中未涉及当前仓库的改动，直接输出「无需修改」并结束\n"
                    )
                if project_knowledge:
                    task_prompt += f"\n## 项目模块结构\n{project_knowledge}\n"
                task_prompt += "\n请只修改本仓库相关的代码。如果此需求不涉及本仓库，请输出'无需修改'并结束。"
                # 添加自动执行系统指令前缀 + 文档命名规范
                task_prompt = AUTO_EXEC_PREFIX + task_prompt + _doc_naming_instruction(item["id"], title=item.get("title", ""), project_name=project_name)

                # 复制工作项图片附件到当前目标仓库，并在 prompt 中提示 Agent 读取
                attachment_paths = _copy_work_item_attachments(item, project_cwd)
                if attachment_paths:
                    task_prompt += (
                        "\n\n## 附件图片\n"
                        "以下图片已复制到当前工作目录，请按需读取并参考：\n"
                        + "\n".join(f"- ./{p}" for p in attachment_paths)
                        + "\n"
                    )

                plan_task_def = {
                    "title": f"[{project_name}] {item['title'][:50]}",
                    "prompt": task_prompt,
                    "agent_id": agent_id,
                    "phase": phase,
                    "depends_on": backend_indices if is_frontend and backend_indices else [],
                    "project_id": project["project_id"],
                    "cwd": project_cwd,
                    "useWorktree": data.get("useWorktree", True),
                }
                plan_tasks.append(plan_task_def)

                if not is_frontend:
                    backend_indices.append(idx)

            if not plan_tasks:
                logger.error("[WorkItem] No valid projects in group %s", group_id[:8])
                return

            # 4. 创建 Plan
            plan_definition = {
                "tasks": plan_tasks,
                "max_parallel": min(len(plan_tasks), 3),
            }
            if coordination_doc:
                plan_definition["coordination"] = coordination_doc

            plan = await plan_service.create_plan(
                workspace_id="default",
                definition_json=plan_definition,
                cwd=primary_cwd,
                model=model,
            )

            plan_id = plan.get("id") if plan else None
            if plan_id:
                logger.info(
                    "[WorkItem] Cross-repo plan created: %s (%d tasks) for item '%s'",
                    plan_id[:8], len(plan_tasks), item["id"][:8],
                )

                # 将 plan 中第一个 task 的 id 关联到 transition
                plan_task_ids = plan.get("task_ids", [])
                first_task_id = plan_task_ids[0] if plan_task_ids else None

                # 如果 plan 返回中没有 task_ids，从数据库查询
                if not first_task_id:
                    async with async_session_factory() as session:
                        result = await session.execute(
                            text("""
                                SELECT task_id FROM plan_tasks
                                WHERE plan_id = :plan_id
                                ORDER BY task_index LIMIT 1
                            """),
                            {"plan_id": plan_id},
                        )
                        row = result.fetchone()
                        if row:
                            first_task_id = row[0]

                if first_task_id:
                    async with async_session_factory() as session:
                        await session.execute(
                            text("""
                                UPDATE work_item_transitions
                                SET task_id = :task_id
                                WHERE id = (
                                    SELECT id FROM work_item_transitions
                                    WHERE work_item_id = :item_id
                                      AND to_node_id = :node_id
                                      AND task_id IS NULL
                                    ORDER BY created_at DESC
                                    LIMIT 1
                                )
                            """),
                            {
                                "task_id": first_task_id,
                                "item_id": item["id"],
                                "node_id": node["id"],
                            },
                        )
                        await session.commit()
            else:
                logger.error(
                    "[WorkItem] Cross-repo plan creation failed for item '%s', falling back to single-repo mode",
                    item["id"][:8],
                )
                # Plan 创建失败 → 回退为单仓库模式，避免工作项状态被卡住
                try:
                    item_copy = dict(item)
                    item_copy.pop("group_id", None)
                    await self._trigger_agent_node(item_copy, node)
                except Exception as fallback_exc:
                    logger.exception(
                        "Fallback to single-repo agent failed for item %s: %s",
                        item["id"][:8], fallback_exc,
                    )

        except Exception as exc:
            logger.exception(
                "Failed to trigger group agent node for work item %s: %s",
                item["id"][:8], exc,
            )

    async def _trigger_approval_node(self, item: dict, node: dict):
        """
        Approval 节点：创建审批记录，审批通过后回调推进。
        在创建新审批前，先将同一工作项下旧的 pending 审批标记为 cancelled。
        """
        try:
            from backend.services.approval_service import approval_service

            # 幂等性检查：如果已有 pending 审批，直接返回
            existing_approvals = await approval_service.get_by_task(item["id"])
            pending_approval = next(
                (a for a in existing_approvals if a["status"] == "pending"),
                None
            )
            if pending_approval:
                logger.info(
                    "Approval already pending for work item %s (approval_id=%s), skipping creation",
                    item["id"][:8], pending_approval["id"][:8]
                )
                return

            # 清理同一工作项下旧的 pending 审批，防止累积过期记录
            cancelled_count = await approval_service.cleanup_task_approvals(item["id"])
            if cancelled_count > 0:
                logger.info(
                    "Cancelled %d stale pending approvals for work item %s before creating new one",
                    cancelled_count, item["id"][:8],
                )

            data = node.get("data", {})
            reason = data.get("label") or data.get("reason") or f"Work item approval: {item['title']}"

            await approval_service.create_approval(
                task_id=item["id"],  # 复用 task_id 字段存 work_item_id
                workspace_id="default",
                approval_type="work_item_transition",
                detail={
                    "work_item_id": item["id"],
                    "node_id": node["id"],
                    "reason": reason,
                },
            )

            logger.info(
                "Approval node triggered for work item %s at node %s",
                item["id"][:8], node["id"][:8],
            )

        except Exception as exc:
            logger.exception(
                "Failed to trigger approval node for work item %s: %s",
                item["id"][:8], exc,
            )

    async def _build_workflow_context(self, item: dict, definition: dict) -> dict:
        """从工作项 transitions 历史 + 工作项基本字段构建条件评估 context。

        与 workflow_engine 的 run.context 兼容的字段路径：
        - context.<node_id>.output  ← 之前节点的输出（agent 节点的文本输出 / approval 节点的
          "approved"|"rejected" 字面量）。
        - context.title/description/priority/assignee/tags ← 工作项基本字段。

        注意：工作项流转引擎独立于 workflow_engine 的运行实例（无 run_id），
        故此处通过扫描 work_item_transitions 历史来重建 context。
        """
        context: dict = {
            "title": item.get("title", ""),
            "description": item.get("description", ""),
            "priority": item.get("priority", 0),
            "assignee": item.get("assignee", ""),
            "tags": item.get("tags") or [],
        }
        try:
            transitions = await self.get_transitions(item["id"])
        except Exception:
            transitions = []

        node_map = {n["id"]: n for n in definition.get("nodes", [])}
        for tr in transitions:
            to_id = tr.get("to_node_id")
            from_id = tr.get("from_node_id")
            trigger = (tr.get("trigger_type") or "").lower()
            out_raw = tr.get("output") or ""

            # --- 处理 to_node_id 方向（agent 输出等非 approval 节点）---
            if to_id:
                to_node = node_map.get(to_id)
                ntype = (to_node.get("type") if to_node else "") or ""
                if ntype != "approval":
                    # agent / git_merge / 其他节点：output 归属于 to_node_id
                    # 取最新的有效 output（transitions 已按 created_at ASC 排序，后面的覆盖前面的）
                    node_ctx = context.get(to_id) if isinstance(context.get(to_id), dict) else {}
                    if out_raw:
                        node_ctx["output"] = out_raw
                    context[to_id] = node_ctx

            # --- 处理 from_node_id 方向（approval 结果）---
            # approval 节点的审批结果存储在离开该节点的 transition 的 trigger_type 中
            if from_id:
                from_node = node_map.get(from_id, {})
                if from_node.get("type") == "approval":
                    node_ctx = context.get(from_id) if isinstance(context.get(from_id), dict) else {}
                    if trigger == "approval_approved":
                        node_ctx["output"] = "approved"
                    elif trigger == "approval_rejected":
                        node_ctx["output"] = "rejected"
                    if out_raw:
                        node_ctx["log"] = out_raw
                    context[from_id] = node_ctx
        return context

    def _extract_prev_agent_output(self, context: dict, definition: dict, current_node_id: str, work_item_id: str = "") -> str:
        """向上游递归查找最近的 agent 节点输出。

        穿透 condition、approval、stage 等中间节点，
        直到找到第一个有 output 的 agent 节点。

        优先返回 agent_final_output（精炼的业务摘要），
        降级返回 output（完整日志，仅作兜底）。
        """
        edges = definition.get("edges", [])
        nodes = {n["id"]: n for n in definition.get("nodes", [])}

        visited = set()
        queue = [current_node_id]

        while queue:
            node_id = queue.pop(0)
            if node_id in visited:
                continue
            visited.add(node_id)

            # 找所有指向当前节点的上游节点
            upstream_ids = [e["source"] for e in edges if e.get("target") == node_id]

            for uid in upstream_ids:
                if uid in visited:
                    continue
                upstream_node = nodes.get(uid, {})

                # 如果是 agent 节点且有输出，返回
                if upstream_node.get("type") == "agent":
                    node_ctx = context.get(uid)
                    if isinstance(node_ctx, dict):
                        # 优先使用 agent_final_output（精炼摘要），降级使用 output
                        final_out = node_ctx.get("agent_final_output")
                        if not final_out:
                            # output 是完整日志（含大量工具调用），尝试提取最终结论部分
                            full_output = node_ctx.get("output", "")
                            if full_output:
                                # 取最后 3000 字符作为降级方案（通常结论在末尾）
                                final_out = full_output[-3000:] if len(full_output) > 3000 else full_output
                        if final_out:
                            logger.info(
                                "[work_item] _extract_prev_agent_output: found agent output at node=%s "
                                "for work_item=%s (len=%d)",
                                uid, work_item_id[:8] if work_item_id else "?", len(final_out),
                            )
                            return final_out

                # 否则继续向上游探索（穿透 condition、approval、stage 等节点）
                queue.append(uid)

        logger.warning(
            "[work_item] _extract_prev_agent_output: no upstream agent output found for node=%s work_item=%s",
            current_node_id, work_item_id[:8] if work_item_id else "?",
        )
        return ""

    async def _handle_condition_node(self, item: dict, node: dict, definition: dict):
        """
        Condition 节点：从工作流历史 context 评估条件并跳转到下一节点。

        支持两种配置：
        - 扁平字段：data.field / data.operator / data.value（与 workflow_engine 一致），
          匹配 → sourceHandle=yes 边，不匹配 → sourceHandle=no 边。
        - conditions 数组：每条 {field, operator, value, targetEdge?, sourceHandle?}。

        Fallback：仅在显式标记为 default/no/否/else 的边中选择，绝不盲目选第一条出边，
        避免审批拒绝被错误推进到 yes 分支。
        """
        try:
            data = node.get("data", {})
            edges = definition.get("edges", [])
            nodes = definition.get("nodes", [])
            node_map = {n["id"]: n for n in nodes}
            outgoing = [e for e in edges if e.get("source") == node["id"]]

            if not outgoing:
                logger.warning(
                    "[Condition] node=%s has no outgoing edges, work item %s stays.",
                    node.get("id"), item["id"][:8],
                )
                return

            context = await self._build_workflow_context(item, definition)
            chosen_edge = None

            # 扁平字段格式（field/operator/value）
            field = data.get("field") or ""
            if field:
                op = data.get("operator", "eq")
                expected = data.get("value")
                actual = self._resolve_context_path(field, context)
                matched = self._compare_values(actual, op, expected)
                logger.info(
                    "[Condition] node=%s field=%s actual=%r expected=%r op=%s matched=%s",
                    node.get("id"), field, actual, expected, op, matched,
                )
                handle = "yes" if matched else "no"
                chosen_edge = next(
                    (e for e in outgoing if e.get("sourceHandle") == handle), None
                )

            # conditions 数组格式
            if not chosen_edge:
                for cond in data.get("conditions") or []:
                    cond_field = cond.get("field", "")
                    cond_op = cond.get("operator", "eq")
                    cond_val = cond.get("value")
                    actual = self._resolve_context_path(cond_field, context)
                    if self._compare_values(actual, cond_op, cond_val):
                        target_edge_id = cond.get("targetEdge")
                        if target_edge_id:
                            chosen_edge = next(
                                (e for e in edges if e.get("id") == target_edge_id), None
                            )
                        if not chosen_edge:
                            target_handle = cond.get("targetHandle") or cond.get("sourceHandle")
                            if target_handle:
                                chosen_edge = next(
                                    (e for e in outgoing if e.get("sourceHandle") == target_handle),
                                    None,
                                )
                        break

            # Fallback：仅选择显式 default/no 边，不再盲选 outgoing[0]
            if not chosen_edge:
                chosen_edge = next(
                    (
                        e for e in outgoing
                        if (e.get("data") or {}).get("isDefault")
                        or (e.get("label") or "").strip().lower()
                        in ("default", "no", "否", "else")
                    ),
                    None,
                )
            if not chosen_edge:
                chosen_edge = next(
                    (e for e in outgoing if e.get("sourceHandle") == "no"), None
                )

            if not chosen_edge:
                logger.error(
                    "[Condition] node=%s could not determine edge for work item %s; "
                    "no default/no fallback edge available, work item stays.",
                    node.get("id"), item["id"][:8],
                )
                return

            target_node = node_map.get(chosen_edge.get("target"))
            if target_node:
                await self.transition_work_item(
                    item["id"],
                    target_node["id"],
                    operator="system",
                    trigger_type="condition",
                )

        except Exception as exc:
            logger.exception(
                "Failed to handle condition node for work item %s: %s",
                item["id"][:8], exc,
            )

    @staticmethod
    def _resolve_context_path(path: str, context: dict):
        """解析形如 'context.approval_1.output' 的路径，返回叶子值或 None。"""
        if not path:
            return None
        if path.startswith("context."):
            path = path[len("context."):]
        obj = context
        for part in path.split("."):
            if isinstance(obj, dict):
                obj = obj.get(part)
            else:
                return None
            if obj is None:
                return None
        return obj

    @staticmethod
    def _compare_values(actual, op: str, expected) -> bool:
        """宽松比较：字符串 strip+lower 等值；支持 eq/ne/contains/gt/lt 等别名。"""
        if actual is None:
            return False
        actual_str = str(actual).strip().lower()
        expected_str = str(expected).strip().lower() if expected is not None else ""
        op = (op or "eq").lower()
        if op in ("eq", "==", "equals"):
            return actual_str == expected_str
        if op in ("ne", "neq", "!=", "not_equals"):
            return actual_str != expected_str
        if op == "contains":
            return expected_str in actual_str
        if op in ("gt", ">"):
            try:
                return float(actual) > float(expected)
            except (TypeError, ValueError):
                return False
        if op in ("lt", "<"):
            try:
                return float(actual) < float(expected)
            except (TypeError, ValueError):
                return False
        return actual_str == expected_str

    async def _handle_delay_node(self, item: dict, node: dict, definition: dict):
        """
        Delay 节点：等待指定时间后推进到下一节点。
        """
        try:
            data = node.get("data", {})
            seconds = float(data.get("seconds", 1))
            await asyncio.sleep(max(0.0, seconds))

            # 找下游节点
            downstream = self._get_downstream_nodes(definition, node["id"])
            if downstream:
                next_node = downstream[0]
                await self.transition_work_item(
                    item["id"],
                    next_node["id"],
                    operator="system",
                    trigger_type="delay",
                )

        except Exception as exc:
            logger.exception(
                "Failed to handle delay node for work item %s: %s",
                item["id"][:8], exc,
            )

    async def _safe_trigger_git_merge(self, item: dict, node: dict):
        """包装 _trigger_git_merge_node，确保任何异常都被记录而不会被 asyncio 静默吞掉。"""
        try:
            await self._trigger_git_merge_node(item, node)
        except Exception as exc:
            logger.error(
                "[WorkItem] Failed to trigger git_merge node %s for work item %s: %s",
                (node.get("id") or "?"),
                (item.get("id") or "?"),
                exc,
                exc_info=True,
            )

    async def _resolve_version_branch(self, item: dict) -> str:
        """从工作项的 version_id 解析版本分支名。"""
        version_id = item.get("version_id")
        if not version_id:
            return ""
        async with async_session_factory() as session:
            row = await session.execute(
                text("SELECT name FROM versions WHERE id = :id"),
                {"id": version_id}
            )
            result = row.fetchone()
        if not result or not result[0]:
            return ""
        from backend.runtime.git_utils import version_branch_name
        return version_branch_name(result[0])

    async def _trigger_git_merge_node(self, item: dict, node: dict):
        """处理 git_merge 节点：将工作项所有相关分支（含 Plan 子任务分支）合入目标分支。
        
        项目组场景下，会按项目分组分别执行合并。
        """
        logger.info(
            "[WorkItem] _trigger_git_merge_node called: item=%s node=%s",
            item.get("id", "?"), node.get("id", "?"),
        )
        data = node.get("data", {})
        from backend.runtime.git_utils import work_item_branch_name
        target_branch = data.get("targetBranch", "")
        if not target_branch:
            # 优先使用版本分支
            version_branch = await self._resolve_version_branch(item)
            if version_branch:
                target_branch = version_branch
                logger.info("[work_item] git_merge: using version branch as target: %s", target_branch)
            else:
                target_branch = work_item_branch_name(item["id"])
        strategy = data.get("mergeStrategy", "merge")
        delete_source = data.get("deleteSource", False)  # 工作项场景默认不删除源分支
        on_conflict = data.get("onConflict", "fail")

        # 1. 收集工作项下所有相关分支（工作项分支 + Plan 子任务分支），含 cwd 信息
        # branch_records: list of {"branch": str, "worktree_path": str, "type": str, "cwd": str}
        branch_records: list[dict] = []
        seen_branches: set[str] = set()

        async with async_session_factory() as session:
            # 1a. 获取工作项自身的分支
            wi_rows = await session.execute(
                text("""
                    SELECT DISTINCT t.branch_name, t.worktree_path, t.cwd
                    FROM work_item_transitions wit
                    JOIN tasks t ON t.id = wit.task_id
                    WHERE wit.work_item_id = :item_id
                      AND t.branch_name IS NOT NULL
                      AND t.branch_name != ''
                    ORDER BY wit.created_at ASC
                """),
                {"item_id": item["id"]}
            )
            for row in wi_rows.fetchall():
                branch = row[0] or ""
                wt = row[1] or ""
                cwd = row[2] or ""
                if branch and branch not in seen_branches:
                    seen_branches.add(branch)
                    branch_records.append({"branch": branch, "worktree_path": wt, "type": "work_item", "cwd": cwd})

            # 1b. 获取 Plan 子任务的分支
            plan_rows = await session.execute(
                text("""
                    SELECT DISTINCT t2.branch_name, t2.worktree_path, t2.cwd
                    FROM work_item_transitions wit
                    JOIN tasks t ON t.id = wit.task_id
                    JOIN plan_tasks pt ON pt.plan_id = t.plan_id
                    JOIN tasks t2 ON t2.id = pt.task_id
                    WHERE wit.work_item_id = :item_id
                      AND t.plan_id IS NOT NULL
                      AND t2.branch_name IS NOT NULL
                      AND t2.branch_name != ''
                    ORDER BY pt.task_index ASC
                """),
                {"item_id": item["id"]}
            )
            for row in plan_rows.fetchall():
                branch = row[0] or ""
                wt = row[1] or ""
                cwd = row[2] or ""
                if branch and branch not in seen_branches:
                    seen_branches.add(branch)
                    branch_records.append({"branch": branch, "worktree_path": wt, "type": "plan_task", "cwd": cwd})

        # 2. 获取主项目路径（用于 fallback）
        from backend.runtime.git_utils import git_repo_root, git_merge_branch, cleanup_work_item_worktree, cleanup_plan_worktree, find_worktree_for_branch, git_command

        primary_cwd = await self._get_project_path(item["project_id"])
        if not primary_cwd:
            logger.error("[work_item] git_merge: cannot resolve project path for project_id=%s, skip merge", item.get("project_id"))
            await self._advance_past_node(item, node)
            return

        # 2b. 数据库未收集到分支时，从 Git 仓库直接扫描与工作项相关的分支
        #     手动拖拽场景下 work_item_transitions 可能缺少 task 关联，导致 DB 收集为空，
        #     此时依据分支命名约定（tide/wi-{id[:8]}）在实际仓库中查找现存分支。
        if not branch_records:
            from backend.runtime.git_utils import safe_git_ref_part
            short_id = (safe_git_ref_part(item["id"])[:8] if item.get("id") else "")
            if short_id:
                # 收集候选仓库路径：主项目 + 项目组内所有项目（项目组多项目场景需逐个查找）
                candidate_cwds: list[str] = [primary_cwd]
                group_id = item.get("group_id")
                if group_id:
                    try:
                        from backend.services.project_group_service import project_group_service
                        group_projects = await project_group_service.get_group_projects(group_id)
                        for p in group_projects:
                            gp_cwd = (p.get("cwd") or "").strip()
                            if gp_cwd and gp_cwd not in candidate_cwds:
                                candidate_cwds.append(gp_cwd)
                    except Exception as exc:
                        logger.warning(
                            "[work_item] git_merge: failed to load group projects for %s: %s",
                            group_id, exc,
                        )

                for repo_cwd in candidate_cwds:
                    if not repo_cwd:
                        continue
                    try:
                        code, output = await git_command(
                            Path(repo_cwd),
                            ["branch", "--list", f"tide/*{short_id}*"],
                            timeout=10,
                        )
                    except Exception as exc:
                        logger.debug(
                            "[work_item] git_merge: git branch --list failed in %s: %s",
                            repo_cwd, exc,
                        )
                        continue
                    if code != 0 or not output.strip():
                        continue
                    for line in output.strip().splitlines():
                        br = line.strip().lstrip("* ").strip()
                        # 排除目标分支本身与重复分支
                        if br and br != target_branch and br not in seen_branches:
                            seen_branches.add(br)
                            branch_records.append({
                                "branch": br,
                                "worktree_path": "",
                                "type": "git_scan",
                                "cwd": repo_cwd,
                            })
                            logger.info(
                                "[work_item] git_merge: found branch from git repo scan: %s (cwd=%s)",
                                br, repo_cwd,
                            )

        # Fallback：如果找不到任何分支
        if not branch_records:
            fallback_branch = data.get("sourceBranch", "")
            if not fallback_branch:
                fallback_branch = work_item_branch_name(item["id"])
                logger.info("[work_item] git_merge node: no branches found, using work item branch as source: %s", fallback_branch)
            branch_records.append({"branch": fallback_branch, "worktree_path": "", "type": "work_item", "cwd": primary_cwd})

        # 排除与目标分支相同的分支（no-op）
        branch_records = [r for r in branch_records if r["branch"] != target_branch]
        if not branch_records:
            logger.info("[work_item] git_merge: all source branches are same as target (%s), skipping merge", target_branch)
            await self._advance_past_node(item, node)
            return

        # 3. 按项目 repo 分组分支
        # 使用 git_repo_root 来确定每个分支所属的 repo
        repo_branch_map: dict[str, list[dict]] = {}  # repo_root_str -> [branch_records]

        for record in branch_records:
            cwd = record.get("cwd") or primary_cwd
            repo_root = await git_repo_root(Path(cwd))
            if repo_root is None:
                # 尝试从 worktree_path 获取
                wt = record.get("worktree_path", "")
                if wt:
                    repo_root = await git_repo_root(Path(wt))
            if repo_root is None:
                repo_root = await git_repo_root(Path(primary_cwd))
            if repo_root is None:
                logger.warning("[work_item] git_merge: cannot find repo root for cwd=%s, skip branch %s", cwd, record["branch"])
                continue
            repo_key = str(repo_root)
            if repo_key not in repo_branch_map:
                repo_branch_map[repo_key] = []
            repo_branch_map[repo_key].append(record)

        if not repo_branch_map:
            logger.error("[work_item] git_merge: no valid repos found, skip merge")
            await self._advance_past_node(item, node)
            return

        logger.info(
            "[work_item] git_merge: item=%s target=%s repos=%d branches_per_repo=%s",
            item["id"], target_branch,
            len(repo_branch_map),
            {Path(k).name: [r["branch"] for r in v] for k, v in repo_branch_map.items()},
        )

        # 4. 对每个 repo 分别执行合并
        all_repo_results: list[dict] = []  # {"repo": str, "project_name": str, "success": bool, "merged_results": [...]}

        for repo_root_str, repo_branches in repo_branch_map.items():
            repo_root = Path(repo_root_str)
            project_name = repo_root.name

            # 检查 target_branch 是否被 worktree 占用
            merge_root = repo_root
            wt_path = await find_worktree_for_branch(repo_root, target_branch)
            if wt_path:
                logger.info(
                    "[work_item] git_merge: target_branch '%s' is in worktree at '%s' (project: %s), will merge there",
                    target_branch, wt_path, project_name,
                )
                merge_root = Path(wt_path)

            # 逐一合并该 repo 下的分支（git_merge_branch 内部会自动创建不存在的目标分支）
            merged_results: list[dict] = []
            repo_all_success = True
            should_abort = False

            for record in repo_branches:
                if should_abort:
                    merged_results.append({
                        "branch": record["branch"],
                        "type": record["type"],
                        "success": False,
                        "output": "skipped due to previous conflict (on_conflict=manual)",
                        "conflicts": [],
                    })
                    continue

                source_branch = record["branch"]

                # 自动提交源分支 worktree 中的未提交变更，确保所有改动被纳入合并
                wt_path = record.get("worktree_path", "")
                if wt_path and Path(wt_path).exists():
                    from backend.runtime.git_utils import has_git_changes, commit_changes
                    try:
                        if await has_git_changes(Path(wt_path)):
                            commit_hash = await commit_changes(
                                Path(wt_path),
                                "chore: auto-commit pending changes before merge",
                            )
                            if commit_hash:
                                logger.info(
                                    "[work_item] git_merge: auto-committed dirty worktree %s on branch %s (commit=%s)",
                                    wt_path, source_branch, commit_hash,
                                )
                    except Exception as exc:
                        logger.warning(
                            "[work_item] git_merge: failed to auto-commit worktree %s: %s",
                            wt_path, exc,
                        )

                # 检查分支是否有实际改动，跳过无变更的分支
                try:
                    diff_code, diff_output = await git_command(
                        Path(merge_root),
                        ["diff", "--stat", f"{target_branch}..{source_branch}"],
                        timeout=10,
                    )
                    if diff_code == 0 and not diff_output.strip():
                        logger.info(
                            "[git_merge] branch %s has no changes vs %s, skipping",
                            source_branch, target_branch,
                        )
                        merged_results.append({
                            "branch": source_branch,
                            "type": record.get("type", ""),
                            "success": True,
                            "skipped": True,
                            "reason": "no_changes",
                            "output": "分支无实际改动，已跳过",
                        })
                        continue
                except Exception as exc:
                    logger.debug("[git_merge] diff check failed for %s: %s", source_branch, exc)
                    # diff 检查失败时仍然尝试合并（保守策略）

                success, output, conflicts = await git_merge_branch(
                    repo_root=merge_root,
                    source_branch=source_branch,
                    target_branch=target_branch,
                    strategy=strategy,
                    delete_source=delete_source,
                )

                merged_results.append({
                    "branch": source_branch,
                    "type": record["type"],
                    "success": success,
                    "output": output[:1000] if output else "",
                    "conflicts": conflicts or [],
                })

                if success:
                    logger.info(
                        "[work_item] git_merge success: item=%s project=%s source=%s target=%s",
                        item["id"], project_name, source_branch, target_branch,
                    )
                else:
                    repo_all_success = False
                    logger.warning(
                        "[work_item] git_merge failed: item=%s project=%s source=%s conflicts=%s",
                        item["id"], project_name, source_branch, conflicts,
                    )
                    if on_conflict == "manual":
                        should_abort = True

            # 合并成功后不再自动清理 worktree，保留以支持续聊和文档访问
            # 用户可通过"清理工作分支"按钮手动清理
            if repo_all_success:
                for record in repo_branches:
                    wt = record.get("worktree_path", "")
                    if wt:
                        logger.info(
                            "[work_item] git_merge: worktree preserved for continuation: branch=%s path=%s",
                            record["branch"], wt,
                        )

            all_repo_results.append({
                "repo": repo_root_str,
                "project_name": project_name,
                "success": repo_all_success,
                "merged_results": merged_results,
            })

        # 5. 汇总所有 repo 的结果
        overall_success = all(r["success"] for r in all_repo_results)

        if overall_success:
            logger.info(
                "[work_item] git_merge all repos merged successfully: item=%s repos=%d",
                item["id"], len(all_repo_results),
            )
            # auto push
            auto_push = data.get("autoPush", False)
            if auto_push:
                for repo_result in all_repo_results:
                    repo_root = Path(repo_result["repo"])
                    git_config = await self.get_project_git_config(item["project_id"])
                    repo_url = git_config.get("repo_url", "")
                    if repo_url:
                        from backend.runtime.git_utils import git_ensure_remote, git_push
                        remote_ok = await git_ensure_remote(repo_root, repo_url)
                        if remote_ok:
                            push_ok, push_output = await git_push(
                                repo_root, target_branch, git_config=git_config
                            )
                            if not push_ok:
                                logger.warning(
                                    "[work_item] auto push failed for %s (project: %s): %s",
                                    target_branch, repo_result["project_name"], push_output,
                                )

            # 记录合并结果到 metadata
            existing_meta = {}
            if item.get("metadata"):
                try:
                    existing_meta = json.loads(item["metadata"]) if isinstance(item["metadata"], str) else item["metadata"]
                except (json.JSONDecodeError, TypeError):
                    pass

            existing_meta["git_merge_result"] = {
                "success": True,
                "repos": [
                    {
                        "project_name": r["project_name"],
                        "merged_branches": [
                            {"branch": mr["branch"], "type": mr["type"], "success": mr["success"]}
                            for mr in r["merged_results"]
                        ],
                    }
                    for r in all_repo_results
                ],
                "target_branch": target_branch,
                "strategy": strategy,
                "auto_push": auto_push,
                "delete_source": delete_source,
                "timestamp": _now_iso(),
            }

            async with async_session_factory() as session:
                await session.execute(
                    text("UPDATE work_items SET metadata = :meta WHERE id = :id"),
                    {"meta": json.dumps(existing_meta, ensure_ascii=False), "id": item["id"]}
                )
                await session.commit()

            # 自动推进到下游节点
            merge_summary_lines = []
            for repo_result in all_repo_results:
                for mr in repo_result.get("merged_results", []):
                    branch = mr.get("branch", "unknown")
                    if mr.get("skipped"):
                        reason = mr.get("reason", "")
                        if reason == "no_changes":
                            merge_summary_lines.append(f"{branch}: 分支无实际改动，无需合并")
                        else:
                            merge_summary_lines.append(f"{branch}: 已跳过 ({reason})")
                    elif mr.get("success"):
                        merge_summary_lines.append(f"{branch} → {target_branch}: 已合并")
                    else:
                        error_msg = mr.get("output", "未知错误")[:200]
                        merge_summary_lines.append(f"{branch}: 合并失败 - {error_msg}")
            merge_output = "\n".join(merge_summary_lines) if merge_summary_lines else ""
            await self._advance_past_node(item, node, output=merge_output)
        else:
            # 存在合并失败的 repo
            failed_repo = next((r for r in all_repo_results if not r["success"]), None)
            first_failed = next(
                (mr for mr in (failed_repo["merged_results"] if failed_repo else []) if not mr["success"]),
                None
            )
            conflict_files = first_failed["conflicts"] if first_failed else []
            failed_output = first_failed["output"] if first_failed else ""

            # 构建清晰的错误信息：包含项目名、源分支、目标分支
            project_name = failed_repo["project_name"] if failed_repo else "unknown"
            source_branch_name = first_failed["branch"] if first_failed else "unknown"
            error_msg = (
                f"项目 [{project_name}] 合并失败：分支 {source_branch_name} → {target_branch}"
            ) if first_failed else "合并失败：未知错误"
            if failed_output:
                short_output = failed_output[:200].strip()
                error_msg += f"\n原因：{short_output}"
            if conflict_files:
                error_msg += f"\n冲突文件（{len(conflict_files)} 个）：{', '.join(conflict_files[:10])}"
            logger.warning("[work_item] git_merge conflict: item=%s error=%s", item["id"], error_msg)

            if on_conflict == "manual":
                # 暂停，等待人工处理
                existing_meta = {}
                if item.get("metadata"):
                    try:
                        existing_meta = json.loads(item["metadata"]) if isinstance(item["metadata"], str) else item["metadata"]
                    except (json.JSONDecodeError, TypeError):
                        pass
                existing_meta["git_merge_result"] = {
                    "success": False,
                    "repos": [
                        {
                            "project_name": r["project_name"],
                            "merged_branches": [
                                {"branch": mr["branch"], "type": mr["type"], "success": mr["success"]}
                                for mr in r["merged_results"]
                            ],
                        }
                        for r in all_repo_results
                    ],
                    "source_branch": source_branch_name,
                    "target_branch": target_branch,
                    "project_name": project_name,
                    "strategy": strategy,
                    "conflict": True,
                    "conflict_files": conflict_files,
                    "conflict_count": len(conflict_files),
                    "on_conflict": "manual",
                    "output": failed_output[:2000] if failed_output else "",
                    "timestamp": _now_iso(),
                }
                existing_meta["merge_conflict"] = True
                existing_meta["merge_conflict_data"] = {
                    "source_branch": source_branch_name,
                    "target_branch": target_branch,
                    "conflict_files": conflict_files,
                    "project_name": project_name,
                    "error_message": error_msg,
                    "worktree_path": next((r["worktree_path"] for r in (failed_repo["merged_results"] if failed_repo else []) if r.get("branch") == source_branch_name), ""),
                }
                async with async_session_factory() as session:
                    metadata = json.dumps(existing_meta, ensure_ascii=False)
                    await session.execute(
                        text("UPDATE work_items SET metadata = :meta WHERE id = :id"),
                        {"meta": metadata, "id": item["id"]}
                    )
                    await session.commit()
            else:
                # fail/abort: 记录错误，停留在当前节点等待处理
                logger.warning(
                    "[work_item] git_merge failed for item=%s, project=%s, failed_branch=%s, staying at current node",
                    item["id"], project_name, source_branch_name,
                )
                existing_meta = {}
                if item.get("metadata"):
                    try:
                        existing_meta = json.loads(item["metadata"]) if isinstance(item["metadata"], str) else item["metadata"]
                    except (json.JSONDecodeError, TypeError):
                        pass
                existing_meta["git_merge_result"] = {
                    "success": False,
                    "repos": [
                        {
                            "project_name": r["project_name"],
                            "merged_branches": [
                                {"branch": mr["branch"], "type": mr["type"], "success": mr["success"]}
                                for mr in r["merged_results"]
                            ],
                        }
                        for r in all_repo_results
                    ],
                    "source_branch": source_branch_name,
                    "target_branch": target_branch,
                    "project_name": project_name,
                    "strategy": strategy,
                    "conflict": True,
                    "conflict_files": conflict_files[:5] if conflict_files else [],
                    "conflict_count": len(conflict_files) if conflict_files else 0,
                    "on_conflict": "fail",
                    "output": failed_output[:2000] if failed_output else "",
                    "timestamp": _now_iso(),
                }
                existing_meta["git_merge_failed"] = True
                existing_meta["git_merge_conflicts"] = conflict_files[:5] if conflict_files else []
                existing_meta["merge_conflict_data"] = {
                    "source_branch": source_branch_name,
                    "target_branch": target_branch,
                    "conflict_files": conflict_files[:5] if conflict_files else [],
                    "project_name": project_name,
                    "error_message": error_msg,
                }
                async with async_session_factory() as session:
                    await session.execute(
                        text("UPDATE work_items SET metadata = :meta WHERE id = :id"),
                        {"meta": json.dumps(existing_meta, ensure_ascii=False), "id": item["id"]}
                    )
                    await session.commit()
                # 不推进：停留在 git_merge 节点，等待用户手动处理后重试

    async def _cleanup_work_item_branches(self, item: dict):
        """清理工作项关联的所有 worktree 目录和分支。
        
        在工作项到达终态（end/cancel/error）且未经过 git_merge 节点时调用，
        避免残留 worktree 目录和分支。
        """
        try:
            from backend.runtime.git_utils import (
                git_repo_root,
                cleanup_work_item_worktree,
                cleanup_plan_worktree,
            )

            # 收集所有关联分支和 worktree 信息
            branch_records: list[dict] = []
            async with async_session_factory() as session:
                # 工作项自身的分支
                wi_rows = await session.execute(
                    text("""
                        SELECT DISTINCT t.branch_name, t.worktree_path, t.cwd
                        FROM work_item_transitions wit
                        JOIN tasks t ON t.id = wit.task_id
                        WHERE wit.work_item_id = :item_id
                          AND t.branch_name IS NOT NULL
                          AND t.branch_name != ''
                    """),
                    {"item_id": item["id"]}
                )
                for row in wi_rows.fetchall():
                    branch_records.append({
                        "branch": row[0] or "",
                        "worktree_path": row[1] or "",
                        "cwd": row[2] or "",
                        "type": "work_item",
                    })

                # Plan 子任务的分支
                plan_rows = await session.execute(
                    text("""
                        SELECT DISTINCT t2.branch_name, t2.worktree_path, t2.cwd
                        FROM work_item_transitions wit
                        JOIN tasks t ON t.id = wit.task_id
                        JOIN plan_tasks pt ON pt.plan_id = t.plan_id
                        JOIN tasks t2 ON t2.id = pt.task_id
                        WHERE wit.work_item_id = :item_id
                          AND t.plan_id IS NOT NULL
                          AND t2.branch_name IS NOT NULL
                          AND t2.branch_name != ''
                    """),
                    {"item_id": item["id"]}
                )
                for row in plan_rows.fetchall():
                    branch_records.append({
                        "branch": row[0] or "",
                        "worktree_path": row[1] or "",
                        "cwd": row[2] or "",
                        "type": "plan_task",
                    })

            if not branch_records:
                return

            # 获取主项目路径
            primary_cwd = await self._get_project_path(item["project_id"])

            for record in branch_records:
                cwd = record.get("cwd") or primary_cwd
                if not cwd:
                    continue

                repo_root = await git_repo_root(Path(cwd))
                if repo_root is None and record.get("worktree_path"):
                    # worktree_path 的父目录可能能定位 repo
                    wt_parent = Path(record["worktree_path"]).parent.parent.parent
                    repo_root = await git_repo_root(wt_parent)
                if repo_root is None:
                    continue

                wt = record.get("worktree_path", "")
                branch = record.get("branch", "")

                if record["type"] == "plan_task":
                    await cleanup_plan_worktree(
                        worktree_path=wt,
                        branch_name=branch,
                        repo_root=repo_root,
                    )
                else:
                    await cleanup_work_item_worktree(
                        worktree_path=wt,
                        branch_name=branch,
                        repo_root=repo_root,
                    )

            logger.info(
                "[work_item] _cleanup_work_item_branches: cleaned %d branches for item=%s",
                len(branch_records), item["id"][:8],
            )
        except Exception as e:
            logger.warning(
                "[work_item] _cleanup_work_item_branches failed for item=%s: %s",
                item.get("id", "?")[:8], e,
            )

    async def _advance_past_node(self, item: dict, node: dict, output: str = ""):
        """自动推进工作项到指定节点的下游节点。"""
        definition = await self._load_workflow_definition(item["workflow_id"])
        if not definition:
            return
        downstream = self._get_downstream_nodes(definition, node["id"])
        if downstream:
            next_node = downstream[0]
            await self.transition_work_item(
                item["id"],
                next_node["id"],
                operator="system",
                trigger_type="git_merge_completed",
                output=output,
            )

    # ── 回调 ─────────────────────────────────────────────

    async def _get_project_repo_url(self, project_id: Optional[str]) -> Optional[str]:
        """获取项目的 Git 远程仓库 URL（用于构造 commit/PR 链接）。"""
        if not project_id:
            return None
        try:
            git_config = await self.get_project_git_config(project_id)
        except Exception as exc:
            logger.warning(
                "Failed to load git config for project %s: %s", project_id, exc,
            )
            return None
        if not isinstance(git_config, dict):
            return None
        url = (
            git_config.get("repo_url")
            or git_config.get("remote_url")
            or git_config.get("url")
            or ""
        )
        return url or None

    @staticmethod
    def _infer_url_label(url: str) -> str:
        """从 URL 推断一个可读的 label。"""
        try:
            from urllib.parse import urlparse

            parsed = urlparse(url)
            path = (parsed.path or "").rstrip("/")
            if not path or path == "":
                return parsed.netloc or url
            last_segment = path.split("/")[-1]
            if "." in last_segment:
                return last_segment
            parts = [p for p in path.split("/") if p]
            if len(parts) >= 2:
                return "/".join(parts[-2:])
            return last_segment or parsed.netloc or url
        except Exception:
            return url

    @staticmethod
    def _build_repo_base_url(repo_url: Optional[str]) -> str:
        """归一化仓库 URL，去掉 .git 后缀并把 git@host:path 转为 https。

        返回空串表示无可用 URL。
        """
        if not repo_url:
            return ""
        clean = repo_url.strip().rstrip("/")
        if clean.endswith(".git"):
            clean = clean[:-4]
        if clean.startswith("git@") and ":" in clean:
            try:
                host_and_path = clean[len("git@"):]
                host, path = host_and_path.split(":", 1)
                clean = f"https://{host}/{path}"
            except ValueError:
                pass
        return clean

    @classmethod
    def _build_commit_url(cls, repo_url: Optional[str], commit_hash: str) -> str:
        """基于仓库 URL 构造 commit 链接，兼容 GitHub/GitLab/Gitee 等常见格式。

        无 repo_url 时返回空字符串（前端可降级展示 commit 短哈希）。
        """
        if not commit_hash:
            return ""
        clean = cls._build_repo_base_url(repo_url)
        if not clean:
            return ""
        return f"{clean}/commit/{commit_hash}"

    @classmethod
    def _build_file_url(cls, repo_url: Optional[str], commit_hash: str, file_path: str) -> str:
        """基于仓库 URL 构造单文件链接，兼容 GitHub/GitLab/Gitee。

        无 repo_url 时返回空字符串（前端可降级仅展示文件名）。
        """
        if not commit_hash or not file_path:
            return ""
        clean = cls._build_repo_base_url(repo_url)
        if not clean:
            return ""
        # GitLab 使用 /-/blob/，GitHub/Gitee 使用 /blob/
        if "gitlab" in clean.lower():
            return f"{clean}/-/blob/{commit_hash}/{file_path}"
        return f"{clean}/blob/{commit_hash}/{file_path}"

    @staticmethod
    def _is_commit_pushed(repo_path: str, commit_hash: str) -> bool:
        """检查指定 commit 是否已 push 到远程分支。

        通过 `git branch -r --contains {commit_hash}` 判断：
        有输出说明已 push，否则未 push。
        任何异常（超时/路径不存在等）默认返回 False（保守策略，使用本地链接）。
        """
        if not repo_path or not commit_hash:
            return False
        try:
            import subprocess

            result = subprocess.run(
                ["git", "branch", "-r", "--contains", commit_hash],
                cwd=repo_path,
                capture_output=True,
                text=True,
                timeout=5,
            )
            return bool(result.stdout.strip())
        except Exception:
            return False

    @staticmethod
    def _decode_git_path(path: str) -> str:
        """解码 git 输出中的八进制转义路径。

        git 对含非 ASCII 字符的文件名会输出如 "docs/\346\265\213\350\257\225.md" 格式，
        本方法将其解码为正常 UTF-8 字符串。
        """
        # 移除首尾引号
        path = path.strip('"')
        # 如果不含八进制转义，直接返回
        if not re.search(r'\\[0-9]{3}', path):
            return path
        # 解码八进制转义 \nnn → 对应字节，然后 UTF-8 解码
        parts = re.split(r'(\\[0-9]{3})', path)
        result = b''
        for part in parts:
            if re.match(r'\\[0-9]{3}', part):
                result += bytes([int(part[1:], 8)])
            else:
                result += part.encode('utf-8')
        try:
            return result.decode('utf-8')
        except (UnicodeDecodeError, ValueError):
            return path

    @staticmethod
    def _is_valid_file_path(path: str) -> bool:
        """检查路径是否有效（不含 git 八进制转义或异常引号）。"""
        # git 对含非 ASCII 字符的文件名会输出八进制转义 \nnn
        if re.search(r'\\[0-9]{3}', path):
            return False
        # 路径中不应包含引号
        if '"' in path or "'" in path:
            return False
        return True

    @staticmethod
    async def _get_commit_changed_files(
        worktree_path: str, commit_hash: str
    ) -> List[str]:
        """获取指定 commit 涉及的文件路径列表（相对仓库根）。

        失败时返回空列表，不抛异常。
        """
        if not worktree_path or not commit_hash:
            return []
        try:
            import subprocess

            result = subprocess.run(
                [
                    "git",
                    "diff-tree",
                    "--no-commit-id",
                    "--name-only",
                    "-r",
                    commit_hash,
                ],
                cwd=str(worktree_path),
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode != 0:
                return []
            return [
                line.strip()
                for line in (result.stdout or "").splitlines()
                if line.strip()
            ]
        except Exception as exc:
            logger.warning("Failed to get changed files for %s: %s", commit_hash[:7], exc)
            return []

    async def _extract_and_save_artifacts(
        self,
        work_item_id: str,
        task_id: str,
        output,
        *,
        commit_hash: Optional[str] = None,
        branch_name: Optional[str] = None,
        project_id: Optional[str] = None,
        changed_files: Optional[List[str]] = None,
        worktree_path: Optional[str] = None,
        source_project: Optional[str] = None,
    ) -> None:
        """从任务完成信息中提取产物并追加到 work_item.metadata.artifacts。

        产物来源（按优先级）：
        1. Commit 中变更的文件链接（最重要 —— 用户最关心生成了什么文档）。
        2. 从 Agent 文本输出中解析出的创建文件路径（兜底，覆盖未自动 commit 的情况）。
        3. Git Commit：基于项目 git 远程仓库构造 commit 链接（作为总体变更汇总入口）。
        4. Agent 文本输出中嵌入的 http(s) URL（最多 3 个，排除 localhost）。
        5. A2A 结构化 artifacts（output 是 JSON 且含 artifacts 数组时）。

        说明：不再生成内部 Task Detail 链接（用户明确不需要）。

        容错设计：任何异常只记录日志，不中断主流程。
        """
        artifacts: list = []

        def _infer_file_stage(filename: str, file_path: str = "") -> str:
            """根据文件名/路径推断产物分类：测试报告→test，文档→doc，其余→code。

            分类规则（按优先级）：
            1. 测试报告关键词 → test（优先级最高，避免测试报告 .md 被误归为 doc）。
            2. 所有 .md/.markdown 文件 → doc（.md 本身即文档格式，与路径无关）。
            3. docs/ 目录下的文件 → doc。
            4. 文件名含文档类关键词（报告/分析/方案/设计等）→ doc。
            5. 其余 → code。
            """
            lower = filename.lower()
            path_lower = file_path.lower() if file_path else ""
            # 1. 测试报告（优先级最高）
            if "测试报告" in lower or "test-report" in lower or "test_report" in lower:
                return "test"
            # 2. 所有 Markdown 文件均视为文档
            if lower.endswith(".md") or lower.endswith(".markdown"):
                return "doc"
            # 3. docs/ 目录下的文件一律视为文档
            if path_lower.startswith("docs/") or "/docs/" in path_lower:
                return "doc"
            # 4. 文件名含文档类关键词（覆盖无扩展名或非 .md 的文档，如“DDD-研究报告”）
            doc_keywords = (
                "技术方案", "修改点", "测试用例", "研究报告", "分析报告", "架构设计",
                "报告", "分析", "方案", "设计",
                "tech-solution", "design-doc", "modification",
                "architecture", "analysis", "report", "proposal",
                "specification", "spec",
            )
            for kw in doc_keywords:
                if kw in lower:
                    return "doc"
            return "code"

        # 提前获取 repo_url 与 project_path，供文件链接与 commit 链接复用
        repo_url: Optional[str] = None
        project_path: Optional[str] = None
        if project_id:
            try:
                repo_url = await self._get_project_repo_url(project_id)
            except Exception:
                repo_url = None
            try:
                project_path = await self._get_project_path(project_id)
            except Exception:
                project_path = None

        def _build_local_file_url(rel_path: str) -> str:
            """构建本地文件 API 链接，供前端 /docs/view 页面渲染。

            格式: /api/files/content?path={absolute_path}
            当 project_path 不可用时返回空字符串。
            """
            if not project_path:
                return ""
            from urllib.parse import quote
            abs_path = os.path.join(project_path, rel_path) if not os.path.isabs(rel_path) else rel_path
            return f"/api/files/content?path={quote(abs_path, safe='/')}"

        # 判断 commit 是否已 push 到远程（决定使用 GitLab 链接还是本地链接）
        repo_path = worktree_path or project_path or ""
        is_pushed = False
        if commit_hash and repo_path and os.path.isdir(repo_path):
            is_pushed = self._is_commit_pushed(repo_path, commit_hash)

        # 1. 变更文件产物（最优先）
        if changed_files and commit_hash:
            for file_path in list(changed_files)[:10]:
                if not file_path:
                    continue
                # 解码 git 八进制转义路径（如含中文的文件名）
                file_path = self._decode_git_path(file_path)
                # 跳过解码后仍无效的路径
                if not self._is_valid_file_path(file_path):
                    logger.debug("Skipping invalid file path in artifacts: %s", file_path)
                    continue
                file_url = ""
                if is_pushed and repo_url:
                    file_url = self._build_file_url(repo_url, commit_hash, file_path)
                if not file_url:
                    file_url = _build_local_file_url(file_path)
                file_name = file_path.rsplit("/", 1)[-1] or file_path
                art_entry = {
                    "id": str(uuid.uuid4()),
                    "type": "file",
                    "label": file_name,
                    "stage": _infer_file_stage(file_name, file_path),
                    "url": file_url,
                    "file_path": file_path,
                    "commit_hash": commit_hash,
                    "created_at": _now_iso(),
                    "task_id": task_id,
                }
                if source_project:
                    art_entry["source_project"] = source_project
                artifacts.append(art_entry)

        # 2. 从 Agent 文本输出中提取生成的文件路径（兜底）
        if output and isinstance(output, str):
            # 2a. Bridge 回传的文件产物块：--- File: <relative_path> ---\n<content>
            #     这些内容需持久化，因为 freeform 模式（无 worktree/无 git commit）下
            #     源文件会在任务结束后丢失，仅靠 file_path 引用会导致 content API 404。
            handled_paths: set = set()
            try:
                block_pattern = re.compile(
                    r"---\s*File:\s*(.+?)\s*---\n(.*?)(?=\n---\s*File:|\Z)",
                    re.DOTALL,
                )
                blocks = block_pattern.findall(output)
            except re.error:
                blocks = []
            for raw_path, block_content in blocks[:10]:
                raw_path = (raw_path or "").strip().strip("`'\"")
                if not raw_path:
                    continue
                relative_path = raw_path
                if project_path and raw_path.startswith(project_path):
                    relative_path = raw_path[len(project_path):].lstrip("/")
                handled_paths.add(relative_path)
                handled_paths.add(raw_path)

                art_id = str(uuid.uuid4())
                file_name = relative_path.rsplit("/", 1)[-1] or relative_path
                # 持久化回传的文件内容到 attachments 目录
                stored_path = _persist_artifact_content(
                    work_item_id, art_id, file_name, block_content or ""
                )

                file_url = ""
                if is_pushed and repo_url and commit_hash:
                    file_url = self._build_file_url(repo_url, commit_hash, relative_path)
                if not file_url:
                    file_url = _build_local_file_url(relative_path)

                art_entry = {
                    "id": art_id,
                    "type": "file",
                    "label": file_name,
                    "stage": _infer_file_stage(file_name, relative_path),
                    "url": file_url,
                    "file_path": relative_path,
                    "commit_hash": commit_hash or "",
                    "created_at": _now_iso(),
                    "task_id": task_id,
                }
                if stored_path:
                    art_entry["stored_path"] = stored_path
                if source_project:
                    art_entry["source_project"] = source_project
                artifacts.append(art_entry)

            # 2b. 其余纯路径提示模式（无内容，仅记录引用）
            file_patterns = [
                r"File created successfully at:\s*(.+?)(?:\n|$)",
                r"Created file:\s*(.+?)(?:\n|$)",
                r"写入文件[:：]\s*(.+?)(?:\n|$)",
            ]
            extracted_files: list = []
            for pattern in file_patterns:
                try:
                    matches = re.findall(pattern, output)
                except re.error:
                    matches = []
                for m in matches:
                    val = (m or "").strip().strip("`'\"")
                    if val:
                        extracted_files.append(val)

            if extracted_files:
                for raw_path in extracted_files[:10]:
                    relative_path = raw_path
                    if project_path and raw_path.startswith(project_path):
                        relative_path = raw_path[len(project_path):].lstrip("/")
                    # 已由 2a 的 Bridge 文件块处理过则跳过，避免重复
                    if relative_path in handled_paths or raw_path in handled_paths:
                        continue

                    file_url = ""
                    if is_pushed and repo_url and commit_hash:
                        file_url = self._build_file_url(
                            repo_url, commit_hash, relative_path
                        )
                    if not file_url:
                        file_url = _build_local_file_url(relative_path)

                    file_name = relative_path.rsplit("/", 1)[-1] or relative_path
                    artifacts.append({
                        "id": str(uuid.uuid4()),
                        "type": "file",
                        "label": file_name,
                        "stage": _infer_file_stage(file_name, relative_path),
                        "url": file_url,
                        "file_path": relative_path,
                        "commit_hash": commit_hash or "",
                        "created_at": _now_iso(),
                        "task_id": task_id,
                    })

        # 3. Git Commit 产物（仅在已 push 时生成，未 push 的 commit 无法通过远程链接访问）
        if commit_hash and is_pushed:
            commit_url = self._build_commit_url(repo_url, commit_hash)
            label = f"Commit {commit_hash[:7]}"
            if branch_name:
                label = f"{label} ({branch_name})"
            artifacts.append({
                "id": str(uuid.uuid4()),
                "type": "commit",
                "label": label,
                "stage": "code",
                "url": commit_url,
                "commit_hash": commit_hash,
                "branch": branch_name or "",
                "created_at": _now_iso(),
                "task_id": task_id,
            })

        # 4. 从 Agent 文本输出中提取 http(s) URL
        if output and isinstance(output, str):
            try:
                urls = re.findall(r"https?://(?!localhost)[^\s<>\"')\]]+", output)
            except re.error:
                urls = []
            seen: set = set()
            for raw_url in urls:
                if len(seen) >= 3:
                    break
                clean_url = raw_url.rstrip(".,;:!?")
                if not clean_url or clean_url in seen:
                    continue
                # 排除飞书 API / Webhook URL（非产物）
                if "/open-apis/" in clean_url:
                    continue
                seen.add(clean_url)
                artifacts.append({
                    "id": str(uuid.uuid4()),
                    "type": "url",
                    "label": self._infer_url_label(clean_url),
                    "stage": "output",
                    "url": clean_url,
                    "created_at": _now_iso(),
                    "task_id": task_id,
                })

        # 5. 结构化 A2A artifacts（output 为 JSON 时）
        if output and isinstance(output, str):
            try:
                output_data = json.loads(output)
            except (json.JSONDecodeError, TypeError, ValueError):
                output_data = None
            if isinstance(output_data, dict) and isinstance(output_data.get("artifacts"), list):
                for art in output_data["artifacts"]:
                    if not isinstance(art, dict):
                        continue
                    art_url = art.get("url", "") or ""
                    art_text = art.get("text") or art.get("content") or ""
                    if not art_url and not art_text:
                        continue
                    art_label = art.get("name") or art.get("title") or "Document"
                    artifacts.append({
                        "id": art.get("id") or art.get("artifactId") or str(uuid.uuid4()),
                        "type": art.get("type", "document"),
                        "label": art_label,
                        "stage": "output",
                        "url": art_url,
                        "content": art_text[:2000] if isinstance(art_text, str) else "",
                        "created_at": _now_iso(),
                        "task_id": task_id,
                    })

        # 产物去重：同名文件只保留首次出现的记录（来自 changed_files 优先于 output 提取）
        if artifacts:
            seen_files: set = set()
            deduped: list = []
            for art in artifacts:
                if art.get("type") == "file":
                    key = art.get("file_path") or art.get("label") or ""
                    if key in seen_files:
                        continue
                    seen_files.add(key)
                    # 同时用 label（文件名）兜底去重，避免相对路径/绝对路径差异导致的重复
                    name_key = f"__name__:{art.get('label', '')}"
                    if name_key in seen_files:
                        continue
                    seen_files.add(name_key)
                deduped.append(art)
            artifacts = deduped

        if not artifacts:
            return

        # 追加到 work_item.metadata.artifacts
        try:
            async with async_session_factory() as session:
                row_result = await session.execute(
                    text("SELECT metadata FROM work_items WHERE id = :id"),
                    {"id": work_item_id},
                )
                row = row_result.fetchone()
                if not row:
                    return
                metadata_raw = dict(row._mapping).get("metadata")
                metadata = _safe_json_loads(metadata_raw, {}) or {}
                if not isinstance(metadata, dict):
                    metadata = {}
                existing = metadata.get("artifacts") or []
                if not isinstance(existing, list):
                    existing = []

                # 全局去重：
                # 1) 幂等性保护：若同一 task_id 已有 file 类型产物，整批跳过（避免重复收集）
                #    注意：仅当该 task_id 已有 file 产物时才跳过，因为上层可能只保存了 url/output
                #    产物而未收集到 commit 文件（Agent 自行提交时 commit_hash 可能为空），
                #    此时 plan 子任务收集流程应能补充收集文件产物。
                # 2) 否则按 type 分别比对：file 用 file_path/label、commit 用 commit_hash、url 用 url
                existing_task_ids_with_files = {
                    e.get("task_id")
                    for e in existing
                    if isinstance(e, dict) and e.get("task_id") and e.get("type") == "file"
                }
                if task_id and task_id in existing_task_ids_with_files:
                    return

                existing_file_keys: set = set()
                existing_commit_keys: set = set()
                existing_url_keys: set = set()
                for e in existing:
                    if not isinstance(e, dict):
                        continue
                    e_type = e.get("type")
                    if e_type == "file":
                        fp = e.get("file_path") or ""
                        lb = e.get("label") or ""
                        e_src = e.get("source_project") or ""
                        # 使用 source_project 作为命名空间，避免多项目同名文件互相去重
                        if fp:
                            existing_file_keys.add(f"path:{e_src}:{fp}")
                        if lb:
                            existing_file_keys.add(f"name:{e_src}:{lb}")
                    elif e_type == "commit":
                        ch = e.get("commit_hash") or ""
                        if ch:
                            existing_commit_keys.add(ch)
                    elif e_type == "url":
                        u = e.get("url") or ""
                        if u:
                            existing_url_keys.add(u)

                filtered_new: list = []
                for art in artifacts:
                    a_type = art.get("type")
                    if a_type == "file":
                        fp = art.get("file_path") or ""
                        lb = art.get("label") or ""
                        a_src = art.get("source_project") or ""
                        if (fp and f"path:{a_src}:{fp}" in existing_file_keys) or (
                            lb and f"name:{a_src}:{lb}" in existing_file_keys
                        ):
                            continue
                        if fp:
                            existing_file_keys.add(f"path:{a_src}:{fp}")
                        if lb:
                            existing_file_keys.add(f"name:{a_src}:{lb}")
                    elif a_type == "commit":
                        ch = art.get("commit_hash") or ""
                        if ch and ch in existing_commit_keys:
                            continue
                        if ch:
                            existing_commit_keys.add(ch)
                    elif a_type == "url":
                        u = art.get("url") or ""
                        if u and u in existing_url_keys:
                            continue
                        if u:
                            existing_url_keys.add(u)
                    filtered_new.append(art)

                if not filtered_new:
                    return

                # 统一代入产物在线查看 URL：凡是 file:// 或空 URL 且有 file_path
                # 的产物，都指向前端 /docs/view 页面，由其调用后端
                # /api/work-items/{item_id}/artifacts/{art_id}/content 拉取
                # Markdown 文本并渲染。title 使用产物 label 经 URL 编码。
                for art in filtered_new:
                    try:
                        url_val = art.get("url") or ""
                        file_path_val = art.get("file_path") or ""
                        art_id = art.get("id") or ""
                        if file_path_val and art_id and (
                            not url_val or url_val.startswith("file://") or url_val.startswith("/api/files/content")
                        ):
                            content_path = (
                                f"/api/work-items/{work_item_id}"
                                f"/artifacts/{art_id}/content"
                            )
                            label = art.get("label") or os.path.basename(file_path_val)
                            art["url"] = (
                                f"/docs/view?url={quote(content_path, safe='')}"
                                f"&title={quote(str(label), safe='')}"
                            )
                    except Exception:
                        continue

                existing.extend(filtered_new)
                metadata["artifacts"] = existing

                await session.execute(
                    text("UPDATE work_items SET metadata = :meta WHERE id = :id"),
                    {"id": work_item_id, "meta": json.dumps(metadata, ensure_ascii=False)},
                )
                await session.commit()
        except Exception as exc:
            logger.warning(
                "Failed to save artifacts for work_item %s: %s", work_item_id, exc,
            )
            return

        logger.info(
            "[work_item] saved %d artifact(s) for item=%s task=%s",
            len(artifacts), work_item_id[:8], task_id[:8],
        )

    async def _collect_plan_subtask_artifacts(self, work_item_id: str, task_id: str) -> None:
        """收集 Plan 所有子任务的产物文件并生成汇总测试报告。

        当 task 关联了 plan_id 时，遍历该 Plan 的所有子任务：
        1. 收集每个子任务 worktree 中的变更文件作为产物（各子任务独立测试报告保留为 stage="test"）
        2. 从每个子任务的 agent_final_output 中提取测试报告段落
        3. 生成一份汇总测试报告（包含概述、代码改动摘要、各项目测试报告、测试要点）
        4. 汇总报告写入工作项 worktree 的 docs/ 目录并作为 stage="test" 产物记录

        容错：任何单个子任务的失败不影响其他子任务的产物收集。
        """
        # 查询当前 task 是否关联 Plan
        async with async_session_factory() as session:
            row = (await session.execute(
                text("SELECT plan_id, worktree_path FROM tasks WHERE id = :id"),
                {"id": task_id},
            )).fetchone()
        if not row:
            return
        task_data = dict(row._mapping)
        plan_id = task_data.get("plan_id")
        if not plan_id:
            return

        # 查询 Plan 下所有子任务
        async with async_session_factory() as session:
            result = await session.execute(
                text("""
                    SELECT t.id, t.cwd, t.worktree_path, t.branch_name, t.agent_final_output
                    FROM tasks t
                    JOIN plan_tasks pt ON pt.task_id = t.id
                    WHERE pt.plan_id = :plan_id
                    ORDER BY pt.task_index
                """),
                {"plan_id": plan_id},
            )
            subtask_rows = [dict(r._mapping) for r in result.fetchall()]

        if not subtask_rows:
            return

        logger.info(
            "[work_item] collecting artifacts from %d plan subtasks for item=%s plan=%s",
            len(subtask_rows), work_item_id[:8], plan_id[:8],
        )

        # 收集子任务执行摘要（用于汇总报告增强）
        subtask_summaries: list = []  # [(index, title, status, commit_msg)]
        execution_stats: dict = {"total": 0, "completed": 0, "failed": 0, "cancelled": 0}
        try:
            async with async_session_factory() as session:
                summary_result = await session.execute(
                    text("""
                        SELECT pt.task_index,
                               t.status as task_status,
                               t.commit_message,
                               t.created_at,
                               t.completed_at,
                               t.cwd
                        FROM plan_tasks pt
                        LEFT JOIN tasks t ON pt.task_id = t.id
                        WHERE pt.plan_id = :plan_id
                        ORDER BY pt.task_index
                    """),
                    {"plan_id": plan_id},
                )
                summary_rows = [dict(r._mapping) for r in summary_result.fetchall()]
            execution_stats["total"] = len(summary_rows)
            for sr in summary_rows:
                st = (sr.get("task_status") or "").lower()
                if st in ("completed", "done", "success"):
                    execution_stats["completed"] += 1
                elif st in ("failed", "error"):
                    execution_stats["failed"] += 1
                elif st in ("cancelled", "canceled"):
                    execution_stats["cancelled"] += 1
                # 从 cwd 提取项目名，或从 commit_message 提取标题
                sr_cwd = sr.get("cwd") or ""
                sr_commit_msg = sr.get("commit_message") or ""
                if sr_cwd:
                    sr_title = Path(sr_cwd).name
                elif sr_commit_msg:
                    sr_title = sr_commit_msg[:50]
                else:
                    sr_title = f"子任务-{sr.get('task_index', '?')}"
                subtask_summaries.append({
                    "index": sr.get("task_index", 0),
                    "title": sr_title,
                    "status": st or "unknown",
                    "created_at": sr.get("created_at") or "",
                    "completed_at": sr.get("completed_at") or "",
                    "commit_msg": "",
                })
        except Exception as exc:
            logger.warning(
                "[work_item] failed to collect subtask summaries: %s (type=%s)",
                str(exc)[:300], type(exc).__name__,
            )
            if "no such column" in str(exc).lower():
                logger.error("[work_item] SCHEMA MISMATCH: plan_tasks query references non-existent columns, fix SQL")

        # 收集每个子任务的变更文件产物 + 变更文件列表（合并为单次循环）
        project_changed_files: dict = {}  # project_name -> list of files
        for sub_idx, sub in enumerate(subtask_rows):
            sub_id = sub.get("id", "")
            sub_wt = sub.get("worktree_path") or sub.get("cwd") or ""
            sub_branch = sub.get("branch_name") or ""
            if not sub_wt or not os.path.isdir(sub_wt):
                continue

            sub_cwd = sub.get("cwd") or ""
            project_name = Path(sub_cwd).name if sub_cwd else f"task-{sub_id[:8]}"

            try:
                from backend.runtime.git_utils import git_command
                code, log_output = await git_command(
                    Path(sub_wt), ["log", "-1", "--format=%H||%s"], timeout=5
                )
                if code != 0 or not log_output.strip():
                    continue
                log_parts = log_output.strip().split("||", 1)
                sub_commit = log_parts[0].strip()
                sub_commit_msg = log_parts[1].strip() if len(log_parts) > 1 else ""
                if not sub_commit:
                    continue

                # 更新 subtask_summaries commit_msg
                if sub_idx < len(subtask_summaries):
                    subtask_summaries[sub_idx]["commit_msg"] = sub_commit_msg

                # 获取变更文件
                changed = await self._get_commit_changed_files(sub_wt, sub_commit)
                if changed:
                    existing = project_changed_files.get(project_name, [])
                    existing = list(set(existing + changed))
                    project_changed_files[project_name] = existing

                    # 产物收集
                    await self._extract_and_save_artifacts(
                        work_item_id,
                        sub_id,
                        "",  # 不重复解析 output 文本
                        commit_hash=sub_commit,
                        branch_name=sub_branch or None,
                        project_id=None,
                        changed_files=changed,
                        worktree_path=sub_wt,
                        source_project=project_name,
                    )
            except Exception as exc:
                logger.warning("[work_item] failed to process subtask %s: %s", sub_id[:8], exc)

        # 从各子任务提取测试报告（优先从 worktree docs/ 读取实际报告文件）
        report_sections: list = []
        for sub in subtask_rows:
            sub_wt = sub.get("worktree_path") or sub.get("cwd") or ""
            sub_cwd = sub.get("cwd") or ""
            project_name = Path(sub_cwd).name if sub_cwd else f"task-{sub.get('id', '?')[:8]}"
        
            report_content = ""
        
            # 优先级 1：从 worktree docs/ 读取测试报告文件
            if sub_wt and os.path.isdir(sub_wt):
                docs_dir = Path(sub_wt) / "docs"
                if docs_dir.is_dir():
                    for f in docs_dir.iterdir():
                        if f.is_file() and "测试报告" in f.name and f.suffix == ".md" and "(汇总)" not in f.name:
                            try:
                                report_content = f.read_text(encoding="utf-8")[:8000]
                                break
                            except Exception:
                                pass
        
            # 优先级 2：从 agent_final_output 提取
            if not report_content:
                agent_output = sub.get("agent_final_output") or ""
                if agent_output:
                    report_content = self._extract_test_report_section(agent_output)
        
            if report_content:
                report_sections.append((project_name, report_content))

        if not report_sections and not project_changed_files:
            return

        # 获取工作项标题用于汇总报告
        wi_title = ""
        async with async_session_factory() as session:
            title_row = (await session.execute(
                text("SELECT title FROM work_items WHERE id = :id"),
                {"id": work_item_id},
            )).fetchone()
            if title_row:
                wi_title = dict(title_row._mapping).get("title", "")

        # 尝试从 worktree 读取技术方案文档作为 AI 汇总的额外输入
        proposal_docs = ""
        # 先确定 worktree（提前查找，供读取技术方案和后续写入使用）
        item = await self.get_work_item(work_item_id)
        wi_worktree = ""
        if item:
            async with async_session_factory() as session:
                wt_row = (await session.execute(
                    text("""
                        SELECT worktree_path FROM tasks
                        WHERE id IN (
                            SELECT task_id FROM work_item_transitions
                            WHERE work_item_id = :item_id AND task_id IS NOT NULL
                        )
                        AND worktree_path IS NOT NULL AND worktree_path != ''
                        ORDER BY created_at ASC LIMIT 1
                    """),
                    {"item_id": work_item_id},
                )).fetchone()
            if wt_row:
                wi_worktree = dict(wt_row._mapping).get("worktree_path") or ""

        if not wi_worktree:
            wi_worktree = task_data.get("worktree_path") or ""
        if not wi_worktree or not os.path.isdir(wi_worktree):
            for sub in subtask_rows:
                sub_wt = sub.get("worktree_path") or ""
                if sub_wt and os.path.isdir(sub_wt):
                    wi_worktree = sub_wt
                    break

        try:
            if wi_worktree and os.path.isdir(wi_worktree):
                proposal_docs = await _read_worktree_proposal_docs(wi_worktree, max_total_chars=4000, work_item_id=work_item_id)
        except Exception:
            pass

        # 汇总的项目列表
        projects = sorted(set(
            [p for p, _ in report_sections] + list(project_changed_files.keys())
        ))

        # 尝试 AI 生成汇总报告
        report_content = ""
        try:
            from backend.runtime.executor import AgentExecutor
            from backend.runtime.config import DEFAULT_AGENT_ID, DEFAULT_CWD

            summary_prompt = self._build_test_summary_prompt(
                wi_title=wi_title or work_item_id[:8],
                projects=projects,
                changed_files_by_project=project_changed_files,
                test_reports=report_sections,
                proposal_docs=proposal_docs,
                subtask_summaries=subtask_summaries,
                execution_stats=execution_stats,
            )

            executor = AgentExecutor()
            ai_task_id = f"test-summary-{work_item_id[:8]}"
            ai_parts: list = []

            async with asyncio.timeout(90):  # 90 秒超时
                async for event in executor.run_task(
                    task_id=ai_task_id,
                    agent_id=DEFAULT_AGENT_ID,
                    prompt=summary_prompt,
                    cwd=str(DEFAULT_CWD),
                    model=None,
                    full_auto=True,
                ):
                    if event.type == "output":
                        ai_parts.append(event.content)
                    elif event.type == "completed":
                        if event.content:
                            ai_parts.append(event.content)
                    elif event.type == "failed":
                        raise RuntimeError(f"AI summary failed: {event.content}")

            ai_output = "\n".join(str(p) for p in ai_parts if p)
            if ai_output and len(ai_output.strip()) > 200:
                report_content = ai_output.strip()
                logger.info("[work_item] AI-generated summary report (len=%d) for item=%s",
                           len(report_content), work_item_id[:8])
        except Exception as exc:
            logger.warning("[work_item] AI summary failed, fallback to static: %s", exc)

        # Fallback 到静态生成
        if not report_content:
            report_content = self._generate_static_summary_report(
                wi_title or work_item_id[:8],
                work_item_id,
                report_sections,
                project_changed_files,
                subtask_summaries=subtask_summaries,
                execution_stats=execution_stats,
            )
            logger.info("[work_item] using static summary report for item=%s", work_item_id[:8])

        # 写入工作项 worktree（wi_worktree 已在上方确定）
        if not wi_worktree:
            logger.warning("[work_item] no valid worktree to write test report for item=%s", work_item_id[:8])
            return

        # 写入测试报告文件
        report_dir = Path(wi_worktree) / "docs"
        report_dir.mkdir(parents=True, exist_ok=True)
        wi_prefix = f"wi-{work_item_id[:8]}"
        slug = _title_slug(wi_title) if wi_title else ""
        if slug:
            report_filename = f"{wi_prefix}-{slug}-测试报告(汇总).md"
        else:
            report_filename = f"{wi_prefix}-测试报告(汇总).md"
        report_path = report_dir / report_filename
        report_path.write_text(report_content, encoding="utf-8")
        logger.info(
            "[work_item] wrote summary test report: %s for item=%s",
            str(report_path), work_item_id[:8],
        )

        # 将测试报告 git add + commit，避免后续 merge 时 untracked 文件冲突
        from backend.runtime.git_utils import git_command
        await git_command(
            Path(wi_worktree), ["add", str(report_path)], timeout=10
        )
        commit_code, commit_output = await git_command(
            Path(wi_worktree),
            ["commit", "-m", f"docs: 添加汇总测试报告 {report_filename}", "--no-verify"],
            timeout=15,
        )
        report_commit_hash = ""
        if commit_code == 0:
            _, hash_out = await git_command(
                Path(wi_worktree), ["rev-parse", "HEAD"], timeout=5
            )
            report_commit_hash = hash_out.strip()
            logger.info("[work_item] committed test report: %s commit=%s", report_filename, report_commit_hash[:8])
        else:
            logger.warning("[work_item] failed to commit test report: %s", commit_output[:200])

        # 将测试报告作为产物记录
        from urllib.parse import quote
        art_id = str(uuid.uuid4())
        rel_path = f"docs/{report_filename}"
        content_url = f"/api/work-items/{work_item_id}/artifacts/{art_id}/content"
        view_url = f"/docs/view?url={quote(content_url, safe='')}&title={quote(report_filename, safe='')}"

        artifact = {
            "id": art_id,
            "type": "file",
            "label": report_filename,
            "stage": "test",
            "url": view_url,
            "file_path": str(report_path),
            "commit_hash": report_commit_hash,
            "created_at": _now_iso(),
            "task_id": task_id,
        }

        # 追加到 metadata.artifacts
        async with async_session_factory() as session:
            row = (await session.execute(
                text("SELECT metadata FROM work_items WHERE id = :id"),
                {"id": work_item_id},
            )).fetchone()
            if row:
                metadata = _safe_json_loads(dict(row._mapping).get("metadata"), {}) or {}
                existing = metadata.get("artifacts") or []
                if not isinstance(existing, list):
                    existing = []
                existing.append(artifact)
                metadata["artifacts"] = existing
                await session.execute(
                    text("UPDATE work_items SET metadata = :meta WHERE id = :id"),
                    {"id": work_item_id, "meta": json.dumps(metadata, ensure_ascii=False)},
                )
                await session.commit()
        logger.info(
            "[work_item] test report artifact saved for item=%s",
            work_item_id[:8],
        )

        # 清除 generating_summary 标记
        try:
            async with async_session_factory() as session:
                row = (await session.execute(
                    text("SELECT metadata FROM work_items WHERE id = :id"),
                    {"id": work_item_id},
                )).fetchone()
                if row:
                    metadata = _safe_json_loads(dict(row._mapping).get("metadata"), {}) or {}
                    metadata.pop("generating_summary", None)
                    await session.execute(
                        text("UPDATE work_items SET metadata = :meta WHERE id = :id"),
                        {"id": work_item_id, "meta": json.dumps(metadata, ensure_ascii=False)},
                    )
                    await session.commit()
        except Exception:
            pass

    @staticmethod
    def _extract_test_report_section(text_output: str) -> str:
        """从 agent_final_output 中提取测试报告段落。

        匹配策略：找到 '测试报告' 标记后的内容直到下一个同级标题或文末。
        """
        import re
        # 尝试匹配 "测试报告：" 或 "## 测试报告" 后的内容
        patterns = [
            r"(?:^|\n)(?:##?\s*)?测试报告[：:]\s*\n([\s\S]+?)(?=\n##?\s|\Z)",
            r"(?:^|\n)测试报告[：:]?\s*\n([\s\S]+?)(?=\n##?\s|\Z)",
            r"测试报告[：:]\s*\n([\s\S]+?)$",
        ]
        for pattern in patterns:
            m = re.search(pattern, text_output)
            if m:
                return m.group(1).strip()

        # 兜底：如果有 "测试报告" 字样后跟列表
        idx = text_output.find("测试报告")
        if idx >= 0:
            after = text_output[idx + len("测试报告"):]
            # 取到末尾或下一个标题
            end_match = re.search(r"\n##?\s", after)
            if end_match:
                return after[:end_match.start()].strip().lstrip("：: \n")
            return after.strip().lstrip("：: \n")

        return ""

    def _generate_static_summary_report(
        self,
        wi_title: str,
        work_item_id: str,
        report_sections: list,
        project_changed_files: dict,
        subtask_summaries: list = None,
        execution_stats: dict = None,
    ) -> str:
        """生成专业的静态汇总测试报告（AI fallback）—— 9 章结构 Test Handover Report"""
        from datetime import datetime

        lines = []
        lines.append("# Test Handover Report（测试交接报告）\n")

        projects = sorted(project_changed_files.keys())
        total_files = sum(len(files) for files in project_changed_files.values())

        # 定义风险模式
        high_risk_patterns = ['auth', 'security', 'payment', 'permission', 'credential', 'token', 'password']
        mid_risk_patterns = ['api', 'controller', 'route', 'service', 'mapper', 'migration', 'schema']

        # 统计高/中/低风险文件数
        high_risk_files = []
        mid_risk_files = []
        for _proj, files in project_changed_files.items():
            for f in set(files):
                fname_lower = f.lower()
                if any(p in fname_lower for p in high_risk_patterns):
                    high_risk_files.append(f)
                elif any(p in fname_lower for p in mid_risk_patterns):
                    mid_risk_files.append(f)

        # --- 1. Executive Summary ---
        lines.append("## 1. Executive Summary（执行摘要）\n")
        lines.append("| 项目 | 值 |")
        lines.append("|------|-----|")
        lines.append(f"| **工作项** | {wi_title or work_item_id[:8]} |")
        lines.append(f"| **涉及项目** | {', '.join(projects) if projects else 'N/A'} |")
        lines.append(f"| **改动文件数** | {total_files} |")
        lines.append(f"| **生成时间** | {datetime.now().strftime('%Y-%m-%d %H:%M')} |")
        lines.append("")

        # 根据 execution_stats 判断整体结论
        if execution_stats:
            total = execution_stats.get("total", 0)
            completed = execution_stats.get("completed", 0)
            failed = execution_stats.get("failed", 0)
            if total > 0 and failed == 0 and completed == total:
                conclusion = "✅ 通过"
                confidence = "高"
                recommendation = "Go"
            elif failed > 0:
                conclusion = "❌ 未通过"
                confidence = "低"
                recommendation = "No-Go"
            elif completed < total:
                conclusion = "⚠️ 有风险"
                confidence = "中"
                recommendation = "Conditional Go"
            else:
                conclusion = "⚠️ 有风险"
                confidence = "中"
                recommendation = "Conditional Go"
        else:
            conclusion = "⚠️ 有风险（无执行统计数据）"
            confidence = "低"
            recommendation = "Conditional Go"

        lines.append(f"**整体测试结论**: {conclusion}")
        lines.append(f"**置信度**: {confidence}")
        lines.append(f"**建议**: {recommendation}")
        lines.append("")

        # --- 2. 改动范围分析 ---
        lines.append("## 2. 改动范围分析\n")
        for project, files in sorted(project_changed_files.items()):
            lines.append(f"### {project}\n")
            lines.append("| 模块 | 改动文件 | 改动类型 | 风险等级 |")
            lines.append("|------|---------|---------|---------|")
            unique_files = sorted(set(files))
            for f in unique_files[:30]:
                fname_lower = f.lower()
                # 推断模块（从路径提取第一级目录）
                parts = f.replace("\\", "/").split("/")
                module = parts[0] if len(parts) > 1 else "根目录"
                # 推断改动类型
                if f.endswith(('.yml', '.yaml', '.env', '.properties', '.json', '.toml')):
                    change_type = "配置变更"
                elif f.endswith('.sql'):
                    change_type = "数据库迁移"
                elif 'test' in fname_lower or 'spec' in fname_lower:
                    change_type = "测试变更"
                elif any(p in fname_lower for p in ['fix', 'bug', 'patch', 'hotfix']):
                    change_type = "缺陷修复"
                else:
                    change_type = "功能变更"
                # 风险等级
                if any(p in fname_lower for p in high_risk_patterns):
                    risk = "🔴 高"
                elif any(p in fname_lower for p in mid_risk_patterns):
                    risk = "🟡 中"
                else:
                    risk = "🟢 低"
                lines.append(f"| {module} | `{f}` | {change_type} | {risk} |")
            if len(unique_files) > 30:
                lines.append(f"| ... | 及其他 {len(unique_files) - 30} 个文件 | - | - |")
            lines.append("")

        # --- 3. 测试执行结果 ---
        lines.append("## 3. 测试执行结果\n")
        if execution_stats:
            lines.append("### 执行统计\n")
            lines.append("| 指标 | 数量 |")
            lines.append("|------|------|")
            lines.append(f"| 总子任务数 | {execution_stats.get('total', 0)} |")
            lines.append(f"| 已完成 | {execution_stats.get('completed', 0)} |")
            lines.append(f"| 失败 | {execution_stats.get('failed', 0)} |")
            lines.append(f"| 已取消 | {execution_stats.get('cancelled', 0)} |")
            lines.append("")

        if subtask_summaries:
            lines.append("### 子任务执行明细\n")
            lines.append("| 序号 | 任务名称 | 状态 | Commit Message |")
            lines.append("|------|---------|------|---------------|")
            for ss in subtask_summaries:
                idx = ss.get("index", "?")
                title = ss.get("title", "")[:50]
                status = ss.get("status", "unknown")
                status_emoji = "✅" if status in ("completed", "done", "success") else ("❌" if status in ("failed", "error") else "⚠️")
                cmsg = ss.get("commit_msg", "-")[:80] or "-"
                lines.append(f"| {idx} | {title} | {status_emoji} {status} | {cmsg} |")
            lines.append("")
        else:
            lines.append("无子任务执行数据。\n")

        if report_sections:
            lines.append("### 各项目测试报告\n")
            for project_name, section_content in report_sections:
                lines.append(f"#### {project_name}\n")
                lines.append(section_content.strip())
                lines.append("")

        # --- 4. 测试覆盖度分析 ---
        lines.append("## 4. 测试覆盖度分析\n")
        # 检测是否有测试文件变更
        test_files = []
        for _proj, files in project_changed_files.items():
            for f in set(files):
                if 'test' in f.lower() or 'spec' in f.lower():
                    test_files.append(f)
        has_test_reports = bool(report_sections)

        lines.append("| 覆盖维度 | 状态 | 说明 |")
        lines.append("|---------|------|------|")
        if test_files:
            lines.append(f"| 自动化测试 | ✅ 有 | 发现 {len(test_files)} 个测试文件变更 |")
        else:
            lines.append("| 自动化测试 | ⚠️ 未发现 | 未检测到测试文件变更 |")
        if has_test_reports:
            lines.append("| Agent 自测报告 | ✅ 有 | 子任务已生成测试报告 |")
        else:
            lines.append("| Agent 自测报告 | ⚠️ 无 | 子任务未生成独立测试报告 |")
        lines.append("")

        if not test_files:
            lines.append("**测试盲区警告**: 本次改动未发现对应的测试文件变更，建议手工验证核心功能。\n")
        lines.append("")

        # --- 5. 风险评估矩阵 ---
        lines.append("## 5. 风险评估矩阵\n")
        lines.append("| 风险项 | 可能性 | 影响度 | 缓解措施 |")
        lines.append("|--------|--------|--------|---------|")

        if high_risk_files:
            for f in high_risk_files[:5]:
                lines.append(f"| `{f}` 安全/权限变更 | 高 | 🔴 高 | 需安全审计+手工验证 |")
        if mid_risk_files:
            for f in mid_risk_files[:5]:
                lines.append(f"| `{f}` 接口/服务变更 | 中 | 🟡 中 | 接口回归测试 |")
        if not high_risk_files and not mid_risk_files:
            lines.append("| 本次改动风险较低 | 低 | 🟢 低 | 常规回归即可 |")
        lines.append("")

        overall_risk = "🔴 高" if high_risk_files else ("🟡 中" if mid_risk_files else "🟢 低")
        lines.append(f"**整体风险等级**: {overall_risk}")
        lines.append("")

        # --- 6. 回归影响分析 ---
        lines.append("## 6. 回归影响分析\n")
        # 基于改动模块推断可能影响的功能（提取前两级目录）
        affected_modules = set()
        for _proj, files in project_changed_files.items():
            for f in set(files):
                parts = f.replace("\\", "/").split("/")
                if len(parts) > 2:
                    affected_modules.add(f"{parts[0]}/{parts[1]}")
                elif len(parts) > 1:
                    affected_modules.add(parts[0])

        # 从子任务报告中搜索模块关键词
        module_descriptions = {}
        for proj_name, section in report_sections:
            impact_match = re.search(r'(?:影响范围|改动模块|功能模块)[：:]\s*([^\n]+(?:\n[-*].*)*)', section)
            if impact_match:
                module_descriptions[proj_name] = impact_match.group(1).strip()[:200]

        if affected_modules or module_descriptions:
            lines.append("### 可能影响的功能模块\n")
            for mod in sorted(affected_modules):
                lines.append(f"- `{mod}` 相关功能")
            if module_descriptions:
                lines.append("")
                lines.append("### 子任务报告中的影响范围\n")
                for proj_name, desc in module_descriptions.items():
                    lines.append(f"- **{proj_name}**: {desc}")
            lines.append("")
            lines.append("### 建议回归范围\n")
            lines.append("- 上述模块的核心功能流程")
            if len(projects) > 1:
                lines.append("- 跨项目集成点（API 调用、数据同步）")
            lines.append("")
        else:
            lines.append("改动范围较小，回归影响有限。\n")

        # --- 7. 验收测试用例 ---
        lines.append("## 7. 验收测试用例\n")

        # 优先从子任务报告中提取实际测试结果
        actual_test_cases = []
        for proj_name, section in report_sections:
            tc_matches = re.finditer(r'(?:TC-\d+|测试用例\s*\d+)[：:\s]+([^\n]+)', section)
            for m in tc_matches:
                actual_test_cases.append(f"**{proj_name}**: {m.group(0).strip()}")

        if actual_test_cases:
            lines.append("### 来自子项目的实际测试验证\n")
            for tc in actual_test_cases[:10]:
                lines.append(f"- {tc}")
            lines.append("")
        else:
            # fallback 到当前模板化逻辑
            tc_num = 1
            if high_risk_files:
                lines.append("### P0 必须验证（高风险）\n")
                for f in high_risk_files[:3]:
                    lines.append(f"**TC-{tc_num:03d}**: `{f}` 相关功能验证")
                    lines.append(f"- 前置条件：系统正常运行，用户已登录")
                    lines.append(f"- 正向测试：执行正常业务流程，验证功能正确")
                    lines.append(f"- 负向测试：无权限/异常输入场景，验证安全防护")
                    lines.append("")
                    tc_num += 1

            if mid_risk_files:
                lines.append("### P1 重要验证（中风险）\n")
                for f in mid_risk_files[:3]:
                    lines.append(f"**TC-{tc_num:03d}**: `{f}` 接口/服务验证")
                    lines.append(f"- 前置条件：服务正常启动")
                    lines.append(f"- 正向测试：API 正常调用返回预期结果")
                    lines.append(f"- 负向测试：参数缺失/类型错误时返回正确错误码")
                    lines.append("")
                    tc_num += 1

            if not high_risk_files and not mid_risk_files:
                lines.append("### P2 一般验证\n")
                lines.append(f"**TC-{tc_num:03d}**: 基本功能验证")
                lines.append("- 前置条件：系统正常运行")
                lines.append("- 正向测试：验证改动文件对应功能正常")
                lines.append("- 负向测试：边界条件处理正确")
                lines.append("")

        # --- 8. 部署与回滚 ---
        lines.append("## 8. 部署与回滚\n")

        # 检测特殊文件
        has_sql = any(
            any(f.endswith('.sql') for f in files)
            for files in project_changed_files.values()
        )
        has_config = any(
            any(('config' in f.lower() or f.endswith(('.yml', '.yaml', '.env', '.properties'))) for f in files)
            for files in project_changed_files.values()
        )
        has_deps = any(
            any(f.endswith(('requirements.txt', 'package.json', 'go.mod', 'pom.xml', 'Cargo.toml')) for f in files)
            for files in project_changed_files.values()
        )

        lines.append("### 部署前置条件\n")
        if has_sql:
            lines.append("- ⚠️ **包含数据库迁移脚本**，需在部署前执行")
        if has_config:
            lines.append("- ⚠️ **包含配置文件变更**，请确认环境变量/配置已同步")
        if has_deps:
            lines.append("- ⚠️ **包含依赖变更**，部署时需重新安装依赖")

        # 从子任务报告中提取数据库变更等部署前置信息
        deployment_notes: list = []
        for proj_name, section in report_sections:
            if re.search(r'(?:SQL|DDL|CREATE TABLE|ALTER TABLE|INSERT INTO|数据库迁移|建表)', section, re.I):
                sql_match = re.search(r'```sql\s*([\s\S]*?)```', section)
                if sql_match:
                    deployment_notes.append(f"- ⚠️ **{proj_name}** 包含数据库变更:\n  ```sql\n  {sql_match.group(1).strip()[:500]}\n  ```")
                else:
                    for line in section.split('\n'):
                        if re.search(r'(?:SQL|DDL|建表|执行|migration|权限表)', line, re.I) and len(line.strip()) > 10:
                            deployment_notes.append(f"- ⚠️ **{proj_name}**: {line.strip()}")
                            break
        if deployment_notes:
            for note in deployment_notes:
                lines.append(note)

        if not has_sql and not has_config and not has_deps and not deployment_notes:
            lines.append("- 无特殊前置条件")
        lines.append("")

        if len(projects) > 1:
            lines.append("### 部署顺序\n")
            lines.append(f"涉及 {len(projects)} 个项目，建议部署顺序：")
            for i, proj in enumerate(projects, 1):
                lines.append(f"{i}. {proj}")
            lines.append("")

        lines.append("### 回滚方案\n")
        lines.append("- **回滚触发条件**: 核心功能异常、接口报错率突增、数据不一致")
        lines.append("- **回滚方式**: Git revert 到前一个稳定版本，重新部署")
        if has_sql:
            lines.append("- ⚠️ 数据库变更需确认是否可逆向回滚")
        lines.append("")

        lines.append("### 监控关注点\n")
        lines.append("- 部署后关注接口响应时间和错误率")
        lines.append("- 检查应用日志是否有异常栈")
        if high_risk_files:
            lines.append("- 重点关注安全/权限相关日志")
        lines.append("")

        # --- 9. 遗留问题与建议 ---
        lines.append("## 9. 遗留问题与建议\n")
        if not test_files:
            lines.append("- 建议后续补充自动化测试用例，提升测试覆盖率")
        if high_risk_files:
            lines.append("- 高风险文件建议增加代码审查流程")
        if execution_stats and execution_stats.get("failed", 0) > 0:
            lines.append(f"- 有 {execution_stats['failed']} 个子任务执行失败，需排查原因")
        if not test_files and not high_risk_files and not (execution_stats and execution_stats.get("failed", 0) > 0):
            lines.append("- 本次改动无明显遗留问题")
        lines.append("")

        return "\n".join(lines)

    def _build_test_summary_prompt(
        self,
        wi_title: str,
        projects: list,
        changed_files_by_project: dict,
        test_reports: list,
        proposal_docs: str = "",
        subtask_summaries: list = None,
        execution_stats: dict = None,
    ) -> str:
        """构建 AI 汇总分析 prompt（专业 Test Handover Report）。

        Args:
            wi_title: 工作项标题
            projects: 涉及的项目名列表
            changed_files_by_project: 各项目变更文件 {project_name: [file_paths]}
            test_reports: 各项目测试报告 [(project_name, report_text)]
            proposal_docs: 技术方案文档内容（可选）
            subtask_summaries: 子任务执行摘要 [{index, title, status, commit_msg, ...}]
            execution_stats: 执行统计 {total, completed, failed, cancelled}
        """
        projects_str = ", ".join(projects)
        total_files = sum(len(files) for files in changed_files_by_project.values())

        # 构建技术方案段落
        tech_proposal_section = ""
        if proposal_docs:
            tech_proposal_section = f"**技术方案**:\n{proposal_docs[:4000]}\n"

        # 构建代码改动段落
        changes_parts = []
        if changed_files_by_project:
            for proj in sorted(changed_files_by_project.keys()):
                files = sorted(set(changed_files_by_project[proj]))
                changes_parts.append(f"### {proj}（{len(files)} 个文件）\n")
                for f in files[:30]:
                    changes_parts.append(f"- `{f}`\n")
                if len(files) > 30:
                    changes_parts.append(f"- ... 等共 {len(files)} 个文件\n")
                changes_parts.append("\n")
        changes_section = "".join(changes_parts) if changes_parts else "无代码改动信息\n"

        # 构建测试报告段落
        reports_parts = []
        if test_reports:
            for proj_name, section in test_reports:
                reports_parts.append(f"### {proj_name}\n\n{section.strip()}\n\n")
        reports_section = "".join(reports_parts) if reports_parts else "各子任务未生成独立测试报告\n"

        # 构建子任务执行摘要段落
        subtask_section = ""
        if subtask_summaries:
            parts = ["| 序号 | 任务名称 | 状态 | Commit Message |\n",
                     "|------|---------|------|---------------|\n"]
            for ss in subtask_summaries:
                idx = ss.get("index", "?")
                title = ss.get("title", "")[:50]
                status = ss.get("status", "unknown")
                cmsg = ss.get("commit_msg", "")[:80]
                parts.append(f"| {idx} | {title} | {status} | {cmsg} |\n")
            subtask_section = "".join(parts)

        # 构建执行统计段落
        stats_section = ""
        if execution_stats:
            stats_section = (
                f"- 总子任务数: {execution_stats.get('total', 0)}\n"
                f"- 已完成: {execution_stats.get('completed', 0)}\n"
                f"- 失败: {execution_stats.get('failed', 0)}\n"
                f"- 已取消: {execution_stats.get('cancelled', 0)}\n"
            )

        prompt = f"""你是一位资深 QA 工程师和技术 TL，正在为以下工作项编写专业的测试交接报告（Test Handover Report）。
这份报告将用于开发团队向 QA/测试团队或产品经理交接，确保接收方了解改动全貌、测试覆盖情况和上线风险。

## 报告结构要求

请严格按照以下章节生成 Markdown 报告：

### 1. Executive Summary（执行摘要）
- 用 2-3 句话概括本次改动的**业务目标**和**技术实现方式**
- 整体测试结论：✅ 通过 / ⚠️ 有风险 / ❌ 未通过
- 置信度评估（高/中/低）及理由
- 建议：Go / Conditional Go / No-Go

### 2. 改动范围分析
以表格形式列出所有改动文件：
| 项目 | 模块 | 改动文件 | 改动类型 | 风险等级 | 影响范围 |

改动类型分类：新增功能 / 缺陷修复 / 重构 / 配置变更 / 依赖升级
风险等级用 emoji：🔴高 🟡中 🟢低

### 3. 测试执行结果
- 子任务执行统计表
- 各子任务测试通过情况汇总
- 发现的问题/异常（如有）

### 4. 测试覆盖度分析
- 哪些改动已被自动化测试覆盖
- 哪些改动需要手工验证
- 测试盲区/未覆盖的风险点

### 5. 风险评估矩阵
| 风险项 | 可能性 | 影响度 | 缓解措施 |
标注整体风险等级

### 6. 回归影响分析
- 本次改动可能影响的现有功能清单
- 建议的回归测试范围
- 可安全跳过的回归范围及理由

### 7. 验收测试用例
为高风险改动提供具体测试场景：
- 测试编号（TC-XXX）
- 前置条件 → 操作步骤 → 预期结果
- 优先级：P0 > P1 > P2
- 至少为每个高风险项提供正向+负向测试

### 8. 部署与回滚
- 部署前置条件（数据库迁移、配置、依赖）
- 部署顺序（多项目时）
- 回滚方案和回滚触发条件
- 监控关注点（部署后需关注的指标/日志）

### 9. 遗留问题与建议
- 当前已知的技术债或待优化项
- 后续迭代建议

## 输入信息

**工作项**: {wi_title}
**涉及项目**: {projects_str}
**改动文件总数**: {total_files}

{tech_proposal_section}

**子任务执行统计**:
{stats_section}

**子任务执行摘要**:
{subtask_section}

**代码改动详情**:
{changes_section}

**各项目测试报告**:
{reports_section}

## 输出要求
- 使用 Markdown 格式
- 报告标题用「# Test Handover Report（测试交接报告）」
- 表格使用标准 Markdown 表格语法
- 风险等级用 emoji 标记：🔴高 🟡中 🟢低
- 测试用例编号格式：TC-001, TC-002...
- 语言：中文为主，章节标题保留英文
- 务必基于实际改动内容和测试结果分析，不要使用泛泛的模板化建议
- 每个章节必须有实质性内容，不能只有标题
"""

        return prompt

    @staticmethod
    def _extract_test_notes_from_sections(report_sections: list) -> list:
        """从各子任务测试报告段落中提取注意事项和建议。

        扫描每个测试报告段落，匹配含"注意事项"、"建议"、"要点"等标题后的列表项。
        返回去重后的注意事项列表。
        """
        import re
        notes: list = []
        seen: set = set()

        # 匹配注意事项/建议/要点相关段落的 pattern
        section_patterns = [
            r"(?:^|\n)#+\s*(?:注意事项|测试要点|建议|注意|关注点|回归测试)[：:]?\s*\n([\s\S]+?)(?=\n#+\s|\Z)",
            r"(?:^|\n)(?:注意事项|测试要点|建议|注意|关注点)[：:]\s*\n([\s\S]+?)(?=\n#+\s|\Z)",
        ]
        # 匹配列表项
        list_item_pattern = r"^[\s]*[-*•]\s*(.+)$"

        for _project_name, section in report_sections:
            for pattern in section_patterns:
                matches = re.finditer(pattern, section)
                for m in matches:
                    block = m.group(1)
                    # 从块中提取列表项
                    for line_match in re.finditer(list_item_pattern, block, re.MULTILINE):
                        item = line_match.group(1).strip()
                        if item and item not in seen:
                            seen.add(item)
                            notes.append(item)

        return notes

    async def on_work_item_task_completed(self, task_id: str, result: str):
        """
        Agent task 完成回调（事件驱动 + 轮询兜底，调用幂等）：
        1. 将输出写回对应 transition 的 output 字段
        2. 通过 task_id 找到关联的 work_item
        3. 获取当前节点的下游节点
        4. 自动推进到下一个节点
        """
        if not task_id:
            return
    
        logger.info(
            "on_work_item_task_completed: task_id=%s result_len=%d",
            task_id[:8], len(result or ""),
        )
    
        # 优先使用 agent_final_output（仅含 agent 自然语言回复，不含工具调用日志），
        # 确保下游节点收到的是 agent 的最终结论而非中间执行日志。
        transition_output = result
        try:
            async with async_session_factory() as session:
                row = await session.execute(
                    text("SELECT agent_final_output FROM tasks WHERE id = :task_id"),
                    {"task_id": task_id},
                )
                task_row = row.fetchone()
                if task_row:
                    agent_fo = task_row[0]
                    if agent_fo and str(agent_fo).strip():
                        transition_output = str(agent_fo).strip()
                        logger.info(
                            "on_work_item_task_completed: using agent_final_output (len=%d) instead of full result (len=%d) for task=%s",
                            len(transition_output), len(result or ""), task_id[:8],
                        )
        except Exception:  # noqa: BLE001
            logger.debug("Failed to read agent_final_output for task=%s, falling back to result", task_id[:8], exc_info=True)
    
        # 1. 将 transition_output 写回 transition.output
        async with async_session_factory() as session:
            await session.execute(
                text("""
                    UPDATE work_item_transitions
                    SET output = :output
                    WHERE task_id = :task_id
                """),
                {"task_id": task_id, "output": transition_output},
            )
            await session.commit()

        # 2. 查找关联的 transition
        async with async_session_factory() as session:
            row_result = await session.execute(
                text("""
                    SELECT t.work_item_id, t.to_node_id
                    FROM work_item_transitions t
                    WHERE t.task_id = :task_id
                    ORDER BY t.created_at DESC
                    LIMIT 1
                """),
                {"task_id": task_id},
            )
            row = row_result.fetchone()

        is_continuation = False
        if not row:
            # 续聊场景：无直接 transition 记录时，通过 session_id 反查关联的工作项
            async with async_session_factory() as session:
                session_result = await session.execute(
                    text(
                        "SELECT session_id FROM tasks "
                        "WHERE id = :task_id AND session_id IS NOT NULL AND session_id != ''"
                    ),
                    {"task_id": task_id},
                )
                session_row = session_result.fetchone()
                sibling_row = None
                if session_row:
                    # 查找同 session 中关联工作项的兄弟任务
                    sibling_result = await session.execute(
                        text("""
                            SELECT wit.work_item_id, wit.to_node_id
                            FROM tasks t
                            JOIN work_item_transitions wit ON wit.task_id = t.id
                            WHERE t.session_id = :session_id AND t.id != :task_id
                            ORDER BY wit.created_at DESC
                            LIMIT 1
                        """),
                        {"session_id": session_row[0], "task_id": task_id},
                    )
                    sibling_row = sibling_result.fetchone()

            if session_row and sibling_row:
                # 找到关联工作项：续聊任务，仅提取产物，不推进工作项状态
                is_continuation = True
                item_id = sibling_row[0]
                current_node_id = sibling_row[1]
                logger.info(
                    "[work_item_service] on_work_item_task_completed: task=%s is continuation in session, "
                    "linked to work_item=%s. Extracting artifacts without advancing.",
                    task_id[:8], item_id[:8],
                )
            else:
                # 自由协作（freeform）模式兜底：
                # 经评论 @agent 触发的任务只记录在 work_item_comments.task_id 中，
                # 没有 transition 记录，此处通过 comments 表反查工作项，
                # 以便提取并保存产物（不推进节点状态）。
                async with async_session_factory() as session:
                    comment_result = await session.execute(
                        text("""
                            SELECT work_item_id
                            FROM work_item_comments
                            WHERE task_id = :task_id
                            ORDER BY created_at DESC
                            LIMIT 1
                        """),
                        {"task_id": task_id},
                    )
                    comment_row = comment_result.fetchone()
                if not comment_row:
                    logger.info(
                        "No work item transition/comment found for task %s, skipping auto-advance.",
                        task_id[:8],
                    )
                    return
                # 通过评论找到关联工作项：freeform 协作任务，仅提取产物，不推进状态
                is_continuation = True
                item_id = comment_row[0]
                current_node_id = None
                logger.info(
                    "[work_item_service] on_work_item_task_completed: task=%s linked via comment "
                    "to work_item=%s (freeform mode). Extracting artifacts without advancing.",
                    task_id[:8], item_id[:8],
                )
        else:
            mapping = dict(row._mapping)
            item_id = mapping["work_item_id"]
            current_node_id = mapping["to_node_id"]

        # Agent 完成后在 worktree 中 commit 改动（如果有），并捕获 commit_hash 供产物提取使用
        commit_hash: Optional[str] = None
        worktree_path: str = ""
        branch_name_val: str = ""
        changed_files: List[str] = []
        async with async_session_factory() as session:
            task_row_result = await session.execute(
                text("SELECT worktree_path, branch_name FROM tasks WHERE id = :id"),
                {"id": task_id},
            )
            task_row = task_row_result.fetchone()
        if task_row:
            task_mapping = dict(task_row._mapping)
            worktree_path = task_mapping.get("worktree_path") or ""
            branch_name_val = task_mapping.get("branch_name") or ""
            if worktree_path and branch_name_val:
                from backend.runtime.git_utils import has_git_changes, commit_changes
                wt = Path(worktree_path)
                if wt.exists():
                    try:
                        if await has_git_changes(wt):
                            commit_hash = await commit_changes(
                                wt, f"tide: work item {item_id} - agent completed"
                            )
                            logger.info(
                                "[work_item] auto-committed changes in worktree: %s (commit=%s)",
                                worktree_path, (commit_hash or "")[:7],
                            )
                    except Exception as exc:
                        logger.warning("[work_item] auto-commit failed: %s", exc)
                    # 获取此 commit 变更的文件列表，供产物提取使用
                    if commit_hash:
                        try:
                            changed_files = await self._get_commit_changed_files(
                                worktree_path, commit_hash
                            )
                        except Exception as exc:
                            logger.warning(
                                "[work_item] failed to enumerate changed files: %s", exc,
                            )
                    # 如果没有新的 auto-commit（Agent 已自行提交），获取最新 commit 的变更文件
                    if not commit_hash and worktree_path:
                        try:
                            from backend.runtime.git_utils import git_command as _git_cmd
                            _code, _log = await _git_cmd(
                                Path(worktree_path), ["log", "-1", "--format=%H"], timeout=5
                            )
                            if _code == 0 and _log.strip():
                                commit_hash = _log.strip()
                                changed_files = await self._get_commit_changed_files(
                                    worktree_path, commit_hash
                                )
                        except Exception as exc:
                            logger.debug(
                                "[work_item] failed to get latest commit for main task: %s", exc,
                            )

        # 提前加载工作项，以便提取产物时获取 project_id。同时后续需要检查节点一致性。
        item = await self.get_work_item(item_id)

        # 提取产物并保存到 work_item.metadata.artifacts（容错，失败不影响主流程）
        if result:
            try:
                await self._extract_and_save_artifacts(
                    item_id,
                    task_id,
                    result,
                    commit_hash=commit_hash,
                    branch_name=branch_name_val or None,
                    project_id=(item or {}).get("project_id"),
                    changed_files=changed_files,
                    worktree_path=worktree_path or None,
                )
            except Exception as exc:
                logger.warning(
                    "[work_item] artifact extraction failed for item=%s task=%s: %s",
                    item_id[:8], task_id[:8], exc,
                )

        # 续聊场景：产物已提取并关联回工作项（含 auto-commit），不推进节点状态
        if is_continuation:
            logger.info(
                "[work_item_service] continuation task %s artifacts linked to work_item %s, skip auto-advance.",
                task_id[:8], item_id[:8],
            )
            return

        # Plan 完成时：收集所有子任务的产物文件 + 生成汇总测试报告
        # 标记正在生成汇总报告
        try:
            async with async_session_factory() as session:
                row = (await session.execute(
                    text("SELECT metadata FROM work_items WHERE id = :id"),
                    {"id": item_id},
                )).fetchone()
                if row:
                    metadata = _safe_json_loads(dict(row._mapping).get("metadata"), {}) or {}
                    metadata["generating_summary"] = True
                    await session.execute(
                        text("UPDATE work_items SET metadata = :meta WHERE id = :id"),
                        {"id": item_id, "meta": json.dumps(metadata, ensure_ascii=False)},
                    )
                    await session.commit()
            await ws_hub.broadcast("work_items", {
                "type": "work_item.updated",
                "work_item_id": item_id,
                "project_id": (item or {}).get("project_id"),
            })
        except Exception:
            pass

        try:
            await self._collect_plan_subtask_artifacts(item_id, task_id)
        except Exception as exc:
            logger.warning(
                "[work_item] plan subtask artifact collection failed for item=%s task=%s: %s",
                item_id[:8], task_id[:8], exc,
            )
        finally:
            # 清除 generating_summary 标记（无论成功或失败）
            try:
                async with async_session_factory() as session:
                    row = (await session.execute(
                        text("SELECT metadata FROM work_items WHERE id = :id"),
                        {"id": item_id},
                    )).fetchone()
                    if row:
                        metadata = _safe_json_loads(dict(row._mapping).get("metadata"), {}) or {}
                        metadata.pop("generating_summary", None)
                        await session.execute(
                            text("UPDATE work_items SET metadata = :meta WHERE id = :id"),
                            {"id": item_id, "meta": json.dumps(metadata, ensure_ascii=False)},
                        )
                        await session.commit()
            except Exception:
                pass

        # 如果工作项不存在，提前返回
        if not item:
            logger.info("Work item %s not found, abort auto-advance.", (item_id or "")[:8])
            return

        # 确认当前节点仍然是 agent 节点（防止并发/重复回调推进）
        if item["current_node_id"] != current_node_id:
            logger.info(
                "Work item %s already moved past node %s (current=%s), skip auto-advance.",
                item_id[:8], current_node_id[:8], (item["current_node_id"] or "")[:8],
            )
            return

        # 加载 workflow definition
        definition = await self._load_workflow_definition(item["workflow_id"])
        if not definition:
            logger.warning(
                "Workflow %s definition missing, abort auto-advance for work item %s.",
                (item["workflow_id"] or "")[:8], item_id[:8],
            )
            return

        # 找下游节点
        downstream = self._get_downstream_nodes(definition, current_node_id)
        if not downstream:
            logger.info(
                "Work item %s has no downstream node from %s, staying at current node.",
                item_id[:8], current_node_id[:8],
            )
            return

        next_node = downstream[0]
        await self.transition_work_item(
            item_id,
            next_node["id"],
            operator="system",
            trigger_type="agent_completed",
        )
        logger.info(
            "Work item %s auto-advanced from %s to %s after task %s completed.",
            item_id[:8], current_node_id[:8], next_node["id"][:8], task_id[:8],
        )

    async def _wait_and_record_output(self, task_id: str):
        """后台轮询等待 task 完成（事件回调的兜底，作为重复检查 idempotent 安全）。"""
        if not task_id:
            return
        logger.info("Polling started for task=%s (work item watcher).", task_id[:8])
        # max wait ≈ 2 hours (3600 * 2s)
        for _ in range(3600):
            await asyncio.sleep(2)
            async with async_session_factory() as session:
                result = await session.execute(
                    text("SELECT status, result FROM tasks WHERE id = :id"),
                    {"id": task_id},
                )
                row = result.fetchone()
            if not row:
                logger.info("Polling stopped: task %s no longer exists.", task_id[:8])
                return
            task_data = dict(row._mapping)
            status = (task_data.get("status") or "").lower()
            if status == "completed":
                output = task_data.get("result") or ""
                logger.info(
                    "Polling detected task %s status=%s, triggering auto-advance.",
                    task_id[:8], status,
                )
                await self.on_work_item_task_completed(task_id, output)
                return
            elif status in ("failed", "stopped", "rejected"):
                logger.warning(
                    "Polling detected task %s status=%s, will NOT advance work item.",
                    task_id[:8], status,
                )
                return
        logger.warning(
            "Polling timed out for task %s after 2h, giving up.", task_id[:8],
        )

    async def on_work_item_approval_resolved(
        self,
        approval_id: str,
        approved: bool,
        comment: Optional[str] = None,
        operator_id: Optional[str] = None,  # 新增：审批操作人 ID
    ):
        """审批完成回调：

        - 将审批结果 + 意见写回该审批节点对应的 transition.output，作为工作项日志。
        - 无论通过/拒绝，均推进到下游节点：
            * 个出口：走唯一下游（例如拒绝 → 结束节点亦能正常结束）
            * 多出口：优先按边的 condition/label 匹配 approved/rejected。
        """
        try:
            # 获取审批详情
            async with async_session_factory() as session:
                result = await session.execute(
                    text("SELECT id, task_id, detail FROM approvals WHERE id = :id"),
                    {"id": approval_id},
                )
                row = result.fetchone()

            if not row:
                return

            approval = dict(row._mapping)
            detail = _safe_json_loads(approval.get("detail"), {})

            work_item_id = detail.get("work_item_id")
            node_id = detail.get("node_id")

            if not work_item_id or not node_id:
                return

            # 1. 写入审批日志（追写到审批节点对应 transition 的 output）
            comment_text = (comment or "").strip()
            verdict = "通过" if approved else "拒绝"
            log_line = f"[审批{verdict}] {comment_text}".rstrip()
            await self._append_approval_log(work_item_id, node_id, log_line)

            # 2. 加载工作项与定义
            item = await self.get_work_item(work_item_id)
            if not item:
                return
            definition = await self._load_workflow_definition(item["workflow_id"])
            if not definition:
                return

            # 3. 选择下游边 / 节点（无论通过或拒绝均推进）
            target_node = self._select_approval_downstream(definition, node_id, approved)
            if not target_node:
                logger.info(
                    "Approval %s for work item %s resolved (%s) but no downstream node, staying.",
                    approval_id[:8], work_item_id[:8], verdict,
                )
                return

            trigger = "approval_approved" if approved else "approval_rejected"
            logger.info(
                "Approval %s for work item %s resolved (%s), advancing to node %s.",
                approval_id[:8], work_item_id[:8], verdict, target_node["id"][:8],
            )
            await self.transition_work_item(
                work_item_id,
                target_node["id"],
                operator=operator_id or "Tide",
                trigger_type=trigger,
            )

        except Exception as exc:
            logger.exception("Failed to handle approval resolved: %s", exc)

    async def _append_approval_log(
        self, work_item_id: str, node_id: str, log_line: str
    ) -> None:
        """将审批结果追写到审批节点对应 transition 的 output 字段。

        选择该工作项最近一条 to_node_id == node_id 的 transition（即进入审批节点的流转记录），
        在其 output 末尾追加一行审批日志。如果找不到，则雲量忽略。
        """
        try:
            async with async_session_factory() as session:
                row = (
                    await session.execute(
                        text(
                            """
                            SELECT id, output FROM work_item_transitions
                            WHERE work_item_id = :item_id AND to_node_id = :node_id
                            ORDER BY created_at DESC
                            LIMIT 1
                            """
                        ),
                        {"item_id": work_item_id, "node_id": node_id},
                    )
                ).fetchone()
                if not row:
                    return
                m = dict(row._mapping)
                tid = m["id"]
                prev = (m.get("output") or "").rstrip()
                new_output = (prev + ("\n" if prev else "") + log_line).strip()
                await session.execute(
                    text(
                        "UPDATE work_item_transitions SET output = :output WHERE id = :id"
                    ),
                    {"output": new_output, "id": tid},
                )
                await session.commit()
        except Exception:
            logger.exception(
                "_append_approval_log failed work_item=%s node=%s",
                (work_item_id or "")[:8], (node_id or "")[:8],
            )

    def _select_approval_downstream(
        self, definition: dict, node_id: str, approved: bool,
    ) -> Optional[dict]:
        """从审批节点选择下游节点。

        多出口时则优先根据边上的 condition/label 区分 approved/rejected。
        单出口时返回唯一下游。无出口时返回 None。
        """
        edges = definition.get("edges", [])
        nodes = definition.get("nodes", [])
        node_map = {n["id"]: n for n in nodes}
        outgoing = [e for e in edges if e.get("source") == node_id]
        if not outgoing:
            return None

        if len(outgoing) == 1:
            return node_map.get(outgoing[0].get("target")) if outgoing[0].get("target") else None

        approved_keys = {"approved", "approve", "通过", "yes", "true"}
        rejected_keys = {"rejected", "reject", "拒绝", "no", "false", "denied"}
        target_keys = approved_keys if approved else rejected_keys

        def edge_matches(edge: dict) -> bool:
            data = edge.get("data") or {}
            for k in ("condition", "branch", "result", "value"):
                v = data.get(k)
                if isinstance(v, str) and v.strip().lower() in target_keys:
                    return True
            label = edge.get("label")
            if isinstance(label, str) and label.strip().lower() in target_keys:
                return True
            label_data = data.get("label")
            if isinstance(label_data, str) and label_data.strip().lower() in target_keys:
                return True
            return False

        chosen = next((e for e in outgoing if edge_matches(e)), None)
        if not chosen:
            chosen = outgoing[0]
        return node_map.get(chosen.get("target")) if chosen.get("target") else None

    # ── 项目-工作流绑定 ──────────────────────────────────

    async def set_project_workflow(
        self,
        project_id: str,
        workflow_id: Optional[str] = None,
        flow_mode: Optional[str] = None,
    ) -> dict:
        """绑定项目到工作流（UPSERT project_settings）。

        - workflow_id / flow_mode 均为可选，传 None 时保留现有值（COALESCE），
          保证向后兼容：仅传 workflow_id 时不会覆盖 flow_mode。
        - freeform 模式下 workflow_id 可为空。
        """
        now = _now_iso()
        async with async_session_factory() as session:
            await session.execute(
                text("""
                    INSERT INTO project_settings (project_id, workflow_id, flow_mode, updated_at)
                    VALUES (:project_id, :workflow_id, :flow_mode, :updated_at)
                    ON CONFLICT(project_id) DO UPDATE SET
                        workflow_id = COALESCE(:workflow_id, project_settings.workflow_id),
                        flow_mode = COALESCE(:flow_mode, project_settings.flow_mode),
                        updated_at = :updated_at
                """),
                {
                    "project_id": project_id,
                    "workflow_id": workflow_id,
                    "flow_mode": flow_mode,
                    "updated_at": now,
                },
            )
            await session.commit()

        logger.info(
            "Project %s settings updated (workflow=%s, flow_mode=%s)",
            project_id[:8],
            (workflow_id or "-")[:8],
            flow_mode or "-",
        )
        return await self.get_project_settings(project_id) or {
            "project_id": project_id,
            "workflow_id": workflow_id,
            "flow_mode": flow_mode,
        }

    async def get_project_settings(self, project_id: str) -> Optional[dict]:
        """获取项目设置。"""
        async with async_session_factory() as session:
            result = await session.execute(
                text("""
                    SELECT project_id, workflow_id, default_assignee, metadata, updated_at, flow_mode
                    FROM project_settings
                    WHERE project_id = :project_id
                """),
                {"project_id": project_id},
            )
            row = result.fetchone()
        if not row:
            return None
        item = dict(row._mapping)
        item["metadata"] = _safe_json_loads(item.get("metadata"), None)
        return item

    async def _get_project_group_flow_mode(self, project_id: str) -> Optional[str]:
        """读取 project 所属项目组的 flow_mode（取首个显式设置的组）。

        项目可能属于多个组；仅返回 flow_mode 非空的组，取加入时间最早的一条。
        无归属组或组未设置 flow_mode 时返回 None。
        """
        async with async_session_factory() as session:
            row = (
                await session.execute(
                    text("""
                        SELECT g.flow_mode
                        FROM project_group_members m
                        JOIN project_groups g ON g.id = m.group_id
                        WHERE m.project_id = :project_id
                          AND g.flow_mode IS NOT NULL
                        ORDER BY m.added_at
                        LIMIT 1
                    """),
                    {"project_id": project_id},
                )
            ).fetchone()
        return row[0] if row else None

    async def get_effective_flow_mode(
        self, project_id: str, settings: Optional[dict] = None
    ) -> str:
        """计算工作项的有效 flow_mode，优先级：项目级 > 项目组级 > 系统默认。

        - 项目级显式设置（非默认 default_workflow）时直接采用；
        - 否则回退到所属项目组的 flow_mode；
        - 最终回退到系统默认 ``default_workflow``。

        ``settings`` 可选，传入时避免重复查询 project_settings。
        """
        if settings is None:
            settings = await self.get_project_settings(project_id)
        project_flow_mode = (settings or {}).get("flow_mode")
        # 项目级显式指定了非默认模式时优先生效
        if project_flow_mode and project_flow_mode != "default_workflow":
            return project_flow_mode
        # 项目级为默认/未设置：回退到项目组
        group_flow_mode = await self._get_project_group_flow_mode(project_id)
        if group_flow_mode:
            return group_flow_mode
        # 系统默认
        return project_flow_mode or "default_workflow"

    async def remove_project_workflow(self, project_id: str) -> bool:
        """解绑工作流。"""
        async with async_session_factory() as session:
            result = await session.execute(
                text("DELETE FROM project_settings WHERE project_id = :project_id"),
                {"project_id": project_id},
            )
            await session.commit()
            return result.rowcount > 0

    async def update_project_metadata(
        self, project_id: str, metadata: dict
    ) -> None:
        """UPSERT project_settings.metadata 字段。

        - 仅写入 metadata + updated_at；workflow_id / default_assignee 等其他字段不受影响。
        """
        now = _now_iso()
        meta_json = json.dumps(metadata or {}, ensure_ascii=False)
        async with async_session_factory() as session:
            await session.execute(
                text("""
                    INSERT INTO project_settings (project_id, metadata, updated_at)
                    VALUES (:project_id, :metadata, :updated_at)
                    ON CONFLICT(project_id) DO UPDATE SET
                        metadata = :metadata,
                        updated_at = :updated_at
                """),
                {
                    "project_id": project_id,
                    "metadata": meta_json,
                    "updated_at": now,
                },
            )
            await session.commit()

    async def get_freeform_status_list(self, project_id: str) -> list:
        """获取项目的 freeform 状态列表配置。

        数据获取优先级：项目级配置 → 全局配置 → 硬编码默认。
        """
        settings = await self.get_project_settings(project_id)
        metadata = (settings or {}).get("metadata") or {}
        if isinstance(metadata, str):
            metadata = _safe_json_loads(metadata, {})
        if not isinstance(metadata, dict):
            metadata = {}
        status_list = metadata.get("freeform_status_list")
        if isinstance(status_list, list) and status_list:
            return status_list
        # 项目级无配置 → fallback 到全局配置（全局也无则返回硬编码默认）
        return await self.get_global_freeform_status_list()

    async def set_freeform_status_list(
        self, project_id: str, status_list: list
    ) -> list:
        """保存 freeform 状态列表到 ``project_settings.metadata.freeform_status_list``。

        - 强制保证终态 ``completed`` 始终存在（缺失时自动补全）。
        - 仅更新 metadata 中的该键，其余字段不受影响。
        """
        normalized = [
            {"key": str(it.get("key", "")).strip(), "label": str(it.get("label", "")).strip()}
            for it in (status_list or [])
            if str(it.get("key", "")).strip()
        ]
        if not any(it["key"] == "completed" for it in normalized):
            normalized.append({"key": "completed", "label": "已完成"})

        settings = await self.get_project_settings(project_id)
        metadata = (settings or {}).get("metadata") or {}
        if isinstance(metadata, str):
            metadata = _safe_json_loads(metadata, {})
        if not isinstance(metadata, dict):
            metadata = {}
        metadata["freeform_status_list"] = normalized
        await self.update_project_metadata(project_id, metadata)
        return normalized

    # ---------- 全局 freeform 状态列表配置（system_settings） ----------

    _GLOBAL_FREEFORM_STATUS_KEY = "freeform_status_list"

    async def get_global_freeform_status_list(self) -> list:
        """获取全局 freeform 状态列表配置；未配置时返回默认 4 列。

        数据存储在 ``system_settings`` 表（key=freeform_status_list），
        与具体项目无关，供未做项目级配置时 fallback 使用。
        """
        async with async_session_factory() as session:
            row = await session.execute(
                text("SELECT value FROM system_settings WHERE key = :key"),
                {"key": self._GLOBAL_FREEFORM_STATUS_KEY},
            )
            record = row.fetchone()
        if record and record[0]:
            parsed = _safe_json_loads(record[0], None)
            if isinstance(parsed, list) and parsed:
                return parsed
        return list(DEFAULT_FREEFORM_STATUS_LIST)

    async def set_global_freeform_status_list(self, status_list: list) -> list:
        """保存全局 freeform 状态列表到 ``system_settings``。

        - 强制保证终态 ``completed`` 始终存在（缺失时自动补全）。
        """
        normalized = [
            {"key": str(it.get("key", "")).strip(), "label": str(it.get("label", "")).strip()}
            for it in (status_list or [])
            if str(it.get("key", "")).strip()
        ]
        if not any(it["key"] == "completed" for it in normalized):
            normalized.append({"key": "completed", "label": "已完成"})

        now = datetime.now(timezone.utc).isoformat()
        payload = json.dumps(normalized, ensure_ascii=False)
        async with async_session_factory() as session:
            await session.execute(
                text(
                    "INSERT INTO system_settings (key, value, updated_at)"
                    " VALUES (:key, :value, :updated_at)"
                    " ON CONFLICT(key) DO UPDATE SET"
                    " value = excluded.value, updated_at = excluded.updated_at"
                ),
                {
                    "key": self._GLOBAL_FREEFORM_STATUS_KEY,
                    "value": payload,
                    "updated_at": now,
                },
            )
            await session.commit()
        return normalized

    async def get_project_git_config(self, project_id: str) -> dict:
        """快捷获取项目的 Git 仓库配置；未配置返回空 dict。"""
        settings = await self.get_project_settings(project_id)
        if not settings:
            return {}
        metadata = settings.get("metadata") or {}
        if isinstance(metadata, str):
            metadata = _safe_json_loads(metadata, {})
        if not isinstance(metadata, dict):
            return {}
        cfg = metadata.get("git_config") or {}
        return cfg if isinstance(cfg, dict) else {}

    # ── 看板数据 ─────────────────────────────────────────

    async def get_work_item_board(
        self,
        project_id: str,
        version_id: Optional[str] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
        assignee: Optional[str] = None,
        group_id: Optional[str] = None,
    ) -> dict:
        """
        获取工作项看板：
        1. 查找项目的 workflow_id
        2. 加载 workflow definition
        3. 提取所有可见节点，按拓扑排序
        4. 查询该项目所有未完成的 work_items
        5. 按 current_node_id 分组到对应列
        6. 返回看板结构
        """
        settings = await self.get_project_settings(project_id)
        flow_mode = await self.get_effective_flow_mode(project_id, settings=settings)

        # freeform 模式：不绑定工作流，看板改由前端按工作项状态分列。
        # 直接短路返回空列，避免残留的 workflow_id 仍生成工作流节点列。
        if flow_mode == "freeform":
            return {"columns": [], "workflow": None, "flow_mode": "freeform"}

        # default_workflow 模式下项目未显式绑定工作流时，回退到系统默认工作流，
        # 避免看板返回空列导致前端误报"该项目尚未绑定工作流"。
        workflow_id = settings.get("workflow_id") if settings else None
        if not workflow_id:
            workflow_id = await self._find_default_workflow_id()
        if not workflow_id:
            return {"columns": [], "workflow": None, "flow_mode": flow_mode}

        definition = await self._load_workflow_definition(workflow_id)
        if not definition:
            return {"columns": [], "workflow": None}

        # 查询 workflow 名称
        async with async_session_factory() as session:
            wf_row_result = await session.execute(
                text("SELECT name FROM workflows WHERE id = :id"),
                {"id": workflow_id},
            )
            wf_row = wf_row_result.fetchone()
        workflow_name = wf_row._mapping["name"] if wf_row else ""

        # 查询 workflow 名称
        async with async_session_factory() as session:
            wf_row_result = await session.execute(
                text("SELECT name FROM workflows WHERE id = :id"),
                {"id": workflow_id},
            )
            wf_row = wf_row_result.fetchone()
        workflow_name = wf_row._mapping["name"] if wf_row else ""

        # 提取可见节点作为列（包含 end，使已完成工作项也能在看板上呈现）
        visible_nodes = self._get_visible_nodes(definition, include_end=True)

        # 查询全部工作项（含已完成），可选按版本/状态/负责人等过滤
        items = await self.list_work_items(
            project_id=project_id,
            version_id=version_id,
            status=status,
            search=search,
            assignee=assignee,
            group_id=group_id,
            include_archived=False,
        )

        # 按 current_node_id 分组
        items_by_node: dict[str, list] = {}
        for item in items:
            node_id = item["current_node_id"]
            items_by_node.setdefault(node_id, []).append(item)

        # 构建列
        columns = []
        for node in visible_nodes:
            node_data = node.get("data", {})
            columns.append({
                "id": node["id"],
                "label": node_data.get("label") or node_data.get("name") or node["id"],
                "category": node.get("type"),
                "node_type": node.get("type"),
                "items": items_by_node.get(node["id"], []),
            })

        return {
            "columns": columns,
            "workflow": {"id": workflow_id, "name": workflow_name},
            "flow_mode": flow_mode,
        }

    # ── 内部辅助 ─────────────────────────────────────────

    async def _record_transition(
        self,
        item_id: str,
        from_node_id: Optional[str],
        to_node_id: str,
        trigger_type: str = "manual",
        operator: str = "system",
        task_id: Optional[str] = None,
        output: Optional[str] = None,
    ) -> dict:
        """记录一条流转记录。"""
        transition_id = str(uuid.uuid4())
        now = _now_iso()

        async with async_session_factory() as session:
            await session.execute(
                text("""
                    INSERT INTO work_item_transitions
                        (id, work_item_id, from_node_id, to_node_id,
                         trigger_type, task_id, operator, output, created_at)
                    VALUES (:id, :work_item_id, :from_node_id, :to_node_id,
                            :trigger_type, :task_id, :operator, :output, :created_at)
                """),
                {
                    "id": transition_id,
                    "work_item_id": item_id,
                    "from_node_id": from_node_id,
                    "to_node_id": to_node_id,
                    "trigger_type": trigger_type,
                    "task_id": task_id,
                    "operator": operator,
                    "output": output,
                    "created_at": now,
                },
            )
            await session.commit()

        return {
            "id": transition_id,
            "work_item_id": item_id,
            "from_node_id": from_node_id,
            "to_node_id": to_node_id,
            "trigger_type": trigger_type,
            "task_id": task_id,
            "operator": operator,
            "output": output,
            "created_at": now,
        }

    @staticmethod
    def _compare(actual, op: str, expected) -> bool:
        """条件比较。"""
        try:
            if op == "eq":
                return str(actual) == str(expected)
            if op == "neq":
                return str(actual) != str(expected)
            if op == "contains":
                return str(expected) in (str(actual) if actual is not None else "")
            if op == "gt":
                return float(actual) > float(expected)
            if op == "lt":
                return float(actual) < float(expected)
        except (TypeError, ValueError):
            return False
        return False


# 全局单例
work_item_service = WorkItemService()
