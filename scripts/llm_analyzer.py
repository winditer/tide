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

# 系统架构分析提示词
ARCHITECTURE_ANALYSIS_PROMPT = """分析以下仓库的系统架构。

## 仓库信息
{repo_info}

## 输出要求
请生成系统架构图谱，包含以下信息：
- **架构视图**：系统整体分层（表现层/应用层/领域层/基础设施层/外部集成层）
- **核心组件**：每个组件的职责、所处层级、依赖关系
- **数据流**：关键业务流程的数据流转路径
- **部署边界**：哪些组件属于前端、后端、数据库、消息队列、外部服务
- **交互关系**：组件之间的同步/异步调用关系

输出格式：JSON 文件 或 Markdown 文档（包含架构图描述和分层说明）。

请基于配置文件、入口文件、服务编排文件（如 docker-compose.yml、Dockerfile、nginx 配置）、README 等信息进行推断。"""

# 技术栈分析提示词
TECH_STACK_ANALYSIS_PROMPT = """分析以下仓库使用的技术栈。

## 仓库信息
{repo_info}

## 输出要求
请生成技术栈图谱，包含以下信息：
- **编程语言**：各语言的使用场景和占比估算
- **运行时与框架**：Web 框架、UI 框架、ORM、构建工具等
- **数据存储**：数据库、缓存、消息队列、文件存储
- **外部服务**：第三方 API、云服务、认证提供方
- **开发与运维工具**：包管理器、测试框架、CI/CD、容器化、代码检查工具
- **依赖关系图**：核心依赖及其用途

输出格式：JSON 文件 或 Markdown 文档（包含技术栈清单和依赖关系）。

请分析：package.json、requirements.txt、pyproject.toml、go.mod、Cargo.toml、Dockerfile、docker-compose.yml、CI 配置文件等。"""

# 编码风格分析提示词
CODING_STYLE_ANALYSIS_PROMPT = """分析以下仓库的编码风格与工程实践。

## 仓库信息
{repo_info}

## 输出要求
请生成编码风格图谱，包含以下信息：
- **命名约定**：文件命名、类/函数/变量命名规范（CamelCase、snake_case、PascalCase 等）
- **代码组织**：目录结构约定、模块划分原则、公共函数/工具类位置
- **类型与接口**：类型注解使用方式、接口/模型定义习惯
- **错误处理**：异常处理模式、错误返回值约定
- **测试实践**：测试文件位置、测试命名、使用的测试框架
- **注释与文档**：函数注释风格、README/开发文档要求
- **格式化与检查**：lint 配置、格式化工具、pre-commit 规则

输出格式：JSON 文件 或 Markdown 文档（包含风格规范总结和示例引用）。

请基于源码中的实际写法、配置文件（eslint/prettier/ruff/black/mypy/pytest 等）和 README/CONTRIBUTING 文档进行归纳。"""

# 数据流 / 工作流分析提示词
DATA_FLOW_ANALYSIS_PROMPT = """分析以下仓库的核心数据流与工作流。

## 仓库信息
{repo_info}

## 输出要求
请生成数据流图谱，包含以下信息：
- **请求链路**：从客户端到后端的典型 HTTP/WebSocket 请求完整流转路径（入口 → 中间件 → 路由 → 服务 → 数据库 → 返回）
- **异步流程**：后台任务、定时任务、事件驱动流程的触发-处理-通知链路
- **数据模型流转**：核心业务对象（用户/项目/任务/计划等）的创建-更新-归档生命周期中的数据流向
- **文件/产物存储**：文件上传/生成/归档的存储路径和访问方式
- **外部集成**：与第三方服务（Lark、GitHub 等）的数据交换点和格式

输出格式：JSON 文件 或 Markdown 文档（包含数据流图和 Mermaid 序列图）。

请基于 API 路由定义、服务层调用链、WebSocket 消息处理、后台任务调度、事件发布订阅等代码进行分析。"""

# 测试覆盖分析提示词
TEST_COVERAGE_ANALYSIS_PROMPT = """分析以下仓库的测试覆盖情况。

## 仓库信息
{repo_info}

## 输出要求
请生成测试覆盖图谱，包含以下信息：
- **测试文件清单**：每个测试文件的路径、测试框架、测试数量统计
- **被测代码映射**：每个测试覆盖的目标模块/类/函数
- **覆盖缺口**：哪些核心模块/服务/API 没有对应测试
- **测试分层**：单元测试 vs 集成测试 vs E2E 测试的分布
- **测试运行配置**：pytest/jest/vitest 配置、测试命令、CI 配置

输出格式：JSON 文件 或 Markdown 文档（包含覆盖矩阵和缺口报告）。

请分析：
1. 测试文件（test_*.py, *.test.ts, *.spec.ts 等）
2. 配置文件（pytest.ini, jest.config.ts, vitest.config.ts）
3. 被测代码的 import/调用关系
4. CI/CD 配置中的测试步骤"""

# 事件总线分析提示词
EVENT_BUS_ANALYSIS_PROMPT = """分析以下仓库的事件/消息总线与异步通信机制。

## 仓库信息
{repo_info}

## 输出要求
请生成事件总线图谱，包含以下信息：
- **事件定义**：所有事件类型/名称、schema 或 payload 结构
- **生产者**：发布/触发每个事件的代码位置（文件、函数）
- **消费者**：订阅/监听每个事件的代码位置（文件、函数）
- **通信机制**：事件总线类型（进程内 EventBus / Redis Pub/Sub / Kafka / WebSocket / SSE / Webhook）
- **外部事件**：接收的外部事件（Lark callback、Webhook 等）和触发点

输出格式：JSON 文件 或 Markdown 文档（包含事件流图和发布-订阅矩阵）。

请分析：
1. 事件发布代码（emit、publish、trigger、signal 等调用）
2. 事件订阅代码（on、subscribe、listen、@event_handler 等装饰器）
3. WebSocket 消息类型
4. HTTP Webhook 端点
5. 消息队列相关配置和代码"""
