# Tide Web 前端

Next.js 15 App Router + TanStack Query + Tailwind CSS。

## 项目结构

```
tide/
├── apps/web/            # Next.js 15 应用
│   ├── app/             # App Router 页面
│   ├── package.json     # @tide/web
│   └── ...
├── packages/
│   ├── core/            # @tide/core — Zustand stores、React Query hooks、API client、TypeScript 类型
│   ├── ui/              # @tide/ui — shadcn/ui 原子组件
│   └── views/           # @tide/views — 业务组件
└── ...
```

## 开发启动

```bash
cd /path/to/tide
yarn install
yarn dev
```

前端默认运行在 http://localhost:3000，需同时启动后端：

```bash
cd /path/to/tide && uvicorn backend.main:app --reload --port 8000
```

## 构建生产版本

```bash
yarn build
yarn start
```

## 主要页面路由

| 路径 | 说明 |
|------|------|
| `/` | Dashboard 首页 |
| `/tasks` | 任务列表 |
| `/tasks/[id]` | 任务详情 |
| `/projects` | 项目列表 |
| `/sessions` | 会话列表 |

## 组件库使用

项目使用 shadcn/ui 组件库，组件位于 `packages/ui/`。业务组件位于 `packages/views/`。

在页面中使用：

```tsx
import { Button, Card } from "@tide/ui"
import { TaskList } from "@tide/views"
```

API 请求通过 `packages/core/` 中的 API client + TanStack Query hooks 统一管理：

```tsx
import { useTasks } from "@tide/core"
```
