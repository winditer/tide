# 汇总测试报告生成代码参考

## 核心代码位置

### 主方法
- **`_collect_plan_subtask_artifacts()`** - 行 3881-4250
  - 收集子任务产物并生成汇总测试报告

### 关键方法

| 方法名 | 行号 | 功能 |
|--------|------|------|
| `_collect_plan_subtask_artifacts()` | 3881 | 主方法：收集产物+生成汇总 |
| `_extract_test_report_section()` | 4256 | 从agent_final_output中提取测试报告段落 |
| `_build_test_summary_prompt()` | 4590 | 构建AI汇总分析prompt |
| `_generate_static_summary_report()` | 4285 | 静态Fallback方案 |

## 数据流及关键代码片段

### 执行统计收集（问题1来源）

**代码位置**：行 3930-3963

问题：SQL查询结果为空时，execution_stats保持初始值 {total: 0, ...}

### 代码改动文件收集（问题2来源）

**代码位置**：行 4016-4043

问题：`_get_commit_changed_files()` 返回的文件路径格式可能有问题

### 测试报告段落提取（问题4来源）

**代码位置**：行 4045-4058

问题：仅依赖 `agent_final_output`，不读取实际的 `docs/*-测试报告.md` 文件

## 关键SQL查询

### 获取Plan及子任务

```sql
-- 查询plan_id（从task表）
SELECT plan_id, worktree_path FROM tasks WHERE id = :id;

-- 查询子任务列表
SELECT t.id, t.cwd, t.worktree_path, t.branch_name, t.agent_final_output
FROM tasks t
JOIN plan_tasks pt ON pt.task_id = t.id
WHERE pt.plan_id = :plan_id
ORDER BY pt.task_index;

-- 查询执行统计（有问题的查询）
SELECT pt.task_index, pt.title, pt.description, pt.status,
       t.status as task_status, t.created_at, t.completed_at
FROM plan_tasks pt
LEFT JOIN tasks t ON pt.task_id = t.id
WHERE pt.plan_id = :plan_id
ORDER BY pt.task_index;
```

问题：`plan_tasks` 表无 `title` 和 `description` 字段

## 调用链路

```
_on_task_completed() [plan_merge_completed 节点]
    ↓
_collect_plan_subtask_artifacts(item_id, task_id)
    ├─ 查询 plan_id
    ├─ 收集执行统计
    ├─ 收集变更文件
    ├─ 提取测试报告
    ├─ 读取技术方案
    ├─ 构建AI Prompt
    ├─ 调用AI生成
    └─ 写入并提交
```

## 快速定位问题的日志关键词

```bash
grep -i "ERROR\|Exception" tide.log | grep "work_item\|test.*report"
grep "_collect_plan_subtask_artifacts\|AI-generated summary" tide.log
grep "820195fc" tide.log | grep -i "test\|report\|artifact"
```
