# 测试报告汇总质量问题调研 - 快速导航

## 问题概述

工作项 820195fc（逆变器快照）的汇总测试报告存在4个质量问题：

| 问题 | 症状 | 严重程度 | 根本原因 |
|------|------|--------|--------|
| 1️⃣ 执行统计为0 | 报告显示 "总子任务数: 0"，但实际3个子任务已完成 | 🔴 高 | SQL查询失败或异常未处理 |
| 2️⃣ 功能模块泛泛 | "可能影响的功能模块"描述不具体 | 🟡 中 | 文件路径提取有格式问题 |
| 3️⃣ 测试用例无结果 | 测试用例列出但无Pass/Fail标记 | 🟡 中 | 输入prompt中缺少实际测试结果 |
| 4️⃣ 部置SQL缺失 | "部署前置条件"为空但子任务报告中有SQL要求 | 🔴 高 | 子任务测试报告文件未被读取 |

---

## 调研文档

### 1. 📋 主调研报告（推荐阅读）
**文件**: `TEST_REPORT_QUALITY_INVESTIGATION.md`

内容：
- 汇总报告实际内容分析
- 4个问题的深度根因分析
- AI Prompt模板完整说明
- 子项目测试报告收集逻辑
- 修复优先级和详细方案
- 代码流程总结

**快速导航**：
- 第一部分：报告内容分析（了解问题现象）
- 第二部分：问题深度分析（理解根本原因）
- 第五部分：修复建议（实施改进）

### 2. 🔗 代码参考指南
**文件**: `SUMMARY_REPORT_CODE_REFERENCE.md`

内容：
- 核心代码位置和行号
- 关键方法及其功能
- 数据流及代码片段
- 调用链路图
- 关键SQL查询
- 快速定位问题的日志关键词

**用途**：当需要定位具体代码位置或理解执行流程时查阅

### 3. 🤖 AI Prompt详细说明
**文件**: `AI_PROMPT_FOR_SUMMARY_REPORT.md`

内容：
- 完整的Prompt模板
- 各占位符数据来源和现状
- 工作项820195fc的实例数据
- Prompt的改进建议
- 调试Prompt的方法

**用途**：理解AI如何生成汇总报告，以及如何改进Prompt

---

## 核心代码位置

### 主方法
```
backend/services/work_item_service.py

_collect_plan_subtask_artifacts()    行 3881-4250    # 主方法
├─ 行 3930-3963  收集执行统计（问题1）
├─ 行 4016-4043  收集变更文件（问题2）
├─ 行 4045-4058  提取测试报告（问题4）
├─ 行 4121-4129  构建AI prompt
├─ 行 4162-4170  Fallback方案
└─ 行 4172-4250  保存和提交

_extract_test_report_section()      行 4256-4283    # 测试报告提取
_build_test_summary_prompt()        行 4590-4750    # Prompt构建
_generate_static_summary_report()   行 4285-4568    # 静态Fallback
```

---

## 快速问题定位

### 问题1：执行统计为0

**位置**: `work_item_service.py:3930-3963`

**诊断步骤**：
```bash
# 1. 查看是否有SQL异常
grep "failed to collect subtask summaries" tide.log

# 2. 检查plan_id是否正确
sqlite3 tide.db "SELECT plan_id FROM tasks WHERE id='820195fc-...';"

# 3. 验证plan_tasks表非空
sqlite3 tide.db "SELECT COUNT(*) FROM plan_tasks WHERE plan_id='20e93663-...';"
```

**修复方案**：
- 增强异常日志记录（添加 `exc_info=True`）
- 验证plan_id查询逻辑
- 确认 `summary_rows` 非空

---

### 问题2：功能模块描述泛泛

**位置**: `work_item_service.py:4016-4043`

**诊断步骤**：
```bash
# 1. 检查改动文件列表
grep "project_changed_files" tide.log

# 2. 验证文件路径格式
sqlite3 tide.db "SELECT * FROM work_items WHERE id='820195fc-...' LIMIT 1;" \
  | grep -o '"docs' | head -5
```

**修复方案**：
- 验证 `_get_commit_changed_files()` 返回格式
- 清理文件路径中的特殊字符和编码问题
- 调试git log命令输出

---

### 问题3：测试用例无结果

**位置**: `work_item_service.py:4701-4706` (Prompt要求)

**根本原因**：输入prompt中无实际测试执行结果

**修复方案**：
- 从子任务测试报告提取测试结果和通过情况
- 构建结构化的TC+result数据
- 更新Prompt要求基于实际结果生成

---

### 问题4：部署SQL缺失

**位置**: `work_item_service.py:4045-4058` (数据收集)

**诊断步骤**：
```bash
# 1. 查看实际的测试报告文件
find ~/.tide -name "*测试报告*.md" | xargs grep -l "CREATE\|INSERT\|SQL"

# 2. 确认agent_final_output内容
sqlite3 tide.db "SELECT substr(agent_final_output, 1, 500) FROM tasks WHERE id='c7c585fd-...';"
```

**修复方案**：
- 添加代码读取 `docs/*-测试报告.md` 文件
- 从文件中提取SQL/DDL前置条件
- 传给AI Prompt

