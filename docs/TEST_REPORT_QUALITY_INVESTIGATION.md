# 测试报告汇总质量问题调研报告

## 调研目标
分析工作项 820195fc（逆变器快照）的汇总测试报告存在的4个质量问题：
1. 测试执行结果：数据不全，执行统计缺失，子项目测试报告未搜集到
2. 回归影响分析：可能影响的功能模块没有有效输出
3. 验收测试用例：没有明确告诉测试用例是否成功
4. 部署与回滚：前置条件有SQL要执行但没有列出来

---

## 一、汇总报告的实际内容分析

### 报告位置
```
/Users/haifeng/.tide/users/6a7fc445-9ed4-4897-a225-711f24c047b4/fms-server/.tide/worktrees/wi-820195fc-974a-42e1-bc60-ae54ebf9f14d/docs/wi-820195fc-逆变器快照-测试报告(汇总).md
```

### 报告结构（9章）
- ✅ 1. Executive Summary - 有内容
- ✅ 2. 改动范围分析 - 有内容（表格格式）
- ⚠️ 3. 测试执行结果 - **问题1：执行统计为0**
- ✅ 4. 测试覆盖度分析 - 有内容
- ✅ 5. 风险评估矩阵 - 有内容
- ⚠️ 6. 回归影响分析 - **问题2：功能模块描述过于泛泛**
- ⚠️ 7. 验收测试用例 - **问题3：测试用例缺少验证结果**
- ⚠️ 8. 部署与回滚 - **问题4：前置SQL未列出**
- ✅ 9. 遗留问题与建议 - 无内容

---

## 二、问题深度分析

### 问题1：测试执行结果 - 执行统计数据为0

**症状**（第56-67行）：
```markdown
### 执行统计

| 指标 | 数量 |
|------|------|
| 总子任务数 | 0 |
| 已完成 | 0 |
| 失败 | 0 |
| 已取消 | 0 |

无子任务执行数据。
```

**根本原因**：
汇总报告的数据来源是SQL查询 `plan_tasks` 表，计算子任务执行状态：
```sql
SELECT pt.task_index, pt.title, pt.description, pt.status,
       t.status as task_status, t.created_at, t.completed_at
FROM plan_tasks pt
LEFT JOIN tasks t ON pt.task_id = t.id
WHERE pt.plan_id = :plan_id
```

**问题所在**：
1. `plan_tasks` 表**不包含 `title` 字段**（仅有：plan_id, task_id, task_index, phase, depends_on）
2. SQL查询 `pt.title, pt.description` 返回NULL
3. 但是子任务的**状态查询正常**（`t.status` 为 'committed'）

**代码位置**：
- `/Users/haifeng/Documents/tide/backend/services/work_item_service.py:3881-3963` - `_collect_plan_subtask_artifacts()` 方法

**关键代码片段**（第3944-3953）：
```python
execution_stats["total"] = len(summary_rows)  # 应该是 3
for sr in summary_rows:
    st = (sr.get("task_status") or sr.get("status") or "").lower()
    if st in ("completed", "done", "success"):
        execution_stats["completed"] += 1
    elif st in ("failed", "error"):
        execution_stats["failed"] += 1
    elif st in ("cancelled", "canceled"):
        execution_stats["cancelled"] += 1
```

**实际数据库情况**：
```
总子任务数: 3
子任务状态: committed, committed, committed
```

但报告显示为 0，说明 `summary_rows` 为空 或 `execution_stats` 初始化值未被更新。

**可能原因**：
1. SQL执行异常（被catch住后未记录）
2. `async_session_factory()` 获取失败
3. 汇总报告生成时 plan_id 查询错误

**验证**：在代码第3962-3963有Exception处理但仅记录warning，实际exception内容未输出。

---

### 问题2：回归影响分析 - 功能模块描述过于泛泛

**症状**（第109-120行）：
```markdown
## 6. 回归影响分析

### 可能影响的功能模块

- `"docs` 相关功能
- `"wi-820195fc-` 相关功能
- `src` 相关功能

### 建议回归范围

