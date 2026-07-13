# Tide 专家团配置方案研究报告

## 一、专家团数据模型与配置方式

### 1.1 数据模型

专家团（Expert Teams）在 Tide 中的数据模型包含以下核心字段（来自 `expert_teams` 表）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | TEXT (UUID) | 专家团唯一标识 |
| `workspace_id` | TEXT | 工作空间ID（默认 `default`） |
| `project_id` | TEXT (可选) | 项目ID（NULL 表示全局作用域） |
| `name` | TEXT | 专家团名称（中英文均支持） |
| `slug` | TEXT | URL友好标识符（自动生成或指定，workspace_id + slug 唯一约束） |
| `description` | TEXT | 专家团描述 |
| `agent_id` | TEXT | 绑定的 Agent ID（必填）- 通常为 `qoder`、`codex` 等 |
| `model` | TEXT (可选) | 自定义模型覆盖（如 `gpt-4`） |
| `skill_slugs` | JSON 数组 | 技能列表（JSON 格式存储，运行时解析为列表） |
| `role_prompt` | TEXT | 角色提示词（工作流执行时自动注入到 prompt 前缀） |
| `member_agents` | JSON 数组 | Squad 成员列表（仅在 `is_squad=1` 时有意义） |
| `is_squad` | INT (0/1) | 是否为小队模式（支持多 Agent 协作） |
| `leader_strategy` | TEXT | 小队调度策略：`capability_match` (优先级) / `round_robin` / `random` |
| `enabled` | INT (0/1) | 是否启用（0=禁用） |
| `created_by` | TEXT | 创建者ID |
| `created_at` | TIMESTAMP | 创建时间 |
| `updated_at` | TIMESTAMP | 更新时间 |

### 1.2 工作流中的使用方式

在工作流引擎中，专家团通过以下方式被引用和使用：

#### (1) 工作流节点配置（Agent 节点）
工作流 YAML 中的 Agent 节点可以设置 `expert_team_id` 字段，例如：
```yaml
nodes:
  - id: code_review
    type: agent
    data:
      expert_team_id: "team-uuid-here"  # 指定专家团
      skills: ["security-review"]        # 可选：附加技能
```

#### (2) 运行时解析流程
当工作流执行到 Agent 节点时：
1. 检查节点是否配置了 `expert_team_id`
2. 调用 `ExpertTeamService.resolve_squad()` 或 `resolve_expert_team()`
3. 从专家团获取以下信息并覆盖节点配置：
   - **Agent ID**：覆盖节点的 `agent_id`
   - **Model**：若专家团配置了 `model`，覆盖节点的 `model`
   - **Skills**：将专家团的 `skill_slugs` 与节点手动配置的 `skills` 合并（去重保序）
   - **Role Prompt**：将专家团的 `role_prompt` 注入到 prompt 前缀

#### (3) Skills 注入机制
Skills 内容在 prompt 构造阶段通过 `_build_prompt_with_skills()` 注入：
```
# 你的角色

[role_prompt 内容]

---

# 可用技能

[skill_1 完整内容 (Markdown)]
---
[skill_2 完整内容 (Markdown)]
---
...

[原始 prompt]
```

### 1.3 作用域机制

专家团支持多层作用域：
- **全局**：`project_id = NULL`（所有项目可用）
- **项目级**：`project_id = "project-id"`（仅该项目可用）
- **个人**：`project_id = "personal:user-id"`（仅该用户可见）

当查询时，使用 `get_expert_teams_for_project()` 可自动合并全局和项目级专家团，项目级覆盖全局（按 slug）。

---

## 二、导入的 Skills 完整清单

### 2.1 统计概览

| 来源 | 数量 | AI-Agent | DevOps | General | Security | Testing |
|------|------|---------|--------|---------|----------|---------|
| **gstack** | 58 | 29 | 5 | 17 | 2 | 6 |
| **superpowers** | 14 | 6 | 2 | 3 | - | 3 |
| **合计** | **72** | **35** | **7** | **20** | **2** | **9** |

### 2.2 GStack Skills（58 条）

#### AI-Agent 类（29 条）
用于 AI 决策、审查、规划的高级技能

