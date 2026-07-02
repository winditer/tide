# Tide

> Lark 多智能体桥接 + Web 工作台 — 把 Codex / Claude Code / Qoder 等 Agent CLI 统一在一个 FastAPI 后端中调度，前端 Web 工作台与 Lark 双通道并存。

完整架构说明见 [ARCHITECTURE.md](ARCHITECTURE.md)；开发计划见 [DEVELOPMENT.md](DEVELOPMENT.md)；演进路线见 [ROADMAP.md](ROADMAP.md)。

> **重要变更（v2.0）**：原单文件脚本 `tide_ws.py` 已废弃，全部能力迁移到 `backend/` 统一后端。详见下文「迁移说明」。

---

## 项目简介

Tide 由两个一体化部分组成：

- **FastAPI 统一后端（单进程）** — 提供 REST + WebSocket、Agent 执行器、Plan 并行调度、定时任务、工作流引擎、Lark 监听器和 SQLite 状态存储。
- **Next.js Web 工作台** — Dashboard、任务、Plan DAG、看板、定时任务、工作流可视化编辑器、代码编辑器、Git 审计、冲突解决。

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
- **会话管理** — 跨进程 session resume，conversations 表统一记录；支持 Qoder IDE / Codex CLI 多源发现、精确路径匹配、DB + 文件系统去重。
- **Lark 双向同步** — 飞书消息 → 任务、卡片按钮 → 状态更新；状态变化反向推送回卡片。
- **Web 工作台** — Dashboard / 任务 / Plan DAG / 看板 / 定时 / 工作流可视化。
- **定时调度** — Cron / Interval / Date 触发，支持 Agent / Plan / Status / 自定义命令。
- **工作流引擎** — 多 Agent 编排，节点支持 Agent / Approval / Condition / Parallel / Delay / Git Merge 等。
- **多 Agent 适配** — Codex CLI、Claude Code CLI、Qoder CLI（含 Quest 模式）。
- **项目组** — 多仓库聚合、成员管理、跨仓库 Plan 自动生成、聚合视图。
- **工作项智能路由** — 基于知识图谱与 LLM 分析，自动将项目组工作项路由到最合适的子项目，支持两阶段方案生成 + 路由决策流程。
- **工作项 AI 分解** — 输入长文本需求 / PRD / 链接 / 附件，LLM 自动拆解为多个合适粒度的工作项，人工校对后批量创建。
- **浮动聊天产物展示** — 聊天窗口自动汇总会话中生成的文件/链接产物，支持在线查看（JSON / 代码 / 图片预览）与「在新标签页打开」。
- **知识图谱** — 自动生成仓库级代码知识图谱（10 类：模块依赖 / API 接口 / 数据库 Schema / 业务概念 / 系统架构 / 技术栈 / 编码风格 / 数据流 / 测试覆盖 / 事件总线），Python 项目静态分析（全部 10 类），非 Python 项目通过 Agent（Codex/Claude/Qoder）驱动分析；生成过程中展示旋转进度图标和实时进度弹窗。
- **权限认证** — JWT 用户认证、Lark OAuth2 SSO、角色隔离（admin/member/viewer）、项目成员管理。
- **A2A 远程 Agent** — 通过 A2A Bridge 协议在远程服务器部署 Agent CLI，支持多进程横向扩展。
- **Lark 权限过滤** — Lark 端操作遵循项目级权限隔离，支持白名单控制。
- **ECC 企业能力中心** — Skills 技能库 / Rules 规则引擎 / Hooks 事件驱动 / Security 安全审查 / Cost Tracking 成本追踪。
- **任务自动恢复** — 服务重启时自动将残留的 running/queued 任务标记为 cancelled，避免幽灵任务。
- **代码查看编辑器** — Monaco Editor 多标签编辑，文件树浏览、搜索、主题切换、全屏模式、Ctrl+S 保存。
- **Git 审计** — 四维审计视图（按提交/按文件/按工作项/按会话），支持分支、工作项、时间筛选；未提交变更管理；Diff 左右分栏 + Inline/Side-by-side 切换。
- **合并冲突解决** — 冲突文件列表、三方 diff、规则化解决、AI 智能解决，与工作流 git_merge 节点集成。

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

## Docker Compose 部署

