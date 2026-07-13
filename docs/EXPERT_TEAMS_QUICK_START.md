# 专家团 Skills 快速启用指南

## 概述

本指南指导如何将导入的 72 条 skills（58 条 gstack + 14 条 superpowers）配置到 Tide 的 12 个专家团中。

**关键成果**：
- ✅ 7 个核心专家团增强配置（research, coding, verify, code-review, browser, debug, devops）
- ✅ 5 个新增补充专家团（product-designer, plan-manager, qa-manager, architecture-reviewer, integration-engineer）
- ✅ 72 条 skills 科学分类与配对
- ✅ 一键配置脚本

---

## 快速启用（3 分钟）

### 步骤 1：验证 Skills 已导入

```bash
sqlite3 /Users/haifeng/Documents/tide/tide.db "SELECT COUNT(*), source FROM skills WHERE source IN ('gstack', 'superpowers') GROUP BY source;"
```

预期输出：
```
58|gstack
14|superpowers
```

### 步骤 2：执行配置脚本

```bash
cd /Users/haifeng/Documents/tide && python3 backend/scripts/seed_expert_teams_gstack.py
```

预期输出：
```
================================================================================
配置专家团 Skills
================================================================================

第一阶段：更新 7 个核心专家团的 Skills...

  ✅ research-analyst: 6 skills
  ✅ coding-engineer: 5 skills
  ✅ verify-qa: 6 skills
  ✅ code-reviewer: 5 skills
  ✅ browser-tester: 5 skills
  ✅ debug-diagnostician: 4 skills
  ✅ devops-engineer: 7 skills

第二阶段：创建 5 个新增补充专家团...

  ✅ 创建: 产品设计 (product-designer)
  ✅ 创建: 计划管理 (plan-manager)
  ✅ 创建: 质量管理 (qa-manager)
  ✅ 创建: 架构评审 (architecture-reviewer)
  ✅ 创建: 系统集成 (integration-engineer)

================================================================================
执行完成: 更新 7 个现有专家团，创建 5 个新专家团
================================================================================
```

### 步骤 3：验证配置完成

```bash
sqlite3 /Users/haifeng/Documents/tide/tide.db "SELECT name, slug, json_array_length(json(skill_slugs)) as skill_count FROM expert_teams WHERE enabled = 1 ORDER BY created_at;"
```

---

## 12 个专家团速查表

### 核心团队（7 个）

| # | 名称 | Slug | Skills 数 | 核心能力 |
|----|------|------|----------|--------|
| 1 | Research 研究智能体 | research-analyst | 6 | 系统化调试、数据抓取、项目学习 |
| 2 | Coding 编码智能体 | coding-engineer | 5 | 需求规格化、设计转实现、TDD |
| 3 | Verify 验证智能体 | verify-qa | 6 | Web QA、性能基准、iOS 测试 |
| 4 | CodeReview 审查智能体 | code-reviewer | 5 | PR 审查、安全审核、防护 |
| 5 | Browser 浏览器智能体 | browser-tester | 5 | 无头浏览器、UI 审计、E2E 测试 |
| 6 | Debug 调试智能体 | debug-diagnostician | 4 | 根因分析、性能诊断 |
| 7 | DevOps 运维智能体 | devops-engineer | 7 | 发布工作流、部署监控、周期回顾 |

### 补充团队（5 个）

| # | 名称 | Slug | Skills 数 | 核心能力 |
|----|------|------|----------|--------|
| 8 | 产品设计 | product-designer | 5 | 设计系统、多方案生成、HTML 实现 |
| 9 | 计划管理 | plan-manager | 6 | 规格化、多角度审查、自动审批 |
| 10 | 质量管理 | qa-manager | 6 | 系统化 QA、性能基准、定期回顾 |
| 11 | 架构评审 | architecture-reviewer | 5 | 架构设计、安全评估、DX 评价 |
| 12 | 系统集成 | integration-engineer | 5 | Agent 配对、流程可视化、并行编排 |