| 技能名 | Slug | 应用场景 |
|--------|------|--------|
| autoplan | `gstack-autoplan` | 自动化审批流程（CEO、设计、工程、DX 审核自动化） |
| browse | `gstack-browse` | 快速无头浏览器，QA 测试和网站验证 |
| careful | `gstack-careful` | 安全卫士，防护破坏性命令 |
| codex | `gstack-codex` | OpenAI Codex CLI 包装（三种模式） |
| design-consultation | `gstack-design-consultation` | 设计咨询，完整设计系统生成 |
| design-html | `gstack-design-html` | 设计定稿，生成生产级 HTML/CSS |
| design-review | `gstack-design-review` | 设计师 QA，视觉一致性和交互检查 |
| design-shotgun | `gstack-design-shotgun` | 多设计方案生成与对比 |
| devex-review | `gstack-devex-review` | 开发者体验审计 |
| diagram | `gstack-diagram` | 将文本/Mermaid 转为图表（Excalidraw） |
| gstack-openclaw-ceo-review | `gstack-openclaw-skills-gstack-openclaw-ceo-review` | CEO 模式审查（挑战方案、扩大范围） |
| gstack-openclaw-office-hours | `gstack-openclaw-skills-gstack-openclaw-office-hours` | 头脑风暴和想法验证 |
| hackernews-frontpage | `gstack-browser-skills-hackernews-frontpage` | 爬取 Hacker News 首页 |
| investigate | `gstack-investigate` | 系统化调试和根因分析 |
| ios-clean | `gstack-ios-clean` | iOS 调试包清理 |
| ios-design-review | `gstack-ios-design-review` | iOS 真机设计审计 |
| ios-fix | `gstack-ios-fix` | 自主 iOS Bug 修复 |
| ios-sync | `gstack-ios-sync` | iOS 调试桥同步 |
| office-hours | `gstack-office-hours` | YC 办公室时间（两种模式） |
| pair-agent | `gstack-pair-agent` | 配对远程 AI 智能体与浏览器 |
| plan-ceo-review | `gstack-plan-ceo-review` | CEO/创始人模式计划审查 |
| plan-design-review | `gstack-plan-design-review` | 设计师计划审查（交互式） |
| plan-devex-review | `gstack-plan-devex-review` | 开发者体验计划审查（交互式） |
| plan-eng-review | `gstack-plan-eng-review` | 工程经理模式计划审查 |
| plan-tune | `gstack-plan-tune` | 自调优问题敏感度和开发者心理画像 |
| retro | `gstack-retro` | 周工程回顾 |
| review | `gstack-review` | 登陆前 PR 审查 |
| spec | `gstack-spec` | 将模糊意图转为精确可执行规格（五阶段） |
| benchmark-models | `gstack-benchmark-models` | 跨模型基准测试 |

#### DevOps 类（5 条）
部署、监控和工作流自动化

| 技能名 | Slug | 应用场景 |
|--------|------|--------|
| canary | `gstack-canary` | 部署后金丝雀监控 |
| gstack-openclaw-retro | `gstack-openclaw-skills-gstack-openclaw-retro` | 周工程回顾（提交历史分析、人员贡献） |
| land-and-deploy | `gstack-land-and-deploy` | 登陆与部署工作流 |
| setup-deploy | `gstack-setup-deploy` | 部署设置配置 |
| ship | `gstack-ship` | 发布工作流（测试、Diff 审查、版本更新、提交） |

#### General 类（17 条）
通用支持工具和上下文管理

| 技能名 | Slug | 应用场景 |
|--------|------|--------|
| context-restore | `gstack-context-restore` | 恢复之前保存的工作上下文 |
| context-save | `gstack-context-save` | 保存工作上下文 |
| document-generate | `gstack-document-generate` | 生成缺失文档 |
| document-release | `gstack-document-release` | 发布后文档更新 |
| freeze | `gstack-freeze` | 限制文件编辑范围 |
| gstack-upgrade | `gstack-gstack-upgrade` | 升级 gstack 到最新版本 |
| health | `gstack-health` | 代码质量仪表板 |
| landing-report | `gstack-landing-report` | 工作空间感知的发布队列仪表板 |
| learn | `gstack-learn` | 项目学习管理 |
| make-pdf | `gstack-make-pdf` | Markdown 转 PDF |
| open-gstack-browser | `gstack-open-gstack-browser` | 启动 GStack 浏览器 |
| scrape | `gstack-scrape` | 网页数据抓取 |
| setup-browser-cookies | `gstack-setup-browser-cookies` | 导入浏览器 Cookie |
| setup-gbrain | `gstack-setup-gbrain` | GBrain 初始化配置 |
| skillify | `gstack-skillify` | 将成功的爬取流程转为永久技能 |
| sync-gbrain | `gstack-sync-gbrain` | GBrain 同步更新 |
| unfreeze | `gstack-unfreeze` | 清除文件编辑限制 |

#### Security 类（2 条）
安全审查和防护

| 技能名 | Slug | 应用场景 |
|--------|------|--------|
| cso | `gstack-cso` | 首席安全官模式 |
| guard | `gstack-guard` | 完整安全模式（破坏性命令警告） |