- 上述模块的核心功能流程
- 跨项目集成点（API 调用、数据同步）
```

**根本原因**：
这些文本由AI生成（prompt第4696-4699行），但输入的代码改动信息存在问题。

**根因分析**：
改动范围提取来自 `project_changed_files` 字典，其中包含的文件路径格式有问题：

从汇总报告的第2章改动范围分析可看到：
```
| "docs | `"docs/wi-820195fc-\351\200\206\345\217\230\345\231\250\345\277\253...
| "wi-820195fc- | `"wi-820195fc-...
```

这说明文件路径在某个环节被**误分割或错误编码**：
- `"docs` 本应是 `docs/` 但被误切割
- `"wi-820195fc-` 是不完整的字符串

**代码位置**：
- `work_item_service.py:4020-4043` - `project_changed_files` 收集逻辑
- `work_item_service.py:4620-4630` - prompt中changes_section构建

**改动文件提取来源**：
```python
for sub_idx, sub in enumerate(subtask_rows):
    # 从各子任务的git log获取changed_files
    changed = await self._get_commit_changed_files(sub_wt, commit_hash)
    project_changed_files[project_name].extend(changed)
```

问题可能在于：
1. 文件路径中包含特殊字符或编码问题
2. 文件名过长被截断
3. 测试报告文件本身被错误识别为改动文件

---

### 问题3：验收测试用例 - 无成功/失败标记

**症状**（第122-139行）：
```markdown
### P1 重要验证（中风险）

**TC-001**: `src/main/java/.../InverterMonthlySnapshotMapper.java` 接口/服务验证
- 前置条件：服务正常启动
- 正向测试：API 正常调用返回预期结果
- 负向测试：参数缺失/类型错误时返回正确错误码
```

**问题**：
- 这些测试用例**没有验证结果**（无"实际结果"字段）
- 无法判断TC是否通过
- 无链接指向实际测试执行记录

**根本原因**：
AI生成的测试用例是**模板化输出**，基于改动文件类型的启发式分析，而非从实际测试执行结果生成。

**代码位置**：
- `work_item_service.py:4701-4706` - AI prompt要求

**AI prompt中的需求**（第4701-4706）：
```
### 7. 验收测试用例
为高风险改动提供具体测试场景：
- 测试编号（TC-XXX）
- 前置条件 → 操作步骤 → 预期结果
- 优先级：P0 > P1 > P2
- 至少为每个高风险项提供正向+负向测试
```

**问题所在**：
- 输入prompt中**没有提供实际测试执行结果数据**
- 各子任务的测试报告中虽然有测试结果描述，但未被结构化提取
- AI 生成的是"预期应该测试什么"，而非"实际测试了什么"

---

### 问题4：部署与回滚 - 前置SQL未列出

**症状**（第141-158行）：
```markdown
## 8. 部署与回滚

### 部署前置条件

- 无特殊前置条件

### 部署顺序

涉及 3 个项目，建议部署顺序：
1. fms-job
2. fms-server
3. fms-web

### 回滚方案

- **回滚触发条件**: 核心功能异常、接口报错率突增、数据不一致
- **回滚方式**: Git revert 到前一个稳定版本，重新部署
```

**但各子任务的测试报告中明确列出了前置SQL要求**：

从 fms-server 测试报告（第92-96行）：
```markdown
## 四、遗留 / 未覆盖

1. 权限表初始化 SQL 未通过代码提交，需运维执行技术方案第 5.4 节所列 SQL
   （新增 `inverterSnapshot`、`inverterSnapshotView`、`inverterSnapshotExport` 权限并绑定 admin 角色）。
```

从 fms-job 测试报告（第49-51行）：
```markdown
### 3.1 数据库 DDL 前置
- 需确认 `InverterMonthlySnapshot` 表已在 primary 数据库中创建（含唯一索引 `uk_month_sn`）
- 如果表不存在，job 运行时将抛出 SQL 异常
```

**根本原因**：
汇总报告生成逻辑**未从子任务测试报告中提取部署前置条件**。

**代码位置**：
- `work_item_service.py:4045-4058` - 测试报告段落提取
- `work_item_service.py:4708-4712` - AI prompt中部署前置条件要求

