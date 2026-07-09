"""项目作用域匹配工具函数。

支持 project_id 字段的多种存储格式：
- None → 全局
- 单个项目 ID 字符串 → 单项目
- JSON 数组字符串 → 多选，如 '["proj-1","group:grp-1"]'
- 项目组使用 "group:<group_id>" 前缀
"""
from __future__ import annotations

import json
from typing import Optional


def parse_scope_targets(project_id: Optional[str]) -> list[str]:
    """将 project_id 字段值解析为目标列表。

    - None → [] (全局)
    - 单个 ID → [id]
    - JSON 数组 → 解析后的列表
    """
    if not project_id:
        return []
    # 尝试 JSON 数组
    if project_id.startswith("["):
        try:
            parsed = json.loads(project_id)
            if isinstance(parsed, list):
                return [str(t) for t in parsed if t]
        except (json.JSONDecodeError, TypeError):
            pass
    # 单个值
    return [project_id]


def encode_scope_targets(targets: list[str]) -> Optional[str]:
    """将目标列表编码为 project_id 字段值。

    - [] → None (全局)
    - [single] → single (保持简单字符串，向后兼容)
    - [a, b, ...] → JSON 数组字符串
    """
    if not targets:
        return None
    if len(targets) == 1:
        return targets[0]
    return json.dumps(targets, ensure_ascii=False)


def match_project_scope(
    stored_project_id: Optional[str],
    current_project_id: Optional[str],
    project_group_ids: Optional[set] = None,
) -> bool:
    """判断存储的作用域是否匹配当前项目上下文。

    - stored_project_id 为 None → 全局，所有项目都匹配
    - 直接项目 ID 匹配
    - group:<gid> 前缀：检查当前项目是否属于该组

    Args:
        stored_project_id: DB 中存储的 project_id 字段值
        current_project_id: 当前请求的项目 ID
        project_group_ids: 当前项目所属的所有 group_id 集合
    """
    # 全局 → 所有场景可见
    if not stored_project_id:
        return True

    # 当前无项目上下文 → 仅全局可见
    if not current_project_id:
        return False

    targets = parse_scope_targets(stored_project_id)

    for target in targets:
        # 直接项目匹配
        if target == current_project_id:
            return True
        # 项目组匹配
        if target.startswith("group:"):
            gid = target[6:]
            if project_group_ids and gid in project_group_ids:
                return True

    return False