#### Testing 类（6 条）
QA 和验证

| 技能名 | Slug | 应用场景 |
|--------|------|--------|
| benchmark | `gstack-benchmark` | 性能回归检测 |
| gstack-openclaw-investigate | `gstack-openclaw-skills-gstack-openclaw-investigate` | 调试和根因分析 |
| ios-qa | `gstack-ios-qa` | iOS 真机 QA 测试 |
| qa | `gstack-qa` | Web 应用系统化 QA 测试 |
| qa-only | `gstack-qa-only` | 仅报告式 QA 测试 |

### 2.3 Superpowers Skills（14 条）

#### AI-Agent 类（6 条）
代理决策和任务执行

| 技能名 | Slug | 应用场景 |
|--------|------|--------|
| Dispatching Parallel Agents | `superpowers-dispatching-parallel-agents` | 派发 2+ 独立并行任务 |
| Executing Plans | `superpowers-executing-plans` | 执行已编写的实现计划（独立会话） |
| Receiving Code Review | `superpowers-receiving-code-review` | 接收代码审查反馈前的验证 |
| Requesting Code Review | `superpowers-requesting-code-review` | 完成任务或实现大功能后的审查 |
| Subagent Driven Development | `superpowers-subagent-driven-development` | 执行多个独立任务的实现计划（当前会话） |
| Writing Plans | `superpowers-writing-plans` | 为多步骤任务编写规格/需求 |

#### DevOps 类（2 条）
开发工作流管理

| 技能名 | Slug | 应用场景 |
|--------|------|--------|
| Finishing A Development Branch | `superpowers-finishing-a-development-branch` | 完成后决定如何集成（合并/PR/清理） |
| Using Git Worktrees | `superpowers-using-git-worktrees` | 隔离工作空间或执行实现计划前 |

#### General 类（3 条）
通用工作流

| 技能名 | Slug | 应用场景 |
|--------|------|--------|
| Brainstorming | `superpowers-brainstorming` | 创意工作前的必选（需求/设计探索） |
| Using Superpowers | `superpowers-using-superpowers` | 对话启动时的元技能（必选） |
| Writing Skills | `superpowers-writing-skills` | 创建/编辑/验证技能 |

#### Testing 类（3 条）
测试驱动和验证

| 技能名 | Slug | 应用场景 |
|--------|------|--------|
| Systematic Debugging | `superpowers-systematic-debugging` | Bug 或测试失败诊断前 |
| Test Driven Development | `superpowers-test-driven-development` | 功能或 Bug 修复实现前 |
| Verification Before Completion | `superpowers-verification-before-completion` | 声称完成/通过前的验证 |

---

## 三、当前预置专家团配置

Tide 已预置的 10 个专家团（均为 agent_id="qoder"）：

| 专家团名 | Slug | 当前配置的 Skills | 角色定位 |
|---------|------|-----------------|--------|
| Leader 编排智能体 | leader-orchestrator | 8 个计划/编排技能 | 任务分解、调度、结果整合 |
| Research 研究智能体 | research-analyst | 7 个研究/扫描技能 | 代码库探索、依赖分析、报告 |
| Coding 编码智能体 | coding-engineer | 0（无） | 代码编写、修改、修复 |
| Verify 验证智能体 | verify-qa | 8 个测试/验证技能 | 测试、Lint、构建验证 |
| CodeReview 审查智能体 | code-reviewer | 8 个安全/架构审查技能 | 逻辑 Bug、安全漏洞、API 契约检查 |
| Browser 浏览器智能体 | browser-tester | 7 个 UI/E2E 测试技能 | 端到端测试、截图、页面交互 |
| Debug 调试智能体 | debug-diagnostician | 6 个调试/评估技能 | 问题复现、根因分析、诊断报告 |
| DataAnalysis 数据分析智能体 | data-analyst | 6 个数据/数据库技能 | 数据探索、统计、可视化 |
| DevOps 运维智能体 | devops-engineer | 6 个基础设施/CLI 技能 | CI/CD、容器化、监控 |
| FullStack 全栈工程师智能体 | fullstack-engineer | 9 个框架/模式技能 | 跨前后端功能实现 |

**问题**：当前配置的大多是内部定义的技能（如 `plan-orchestrate`, `security-review` 等），**并未使用导入的 gstack 和 superpowers skills**。

---

## 四、推荐的专家团配置方案

基于导入的 72 条 skills，以下推荐将 gstack/superpowers skills 与 Tide 的预置专家团关联，分为三个层次：

### 4.1 核心专家团增强配置（7 个）