**关键代码**（第4045-4058）：
```python
# 从各子任务 agent_final_output 中提取测试报告
report_sections: list = []
for sub in subtask_rows:
    agent_output = sub.get("agent_final_output") or ""
    if not agent_output:
        continue
    # 提取测试报告段落（匹配 "测试报告" 标记之后的内容）
    test_section = self._extract_test_report_section(agent_output)
    if test_section:
        report_sections.append((project_name, test_section))
```

**问题所在**：
- 提取的是 `agent_final_output`（Agent输出的文本摘要）
- 但实际的详细测试报告是**保存在独立文件中**的，未被读取

三个测试报告文件：
```
docs/wi-820195fc-逆变器快照-fms-server-测试报告.md  (101行)
docs/wi-820195fc-逆变器快照-fms-job-测试报告.md     (77行)
docs/wi-820195fc-逆变器快照-fms-web-测试报告.md     (57行)
```

这些文件中的"四、遗留/未覆盖"等信息完全未被纳入汇总报告。

---

## 三、AI Prompt 模板分析

### Prompt位置
`backend/services/work_item_service.py:4662-4747`

### Prompt要求的9章节
1. **Executive Summary** - ✅ 要求明确（业务目标、技术实现、测试结论、置信度、建议）
2. **改动范围分析** - ✅ 要求明确（表格：项目、模块、改动文件、类型、风险、影响范围）
3. **测试执行结果** - ✅ 要求明确（执行统计表、各子任务通过情况、问题异常）
4. **测试覆盖度分析** - ✅ 要求明确（自动化覆盖、手工验证、盲区）
5. **风险评估矩阵** - ✅ 要求明确（表格：风险项、可能性、影响度、缓解措施、整体风险等级）
6. **回归影响分析** - ✅ 要求明确（现有功能清单、回归测试范围、可安全跳过的范围）
7. **验收测试用例** - ✅ 要求明确（TC编号、前置→操作→结果、优先级、正向+负向测试）
8. **部署与回滚** - ✅ 要求明确（前置条件、部署顺序、回滚方案、监控关注点）
9. **遗留问题与建议** - ✅ 要求明确（技术债、待优化项、后续迭代建议）

### Prompt的**输入数据不足**

虽然Prompt要求很详细，但传给AI的**输入信息存在缺陷**：

```python
prompt = f"""...
## 输入信息

**工作项**: {wi_title}
**涉及项目**: {projects_str}
**改动文件总数**: {total_files}

{tech_proposal_section}  # ← 技术方案（可能为空）

**子任务执行统计**:
{stats_section}  # ← 问题1的根源

**子任务执行摘要**:
{subtask_section}  # ← 来自plan_tasks，缺少title/description

**代码改动详情**:
{changes_section}  # ← 问题2的根源（格式有问题）

**各项目测试报告**:
{reports_section}  # ← 问题4的根源（缺少SQL前置条件）
```

#### 数据来源及缺陷

| 来源 | 内容 | 缺陷 |
|------|------|------|
| `stats_section` | 执行统计（总数/完成/失败/取消） | ❌ 收集失败，全为0 |
| `subtask_section` | 子任务摘要表（序号/名称/状态/Commit Message） | ⚠️ 无任务title，无明确名称 |
| `changes_section` | 代码改动列表（按项目分组） | ⚠️ 文件路径格式错误 |
| `reports_section` | 各子任务测试报告段落 | ❌ 缺少关键信息（SQL前置条件、遗留问题等） |

---

## 四、子项目测试报告收集逻辑

### 流程图

