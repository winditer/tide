# 技术栈

> 生成时间: 2026-06-26

## 编程语言

| 语言 | 版本 | 使用场景 | 占比估算 |
|------|------|----------|----------|
| Python | >=3.11 | 后端 FastAPI、A2A bridge、脚本 | ~50% |
| TypeScript | 5.7.x | 前端（Next.js + 三个 packages） | ~45% |
| SQL | SQLite 方言 | `backend/db/init.sql` 显式建表 + ensure_column | ~3% |
| Shell / Dockerfile | — | 构建与部署 | ~2% |

## 运行时

- **Node.js >=20** — Next.js 构建/运行
- **CPython >=3.11** — FastAPI + uvicorn

## 框架与库

### 后端（FastAPI 系）

| 库 | 版本 | 用途 |
|----|------|------|
| FastAPI | >=0.115 | REST + WebSocket 路由 |
| Uvicorn | >=0.30 | ASGI server（容器入口 `uvicorn backend.main:app`） |
| Pydantic | >=2 | schema / 请求体校验 |
| SQLAlchemy (async) | >=2.0 | 异步 ORM/Core |
| aiosqlite | >=0.20 | async SQLite driver |
| APScheduler | >=3.10 | Cron / Interval 定时任务（`services/schedule_service.py`） |
| PyJWT | >=2.8 | Access / Refresh token |
| bcrypt | >=4.1 | 密码哈希 |
| httpx | >=0.27 | 外发 HTTP |
| tiktoken | >=0.7 | Token 计数（cost_service） |
| lark-oapi | >=1.3 | 飞书开放平台 SDK |

### 前端（Next.js 系）

| 库 | 版本 | 用途 |
|----|------|------|
| Next.js | ^15.1 | App Router + SSR/SSG |
| React | ^19.0 | UI |
| Tailwind CSS | ^4.0 | 原子样式（`@tailwindcss/postcss`） |
| Radix UI | ^1.x | Headless 组件（Dialog/Dropdown/Popover/Tabs/Tooltip/Separator/Slot） |
| @xyflow/react | ^12.11 | Workflow 画布 DAG 编辑器 |
| elkjs | ^0.11 | DAG 自动布局 |
| @hello-pangea/dnd | ^18 | 看板拖拽 |
| @monaco-editor/react | ^4.7 | 代码 / Diff 编辑器 |
| react-markdown + remark-gfm | 10 / 4 | Markdown 渲染 |
| @tanstack/react-query | ^5.62 | 服务端状态 |
| zustand | ^4.5 | auth/persist store |
| lucide-react | ^0.460 | 图标 |

## 数据存储

- **SQLite 3.x（aiosqlite）** — 默认主库；schema 由 `backend/db/init.sql` 定义，运行期通过 `ensure_column` 做增量列添加；容器内挂载到 `/app/data/tide.db`。
- 无独立缓存层 / 消息队列：广播由进程内 `ws_hub` + `event_emitter` 完成。

## 消息 / 事件机制

| 名称 | 类型 | 说明 |
|------|------|------|
| `services/ws_hub.py::WSHub` | in-process WebSocket 广播 | channel 订阅 + `broadcast(channel, event)` |
| `services/event_emitter.py::EventEmitter` | in-process pub/sub | 业务事件 → `ws_hub.broadcast` + `task_events` 写库 |
| `lark-oapi LongConnection` | 外部 WS | `services/lark_listener.py` 订阅飞书事件 |

## 外部服务

| 服务 | 用途 | 客户端 |
|------|------|--------|
| Lark/Feishu Open API | IM、卡片、长连接事件 | `lark-oapi` |
| Anthropic Claude API | Claude CLI 后端 | 经 `cc-switch` sidecar（`ANTHROPIC_BASE_URL=http://tide-cc-switch:15721`） |
| OpenAI 兼容 API | Codex CLI 后端 | 经 `cc-switch` |
| Qoder CLI Service | Qoder Agent | `QODER_PERSONAL_ACCESS_TOKEN` |
| 第三方 A2A Agents | 外部 Agent 协作 | `backend/runtime/a2a_client.py` + `a2a-bridge/` |

## 开发与运维

| 工具 | 用途 |
|------|------|
| Yarn Workspaces | 根 `package.json` workspaces: `apps/*`, `packages/*` |
| Docker / Compose | `Dockerfile.backend` / `Dockerfile.frontend` / `Dockerfile.cc-switch` + `docker-compose.yml` |
| pytest | `backend/tests/` 14 个测试文件，async/单元/集成混合 |
| Next.js Lint | `next lint` |
| nginx (可选) | `.tide/nginx-storming.conf` 反代 |

## 关键依赖关系图

```mermaid
graph LR
    Next[Next.js 15] --> React[React 19]
    Next --> Tailwind[Tailwind 4]
    Next --> ReactQuery[@tanstack/react-query]
    Next --> Zustand
    Next --> Radix[@radix-ui/*]
    Next --> XYFlow[@xyflow/react]
    XYFlow --> Elkjs[elkjs]
    Next --> Monaco[@monaco-editor/react]

    FastAPI --> Uvicorn
    FastAPI --> Pydantic
    FastAPI --> SQLAlchemy
    SQLAlchemy --> aiosqlite
    FastAPI --> APScheduler
    FastAPI --> PyJWT
    FastAPI --> bcrypt
    FastAPI --> httpx
    FastAPI --> tiktoken
    FastAPI --> LarkOapi[lark-oapi]
```

## 包管理器

- `yarn`：workspace 根、`apps/web`、`packages/*`
- `pip`：`backend/requirements.txt`、`a2a-bridge/requirements.txt`
