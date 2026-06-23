# TDD 落地 — 修改点清单

> 与《01-technical-solution.md》配套，列出为实施 TDD 需要新增/修改的具体文件与配置。
> 标记：`[NEW]` 新增，`[MOD]` 修改，`[CFG]` 配置文件。

---

## 1. 工程配置类

| # | 类型 | 路径 | 说明 |
|---|------|------|------|
| 1.1 | [MOD] | `package.json` | 新增 `test`、`test:web`、`test:e2e`、`test:py`、`test:py:cov` 脚本；devDependencies 添加 `vitest`、`@vitest/coverage-v8`、`@testing-library/react`、`@testing-library/user-event`、`@testing-library/jest-dom`、`jsdom`、`msw`、`@playwright/test`、`@faker-js/faker` |
| 1.2 | [NEW] | `vitest.config.ts` | 根级 vitest 配置：jsdom 环境、setup 文件、coverage v8 provider、workspace 模式聚合 `packages/*` 与 `apps/web` |
| 1.3 | [NEW] | `vitest.setup.ts` | 引入 `@testing-library/jest-dom`、统一启动/关闭 `msw` server |
| 1.4 | [NEW] | `apps/web/vitest.config.ts` | 继承根配置，指定 `app/` 与 `__tests__/` 包含路径，处理 Next 别名 |
| 1.5 | [NEW] | `packages/core/vitest.config.ts` | 单元测试配置（node 环境足够，但 hook 测试需 jsdom） |
| 1.6 | [NEW] | `packages/views/vitest.config.ts` | 组件测试 jsdom |
| 1.7 | [NEW] | `packages/ui/vitest.config.ts` | 组件测试 jsdom |
| 1.8 | [NEW] | `playwright.config.ts` | E2E 配置：baseURL、`webServer` 启动 `yarn dev`、跨浏览器矩阵 |
| 1.9 | [MOD] | `backend/requirements.txt` | 追加 `pytest-cov>=5`、`respx>=0.21`、`factory-boy>=3.3`（dev-only，建议拆 `requirements-dev.txt`） |
| 1.10 | [NEW] | `backend/requirements-dev.txt` | 开发依赖隔离：pytest 系列 + lint |
| 1.11 | [NEW] | `pytest.ini` 或扩展 `pyproject.toml` | 配置 `asyncio_mode = auto`、`addopts = -q --strict-markers`、`testpaths = backend/tests tests` |
| 1.12 | [NEW] | `.github/workflows/test.yml`（若使用 GH Actions） | CI 流水线：拉依赖 → `pytest --cov` → `yarn test` → `yarn test:e2e`（仅 main/cron） |

---

## 2. 后端 — `backend/`

| # | 类型 | 路径 | 说明 |
|---|------|------|------|
| 2.1 | [MOD] | `backend/tests/conftest.py` | 新增 `client` fixture（`httpx.AsyncClient` + `app.router.lifespan_context`）、`make_user` / `make_project` 工厂 fixture |
| 2.2 | [NEW] | `backend/tests/factories.py` | factory-boy 工厂集：UserFactory、ProjectFactory、WorkItemFactory、WorkflowFactory |
| 2.3 | [NEW] | `backend/tests/api/__init__.py` | 包标记 |
| 2.4 | [NEW] | `backend/tests/api/test_projects_api.py` | 覆盖 `backend/api/projects.py` 新增/修改路由 |
| 2.5 | [NEW] | `backend/tests/api/test_agents_api.py` | 覆盖 `backend/api/agents.py` |
| 2.6 | [NEW] | `backend/tests/api/test_remote_agents_api.py` | 覆盖新增 `backend/api/remote_agents.py` |
| 2.7 | [NEW] | `backend/tests/unit/test_a2a_client.py` | 用 `respx` 打桩外部 A2A 服务 |
| 2.8 | [NEW] | `backend/tests/unit/test_a2a_discovery.py` | 覆盖 `backend/services/a2a_discovery.py` |
| 2.9 | [MOD] | `backend/tests/test_workflow_engine.py` | 拆为更细粒度用例：节点执行、错误恢复、并发分支；引入参数化 |
| 2.10 | [MOD] | `backend/runtime/executor.py` 等被测代码 | 凡为测试拆出的接口需对外可注入依赖（构造函数注入或工厂函数），避免单测改动全局状态 |
| 2.11 | [NEW] | `tests/contract/test_a2a_contract.py` | 验证 A2A bridge 响应 schema 不破坏现有契约 |

---

## 3. 共享包 — `packages/`

