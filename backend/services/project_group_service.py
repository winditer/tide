"""项目组服务 — 管理跨仓库项目分组。"""

import base64
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from sqlalchemy import text

from backend.db.engine import async_session_factory

logger = logging.getLogger("tide.project_group_service")


class ProjectGroupService:
    """项目组 CRUD 与成员管理。"""

    def _now_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _decode_project_id(self, project_id: str) -> Optional[str]:
        """从 project_id（base64 编码的 cwd）解码出绝对路径。"""
        if not project_id:
            return None
        try:
            padded = project_id + "=" * (-len(project_id) % 4)
            path = base64.urlsafe_b64decode(padded).decode()
            return path if path and os.path.isabs(path) else None
        except Exception:
            return None

    def _get_project_name(self, project_id: str) -> str:
        """从 project_id 推导项目名称（目录名）。"""
        cwd = self._decode_project_id(project_id)
        if cwd:
            return Path(cwd).name
        return project_id[:8]

    # ── CRUD ──────────────────────────────────────────

    async def create_group(
        self,
        workspace_id: str,
        name: str,
        description: Optional[str] = None,
        created_by: Optional[str] = None,
        project_ids: Optional[List[str]] = None,
    ) -> dict:
        """创建项目组，可选初始化成员。"""
        group_id = str(uuid.uuid4())
        now = self._now_iso()

        async with async_session_factory() as session:
            await session.execute(
                text("""
                    INSERT INTO project_groups (id, workspace_id, name, description, created_by, created_at, updated_at)
                    VALUES (:id, :workspace_id, :name, :description, :created_by, :created_at, :updated_at)
                """),
                {
                    "id": group_id,
                    "workspace_id": workspace_id,
                    "name": name,
                    "description": description,
                    "created_by": created_by,
                    "created_at": now,
                    "updated_at": now,
                },
            )
            await session.commit()

        # 添加初始成员
        if project_ids:
            for idx, pid in enumerate(project_ids):
                role = "primary" if idx == 0 else "member"
                await self.add_member(group_id, pid, role=role, display_order=idx)

        logger.info("Project group created: %s (%s)", name, group_id[:8])
        return await self.get_group(group_id)

    async def update_group(
        self,
        group_id: str,
        name: Optional[str] = None,
        description: Optional[str] = None,
    ) -> Optional[dict]:
        """更新项目组信息。当 group_id 不存在时，返回 None；调用方负责 404 处理。"""
        if not group_id:
            return None
        now = self._now_iso()
        updates = []
        params: dict = {"id": group_id, "updated_at": now}

        if name is not None:
            updates.append("name = :name")
            params["name"] = name
        if description is not None:
            updates.append("description = :description")
            params["description"] = description

        updates.append("updated_at = :updated_at")

        try:
            async with async_session_factory() as session:
                await session.execute(
                    text(f"UPDATE project_groups SET {', '.join(updates)} WHERE id = :id"),
                    params,
                )
                await session.commit()
        except Exception as exc:
            logger.exception("Failed to update project group %s: %s", group_id[:8], exc)
            raise

        logger.info("Project group updated: %s", group_id[:8])
        return await self.get_group(group_id)

    async def delete_group(self, group_id: str) -> None:
        """删除项目组（级联删除成员关系）。group_id 为空或不存在时静默返回。"""
        if not group_id:
            return
        try:
            async with async_session_factory() as session:
                await session.execute(
                    text("DELETE FROM project_group_members WHERE group_id = :group_id"),
                    {"group_id": group_id},
                )
                await session.execute(
                    text("DELETE FROM project_groups WHERE id = :id"),
                    {"id": group_id},
                )
                await session.commit()
        except Exception as exc:
            logger.exception("Failed to delete project group %s: %s", group_id[:8], exc)
            raise
        logger.info("Project group deleted: %s", group_id[:8])

    async def list_groups(self, workspace_id: str) -> List[dict]:
        """列出指定 workspace 下所有项目组。workspace_id 缺省 fallback 到 'default'。"""
        workspace_id = workspace_id or "default"
        async with async_session_factory() as session:
            result = await session.execute(
                text("""
                    SELECT g.*, COUNT(m.id) as member_count
                    FROM project_groups g
                    LEFT JOIN project_group_members m ON m.group_id = g.id
                    WHERE g.workspace_id = :workspace_id
                    GROUP BY g.id
                    ORDER BY g.created_at DESC
                """),
                {"workspace_id": workspace_id},
            )
            rows = result.fetchall()
            return [dict(row._mapping) for row in rows]

    async def get_group(self, group_id: str) -> Optional[dict]:
        """获取项目组详情（含成员列表）。group_id 为空时直接返回 None。"""
        if not group_id:
            return None
        async with async_session_factory() as session:
            result = await session.execute(
                text("SELECT * FROM project_groups WHERE id = :id"),
                {"id": group_id},
            )
            row = result.fetchone()
            if not row:
                return None

            group = dict(row._mapping)

            # 项目成员数（project_group_members）
            project_count_row = await session.execute(
                text(
                    "SELECT COUNT(*) FROM project_group_members"
                    " WHERE group_id = :group_id"
                ),
                {"group_id": group_id},
            )
            group["member_count"] = int(project_count_row.scalar() or 0)

            # 用户成员数（project_group_user_members）
            user_count_row = await session.execute(
                text(
                    "SELECT COUNT(*) FROM project_group_user_members"
                    " WHERE group_id = :group_id"
                ),
                {"group_id": group_id},
            )
            group["user_member_count"] = int(user_count_row.scalar() or 0)

            # 查询成员
            members_result = await session.execute(
                text("""
                    SELECT * FROM project_group_members
                    WHERE group_id = :group_id
                    ORDER BY display_order, added_at
                """),
                {"group_id": group_id},
            )
            members = []
            for m in members_result.fetchall():
                member = dict(m._mapping)
                member["name"] = self._get_project_name(member["project_id"])
                member["cwd"] = self._decode_project_id(member["project_id"])
                members.append(member)

            group["members"] = members
            return group

    # ── 成员管理 ──────────────────────────────────────

    async def add_member(
        self,
        group_id: str,
        project_id: str,
        role: str = "member",
        display_order: int = 0,
    ) -> dict:
        """将项目加入项目组。"""
        if not group_id or not project_id:
            raise ValueError("group_id 和 project_id 不能为空")
        member_id = str(uuid.uuid4())
        now = self._now_iso()

        async with async_session_factory() as session:
            await session.execute(
                text("""
                    INSERT OR IGNORE INTO project_group_members
                        (id, group_id, project_id, role, display_order, added_at)
                    VALUES (:id, :group_id, :project_id, :role, :display_order, :added_at)
                """),
                {
                    "id": member_id,
                    "group_id": group_id,
                    "project_id": project_id,
                    "role": role,
                    "display_order": display_order,
                    "added_at": now,
                },
            )
            await session.commit()

        return {"id": member_id, "group_id": group_id, "project_id": project_id, "role": role}

    async def remove_member(self, group_id: str, project_id: str) -> None:
        """从项目组移除项目。group_id 或 project_id 为空时静默返回。"""
        if not group_id or not project_id:
            return
        async with async_session_factory() as session:
            await session.execute(
                text("""
                    DELETE FROM project_group_members
                    WHERE group_id = :group_id AND project_id = :project_id
                """),
                {"group_id": group_id, "project_id": project_id},
            )
            await session.commit()

    # ── 项目组上下文 ──────────────────────────────────

    async def get_group_projects(self, group_id: str) -> List[dict]:
        """返回组内所有项目的 {project_id, cwd, name, role}。"""
        async with async_session_factory() as session:
            result = await session.execute(
                text("""
                    SELECT project_id, role, display_order
                    FROM project_group_members
                    WHERE group_id = :group_id
                    ORDER BY display_order, added_at
                """),
                {"group_id": group_id},
            )
            projects = []
            for row in result.fetchall():
                m = dict(row._mapping)
                cwd = self._decode_project_id(m["project_id"])
                projects.append({
                    "project_id": m["project_id"],
                    "cwd": cwd or "",
                    "name": Path(cwd).name if cwd else m["project_id"][:8],
                    "role": m["role"],
                })
            return projects

    async def get_group_context_prompt(self, group_id: str) -> str:
        """生成项目组上下文 prompt，注入给 Agent 以感知多仓库环境。"""
        group = await self.get_group(group_id)
        if not group:
            return ""

        projects = await self.get_group_projects(group_id)
        if not projects:
            return ""

        lines = [
            f'你正在处理一个跨多仓库的项目组"{group["name"]}"，包含以下项目：'
        ]
        for idx, p in enumerate(projects, 1):
            role_tag = f"[{p['role']}]"
            lines.append(f"{idx}. {role_tag} {p['name']} ({p['cwd']})")

        lines.append("")
        lines.append(
            "请分析需求，决定哪些仓库需要修改，并为每个需要修改的仓库生成独立的子任务。"
            "每个子任务应明确指定目标仓库路径作为工作目录。"
        )
        return "\n".join(lines)


# 全局单例
project_group_service = ProjectGroupService()
