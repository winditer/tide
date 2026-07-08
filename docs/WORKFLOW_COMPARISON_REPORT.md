# Tide 项目"无工作流默认流程"与"正常工作流"完整对比分析

> 术语澄清（已更新）：本文的“无工作流默认流程”指 `flow_mode = default_workflow`（未显式绑定工作流时自动使用系统默认工作流），与现有的**自由协作模式（`flow_mode = freeform`）不同**。自由协作模式不绑定任何工作流，由 assignment 派生状态 + 评论式协作驱动，详见 [README.md 自由协作模式](README.md#自由协作模式freeform) 与 [ARCHITECTURE.md § 11A](ARCHITECTURE.md)。

## 执行摘要

本报告对 Tide 项目中两种工作项执行模式进行深入对比分析：
- **无工作流默认流程**：项目未绑定工作流时自动使用系统内建默认工作流（四阶段：分诊→执行→评审→合并）
- **正常工作流**：项目显式绑定自定义工作流进行执行

核心发现：两者共享同一个引擎基础设施但执行策略不同。默认流程是一条自动绑定的线性 DAG，正常工作流支持更丰富的节点类型和分支控制。

---

## 目录

1. [无工作流默认流程闭环](#1-无工作流默认流程闭环)
2. [正常工作流执行流程](#2-正常工作流执行流程)
3. [两者核心区别对比](#3-两者核心区别对比)
4. [完整代码位置映射](#4-完整代码位置映射)
5. [状态转移机制](#5-状态转移机制)
6. [数据库持久化](#6-数据库持久化)

---

## 1. 无工作流默认流程闭环

### 1.1 流程创建入口

**文件**：`backend/services/work_item_service.py` L512-623

工作项创建时的自动绑定逻辑：

```
create_work_item(data) 请求
  ↓
1. get_project_settings(project_id)
   检查项目是否已绑定工作流
   
   ├─ 若 workflow_id 存在
   │  └─ 使用已绑定的工作流（正常流程，跳过后续步骤 2）
   │
   └─ 若 workflow_id 为空
      ↓ 执行步骤 2
      
2. _find_default_workflow_id()
   查询 workflows 表：
   SELECT id FROM workflows WHERE enabled = 1
   ORDER BY is_system DESC, created_at ASC LIMIT 1
   
   ├─ 优先选 is_system=1 的内建工作流（DEFAULT_WORKFLOW）
   ├─ 如无内建工作流，选最早创建的 enabled 工作流
   └─ 若无任何工作流 → 返回 ValueError
   
3. set_project_workflow(project_id, workflow_id)
   UPSERT project_settings 表
   持久化绑定关系，下次创建不再触发自动绑定
   
4. _load_workflow_definition(workflow_id)
   从 workflows 表读取 definition JSON
   
5. _get_first_visible_node(definition)
   从 start 节点 BFS 跳过路由节点
   找到第一个可见节点（agent/approval/stage/delay）
   
6. INSERT work_items 记录
   设置 current_node_id 为首个可见节点
   记录 started_at = now
   
7. _record_transition(...)
   INSERT work_item_transitions
   from_node_id = NULL, to_node_id = 首个节点 ID
   trigger_type = "create"
   
8. _dispatch_node(item, first_node, definition)
   根据首个节点类型触发自动化（见下文）
   
9. ws_hub.broadcast("work_items", {...})
   广播工作项创建事件
```

### 1.2 默认工作流定义

**文件**：`backend/services/workflow_defaults.py` L1-80

系统内建的四阶段线性工作流：

```
┌─ start_1 ─┐
           ↓
      agent_triage (Codex)
      分诊并分析：
      • 理解需求
      • 拆解范围
      • 识别模块与关键文件
      • 给出实施方案
           ↓
      agent_execute (Codex)
      执行任务：
      • 完成代码实现
      • 确保逻辑正确
      • 风格与现有代码一致
           ↓
      approval_review (autoApprove: true)
      评审：
      • 自动审批（无需手工干预）
      • 存储审批结果到 context
           ↓
      git_merge
      合并：
      • 执行 git merge/squash/rebase
      • 支持冲突检测
           ↓
         end_1
      工作流完成
```

**节点数据示例**：

```python
{
  "id": "agent_triage",
  "type": "agent",
  "data": {
    "label": "Triage",
    "agentId": "codex",
    "promptTemplate": "分诊并分析当前工作项：理解需求、拆解范围、..."
  }
}
```

### 1.3 初始化阶段（Agent 节点触发）

当首个节点为 `agent_triage` 时：

**触发路径**：`work_item_service._dispatch_node()` L1064-1083 → `_safe_trigger_agent()` → `_trigger_agent_node()`

**文件**：`backend/services/work_item_service.py` L1188-1400

```
_trigger_agent_node(item, node)
  ↓
1. 数据提取
   • agent_id = "codex"
   • prompt_template = node.data.promptTemplate
   • model = None（使用 codex 默认模型）
   
2. worktree 隔离
   prepare_work_item_worktree(item_id, project_path)
   为该工作项创建独立 git worktree
   设置 branch_name = "tide/<item_id>"
   
3. prompt 渲染
   _render_prompt_template(template, item, context)
   支持 {{title}}、{{description}}、{context.node_id.output} 等占位符
   
4. 注入自动执行指令
   prompt = AUTO_EXEC_PREFIX + prompt
   前缀：确保 agent 在 full_auto 模式下自动执行
   
5. 创建 task 记录
   task_service.create_task(
     workspace_id="default",
     prompt=rendered_prompt,
     agent_id="codex",
     model=None,
     cwd=worktree_path,
     full_auto=True  ← 关键：全自动模式，不需用户确认
   )
   返回 task_id
   
6. 更新 task 表
   SET worktree_path, branch_name
   
7. 更新 transition 记录
   UPDATE work_item_transitions
   SET task_id = task_id  (链接 transition 和 task)
   
8. 启动轮询线程
   asyncio.create_task(self._wait_and_record_output(task_id))
   后台监听任务完成（事件驱动为主，轮询为兜底）
```

### 1.4 Agent 执行阶段（Task 生命周期）

**文件**：`backend/runtime/executor.py` L1-738

Agent CLI 流式执行过程：

```
AgentExecutor.run_agent(agent_id, prompt, cwd, ...)
  ↓
1. 启动子进程
   asyncio.create_subprocess_exec(agent_bin, ...)
   例如：codex run --full-auto --cwd /path/to/worktree
   
2. 流式读取 stdout JSON 事件
   逐行解析 TaskEvent：
   {
     "type": "started|output|tool_output|progress|completed|failed|...",
     "content": "...",
     "session_id": "xxx",
     "metadata": {...}
   }
   
3. 事件流处理
   • type="output" → 追加到 task.result
   • type="tool_output" → 记录工具调用过程
   • type="progress" → 更新进度
   • type="approval_request" → 触发审批流程
   • type="completed" → 标记 task 完成，调用 on_task_completed()
   • type="failed" → 记录错误，调用 on_task_failed()
   
4. 事件驱动回调
   on_task_completed(task_id, result, agent_final_output)
   ↓
   WorkflowEngine.on_task_completed(task_id, result)
   ↓
   工作项自动推进到下一节点
```

### 1.5 任务完成回调链

**文件**：`backend/services/work_item_service.py` L3718-3921

```
on_work_item_task_completed(task_id, result)
  ↓
1. 获取 task 记录
   SELECT agent_final_output FROM tasks WHERE id = :task_id
   （优先使用 agent_final_output，仅含 agent 回复，不含工具日志）
   
2. 找到关联的工作项与当前节点
   SELECT work_item_id, to_node_id FROM work_item_transitions
   WHERE task_id = :task_id AND work_item_id = :item_id
   
3. 获取工作项和工作流定义
   item = get_work_item(item_id)
   definition = _load_workflow_definition(item.workflow_id)
   
4. 验证节点未推进（防止并发重复）
   if item.current_node_id != transition.to_node_id:
     return  # 已推进过，忽略重复回调
   
5. 记录 output 到 transition
   UPDATE work_item_transitions
   SET output = result_text  (Agent 最终输出)
   
6. 加载下游节点
   downstream = _get_downstream_nodes(definition, current_node_id)
   next_node = downstream[0]
   
7. 自动推进工作项
   transition_work_item(
     item_id,
     next_node["id"],
     operator="system",
     trigger_type="agent_completed"
   )
```

### 1.6 节点间流转逻辑

**文件**：`backend/services/work_item_service.py` L807-898

transition_work_item() 执行完整流转：

```
transition_work_item(item_id, target_node_id, operator, trigger_type)
  ↓
1. 获取工作项当前状态
   item = get_work_item(item_id)
   from_node_id = item.current_node_id
   
2. 加载工作流定义
   definition = _load_workflow_definition(item.workflow_id)
   target_node = definition.nodes[target_node_id]
   
3. 验证目标节点合法性
   if trigger_type == "manual":
     验证不能从 end/cancel/error/close 节点拖出
   
4. 记录 transition
   INSERT work_item_transitions
   (from_node_id, to_node_id, trigger_type, operator, ...)
   
5. 更新 current_node_id
   UPDATE work_items
   SET current_node_id = target_node_id
   
   ├─ 若 target_node 是终态（end/cancel/error/close）
   └─ SET completed_at = now
   
6. 触发目标节点动作
   _dispatch_node(item, target_node, definition)
   
   根据节点类型分发：
   • agent → 启动新的 Agent 任务
   • approval → 创建审批记录
   • condition → 评估条件选择分支
   • delay → 延时后自动推进
   • git_merge → 执行 git 合并
   • 终态 → 标记工作项完成
   • stage → 工作项停留
   
7. WebSocket 广播
   ws_hub.broadcast("work_items", {
     "type": "work_item.transitioned",
     "from_node_id": from_node_id,
     "to_node_id": target_node_id,
     "trigger_type": trigger_type
   })
```

### 1.7 Agent 执行流程（分诊阶段具体示例）

默认工作流第一个 Agent 节点执行流程：

```
【分诊阶段】(agent_triage)
  ↓
生成的 prompt：
"系统指令：你现在在全自动模式下工作，无需用户确认，完成所有指令。
分诊并分析当前工作项：理解需求、拆解范围、识别涉及的模块与关键文件，
并给出清晰的实施方案。
---
工作项标题：{{ title }}
描述：{{ description }}
---
请生成一份分诊方案，保存为 .tide/分诊方案_<工作项ID>.md"
  ↓
Codex Agent 执行
• 分析工作项需求
• 查阅项目文件结构
• 生成实施方案文档到 worktree
• 返回总结文本
  ↓
输出样例：
"已完成分诊分析。
方案文件：.tide/分诊方案_abc123.md
核心步骤：
1. 修改 backend/services/xxx.py 中的 Handler 类
2. 更新 database schema 迁移脚本
3. 编写测试用例"
  ↓
on_task_completed() 回调触发
  ↓
自动推进到 agent_execute 节点
```

### 1.8 完整闭环示例：分诊→执行→评审→合并

```
【初始化】
工作项创建 → 当前节点 = agent_triage
  ↓
【分诊阶段】
_dispatch_node() → _trigger_agent_node() 
  ↓
启动 Codex: codex run --full-auto
  ↓
Agent 完成分诊 → on_task_completed()
  ↓
transition_work_item(item_id, agent_execute)
  ↓

【执行阶段】
当前节点 = agent_execute
  ↓
_dispatch_node() → _trigger_agent_node()
  ↓
启动 Codex，执行 prompt 中的步骤（修改代码、更新 schema 等）
  ↓
Agent 完成执行 → on_task_completed()
  ↓
transition_work_item(item_id, approval_review)
  ↓

【评审阶段】
当前节点 = approval_review
autoApprove=true 自动批准
  ↓
_dispatch_node() → _trigger_approval_node()
  ↓
创建审批记录 (status=pending)
  ↓
立即调用 on_approval_resolved(approved=true)
  ↓
transition_work_item(item_id, git_merge)
  ↓

【合并阶段】
当前节点 = git_merge
  ↓
_dispatch_node() → _safe_trigger_git_merge()
  ↓
执行 git merge 操作：
  • 从 tide/<item_id> 分支合并到 main
  • 处理冲突（可能需要手工解决）
  ↓
git merge 成功 → _advance_past_node()
  ↓
transition_work_item(item_id, end_1)
  ↓

【完成】
当前节点 = end_1（终态）
  ↓
UPDATE work_items SET completed_at = now
  ↓
工作项状态 = "completed"
  ↓
WebSocket 广播结束事件
```

### 1.9 前端结果展示

**文件**：`packages/core/src/hooks/use-chat.ts` L346-595

浮动聊天前端通过 WebSocket 监听任务完成事件：

```javascript
// WS 事件监听
onTaskStatusChanged = (event) => {
  const status = event.status  // "completed" | "failed" | "review" | ...
  
  if (status === "completed" || status === "approved") {
    // 获取任务最终结果
    const result = await getTask(event.task_id)
    
    // 更新聊天消息
    setMessages(prev => prev.map(m => {
      if (m.taskId !== event.task_id) return m
      return {
        ...m,
        status: "completed",
        content: result.result || "(任务已完成，无输出)"
      }
    }))
  }
  
  else if (status === "failed" || status === "rejected") {
    // 显示错误信息
    setMessages(prev => prev.map(m => {
      if (m.taskId !== event.task_id) return m
      return {
        ...m,
        status: "failed",
        content: result.result || "(任务执行失败)"
      }
    }))
  }
}
```

---

## 2. 正常工作流执行流程

### 2.1 工作流创建与配置

**文件**：`backend/api/workflows.py`、`backend/services/workflow_service.py`

用户通过 UI 创建自定义工作流：

```
POST /api/workflows
Body: {
  "workspace_id": "workspace-1",
  "name": "Custom CI/CD Pipeline",
  "definition": {
    "nodes": [
      {
        "id": "start_1",
        "type": "start"
      },
      {
        "id": "route_condition",
        "type": "condition",
        "data": {
          "field": "priority",
          "operator": "eq",
          "value": "high"
        }
      },
      {
        "id": "agent_high_priority",
        "type": "agent",
        "data": { "agentId": "codex", "prompt": "..." }
      },
      {
        "id": "agent_normal",
        "type": "agent",
        "data": { "agentId": "claude", "prompt": "..." }
      },
      ...
    ],
    "edges": [
      { "source": "start_1", "target": "route_condition" },
      { "source": "route_condition", "target": "agent_high_priority", "sourceHandle": "yes" },
      { "source": "route_condition", "target": "agent_normal", "sourceHandle": "no" },
      ...
    ]
  }
}
  ↓
WorkflowService.create()
  ↓
INSERT workflows 表
```

### 2.2 项目绑定工作流

**文件**：`backend/services/work_item_service.py` L4116-4140

用户在项目设置中选择工作流：

```
PUT /api/projects/{project_id}/settings
Body: { "workflow_id": "workflow-123" }
  ↓
WorkItemService.set_project_workflow(project_id, workflow_id)
  ↓
UPSERT project_settings
SET workflow_id = workflow_id
```

### 2.3 工作项创建时的工作流绑定

**文件**：`backend/services/work_item_service.py` L536-547

```
create_work_item(data)
  ↓
settings = get_project_settings(project_id)
  ↓
if settings.workflow_id exists:
  workflow_id = settings.workflow_id  ← 直接使用已绑定工作流
else:
  workflow_id = _find_default_workflow_id()  ← 自动绑定默认工作流
  set_project_workflow(project_id, workflow_id)
```

### 2.4 工作流运行的两条执行路径

Tide 支持两种工作流执行方式：

#### 路径 A：WorkflowEngine 驱动（通过 workflow_runs 表）

**文件**：`backend/services/workflow_engine.py` L76-400

用于全量自动化工作流运行：

```
WorkflowEngine.start_run(workflow_id, input_context, trigger_type)
  ↓
1. 从 workflows 表加载 workflow 定义
2. 创建 workflow_runs 记录
   INSERT workflow_runs
   (id, workflow_id, status='running', context, ...)
   
3. 为每个节点创建 workflow_node_runs 记录
   INSERT workflow_node_runs (status='pending')
   
4. 找到 start 节点的下游节点
5. 触发 _execute_node() 递归执行
   
6. 根据节点类型分发
   • start → 直接推进到下游
   • agent → 创建 task，等待 on_task_completed()
   • approval → 等待 on_approval_resolved()
   • condition → 评估条件选择分支
   • parallel → 派生多个并行任务
   • parallel_join → 等待所有上游完成
   • delay → asyncio.sleep()
   • stage → 跳过（工作项停留阶段）
   • 终态(end/cancel/error/close) → 标记工作流完成
```

#### 路径 B：WorkItemService 驱动（通过 work_items 表）

**文件**：`backend/services/work_item_service.py` L512-623、L1064-1083

用于工作项流程自动化：

```
work_item_service.create_work_item(data)
  ↓
与路径 A 相同的 workflow 加载与首节点触发
但使用 work_items.current_node_id 而非 workflow_runs.current_node_ids
每个工作项有一条独立的执行路径

优势：
• 工作项级粒度控制
• 可保持工作项停留在某个阶段
• 支持人工手动拖拽推进
• 与工作项看板深度集成
```

### 2.5 WorkflowEngine Agent 节点执行

**文件**：`backend/services/workflow_engine.py` L511-652

```
_execute_agent_node(run_id, node, context)
  ↓
1. 从 node 配置提取参数
   agent_id = node.data.agentId
   prompt_template = node.data.promptTemplate
   model = node.data.model
   
2. 专家团解析（可选）
   if node.data.expert_team_id:
     expert_team = ExpertTeamService.resolve_squad()
     agent_id = expert_team.agent_id
     skills = expert_team.skill_slugs + node.data.skills
     prompt = expert_team.role_prompt + prompt_template
   
3. 规则注入
   prompt = _build_prompt_with_rules(prompt)
   
4. 知识库注入
   prompt = _build_prompt_with_knowledge(prompt)
   
5. Skills 注入
   prompt = _build_prompt_with_skills(prompt, skill_slugs)
   
6. 上下文注入（远程 A2A Agent）
   if agent_id.startswith("a2a:"):
     upstream_outputs = _collect_upstream_outputs(run_id, node_id, context)
     prompt += "\n\n## 上游节点上下文\n" + upstream_outputs
   
7. 创建 task 记录
   INSERT tasks
   (workflow_run_id, workflow_node_id, ...)
   
8. 执行 Agent（fire-and-forget）
   asyncio.create_task(self._real_agent_execution(...))
   
9. 回调 on_task_completed()
   ↓
   _update_node_status(run_id, node_id, "completed")
   ↓
   _update_run_context(run_id, node_id, {"output": result})
   ↓
   _execute_next_nodes(run_id, node_id, context)
```

### 2.6 工作流节点间推进

**文件**：`backend/services/workflow_engine.py` L869-959

```
_execute_next_nodes(run_id, node_id, context)
  ↓
edges = definition.edges
outgoing = [e for e in edges if e.source == node_id]
  ↓
for each outgoing_node:
  await _execute_node(run_id, outgoing_node, context)
  ↓
  根据节点类型继续分发...
```

条件节点分支选择：

```
_execute_condition_node(run_id, node, context)
  ↓
1. 评估条件表达式
   field = context.get(node.data.field)
   operator = node.data.operator  ("eq", "gt", "lt", "contains", ...)
   value = node.data.value
   
   例如：context.priority == "high" ?
   
2. 选择出边
   ├─ 若 true → 找 sourceHandle="yes" 的边
   ├─ 若 false → 找 sourceHandle="no" 的边
   └─ 若都无 → 找标记为 "default" 的边
   
3. 推进到目标节点
   _execute_node(run_id, target_node, context)
```

### 2.7 审批节点与人工干预

**文件**：`backend/services/workflow_engine.py` L275-284

```
if node_type == "approval":
  await _update_node_status(run_id, node_id, "waiting_approval")
  
  await event_emitter.emit_approval_requested(
    task_id=run_id,
    approval_id=f"{run_id}:{node_id}",
    reason=node.data.label
  )
  
  # 等待 on_approval_resolved() 回调
  return
```

人工审批完成后的回调：

```
on_approval_resolved(run_id, node_id, approved, reason)
  ↓
if approved:
  _update_node_status(run_id, node_id, "completed", output="approved")
  _update_run_context(run_id, node_id, {"output": "approved"})
  _execute_next_nodes(run_id, node_id, context)
else:
  _update_node_status(run_id, node_id, "completed", output="rejected")
  
  on_failure = node.data.onFailure or "abort"
  if on_failure == "continue":
    _execute_next_nodes(run_id, node_id, context)
  else:
    _fail_run(run_id, "rejected")  ← 中止工作流
```

### 2.8 工作流运行的持久化与恢复

**数据库表**：`workflow_runs`、`workflow_node_runs`

```
workflow_runs:
  id: UUID
  workflow_id: UUID
  status: "running" | "completed" | "failed" | "cancelled"
  context: JSON  {
    "start": {"input": {...}},
    "node_1": {"output": "agent 结果"},
    "node_2": {"output": "审批: approved"}
  }
  current_node_ids: JSON ["node_3", "node_4"]  (并行节点)
  started_at: ISO datetime
  completed_at: ISO datetime

workflow_node_runs:
  id: UUID
  run_id: UUID (外键 → workflow_runs)
  node_id: string (对应 definition.nodes[].id)
  status: "pending" | "running" | "completed" | "failed" | "waiting_approval"
  task_id: UUID (可选，指向 tasks 表)
  output: string
  error: string (若失败)
  started_at: ISO datetime
  completed_at: ISO datetime
```

---

## 3. 两者核心区别对比

### 表格对比

| 维度 | 无工作流默认流程 | 正常工作流 |
|------|-----------------|----------|
| **流程触发** | 工作项创建时自动绑定 & 启动 | 显式绑定后，工作项创建或手工触发 |
| **表驱动** | `work_items` + `work_item_transitions` | `workflow_runs` + `workflow_node_runs` + `work_items` |
| **绑定规则** | 自动：无项目工作流 → 查默认工作流 → 持久化绑定 | 手工：项目设置中选择工作流 |
| **工作流定义** | 系统内建四阶段 DAG（线性） | 用户自定义，支持复杂分支 |
| **节点类型** | 仅 agent, approval, git_merge, end | agent, approval, condition, parallel, delay, stage, ... |
| **状态推导** | 从 `current_node_id` 推导 | 从 `current_node_ids` (并行) + `node_runs` 推导 |
| **并行支持** | 否（一次一个节点） | 是（parallel 网关） |
| **条件分支** | 否（固定线性流） | 是（condition 节点） |
| **审批策略** | autoApprove: true（自动通过） | 灵活：autoApprove/onFailure 可配置 |
| **Git 集成** | 支持，后续自动 merge | 支持，可多阶段、手工冲突解决 |
| **工作项看板** | 深度集成，可拖拽推进 | 可集成工作流阶段为看板列 |
| **失败处理** | 工作项停留，需人工干预 | 按 node.onFailure 策略：abort/continue/retry |
| **上下文传递** | 通过 work_item_transitions.output | 通过 workflow_runs.context 嵌套结构 |
| **持久化** | 轻量（无 runs 表） | 重度（workflow_runs + node_runs） |

### 3.1 触发方式差异

**无工作流默认流程**（被动自动）：

```
新建工作项请求
  ↓
检查项目 workflow_id
  ↓
若无 → 自动查询最早的 enabled 工作流
  ↓
持久化绑定到 project_settings
  ↓
工作项创建 → 立即启动工作流
```

**正常工作流**（主动绑定）：

```
用户在项目设置选择工作流
  ↓
UPSERT project_settings.workflow_id
  ↓
后续新建工作项 → 自动使用该工作流

或者：

工作流创建后显式启动
  ↓
workflow_engine.start_run(workflow_id)
  ↓
创建独立的 workflow_runs 记录
  ↓
与工作项无必然绑定关系
```

### 3.2 执行策略差异

**无工作流默认流程**（工作项驱动）：

- 每个工作项有独立的 `current_node_id`
- 状态严格序列化（一次一个节点）
- `_dispatch_node()` 按类型同步分发（实际通过 asyncio.create_task 异步执行，但逻辑上等待上个节点完成）
- 人工干预点：工作项停留某节点、手工拖拽推进、git merge 冲突

**正常工作流**（工作流驱动）：

- 单个工作流 run 可有多个 `current_node_ids`（并行）
- 状态可分支、合并、循环
- `_execute_node()` 递归触发下游，支持并行网关
- 人工干预点：审批决策（onFailure 策略）、git merge 冲突

### 3.3 上下文传递差异

**无工作流默认流程**：

```
Agent 输出 → work_item_transitions[].output
  ↓
下个 Agent 通过 _build_workflow_context() 重建 context
  ↓
context = {
  "title": item.title,
  "description": item.description,
  "agent_triage": {"output": "分诊结果"},
  "agent_execute": {"output": "执行结果"}
}
```

**正常工作流**：

```
Agent 输出 → workflow_runs.context[node_id].output
  ↓
原生支持嵌套结构和多层路径
  ↓
context = {
  "start": {"input": {...}},
  "condition_1": {"output": "yes"},
  "agent_high_priority": {"output": "...", "agent_final_output": "..."},
  "approval_review": {"output": "approved"}
}
  ↓
下游节点直接引用 {node_id.output}，无需重建
```

### 3.4 持久化与恢复

**无工作流默认流程**：

```
数据库最小化
• work_items (主记录)
• work_item_transitions (执行历史)
• tasks (Agent 任务记录)

丢失工作流执行上下文时的恢复：
  需通过 work_item_transitions 的 output 字段重建
```

**正常工作流**：

```
专用表支持完整恢复
• workflow_runs (工作流运行实例)
• workflow_node_runs (每个节点的执行记录)
• tasks (Agent 任务记录)

服务重启后的恢复：
  _ensure_run_loaded(run_id)
  从 DB 重建 runs 缓存，无缝继续执行
  
  if not await self._ensure_run_loaded(run_id):
    logger.error("run %s not found in cache or DB", run_id)
    return
```

---

## 4. 完整代码位置映射

### 4.1 无工作流默认流程关键路径

| 功能 | 文件 | 行号 | 描述 |
|-----|-----|------|-----|
| **默认工作流定义** | `backend/services/workflow_defaults.py` | 1-80 | 内建四阶段 DAG |
| **自动查找默认工作流** | `backend/services/work_item_service.py` | 458-475 | `_find_default_workflow_id()` |
| **工作项创建与自动绑定** | `backend/services/work_item_service.py` | 512-623 | `create_work_item()` |
| **工作流定义加载** | `backend/services/work_item_service.py` | 477-487 | `_load_workflow_definition()` |
| **首节点检测** | `backend/services/work_item_service.py` | 356-393 | `_get_first_visible_node()` |
| **节点分发** | `backend/services/work_item_service.py` | 1064-1083 | `_dispatch_node()` |
| **Agent 节点触发** | `backend/services/work_item_service.py` | 1188-1400 | `_trigger_agent_node()` |
| **流转执行** | `backend/services/work_item_service.py` | 807-898 | `transition_work_item()` |
| **任务完成回调** | `backend/services/work_item_service.py` | 3718-3921 | `on_work_item_task_completed()` |
| **Context 构建** | `backend/services/work_item_service.py` | 1784-1840 | `_build_workflow_context()` |

### 4.2 正常工作流关键路径

| 功能 | 文件 | 行号 | 描述 |
|-----|-----|------|-----|
| **工作流启动** | `backend/services/workflow_engine.py` | 84-200 | `start_run()` |
| **工作流创建** | `backend/api/workflows.py` | - | POST /api/workflows |
| **节点执行分发** | `backend/services/workflow_engine.py` | 230-330 | `_execute_node()` |
| **Agent 节点执行** | `backend/services/workflow_engine.py` | 511-652 | `_execute_agent_node()` |
| **条件节点处理** | `backend/services/workflow_engine.py` | 700-800 | `_execute_condition_node()` |
| **审批节点等待** | `backend/services/workflow_engine.py` | 275-284 | approval 处理 |
| **并行网关** | `backend/services/workflow_engine.py` | 294-310 | parallel / parallel_join |
| **任务完成回调** | `backend/services/workflow_engine.py` | 871-900 | `on_task_completed()` |
| **审批决策回调** | `backend/services/workflow_engine.py` | 914-954 | `on_approval_resolved()` |
| **Git merge 回调** | `backend/services/workflow_engine.py` | 956-1050 | `on_merge_resolved()` |
| **下游节点推进** | `backend/services/workflow_engine.py` | 1051-1100 | `_execute_next_nodes()` |

### 4.3 前端展示层

| 功能 | 文件 | 行号 | 描述 |
|-----|-----|------|-----|
| **WS 任务监听** | `packages/core/src/hooks/use-chat.ts` | 346-595 | `updateAssistantFromTask()` |
| **产物提取** | `packages/core/src/hooks/use-chat.ts` | 64-127 | `extractArtifactsFromContent()` |
| **浮动聊天面板** | `packages/views/src/dashboard/FloatingChat.tsx` | 109-400+ | FloatingChat 组件 |
| **工作项看板** | `backend/services/kanban_service.py` | - | 工作项阶段显示 |
| **工作流节点展示** | `packages/views/src/workflows/WorkflowCanvas.tsx` | - | 工作流可视化编辑 |

### 4.4 数据库表设计

| 表名 | 用途 | 关键字段 |
|-----|------|---------|
| `work_items` | 工作项主记录（两种流程共用） | id, project_id, workflow_id, current_node_id, completed_at |
| `work_item_transitions` | 工作项流转历史（默认流程关键表） | work_item_id, from_node_id, to_node_id, output, trigger_type, task_id |
| `workflow_runs` | 工作流运行实例（正常流程关键表） | id, workflow_id, status, context, current_node_ids |
| `workflow_node_runs` | 工作流节点运行记录 | run_id, node_id, status, output, task_id |
| `workflows` | 工作流定义 | id, definition (JSON), enabled, is_system |
| `project_settings` | 项目工作流绑定 | project_id, workflow_id |
| `tasks` | Agent 任务记录 | id, workflow_run_id, workflow_node_id, status, result |

---

## 5. 状态转移机制

### 5.1 无工作流默认流程的状态机

```
                    ┌─────────────────────┐
                    │  工作项创建         │
                    └──────────┬──────────┘
                               ↓
                    ┌─────────────────────┐
                    │ current_node_id =   │
                    │ agent_triage        │
                    │ status = pending    │
                    └──────────┬──────────┘
                               ↓
                    ┌─────────────────────┐
         ┌─────────→│ Agent 启动          │←─────┐
         │          │ status = in_progress│      │
         │          └──────────┬──────────┘      │
         │                     ↓                  │
         │          ┌─────────────────────┐      │
         │          │ Agent 运行中        │      │
         │          └──────────┬──────────┘      │
         │                     ↓                  │
         │          ┌─────────────────────┐      │
         │          │ agent_completed     │      │
         │          │ 触发回调            │      │
         │          └──────────┬──────────┘      │
         │                     ↓                  │
         │          ┌─────────────────────┐      │
         │          │ transition 到下个   │      │
         │          │ current_node_id =   │      │
         │          │ agent_execute       │      │
         │          └──────────┬──────────┘      │
         │                     ↓                  │
         │          ┌─────────────────────┐      │
         │          │ Agent 再次启动      │      │
         │          └──────────┬──────────┘      │
         └──────────────────────┴────────────────┘
                               ↓
                    ┌─────────────────────┐
                    │ ... 循环流转 ...    │
                    │ agent_triage        │
                    │   ↓                 │
                    │ agent_execute       │
                    │   ↓                 │
                    │ approval_review     │
                    │ (autoApprove)       │
                    │   ↓                 │
                    │ git_merge           │
                    │   ↓                 │
                    │ end_1               │
                    │ (terminal)          │
                    └──────────┬──────────┘
                               ↓
                    ┌─────────────────────┐
                    │ status = completed  │
                    │ completed_at = now  │
                    └─────────────────────┘
```

### 5.2 正常工作流的状态机

```
    workflow_runs.status = "running"
    workflow_runs.current_node_ids = []
               ↓
    ┌──────────────────────────┐
    │ 加载工作流定义           │
    │ 初始化所有 node_runs     │
    └──────────┬───────────────┘
               ↓
    ┌──────────────────────────┐
    │ 执行 start 节点          │
    │ node_runs[start].status  │
    │  = "completed"           │
    └──────────┬───────────────┘
               ↓
    ┌──────────────────────────┐
    │ 推进到下游（可能多个）    │
    │ current_node_ids = [id1] │
    └──────────┬───────────────┘
               ↓
    ┌──────────────────────────┐
    │ 根据节点类型分发         │
    │                          │
    ├─ agent → 创建 task       │
    │  node_runs.status =      │
    │   "running"              │
    │  等待 on_task_completed()│
    │                          │
    ├─ approval → 创建审批     │
    │  node_runs.status =      │
    │   "waiting_approval"     │
    │  等待 on_approval_res()  │
    │                          │
    ├─ condition → 评估条件    │
    │  node_runs.status =      │
    │   "completed"            │
    │  选择分支推进            │
    │                          │
    ├─ parallel → 派生并行任务 │
    │  current_node_ids =      │
    │   [id1, id2, ...]        │
    │                          │
    ├─ terminal → 标记完成     │
    │  workflow_runs.status =  │
    │   "completed"            │
    └──────────┬───────────────┘
               ↓
    ┌──────────────────────────┐
    │ 工作流完成              │
    │ workflow_runs.status =   │
    │  "completed"            │
    │ completed_at = now      │
    └──────────────────────────┘
```

### 5.3 工作项状态推导

**文件**：`backend/services/work_item_service.py` L250-300

```python
def _derive_node_status(node_type, has_completed) -> str:
    """
    从节点类型和完成状态推导工作项整体状态
    """
    if has_completed:
        return "completed"
    
    # 根据当前所在节点类型推导
    if node_type == "agent":
        return "in_progress"
    elif node_type == "approval":
        return "pending_approval"
    elif node_type == "delay":
        return "waiting"
    elif node_type in ("end", "close"):
        return "completed"
    elif node_type in ("cancel", "error"):
        return "failed"
    else:  # stage, start, condition 等
        return "pending"
```

---

## 6. 数据库持久化

### 6.1 默认流程的数据库序列

```sql
-- 1. 自动查询默认工作流
SELECT id FROM workflows 
WHERE enabled = 1 
ORDER BY is_system DESC, created_at ASC LIMIT 1
→ workflow_id = "default-workflow-123"

-- 2. 绑定到项目
UPSERT project_settings 
SET workflow_id = "default-workflow-123" 
WHERE project_id = "proj-xyz"

-- 3. 创建工作项
INSERT INTO work_items 
(id, project_id, workflow_id, current_node_id, started_at, created_at, ...)
VALUES ("item-1", "proj-xyz", "default-workflow-123", "agent_triage", now, now)

-- 4. 记录首次流转
INSERT INTO work_item_transitions 
(id, work_item_id, from_node_id, to_node_id, trigger_type, operator, created_at)
VALUES ("trans-1", "item-1", NULL, "agent_triage", "create", "system", now)

-- 5. 创建 Agent 任务
INSERT INTO tasks 
(id, workspace_id, prompt, agent_id, status, cwd, ...)
VALUES ("task-1", "default", "prompt text", "codex", "running", "/path", ...)

-- 6. 更新 transition 的 task_id
UPDATE work_item_transitions 
SET task_id = "task-1" 
WHERE id = "trans-1"

-- 7. Agent 完成后更新 transition 输出
UPDATE work_item_transitions 
SET output = "Agent output text" 
WHERE id = "trans-1"

-- 8. 流转到下个节点
INSERT INTO work_item_transitions 
(id, work_item_id, from_node_id, to_node_id, trigger_type, operator, created_at)
VALUES ("trans-2", "item-1", "agent_triage", "agent_execute", "agent_completed", "system", now)

UPDATE work_items 
SET current_node_id = "agent_execute" 
WHERE id = "item-1"

-- ... 循环步骤 5-8 ...

-- 最后到达终态
UPDATE work_items 
SET current_node_id = "end_1", completed_at = now 
WHERE id = "item-1"
```

### 6.2 正常工作流的数据库序列

```sql
-- 1. 创建工作流定义
INSERT INTO workflows 
(id, workspace_id, name, definition, enabled, ...)
VALUES ("wf-1", "ws-1", "Custom Pipeline", '{nodes: [...], edges: [...]}', 1, ...)

-- 2. 绑定到项目（可选）
UPSERT project_settings 
SET workflow_id = "wf-1" 
WHERE project_id = "proj-xyz"

-- 3. 启动工作流运行
INSERT INTO workflow_runs 
(id, workflow_id, workspace_id, status, current_node_ids, context, ...)
VALUES ("run-1", "wf-1", "ws-1", "running", '[]', '{}', ...)

-- 4. 初始化所有节点运行记录
INSERT INTO workflow_node_runs 
(id, run_id, node_id, status) VALUES 
("nrun-1", "run-1", "start_1", "pending"),
("nrun-2", "run-1", "condition_1", "pending"),
("nrun-3", "run-1", "agent_1", "pending"),
...

-- 5. 执行 start 节点
UPDATE workflow_node_runs 
SET status = "completed" 
WHERE run_id = "run-1" AND node_id = "start_1"

-- 6. 推进到 condition 节点
UPDATE workflow_runs 
SET current_node_ids = '["condition_1"]' 
WHERE id = "run-1"

-- 7. 创建 Agent 任务
INSERT INTO tasks 
(id, workspace_id, workflow_run_id, workflow_node_id, ...)
VALUES ("task-1", "ws-1", "run-1", "agent_1", ...)

UPDATE workflow_node_runs 
SET task_id = "task-1", status = "running" 
WHERE run_id = "run-1" AND node_id = "agent_1"

-- 8. Agent 完成，更新输出
UPDATE workflow_node_runs 
SET status = "completed", output = "Agent result" 
WHERE run_id = "run-1" AND node_id = "agent_1"

-- 9. 更新工作流全局 context
UPDATE workflow_runs 
SET context = '{"start": {...}, "agent_1": {"output": "..."}}' 
WHERE id = "run-1"

-- 10. 推进下游节点
UPDATE workflow_runs 
SET current_node_ids = '["next_node"]' 
WHERE id = "run-1"

-- ... 循环 ...

-- 最后完成
UPDATE workflow_runs 
SET status = "completed", completed_at = now 
WHERE id = "run-1"
```

---

## 7. 关键特性对比总结

### 7.1 自动化程度

| 流程 | 自动化特性 | 手工干预点 |
|------|----------|---------|
| 无工作流默认 | • 自动查询 & 绑定工作流<br/>• 自动创建 worktree<br/>• Agent 全自动执行（full_auto=true）<br/>• 自动推进节点<br/>• 自动化审批（autoApprove=true） | • Git merge 冲突<br/>• 工作项拖拽（看板）<br/>• 任意位置回退/重做 |
| 正常工作流 | • 按工作流定义自动执行<br/>• 条件分支自动选择<br/>• 并行任务自动派发 | • 审批决策<br/>• Git merge 冲突<br/>• 工作流暂停 & 恢复 |

### 7.2 可观测性

**无工作流默认流程**：
- 工作项看板直观显示当前阶段
- work_item_transitions 表提供完整审计日志
- 前端浮动聊天展示实时 Agent 输出

**正常工作流**：
- workflow_runs 视图显示整个工作流拓扑
- workflow_node_runs 提供细粒度节点执行记录
- 条件分支与并行执行可视化展示

### 7.3 错误处理

**无工作流默认流程**：
```python
# Agent 失败
on_task_failed(task_id, error)
  ↓
工作项停留在当前节点
  ↓
需手工修复或重新推进
```

**正常工作流**：
```python
# Agent 失败
on_task_failed(task_id, error)
  ↓
根据 node.data.onFailure 策略
  ├─ "abort" (默认) → 停止工作流，标记 failed
  ├─ "continue" → 跳过失败，继续下游
  └─ "retry" → 重试（可配合指数退避）
```

---

## 总结

### 核心架构

两种流程都构建于同一个 **DAG 执行引擎** 基础之上：

- **共同点**：
  - 都使用 workflow definition (nodes + edges) 定义流程
  - 都通过事件驱动回调推进节点
  - 都支持 Agent、审批、Git 集成
  - 都持久化到数据库，支持服务重启恢复

- **区别点**：
  - **无工作流默认流程**更轻量，工作项级粒度，与看板深度集成
  - **正常工作流**功能丰富，支持复杂分支与并行，专业化编排能力

### 选型建议

| 场景 | 推荐方案 |
|------|---------|
| 快速启动，内建四阶段流程满足需求 | 无工作流默认流程 |
| 需要复杂分支、条件判断、并行执行 | 正常工作流 |
| 需要人工审批关卡 | 正常工作流（支持灵活 onFailure 策略） |
| 需要工作项看板管理 | 无工作流默认流程（深度集成） |
| 跨项目编排（项目组） | 正常工作流 + Plan 多任务派发 |