---

## 3个子任务的实际产物

### 任务1: fms-server

**文件**: `docs/wi-820195fc-逆变器快照-fms-server-测试报告.md` (101行)

**关键内容**：
- ✅ 编译成功
- ✅ 单元测试3/3通过
- ⚠️ **权限表SQL未通过代码提交，需运维执行**
- ⚠️ **API契约要求对齐部署阶段权限配置**

### 任务2: fms-job

**文件**: `docs/wi-820195fc-逆变器快照-fms-job-测试报告.md` (77行)

**关键内容**：
- ✅ Maven编译成功
- ✅ 代码风格一致
- ⚠️ **表DDL需确认已在primary数据库创建**
- ⚠️ **需验证SQL Server分页语法兼容性**
- ⚠️ **大数据量场景下性能需验证**

### 任务3: fms-web

**文件**: `docs/wi-820195fc-逆变器快照-fms-web-测试报告.md` (57行)

**关键内容**：
- ✅ TypeScript编译成功
- ✅ 生产构建成功 (21.26s)
- ✅ 现有功能无回归

---

## 改进优先级

### P0（立即修复）
- [ ] 增强异常日志，定位问题1的真实原因
- [ ] 验证plan_id查询逻辑
- [ ] 测试修复后的执行统计是否显示3个子任务

### P1（核心改进）
- [ ] 从测试报告文件提取SQL/DDL前置条件
- [ ] 从测试报告提取测试执行结果（Pass/Fail）
- [ ] 改进Prompt中的功能模块分析逻辑

### P2（长期优化）
- [ ] 扩展plan_tasks表，添加title/description字段
- [ ] 创建test_reports表，持久化测试报告
- [ ] 增加Prompt中的约束条件和示例

---

## 验证修复的步骤

### 步骤1：环境准备
```bash
# 确保可以访问数据库和worktree
cd /Users/haifeng/Documents/tide
sqlite3 tide.db ".databases"
```

### 步骤2：执行P0修复
在 `work_item_service.py:3962` 修改：
```python
# 修改前
except Exception as exc:
    logger.warning("[work_item] failed to collect subtask summaries: %s", exc)

# 修改后
except Exception as exc:
    logger.error("[work_item] failed to collect subtask summaries for plan=%s: %s", 
                 plan_id[:8], exc, exc_info=True)
    
    # 添加诊断输出
    logger.info("[work_item] Attempting fallback count...")
    try:
        async with async_session_factory() as session:
            count_result = await session.execute(
                text("SELECT COUNT(*) FROM plan_tasks WHERE plan_id = :plan_id"),
                {"plan_id": plan_id}
            )
            plan_task_count = count_result.scalar() or 0
            logger.info("[work_item] plan %s has %d tasks in plan_tasks table", 
                       plan_id[:8], plan_task_count)
    except Exception as e2:
        logger.error("[work_item] Fallback count also failed: %s", e2)
```

### 步骤3：创建新工作项重新测试
创建类似的Plan+多项目工作项，观察是否修复了问题

### 步骤4：验证日志输出
```bash
tail -100 tide.log | grep -E "execution_stats|test-summary|AI-generated"
```

---

## 文件导航

```
/Users/haifeng/Documents/tide/docs/

├── TEST_REPORT_QUALITY_INVESTIGATION.md   ← 主调研报告（685行）
├── SUMMARY_REPORT_CODE_REFERENCE.md       ← 代码参考（375行）
├── AI_PROMPT_FOR_SUMMARY_REPORT.md        ← Prompt说明（773行）
├── INVESTIGATION_README.md                ← 本文件
│
└── 工作项820195fc相关文件：
    ├── wi-820195fc-逆变器快照-测试报告(汇总).md       ← 汇总报告（有问题）
    ├── wi-820195fc-逆变器快照-fms-server-测试报告.md ← 子任务1
    ├── wi-820195fc-逆变器快照-fms-job-测试报告.md    ← 子任务2
    └── wi-820195fc-逆变器快照-fms-web-测试报告.md    ← 子任务3
```

---

## 关键数据

### 数据库查询参考

```sql
-- 查看工作项和Plan
SELECT w.id, w.title, COUNT(pt.task_id) as task_count
FROM work_items w
LEFT JOIN tasks t ON w.id LIKE SUBSTR(t.id, 1, 8)
LEFT JOIN plan_tasks pt ON t.plan_id = pt.plan_id
WHERE w.id = '820195fc-974a-42e1-bc60-ae54ebf9f14d'
GROUP BY w.id;

-- 查看子任务状态
SELECT pt.task_index, t.id, t.status, t.agent_final_output
FROM plan_tasks pt
LEFT JOIN tasks t ON pt.task_id = t.id
WHERE pt.plan_id = '20e93663-050e-4996-8ff0-20ea01abd939'
ORDER BY pt.task_index;

-- 查看工作项产物
SELECT metadata FROM work_items WHERE id = '820195fc-974a-42e1-bc60-ae54ebf9f14d';
```

---

## 联系和问题

如有疑问，请参考：
1. 主调研报告的"根本原因"部分
2. 代码参考指南的"关键SQL查询"部分
3. Prompt说明的"调试方法"部分