```
Plan完成 (status=committed)
    ↓
_collect_plan_subtask_artifacts() 方法触发 (line 5011)
    ↓
1. 收集子任务执行摘要 (line 3930-3963)
   └─ 查询: plan_tasks + tasks JOIN
   └─ 提取: task_index, status
   └─ 结果: subtask_summaries[]
   
2. 收集代码变更文件 (line 3966-4015)
   └─ 遍历各子任务worktree
   └─ 执行: git log -1 获取最新commit
   └─ 提取: commit_files
   └─ 结果: project_changed_files{project_name -> [files]}
   
3. 提取测试报告段落 (line 4045-4058)
   └─ 读取: agent_final_output (Agent的文本输出摘要)
   └─ 匹配: "测试报告:" 关键词
   └─ 提取正则: r"(?:^|\n)(?:##?\s*)?测试报告[：:]\s*\n([\s\S]+?)(?=\n##?\s|\Z)"
   └─ 结果: report_sections[(project_name, test_section_text)]
   
4. 构建AI输入prompt (line 4121-4129)
   └─ 组织各部分数据
   └─ 调用AgentExecutor生成汇总报告
   
5. 保存汇总报告 (line 4172-4249)
   └─ 写入: docs/wi-{id}-{title}-测试报告(汇总).md
   └─ 提交: git add + commit
   └─ 记录产物: work_items.metadata.artifacts
```

### 关键问题

#### 问题A：agent_final_output 的内容不完整

`agent_final_output` 是Agent执行完成后的文本摘要，可能不包含完整的测试报告内容。

**实际情况**：
- 各子任务生成了详细的 Markdown 测试报告文件
- 但这些文件**未被自动读取**，只依赖 `agent_final_output` 中的片段

**代码缺陷**（第4045-4058）：
```python
# 从各子任务 agent_final_output 中提取测试报告
test_section = self._extract_test_report_section(agent_output)
# 没有代码去读取实际的 docs/*.md 测试报告文件
```

#### 问题B：plan_tasks 表缺少必要字段

`plan_tasks` 表未记录任务标题和描述，导致执行摘要无法显示任务名称。

**表结构**：
```sql
CREATE TABLE plan_tasks (
    plan_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    task_index INTEGER NOT NULL,
    phase INTEGER DEFAULT 0,
    depends_on TEXT,
    PRIMARY KEY (plan_id, task_id)
);
```

**缺失字段**：title, description, result, status

**后果**：执行摘要表无法显示有意义的任务名称

#### 问题C：SQL前置条件未被提取

各子任务测试报告中明确列出的SQL DDL要求（如创建表、添加权限）未被纳入汇总报告的"部署与回滚"章节。

**应该读取的内容**：
- fms-job: `InverterMonthlySnapshot` 表DDL
- fms-server: 权限表SQL（inverterSnapshot相关权限）

**实际代码**：无专门逻辑提取DDL/SQL需求

---

## 五、具体修改建议

### 修复优先级

| 优先级 | 问题 | 修复工作量 | 影响范围 |
|--------|------|---------|---------|
| **P0** | 执行统计为0 | 小 | 高 - 报告最基础数据缺失 |
| **P1** | 前置SQL未列出 | 中 | 高 - 部署风险 |
| **P1** | 测试用例缺结果 | 中 | 中 - 验收信息缺失 |
| **P2** | 功能模块描述泛泛 | 小 | 低 - 影响通顺度 |

### 修复方案

#### 修复1：执行统计为0

**原因**：SQL异常未被正确处理或 plan_id 查询错误

**解决方案**：
1. 增强异常日志记录
2. 验证 plan_id 从 tasks 表正确获取
3. 确认 plan_tasks 表非空

**代码修改位置**：
`backend/services/work_item_service.py:3930-3963`

```python
try:
    async with async_session_factory() as session:
        # 先验证 plan_id 确实存在
        plan_check = await session.execute(
            text("SELECT COUNT(*) as cnt FROM plan_tasks WHERE plan_id = :plan_id"),
            {"plan_id": plan_id}
        )
        plan_cnt = plan_check.scalar() or 0
        logger.info("[work_item] plan %s has %d tasks", plan_id[:8], plan_cnt)
        
        # 再执行原查询
        summary_result = await session.execute(
            text("""
                SELECT pt.task_index, pt.status,
                       t.status as task_status, t.created_at, t.completed_at
                FROM plan_tasks pt
                LEFT JOIN tasks t ON pt.task_id = t.id
                WHERE pt.plan_id = :plan_id
                ORDER BY pt.task_index
            """),
            {"plan_id": plan_id},
        )
        summary_rows = [dict(r._mapping) for r in summary_result.fetchall()]
        
    if summary_rows:
        execution_stats["total"] = len(summary_rows)
        for sr in summary_rows:
            # ... 状态统计逻辑
    else:
        logger.warning("[work_item] NO plan_tasks found for plan_id=%s", plan_id[:8])
        
except Exception as exc:
    logger.error("[work_item] SQL error collecting subtask summaries for plan=%s: %s", 
                 plan_id[:8], exc, exc_info=True)  # 增加exc_info=True打印堆栈
```

