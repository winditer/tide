# Tide

> Lark 多智能体桥接 + Web 工作台 — 把 Codex / Claude Code / Qoder 等 Agent CLI 统一在一个 FastAPI 后端中调度，前端 Web 工作台与 Lark 双通道并存。

完整架构说明见 [ARCHITECTURE.md](ARCHITECTURE.md)；开发计划见 [DEVELOPMENT.md](DEVELOPMENT.md)；演进路线见 [ROADMAP.md](ROADMAP.md)。

> **重要变更（v2.0）**：原单文件脚本 `tide_ws.py` 已废弃，全部能力迁移到 `backend/` 统一后端。详见下文「迁移说明」。

---

## 项目简介

Tide 由两个一体化部分组成：

- **FastAPI 统一后端（单进程）** — 提供 REST + WebSocket、Agent 执行器、Plan 并行调度、定时任务、工作流引擎、Lark 监听器和 SQLite 状态存储。
- **Next.js Web 工作台** — Dashboard、任务、Plan DAG、看板、定时任务和工作流可视化编辑器。

## 架构概览

```
┌─────────────────────────────────────────────────┐
│              FastAPI 统一后端 (单进程)            │
├─────────────────────────────────────────────────┤
│  Web API (REST + WebSocket)                     │
│  Agent Executor (asyncio subprocess)            │
│  Plan Executor (并行调度 + Git worktree)         │
│  Lark Listener (独立线程 WebSocket)              │
│  SQLite (统一状态存储)                            │
└─────────────────────────────────────────────────┘
        ↕ REST/WS              ↕ Lark SDK
┌──────────────┐        ┌──────────────┐
│  Web 工作台   │        │   飞书客户端   │
│  (Next.js)   │        │  (Bot 消息)   │
└──────────────┘        └──────────────┘
```

- 统一后端进程内同时承载 HTTP/WS 服务、Agent 子进程调度、Plan worktree 隔离、APScheduler 定时调度、工作流 DAG 引擎和 Lark WebSocket 监听器。
- SQLite 是唯一数据源；Web 操作和 Lark 消息都写入同一份状态，通过进程内 WS Hub 广播给所有连接。
- Lark 凭据可选；不配置 `LARK_APP_ID/LARK_APP_SECRET` 时后端自动以 **Web-only** 模式启动。

## 功能列表

- **任务管理** — 创建 / 执行 / 停止 / 重试，REST + WebSocket 流式输出。
- **Plan 并行执行** — DAG 阶段依赖调度 + Git worktree 隔离 + Diff 审批 + 合并总览。
- **审批流** — Agent 权限请求 → Web/Lark 审批卡 → 恢复执行。
- **会话管理** — 跨进程 session resume，conversations 表统一记录。
- **Lark 双向同步** — 飞书消息 → 任务、卡片按钮 → 状态更新；状态变化反向推送回卡片。
- **Web 工作台** — Dashboard / 任务 / Plan DAG / 看板 / 定时 / 工作流可视化。
- **定时调度** — Cron / Interval / Date 触发，支持 Agent / Plan / Status / 自定义命令。
- **工作流引擎** — 多 Agent 编排，节点支持 Agent / Approval / Condition / Parallel / Delay 等。
- **多 Agent 适配** — Codex CLI、Claude Code CLI、Qoder CLI（含 Quest 模式）。

## 快速开始

### 1. 安装依赖

```bash
# 后端
pip install -r backend/requirements.txt

# 前端（monorepo，根目录执行）
yarn install
```

### 2. 启动后端

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

启动后访问 `http://localhost:8000/docs` 查看 API 文档；`/health` 用于探活。

### 3. 启动前端（开发）

```bash
cd apps/web && yarn dev
```

默认地址 `http://localhost:3000`；端口被占用时 Next.js 会自动递增（3001/3002 等），后端 CORS 白名单已放行。

### 4. 可选：启用 Lark 集成

```bash
export LARK_APP_ID=cli_xxx
export LARK_APP_SECRET=xxx
# 重启后端：检测到凭据后会启动 Lark Listener 子线程
```

未配置凭据时后端会以 Web-only 模式运行，日志显示 `Lark credentials not set, running in Web-only mode`。

### 5. 确认 Agent CLI 可用

```bash
codex --help
claude --help
qodercli --help
```

只需要安装实际使用的 Agent CLI；`DEFAULT_AGENT_ID` 控制默认选择。

---

## 创建任务配置（JSON）

通过 Web 工作台或 REST API `POST /api/tasks` 创建任务时的请求体格式。

### 普通任务

