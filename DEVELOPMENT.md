# Lark2Agent Development Notes

本文档整理当前 Lark2Agent bridge 的设计方案、已实现计划和后续开发约束，便于继续迭代 `lark2agent_ws.py`。

状态标记：

- `[已完成]`：当前代码已实现，可按 README 配置运行。
- `[部分完成]`：核心能力已实现，但仍有持久化、边界处理或自动化测试缺口。
- `[计划]`：尚未实现，属于后续开发项。

## 目标

Lark2Agent bridge 的目标是把 Lark 群聊变成多 Agent 远程控制台：

- 在 Lark 里发送自然语言任务，脚本本地启动 Codex CLI、Claude Code CLI 或后续 Agent CLI 执行。
- 用 Lark 卡片展示任务进度、最终结果、审批入口和项目状态。
- 支持项目、普通对话、Agent 会话的创建、归档和查询。
- 支持 `/plan` 并行拆分任务清单，并隔离子任务的代码改动。
- 支持审批、重启、日报、指定模型、macOS 保活和后台运行。

## [已完成] 运行模型

脚本是单进程 Python WebSocket 客户端，主要线程包括：

- WebSocket 事件线程：由 Lark SDK 接收消息和卡片回调。
- `event_worker_loop`：串行消费 Lark 事件队列，避免消息处理函数直接阻塞 SDK 回调。
- `scheduler_loop`：定时刷新运行中的任务卡、发送日报和状态。
- `session_watcher_loop`：监听 Codex Desktop session 文件更新。
- `keep_awake_loop`：macOS 接电源时启动 `caffeinate`，必要时开启 `pmset disablesleep`。
- Agent 任务线程：每条 Lark 指令启动一个独立线程和一个独立 CLI 子进程；当前支持 Codex 和 Claude Code。
- Plan 调度线程和子任务线程：`/plan` 用一个调度线程按并发上限启动多个子任务线程。

同一个 `app_id/app_secret` 表示同一个 Lark 应用和机器人身份。不同人不应各自用同一组凭据启动本地 WebSocket 客户端，否则 Lark 会把它们视为同一应用的连接池，事件可能被任意一个客户端消费，导致串事件或丢事件。多人使用时应采用：

- `[建议]` 每个人独立 Lark 应用；或
- `[计划]` 只部署一个中心化 bridge 服务，并在服务内按 `chat_id/open_id` 做权限和路由。

## [已完成] 普通任务隔离

普通任务已经抽象为 Agent adapter 模型。Bridge 内部仍保留 `CodexTaskRuntime` 这个兼容命名，但运行态带有 `agent_id` 字段，并通过 `AGENT_ADAPTERS` 选择实际 CLI：

- `codex`：使用 `codex exec --json`，会话来自 `CODEX_SESSIONS_DIR`。
- `claude`：使用 `claude --print --output-format stream-json --verbose`，会话来自 `CLAUDE_PROJECTS_DIR`。
- `qoder`：使用 `qodercli --print --output-format stream-json --cwd <目录>`，会话来自 `QODER_PROJECTS_DIR`。

Qoder 额外支持 Quest 子模式：

- `/qoder=quest <指令>`：一次性使用 Qoder Quest 模式执行。
- 默认 Agent 为 Qoder 时，`/quest <指令>` 使用 Quest 模式执行。
- Quest 模式由 Bridge 向 Qoder prompt 前置 `/quest` 触发，超时由 `QODER_QUEST_TIMEOUT_SECONDS` 单独控制，默认 12 小时。
- Quest 任务卡提供“暂停 / 继续 / 终止”按钮；暂停和继续通过本地子进程 `SIGSTOP` / `SIGCONT` 实现，终止复用任务停止流程。

Lark 侧协议不区分具体 CLI：文本消息、卡片按钮、`message.create`、`message.patch` 和 `card.action.trigger` 都复用同一套结构。按钮回调仍以 `task_id` 定位任务，任务运行态再用 `agent_id` 找到对应 adapter。

每条 Lark 指令都会创建一个 `CodexTaskRuntime`，并生成独立 `task_id`。任务运行态绑定：

