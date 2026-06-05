# Lark2Agent Bridge PPT Outline

本文档把 Lark2Agent bridge 当前实现整理成一份可直接用于制作 PPT 的大纲，并补充它与 OpenClaw、Hermes 的定位差异。

外部对比依据核验日期：2026-06-02。

## 覆盖检查

当前大纲已覆盖本次要求的四类主题：

- 想法：见第 2、3 节，说明为什么要把 Agent CLI 接入 Lark，以及产品机会在哪里。
- 开源项目对比：见第 12 节，对比 Lark2Agent bridge、OpenClaw、Hermes Agent。
- 项目主要功能和特性：见第 6 到第 11 节，覆盖功能入口、任务模型、Plan、审批、安全、日报和会话管理。
- 后续规划：见第 14 节，并在第 15 节给出推荐 PPT 页结构。

## 1. 标题页

标题：Lark2Agent Bridge

副标题：把飞书 / Lark 群聊变成多 Agent 的远程工程操作台。

核心一句话：用户在 Lark 里发起任务，脚本在本地运行 Agent CLI，并把进度、结果、审批和项目状态回写到 Lark 卡片。

## 2. 想法：把 Lark 变成多 Agent 的远程工程入口

核心想法：

- Codex CLI 已经能在本地工程环境里执行代码、写文档、跑检查，但入口主要在终端或本机客户端。
- 飞书 / Lark 是团队日常沟通、审批、提醒和任务跟进的入口。
- 如果把 Agent CLI 的执行能力接入 Lark，就可以让“下发指令、看进度、批权限、收结果”都发生在协作界面里。
- 这个项目不是替代任何单一 Agent CLI，也不是做一个全新的通用 agent，而是为 Agent CLI 增加一个低摩擦、可远程使用、适合团队协作的控制层。

可以在 PPT 中表达成一句话：

> 让 Agent CLI 留在本地工程环境里执行，让 Lark 成为远程可见、可审批、可协作的操作台。

## 3. 问题背景

开发者使用 Codex 时常见的断点：

- Codex 运行在本地机器上，但日常协作和提醒发生在 Lark。
- 长任务、审批、失败重试和结果查看需要回到终端或桌面应用。
- 多个任务同时推进时，任务状态容易混在一起。
- 多个 Agent session、项目目录、普通对话之间缺少一个轻量管理面板。

Lark2Agent 的目标不是重做一个通用 agent 平台，而是把已有 Agent CLI 工作流接入团队协作入口。

## 4. 产品定位

Lark2Agent bridge 是一个本地运行的 Lark WebSocket 客户端：

- 面向 Codex、Claude Code 等 Agent CLI，而不是自建完整 agent runtime。
- 面向 Lark 群聊和卡片，而不是多平台全渠道网关。
- 面向工程任务的远程控制、审批和状态管理，而不是泛化个人助理。
- 使用当前机器和当前仓库执行任务，保留本地开发环境、Git 状态和 Agent session。

适合场景：

- 在手机或群聊中远程触发 Agent 修复、检查、写文档。
- 用 Lark 卡片跟踪长任务进度。
- 在同一个项目里并行拆分多项 Agent 子任务。
- 对 sandbox/权限风险进行 Lark 侧批准后重试。

## 5. 当前实现概览

当前仓库的主实现是 `lark2agent_ws.py`，核心模块包括：

- Lark WebSocket 事件接收。
- 文本指令解析。
- Lark 卡片构建与更新。
- Agent CLI 子进程启动和流式输出解析。
- 项目、普通对话、Agent session 索引。
- Plan 并行调度。
- 审批、停止、重启、日报和 macOS 保活。

运行方式：

- 前台运行：`python3 lark2agent_ws.py`
- 后台运行：`nohup python3 lark2agent_ws.py > lark2agent_ws.log 2>&1 &`
- Lark 内重启：`/restart`

## 6. 项目主要功能和特性

主要功能：

- Lark 指令入口：在群聊里直接发送自然语言任务，启动或续写 Agent。
- 任务卡片：展示任务状态、目录、模型、耗时、指令、Session、最新输出。
- 审批处理：在 Lark 卡片内批准或拒绝高风险操作，并按批准后的 sandbox 配置重试。
- 项目面板：查看项目、普通对话和当前项目会话。
- 会话管理：支持创建、切换、归档 Agent 会话。
- Plan 并行：把任务清单拆成多个 Agent 子任务并行处理。
- Worktree 隔离：Plan 子任务默认在独立 Git worktree 和分支中执行。
- 日报统计：按日期汇总项目进展、总指令数、审批、失败、更新和修复。
- 状态同步：监听 Codex Desktop session 文件，将完成结果同步到 Lark。
- 运行保障：支持后台运行、Lark 内重启、macOS 接电源保活。

关键特性：

