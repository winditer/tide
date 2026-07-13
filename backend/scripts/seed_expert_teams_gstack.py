"""
批量配置专家团 Skills——集成 gstack 和 superpowers skills。

执行方式：
    cd /Users/haifeng/Documents/tide && python3 backend/scripts/seed_expert_teams_gstack.py
"""

import sqlite3
import json
import uuid
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent.parent / "tide.db"
WORKSPACE_ID = "default"
AGENT_ID = "qoder"

# 7 个核心专家团 Skills 配置
EXPERT_TEAMS_UPDATE = [
    {
        "slug": "research-analyst",
        "skill_slugs": [
            "gstack-investigate",
            "gstack-scrape",
            "gstack-learn",
            "gstack-health",
            "superpowers-systematic-debugging",
            "superpowers-brainstorming"
        ]
    },
    {
        "slug": "coding-engineer",
        "skill_slugs": [
            "gstack-spec",
            "gstack-design-html",
            "superpowers-writing-plans",
            "superpowers-subagent-driven-development",
            "superpowers-test-driven-development"
        ]
    },
    {
        "slug": "verify-qa",
        "skill_slugs": [
            "gstack-qa",
            "gstack-qa-only",
            "gstack-benchmark",
            "gstack-ios-qa",
            "superpowers-verification-before-completion",
            "superpowers-systematic-debugging"
        ]
    },
    {
        "slug": "code-reviewer",
        "skill_slugs": [
            "gstack-review",
            "gstack-cso",
            "gstack-guard",
            "superpowers-requesting-code-review",
            "superpowers-receiving-code-review"
        ]
    },
    {
        "slug": "browser-tester",
        "skill_slugs": [
            "gstack-browse",
            "gstack-design-review",
            "gstack-devex-review",
            "gstack-browser-skills-hackernews-frontpage",
            "superpowers-verification-before-completion"
        ]
    },
    {
        "slug": "debug-diagnostician",
        "skill_slugs": [
            "gstack-investigate",
            "gstack-openclaw-skills-gstack-openclaw-investigate",
            "gstack-benchmark",
            "superpowers-systematic-debugging"
        ]
    },
    {
        "slug": "devops-engineer",
        "skill_slugs": [
            "gstack-ship",
            "gstack-land-and-deploy",
            "gstack-setup-deploy",
            "gstack-canary",
            "gstack-openclaw-skills-gstack-openclaw-retro",
            "superpowers-finishing-a-development-branch",
            "superpowers-using-git-worktrees"
        ]
    }
]