- `task_id`
- `agent_id`
- `chat_id`
- `cwd`
- `prompt`
- `model`
- Lark 任务卡 `message_id`
- Codex `process`
- Codex `session_id`
- 当前状态和最新输出
- 审批策略和 sandbox 策略

任务卡按钮会携带 `task_id`。刷新、停止、审批、流式输出和完成结果都按 `task_id` 更新对应的初始任务卡，而不是只按 `chat_id` 更新最新任务卡。

如果显式传入的 `task_id` 不存在，脚本不会回退更新最新任务卡，避免把旧任务结果写到新任务面板。

## [已完成] Session 串行锁

如果两个任务复用同一个 Codex `session_id`，脚本会用 `SESSION_RUN_LOCKS` 为该 session 加锁。后到任务会在自己的任务卡中显示排队提示，等待同 session 的前序任务完成后再执行。

这样可以避免两个 `codex resume <session_id>` 同时写同一个 session 文件，造成上下文和结果混乱。没有 session 的新任务不加锁，会各自创建新的 Codex session。

排队中的任务会在 Agent 指令卡片上显示“引导”和“取消”操作。取消只对尚未启动 CLI 子进程的等待任务生效；线程最终拿到 session 锁后会检查取消标记，已取消任务不会再启动。

## [已完成] 审批模型

审批由 Codex 输出中的风险信号触发，例如权限不足、sandbox 拒绝、`.git/index.lock`、`permission denied` 等。

审批对象记录：

- `approval_id`
- `chat_id`
- `task_id`
- `session_id`
- `cwd`
- 原始指令
- 审批状态
- 批准后使用的 resume prompt

审批入口只显示在对应的 Agent 指令面板里，不再单独新建待审批面板。点击批准或拒绝后，原任务卡的 `最新结果` 会更新为审批结果。

批准后会使用：

```env
APPROVED_CODEX_APPROVAL_POLICY=on-request
APPROVED_CODEX_SANDBOX_MODE=workspace-write
APPROVED_CLAUDE_PERMISSION_MODE=acceptEdits
APPROVED_QODER_PERMISSION_MODE=bypass_permissions
```

其中 Codex 使用 approval policy / sandbox mode，Claude Code 和 Qoder CLI 使用各自的 approved permission mode。对原任务做一次重试。Qoder 批准重试默认使用 `bypass_permissions` 并启动新 session，避免旧 session 继续继承 `dontAsk` 拒写模式。等待审批时间由：

```env
PENDING_APPROVAL_WAIT_SECONDS=300
PENDING_APPROVAL_POLL_SECONDS=2
```

控制。超时后按当前 Agent 默认配置继续收尾。

## [已完成] `/plan` 并行模式

`/plan` 是真并行，不依赖单个 Agent 进程内的多线程。它的结构是：

- 一个 `PlanRuntime` 保存整个计划。
- 一个 `plan_runner_loop` 调度线程。
- 多个 `run_plan_task` 子任务线程。
- 每个子任务线程启动一个独立 Agent CLI 子进程。

并发上限由：

```env
PLAN_MAX_PARALLEL=3
```

控制。调度器每秒检查 `pending` 和 `running` 子任务数量，有空位就启动新的子任务线程。

### [已完成] Plan 子任务隔离

默认启用 Git worktree 隔离：

```env
PLAN_USE_WORKTREES=1
```

如果当前目录是 Git 仓库，每个子任务会创建独立 worktree：

```text
<repo>/.lark2agent/worktrees/<plan_id>-<task_id>
```

并创建独立分支：

```text
lark2agent/<plan_id>-<task_id>
```

因此每个 Plan 子任务拥有：

- 独立工作目录
- 独立 Git 分支
- 独立 Agent 子进程
- 独立输出、测试结果和 diff 摘要

如果当前目录不是 Git 仓库，或关闭 `PLAN_USE_WORKTREES`，子任务会退回原目录执行。这时仍然是多线程和多 Agent 进程，但文件改动没有隔离，存在互相覆盖风险。

项目/对话看板和日报默认不会把 Plan 创建的 worktree 子目录当作独立项目统计，避免 `.lark2agent/worktrees/...` 污染项目列表。这个过滤只影响 `build_index()` 的项目索引，不影响 `Agent Plan` 面板展示子任务执行状态、输出、worktree 路径和审批操作。需要统计这些 worktree 会话时可设置：

