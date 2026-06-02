# Lark to Codex Bridge

把飞书 / Lark 群聊消息转成 Codex CLI 任务，并把执行进度、任务结果、审批操作和项目状态同步回 Lark 卡片。

## 功能

- 在 Lark 中直接发送自然语言指令，启动或续写 Codex 任务。
- 通过 `Codex 指令` 面板查看当前任务状态、最新结果、待审批项，并直接批准或拒绝。
- 查看 Codex 项目、对话、当前项目状态和日报。
- 通过 `/plan` 把任务清单拆成多个 Codex 子任务并行处理。
- 同步 Codex Desktop 会话的新消息和完成结果。
- macOS 上接入电源时自动保持脚本运行和网络活跃，可选开启合盖防睡眠。

## 依赖

- Python 3.10+
- Codex CLI，命令默认为 `codex`
- 飞书 / Lark 自建应用
- Python SDK：

```bash
pip3 install lark-oapi
```

macOS 保活依赖系统自带命令：

- `caffeinate`
- `pmset`

## Lark 应用配置

在 Lark 开发者后台创建自建应用后，至少需要配置：

- `LARK_APP_ID`
- `LARK_APP_SECRET`
- 事件订阅的 Encrypt Key 和 Verification Token，分别填入：
  - `LARK_ENCRYPT_KEY`
  - `LARK_VERIFICATION_TOKEN`
- 启用机器人能力，并把机器人加入目标群聊。
- 开通和发布 IM 相关权限，确保机器人能收消息、发消息、接收卡片按钮回调。
- 事件订阅使用 WebSocket 长连接，本脚本会注册：
  - 消息接收事件
  - 消息已读事件
  - 卡片按钮回调事件

## 安装

```bash
cd /Users/haifeng/Documents/lark2codex
cp .env.example .env
pip3 install lark-oapi
```

编辑 `.env`，至少填入：

```env
LARK_APP_ID=cli_xxx
LARK_APP_SECRET=xxx
LARK_ENCRYPT_KEY=xxx
LARK_VERIFICATION_TOKEN=xxx
CODEX_DEFAULT_CWD=/Users/haifeng/Documents/lark2codex
```

确认 Codex CLI 可用：

```bash
codex --help
```

## 运行

前台运行：

```bash
cd /Users/haifeng/Documents/lark2codex
python3 lark_codex_ws.py
```

启动成功后会看到类似输出：

```text
Lark-Codex WebSocket 启动成功
指令：/panel | /projects | /convos | /status | /daily | /stop | 直接发消息
```

脚本启动后会向已记录的 Lark 会话发送欢迎语，默认内容为：

```text
I'm Lark Codex, a lightweight agent that helps you use lark to work perfectly with Codex!
```

可通过 `LARK_CODEX_WELCOME_MESSAGE` 自定义；设为空字符串时不发送启动欢迎语。启动时不会自动推送 `/status`，需要状态时可以手动发送 `/status`，或设置 `STATUS_INTERVAL_SECONDS` 开启定时状态推送。

后台运行：

```bash
cd /Users/haifeng/Documents/lark2codex
nohup python3 lark_codex_ws.py > lark_codex_ws.log 2>&1 &
```

查询是否正在运行：

```bash
pgrep -fl lark_codex_ws.py
```

如果需要查看更完整的进程信息：

```bash
ps aux | grep '[l]ark_codex_ws.py'
```

查看最近日志：

```bash
cd /Users/haifeng/Documents/lark2codex
tail -n 100 lark_codex_ws.log
```

实时查看运行日志：

```bash
cd /Users/haifeng/Documents/lark2codex
tail -f lark_codex_ws.log
```

停止后台脚本：

```bash
pkill -f lark_codex_ws.py
```

停止后确认进程已退出：

```bash
pgrep -fl lark_codex_ws.py
```

重启后台脚本：

```bash
cd /Users/haifeng/Documents/lark2codex
pkill -f lark_codex_ws.py
nohup python3 lark_codex_ws.py > lark_codex_ws.log 2>&1 &
```

如果脚本正在运行，也可以在 Lark 中发送 `/restart` 让脚本原地重启。

## Lark 使用方式

在机器人所在群聊中发送：