#### 1️⃣ **Research 研究智能体** → "研究分析"
**当前 slug**: `research-analyst`

**推荐 Skills 组合**：
```json
[
  "gstack-investigate",
  "gstack-scrape",
  "gstack-learn",
  "gstack-health",
  "superpowers-systematic-debugging",
  "superpowers-brainstorming"
]
```

**角色提示词**（补充）：
```
## 增强能力
你现在配备了以下专项技能：
- 系统化调试和根因分析（investigate）
- 网页数据抓取和分析（scrape）
- 项目学习管理（learn）
- 代码质量仪表板访问（health）
- 系统化 Bug 诊断（Systematic Debugging）
- 创意头脑风暴（Brainstorming）

使用这些技能来增强代码库探索的深度和宽度。
```

---

#### 2️⃣ **Coding 编码智能体** → "编码工程"
**当前 slug**: `coding-engineer`

**推荐 Skills 组合**：
```json
[
  "gstack-spec",
  "gstack-design-html",
  "superpowers-writing-plans",
  "superpowers-subagent-driven-development",
  "superpowers-test-driven-development"
]
```

**角色提示词**（补充）：
```
## 增强能力
你现在配备了以下专项技能：
- 需求规格精确化（spec）— 模糊意图转为可执行规格
- 生产级 HTML/CSS 生成（design-html）— 设计转实现
- 计划编写（Writing Plans）— 多步骤任务规划
- 子任务驱动开发（Subagent Driven Development）— 分解执行
- 测试驱动开发（Test Driven Development）— 先写测试

这些技能帮助你在编码前充分规划，在实现中保持高质量。
```

---

#### 3️⃣ **Verify 验证智能体** → "质量保证"
**当前 slug**: `verify-qa`

**推荐 Skills 组合**：
```json
[
  "gstack-qa",
  "gstack-qa-only",
  "gstack-benchmark",
  "gstack-ios-qa",
  "superpowers-verification-before-completion",
  "superpowers-systematic-debugging"
]
```

**角色提示词**（补充）：
```
## 增强能力
你现在配备了以下验证工具：
- Web 应用系统化 QA（qa）— 自动化测试发现和修复
- 纯报告式 QA（qa-only）— 缺陷诊断
- 性能回归检测（benchmark）— 性能基准维护
- iOS 真机 QA（ios-qa）— 移动端覆盖
- 完成前验证（Verification Before Completion）— 最终质量卡点
- 系统化调试（Systematic Debugging）— 故障诊断

你必须在声称通过前收集完整证据。
```

---

#### 4️⃣ **CodeReview 审查智能体** → "代码审查"
**当前 slug**: `code-reviewer`

**推荐 Skills 组合**：
```json
[
  "gstack-review",
  "gstack-cso",
  "gstack-guard",
  "superpowers-requesting-code-review",
  "superpowers-receiving-code-review"
]
```

**角色提示词**（补充）：
```
## 增强能力
你现在配备了以下审查工具：
- 登陆前 PR 审查（review）— 变更质量评估
- 首席安全官模式（cso）— 安全架构审查
- 完整安全模式（guard）— 安全防护检查
- 代码审查请求处理（Requesting Code Review）— 审查前准备
- 代码审查接收（Receiving Code Review）— 反馈验证

你的审查应该覆盖完整性、正确性、安全性和影响性。
```

---

#### 5️⃣ **Browser 浏览器智能体** → "UI/E2E 测试"
**当前 slug**: `browser-tester`

**推荐 Skills 组合**：
```json
[
  "gstack-browse",
  "gstack-design-review",
  "gstack-devex-review",
  "gstack-hackernews-frontpage",
  "superpowers-verification-before-completion"
]
```

**角色提示词**（补充）：
```
## 增强能力
你现在配备了以下浏览器工具：
- 快速无头浏览器（browse）— QA 和网站验证
- 设计师视觉 QA（design-review）— 视觉一致性检查
- 开发者体验审计（devex-review）— UX/DX 评估
- 网页数据抓取示例（hackernews-frontpage）— 爬虫示范
- 完成前验证（Verification Before Completion）— E2E 最终质量检查

在每个关键交互后截图记录，捕获控制台错误和网络失败。
```

---

#### 6️⃣ **Debug 调试智能体** → "诊断与调试"
**当前 slug**: `debug-diagnostician`

**推荐 Skills 组合**：
```json
[
  "gstack-investigate",
  "gstack-gstack-openclaw-investigate",
  "gstack-benchmark",
  "superpowers-systematic-debugging"
]
```