```env
LARK2AGENT_INCLUDE_PLAN_WORKTREES=1
```

### [已完成] Plan 子任务收尾第一版

子任务结束后会运行：

```env
PLAN_TEST_COMMAND=git diff --check
PLAN_TEST_TIMEOUT_SECONDS=120
```

然后按结果处理：

- 没有改动：标记完成。
- 有改动：进入 `review`，Plan 卡片展示测试结果和 diff 摘要。
- 点击“批准提交”：在子任务 worktree 分支上执行 `git add -A && git commit`。
- 点击“跳过提交”：保留 worktree 改动，标记完成。
- 点击“丢弃改动”：在子任务 worktree 中执行 `git reset --hard` 和 `git clean -fd`，并标记完成。

Plan 已新增合并总览，可以把已提交的子任务 commit 逐个或批量 cherry-pick 回当前项目分支。遇到冲突时会进入冲突状态，并提供“Codex 修复冲突”和中止 cherry-pick 的卡片操作。已结束子任务支持清理 worktree，清理前会先展示确认卡；已合并子任务分支也可以单独确认清理。

第一版增强还包括：

- Plan/子任务状态持久化到本地 state，脚本重启后可恢复已结束和待处理的 Plan。
- 子任务详情卡：查看 prompt、阶段/依赖、session、worktree、测试、diff、提交和最新输出。
- 子任务操作：取消、停止、重试、丢弃改动、确认后清理 worktree。
- 合并冲突自动修复：由 Codex 修改冲突文件，脚本复查冲突、运行 `PLAN_TEST_COMMAND`，通过后执行 `git cherry-pick --continue`。
- 已合并分支清理：确认后删除 `lark2agent/<plan_id>-<task_id>` 子任务分支。
- 轻量阶段和依赖：支持 `阶段 1:` / `阶段 2:`，以及 `depends:1,2`。

仍需后续增强：

- 更完整的 Plan 事件日志和执行时间线。
- 依赖语法的更严格校验和错误提示。

## [已完成] 项目和普通对话

脚本按 Codex session 的 `cwd` 区分项目和普通对话。项目识别规则优先查找：

```text
.git
package.json
pyproject.toml
go.mod
Cargo.toml
pom.xml
composer.json
requirements.txt
README.md
```

也可以手动修正：

```text
/mark-project [目录]
/mark-chat [session_id]
```

支持创建：

```text
/project=new <名称>
/chat=new <主题或指令>
/convos=new <指令>
```

支持归档：

```text
/project=archive [编号或目录]
/chat=archive [编号或 session_id]
/convos=archive [session_id]
```

归档内容默认不显示在查询结果中。需要显示时设置：

```env
LARK2AGENT_SHOW_ARCHIVED=1
```

项目创建根目录由：

```env
CODEX_PROJECTS_ROOT=
```

控制。未配置时使用 `CODEX_DEFAULT_CWD` 的父目录。

## [已完成] 启动欢迎语和状态推送

WebSocket 脚本启动时会向已记录的 Lark 会话发送欢迎语：

```text
I'm Lark2Agent, a lightweight multi-agent bridge for Lark.
```

可通过：

```env
LARK2AGENT_WELCOME_MESSAGE=
```

自定义。设为空字符串时不发送。

启动时不会自动发送 `/status`。状态推送默认关闭：

```env
STATUS_INTERVAL_SECONDS=0
```

设为正整数后，调度器会按间隔推送状态。任务卡自动刷新独立使用：

```env
TASK_CARD_REFRESH_INTERVAL_SECONDS=15
```

## [已完成] 指定模型

支持一次性指定模型：

```text
/model=<模型名> +具体指令
```

例如：

```text
/model=gpt-5.5 +修复 README
```

该模型只作用于当前任务或 Plan 子任务。没有指定时使用：

```env
CODEX_MODEL=
CLAUDE_MODEL=
QODER_MODEL=
```

若为空，则使用对应 Agent CLI 自身默认配置。

## [已完成] Lark 图片和文件附件

第一版附件处理走现有 WebSocket 消息事件和 Python SDK：