通过 Docker Compose 一键启动「FastAPI 后端 + Next.js 前端」双容器，SQLite 与 `.tide/` 运行时目录通过 volume 持久化。

### 前置条件

- Docker Engine ≥ 20.10
- Docker Compose v2（`docker compose` 子命令）
- 项目根目录存在 `.env`（可由 `cp .env.example .env` 生成并按需修改）

### 文件清单

| 文件 | 说明 |
|------|------|
| `docker-compose.yml` | 编排 `backend` 与 `frontend` 两个服务、暴露端口、声明卷 |
| `Dockerfile.backend` | `python:3.11-slim` + `backend/`，单进程 `uvicorn` 启动 |
| `Dockerfile.frontend` | `node:20-alpine` 多阶段构建，复制 monorepo 后 `next start` |

### 快速启动

```bash
# 1. 准备 .env（首次）
cp .env.example .env
# 至少修改：TIDE_JWT_SECRET、TIDE_ADMIN_PASSWORD；如需 Lark 还要填 LARK_*

# 2. 构建并后台启动
docker compose up -d --build

# 3. 浏览器访问
# 前端: http://localhost:3000
# 后端: http://localhost:8000/docs
```

### 服务与网络

- `backend` 监听 `8000`，对外暴露 `8000:8000`（仅供调试，可在 `docker-compose.yml` 中注释掉 `ports`）。
- `frontend` 监听 `3000`，对外暴露 `3000:3000`，通过 `next.config.ts` 的 `rewrites` 把 `/api/*` 与 `/ws` 反向代理到 `API_BACKEND_URL`（compose 内默认覆盖为 `http://backend:8000`，走 docker 内部 DNS）。
- 用户浏览器始终通过 `http://localhost:3000` 访问，CORS 白名单已包含该地址，无需修改 `backend/main.py`。

### 环境变量策略

- 两个服务都通过 `env_file: .env` 读取根目录的 `.env`。
- 后端：直接消费全部变量（含 Lark / Codex / Plan / 认证等）。
- 前端：构建阶段读取 `NEXT_PUBLIC_*`（被 Next.js 在构建时嵌入产物），运行时读取 `API_BACKEND_URL`。
- `API_BACKEND_URL` 在 `docker-compose.yml` 中显式覆盖为 `http://backend:8000`，避免使用宿主机回环地址。
- `DATABASE_URL` 在容器内被覆盖为 `sqlite+aiosqlite:////app/data/tide.db`，落到挂载卷。

> ⚠️ `NEXT_PUBLIC_*` 变量在 **镜像构建时** 嵌入。修改这些值后必须 `docker compose build frontend` 才能生效。

### 数据持久化

两个具名卷负责保留有状态数据：

| 卷 | 容器路径 | 内容 |
|----|----------|------|
| `tide-data` | `/app/data` | SQLite 数据库 `tide.db`（用户、任务、Plan、调度、工作流、对话） |
| `tide-runtime` | `/app/.tide` | Plan worktrees、Lark 附件、归档与状态文件 |

备份示例：

```bash
docker run --rm -v tide-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/tide-data-$(date +%Y%m%d).tgz -C /data .
```

### 单进程约束

后端 **必须单进程运行**——APScheduler、Lark Listener、WS Hub、运行中任务表均依赖进程内内存状态。`Dockerfile.backend` 的 `CMD` 没有 `--workers`，请勿添加；如需扩容请走「多实例 + 共享 PostgreSQL/Redis」路线（当前版本不支持）。

### 常用命令

```bash
# 启动 / 后台启动
docker compose up
docker compose up -d

# 停止（保留卷）/ 停止并删除卷（清空数据库）
docker compose down
docker compose down -v

# 查看日志
docker compose logs -f backend
docker compose logs -f frontend

# 重新构建某个服务（依赖变更或 NEXT_PUBLIC_* 变更后）
docker compose build backend
docker compose build frontend
docker compose up -d --build

# 进入容器排障
docker compose exec backend bash
docker compose exec frontend sh

# 查看健康状态
docker compose ps
```

### 常见问题