- `/panel`：打开 Codex 看板。
- `/projects`：打开项目面板。
- `/chats`：打开普通对话列表。
- `/convos`：打开当前项目对话面板。
- `/project=new <名称>`：新建项目并切换到该项目目录。
- `/chat=new <主题或指令>`：新建普通对话并执行。
- `/convos=new <指令>`：在当前项目中新建会话并执行。
- `/project=archive [编号或目录]`：归档当前项目或指定项目；兼容 `/project=achive`。
- `/chat=archive [编号或 session_id]`：归档普通对话。
- `/convos=archive [session_id]`：归档当前会话或指定会话。
- `/status`：查看当前项目状态。
- `/daily`：输出项目进展日报。
- `/daily=2026-06-01`：输出指定日期的项目进展日报，也支持 `/daily 2026-06-01`。
- `/model=<模型名> +<指令>`：使用指定模型执行一次，例如 `/model=gpt-5.5 +修复 README`。
- `/plan`：进入并行计划模式，下一条消息发送任务清单。
- `/plan <任务清单>`：直接解析并执行任务清单。
- `/plan status`：刷新最近的 Plan 面板。
- `/plan stop`：停止最近的 Plan。
- `/cd <目录>`：切换默认工作目录。
- `/project <编号>`：打开面板中的项目。
- `/latest <编号>`：打开面板中项目的最新对话。
- `/conv <session_id>`：切换到指定 Codex 会话。
- `/mark-project [目录]`：把目录手动标记为项目；不填目录时使用当前工作目录。
- `/mark-chat [session_id]`：把会话手动标记为普通对话；不填 session 时使用当前选中会话。
- `/approve <id>`：批准待审批项。
- `/reject <id>`：拒绝待审批项。
- `/stop`：停止当前 Codex 任务。
- `/restart`：原地重启 `lark_codex_ws.py` 脚本。
- 其他文本：作为 Codex 指令执行。

待审批项会显示在 `Codex 指令` 面板中，可直接点击“批准 / 拒绝”。审批处理后，面板的 `最新结果` 会更新为当前审批信息。

`/restart` 会先向 Lark 发送重启提示，再清理 macOS 保活状态并用当前 Python 解释器原地重启进程。使用 `nohup python3 lark_codex_ws.py &` 启动时，重启后仍会沿用同一个进程；如果代码或 `.env` 配置错误，重启后的进程可能直接退出。

## 项目和普通对话

脚本会按会话 `cwd` 自动区分项目和普通对话。

识别为项目的目录通常包含以下标记之一：

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

没有明确项目标记、位于通用目录、或被 `/mark-chat` 手动标记的会话，会进入 `/chats` 普通对话列表。识别错误时可用 `/mark-project [目录]` 和 `/mark-chat [session_id]` 手动修正，修正信息保存在 `.lark_codex_state.json`。

归档后的项目、普通对话和会话默认不再出现在 `/projects`、`/chats`、`/convos`、`/daily` 等查询结果中。需要查看归档内容时设置：

```env
LARK_CODEX_SHOW_ARCHIVED=1
```

`/project=new <名称>` 会在 `CODEX_PROJECTS_ROOT` 下创建项目目录；未配置时默认使用 `CODEX_DEFAULT_CWD` 的父目录。

## 指定模型

默认使用 Codex CLI 自身配置的模型。需要指定某次任务的模型时，在指令前加 `/model=<模型名>`：

```text
/model=gpt-5.5 +修复 README 中的安装说明
```

这个前缀只对当前这次任务生效，不会改写 `.env` 或 Codex 全局配置。`/plan` 也支持同样的前缀：

```text
/model=gpt-5.5 +/plan
- 检查 README
- 修复审批流程
```

Plan 清单里的单个子任务也可以单独指定模型：

```text
/plan
- /model=gpt-5.5 +重构 Plan 卡片
- /model=o3 +审查并发安全问题
```

## Plan 并行模式

`/plan` 适合把一组相对独立的任务并行交给 Codex 处理。示例：

```text
/plan
- 检查 README 是否覆盖安装步骤
- 检查审批流程有没有明显 bug
- 运行 Python 语法检查
```

也可以先发送 `/plan` 进入输入模式，再发送任务清单。

脚本会创建一个 `Codex Plan` 面板，展示每个子任务的状态、最新输出、session id、审批按钮和最终结果。默认并发数由 `PLAN_MAX_PARALLEL` 控制。

默认情况下，Plan 子任务会在当前 Git 仓库下创建独立 worktree 和分支：