- `on_message` 按 `message_type` 识别 `image`、`file` 和带内嵌图片的 `post`。
- 图片和文件通过 `im/v1/messages/:message_id/resources/:file_key` 下载。
- 相对 `LARK_ATTACHMENTS_DIR` 会落到当前 Agent 工作目录下，默认是 `.lark2agent/attachments`，因此 `workspace-write` sandbox 可以读取。
- 只有附件、没有文字的消息会按 `chat_id + sender_id` 暂存，下一条普通文本指令自动消费。
- 回复或引用附件消息时，会从本地 state 的 `message_refs` 中找回附件路径。
- Agent 任务卡展示附件摘要，实际 prompt 里包含附件类型、文件名、本地路径和 Lark message id。

当前边界：

- 不自动解压压缩包。
- 不做 OCR 或图片视觉预处理；图片理解能力取决于当前 Agent CLI 和模型。
- 大文件只做单文件大小限制，不做断点续传。

## [部分完成] 日报

`/daily` 支持当天日报，`/daily=YYYY-MM-DD` 或 `/daily YYYY-MM-DD` 支持指定日期。

日报统计目标：

- 今日活跃对话数量
- 总指令数
- 总耗时
- 审批总数
- 失败总数
- 今日新增或更新功能
- 修复 bug 数

当前统计主要来自 Codex session 文件、运行中任务、Plan 状态和本地审批记录。总指令数按用户下发的指令统计，并结合普通任务和 Plan 子任务补齐。指定日期查询已实现。跨进程重启后的历史审批统计和任务级耗时记录仍依赖 `.lark2agent_state.json` 中可持久化的数据，后续可继续增强。

## [已完成] 后台运行和重启

推荐后台运行：

```bash
cd /Users/haifeng/Documents/lark2codex
nohup python3 lark2agent_ws.py > lark2agent_ws.log 2>&1 &
```

查看进程：

```bash
pgrep -fl lark2agent_ws.py
ps aux | grep '[l]ark2agent_ws.py'
```

查看日志：

```bash
tail -n 100 lark2agent_ws.log
tail -f lark2agent_ws.log
```

停止：

```bash
pkill -f lark2agent_ws.py
```

Lark 中也支持：

```text
/restart
```

`/restart` 会先向 Lark 发送提示，清理 macOS 保活状态，再用当前 Python 解释器原地 `execv` 重启。

## [已完成] macOS 保活

默认接入电源时启动 `caffeinate`：

```env
KEEP_AWAKE_ON_AC_POWER=1
KEEP_AWAKE_CHECK_INTERVAL_SECONDS=60
```

可选开启合盖防睡眠：

```env
KEEP_AWAKE_DISABLE_SLEEP=1
```

注意：MacBook 合盖运行受硬件、系统设置和外设影响。稳定方案仍是接电源、外接显示器、键盘和鼠标。

## Web 工作台开发环境

### 前置要求

- Node.js >= 18
- Python >= 3.10
- yarn

### 安装步骤

#### 后端

```bash
cd /path/to/lark2codex
pip install -r backend/requirements.txt
```

#### 前端

```bash
cd /path/to/lark2codex
yarn install
```

### 开发服务器启动

分别在两个终端运行：

```bash
# 终端 1：后端（端口 8000）
cd /path/to/lark2codex && uvicorn backend.main:app --reload --port 8000

# 终端 2：前端（端口 3000）
yarn dev
```

启动后访问：

- 前端：http://localhost:3000
- 后端 API：http://localhost:8000
- API 文档：http://localhost:8000/docs

### 运行测试

```bash
python -m pytest backend/tests/ -v
```

### 项目结构

```
lark2codex/
├── apps/
│   └── web/            # Next.js 15 前端（App Router + TanStack Query + Tailwind CSS）
├── packages/
│   ├── core/           # Headless 逻辑：Zustand stores、React Query hooks、API client、TypeScript 类型
│   ├── ui/             # shadcn/ui 原子组件
│   └── views/          # 业务组件
├── backend/            # FastAPI 后端
│   ├── api/            # REST + WebSocket 路由
│   ├── services/       # 业务逻辑
│   ├── models/         # Pydantic schemas
│   ├── db/             # SQLite + SQLAlchemy 配置
│   └── runtime/        # Agent 适配器、任务运行时
└── lark2agent_ws.py    # 现有 Lark Bridge（保留）
```

