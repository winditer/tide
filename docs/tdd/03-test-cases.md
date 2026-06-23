# TDD 测试用例文档

> 配套《01-technical-solution.md》《02-change-list.md》。
> 给出每层的样例测试用例与"先写测试"的模板，团队据此扩展。

---

## 1. 用例编写规范

### 1.1 命名

- 文件：`test_<被测对象>.py` / `<Subject>.test.ts(x)`
- 用例：`test_<前置条件>_<动作>_<预期结果>` 或 `it('<should ...> when <condition>')`

### 1.2 结构 — AAA 模式

```
Arrange  准备数据 / mock
Act      调用被测对象
Assert   断言可观察结果
```

每个用例只断言一件事；多个断言意味着拆用例或表驱动。

### 1.3 Red → Green → Refactor 模板

```
1. 写一个失败测试（描述行为，而非实现）
2. 运行：确认失败原因符合预期
3. 写最小实现使其通过
4. 运行：确认绿
5. 重构：去重、命名、抽函数；保持绿
6. 提交：Commit 1 = 测试，Commit 2 = 实现，Commit 3（可选）= 重构
```

---

## 2. 后端用例

### 2.1 单元 — Service 层

文件：`backend/tests/unit/test_work_item_service_create.py`

```python
import pytest
from backend.services.work_item_service import WorkItemService


@pytest.mark.asyncio
async def test_create_work_item_with_valid_payload_returns_persisted_entity(
    db_session, make_project
):
    # Arrange
    project = await make_project()
    service = WorkItemService(db_session)

    # Act
    item = await service.create(
        project_id=project.id,
        title="Implement login",
        assignee_id=None,
    )

    # Assert
    assert item.id is not None
    assert item.title == "Implement login"
    assert item.status == "todo"


@pytest.mark.asyncio
async def test_create_work_item_with_empty_title_raises_validation_error(
    db_session, make_project
):
    project = await make_project()
    service = WorkItemService(db_session)

    with pytest.raises(ValueError, match="title"):
        await service.create(project_id=project.id, title="", assignee_id=None)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status",
    ["todo", "in_progress", "done"],
)
async def test_create_work_item_accepts_known_status(
    db_session, make_project, status
):
    project = await make_project()
    service = WorkItemService(db_session)

    item = await service.create(
        project_id=project.id,
        title="x",
        assignee_id=None,
        status=status,
    )

    assert item.status == status
```

### 2.2 API 集成

文件：`backend/tests/api/test_projects_api.py`

```python
import pytest


@pytest.mark.asyncio
async def test_get_projects_returns_empty_list_when_no_projects(client):
    resp = await client.get("/api/projects")
    assert resp.status_code == 200
    assert resp.json() == {"items": [], "total": 0}


@pytest.mark.asyncio
async def test_post_project_creates_and_returns_201(client):
    resp = await client.post(
        "/api/projects", json={"name": "New", "description": "desc"}
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["id"]
    assert body["name"] == "New"


@pytest.mark.asyncio
async def test_post_project_with_duplicate_name_returns_409(client, make_project):
    await make_project(name="Dup")
    resp = await client.post("/api/projects", json={"name": "Dup"})
    assert resp.status_code == 409
```

### 2.3 外部依赖打桩 — A2A Client

文件：`backend/tests/unit/test_a2a_client.py`

```python
import httpx
import pytest
import respx
from backend.runtime.a2a_client import A2AClient


@pytest.mark.asyncio
@respx.mock
async def test_discover_returns_agents_when_remote_responds_200():
    respx.get("https://a2a.example.com/agents").respond(
        200, json={"agents": [{"id": "a1", "name": "Coder"}]}
    )
    client = A2AClient(base_url="https://a2a.example.com")

    agents = await client.discover()

    assert len(agents) == 1
    assert agents[0].id == "a1"


@pytest.mark.asyncio
@respx.mock
async def test_discover_raises_when_remote_returns_5xx():
    respx.get("https://a2a.example.com/agents").respond(503)
    client = A2AClient(base_url="https://a2a.example.com")

    with pytest.raises(httpx.HTTPStatusError):
        await client.discover()
```

### 2.4 表驱动 — 工作流引擎节点

```python
@pytest.mark.asyncio
@pytest.mark.parametrize(
    "node_type,inputs,expected_status",
    [
        ("noop", {}, "succeeded"),
        ("merge", {"a": 1, "b": 2}, "succeeded"),
        ("fail-on-empty", {}, "failed"),
    ],
)
async def test_engine_executes_node_types(engine, node_type, inputs, expected_status):
    result = await engine.execute_node(node_type, inputs)
    assert result.status == expected_status
```

---

## 3. 共享包用例

### 3.1 API Client — `packages/core/src/api/projects.ts`

文件：`packages/core/src/__tests__/api/projects.test.ts`

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { fetchProjects } from '../../api/projects'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('fetchProjects', () => {
  it('returns parsed list when API responds 200', async () => {
    server.use(
      http.get('/api/projects', () =>
        HttpResponse.json({ items: [{ id: 'p1', name: 'A' }], total: 1 }),
      ),
    )

    const result = await fetchProjects()

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ id: 'p1', name: 'A' })
  })

  it('throws ApiError when API responds 500', async () => {
    server.use(http.get('/api/projects', () => new HttpResponse(null, { status: 500 })))

    await expect(fetchProjects()).rejects.toThrow(/500/)
  })
})
```

### 3.2 Hook — `useWorkItems`

文件：`packages/core/src/__tests__/hooks/use-work-items.test.tsx`

```tsx
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useWorkItems } from '../../hooks/use-work-items'