# 5 个新增补充专家团
NEW_EXPERT_TEAMS = [
    {
        "name": "产品设计",
        "slug": "product-designer",
        "description": "专业产品设计师，负责完整的设计系统和视觉实现",
        "skill_slugs": [
            "gstack-design-consultation",
            "gstack-design-shotgun",
            "gstack-plan-design-review",
            "gstack-design-html",
            "superpowers-brainstorming"
        ],
        "role_prompt": """# 角色：产品设计专家（Product Designer Agent）

## 核心职责
你是一个专业的产品设计师，负责完整的设计系统和视觉实现，从概念设计到生产级 HTML/CSS。

## 能力范围
1. 设计系统：美学、排版、颜色、布局、间距、动作定义
2. 多方案设计：生成 AI 变体、对比评估、迭代收集反馈
3. 交互设计：设计师视角的用户体验审计
4. 实现：生产级 HTML/CSS 代码生成

## 行为约束
1. 设计决策前必须进行头脑风暴
2. 提供多个设计方案供选择（不是单一方案）
3. 设计与实现必须一致
4. 基于用户反馈迭代"""
    },
    {
        "name": "计划管理",
        "slug": "plan-manager",
        "description": "计划管理专家，负责需求规格化、多角度计划审查、自动化审批",
        "skill_slugs": [
            "gstack-spec",
            "gstack-plan-eng-review",
            "gstack-plan-devex-review",
            "gstack-plan-ceo-review",
            "gstack-autoplan",
            "superpowers-writing-plans"
        ],
        "role_prompt": """# 角色：计划管理专家（Plan Manager Agent）

## 核心职责
你是一个专业的计划管理专家，负责需求规格化、多角度计划审查、自动化审批、优先级管理。

## 能力范围
1. 需求规格化：5 阶段从模糊意图到可执行规格
2. 多角度审查：工程、设计、DX、CEO 多维度评估
3. 自动化审批：CEO/Design/Eng/DX 四层审批流自动化
4. 优先级优化：根据复杂度和收益调整范围"""
    },
    {
        "name": "质量管理",
        "slug": "qa-manager",
        "description": "QA 经理，负责系统化质量评估、性能基准维护、定期回顾",
        "skill_slugs": [
            "gstack-qa",
            "gstack-benchmark",
            "gstack-retro",
            "gstack-openclaw-skills-gstack-openclaw-investigate",
            "superpowers-test-driven-development",
            "superpowers-verification-before-completion"
        ],
        "role_prompt": """# 角色：质量管理专家（QA Manager Agent）

## 核心职责
你是一个专业的 QA 经理，负责系统化的质量评估、性能基准维护、定期回顾和问题诊断。

## 能力范围
1. 系统化 QA：Web 应用全面测试和缺陷发现
2. 性能基准：建立和维护性能基线，检测回归
3. 定期回顾：周期性质量分析和改进建议
4. 根因分析：复杂问题的系统诊断"""
    },
    {
        "name": "架构评审",
        "slug": "architecture-reviewer",
        "description": "架构评审专家，负责代码设计审查、安全架构评估、开发体验评价",
        "skill_slugs": [
            "gstack-review",
            "gstack-cso",
            "gstack-devex-review",
            "gstack-guard",
            "superpowers-requesting-code-review"
        ],
        "role_prompt": """# 角色：架构评审专家（Architecture Reviewer Agent）

## 核心职责
你是一个资深的架构评审专家，负责代码设计审查、安全架构评估、开发体验评价、破坏性操作防护。

## 评审维度
1. 架构设计：组件设计、模块化、可扩展性
2. 安全性：认证授权、数据保护、输入校验
3. 开发体验：API 易用性、文档清晰度、错误消息
4. 防护：防止破坏性命令意外执行"""
    },
    {
        "name": "系统集成",
        "slug": "integration-engineer",
        "description": "系统集成工程师，负责多 Agent 协作、复杂任务编排、系统可视化",
        "skill_slugs": [
            "gstack-pair-agent",
            "gstack-diagram",
            "superpowers-dispatching-parallel-agents",
            "superpowers-executing-plans",
            "superpowers-subagent-driven-development"
        ],
        "role_prompt": """# 角色：系统集成工程师（Integration Engineer Agent）

## 核心职责
你是一个系统集成工程师，负责多 Agent 协作、复杂任务编排、系统可视化、并行执行管理。

## 能力范围
1. Agent 配对：将远程 AI 智能体与浏览器或其他工具配对
2. 流程可视化：使用图表和 Mermaid 清晰表达系统流程
3. 并行任务管理：2+ 独立任务的并行派发和管理
4. 实现计划执行：分解复杂计划成可执行步骤
5. 子任务驱动开发：当前会话内的多任务分解执行"""
    }
]


def main():
    if not DB_PATH.exists():
        print(f"❌ 数据库文件不存在: {DB_PATH}")
        return

    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()

    print("=" * 80)
    print("配置专家团 Skills")
    print("=" * 80)

    # 更新现有专家团
    print("\n第一阶段：更新 7 个核心专家团的 Skills...\n")
    updated_count = 0
    for team in EXPERT_TEAMS_UPDATE:
        skill_slugs_json = json.dumps(team["skill_slugs"], ensure_ascii=False)
        cursor.execute(
            """
            UPDATE expert_teams
            SET skill_slugs = ?, updated_at = datetime('now')
            WHERE slug = ? AND workspace_id = ?
            """,
            (skill_slugs_json, team["slug"], WORKSPACE_ID)
        )
        if cursor.rowcount > 0:
            updated_count += 1
            print(f"  ✅ {team['slug']}: {len(team['skill_slugs'])} skills")
        else:
            print(f"  ⚠️  {team['slug']}: 未找到（可能不存在）")

    # 创建新增专家团
    print("\n第二阶段：创建 5 个新增补充专家团...\n")
    created_count = 0
    for team in NEW_EXPERT_TEAMS:
        team_id = str(uuid.uuid4())
        skill_slugs_json = json.dumps(team["skill_slugs"], ensure_ascii=False)
        try:
            cursor.execute(
                """
                INSERT OR IGNORE INTO expert_teams
                    (id, workspace_id, project_id, name, slug, description,
                     agent_id, model, skill_slugs, role_prompt, enabled,
                     created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
                """,
                (
                    team_id,
                    WORKSPACE_ID,
                    None,  # project_id = NULL (全局)
                    team["name"],
                    team["slug"],
                    team["description"],
                    AGENT_ID,
                    None,  # model
                    skill_slugs_json,
                    team["role_prompt"],
                    1,  # enabled
                )
            )
            if cursor.rowcount > 0:
                created_count += 1
                print(f"  ✅ 创建: {team['name']} ({team['slug']})")
            else:
                print(f"  ⏭️  跳过(已存在): {team['name']} ({team['slug']})")
        except sqlite3.Error as e:
            print(f"  ❌ 失败: {team['name']} - {e}")

    conn.commit()
    conn.close()

    print("\n" + "=" * 80)
    print(f"执行完成: 更新 {updated_count} 个现有专家团，创建 {created_count} 个新专家团")
    print("=" * 80)


if __name__ == "__main__":
    main()