## 开发路线图

### [已完成] 1. 隔离式 `/plan` 并行任务

参考 Cline 的并行 agent / worktree 思路。当前实现已经支持把任务清单拆成多个 Plan 子任务，并按 `PLAN_MAX_PARALLEL` 并行启动多个 `codex exec` 子进程。

每个子任务默认创建独立 Git worktree 和独立分支，避免多个 Codex 同时修改同一个目录：

```text
<repo>/.lark2agent/worktrees/<plan_id>-<task_id>
lark2agent/<plan_id>-<task_id>
```

当前第一版增强已完成：

- Plan/子任务状态持久化，脚本重启后可恢复 Plan 卡片操作。
- 子任务详情卡，展示 prompt、阶段/依赖、session、worktree、测试、diff、提交和最新输出。
- 子任务级取消、停止、重试、丢弃改动、确认后清理 worktree。
- Plan 级合并总览，支持逐个或批量 cherry-pick 已提交子任务，并在冲突时展示冲突状态、Codex 自动修复和中止操作。
- 已合并子任务分支确认清理。
- 轻量阶段和依赖解析，支持 `阶段 1:` / `阶段 2:` 以及 `depends:1,2`。

未完成的增强项：

- 冲突自动修复失败后的更细粒度人工处理向导。
- 子任务依赖关系的可视化展示、更严格校验和失败策略配置。

### [已完成] 2. 完成后 Diff 审批卡

参考 Aider 的 Git 工作流。当前实现已经支持 Plan 子任务完成后自动：

- 运行 `PLAN_TEST_COMMAND`。
- 检查是否有 Git 改动。
- 生成 diff 摘要。
- 在 Plan 卡片里进入 `review` 状态。
- 提供“查看 Diff / 批准提交 / 跳过提交 / 丢弃改动”按钮。
- 批准后在子任务 worktree 分支上执行 `git add -A && git commit`。
- 已提交子任务可从 Plan 合并总览逐个或批量 cherry-pick 回当前项目分支；发生冲突时可交给 Codex 自动修复，通过测试后继续 cherry-pick。

未完成的增强项：

- Diff 展示仍是摘要级别，后续可支持分文件查看。

### [计划] 3. Lark 任务看板

参考 OpenHands 的 agent 平台化思路。目标是把所有任务统一进入任务看板，而不只是当前任务卡和 Plan 卡片。

计划状态：

- 排队中
- 运行中
- 已暂停
- 等待审批
- 已完成
- 失败
- 已停止
- 已终止

计划能力：

- 按状态筛选任务。
- 查看任务详情、原始 prompt、目录、模型、session、耗时、日志摘要。
- 停止运行中的任务。
- 对 Qoder Quest 任务支持暂停、继续和终止。
- 重试失败任务。
- 处理审批。
- 查看任务关联的 Plan、worktree、diff 和提交记录。

实现建议：

- 持久化 `TASKS`、`PLANS`、审批记录和任务事件日志。
- 新增 `/tasks` 或 `/board` 命令。
- 任务卡按钮回调继续携带 `task_id`，看板按 `task_id` 打开详情。

### [计划] 4. 项目级 `.lark2agent` 配置

参考 Continue / Cline 的项目规则。目标是每个项目可以定义自己的执行规则，而不是完全依赖全局 `.env`。

建议配置文件：

```text
<project>/.lark2agent/config.json
```

建议支持字段：

- 默认测试命令。
- 提交信息规范。
- 审批策略。
- 默认 sandbox。
- 默认模型。
- 禁止操作列表。
- Plan 并发上限。
- 是否允许自动提交。
- 是否允许危险命令。

示例：

```json
{
  "test_command": "npm test && git diff --check",
  "commit_message_prefix": "chore",
  "approval_policy": "on-request",
  "sandbox_mode": "workspace-write",
  "plan_max_parallel": 3,
  "forbidden_commands": ["rm -rf /", "git reset --hard"]
}
```

实现建议：

- Agent 任务启动前读取项目配置。
- 项目配置优先级高于全局 `.env`，但低于 Lark 指令里的显式参数。
- 配置读取失败时在任务卡中提示，不静默忽略。