```text
.lark-codex/worktrees/<plan_id>-<task_id>
lark-codex/<plan_id>-<task_id>
```

这样多个子任务可以并行修改代码，互不覆盖。每个子任务成功结束后会运行 `PLAN_TEST_COMMAND`，生成 Diff 摘要，并在 Plan 卡片中进入“等待提交”状态。点击“批准提交”会把该 worktree 的改动提交到对应子任务分支；不会自动合并回主分支。

如果当前目录不是 Git 仓库，子任务会退回到原目录执行。对于 Git 仓库，如果 worktree 创建失败，子任务会直接失败并在 Plan 面板中显示原因，避免重新落回同目录并行修改。

## 环境变量

### Lark

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LARK_APP_ID` | 空 | Lark 自建应用 App ID。 |
| `LARK_APP_SECRET` | 空 | Lark 自建应用 App Secret。 |
| `LARK_DOMAIN` | `https://open.larksuite.com` | Lark OpenAPI 域名。国内飞书可按实际环境调整。 |
| `LARK_ENCRYPT_KEY` | 空 | 事件订阅 Encrypt Key。 |
| `LARK_VERIFICATION_TOKEN` | 空 | 事件订阅 Verification Token。 |

### Codex

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CODEX_DEFAULT_CWD` | 当前目录 | 默认 Codex 工作目录。 |
| `CODEX_HOME` | `~/.codex` | Codex home 目录。 |
| `CODEX_SESSIONS_DIR` | `$CODEX_HOME/sessions` | Codex 会话文件目录。 |
| `CODEX_BIN` | `codex` | Codex CLI 命令路径。 |
| `CODEX_TIMEOUT_SECONDS` | `1800` | 单次 Codex 任务超时时间。 |
| `CODEX_MODEL` | 空 | 默认 Codex 模型；为空时使用 Codex CLI 自身配置。 |
| `CODEX_PROJECTS_ROOT` | `CODEX_DEFAULT_CWD` 的父目录 | `/project=new` 创建项目目录的位置。 |
| `CODEX_APPROVAL_POLICY` | `on-request` | 普通任务的 Codex approval policy。 |
| `CODEX_SANDBOX_MODE` | `workspace-write` | 普通任务的 Codex sandbox 模式。 |
| `APPROVED_CODEX_APPROVAL_POLICY` | `never` | Lark 审批批准后，单次重试使用的 approval policy。 |
| `APPROVED_CODEX_SANDBOX_MODE` | `danger-full-access` | Lark 审批批准后，单次重试使用的 sandbox 模式。 |

### 卡片和消息

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LARK_MESSAGE_CHUNK_SIZE` | `1800` | 长消息分片长度。 |
| `LARK_FINAL_REPLY_MAX_CHARS` | `4000` | 最终回复最大展示长度。 |
| `LARK_FINAL_QUESTION_MAX_CHARS` | `1200` | 用户问题最大展示长度。 |
| `MAX_PROJECTS_IN_PANEL` | `8` | 面板最多展示项目数。 |
| `MAX_CONVERSATIONS_IN_PANEL` | `8` | 面板最多展示对话数。 |
| `MAX_SESSION_FILES` | `300` | 索引的 Codex session 文件数量上限。 |
| `TASK_CARD_REFRESH_INTERVAL_SECONDS` | `15` | Codex 指令面板自动刷新间隔。 |
| `PLAN_MAX_PARALLEL` | `3` | `/plan` 并行执行的最大子任务数。 |
| `PLAN_TASK_OUTPUT_MAX_CHARS` | `1200` | Plan 面板中每个子任务输出的最大展示长度。 |
| `PLAN_USE_WORKTREES` | `1` | 是否为 Plan 子任务启用 Git worktree 隔离。 |
| `PLAN_WORKTREE_ROOT` | 空 | 自定义 worktree 根目录；为空时使用当前仓库的 `.lark-codex/worktrees`。 |
| `PLAN_TEST_COMMAND` | `git diff --check` | 子任务完成后、进入提交审批前执行的检查命令。 |
| `PLAN_TEST_TIMEOUT_SECONDS` | `120` | Plan 检查命令超时时间。 |