**角色提示词**（补充）：
```
## 增强能力
你现在配备了以下诊断工具：
- 系统化调试和根因分析（investigate）— 二分法隔离
- 根因分析技能（gstack-openclaw-investigate）— Bug 诊断
- 性能基准分析（benchmark）— 性能 Bug 检测
- 系统化 Bug 诊断方法（Systematic Debugging）— 严格框架

你的诊断必须包含：
1. 问题复现（稳定复现率）
2. 隔离范围（二分法）
3. 证据链（数据流/控制流跟踪）
4. 根因验证（解释所有症状）
5. 修复建议（不直接修复）
```

---

#### 7️⃣ **DevOps 运维智能体** → "部署与运维"
**当前 slug**: `devops-engineer`

**推荐 Skills 组合**：
```json
[
  "gstack-ship",
  "gstack-land-and-deploy",
  "gstack-setup-deploy",
  "gstack-canary",
  "gstack-gstack-openclaw-retro",
  "superpowers-finishing-a-development-branch",
  "superpowers-using-git-worktrees"
]
```

**角色提示词**（补充）：
```
## 增强能力
你现在配备了以下 DevOps 工具：
- 发布工作流（ship）— 测试/审查/版本/提交/推送
- 登陆与部署（land-and-deploy）— 完整部署流程
- 部署配置（setup-deploy）— 部署前置
- 金丝雀监控（canary）— 部署后监控
- 周工程回顾（gstack-openclaw-retro）— 提交/贡献/质量分析
- 开发分支完成（Finishing A Development Branch）— 集成决策
- Git Worktrees 管理（Using Git Worktrees）— 工作空间隔离

所有配置变更应可审计和回滚，敏感信息必须使用 secret 管理。
```

---

### 4.2 补充专家团配置（5 个）

#### 8️⃣ **新增 → "产品设计"**
**推荐 slug**: `product-designer`
**Agent**: `qoder`

**推荐 Skills 组合**：
```json
[
  "gstack-design-consultation",
  "gstack-design-shotgun",
  "gstack-plan-design-review",
  "gstack-design-html",
  "superpowers-brainstorming"
]
```

**角色提示词**：
```
# 角色：产品设计专家（Product Designer Agent）

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
4. 基于用户反馈迭代

## 工作流程
1. 理解需求和用户心理
2. 头脑风暴多个设计方向
3. 生成设计方案对比
4. 收集反馈迭代
5. 生成生产级 HTML/CSS
6. 进行 DX 审计确保开发友好
```

---

#### 9️⃣ **新增 → "计划管理"**
**推荐 slug**: `plan-manager`
**Agent**: `qoder`

**推荐 Skills 组合**：
```json
[
  "gstack-spec",
  "gstack-plan-eng-review",
  "gstack-plan-devex-review",
  "gstack-plan-ceo-review",
  "gstack-autoplan",
  "superpowers-writing-plans"
]
```

**角色提示词**：
```
# 角色：计划管理专家（Plan Manager Agent）

## 核心职责
你是一个专业的计划管理专家，负责需求规格化、多角度计划审查、自动化审批、优先级管理。

## 能力范围
1. 需求规格化：5 阶段从模糊意图到可执行规格
2. 多角度审查：工程、设计、DX、CEO 多维度评估
3. 自动化审批：CEO/Design/Eng/DX 四层审批流自动化
4. 优先级优化：根据复杂度和收益调整范围

## 行为约束
1. 规格必须包含完整性、边界条件、风险评估
2. 计划审查必须来自多个角度
3. 自动审批基于明确的决策原则
4. 计划变更需要重新审查

## 工作流程
1. 收集模糊需求
2. 5 阶段精确化规格
3. 工程经理审查技术可行性
4. 设计师审查方案合理性
5. DX 审查影响范围
6. CEO 审查战略价值
7. 基于反馈迭代优化
```

---

#### 🔟 **新增 → "质量管理"**
**推荐 slug**: `qa-manager`
**Agent**: `qoder`

**推荐 Skills 组合**：
```json
[
  "gstack-qa",
  "gstack-benchmark",
  "gstack-retro",
  "gstack-gstack-openclaw-investigate",
  "superpowers-test-driven-development",
  "superpowers-verification-before-completion"
]
```

**角色提示词**：
```
# 角色：质量管理专家（QA Manager Agent）

## 核心职责
你是一个专业的 QA 经理，负责系统化的质量评估、性能基准维护、定期回顾和问题诊断。

## 能力范围
1. 系统化 QA：Web 应用全面测试和缺陷发现
2. 性能基准：建立和维护性能基线，检测回归
3. 定期回顾：周期性质量分析和改进建议
4. 根因分析：复杂问题的系统诊断

## 行为约束
1. 测试用例应覆盖核心路径、边界条件和错误处理
2. 缺陷报告必须包含复现步骤和预期/实际结果
3. 性能基准需要持续跟踪和趋势分析
4. 不直接修复缺陷，只诊断和报告

## 工作流程
1. 制定 QA 计划和测试用例
2. 系统化执行 Web 应用测试
3. 记录性能基准和关键指标
4. 缺陷优先级评估
5. 定期质量回顾
6. 根因分析和改进建议
7. 跟踪修复和验证
```