| # | 类型 | 路径 | 说明 |
|---|------|------|------|
| 3.1 | [NEW] | `packages/core/src/__tests__/api/projects.test.ts` | 用 `msw` 拦截 fetch，覆盖 `packages/core/src/api/projects.ts` 的 happy / error path |
| 3.2 | [NEW] | `packages/core/src/__tests__/api/dashboard.test.ts` | 同上，针对 `dashboard.ts` |
| 3.3 | [NEW] | `packages/core/src/__tests__/hooks/use-work-items.test.tsx` | 覆盖 `useWorkItems` 的状态机：loading / success / error / refetch |
| 3.4 | [NEW] | `packages/core/src/__tests__/setup.ts` | `msw` server 启停、`fetch` polyfill |
| 3.5 | [NEW] | `packages/views/src/__tests__/kanban/ProjectBoard.test.tsx` | 看板列渲染、拖拽回调断言 |
| 3.6 | [NEW] | `packages/views/src/__tests__/kanban/BoardColumn.test.tsx` | 列空态、加载态 |
| 3.7 | [NEW] | `packages/views/src/__tests__/work-items/WorkItemBoard.test.tsx` | 过滤、排序行为 |
| 3.8 | [NEW] | `packages/views/src/__tests__/workflows/PropertyPanel.test.tsx` | 表单校验、保存回调 |
| 3.9 | [NEW] | `packages/views/src/__tests__/workflows/WorkflowCanvas.test.tsx` | 节点新增/删除/连线事件 |
| 3.10 | [NEW] | `packages/views/src/__tests__/dashboard/AgentPanel.test.tsx` | Agent 状态展示 |
| 3.11 | [NEW] | `packages/ui/src/__tests__/*.test.tsx` | 基础组件按需补齐（Button / Modal 等） |

---

## 4. Web 应用 — `apps/web/`

| # | 类型 | 路径 | 说明 |
|---|------|------|------|
| 4.1 | [NEW] | `apps/web/__tests__/setup.ts` | jest-dom + msw + Next router mock |
| 4.2 | [NEW] | `apps/web/__tests__/pages/projects.test.tsx` | 覆盖 `app/projects/page.tsx`：列表渲染、空态、错误态 |
| 4.3 | [NEW] | `apps/web/__tests__/pages/project-detail.test.tsx` | 覆盖 `app/projects/[id]/page.tsx` |
| 4.4 | [NEW] | `apps/web/__tests__/pages/work-items.test.tsx` | 覆盖 `app/work-items/page.tsx` |
| 4.5 | [NEW] | `apps/web/__tests__/pages/workflows-detail.test.tsx` | 覆盖 `app/workflows/[id]/page.tsx` |
| 4.6 | [NEW] | `apps/web/__tests__/pages/settings.test.tsx` | 覆盖 `app/settings/page.tsx` 与 `settings/remote-agents/` |
| 4.7 | [MOD] | `apps/web/next.config.ts` | 测试环境下 alias 与生产保持一致（如已设置可忽略） |

---

## 5. E2E — `tests/e2e/`

| # | 类型 | 路径 | 说明 |
|---|------|------|------|
| 5.1 | [NEW] | `tests/e2e/fixtures/seed.ts` | 通过后端 API 准备测试数据，测后清理 |
| 5.2 | [NEW] | `tests/e2e/smoke.spec.ts` | 冒烟：首页 → 登录 → 看到工作项 |
| 5.3 | [NEW] | `tests/e2e/work-items.spec.ts` | 创建/编辑/拖拽工作项 |
| 5.4 | [NEW] | `tests/e2e/workflow.spec.ts` | 画布建图 → 运行 → 校验结果状态 |
| 5.5 | [NEW] | `tests/e2e/README.md` | 本地启动指引、调试 tips |

---

## 6. 文档与流程

| # | 类型 | 路径 | 说明 |
|---|------|------|------|
| 6.1 | [NEW] | `docs/tdd/01-technical-solution.md` | 总体技术方案（已生成） |
| 6.2 | [NEW] | `docs/tdd/02-change-list.md` | 本文件 |
| 6.3 | [NEW] | `docs/tdd/03-test-cases.md` | 样例用例文档（含模板） |
| 6.4 | [MOD] | `DEVELOPMENT.md` | 增加"TDD 工作流"章节，链接到 `docs/tdd/` |
| 6.5 | [MOD] | `README.md` | 在"测试"段落添加 `yarn test` / `pytest` 入口 |
| 6.6 | [NEW] | `.github/PULL_REQUEST_TEMPLATE.md`（若无） | PR 模板要求填写"测试计划"段落 |

---

## 7. 风险与注意事项

- **数据库迁移**：`temp_db` 已隔离 SQLite，但若引入新外部依赖（Redis、对象存储等）需补对应 fixture。
- **前端 Next 服务端组件**：测试时仅覆盖客户端组件；服务端组件通过集成/E2E 验证。
- **CI 时长**：vitest + pytest 并行执行；E2E 默认仅 main 与 nightly 触发。
- **历史欠债**：采用增量覆盖率门禁（diff coverage），不强制提升全量覆盖率。
- **依赖注入改造**：第 2.10 项改造存量代码时务必保持向后兼容，分多次小 PR 进行。