- **前端 502 / API 超时**：检查 `backend` 是否健康（`docker compose ps`），以及 `API_BACKEND_URL` 是否仍指向 `http://backend:8000`。
- **构建后端失败：缺少 git**：`Dockerfile.backend` 已安装 `git`、`curl`；若自定义镜像请保留 `git`（Plan worktree 需要）。
- **数据库被重置**：确认未执行过 `docker compose down -v`；`tide-data` 卷保留即可恢复。
- **Lark 凭据未生效**：变量需写入 `.env` 而不是仅 `export`；修改后 `docker compose up -d` 会自动重启容器。

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

### 认证

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `TIDE_REQUIRE_AUTH` | `0` | 是否强制启用认证；设为 `1` 后所有 API 需携带 JWT token。 |
| `TIDE_JWT_SECRET` | 空 | JWT 签名密钥，启用认证时必填。 |
| `TIDE_ADMIN_PASSWORD` | 空 | 管理员初始密码，首次启动时自动创建 admin 账户。 |
| `TIDE_SHOW_ARCHIVED` | `0` | 默认是否展示已归档会话/任务。 |
| `LARK_ALLOWED_OPEN_IDS` | 空（不启用） | Lark 操作白名单（逗号分隔 open_id）。 |

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

### LLM（知识图谱 / 工作项 AI 分解）

工作项 AI 分解与知识图谱 Agent 驱动路径复用同一组 `KNOWLEDGE_LLM_*` 环境变量，同时兼容 OpenAI Chat Completions 与 Anthropic Messages 两种协议。未配置时工作项 AI 分解接口返回 503，其他功能不受影响。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `KNOWLEDGE_LLM_PROVIDER` | `openai` | 协议类型：`openai`（OpenAI 兼容）或 `anthropic`。 |
| `KNOWLEDGE_LLM_BASE_URL` | `https://api.openai.com/v1` | LLM 服务 Base URL；Anthropic 默认 `https://api.anthropic.com`。 |
| `KNOWLEDGE_LLM_API_KEY` | 空 | LLM API Key，必填。 |
| `KNOWLEDGE_LLM_MODEL` | `gpt-4o-mini` | 默认模型名（可填入任意服务商支持的型号）。 |
| `KNOWLEDGE_LLM_TIMEOUT` | `120` | 单次 LLM 请求超时（秒）。 |

> 工作项 AI 分解附件仅支持 .md/.txt/.docx/.pdf，单文件 10MB；附件仅临时解析载入 prompt，不落盘。

---

## 项目结构