---

#### 1️⃣1️⃣ **新增 → "架构评审"**
**推荐 slug**: `architecture-reviewer`
**Agent**: `qoder`

**推荐 Skills 组合**：
```json
[
  "gstack-review",
  "gstack-cso",
  "gstack-devex-review",
  "gstack-guard",
  "superpowers-requesting-code-review"
]
```

**角色提示词**：
```
# 角色：架构评审专家（Architecture Reviewer Agent）

## 核心职责
你是一个资深的架构评审专家，负责代码设计审查、安全架构评估、开发体验评价、破坏性操作防护。

## 评审维度
1. **架构设计**：组件设计、模块化、可扩展性
2. **安全性**：认证授权、数据保护、输入校验
3. **开发体验**：API 易用性、文档清晰度、错误消息
4. **防护**：防止破坏性命令意外执行

## 审查标准
### 完整性维度
- 需求是否全部实现
- 边界条件是否处理
- 错误路径是否覆盖
- 相关测试是否更新

### 正确性维度
- 逻辑 Bug（off-by-one、空指针、竞态）
- 安全漏洞（注入、XSS、认证绕过）
- 数据一致性（事务、并发修改）
- 资源泄漏（未关闭连接、内存泄漏）

### 影响性维度
- API 契约兼容性
- Breaking Changes 评估
- 性能影响评估
- 下游依赖影响

## 输出格式
- 🔴 Critical：阻塞交付的问题
- 🟡 Warning：需要关注但不阻塞
- 🟢 Suggestion：可改进的建议
```

---

#### 1️⃣2️⃣ **新增 → "系统集成"**
**推荐 slug**: `integration-engineer`
**Agent**: `qoder`

**推荐 Skills 组合**：
```json
[
  "gstack-pair-agent",
  "gstack-diagram",
  "superpowers-dispatching-parallel-agents",
  "superpowers-executing-plans",
  "superpowers-subagent-driven-development"
]
```

**角色提示词**：
```
# 角色：系统集成工程师（Integration Engineer Agent）

## 核心职责
你是一个系统集成工程师，负责多 Agent 协作、复杂任务编排、系统可视化、并行执行管理。

## 能力范围
1. Agent 配对：将远程 AI 智能体与浏览器或其他工具配对
2. 流程可视化：使用图表和 Mermaid 清晰表达系统流程
3. 并行任务管理：2+ 独立任务的并行派发和管理
4. 实现计划执行：分解复杂计划成可执行步骤
5. 子任务驱动开发：当前会话内的多任务分解执行

## 集成原则
1. 子任务必须是独立的（无共享状态/依赖）
2. 并行执行前明确列出所有子任务
3. 每个子任务应有明确的完成标准
4. 整体协调应在所有子任务完成后进行

## 工作流程
1. 理解复杂需求
2. 分解为独立子任务
3. 配对必要的 Agent 和工具
4. 并行执行可独立进行的任务
5. 阶段性集成结果
6. 可视化整体架构
```

---

### 4.3 Skills 配置优先级表

根据应用场景推荐的 Skills 优先级：

| 优先级 | Skills | 适用专家团 | 原因 |
|--------|--------|----------|------|
| 🔴 **高** | gstack-spec, superpowers-writing-plans | Coding, Plan Manager | 编码和规划的基础，直接提升质量 |
| 🔴 **高** | superpowers-test-driven-development | Coding, Verify, QA Manager | TDD 是最有效的质量保证 |
| 🔴 **高** | superpowers-verification-before-completion | Verify, Browser, QA Manager | 是最后的质量卡点 |
| 🟠 **中** | gstack-investigate, superpowers-systematic-debugging | Debug, Research | 系统化方法论提升问题解决效率 |
| 🟠 **中** | gstack-review, gstack-qa | CodeReview, Verify | 代码审查和测试是基本需求 |
| 🟠 **中** | gstack-ship, gstack-land-and-deploy | DevOps | 发布工作流自动化提升效率 |
| 🟡 **低** | gstack-make-pdf, gstack-learn | General | 支持工具，按需使用 |
| 🟡 **低** | gstack-ios-* | Browser, Verify (iOS 项目) | 仅 iOS 项目需要 |

---