#### 修复2：前置SQL未列出

**原因**：未从子任务测试报告文件中提取SQL/DDL要求

**解决方案**：
1. 从各子任务worktree读取 `docs/*-测试报告.md` 文件
2. 解析文件中的"遗留问题与建议"或"测试环境要求"章节
3. 提取SQL/DDL语句
4. 传给AI prompt

**代码修改位置**：
`backend/services/work_item_service.py:4045-4110` 之间新增

```python
# 收集SQL/DDL前置条件
deployment_prerequisites: dict = {}  # project_name -> [prerequisites]

for sub in subtask_rows:
    sub_wt = sub.get("worktree_path") or sub.get("cwd") or ""
    if not sub_wt or not os.path.isdir(sub_wt):
        continue
    
    project_name = Path(sub_wt).name if sub_wt else ""
    
    # 查找 docs/*-测试报告.md 文件
    docs_dir = Path(sub_wt) / "docs"
    if docs_dir.exists():
        for md_file in docs_dir.glob("*测试报告*.md"):
            try:
                content = md_file.read_text(encoding="utf-8")
                # 提取"遗留"或"前置"相关段落
                sql_patterns = [
                    r"(?:CREATE TABLE|ALTER TABLE|INSERT|UPDATE|DELETE|GRANT)",
                    r"(?:前置条件|前置SQL|DDL|数据库迁移)",
                ]
                for pattern in sql_patterns:
                    matches = re.finditer(pattern, content, re.IGNORECASE)
                    if matches:
                        # 提取相关行
                        for match in matches:
                            start = max(0, match.start() - 100)
                            end = min(len(content), match.end() + 200)
                            prereq = content[start:end].strip()
                            deployment_prerequisites.setdefault(project_name, []).append(prereq)
            except Exception as e:
                logger.debug("[work_item] failed to parse test report %s: %s", md_file, e)

# 在构建prompt时加入部署前置条件
deployment_section = ""
if deployment_prerequisites:
    lines = ["## 部署前置条件"]
    for proj, prqs in deployment_prerequisites.items():
        lines.append(f"### {proj}")
        for prq in prqs:
            lines.append(f"- {prq[:200]}")  # 截断过长内容
    deployment_section = "\n".join(lines)
```

#### 修复3：测试用例缺验证结果

**原因**：AI生成模板化用例，缺少实际测试执行结果

**解决方案**：
1. 从子任务测试报告中提取"自测结果"章节
2. 构建结构化的测试用例+结果数据
3. 传给AI prompt要求对应输出

**代码修改位置**：
`backend/services/work_item_service.py:4055` 改进 `_extract_test_report_section()`

```python
# 同时提取测试结果部分
def _extract_test_result_and_cases(self, test_report_md: str) -> tuple[list, list]:
    """从测试报告MD中提取：测试结果、测试用例"""
    import re
    
    # 提取"自测结果"或"验证结果"章节
    results_patterns = [
        r"(?:##\s*)?(?:自测结果|验证结果|测试结果|Test Results?)[：:]\s*\n([\s\S]+?)(?=\n##|\Z)",
    ]
    
    test_results = []
    for pattern in results_patterns:
        matches = re.finditer(pattern, test_report_md)
        for match in matches:
            test_results.append(match.group(1).strip())
    
    # 提取测试用例（形如 "TC-001:" 或 "**TC-001**" 的条目）
    case_pattern = r"(?:TC-\d+|Test Case \d+)[：:\s]*(.+?)(?=TC-\d+|Test Case \d+|\Z)"
    test_cases = []
    for match in re.finditer(case_pattern, test_report_md, re.IGNORECASE):
        case_text = match.group(1).strip()
        if case_text:
            test_cases.append(case_text[:300])  # 截断
    
    return test_results, test_cases
```

