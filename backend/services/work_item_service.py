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
import re
import uuid
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

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
VISIBLE_NODE_TYPES = {"stage", "agent", "approval", "delay"}
# 看板列节点类型：在 VISIBLE_NODE_TYPES 基础上额外包含 end，
# 让已完成（completed_at != NULL）的工作项也能展示在看板上。
BOARD_COLUMN_NODE_TYPES = VISIBLE_NODE_TYPES | {"end"}


class WorkItemService:
    """工作项服务：CRUD + 流转引擎 + 看板数据。"""

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
        """通过 project_id 查询项目路径 (workspaces 表的 path 字段)。"""
        try:
            async with async_session_factory() as session:
                result = await session.execute(
                    text("SELECT path FROM workspaces WHERE id = :id"),
                    {"id": project_id},
                )
                row = result.fetchone()
        except Exception:
            row = None
        if row:
            path = row._mapping.get("path")
            if path and Path(path).is_dir():
                return str(path)
        # 兼容：project_id 可能是 base64 编码的路径
        try:
            import base64
            s = project_id or ""
            pad = "=" * (-len(s) % 4)
            decoded = base64.urlsafe_b64decode((s + pad).encode()).decode()
            if decoded and Path(decoded).is_dir():
                return decoded
        except Exception:
            pass
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

        # 1. 查找 project_settings
        settings = await self.get_project_settings(project_id)
        if not settings or not settings.get("workflow_id"):
            raise ValueError(f"Project {project_id} has no workflow bound. Use set_project_workflow first.")

        workflow_id = settings["workflow_id"]

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
                         started_at, created_at, updated_at)
                    VALUES (:id, :project_id, :workflow_id, :current_node_id, :title, :description,
                            :priority, :assignee, :tags, :source_type, :source_id, :metadata,
                            :started_at, :created_at, :updated_at)
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
                    "started_at": now,
                    "created_at": now,
                    "updated_at": now,
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

        # 6. 如果初始节点是 agent 类型，触发自动化
        item = await self.get_work_item(item_id)
        if first_node.get("type") == "agent" and item:
            asyncio.create_task(self._safe_trigger_agent(item, first_node))

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
                           started_at, completed_at, created_at, updated_at
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
        return item

    async def list_work_items(
        self,
        project_id: Optional[str] = None,
        status: Optional[str] = None,
    ) -> List[dict]:
        """列出工作项，支持按项目和状态筛选。"""
        conditions = []
        params: dict = {}

        if project_id:
            conditions.append("project_id = :project_id")
            params["project_id"] = project_id
        if status:
            if status == "completed":
                conditions.append("completed_at IS NOT NULL")
            elif status == "active":
                conditions.append("completed_at IS NULL")

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        async with async_session_factory() as session:
            result = await session.execute(
                text(f"""
                    SELECT id, project_id, workflow_id, current_node_id, title, description,
                           priority, assignee, tags, source_type, source_id, metadata,
                           started_at, completed_at, created_at, updated_at
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
            params["assignee"] = assignee
        if tags is not None:
            sets.append("tags = :tags")
            params["tags"] = json.dumps(tags, ensure_ascii=False)
        if metadata is not None:
            sets.append("metadata = :metadata")
            params["metadata"] = json.dumps(metadata, ensure_ascii=False)

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
        3. 调用 task_service.create_task()
        4. task 的 metadata 中记录 work_item_id 和 workflow_node_id
        5. 更新 transition 的 task_id
        """
        logger.info(
            "[WorkItem] Triggering agent node '%s' for item '%s' title='%s'",
            node.get("id"),
            item.get("id"),
            item.get("title"),
        )
        try:
            from backend.services.task_service import task_service

            data = node.get("data", {})
            agent_id = data.get("agentId") or data.get("agent_id") or "codex"
            model = data.get("model") or ""
            prompt_template = data.get("promptTemplate") or data.get("prompt") or ""
            node_cwd = data.get("cwd") or ""
            project_cwd = await self._get_project_path(item["project_id"])
            cwd = node_cwd or project_cwd or str(Path.cwd())

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

    async def _handle_condition_node(self, item: dict, node: dict, definition: dict):
        """
        Condition 节点：评估条件并递归跳转到下一节点。
        """
        try:
            data = node.get("data", {})
            conditions = data.get("conditions") or []
            edges = definition.get("edges", [])
            nodes = definition.get("nodes", [])
            node_map = {n["id"]: n for n in nodes}

            # 构建 context 供条件评估
            context = {
                "title": item.get("title", ""),
                "description": item.get("description", ""),
                "priority": item.get("priority", 0),
                "assignee": item.get("assignee", ""),
                "tags": item.get("tags") or [],
            }

            # 评估条件
            target_edge_id = None
            for cond in conditions:
                field = cond.get("field", "")
                op = cond.get("operator", "eq")
                expected = cond.get("value")
                actual = context.get(field)
                if self._compare(actual, op, expected):
                    target_edge_id = cond.get("targetEdge")
                    break

            # 确定目标边
            chosen_edge = None
            if target_edge_id:
                chosen_edge = next((e for e in edges if e.get("id") == target_edge_id), None)

            if not chosen_edge:
                outgoing = [e for e in edges if e.get("source") == node["id"]]
                chosen_edge = next(
                    (e for e in outgoing if e.get("data", {}).get("isDefault")
                     or e.get("label") in ("default", "否", "else")),
                    None,
                )
                if not chosen_edge and outgoing:
                    chosen_edge = outgoing[0]

            if chosen_edge:
                target_node = node_map.get(chosen_edge["target"])
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

    # ── 回调 ─────────────────────────────────────────────

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

        # 加载工作项
        item = await self.get_work_item(item_id)
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

    # ── 看板数据 ─────────────────────────────────────────

    async def get_work_item_board(self, project_id: str) -> dict:
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

        # 查询全部工作项（含已完成）
        items = await self.list_work_items(project_id=project_id)

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