- 低侵入：不改变 Codex CLI 本身，也不要求迁移开发环境。
- 本地执行：代码、凭据、Git 状态和 Agent session 仍保留在用户机器上。
- 协作可见：长任务进度和结果能在 Lark 群聊中被看到。
- 可审批：权限风险在协作界面里闭环处理。
- 可并行：Plan 模式适合把多个独立工程任务同时推进。
- 可追踪：每个普通任务都有独立 `task_id`，避免任务输出串卡。

## 7. Lark 侧操作界面

主要入口：

- `/panel`：打开总看板。
- `/projects`：查看项目列表。
- `/convos`：查看当前项目对话。
- `/status`：查看当前项目状态。
- `/daily`：生成项目进展日报。
- `/plan`：进入并行计划模式。
- `/agent`：查看和切换 Codex、Claude Code、Qoder CLI。
- `/codex`、`/claude`、`/qoder`：指定单次任务使用的 Agent。
- 普通文本：直接作为 Agent 指令执行。

交互原则：

- 卡片默认保持紧凑。
- 长任务更新原卡片，避免刷屏。
- 按钮回调和文本命令互为补充。
- 每个任务有独立 `task_id`，刷新、停止、审批都绑定到对应任务。

## 8. Agent 任务模型

每条 Lark 指令会创建独立任务运行态：

- `task_id`
- `chat_id`
- `cwd`
- `prompt`
- `model`
- Lark 任务卡 `message_id`
- Codex `process`
- Codex `session_id`
- 状态和最新输出
- 审批策略和 sandbox 策略

关键价值：

- 避免多个任务结果写到同一张卡片。
- 支持同一群聊里并发运行多个普通 Agent 任务。
- 支持审批后按原任务继续重试。
- 如果复用同一个 Agent session，会通过 session 锁串行执行，避免 session 文件并发写入。

## 9. Plan 并行模式

`/plan` 用于把任务清单拆成多个 Agent 子任务并行处理。

输入形式：

- `- 任务`
- `* 任务`
- `- [ ] 任务`
- `1. 任务`
- 同一行数字编号，例如：`1. 任务一 2. 任务二 3. 任务三`

执行模型：

- 一个 `PlanRuntime` 保存整体计划。
- 一个调度线程按 `PLAN_MAX_PARALLEL` 控制并发。
- 每个子任务启动独立 Agent 子进程。
- 默认在 Git 仓库中为每个子任务创建独立 worktree 和分支。

收尾模型：

- 子任务结束后运行 `PLAN_TEST_COMMAND`，默认是 `git diff --check`。
- 有改动时进入待提交状态。
- 用户可在 Plan 卡片中批准提交或跳过提交。
- 当前不自动合并回主分支。

## 10. 审批与安全

审批触发场景包括：

- Codex 输出中出现 sandbox 拒绝。
- 权限不足。
- `.git/index.lock`。
- `permission denied`。
- 需要用户批准的高风险命令。

审批流程：

- 待审批项显示在对应任务卡中。
- 用户点击批准或拒绝。
- 批准后使用更高权限策略对原任务重试。
- 审批结果写回原任务卡。

当前边界：

- 审批状态主要保存在运行内存和本地状态文件中。
- 如果脚本重启，部分运行态需要重新发送任务或查看日志恢复上下文。
- 对高风险操作仍应依赖 Codex CLI 的 sandbox 和 approval policy，而不是只依赖 Lark 卡片。

## 11. 日报、状态和会话管理

状态能力：

- `/status` 展示当前项目、目录、运行状态、会话和任务概览。
- `/daily` 生成当天项目进展日报。
- `/daily=YYYY-MM-DD` 或 `/daily YYYY-MM-DD` 查询指定日期。
- 日报统计项包括当日活跃对话数量、总指令数、总耗时、审批总数、失败总数、功能更新和 Bug 修复。

会话能力：

- `/convos` 打开当前项目对话面板。
- `/convos=new <指令>` 在当前项目中新建会话并执行。
- `/convos=archive [session_id]` 归档会话。
- `/conv <session_id>` 切换到指定 Agent 会话。

项目能力：

- `/project=new <名称>` 新建项目并切换目录。
- `/project=archive [编号或目录]` 归档项目。
- `/mark-project` 和 `/mark-chat` 手动修正项目/普通对话识别。

## 12. 开源项目对比：Lark2Agent、OpenClaw、Hermes

