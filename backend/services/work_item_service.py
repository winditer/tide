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
import uuid
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional
from urllib.parse import quote

from sqlalchemy import text

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


# 可见节点类型：这些节点是工作项可以停留的阶段
VISIBLE_NODE_TYPES = {"stage", "agent", "approval", "delay", "git_merge", "parallel_join"}
# 看板列节点类型：在 VISIBLE_NODE_TYPES 基础上额外包含 end，
# 让已完成（completed_at != NULL）的工作项也能展示在看板上。
BOARD_COLUMN_NODE_TYPES = VISIBLE_NODE_TYPES | {"end"}


class WorkItemService:
    """工作项服务：CRUD + 流转引擎 + 看板数据。"""

    # ── status 推导 ─────────────────────────────────────

    @staticmethod
    def _derive_node_status(node_type: Optional[str], has_completed: bool) -> str:
        """根据节点类型推导工作项状态。

        返回值: pending | in_progress | pending_approval | completed | waiting | failed | stopped
        """
        if has_completed:
            return "completed"
        if node_type == "end":
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

        return items

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

    def _render_prompt_template(self, template: str, item: dict) -> str:
        """渲染 prompt 模板。

        支持以下占位符语法：
        - 双花括号：{{title}}、{{item.description}}
        - 单花括号：{title}、{item.description}（仅匹配标识符/点路径，避免与 JSON/代码中的 `{}` 冲突）

        缺失变量一律 fallback 为空字符串，绝不抛异常，避免静默吞掉 agent 触发。
        """
        if not template:
            return ""

        def resolve(key: str) -> str:
            try:
                key = (key or "").strip()
                # 支持 item.xxx 前缀
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
        """返回一个可作为默认值的 workflow_id：取最早创建的 enabled 工作流。

        当项目未绑定工作流（``project_settings`` 缺失）时，作为兜底使用，
        避免普通成员在尚未配置工作流的项目中新建工作项直接报 400。
        """
        async with async_session_factory() as session:
            result = await session.execute(
                text(
                    "SELECT id FROM workflows WHERE enabled = 1"
                    " ORDER BY created_at ASC LIMIT 1"
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

    async def create_work_item(self, data) -> dict:
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
                         version_id, started_at, created_at, updated_at, group_id)
                    VALUES (:id, :project_id, :workflow_id, :current_node_id, :title, :description,
                            :priority, :assignee, :tags, :source_type, :source_id, :metadata,
                            :version_id, :started_at, :created_at, :updated_at, :group_id)
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
                },
            )
            await session.commit()

        # 5. 记录首次 transition
        await self._record_transition(
            item_id=item_id,
            from_node_id=None,
            to_node_id=current_node_id,
            trigger_type="create",
            operator="system",
        )

        # 6. 如果初始节点需要自动化处理，按节点类型触发
        item = await self.get_work_item(item_id)
        if item:
            node_type = first_node.get("type", "stage")
            if node_type == "agent":
                asyncio.create_task(self._safe_trigger_agent(item, first_node))
            elif node_type == "approval":
                asyncio.create_task(self._trigger_approval_node(item, first_node))
            elif node_type == "condition":
                asyncio.create_task(self._handle_condition_node(item, first_node, definition))
            elif node_type == "delay":
                asyncio.create_task(self._handle_delay_node(item, first_node, definition))

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
                           version_id, started_at, completed_at, created_at, updated_at,
                           group_id
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
        # 推导 status
        await self._enrich_status([item])
        return item

    async def list_work_items(
        self,
        project_id: Optional[str] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
        assignee: Optional[str] = None,
        version_id: Optional[str] = None,
        group_id: Optional[str] = None,
    ) -> List[dict]:
        """列出工作项，支持按项目、状态、关键词、负责人、版本和项目组筛选。"""
        conditions = []
        params: dict = {}

        if project_id:
            conditions.append("project_id = :project_id")
            params["project_id"] = project_id
        if group_id:
            conditions.append("group_id = :group_id")
            params["group_id"] = group_id
        if status:
            if status == "completed":
                conditions.append("completed_at IS NOT NULL")
            elif status == "active":
                conditions.append("completed_at IS NULL")
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
                           version_id, started_at, completed_at, created_at, updated_at,
                           group_id
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
            items.append(item)
        # 批量推导 status
        await self._enrich_status(items)
        # 状态是推导出来的，需要在 Python 侧过滤
        if status and status not in ("completed", "active"):
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

    # ── 流转引擎 ─────────────────────────────────────────

    async def transition_work_item(
        self,
        item_id: str,
        target_node_id: str,
        operator: str = "system",
        trigger_type: str = "manual",
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
            if from_node and from_node.get("type") == "end":
                raise ValueError("Cannot transition from end node")
            # 3.2 防护：手动流转禁止直接拖入 end 节点（end 应由工作流自动到达）
            if target_node.get("type") == "end":
                raise ValueError("Cannot manually transition to end node")

        # 4. 记录 transition
        transition = await self._record_transition(
            item_id=item_id,
            from_node_id=from_node_id,
            to_node_id=target_node_id,
            trigger_type=trigger_type,
            operator=operator,
        )

        # 5. 更新 current_node_id
        now = _now_iso()
        async with async_session_factory() as session:
            sets = ["current_node_id = :node_id", "updated_at = :updated_at"]
            params: dict = {"id": item_id, "node_id": target_node_id, "updated_at": now}

            # end 节点标记完成
            if target_node.get("type") == "end":
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
        node_type = target_node.get("type", "stage")
        if node_type == "agent" and item:
            asyncio.create_task(self._safe_trigger_agent(item, target_node))
        elif node_type == "approval" and item:
            asyncio.create_task(self._trigger_approval_node(item, target_node))
        elif node_type == "condition" and item:
            asyncio.create_task(self._handle_condition_node(item, target_node, definition))
        elif node_type == "delay" and item:
            asyncio.create_task(self._handle_delay_node(item, target_node, definition))
        elif node_type == "git_merge" and item:
            asyncio.create_task(self._trigger_git_merge_node(item, target_node))
        elif node_type == "end":
            logger.info("Work item %s completed.", item_id[:8])

        # 7. WebSocket 广播
        await ws_hub.broadcast("work_items", {
            "type": "work_item.transitioned",
            "work_item_id": item_id,
            "from_node_id": from_node_id,
            "to_node_id": target_node_id,
            "trigger_type": trigger_type,
            "operator": operator,
        })

        # 8. 返回 transition
        return transition

    async def get_transitions(self, item_id: str) -> List[dict]:
        """获取工作项的流转历史。"""
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
        return [dict(row._mapping) for row in rows]

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
            if group_id:
                await self._trigger_group_agent_node(item, node, group_id)
                return

            data = node.get("data", {})
            agent_id = data.get("agentId") or data.get("agent_id") or "codex"
            model = data.get("model") or ""
            prompt_template = data.get("promptTemplate") or data.get("prompt") or ""
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
                    # worktree 创建失败：保持 cwd 为 project_cwd（或原始 cwd），不退化为相对路径
                    logger.warning(
                        "[work_item] worktree creation failed for item=%s, keep cwd=%s",
                        item["id"], cwd,
                    )

            # 最终兜底：确保 cwd 是绝对路径，绝不传入空串/相对路径
            if not cwd or not os.path.isabs(cwd):
                fallback = project_cwd or str(Path.cwd())
                logger.warning(
                    "[work_item] cwd invalid (%r), fallback to project_cwd=%s",
                    cwd, fallback,
                )
                cwd = fallback

            # 渲染 prompt
            prompt = self._render_prompt_template(prompt_template, item)
            if not prompt:
                prompt = f"处理工作项: {item['title']}"
                if item.get("description"):
                    prompt += f"\n\n{item['description']}"

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
            model = data.get("model") or ""
            prompt_template = data.get("promptTemplate") or data.get("prompt") or ""

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

            # 2. 渲染基础 prompt
            base_prompt = self._render_prompt_template(prompt_template, item)
            if not base_prompt:
                base_prompt = f"处理工作项: {item['title']}"
                if item.get("description"):
                    base_prompt += f"\n\n{item['description']}"

            # 3. 构建跨仓库 Plan definition
            # 后端项目可并行（phase 0），前端项目依赖后端（phase 1）
            plan_tasks = []
            backend_indices = []
            for idx, project in enumerate(group_projects):
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

                task_prompt = (
                    f"{group_context}\n\n"
                    f"## 需求\n{base_prompt}\n\n"
                    f"## 当前目标仓库\n"
                    f"你现在在 `{project_name}` 仓库（{project_cwd}）中工作。\n"
                    f"请只修改本仓库相关的代码。如果此需求不涉及本仓库，请输出'无需修改'并结束。"
                )

                plan_task_def = {
                    "title": f"[{project_name}] {item['title'][:50]}",
                    "prompt": task_prompt,
                    "agent_id": agent_id,
                    "phase": phase,
                    "depends_on": backend_indices if is_frontend and backend_indices else [],
                    "project_id": project["project_id"],
                    "cwd": project_cwd,
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
        """
        try:
            from backend.services.approval_service import approval_service

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
            from_id = tr.get("from_node_id")
            if not from_id:
                continue
            from_node = node_map.get(from_id)
            ntype = (from_node.get("type") if from_node else "") or ""
            trigger = (tr.get("trigger_type") or "").lower()
            out_raw = tr.get("output") or ""

            node_ctx = context.get(from_id) if isinstance(context.get(from_id), dict) else {}
            if ntype == "approval":
                if trigger == "approval_approved":
                    node_ctx["output"] = "approved"
                elif trigger == "approval_rejected":
                    node_ctx["output"] = "rejected"
                node_ctx["log"] = out_raw
            else:
                # agent / git_merge / 其他节点：直接使用 transition.output
                node_ctx["output"] = out_raw
            context[from_id] = node_ctx
        return context

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

    async def _trigger_git_merge_node(self, item: dict, node: dict):
        """处理 git_merge 节点：将工作项 worktree 分支合入目标分支。"""
        data = node.get("data", {})
        from backend.runtime.git_utils import work_item_branch_name
        target_branch = data.get("targetBranch", "") or work_item_branch_name(item["id"])
        strategy = data.get("mergeStrategy", "merge")
        delete_source = data.get("deleteSource", True)  # 工作项场景默认删除源分支
        on_conflict = data.get("onConflict", "fail")

        # 1. 从工作项的 transitions 中找到前序 Agent 的 branch_name
        source_branch = ""
        worktree_path = ""

        async with async_session_factory() as session:
            row = await session.execute(
                text("""
                    SELECT t.branch_name, t.worktree_path
                    FROM work_item_transitions wit
                    JOIN tasks t ON t.id = wit.task_id
                    WHERE wit.work_item_id = :item_id
                      AND t.branch_name IS NOT NULL
                      AND t.branch_name != ''
                    ORDER BY wit.created_at DESC
                    LIMIT 1
                """),
                {"item_id": item["id"]}
            )
            result = row.fetchone()
            if result:
                source_branch = result[0] or ""
                worktree_path = result[1] or ""

        if not source_branch:
            # 尝试从 node.data.sourceBranch 获取（支持手动配置）
            source_branch = data.get("sourceBranch", "")

        if not source_branch:
            # 最终 fallback：使用工作项的 worktree 分支名
            source_branch = work_item_branch_name(item["id"])
            logger.info("[work_item] git_merge node: using work item branch as source: %s", source_branch)

        # 2. 获取 repo root
        from backend.runtime.git_utils import git_repo_root, git_merge_branch, cleanup_work_item_worktree

        project_cwd = await self._get_project_path(item["project_id"])
        cwd = project_cwd or str(Path.cwd())
        repo_root = await git_repo_root(Path(cwd))

        if repo_root is None:
            logger.error("[work_item] git_merge: not a git repo: %s", cwd)
            await self._advance_past_node(item, node)
            return

        # 3. 执行合并
        success, output, conflicts = await git_merge_branch(
            repo_root=repo_root,
            source_branch=source_branch,
            target_branch=target_branch,
            strategy=strategy,
            delete_source=delete_source,
        )

        if success:
            logger.info(
                "[work_item] git_merge success: item=%s source=%s target=%s",
                item["id"], source_branch, target_branch
            )
            # 4. 合并成功后，检查是否需要 auto push
            auto_push = data.get("autoPush", False)
            if auto_push:
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
                                "[work_item] auto push failed for %s: %s",
                                target_branch, push_output,
                            )
                        else:
                            logger.info(
                                "[work_item] auto push success: branch=%s", target_branch,
                            )
                    else:
                        logger.warning(
                            "[work_item] failed to ensure remote for %s", repo_url,
                        )
            # 5. 清理 worktree
            if worktree_path:
                await cleanup_work_item_worktree(
                    worktree_path=worktree_path,
                    branch_name="" if delete_source else source_branch,
                    repo_root=repo_root,
                )
            # 6. 自动推进到下游节点
            await self._advance_past_node(item, node)
        else:
            # 冲突处理
            error_msg = f"Merge conflict: {output}"
            if conflicts:
                error_msg += f" | Files: {', '.join(conflicts)}"
            logger.warning("[work_item] git_merge conflict: item=%s error=%s", item["id"], error_msg)

            if on_conflict == "manual":
                # 暂停，等待人工处理
                async with async_session_factory() as session:
                    metadata = json.dumps({
                        "merge_conflict": True,
                        "source_branch": source_branch,
                        "target_branch": target_branch,
                        "conflicts": conflicts,
                        "worktree_path": worktree_path,
                    }, ensure_ascii=False)
                    await session.execute(
                        text("UPDATE work_items SET metadata = :meta WHERE id = :id"),
                        {"meta": metadata, "id": item["id"]}
                    )
                    await session.commit()
            else:
                # fail: 记录错误但不推进，让工作项停留在 git_merge 节点
                pass

    async def _advance_past_node(self, item: dict, node: dict):
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
            """无远程仓库时返回空字符串，由保存阶段统一替换为后端 API 路径，
            使浏览器可以直接打开文件内容。
            """
            return ""

        # 1. 变更文件产物（最优先）
        if changed_files and commit_hash:
            for file_path in list(changed_files)[:10]:
                if not file_path:
                    continue
                file_url = self._build_file_url(repo_url, commit_hash, file_path)
                if not file_url:
                    file_url = _build_local_file_url(file_path)
                file_name = file_path.rsplit("/", 1)[-1] or file_path
                artifacts.append({
                    "id": str(uuid.uuid4()),
                    "type": "file",
                    "label": file_name,
                    "stage": "code",
                    "url": file_url,
                    "file_path": file_path,
                    "commit_hash": commit_hash,
                    "created_at": _now_iso(),
                    "task_id": task_id,
                })

        # 2. 从 Agent 文本输出中提取生成的文件路径（兜底）
        if output and isinstance(output, str):
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

                    file_url = ""
                    if repo_url and commit_hash:
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
                        "stage": "code",
                        "url": file_url,
                        "file_path": relative_path,
                        "commit_hash": commit_hash or "",
                        "created_at": _now_iso(),
                        "task_id": task_id,
                    })

        # 3. Git Commit 产物
        if commit_hash:
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
                # 1) 幂等性保护：若同一 task_id 的产物已存在，整批跳过
                # 2) 否则按 type 分别比对：file 用 file_path/label、commit 用 commit_hash、url 用 url
                existing_task_ids = {
                    e.get("task_id")
                    for e in existing
                    if isinstance(e, dict) and e.get("task_id")
                }
                if task_id and task_id in existing_task_ids:
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
                        if fp:
                            existing_file_keys.add(f"path:{fp}")
                        if lb:
                            existing_file_keys.add(f"name:{lb}")
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
                        if (fp and f"path:{fp}" in existing_file_keys) or (
                            lb and f"name:{lb}" in existing_file_keys
                        ):
                            continue
                        if fp:
                            existing_file_keys.add(f"path:{fp}")
                        if lb:
                            existing_file_keys.add(f"name:{lb}")
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
                            not url_val or url_val.startswith("file://")
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

        # 1. 将 result 写回 transition.output
        async with async_session_factory() as session:
            await session.execute(
                text("""
                    UPDATE work_item_transitions
                    SET output = :output
                    WHERE task_id = :task_id
                """),
                {"task_id": task_id, "output": result},
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

        if not row:
            logger.info(
                "No work item transition found for task %s, skipping auto-advance.",
                task_id[:8],
            )
            return

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
                )
            except Exception as exc:
                logger.warning(
                    "[work_item] artifact extraction failed for item=%s task=%s: %s",
                    item_id[:8], task_id[:8], exc,
                )

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
            if status in ("completed", "failed", "stopped", "rejected"):
                output = task_data.get("result") or ""
                logger.info(
                    "Polling detected task %s status=%s, triggering auto-advance.",
                    task_id[:8], status,
                )
                await self.on_work_item_task_completed(task_id, output)
                return
        logger.warning(
            "Polling timed out for task %s after 2h, giving up.", task_id[:8],
        )

    async def on_work_item_approval_resolved(
        self,
        approval_id: str,
        approved: bool,
        comment: Optional[str] = None,
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

            # 3. 选择下游边 / 节点
            target_node = self._select_approval_downstream(definition, node_id, approved)
            if not target_node:
                logger.info(
                    "Approval %s for work item %s resolved (%s) but no downstream node, staying.",
                    approval_id[:8], work_item_id[:8], verdict,
                )
                return

            await self.transition_work_item(
                work_item_id,
                target_node["id"],
                operator="system",
                trigger_type=("approval_approved" if approved else "approval_rejected"),
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

    async def set_project_workflow(self, project_id: str, workflow_id: str) -> dict:
        """绑定项目到工作流（UPSERT project_settings）。"""
        now = _now_iso()
        async with async_session_factory() as session:
            await session.execute(
                text("""
                    INSERT INTO project_settings (project_id, workflow_id, updated_at)
                    VALUES (:project_id, :workflow_id, :updated_at)
                    ON CONFLICT(project_id) DO UPDATE SET
                        workflow_id = :workflow_id,
                        updated_at = :updated_at
                """),
                {
                    "project_id": project_id,
                    "workflow_id": workflow_id,
                    "updated_at": now,
                },
            )
            await session.commit()

        logger.info("Project %s bound to workflow %s", project_id[:8], workflow_id[:8])
        return await self.get_project_settings(project_id) or {
            "project_id": project_id,
            "workflow_id": workflow_id,
        }

    async def get_project_settings(self, project_id: str) -> Optional[dict]:
        """获取项目设置。"""
        async with async_session_factory() as session:
            result = await session.execute(
                text("""
                    SELECT project_id, workflow_id, default_assignee, metadata, updated_at
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
        if not settings or not settings.get("workflow_id"):
            return {"columns": [], "workflow": None}

        workflow_id = settings["workflow_id"]
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
