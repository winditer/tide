#!/usr/bin/env python3
"""知识图谱分析 Prompt 模板与工具函数。

保留 Prompt 模板供 knowledge_service 使用（通过 Agent 生成路径）。
原始的直接 API 调用（LLMClient）已移除，改由 AgentExecutor 驱动。
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

logger = logging.getLogger("tide.llm_analyzer")


# ── JSON 提取工具 ─────────────────────────────────────────────────────────────


def extract_json_from_response(text: str) -> Optional[dict[str, Any]]:
    """从 LLM 响应中提取 JSON 对象。

    支持：
    - 纯 JSON
    - Markdown 代码块包裹的 JSON
    - JSON 前后有解释文本
    """
    # 尝试直接解析
    text = text.strip()
    if text.startswith("{"):
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

    # 尝试从 Markdown 代码块提取
    patterns = [
        r"```json\s*([\s\S]*?)```",
        r"```\s*([\s\S]*?)```",
        r"\{[\s\S]*\}",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            json_str = match.group(1) if match.lastindex else match.group(0)
            try:
                return json.loads(json_str.strip())
            except json.JSONDecodeError:
                continue

    logger.warning("Failed to extract JSON from LLM response: %s...", text[:200])
    return None


# ── Prompt 模板 ──────────────────────────────────────────────────────────────

# 系统提示词
SYSTEM_PROMPT = """你是一个代码分析专家。你的任务是分析仓库代码结构，生成知识图谱数据。

输出可以是以下任一格式：
1. 结构化 JSON 文件（用于程序化消费）
2. Markdown 文档（用于人类阅读）
3. 同时生成 JSON 和 Markdown

请根据仓库实际情况选择最合适的格式。确保输出内容完整、准确。"""

# 模块依赖分析提示词
MODULE_ANALYSIS_PROMPT = """分析以下仓库的代码结构，提取模块依赖关系。

## 仓库信息
{repo_info}

## 输出要求
请生成模块依赖图谱，包含以下信息：
- **模块列表**：每个模块的 ID（路径形式）、文件路径、层级（frontend/backend/shared/utils/services/models/api/tests）、简述、内部依赖、外部依赖、导出的类和函数
- **依赖边**：源模块 → 目标模块的 import 关系
- **架构层级**：各层级的名称、路径前缀、描述

输出格式：JSON 文件 或 Markdown 文档（包含表格和依赖图描述）。

请分析代码文件，识别模块间的导入关系。重点关注：
1. import/require/from 语句
2. 组件/函数的导出和使用
3. 目录结构反映的架构分层"""

# API 接口分析提示词
API_ANALYSIS_PROMPT = """分析以下仓库的 API 接口定义。

## 仓库信息
{repo_info}

## 输出要求
请生成 API 接口图谱，包含以下信息：
- **路由器列表**：每个路由文件的标识、前缀、标签、文件路径、关联服务
- **端点详情**：每个 API 的 HTTP 方法、路径、处理函数、描述

输出格式：JSON 文件 或 Markdown 文档（包含 API 端点表格）。

请分析路由定义文件，提取：
1. 路由装饰器（@router.get, @app.post, router.get(), app.HandleFunc 等）
2. 路径参数
3. 关联的服务层调用"""

# 数据库 Schema 分析提示词
SCHEMA_ANALYSIS_PROMPT = """分析以下仓库的数据库模型定义。

## 仓库信息
{repo_info}

## 输出要求
请生成数据库 Schema 图谱，包含以下信息：
- **表列表**：每张表的名称、列定义（列名/类型/是否可空/主键/外键）、索引、描述
- **外键关系**：源表.列 → 目标表.列
- **实体分组**：按业务域分组的相关表

输出格式：JSON 文件 或 Markdown 文档（包含表结构描述和 ER 关系）。

请分析：
1. SQL 建表语句（init.sql, migrations/）
2. ORM 模型定义（SQLAlchemy, Django, Prisma, GORM, TypeORM）
3. 外键关系和索引"""

# 业务概念分析提示词
CONCEPT_ANALYSIS_PROMPT = """基于以下已分析的模块、API、数据库信息，推导业务概念图。

## 模块依赖图
{module_graph}

## API 接口图谱
{api_graph}

## 数据库 Schema
{schema_graph}

## 输出要求
请生成业务概念图谱，包含以下信息：
- **实体列表**：每个实体的 ID、名称、类型（domain/service/infrastructure）、描述、关联模块/API/表
- **关系列表**：实体间的关系（uses/owns/depends_on/extends）
- **领域划分**：按业务领域分组

输出格式：JSON 文件 或 Markdown 文档（包含实体关系图和领域描述）。

请识别：
1. 核心业务实体（用户、项目、任务等）
2. 实体间关系
3. 业务领域划分"""