### [计划] 5. 失败自动诊断

目标是把常见失败分类，并给出一键重试或准确本机命令。

计划分类：

- Git 锁：`.git/index.lock`、`Unable to create index.lock`。
- 权限问题：`Operation not permitted`、`permission denied`。
- Lark API：消息发送失败、卡片更新失败、权限 scope 不足。
- 审批超时：等待用户处理超过 `PENDING_APPROVAL_WAIT_SECONDS`。
- Agent 超时：超过 `CODEX_TIMEOUT_SECONDS`、`CLAUDE_TIMEOUT_SECONDS` 或 `QODER_TIMEOUT_SECONDS`。
- 测试失败：`PLAN_TEST_COMMAND` 返回非零。
- worktree 失败：创建 worktree 或分支失败。

计划能力：

- 在任务卡 `最新结果` 中显示失败分类。
- 给出“重试 / 提权重试 / 查看命令 / 忽略”按钮。
- 对无法自动继续的问题，给出本机可复制命令。

### [计划] 6. `/review`、`/commit`、`/pr` 工作流

目标是从 Lark 直接触发代码审查、提交和创建 PR。

建议流程：

```text
检查工作区 -> 跑测试 -> 总结 diff -> Lark 审批 -> 执行 git 操作
```

计划命令：

- `/review`：检查当前工作区，运行测试，总结 diff 和风险点。
- `/commit`：生成提交信息，展示 diff 审批卡，批准后执行 `git add -A && git commit`。
- `/pr`：检查分支、运行测试、生成 PR 标题和描述，审批后调用 GitHub CLI 创建 PR。

实现建议：

- 复用 Plan 的 diff/test/card 组件。
- 所有 destructive 或远程操作都必须经过 Lark 审批。
- PR 能力优先依赖 `gh` CLI；未安装时给出准确安装或本机命令。

## 当前后续计划

优先级较高：

- `[部分完成]` 把 `TASKS`、`PLANS` 和审批记录做更完整的持久化；`PLANS` 第一版已落地，普通任务和审批记录仍可继续增强。
- `[计划]` 为 `/plan` 增加冲突自动修复失败后的人工处理向导、分文件 Diff 和执行时间线。
- `[计划]` 增加 `ALLOWED_CHAT_IDS` / `ALLOWED_OPEN_IDS`，限制可触发 Codex 的 Lark 会话和用户。
- `[部分完成]` 对同一个 `app_id/app_secret` 的多实例风险已写入文档；运行时检测尚未实现。
- `[计划]` 为任务级隔离、审批和 Plan worktree 增加自动化测试。

中期可做：

- `[计划]` 中心化多用户部署模式：用数据库保存用户、项目、权限、任务和 session 路由。
- `[部分完成]` Plan 子任务依赖关系：已支持轻量阶段和 `depends:`；前置条件 UI 和失败策略尚未实现。
- `[计划]` 更完整日报：持久记录每次任务的开始、结束、状态、审批和耗时。
- `[部分完成]` project/chat/convos 创建和归档已实现；归档恢复命令尚未实现。

---

## P5-P10 新功能

### Plan DAG 视图 (P5)
- 路由: /plans, /plans/[id]
- 功能: React Flow DAG 可视化 + ELK.js 自动布局 + Monaco Diff 视图 + Gantt 时间线

### Kanban 四维看板 (P6)
- 路由: /kanban
- 功能: 项目/会话/Agent/工作流 四种看板视图，@hello-pangea/dnd 拖拽

### 定时调度 (P7)
- 路由: /schedules, /schedules/[id]
- 功能: Cron 调度管理，APScheduler 后端集成

### Workflow 引擎 (P8)
- 后端 DAG 执行引擎，支持 8 种节点类型
- 节点: start/end/agent/approval/condition/parallel/parallel_join/delay

### Workflow 可视化编辑器 (P9)
- 路由: /workflows, /workflows/[id], /workflows/[id]/runs/[rid]
- 功能: React Flow 拖拽式编辑器 + 运行时状态视图

### Lark 双通道联动 (P10)
- API: POST /api/lark/notify, GET /api/lark/status
- 功能: Web↔Lark 双向同步，通过内部 HTTP API 松耦合