```json
{
  "prompt": "实现用户登录功能",
  "agent_id": "codex",
  "model": "o4-mini",
  "cwd": "/path/to/project",
  "session_id": null,
  "attachments": []
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| prompt | string | ✅ | 任务指令内容 |
| agent_id | string | 否 | Agent 类型：codex / claude / qoder，默认 codex |
| model | string | 否 | 模型名称，如 o4-mini、claude-sonnet-4 |
| cwd | string | 否 | 工作目录（项目根路径） |
| session_id | string | 否 | 续写已有会话的 ID（不填则新建会话） |
| attachments | string[] | 否 | 附件文件路径列表 |
| workspace_id | string | 否 | 工作区 ID，默认 `default` |

### Plan 任务（自动拆分并行执行）

```json
{
  "prompt": "/plan 重构数据库层：P1 迁移ORM P2 添加索引 P3 编写测试",
  "agent_id": "codex",
  "cwd": "/path/to/project",
  "session_id": "019e8d83-69d2-..."
}
```

Plan 任务通过 `/plan` 前缀触发，系统会自动将任务拆分为多个子步骤（P1、P2、P3...）并行执行。

---

## 环境变量

完整模板见 [.env.example](.env.example)。下表只列出关键项；其余 Codex/Claude/Qoder 路径、超时和 macOS 保活配置请参考 `.env.example`。

### Lark 集成（可选）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LARK_APP_ID` | 空 | Lark 自建应用 App ID。设置后启用 Lark Listener。 |
| `LARK_APP_SECRET` | 空 | Lark 自建应用 App Secret。 |
| `LARK_DOMAIN` | `https://open.larksuite.com` | Lark OpenAPI 域名（飞书国内版改为 `https://open.feishu.cn`）。 |
| `LARK_ENCRYPT_KEY` | 空 | 事件订阅 Encrypt Key。 |
| `LARK_VERIFICATION_TOKEN` | 空 | 事件订阅 Verification Token。 |
| `LARK_ALLOWED_CHAT_IDS` | 空 | 允许使用 Bridge 的群聊 ID；填 `*` 允许所有。 |
| `LARK_ALLOWED_OPEN_IDS` | 空 | 允许触发 Bridge 的用户 open_id。 |
| `LARK_ADMIN_OPEN_IDS` | 空 | 可执行审批/停止/敏感操作的管理员 open_id。 |

### Agent 配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DEFAULT_AGENT_ID` | `codex` | 未显式指定时使用的默认 Agent，可选 `codex` / `claude` / `qoder`。 |
| `CODEX_BIN` / `CLAUDE_BIN` / `QODER_BIN` | `codex` / `claude` / `qodercli` | 各 Agent CLI 命令路径。 |
| `CODEX_DEFAULT_CWD` | 当前目录 | 默认 Agent 工作目录。 |
| `CODEX_MODEL` / `CLAUDE_MODEL` / `QODER_MODEL` | 空 | 各 Agent 默认模型；为空时使用 CLI 自身配置。 |
| `CODEX_TIMEOUT_SECONDS` | `1800` | 单次任务超时时间，Claude/Qoder 默认沿用。 |
| `QODER_QUEST_TIMEOUT_SECONDS` | `43200` | Qoder Quest 模式超时时间，默认 12 小时。 |
| `CODEX_APPROVAL_POLICY` | `on-request` | 普通任务审批策略；批准后单次重试用 `APPROVED_CODEX_APPROVAL_POLICY`。 |
| `CODEX_SANDBOX_MODE` | `workspace-write` | 普通任务 sandbox；批准后用 `APPROVED_CODEX_SANDBOX_MODE`。 |
| `CODEX_ALLOWED_ROOTS` | `CODEX_PROJECTS_ROOT` 和 `CODEX_DEFAULT_CWD` | 允许执行的目录范围；多个路径用 `:` 或 `,` 分隔。 |