```
tide/
├── backend/                FastAPI 统一后端
│   ├── main.py             应用入口（lifespan 注册 init_db / scheduler / lark_listener）
│   ├── api/                REST + WebSocket 路由（含 git_audit、files）
│   ├── services/           业务服务（task / plan / approval / session_discovery / lark_bridge ...）
│   ├── runtime/            Agent 执行器、适配器、Git 工具、配置
│   ├── models/             Pydantic Schema
│   ├── db/                 SQLite 引擎与建表 SQL
│   └── tests/              pytest
├── apps/web/               Next.js 16 Web 工作台（含代码编辑器、Git 审计、冲突解决）
├── packages/
│   ├── core/               Headless 逻辑（zustand store / react-query / api client）
│   ├── ui/                 shadcn/ui 原子组件
│   └── views/              业务页面组件
├── scripts/                仓库级脚本
│   ├── gen_knowledge_graph.py  知识图谱生成（10 个分析器，全部 10 类图谱）
│   ├── code_collector.py      代码收集器（语言检测、文件树、上下文构建）
│   └── llm_analyzer.py        Prompt 模板（10 个）与 JSON 提取工具
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
| 看板 | `/kanban` | 项目 / 会话 / Agent / 工作流 / 工作项五维看板，支持项目组、拖拽切换状态 |
| 定时 | `/schedules` | Cron / Interval / Date 定时任务 |
| 工作流 | `/workflows` | 多 Agent 协作流程可视化编辑器（React Flow） |
| 项目 | `/projects` | 项目列表与详情 |
| 代码编辑器 | `/projects/[id]/files` | Monaco Editor 多标签编辑、文件树浏览、主题切换、全屏 |
| Git 审计 | `/projects/[id]/audit` | 四维审计（提交/文件/工作项/会话）、Diff 查看、未提交变更管理 |
| 会话 | `/sessions` | Agent session resume |
| 项目组 | `/projects/groups/[id]` | 项目组详情（对话/任务/版本/成员/设置五 Tab） |
| 知识图谱 | 项目/项目组设置 Tab | 仓库 `.knowledge/` 图谱文件浏览（10 类图谱）、Markdown 编辑、ZIP 导出、触发 Agent 生成、旋转进度图标 + 进度弹窗 |
| 技能库 | `/settings/skills` | ECC Skills 管理（创建/编辑/删除/Markdown 预览） |
| 规则 | `/settings/rules` | ECC Rules 管理（global/language/project 三层） |
| 事件钩子 | `/settings/hooks` | ECC Hooks 管理（事件/条件/动作配置） |
| 安全审查 | `/settings/security` | 安全规则 + 扫描发现双 Tab |

---

## ECC 企业能力中心（Enterprise Capability Center）

ECC 为 Tide 提供五大企业级治理能力，全部通过 Web 工作台 Settings 页面管理，并与工作流引擎自动集成：

| 能力 | 说明 | 管理入口 |
|------|------|----------|
| **Skills 技能库** | 可复用的 Agent 知识片段，注入到 prompt 中增强 Agent 能力 | Settings → Skills |
| **Rules 规则引擎** | 强制约束规则，按 global/language/project 三层分级自动匹配注入 | Settings → Rules |
| **Hooks 事件驱动** | 任务/工作流事件触发自动化动作（脚本/Webhook/通知/技能调用） | Settings → Hooks |
| **Security 安全审查** | 正则模式扫描 Agent 输出，检测密钥泄露/代码质量/合规问题 | Settings → Security |
| **Cost Tracking 成本追踪** | 按 agent/model/project 维度统计 Token 用量与费用 | Dashboard 首页 |
| **Expert Teams 专家团** | 定义领域专家（绑定 Agent + Skills + 角色提示词），工作流中选用专家团自动注入配置 | Settings → Expert Teams |

### 快速开始

#### 创建第一个 Skill

1. 访问 Web 工作台 → Settings → Skills。
2. 点击「创建」，填写：
   - **Name**：技能名称（如「React 最佳实践」）
   - **Slug**：唯一标识（如 `react-best-practices`）
   - **Category**：分类标签
   - **Content**：Markdown 格式的技能内容
3. 在工作流 Agent 节点的 PropertyPanel 中勾选该技能，运行时将自动注入。

#### 创建第一个 Rule

1. 访问 Settings → Rules，点击「创建」。
2. 选择 scope：
   - `global` — 对所有任务生效
   - `language` — 仅对特定语言项目生效（如 `typescript`，系统根据工作目录自动检测）
   - `project` — 仅对指定项目生效
3. 编写规则内容（Markdown），保存后自动对匹配的任务生效。

#### 创建第一个 Hook

1. 访问 Settings → Hooks，点击「创建」。
2. 选择触发事件（如 `task.status_changed`）。
3. 设置条件（可选，JSON 格式，如 `{"new_status": "completed"}`）。
4. 选择动作类型并配置：
   - `script` — 执行脚本命令
   - `webhook` — 发送 HTTP 回调
   - `notification` — 发送通知
   - `skill` — 调用技能（如 `security-scan`）

### 工作流集成

Rules 和 Skills 在 Agent 执行时自动注入：

```
用户提交任务 / 工作流节点执行
       │
       ▼