#### 修复4：功能模块描述泛泛

**原因**：改动文件路径提取有格式问题

**解决方案**：
验证 `_get_commit_changed_files()` 返回的文件路径格式

**代码验证位置**：
`backend/services/work_item_service.py:4016-4043`

---

## 六、关键代码流程总结

### 汇总报告生成流程

```
工作项Plan完成 (status=committed)
  ↓
自动触发: plan_merge_completed 工作流节点
  ↓
_on_task_completed() 回调处理
  ↓
_collect_plan_subtask_artifacts(work_item_id, task_id)
  ├─ ① 查询plan_tasks收集执行统计
  ├─ ② 遍历子任务worktree提取commit变更文件
  ├─ ③ 提取子任务agent_final_output中的测试报告段落
  ├─ ④ 读取工作项worktree中的技术方案文档
  └─ ⑤ 构建AI prompt + 调用AI生成汇总报告
      ├─ 输入数据：wi_title, projects, changed_files, test_reports, tech_proposal
      ├─ AI Prompt: 9章节结构（见第三部分）
      └─ Fallback: 如果AI失败，使用 _generate_static_summary_report()
  ↓
保存汇总报告到工作项worktree/docs
  ↓
git add + commit
  ↓
记录产物到 work_items.metadata.artifacts (stage="test")
```

### 数据流向

```
database (plan_tasks, tasks)
    ↓
subtask_summaries[] ←─ execution_stats{}
                ↓
worktree (各子任务)
    ├─ git log ←─ changed_files{}
    ├─ agent_final_output ←─ test_reports[]
    └─ docs/*-测试报告.md [未被读取]
                ↓
    proposal_docs (技术方案)
                ↓
        AI Prompt 构建
                ↓
        AI 汇总报告生成 (或 Fallback 静态生成)
                ↓
        docs/wi-{id}-{title}-测试报告(汇总).md
```

---

## 七、测试/验证步骤

### 步骤1：验证数据收集

```python
# 在 _collect_plan_subtask_artifacts 方法中添加debug输出
logger.info(f"[work_item] plan_id={plan_id}")
logger.info(f"[work_item] execution_stats={execution_stats}")
logger.info(f"[work_item] project_changed_files keys={list(project_changed_files.keys())}")
logger.info(f"[work_item] report_sections={len(report_sections)} sections")
for proj, section in report_sections:
    logger.info(f"[work_item]   {proj}: {len(section)} chars")
```

### 步骤2：查看实际生成的数据

```bash
# 查看传给AI的prompt（可添加日志）
logger.debug(f"[work_item] AI prompt:\n{summary_prompt[:1000]}...")

# 查看AI返回的内容
logger.info(f"[work_item] AI output:\n{ai_output[:500]}...")
```

### 步骤3：验证修复

再次执行类似工作项的Plan，检查：
1. ✅ 执行统计数字正确
2. ✅ 前置SQL条件列出
3. ✅ 测试用例显示结果
4. ✅ 功能模块描述准确

---

## 八、总结

### 核心问题
汇总测试报告质量问题源于**数据收集链路不完整**：
- ❌ 执行统计查询失败（可能是exception未正确处理）
- ❌ 代码改动文件路径格式错误
- ❌ 子任务测试报告文件未被读取（只依赖agent_final_output）
- ❌ 部署前置条件（SQL/DDL）未被提取

### 修复策略
1. **增强日志和异常处理** - 快速定位问题
2. **补充数据收集** - 从测试报告文件读取SQL前置条件
3. **改进AI输入** - 提供结构化的测试结果数据
4. **验证文件路径** - 修复格式问题

### 预期效果
修复后的汇总报告应包含：
- ✅ 准确的执行统计（应显示 3/3 子任务完成）
- ✅ 完整的代码改动清单（精确的文件路径）
- ✅ 准确的功能模块影响分析（基于改动文件类型分析）
- ✅ 部署前置条件清单（包含所有SQL/DDL）
- ✅ 测试用例验证结果（Pass/Fail标记）