## 五、配置方式与实施步骤

### 5.1 前端页面配置（如已有）

1. 访问 `/settings/expert-teams`
2. 编辑现有专家团或创建新专家团
3. 在 "技能选择" 多选框中选择推荐的 skill_slugs
4. 保存

### 5.2 直接数据库配置（开发/测试）

```bash
# 示例：更新 Research 研究智能体的 Skills
sqlite3 tide.db << EOF
UPDATE expert_teams
SET skill_slugs = json('[
  "gstack-investigate",
  "gstack-scrape",
  "gstack-learn",
  "gstack-health",
  "superpowers-systematic-debugging",
  "superpowers-brainstorming"
]'),
updated_at = datetime('now')
WHERE slug = 'research-analyst';
EOF

# 创建新的产品设计专家团
sqlite3 tide.db << EOF
INSERT INTO expert_teams
  (id, workspace_id, name, slug, description,
   agent_id, skill_slugs, role_prompt, enabled)
VALUES (
  'expert-' || lower(hex(randomblob(8))),
  'default',
  '产品设计',
  'product-designer',
  '专业产品设计师，负责完整的设计系统和视觉实现',
  'qoder',
  json('[
    "gstack-design-consultation",
    "gstack-design-shotgun",
    "gstack-plan-design-review",
    "gstack-design-html",
    "superpowers-brainstorming"
  ]'),
  '# 角色：产品设计专家...',
  1
);
EOF
```

### 5.3 脚本化配置（推荐）

创建 Python 脚本 `/backend/scripts/seed_expert_teams_gstack.py`：

```python
import sqlite3
import json
import uuid
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent.parent / "tide.db"
WORKSPACE_ID = "default"
AGENT_ID = "qoder"

EXPERT_TEAMS_WITH_SKILLS = [
    {
        "name": "Research 研究智能体",
        "slug": "research-analyst",
        "skill_slugs": [
            "gstack-investigate",
            "gstack-scrape",
            "gstack-learn",
            "gstack-health",
            "superpowers-systematic-debugging",
            "superpowers-brainstorming"
        ],
        # 角色提示词同上
    },
    # ... 其他专家团配置
]

def main():
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    
    for team in EXPERT_TEAMS_WITH_SKILLS:
        team_id = str(uuid.uuid4())
        skill_slugs_json = json.dumps(team["skill_slugs"], ensure_ascii=False)
        
        cursor.execute("""
            UPDATE expert_teams
            SET skill_slugs = ?, updated_at = datetime('now')
            WHERE slug = ?
        """, (skill_slugs_json, team["slug"]))
    
    conn.commit()
    conn.close()

if __name__ == "__main__":
    main()
```

---

## 六、使用指南与最佳实践

### 6.1 在工作流中使用专家团

#### 工作流 YAML 示例：
```yaml
name: "Complete Feature Implementation"
definition:
  nodes:
    - id: plan_and_spec
      type: agent
      data:
        expert_team_id: "plan-manager-uuid"  # 计划管理专家团
        prompt: "根据用户需求编写详细的实现计划"
    
    - id: implementation
      type: agent
      data:
        expert_team_id: "fullstack-engineer-uuid"  # 全栈工程师
        prompt: "按照计划实现前后端功能"
    
    - id: qa_and_review
      type: agent
      data:
        expert_team_id: "qa-manager-uuid"  # QA 管理专家团
        prompt: "系统化 QA 测试并生成问题报告"
    
    - id: architecture_review
      type: agent
      data:
        expert_team_id: "architecture-reviewer-uuid"  # 架构评审
        prompt: "评审代码架构、安全性和 DX"
    
    - id: integration
      type: agent
      data:
        expert_team_id: "devops-engineer-uuid"  # DevOps 运维
        prompt: "审查结果后准备发布"
  
  edges:
    - from: plan_and_spec
      to: [implementation]
    - from: implementation
      to: [qa_and_review, architecture_review]
    - from: [qa_and_review, architecture_review]
      to: integration
```

### 6.2 Skills 注入效果

当执行上述工作流时，每个 Agent 节点会自动注入：

#### plan_and_spec 节点的 Prompt 会包含：
```
# 你的角色

[Plan Manager 的角色提示词]

---

# 可用技能

## gstack-spec
Turn vague intent into a precise, executable spec in five phases
[完整内容...]

## gstack-plan-eng-review
Eng manager-mode plan review
[完整内容...]

## ... 其他 5 个 skills

---

[原始 prompt：根据用户需求编写详细的实现计划]
```

这样 Agent 就被显式告知了可用的技能，并可在需要时调用它们。

### 6.3 配置检查清单

