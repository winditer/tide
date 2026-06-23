# TDD 测试驱动开发 — 技术方案

> 适用范围：Tide 项目（FastAPI 后端 + Next.js / React 前端 + 共享 packages）
> 目标：以 Red → Green → Refactor 节奏交付可验证的增量，沉淀可回归的测试资产。

---

## 1. 背景与现状

Tide 当前已有的测试基础设施：

- 后端：`backend/tests/`，pytest + `pytest-asyncio`，`conftest.py` 提供 `temp_db` fixture 做每测试独立 SQLite 隔离（见 `backend/tests/conftest.py`）。
- 共享层：`packages/core`、`packages/views`、`packages/ui` 暂无统一测试入口。
- 前端：`apps/web` 暂无单元/组件测试。
- 集成测试：仅 `tests/test_lark_reference_context.py` 一例。

存在的问题：

1. 业务代码先于测试落地，测试常常是"事后补"，覆盖率失衡（service 层覆盖多、API/前端少）。
2. 缺少前端组件级测试与端到端 (E2E) 的最小回归套件。
3. 缺少 TDD 工作流的统一约束与 CI 红线。

---

## 2. TDD 工作流定义

### 2.1 核心节奏 — Red / Green / Refactor

| 步骤 | 动作 | 准入条件 |
|------|------|----------|
| Red | 先写一个**会失败**的测试，描述期望行为 | 测试运行报错或断言失败；失败原因符合预期（不是导入错误等假失败） |
| Green | 用**最小**实现让该测试通过 | 仅该测试由红转绿，其余测试不退化 |
| Refactor | 在测试保护下重构 | 所有相关测试全绿，无新增警告 |

每个增量循环 5–15 分钟为宜，单测试只断言一件事。

### 2.2 测试金字塔分层（建议比例）

```
            /\        E2E (Playwright)        ~5%
           /  \       —— 关键链路冒烟
          /----\
         /      \     集成测试 (FastAPI TestClient + Next.js route)  ~20%
        /        \    —— API 契约、跨模块协作
       /----------\
      /            \  单元测试 (pytest / vitest)  ~75%
     /              \ —— service / hook / 工具函数
    /________________\
```

### 2.3 何时不使用 TDD

- 一次性脚本、迁移类操作（`backend/scripts/`）。
- 纯样式/排版改动。
- spike / 原型探索阶段（探索完成后补测试再合入）。

---

## 3. 分层测试策略

### 3.1 后端 — Python / FastAPI

| 测试类型 | 工具 | 范围 | 命名 |
|----------|------|------|------|
| 单元 | pytest | `backend/services/*`、`backend/runtime/*` 纯函数与服务方法 | `test_<module>.py::test_<behavior>` |
| API 集成 | `httpx.AsyncClient` + `lifespan` | `backend/api/*` 路由 + DB | `test_api_<router>.py` |
| 数据层 | pytest + `temp_db` | SQL/模型层 | `test_db_<scope>.py` |

约定：

- 一律使用 `temp_db` fixture 隔离数据库，禁止直接读写 `tide.db`。
- 异步函数测试使用 `@pytest.mark.asyncio`。
- 外部 IO（HTTP / Lark / Git）通过 `monkeypatch` 或 `respx` 打桩。

### 3.2 共享包 — `packages/core`、`packages/views`、`packages/ui`

| 测试类型 | 工具 | 范围 |
|----------|------|------|
| 单元 | Vitest | hooks (`packages/core/src/hooks/*`)、API 客户端 (`packages/core/src/api/*`)、纯工具函数 |
| 组件 | Vitest + @testing-library/react | `packages/views/*`、`packages/ui/*` 的展示型组件 |

约定：

- 网络请求通过 `msw` 拦截，不真请求后端。
- 组件测试断言**用户可观察的输出**（文本、aria、可访问角色），避免对内部实现细节断言。

### 3.3 前端应用 — `apps/web`

| 测试类型 | 工具 | 范围 |
|----------|------|------|
| 页面/路由 | Vitest + @testing-library/react + Next 测试工具 | `apps/web/app/**/page.tsx` 的组件层逻辑 |
| E2E | Playwright | 关键链路：登录 → 创建工作项 → 看板拖拽 → 完成；工作流画布跑通 |

### 3.4 跨服务 — A2A / Lark

- `a2a-bridge/`、`backend/runtime/a2a_client.py`、`backend/services/a2a_discovery.py`：以 contract test（响应 schema 校验 + 双向打桩）覆盖，避免在 CI 中真连远端。

---

## 4. 目录与命名约定

```
backend/tests/
  unit/        # 纯函数 / 单服务
  api/         # FastAPI 路由集成
  db/          # 模型 / 迁移
packages/<pkg>/src/__tests__/
  *.test.ts(x)
apps/web/__tests__/
  unit/
  pages/
tests/
  e2e/         # Playwright 套件
  contract/    # A2A / Lark 契约测试
docs/tdd/      # 本方案
```

测试文件命名：`test_<被测对象>_<行为>.py` / `<Component>.test.tsx`。
测试用例命名：`test_<前置条件>_<动作>_<预期结果>`，例如
`test_create_work_item_with_duplicate_title_returns_409`。

---

## 5. 工程化落地

### 5.1 工具栈

| 层 | 引入 | 状态 |
|----|------|------|
| 后端 | `pytest`, `pytest-asyncio`, `pytest-cov`, `respx` | pytest 已有，其余需补 |
| 共享包 / 前端单元 | `vitest`, `@testing-library/react`, `@testing-library/user-event`, `jsdom`, `msw` | 待引入 |
| E2E | `@playwright/test` | 待引入 |
| Mock 数据 | `factory-boy` (py) / `@faker-js/faker` (ts) | 待引入 |

### 5.2 脚本（建议加入 `package.json` / `Makefile`）

```jsonc
{
  "scripts": {
    "test": "yarn workspaces foreach -A run test",
    "test:web": "yarn workspace @tide/web test",
    "test:e2e": "playwright test",
    "test:py": "pytest -q",
    "test:py:cov": "pytest --cov=backend --cov-report=term-missing"
  }
}
```

### 5.3 CI 红线

- 任一 PR 合并前：`yarn test` + `pytest` 全绿。
- 覆盖率：新增/修改代码行覆盖率 ≥ 80%（增量门禁，避免历史欠债阻塞）。
- E2E 仅在 main、release/* 与每日定时跑，PR 默认跳过以控耗时。

### 5.4 增量推进路线

1. **W1**：补 `backend/api/*` 当前未覆盖路由的契约测试；引入 `pytest-cov` 出基线报告。
2. **W2**：`packages/core` 引入 vitest，迁移 hooks 与 api client 测试。
3. **W3**：`apps/web` 引入 vitest + RTL，覆盖 `projects`、`work-items`、`workflows` 页面。
4. **W4**：Playwright E2E 冒烟套件，进 CI。
5. **W5**：A2A 契约测试 + 覆盖率门禁。

---

## 6. 验收标准

- 所有新增功能：先有失败测试 → 再有实现，PR 描述中体现 Red→Green 提交序列（可通过 commit 历史佐证）。
- `pytest` 与前端 `vitest` 在本地与 CI 上均可一键运行。
- `docs/tdd/03-test-cases.md` 中的样例用例可作为模板被复用。
- 关键链路 E2E 在 main 分支保持长期绿色。