┌─────────────────────────────────┐
│ 1. 规则匹配 (adapters.py)          │
│    global → language → project   │
│    → 注入 prompt 顶部 (强制约束)  │
├─────────────────────────────────┤
│ 2. 技能加载 (workflow_engine.py)   │
│    选中的 Skills Markdown        │
│    → 追加到 system prompt       │
├─────────────────────────────────┤
│ 3. 执行 Agent CLI                │
├─────────────────────────────────┤
│ 4. Hook 触发 (hook_engine.py)    │
│    task.status_changed 事件      │
│    → 异步执行动作 (如 security) │
└─────────────────────────────────┘
```

### 安全审查配置

安全扫描可通过两种方式触发：

1. **手动扫描**：Settings → Security → 点击「扫描」按钮，或调用 `POST /api/security/scan`。
2. **自动扫描**：创建一个 Hook，事件设置为 `task.status_changed`，动作类型选 `skill`，动作配置填 `{"skill": "security-scan"}`。

安全规则管理在 Settings → Security → Rules Tab，支持自定义正则模式、严重级别（critical/high/medium/low）和类别标签。扫描发现在 Findings Tab 中查看和处理。

### 成本查看

Dashboard 首页的成本概览卡片展示：

- **时间范围**：今日 / 本周 / 本月
- **维度切换**：按 Agent / Model / Project 分组
- **定价模型**：内置 claude-sonnet/opus/haiku、claude-sonnet-4/opus-4、gpt-4o/gpt-4o-mini/gpt-5、o3/o3-mini/o4-mini、codex-mini、qoder

成本数据源自任务执行时记录的 `token_input` / `token_output` 字段，由 `cost_service` 按模型定价实时计算。

Token 采集支持三路径（优先级从高到低）：
1. **Claude 精确采集**：Claude CLI `result` 事件直接报告精确 token 用量及费用（含 cache token）。
2. **通用 JSON 解析**：从 CLI 流式 stdout 的 JSON 行中解析 token 信息（Codex CLI 等）。
3. **tiktoken 估算**：当上述两条路径均无有效数据时，使用 tiktoken（cl100k_base）对 prompt 和输出文本估算，不含系统 prompt 和工具定义。

**支持的客户端类型**：
- Codex CLI — 通用 JSON 解析 + tiktoken 兜底
- Claude CLI — 精确 token + 直报成本 (`reported_cost_usd`)
- Qoder CLI — 通用 JSON 解析 + tiktoken 兜底
- Qoder IDE 插件 — 通过 `POST /api/sessions/{session_id}/usage` 主动上报
- 自动同步 — APScheduler 每 5 分钟扫描本地 IDE 会话文件，增量估算并写入 DB

### 批量导入

```bash
# 导入技能库（从外部目录批量导入 Markdown 技能文件）
python3 -m backend.scripts.import_ecc_skills /path/to/skills/dir --workspace default

# 导入预置安全规则（18 个规则覆盖 secret_detection/code_quality/compliance）
python3 -m backend.scripts.import_security_rules --workspace default
```

> 注意：`import_ecc_skills` 的 `<skills_dir>` 必须是实际存在的目录路径，不支持占位符。

### 专家团 (Expert Teams)

专家团允许用户将 Agent、Skills 和角色提示词捆绑为"领域专家"预设。在工作流 Agent 节点中选择专家团后，系统自动：
- 切换到指定 Agent（Codex / Claude Code / Qoder / 远程 A2A Agent）
- 注入绑定的 Skills
- 在 Prompt 前注入角色提示词

管理入口：Settings → Expert Teams

**API 端点**：
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/expert-teams` | 列出专家团（支持 project_id 过滤） |
| POST | `/api/expert-teams` | 创建专家团 |
| GET | `/api/expert-teams/{id}` | 专家团详情 |
| PUT | `/api/expert-teams/{id}` | 更新专家团 |
| DELETE | `/api/expert-teams/{id}` | 删除专家团 |

### 项目级配置 (Project-Scoped Settings)

Skills、Rules、Hooks、Security 四个模块均支持项目级配置，采用**继承+覆盖**模式：

- `project_id IS NULL` 表示全局配置
- `project_id = <项目ID>` 表示项目级配置
- 运行时按 slug/name 合并：项目配置覆盖全局同名项，未覆盖的全局项保留

**权限模型**：
- 全局 admin：管理所有配置
- 项目 admin/owner：管理本项目配置
- 项目 member/viewer：查看和使用配置

---

## 项目组（Project Groups）

项目组是 Tide 的多仓库协作核心功能。通过将多个关联项目聚合为一组，实现统一的成员管理、跨仓库任务编排、数据聚合查看。

### 核心能力

| 能力 | 说明 |
|------|------|
| **项目组 CRUD** | 创建/列表/详情/更新/删除，按 workspace 隔离 |
| **成员项目管理** | 添加/移除项目，支持 primary（主项目）和 member 角色 |
| **用户成员管理** | 添加/修改/移除用户，支持 owner/member/viewer 角色 |
| **成员自动同步** | 添加用户或项目时，自动同步到关联项目的 project_members（幂等） |
| **权限过滤** | 非 admin 用户只能看到自己有 membership 的项目组 |
| **聚合视图** | 自动汇聚组内所有项目的对话、任务、版本数据 |
| **跨仓库 Plan** | Plan 绑定项目组，子任务自动分发到成员项目 |
| **工作流绑定** | 项目组可绑定工作流，触发跨仓库编排 |

