# 无工作流默认流程方案 - 快速参考

> 术语澄清（已更新）：本文的“无工作流默认流程”指 `flow_mode = default_workflow`（未绑定工作流时自动使用系统默认工作流）。若需真正无工作流的协作，请使用**自由协作模式（`flow_mode = freeform`）**，详见 [README.md 自由协作模式](README.md#自由协作模式freeform)。

## 核心流程图

```
工作项创建请求
    ↓
┌─────────────────────────────────────────────────────┐
│ WorkItemService.create_work_item()                   │
│ ↓                                                    │
│ 1. get_project_settings(project_id)                 │
│    ├─ 若存在 workflow_id → 使用已绑定的               │
│    └─ 若不存在 → 执行步骤 2                           │
│ ↓                                                    │
│ 2. _find_default_workflow_id()                       │
│    ├─ SELECT id FROM workflows                      │
│    ├─ WHERE enabled = 1                             │
│    ├─ ORDER BY created_at ASC, id ASC LIMIT 1       │
│    └─ 若无工作流 → 返回 400 错误                      │
│ ↓                                                    │
│ 3. set_project_workflow(project_id, workflow_id)    │
│    └─ UPSERT project_settings 持久化绑定              │
│ ↓                                                    │
│ 4. _load_workflow_definition(workflow_id)           │
│    └─ 加载 workflow DAG (nodes + edges)             │
│ ↓                                                    │
│ 5. _get_first_visible_node(definition)              │
│    └─ 找到第一个非 start 可见节点                      │
│ ↓                                                    │
│ 6. INSERT work_items (绑定 workflow_id)             │
│    └─ 记录初始状态转移                                │
│ ↓                                                    │
│ 7. _dispatch_node(item, first_node)                 │
│    └─ 根据节点类型触发自动化                          │
│ ↓                                                    │
│ 8. ws_hub.broadcast("work_items", {...})            │
│    └─ WebSocket 广播工作项创建事件                    │
└─────────────────────────────────────────────────────┘
    ↓
返回工作项对象
```

## 关键代码位置

### 工作项服务
- **文件**：`backend/services/work_item_service.py`
- **兜底查询**：L458-L474
- **自动绑定**：L535-L546
- **UPSERT 绑定**：L4116-L4140

### 工作流引擎
- **文件**：`backend/services/workflow_engine.py`
- **Agent 执行**：L511-L652
- **专家团集成**：L530-L552
- **A2A 支持**：L594-L603

### A2A 适配器
- **文件**：`backend/runtime/adapters.py`
- **执行器**：L1191-L1316
- **流式路径**：L1236-L1246
- **轮询路径**：L1248-L1315

### 数据库
- **迁移脚本**：`backend/db/engine.py`
- **表定义**：`backend/db/init.sql`
- **workflows 表**：L152-L163
- **remote_agents 表**：L329-L357
- **expert_teams 表**：L529-L544

### A2A Bridge
- **配置**：`a2a-bridge/config.py` (L76-156)
- **执行器**：`a2a-bridge/executor.py` (L62-130)
- **入口**：`a2a-bridge/main.py` (L112-149)

## 立即修复项

### 1. SQL 兜底查询（高优，< 5 分钟）

**文件**：`backend/services/work_item_service.py` L467-468

```python
# 改进前
SELECT id FROM workflows WHERE enabled = 1
 ORDER BY created_at ASC LIMIT 1

# 改进后
SELECT id FROM workflows WHERE enabled = 1
 ORDER BY created_at ASC, id ASC LIMIT 1
```

### 2. A2A 全局超时（高优，1-2 小时）

**文件**：`backend/services/workflow_engine.py`

在 `_execute_agent_node()` 中添加 deadline 保护：

```python
async def _execute_agent_node(self, run_id: str, node: dict, context: dict):
    # ... 现有代码 ...
    
    # 添加全局超时保护
    deadline = asyncio.get_event_loop().time() + AGENT_TIMEOUT_SECONDS
    
    # 创建带 deadline 的任务
    await asyncio.wait_for(
        self._real_agent_execution(...),
        timeout=AGENT_TIMEOUT_SECONDS
    )
```

## 环境变量配置

### 工作项服务
```bash
# 项目未绑定工作流时的兜底行为
WORKITEM_DEFAULT_FALLBACK=true  # 启用兜底
```

### A2A Bridge
```bash
# 服务监听
BRIDGE_HOST=0.0.0.0
BRIDGE_PORT=8720
BRIDGE_PUBLIC_URL=http://localhost:8720

# 认证
BRIDGE_API_KEY=your-secret-key

# 并发
BRIDGE_MAX_CONCURRENCY=5

# Agent 配置
CODEX_BIN=codex
CODEX_MODEL=auto
CODEX_TIMEOUT=600

CLAUDE_BIN=claude
CLAUDE_MODEL=claude-3-sonnet

QODER_BIN=qoder
QODER_MODEL=qoder-latest
```

## 测试覆盖清单

- [ ] `_find_default_workflow_id()` 无工作流返回 None
- [ ] `_find_default_workflow_id()` 仅选 enabled=1 工作流
- [ ] `create_work_item()` 自动绑定工作流到 project_settings
- [ ] `_execute_agent_node()` 专家团覆盖 agent_id/model
- [ ] A2AAdapter 流式执行路径
- [ ] A2AAdapter 非流式轮询 + 取消
- [ ] 项目组 agent_node 多 Task 派发
- [ ] 数据库迁移脚本幂等性

## 监控指标

### 应添加的 Prometheus 指标

```python
# Agent 执行
agent_execution_duration_seconds = Histogram(...)
agent_execution_failures_total = Counter(...)

# 工作流
workflow_run_duration_seconds = Histogram(...)
workflow_node_execution_duration_seconds = Histogram(...)

# 工作项
work_item_creation_duration_seconds = Histogram(...)
work_item_default_workflow_bindings_total = Counter(...)

# A2A Bridge
a2a_task_duration_seconds = Histogram(...)
a2a_task_failures_total = Counter(...)
a2a_concurrent_tasks = Gauge(...)
```

## 故障排查

### 症状 1：工作项创建返回 400

**可能原因**：
- 系统无 enabled 工作流
- project_settings 表损坏

**检查步骤**：
```sql
-- 检查是否存在 enabled 工作流
SELECT COUNT(*) FROM workflows WHERE enabled = 1;

-- 检查 project_settings
SELECT * FROM project_settings WHERE project_id = ?;
```

### 症状 2：A2A Agent 执行超时

**可能原因**：
- Bridge 服务不可达
- 轮询间隔过长
- 远程 Agent 卡顿

**检查步骤**：
```bash
# 检查 Bridge 健康状态
curl http://bridge-host:8720/health

# 查看 Bridge 日志
tail -f /var/log/a2a-bridge.log

# 检查 Agent 进程
ps aux | grep codex
```

### 症状 3：项目组工作项分派失败

**可能原因**：
- 项目组子项目列表为空
- 某个子项目工作流不存在
- Task 派发权限不足

**检查步骤**：
```sql
-- 检查项目组成员
SELECT * FROM project_group_members WHERE group_id = ?;

-- 检查子项目工作流
SELECT p.id, ps.workflow_id FROM projects p
LEFT JOIN project_settings ps ON ps.project_id = p.id
WHERE p.group_id = ?;
```

## 相关文档

- INVESTIGATION_REPORT.md — 完整调研报告
- ARCHITECTURE.md — 项目架构设计（L852-L878）
- backend/services/work_item_service.py — 源代码实现

## 联系与反馈

发现问题或有改进建议，请提交 Issue 或 Pull Request。