---

## 工作流集成示例

### 完整功能实现工作流

```yaml
name: "完整功能实现（含多角度审查）"
nodes:
  - id: planning
    type: agent
    data:
      expert_team_id: "team-plan-manager"  # 计划管理团队
      prompt: "根据需求编写实现计划"
  
  - id: implementation
    type: agent
    data:
      expert_team_id: "team-coding-engineer"  # 编码团队
      prompt: "按计划实现功能"
  
  - id: qa_testing
    type: agent
    data:
      expert_team_id: "team-qa-manager"  # QA 管理团队
      prompt: "系统化 QA 测试"
  
  - id: code_review
    type: agent
    data:
      expert_team_id: "team-code-reviewer"  # 代码审查团队
      prompt: "审查代码质量和安全性"
  
  - id: architecture_review
    type: agent
    data:
      expert_team_id: "team-architecture-reviewer"  # 架构评审团队
      prompt: "评审架构设计和 DX"
  
  - id: deployment
    type: agent
    data:
      expert_team_id: "team-devops-engineer"  # DevOps 团队
      prompt: "准备发布和部署"

edges:
  - from: planning
    to: [implementation]
  - from: implementation
    to: [qa_testing, code_review, architecture_review]
  - from: [qa_testing, code_review, architecture_review]
    to: deployment
```

### Skills 注入效果

当工作流执行到 `planning` 节点时，Agent 收到的 prompt 会自动包含：

```
# 你的角色

[计划管理专家的角色提示词...]

---

# 可用技能

## gstack-spec
Turn vague intent into a precise, executable spec in five phases
[完整技能内容...]

## gstack-plan-eng-review
Eng manager-mode plan review
[完整技能内容...]

## gstack-plan-devex-review
Interactive developer experience plan review
[完整技能内容...]

## gstack-plan-ceo-review
CEO/founder-mode plan review
[完整技能内容...]

## gstack-autoplan
Auto-review pipeline — reads the full CEO, design, eng, and DX review skills from disk...
[完整技能内容...]

## superpowers-writing-plans
Use when you have a spec or requirements for a multi-step task, before touching code
[完整技能内容...]

---

根据需求编写实现计划
```

---

## 常见问题

### Q1：如何验证 Skills 已正确注入？

**A**：查看工作流执行日志中的 prompt 前缀，应包含 `# 你的角色` 和 `# 可用技能` 两个部分。

### Q2：是否可以为某个项目配置专属专家团？

**A**：可以。设置 `project_id` 字段（而非 NULL）即可创建项目级专家团，会覆盖全局同 slug 的专家团。

### Q3：如何在现有工作流中使用？

**A**：只需将工作流 Agent 节点的 `agent_id` 改为 `expert_team_id`，工作流引擎会自动解析。

### Q4：是否支持小队（Squad）模式？

**A**：支持。设置 `is_squad=1`，配置 `member_agents` JSON 数组，支持 `capability_match`、`round_robin`、`random` 三种策略。

### Q5：Skills 更新后如何同步？

**A**：重新运行配置脚本，使用 `UPDATE` 语句即可。

---

## 文件清单

| 文件 | 说明 |
|------|------|
| `/docs/EXPERT_TEAMS_CONFIGURATION_GUIDE.md` | 完整的专家团配置研究报告（33KB） |
| `/backend/scripts/seed_expert_teams_gstack.py` | 一键配置脚本 |
| `/docs/EXPERT_TEAMS_QUICK_START.md` | 本快速启用指南 |

---

## 下一步

1. ✅ 执行配置脚本（见快速启用 > 步骤 2）
2. ✅ 在测试工作流中验证 Skills 注入效果
3. ✅ 收集 Agent 使用反馈
4. 📋 每周审查专家团配置的有效性
5. 📈 根据 Metrics 调整 Skills 组合

---

**最后更新**：2024 年 7 月
**维护者**：Research 智能体