### 快速开始

#### 1. 创建项目组

```bash
curl -X POST http://localhost:8000/api/project-groups \
  -H "Content-Type: application/json" \
  -d '{
    "name": "我的全栈项目",
    "description": "前后端多仓库协作",
    "workspace_id": "default"
  }'
```

响应示例：

```json
{
  "id": "a1b2c3d4-...",
  "workspace_id": "default",
  "name": "我的全栈项目",
  "description": "前后端多仓库协作",
  "created_by": "admin",
  "created_at": "2026-06-20T10:00:00Z",
  "members": []
}
```

#### 2. 添加成员项目

```bash
# 添加主项目（primary）
curl -X POST http://localhost:8000/api/project-groups/{group_id}/members \
  -H "Content-Type: application/json" \
  -d '{"project_id": "proj-backend-001", "role": "primary"}'

# 添加成员项目
curl -X POST http://localhost:8000/api/project-groups/{group_id}/members \
  -H "Content-Type: application/json" \
  -d '{"project_id": "proj-frontend-001", "role": "member"}'
```

#### 3. 添加用户成员

```bash
curl -X POST http://localhost:8000/api/project-groups/{group_id}/users \
  -H "Content-Type: application/json" \
  -d '{"user_id": "user-uuid-001", "role": "member"}'
```

添加后，该用户会自动同步到组内所有成员项目的 `project_members` 表（幂等操作，已存在则跳过）。

#### 4. 查看聚合数据

```bash
# 获取组内所有项目的对话
curl http://localhost:8000/api/project-groups/{group_id}/conversations?limit=20

# 获取组内所有项目的任务
curl http://localhost:8000/api/project-groups/{group_id}/tasks?status=running

# 获取组内所有项目的版本
curl http://localhost:8000/api/project-groups/{group_id}/versions
```

#### 5. 创建跨仓库 Plan

```bash
curl -X POST http://localhost:8000/api/plans \
  -H "Content-Type: application/json" \
  -d '{
    "title": "跨仓库重构",
    "group_id": "a1b2c3d4-...",
    "tasks": [
      {"prompt": "重构后端 API", "project_id": "proj-backend-001"},
      {"prompt": "更新前端调用", "project_id": "proj-frontend-001"}
    ]
  }'
```

未指定 `cwd` 的子任务自动使用项目组 primary 项目的路径。Plan 列表支持按 `group_id` 过滤：

```bash
curl http://localhost:8000/api/plans?group_id=a1b2c3d4-...
```

#### 6. 绑定工作流

```bash
# 绑定工作流到项目组
curl -X PUT http://localhost:8000/api/project-groups/{group_id}/workflow \
  -H "Content-Type: application/json" \
  -d '{"workflow_id": "wf-uuid-001"}'

# 解除绑定
curl -X DELETE http://localhost:8000/api/project-groups/{group_id}/workflow
```

### 前端使用方式

#### 项目组详情页

路径：`/projects/groups/[id]`，包含 5 个 Tab：

| Tab | 内容 |
|-----|------|
| 对话 | 聚合组内所有项目的 session 列表 |
| 任务 | 聚合组内所有项目的任务（可按状态过滤） |
| 版本 | 聚合组内所有项目的版本记录 |
| 成员 | 成员项目 + 用户成员管理 |
| 设置 | 项目组信息编辑、工作流绑定、危险操作 |

Header 展示：成员项目数 / 用户成员数 / 创建时间 / 创建者。

#### 统一选择器编码规则

前端所有创建入口（浮动聊天、独立任务、对话/Session、工作项）均使用统一的项目/项目组选择器：

```
选择器值编码：
  • project:{cwd}   → 选择单个项目，值为项目的工作目录路径
  • group:{id}      → 选择项目组，值为项目组 ID

示例：
  • "project:/Users/dev/my-backend"   → 单项目模式
  • "group:a1b2c3d4-..."              → 项目组模式
```