### Plan / 调度 / 持久化

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PLAN_MAX_PARALLEL` | `3` | Plan 并行执行的最大子任务数。 |
| `PLAN_USE_WORKTREES` | `1` | 是否为 Plan 子任务启用 Git worktree 隔离。 |
| `PLAN_WORKTREE_ROOT` | 空 | 自定义 worktree 根目录；为空时使用 `.tide/worktrees`。 |
| `PLAN_TEST_COMMAND` | `git diff --check` | Plan 子任务完成后、进入提交审批前的检查命令。 |
| `MAX_RUNNING_TASKS` | `6` | 全局同时运行的 Agent 子进程上限；≤0 不限制。 |
| `TIDE_STATE_FILE` | `.tide_state.json` | 旧脚本状态文件（迁移期保留兼容）。 |
| `LOG_LEVEL` | `INFO` | 后端日志级别。 |
| `LOG_MESSAGE_CONTENT` | `0` | 是否在日志中记录消息正文/Agent prompt 片段。 |

> SQLite 数据库文件位于 `tide.db`（首次启动自动初始化）。

---

## 项目结构

```
tide/
├── backend/                FastAPI 统一后端
│   ├── main.py             应用入口（lifespan 注册 init_db / scheduler / lark_listener）
│   ├── api/                REST + WebSocket 路由
│   ├── services/           业务服务（task / plan / approval / lark_bridge ...）
│   ├── runtime/            Agent 执行器、适配器、Git 工具、配置
│   ├── models/             Pydantic Schema
│   ├── db/                 SQLite 引擎与建表 SQL
│   └── tests/              pytest
├── apps/web/               Next.js 15 Web 工作台
├── packages/
│   ├── core/               Headless 逻辑（zustand store / react-query / api client）
│   ├── ui/                 shadcn/ui 原子组件
│   └── views/              业务页面组件
├── tide_ws.py              ⚠️ DEPRECATED — 旧单文件脚本，仅作迁移参考
├── ARCHITECTURE.md         架构文档
├── DEVELOPMENT.md          开发指南
└── ROADMAP.md              路线图
```

后端模块职责详见 [ARCHITECTURE.md](ARCHITECTURE.md)。

---

## Web 工作台主要页面

| 页面 | 路径 | 说明 |
|------|------|------|
| Dashboard | `/` | 运行中 / 排队中 / 待审批 / 今日完成统计，最近任务，Agent 状态，快捷输入 |
| 任务 | `/tasks` `/tasks/[id]` | 创建 / 查看 / 停止 / 重试 / 审批，SSE 输出流 |
| Plan | `/plans` `/plans/[id]` | DAG 可视化、Gantt 时间线、分文件 Diff、合并总览 |
| 看板 | `/kanban` | 项目 / 会话 / Agent / 工作流四维看板，拖拽切换状态 |
| 定时 | `/schedules` | Cron / Interval / Date 定时任务 |
| 工作流 | `/workflows` | 多 Agent 协作流程可视化编辑器（React Flow） |
| 项目 | `/projects` | 项目列表与详情 |
| 会话 | `/sessions` | Agent session resume |

---

## Lark 使用方式（启用 Lark 集成后）

机器人加入群聊后即可使用：

- 直接发送文本 → 默认 Agent 执行。
- `/help`、`/panel`、`/projects`、`/convos`、`/status`、`/daily` — 查看面板和状态。
- `/agent=claude`、`/agent=qoder` — 切换默认 Agent；`/codex <指令>` / `/claude <指令>` / `/qoder <指令>` 单次切换。
- `/qoder=quest <指令>` — Qoder Quest 模式，支持暂停 / 继续 / 终止。
- `/plan ...` — 并行 Plan 模式，支持阶段和依赖（`depends:1,2`）。
- `/approve <id>` / `/reject <id>` — 审批；`/stop` 停止当前任务；`/cancel <id>` 取消排队任务。
- 图片/文件附件：自动下载到 `.tide/attachments`，下一条普通指令会自动带上。
- 中文别名：`看板`、`项目`、`对话`、`状态`、`日报`、`帮助`、`停止` 等可省略 `/` 前缀。

完整指令清单与卡片交互逻辑保留与原 Lark Bridge 一致。

---

## 迁移说明（v1 → v2）

| 主题 | v1（已废弃） | v2（当前） |
|------|------------|------------|
| 入口 | `python3 tide_ws.py` | `uvicorn backend.main:app` |
| 状态 | `.tide_state.json` | SQLite (`tide.db`) |
| Lark | 必需 | **可选**（缺凭据则 Web-only） |
| 前端 | 无 | Next.js 16 + React 19 工作台 |
| 部署 | 单脚本 | 单进程 FastAPI（可叠加 Web 容器） |

`tide_ws.py` 顶部已加 `DEPRECATED` 标记，保留仅作为迁移参考；后续版本将删除。

## 测试

```bash
# 后端单元测试
cd /Users/haifeng/Documents/tide
python -m pytest backend/tests/ -v

# 前端 lint / typecheck
cd apps/web && yarn lint
```

## 常见问题

### 后端启动后访问 401/403

检查浏览器使用的端口是否在 `backend/main.py` 的 CORS 白名单中（默认 3000–3002）。

### Lark 收不到消息

- 确认 Lark App 已发布 IM 权限并加入群。
- 确认 `LARK_APP_ID/SECRET/ENCRYPT_KEY/VERIFICATION_TOKEN` 配置正确。
- 查看后端日志是否有 `Lark credentials not set` 或 `lark_listener` 异常。

### Plan worktree 创建失败

- 确认当前 `cwd` 是 Git 仓库且工作区干净。
- `PLAN_USE_WORKTREES=0` 可临时关闭 worktree 隔离回退到原目录执行。