describe('useWorkItems', () => {
  it('starts in loading state then resolves to data', async () => {
    const { result } = renderHook(() => useWorkItems({ projectId: 'p1' }))

    expect(result.current.loading).toBe(true)

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.items).toBeInstanceOf(Array)
    expect(result.current.error).toBeNull()
  })

  it('exposes error when API fails', async () => {
    // 用 msw 让 /api/work-items 返回 500
    const { result } = renderHook(() => useWorkItems({ projectId: 'broken' }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).not.toBeNull()
  })
})
```

### 3.3 组件 — `BoardColumn`

文件：`packages/views/src/__tests__/kanban/BoardColumn.test.tsx`

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { BoardColumn } from '../../kanban/BoardColumn'

describe('<BoardColumn />', () => {
  it('renders title and item count', () => {
    render(<BoardColumn title="Todo" items={[{ id: '1', title: 'A' }]} onAdd={() => {}} />)
    expect(screen.getByRole('heading', { name: /todo/i })).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('calls onAdd when user clicks add button', async () => {
    const onAdd = vi.fn()
    render(<BoardColumn title="Todo" items={[]} onAdd={onAdd} />)

    await userEvent.click(screen.getByRole('button', { name: /add/i }))

    expect(onAdd).toHaveBeenCalledOnce()
  })

  it('renders empty state when items is empty', () => {
    render(<BoardColumn title="Todo" items={[]} onAdd={() => {}} />)
    expect(screen.getByText(/no items/i)).toBeInTheDocument()
  })
})
```

---

## 4. 前端页面用例

文件：`apps/web/__tests__/pages/projects.test.tsx`

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ProjectsPage from '../../app/projects/page'

describe('ProjectsPage', () => {
  it('shows loading skeleton on first render', () => {
    render(<ProjectsPage />)
    expect(screen.getByTestId('projects-skeleton')).toBeInTheDocument()
  })

  it('renders project cards after data loads', async () => {
    render(<ProjectsPage />)
    expect(await screen.findByText(/sample project/i)).toBeInTheDocument()
  })

  it('shows empty state CTA when no projects exist', async () => {
    // msw 让 /api/projects 返回 { items: [], total: 0 }
    render(<ProjectsPage />)
    expect(await screen.findByRole('button', { name: /create project/i })).toBeInTheDocument()
  })
})
```

---

## 5. E2E 用例

文件：`tests/e2e/work-items.spec.ts`

```ts
import { test, expect } from '@playwright/test'

test.describe('Work items board', () => {
  test('user can create and complete a work item', async ({ page }) => {
    await page.goto('/work-items')

    await page.getByRole('button', { name: /new work item/i }).click()
    await page.getByLabel(/title/i).fill('Write docs')
    await page.getByRole('button', { name: /save/i }).click()

    const card = page.getByRole('article', { name: /write docs/i })
    await expect(card).toBeVisible()

    await card.getByRole('button', { name: /mark done/i }).click()
    await expect(card).toHaveAttribute('data-status', 'done')
  })
})
```

---

## 6. 契约测试

文件：`tests/contract/test_a2a_contract.py`

```python
import pytest
from jsonschema import validate

DISCOVER_SCHEMA = {
    "type": "object",
    "required": ["agents"],
    "properties": {
        "agents": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["id", "name", "capabilities"],
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                    "capabilities": {"type": "array"},
                },
            },
        }
    },
}


@pytest.mark.asyncio
async def test_a2a_discover_payload_matches_schema(a2a_bridge_client):
    payload = await a2a_bridge_client.discover_raw()
    validate(instance=payload, schema=DISCOVER_SCHEMA)
```

---

## 7. 用例评审 Checklist

新增/修改用例前自检：

- [ ] 是先写测试再写实现吗（commit 顺序可证）？
- [ ] 用例名描述了行为而非实现细节？
- [ ] 是否只有一个断言主题？
- [ ] 是否避免了对内部私有状态的断言？
- [ ] 外部 IO 是否被打桩？
- [ ] 失败信息是否能让人定位问题（而非 `assert True`）？
- [ ] 是否覆盖了 happy path、边界、错误路径？
- [ ] 是否参数化以减少重复？
- [ ] 是否清理了测试副作用（DB、文件、定时器）？

---

## 8. 模板速查

### 8.1 Python pytest 用例模板

```python
@pytest.mark.asyncio
async def test_<subject>_<condition>_<expected>(<fixtures>):
    # Arrange
    ...

    # Act
    result = await <subject_under_test>(...)

    # Assert
    assert <observable>
```

### 8.2 TS / Vitest 用例模板

```ts
describe('<Subject>', () => {
  it('<should ...> when <condition>', async () => {
    // Arrange
    // Act
    // Assert
  })
})
```

### 8.3 Playwright 用例模板

```ts
test('<user goal>', async ({ page }) => {
  await page.goto('<route>')
  await page.getByRole('<role>', { name: /<name>/i }).click()
  await expect(page.getByText(/<feedback>/i)).toBeVisible()
})
```