选择项目组时，系统自动使用 primary 项目的 `cwd` 作为实际执行路径，并将 `group_id` 写入 Task/Session 记录。

#### 工作项支持项目组筛选

工作项列表页提供统一的项目/项目组选择器，支持：
- 按项目组过滤工作项
- 新建工作项时联动筛选器的选中项目/项目组

#### 工作流 Agent 节点 Skills 模糊搜索

工作流编辑器中的 Agent 节点属性面板支持技能模糊搜索：
- 按名称/描述/分类实时过滤
- 前端本地实现，无额外 API 调用

### API 参考

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/project-groups` | GET | 列出项目组（参数：`workspace_id`） |
| `/api/project-groups` | POST | 创建项目组 |
| `/api/project-groups/{id}` | GET | 获取详情（含成员列表） |
| `/api/project-groups/{id}` | PUT | 更新（name/description） |
| `/api/project-groups/{id}` | DELETE | 删除（级联删除成员关系） |
| `/api/project-groups/{id}/members` | POST | 添加成员项目 |
| `/api/project-groups/{id}/members/{pid}` | DELETE | 移除成员项目 |
| `/api/project-groups/{id}/users` | GET | 列出用户成员 |
| `/api/project-groups/{id}/users` | POST | 添加用户成员 |
| `/api/project-groups/{id}/users/{uid}` | PUT | 修改用户角色 |
| `/api/project-groups/{id}/users/{uid}` | DELETE | 移除用户成员 |
| `/api/project-groups/{id}/conversations` | GET | 聚合查询对话 |
| `/api/project-groups/{id}/tasks` | GET | 聚合查询任务（可按 status 过滤） |
| `/api/project-groups/{id}/versions` | GET | 聚合查询版本 |
| `/api/project-groups/{id}/workflow` | GET | 查看绑定的工作流 |
| `/api/project-groups/{id}/workflow` | PUT | 绑定工作流 |
| `/api/project-groups/{id}/workflow` | DELETE | 解除工作流绑定 |

### 数据库表

| 表 | 说明 |
|------|------|
| `project_groups` | 项目组定义（id, workspace_id, name, description, created_by, workflow_id） |
| `project_group_members` | 成员项目关联（group_id, project_id, role: primary/member） |
| `project_group_user_members` | 用户成员（group_id, user_id, role: owner/member/viewer） |
| `plans.group_id` | Plan 与项目组的关联字段 |
| `tasks.group_id` | Task 与项目组的关联字段 |

---

## 知识图谱（Knowledge Graph）

知识图谱自动分析仓库代码结构，生成 **10 类**可视化图谱，存放于仓库下 `.knowledge/` 目录。

### 图谱类型

| 类型 | 标识 | 内容 | 产物 |
|------|------|------|------|
| **模块依赖图** | `module` | import 关系、架构分层、被依赖统计 | `module/module_graph.json` + `.md` |
| **API 接口图谱** | `api` | 路由、HTTP 方法、参数、关联 Service | `api/api_graph.json` + `.md` |
| **数据库 Schema** | `db` | 表结构、外键、索引、ER 关系图 | `db/schema_graph.json` + `.md` + `er_diagram.md` |
| **业务概念图** | `concept` | 核心实体、关系、领域划分 | `concept/concept_graph.json` + `.md` |
| **系统架构** | `architecture` | 目录结构、层次划分、Docker 配置推断 | `architecture/architecture_graph.json` + `.md` |
| **技术栈** | `tech-stack` | 语言/框架/工具链/依赖推断 | `tech-stack/tech_stack_graph.json` + `.md` |
| **编码风格** | `coding-style` | 命名约定、代码组织、测试实践推断 | `coding-style/coding_style_graph.json` + `.md` |
| **数据流** | `data-flow` | API 路由推断请求链路 | `data-flow/data_flow_graph.json` + `.md` |
| **测试覆盖** | `test-coverage` | 测试文件分析、覆盖率推断 | `test-coverage/test_coverage_graph.json` + `.md` |
| **事件总线** | `event-bus` | WebSocket/EventEmitter 事件机制 | `event-bus/event_bus_graph.json` + `.md` |

### 生成方式

| 方式 | 适用场景 | 说明 |
|------|---------|------|
| **静态分析**（默认） | Python 项目 | 基于 AST 解析 + 文件启发式推断，支持全部 10 类图谱 |
| **Agent 驱动** | 任意语言项目 | 用户在 UI 选择已配置的 Agent（Codex/Claude/Qoder），后端发送分析 Prompt，Agent 读取代码并生成 JSON；支持全部 10 类图谱 |

### 快速使用

1. 进入项目或项目组详情页 → **知识图谱** Tab。
2. 选择「生成类型」（全部/10 类之一）和「分析方式」（静态分析或选择 Agent）。
3. 点击「立即生成」，旋转进度图标展示实时进度（可点击查看日志和错误）。
4. 左侧文件树浏览产物，右侧查看 Markdown / JSON，支持在线编辑保存和 ZIP 导出。

### CLI 方式（静态分析，全部 10 类）

```bash
# 生成全部 10 类图谱
python3 scripts/gen_knowledge_graph.py --type all --repo-path /path/to/project