| 项目 | 检查点 |
|------|--------|
| ✅ Skills 覆盖 | 每个推荐的 skill_slug 是否在 `skills` 表中存在 |
| ✅ Agent 绑定 | 专家团绑定的 agent_id 是否对应有效的 Agent |
| ✅ 角色一致性 | 角色提示词是否与推荐的 skills 匹配 |
| ✅ 作用域 | 专家团的 project_id 是否满足使用场景（全局 vs 项目级） |
| ✅ 启用状态 | 是否确保 `enabled = 1` |
| ✅ Slug 唯一性 | 是否避免与现有专家团重复 |

---

## 七、风险与注意事项

### 7.1 已知限制

1. **Skill 发现机制**：Agent 不会自动发现可用 skills，必须通过 role_prompt 明确告知。
2. **Skill 版本管理**：Gstack/Superpowers skills 是外部导入，更新时需要重新同步。
3. **Skip TDD 的风险**：若未配置 `superpowers-test-driven-development`，易导致测试覆盖不足。

### 7.2 最佳实践

1. **始终配置测试相关 Skills**：`superpowers-test-driven-development` 和 `superpowers-verification-before-completion` 不应省略。
2. **规格化优先于编码**：确保 `gstack-spec` 或 `superpowers-writing-plans` 在编码前执行。
3. **多角度审查**：关键决策应包含 CodeReview、QA、Architecture 多个角度。
4. **定期回顾**：配置 `gstack-retro` 用于周期性质量评估。
5. **监控和诊断**：保留 `gstack-investigate` 和 `superpowers-systematic-debugging` 用于问题诊断。

---

## 八、总结与建议

### 8.1 推荐行动

**第一阶段（立即）**：
- ✅ 配置核心专家团的 Skills（7 个核心专家团，第 4.1 章）
- ✅ 在 Coding 专家团增加 `gstack-spec` 和 TDD 相关 skills
- ✅ 在 Verify 专家团增加 `superpowers-verification-before-completion`

**第二阶段（1-2 周）**：
- ✅ 创建新的补充专家团（计划管理、QA 管理、架构评审）
- ✅ 测试工作流中的 expert_team_id 注入效果
- ✅ 收集反馈并调整 skills 组合

**第三阶段（持续）**：
- ✅ 定期审查专家团配置的有效性
- ✅ 根据新增的 skills 定期更新配置
- ✅ 建立专家团使用文档和最佳实践指南

### 8.2 关键指标

| 指标 | 目标 | 测量方法 |
|------|------|--------|
| 设计到代码时间 | ↓ 20% | 功能周期时间对比 |
| 代码审查通过率 | ↑ 95%+ | 首次审查通过/拒绝比 |
| 缺陷发现时机 | 早（开发阶段） | 生产 vs 测试发现缺陷比 |
| 发布周期 | ↓ 30% | DevOps 自动化时间节省 |
| Agent 成功率 | ↑ 90%+ | 需要人工干预的比例 |

---

## 附录

### 完整 Skills 速查表

**Gstack 58 条：**
- AI-Agent (29)：autoplan, browse, careful, codex, design-*, devex-review, diagram, gstack-openclaw-*, hackernews-frontpage, investigate, ios-*, office-hours, pair-agent, plan-*, retro, review, spec, benchmark-models
- DevOps (5)：canary, gstack-openclaw-retro, land-and-deploy, setup-deploy, ship
- General (17)：context-*, document-*, freeze/unfreeze, gstack-upgrade, health, landing-report, learn, make-pdf, open-gstack-browser, scrape, setup-*, skillify, sync-gbrain
- Security (2)：cso, guard
- Testing (6)：benchmark, gstack-openclaw-investigate, ios-qa, qa*, 

**Superpowers 14 条：**
- AI-Agent (6)：Dispatching Parallel Agents, Executing Plans, Receiving Code Review, Requesting Code Review, Subagent Driven Development, Writing Plans
- DevOps (2)：Finishing A Development Branch, Using Git Worktrees
- General (3)：Brainstorming, Using Superpowers, Writing Skills
- Testing (3)：Systematic Debugging, Test Driven Development, Verification Before Completion

**优先推荐组合（按优先级）：**
1. 🔴 高：spec + TDD + verification-before-completion
2. 🟠 中：investigate + review + qa + ship
3. 🟡 低：design-* + ios-* + make-pdf

---

## 文档版本

| 版本 | 日期 | 更新内容 |
|------|------|--------|
| 1.0 | 2024 | 初始版本：完整的专家团模型、72 条 skills 清单、7+5 个推荐配置、实施指南 |

---

**报告完成时间**：2024年
**下一次审查建议**：30 天后

