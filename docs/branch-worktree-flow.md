# Tide 分支与 Worktree 流转机制

> 本文档详细描述 Tide 系统中工作项分支、Plan 子任务分支、Git Merge 节点的完整创建、合并和流转生命周期。

---

## 一、工作项分支与 Worktree 生命周期

### 创建时机

工作流中 **Agent 节点**触发时（`_trigger_agent_node`），若配置 `useWorktree = true`，调用 `prepare_work_item_worktree` 创建独立工作树。

### 命名规则

| 属性 | 规则 |
|------|------|
| **Worktree 路径** | `{项目根}/.tide/worktrees/wi-{work_item_id安全化[:8]}` |
| **分支名** | `tide/wi-{work_item_id安全化[:8]}` |
| **基点策略** | `main` → `master` → `HEAD`（优先级递减） |

### 流程

```
工作流触发
    ↓
_trigger_agent_node
    ↓
┌─ useWorktree = true? ─┐
│ Yes                     │ No
↓                         ↓
prepare_work_item_worktree  直接主分支工作（branch_name = NULL）
    ↓
┌─ Worktree 已存在? ─┐
│ Yes（复用）          │ No
↓                      ↓
                       检测基点分支（main → master → HEAD）
                          ↓
                       git worktree add .tide/worktrees/wi-{id[:8]}
    ↓
分支: tide/wi-{id[:8]}
    ↓
branch_name + worktree_path 持久化 → tasks 表
    ↓
Agent 执行开发任务
```

### 关键特性

- **支持复用**：若 worktree 已存在（`.git` 目录可见），直接复用，不重复创建
- **持久化**：`worktree_path` 和 `branch_name` 写入 `tasks` 表
- **关联**：通过 `work_item_transitions.task_id` 与工作项关联

---

## 二、Plan 子任务分支与 Worktree 生命周期

### 创建时机

Plan 子任务执行前（`_run_plan_task`），若启用 `PLAN_USE_WORKTREES`，调用 `prepare_plan_worktree` 创建独立工作树。

### 命名规则

| 属性 | 规则 |
|------|------|
| **Worktree 路径** | `{项目根}/.tide/worktrees/pl-{plan_id安全化}-{task_id安全化}` |
| **分支名** | `tide/{plan_id安全化}-{task_id安全化[:8]}` |
| **基点策略** | `main` → `master` → `HEAD`（同工作项） |

### 流程

```
Plan 执行启动
    ↓
_run_plan_task
    ↓
prepare_plan_worktree
    ↓
┌─ Worktree 已存在? ─┐
│ Yes（复用）          │ No
↓                      ↓
                       检测基点分支（main → master → HEAD）
                          ↓
                       git worktree add .tide/worktrees/pl-{plan_id}-{task_id}
    ↓
分支: tide/{plan_id}-{task_id[:8]}
    ↓
branch_name + worktree_path 持久化 → tasks 表
    ↓
Agent 执行 Plan 子任务
    ↓
由 Git Merge 节点统一合并并清理
```

### 数据关联路径

```
work_item_transitions.task_id
    → tasks.plan_id
        → plan_tasks.task_id
            → tasks（Plan 子任务，含 branch_name）
```

---

## 三、Git Merge 节点 — 多分支合并与清理

Git Merge 节点负责将工作项的**所有相关分支**（包括工作项分支和 Plan 子任务分支）合并到目标分支，并在合并成功后统一清理 worktree。

### 目标分支（targetBranch）解析

优先级从高到低：

1. **显式配置**：`node.data.targetBranch`
2. **版本分支**：`release/{version_name}`（工作项设置了 `version_id` 时）
3. **工作项分支**：`tide/wi-{id[:8]}`（默认值）
4. **Fallback**：`main` / `master`

> 若版本分支不存在，系统自动检测 `main` 或 `master` 并基于其创建版本分支。

### 源分支收集（多分支合并）

Git Merge 节点收集所有需要合并的源分支：

| 优先级 | 来源 | 分支格式 |
|--------|------|----------|
| ① | 工作项分支（`work_item_transitions` + `tasks`） | `tide/wi-{id[:8]}` |
| ② | Plan 子任务分支（`plan_tasks` + `tasks`） | `tide/{plan_id}-{task_id}` |
| ③ | Fallback：`node.data.sourceBranch` / 默认分支 | 用户配置值 |