### 审批

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PENDING_APPROVAL_WAIT_SECONDS` | `300` | 推送审批后等待用户处理的时间。超时后按 Codex 默认结果继续收尾。 |
| `PENDING_APPROVAL_POLL_SECONDS` | `2` | 审批等待轮询间隔。 |

### 状态、同步和持久化

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `STATUS_INTERVAL_SECONDS` | `0` | 定时推送状态的间隔。默认关闭；设为正整数可开启。 |
| `DAILY_REPORT_TIME` | `19:00` | 每日项目进展日报推送时间。 |
| `LARK_CODEX_STATE_FILE` | `.lark_codex_state.json` | 本地运行状态文件。 |
| `LARK_CODEX_SHOW_ARCHIVED` | `0` | 是否在查询结果中显示已归档项目、普通对话和会话。 |
| `LARK_CODEX_WELCOME_MESSAGE` | `I'm Lark Codex, a lightweight agent that helps you use lark to work perfectly with Codex!` | WebSocket 脚本启动时向已知 Lark 会话发送的欢迎语；为空则不发送。 |
| `SYNC_DESKTOP_SESSIONS` | `1` | 是否监听 Codex Desktop 会话更新。 |
| `SESSION_WATCH_INTERVAL_SECONDS` | `3` | Codex Desktop 会话监听间隔。 |
| `LOG_LEVEL` | `INFO` | 日志级别。 |

### macOS 保活

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `KEEP_AWAKE_ON_AC_POWER` | `1` | 接入电源时自动启动 `caffeinate`，保持脚本和网络活跃。 |
| `KEEP_AWAKE_CHECK_INTERVAL_SECONDS` | `60` | 电源状态检查间隔。 |
| `KEEP_AWAKE_DISABLE_SLEEP` | `0` | 是否尝试执行 `pmset -a disablesleep 1`。用于无外接显示器时合盖继续运行，通常需要管理员权限。 |

推荐默认只使用 `KEEP_AWAKE_ON_AC_POWER=1`。如果确实需要合盖且无外接显示器继续运行，再开启：

```env
KEEP_AWAKE_DISABLE_SLEEP=1
```

如果脚本日志提示 `pmset disablesleep 1 failed`，可以手动执行：

```bash
sudo pmset -a disablesleep 1
python3 lark_codex_ws.py
```

用完后恢复：

```bash
sudo pmset -a disablesleep 0
```

合盖运行有发热风险，不要把电脑放在包里或散热差的位置。

## Codex 会话和客户端

脚本使用标准 Codex CLI 创建和续写会话，session 文件会写入 `CODEX_SESSIONS_DIR`。Lark 中创建的会话通常来源为 `codex_exec` / `exec`，可被脚本继续续写，也可用 Codex CLI 打开：

```bash
codex resume --include-non-interactive <session_id>
```

Codex Desktop 是否在主界面直接展示这类非交互会话，取决于客户端自己的过滤逻辑。

## 常见问题

### 收不到 Lark 消息

- 确认机器人已加入目标群聊。
- 确认 Lark 应用已发布并开通 IM 事件和发消息权限。
- 确认 `LARK_APP_ID`、`LARK_APP_SECRET`、`LARK_ENCRYPT_KEY`、`LARK_VERIFICATION_TOKEN` 正确。
- 查看脚本日志中是否有 `send_card failed`、`send_msg failed` 或权限错误。

### 审批批准后没有继续执行

- 确认脚本已重启并加载最新代码。
- 确认 `.env` 中批准后的配置符合预期：

```env
APPROVED_CODEX_APPROVAL_POLICY=never
APPROVED_CODEX_SANDBOX_MODE=danger-full-access
```

### Git 提交失败

如果 Codex 输出类似：

```text
Unable to create .git/index.lock: Operation not permitted
```

通常是当前 Codex sandbox 权限不足。通过 `Codex 指令` 面板批准后，脚本会用批准后的 sandbox 配置单次重试。

### 电脑仍然睡眠

- 只防止普通 idle sleep 时，默认 `caffeinate` 即可。
- MacBook 合盖睡眠不一定能被 `caffeinate` 阻止。
- 稳定合盖运行推荐接电源、外接显示器、键盘和鼠标。
- 无外接显示器合盖运行需要 `KEEP_AWAKE_DISABLE_SLEEP=1` 或手动 `sudo pmset -a disablesleep 1`。

## 文件说明

- `lark_codex_ws.py`：主程序，负责 Lark WebSocket、消息卡片、Codex 执行、审批、会话同步和 macOS 保活。
- `.env.example`：环境变量模板。
- `.lark_codex_state.json`：运行时状态文件，本地生成，不提交。