# 生成特定类型
python3 scripts/gen_knowledge_graph.py --type architecture --repo-path /path/to/project
python3 scripts/gen_knowledge_graph.py --type tech-stack --repo-path /path/to/project
python3 scripts/gen_knowledge_graph.py --type data-flow --repo-path /path/to/project
```

`--type` 可选值：`all` / `module` / `api` / `db` / `concept` / `architecture` / `tech-stack` / `coding-style` / `data-flow` / `test-coverage` / `event-bus`

---

## 权限与认证

### 启用认证

设置环境变量启用强制认证：

```bash
TIDE_REQUIRE_AUTH=1
```

默认为 `0`（关闭），所有 API 可匿名访问，适用于个人开发环境。

### 登录方式

- **用户名密码**：`POST /api/auth/login` → 返回 JWT token
- **Lark OAuth2**：`GET /api/auth/lark/login` → 飞书扫码 → 自动创建/绑定用户

### 角色说明

| 角色 | 权限范围 |
|------|--------|
| admin | 全局管理，跳过项目级检查 |
| member | 按项目配置（owner/member/viewer） |
| viewer | 全局只读 |

### 项目成员管理

```bash
# 添加成员
POST /api/projects/{project_id}/members
{"user_id": "xxx", "role": "member"}

# 查看成员
GET /api/projects/{project_id}/members

# 修改角色
PUT /api/projects/{project_id}/members/{user_id}
{"role": "viewer"}
```

### Lark 权限过滤

Lark 端操作同样受权限体系约束：

- 环境变量 `LARK_ALLOWED_OPEN_IDS`（逗号分隔）可限制允许操作的飞书用户
- 飞书用户需通过 Web 端 OAuth 登录绑定后方可在 Lark 端执行写操作
- `TIDE_REQUIRE_AUTH=0` 时 Lark 端权限检查不阻止操作（向后兼容）

---

## Git 审计

### 查看 Commit 历史

```bash
GET /api/projects/{project_id}/git/commits?branch=main&limit=50
```

支持参数：`branch`、`since`、`until`、`author`、`limit`

### 变更统计

按不同维度聚合变更：

```bash
# 按工作项聚合
GET /api/projects/{project_id}/git/changes?group_by=work_item

# 按会话聚合
GET /api/projects/{project_id}/git/changes?group_by=session

# 按分支聚合
GET /api/projects/{project_id}/git/changes?group_by=branch
```

### Diff 查看

```bash
GET /api/projects/{project_id}/git/diff/{commit_hash}
```

返回该 commit 的文件变更列表及具体 diff 内容。

---

## A2A 远程 Agent

通过 A2A Bridge 支持在远程服务器上运行 Agent CLI，实现横向扩展。

### 部署 Bridge

```bash
cd a2a-bridge
cp .env.example .env
# 编辑 .env 配置 GIT_REPO_URL、AGENT_CLI 等

docker build -t tide-a2a-bridge .
docker run -p 8720:8720 --env-file .env tide-a2a-bridge
```

### 注册远程 Agent

```bash
POST /api/remote-agents
{
  "name": "remote-codex",
  "url": "http://bridge-host:8720",
  "agent_type": "codex"
}
```

### 使用

注册后的远程 Agent 可在工作流 Agent 节点中选用，任务自动通过 A2A 协议分发到 Bridge 执行。

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