**处理规则**：
- 自动去重（`seen_branches` set）
- 排除与 `targetBranch` 相同的分支（避免 no-op）
- 工作项分支按 `created_at ASC` 排序
- Plan 子任务分支按 `task_index ASC` 排序

### 合并执行

```
收集所有源分支
    ↓
遍历每个源分支，逐一 merge 到 targetBranch
    ↓
┌─ 全部成功? ─────────────────────────┐
│ Yes                                   │ 部分/全部失败
↓                                       ↓
清理所有已合并分支的 worktree 和 branch   on_conflict=manual → 中止后续
推进到下游节点                            否则继续合并后续分支
```

### 合并策略

| 策略 | 说明 |
|------|------|
| `merge` | `git merge --no-ff`，保留完整提交历史 |
| `squash` | 压缩为单次提交 |
| `rebase` | 变基到目标分支 |

### 冲突处理

| 模式 | 行为 |
|------|------|
| `manual` | 遇到冲突时中止后续分支合并，暂停工作项等待手动解决 |
| `fail` | 记录失败但继续尝试合并其他分支，最终推进下游 |

### 清理机制

合并成功后，对所有已合并的分支执行清理：

| 分支类型 | 清理函数 |
|----------|----------|
| 工作项分支 | `cleanup_work_item_worktree` |
| Plan 子任务分支 | `cleanup_plan_worktree` |

**清理步骤**：
1. `git worktree remove --force <path>`
2. `git branch -D <branch_name>`
3. Fallback：若上述失败且路径在 `.tide/worktrees` 下，`shutil.rmtree`

### Metadata 记录

合并结果写入 `work_items.metadata`：

```json
{
  "git_merge_result": {
    "success": true,
    "merged_branches": [
      {"branch": "tide/wi-a1b2c3d4", "type": "work_item", "success": true},
      {"branch": "tide/plan123-task456", "type": "plan_task", "success": true}
    ],
    "target_branch": "main",
    "strategy": "merge",
    "auto_push": false,
    "timestamp": "2025-01-01T00:00:00Z"
  }
}
```

---

## 四、完整生命周期总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        工作项创建                                 │
└────────────────────────────────┬────────────────────────────────┘
                                 ↓
┌─────────────────────────────────────────────────────────────────┐
│  Agent 节点触发                                                  │
│  ├─ useWorktree=true → 创建 tide/wi-{id[:8]} 分支               │
│  └─ 执行开发任务（可能触发 Plan）                                 │
└────────────────────────────────┬────────────────────────────────┘
                                 ↓
┌─────────────────────────────────────────────────────────────────┐
│  Plan 子任务执行                                                 │
│  ├─ 每个子任务创建 tide/{plan_id}-{task_id} 分支                 │
│  └─ 独立 worktree 隔离执行                                      │
└────────────────────────────────┬────────────────────────────────┘
                                 ↓
┌─────────────────────────────────────────────────────────────────┐
│  Git Merge 节点                                                  │
│  ├─ 收集所有分支（工作项 + Plan 子任务）                          │
│  ├─ 逐一合并到 targetBranch                                      │
│  ├─ 清理所有 worktree 和分支                                     │
│  └─ 记录 metadata 并推进下游                                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 五、关键代码文件

| 文件 | 职责 |
|------|------|
| `backend/services/work_item_service.py` | `_trigger_git_merge_node` — Git Merge 节点主逻辑 |
| `backend/services/workflow_engine.py` | `_execute_git_merge_node` — 工作流引擎通用 Merge |
| `backend/runtime/git_utils.py` | Worktree 创建/清理、分支操作工具函数 |
| `backend/services/plan_executor.py` | Plan 子任务执行与分支写入 |

---

## 六、配置参考

### Agent 节点配置

```json
{
  "type": "agent",
  "data": {
    "useWorktree": true,
    "agentId": "codex",
    "promptTemplate": "..."
  }
}
```

### Git Merge 节点配置

```json
{
  "type": "git_merge",
  "data": {
    "targetBranch": "main",
    "mergeStrategy": "merge",
    "deleteSource": true,
    "onConflict": "fail",
    "autoPush": false
  }
}
```

> `targetBranch` 留空时自动使用版本分支或工作项分支。