| 维度 | Lark2Agent bridge | OpenClaw | Hermes Agent |
| --- | --- | --- | --- |
| 核心定位 | Lark 到 Agent CLI 的本地桥接和远程操作台 | 自托管、多渠道 AI agent 网关 | 自改进、带记忆和技能系统的 agent runtime |
| 主要入口 | Lark 群聊、Lark 卡片、文本指令 | 多个聊天渠道、Web 控制台、移动节点 | CLI/TUI、多平台消息网关、技能和记忆系统 |
| Agent 能力来源 | 直接调用本地 Agent CLI | 网关连接 AI coding agents 和多个渠道 | Hermes 自身 agent loop、技能、记忆、MCP 和工具 |
| 平台范围 | 聚焦 Lark/飞书 | Discord、Slack、Telegram、WhatsApp、iMessage 等多渠道 | CLI、Telegram、Discord、Slack、WhatsApp、Feishu/Lark 等多渠道 |
| 任务隔离 | 普通任务 `task_id` 隔离；Plan 子任务可用 Git worktree 隔离 | 以 gateway/session/channel routing 为中心 | 可通过终端后端、子代理和工具隔离任务 |
| 记忆/技能 | 依赖 Agent session、本地状态和仓库上下文；没有独立技能系统 | 具备会话、记忆、多 agent routing 等 agent-native 能力 | 强调闭环记忆、自主技能创建和技能自改进 |
| 安全模型 | Agent CLI sandbox/approval policy + Lark 审批卡片 | 自托管网关，强调本机控制和渠道路由 | 命令审批、授权、容器隔离、MCP 过滤等 |
| 当前优势 | 实现简单、贴近 Agent CLI、Lark 内可直接用、适合工程项目远程操作 | 渠道覆盖广，适合把 agent 接入多个通信平台 | agent runtime 更完整，适合长期学习、记忆和技能沉淀 |
| 当前不足 | 平台面窄，主要服务 Lark + Agent CLI；缺少完整 agent 生态 | 对本项目而言过于通用，接入 Codex 工程流需额外适配 | 对本项目而言能力更重，迁移成本和运行复杂度更高 |

结论：

- Lark2Agent bridge 的差异化不在“最大最全的 agent 平台”，而在“最短路径把 Agent CLI 变成 Lark 里的工程执行助手”。
- OpenClaw 更像多渠道 agent 网关。
- Hermes 更像自带学习、技能和记忆闭环的完整 agent runtime。
- 当前项目应继续聚焦 Lark 协作入口、Agent 工程任务、卡片状态、审批和并行计划。

PPT 中建议这样讲差异：

- OpenClaw 解决的是“一个 agent 接多个消息渠道”的问题。
- Hermes 解决的是“agent 长期学习、记忆、技能沉淀”的问题。
- Lark2Agent 解决的是“让 Agent CLI 可以在 Lark 里远程执行、跟踪、审批”的问题。

## 13. 适合强调的卖点

面向工程团队：

- 不改变现有 Codex CLI 使用方式。
- 不要求迁移到新的 agent 平台。
- 直接把本地工程环境接入 Lark。
- 长任务进度和结果在群聊可见。
- 审批动作留在协作界面内完成。

面向个人开发者：

- 手机里也能触发本机 Agent。
- 可以在路上查看任务是否完成。
- 可以把多个小任务拆给 `/plan` 并行跑。
- 可以保留 Agent session 的连续上下文。

面向后续产品化：

- Lark 卡片是天然的轻量控制台。
- Agent CLI 是稳定的执行后端。
- 本地状态和 Git worktree 能支撑工程级任务追踪。

## 14. 后续规划

短期：

- 继续完善 `/daily` 的历史统计、任务级持久化和失败/审批口径。
- 在 `/convos` 面板中进一步强化当前对话、最近指令和状态摘要。
- 为 Plan 输入解析、日报统计、审批识别增加轻量测试。

中期：

- Plan 子任务合并、cherry-pick 和 worktree 清理。
- 运行态持久化，降低脚本重启后的状态丢失。
- 对 `/daily` 引入更明确的数据源和统计口径。
- 为卡片回调增加更多文本 fallback。

长期：

- 多用户权限与路由。
- 中心化 bridge 服务部署。
- 更细的审计日志。
- 与 Lark 文档、审批、任务、日历进一步联动。

## 15. 推荐 PPT 结构

建议控制在 12 到 14 页：

1. 标题页：Lark2Agent Bridge。
2. 项目想法：让 Lark 成为多 Agent 的远程工程入口。
3. 问题背景：本地执行与协作入口割裂。
4. 产品定位：不是通用 agent 平台，而是 Agent CLI 的 Lark 操作台。
5. 架构：Lark WebSocket + Python bridge + Agent CLI。
6. 主要功能：指令、任务卡、项目、会话、日报、重启。
7. 关键特性：本地执行、协作可见、可审批、可并行、可追踪。
8. Plan 并行：任务拆分、worktree、分支、提交审批。
9. 审批与安全：Agent CLI sandbox + Lark 卡片审批。
10. 日报和状态：总指令数、审批、失败、更新、修复。
11. 开源项目对比：Lark2Agent vs OpenClaw vs Hermes。
12. 当前边界：持久化、历史统计、合并清理、多用户部署。
13. 后续规划：短期修复、中期增强、长期产品化。
14. 结论：做窄，但把 Lark + Agent CLI 的工程流打通。

## 16. 资料来源

- 本项目 README：`README.md`
- 本项目开发说明：`DEVELOPMENT.md`
- OpenClaw 官方文档：https://docs.openclaw.ai/
- Hermes Agent 官方文档：https://hermes-agent.nousresearch.com/docs/
- Hermes Agent GitHub：https://github.com/NousResearch/hermes-agent
