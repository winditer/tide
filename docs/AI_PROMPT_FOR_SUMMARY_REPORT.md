# AI汇总测试报告生成Prompt详细说明

## Prompt位置
`/Users/haifeng/Documents/tide/backend/services/work_item_service.py` 行 4590-4750

## Prompt完整内容

```
你是一位资深 QA 工程师和技术 TL，正在为以下工作项编写专业的测试交接报告（Test Handover Report）。
这份报告将用于开发团队向 QA/测试团队或产品经理交接，确保接收方了解改动全貌、测试覆盖情况和上线风险。

## 报告结构要求

请严格按照以下章节生成 Markdown 报告：

### 1. Executive Summary（执行摘要）
- 用 2-3 句话概括本次改动的**业务目标**和**技术实现方式**
- 整体测试结论：✅ 通过 / ⚠️ 有风险 / ❌ 未通过
- 置信度评估（高/中/低）及理由
- 建议：Go / Conditional Go / No-Go

### 2. 改动范围分析
以表格形式列出所有改动文件：
| 项目 | 模块 | 改动文件 | 改动类型 | 风险等级 | 影响范围 |

改动类型分类：新增功能 / 缺陷修复 / 重构 / 配置变更 / 依赖升级
风险等级用 emoji：🔴高 🟡中 🟢低

### 3. 测试执行结果
- 子任务执行统计表
- 各子任务测试通过情况汇总
- 发现的问题/异常（如有）

### 4. 测试覆盖度分析
- 哪些改动已被自动化测试覆盖
- 哪些改动需要手工验证
- 测试盲区/未覆盖的风险点

### 5. 风险评估矩阵
| 风险项 | 可能性 | 影响度 | 缓解措施 |
标注整体风险等级

### 6. 回归影响分析
- 本次改动可能影响的现有功能清单
- 建议的回归测试范围
- 可安全跳过的回归范围及理由

### 7. 验收测试用例
为高风险改动提供具体测试场景：
- 测试编号（TC-XXX）
- 前置条件 → 操作步骤 → 预期结果
- 优先级：P0 > P1 > P2
- 至少为每个高风险项提供正向+负向测试

### 8. 部署与回滚
- 部署前置条件（数据库迁移、配置、依赖）
- 部署顺序（多项目时）
- 回滚方案和回滚触发条件
- 监控关注点（部署后需关注的指标/日志）

### 9. 遗留问题与建议
- 当前已知的技术债或待优化项
- 后续迭代建议

## 输入信息

**工作项**: {wi_title}
**涉及项目**: {projects_str}
**改动文件总数**: {total_files}

{tech_proposal_section}

**子任务执行统计**:
{stats_section}

**子任务执行摘要**:
{subtask_section}

**代码改动详情**:
{changes_section}

**各项目测试报告**:
{reports_section}

## 输出要求
- 使用 Markdown 格式
- 报告标题用「# Test Handover Report（测试交接报告）」
- 表格使用标准 Markdown 表格语法
- 风险等级用 emoji 标记：🔴高 🟡中 🟢低
- 测试用例编号格式：TC-001, TC-002...
- 语言：中文为主，章节标题保留英文
- 务必基于实际改动内容和测试结果分析，不要使用泛泛的模板化建议
- 每个章节必须有实质性内容，不能只有标题
```

## Prompt中的数据占位符说明

### {wi_title}
- **含义**：工作项标题
- **来源**：`work_items.title`
- **示例**：`逆变器快照`
- **状态**：✅ 正常传入

### {projects_str}
- **含义**：涉及项目列表（逗号分隔）
- **来源**：从 `report_sections` 和 `project_changed_files` 提取的项目名
- **示例**：`fms-job, fms-server, fms-web`
- **状态**：✅ 正常传入

### {total_files}
- **含义**：改动文件总数
- **来源**：`sum(len(files) for files in changed_files_by_project.values())`
- **示例**：`23`
- **状态**：✅ 正常传入

### {tech_proposal_section}
- **含义**：技术方案文档内容
- **来源**：从工作项worktree读取 `*方案*.md` 文件
- **示例**：技术方案内容前4000个字符
- **状态**：⚠️ 可能为空

### {stats_section}
- **含义**：子任务执行统计
- **来源**：`execution_stats` 字典
- **示例**：
  ```
  - 总子任务数: 3
  - 已完成: 3
  - 失败: 0
  - 已取消: 0
  ```
- **状态**：❌ **问题1：通常为0，应该是3**

### {subtask_section}
- **含义**：子任务执行摘要表格
- **来源**：`subtask_summaries` 列表
- **示例**：
  ```
  | 序号 | 任务名称 | 状态 | Commit Message |
  |------|---------|------|----------------|
  | 0 | task-c7c585fd | committed | docs: ... |
  | 1 | task-89560e76 | committed | ... |
  | 2 | task-3fda950f | committed | ... |
  ```
- **状态**：⚠️ 任务名称不清楚（plan_tasks无title字段）

### {changes_section}
- **含义**：代码改动文件列表（按项目分组）
- **来源**：`project_changed_files` 字典
- **示例**：
  ```
  ### fms-job（6 个文件）
  - `src/main/java/.../LogicAppsConstants.java`
  - `src/main/java/.../InverterMonthlySnapshotDO.java`
  ...
  ```
- **状态**：⚠️ **问题2：文件路径格式可能有编码问题**

### {reports_section}
- **含义**：各子任务的测试报告段落
- **来源**：从 `agent_final_output` 中提取"测试报告"后的内容
- **示例**：各项目测试报告段落（3项）
- **状态**：❌ **问题4：缺少SQL前置条件、部署要求等关键信息**

---

## 实际Prompt调用

### 代码片段
```python
summary_prompt = self._build_test_summary_prompt(
    wi_title=wi_title or work_item_id[:8],
    projects=projects,
    changed_files_by_project=project_changed_files,
    test_reports=report_sections,
    proposal_docs=proposal_docs,
    subtask_summaries=subtask_summaries,
    execution_stats=execution_stats,
)

executor = AgentExecutor()
ai_task_id = f"test-summary-{work_item_id[:8]}"
ai_parts: list = []

async with asyncio.timeout(90):  # 90 秒超时
    async for event in executor.run_task(
        task_id=ai_task_id,
        agent_id=DEFAULT_AGENT_ID,
        prompt=summary_prompt,
        cwd=str(DEFAULT_CWD),
        model=None,
        full_auto=True,
    ):
        if event.type == "output":
            ai_parts.append(event.content)
        elif event.type == "completed":
            if event.content:
                ai_parts.append(event.content)
        elif event.type == "failed":
            raise RuntimeError(f"AI summary failed: {event.content}")

ai_output = "\n".join(str(p) for p in ai_parts if p)
if ai_output and len(ai_output.strip()) > 200:
    report_content = ai_output.strip()
```

### 执行参数
- **agent_id**：DEFAULT_AGENT_ID（通常是claude或gpt）
- **model**：None（使用默认模型）
- **full_auto**：True（全自动执行）
- **timeout**：90秒

---

## 工作项820195fc的Prompt实例

### 传入数据

```python
wi_title="逆变器快照"
projects=["fms-job", "fms-server", "fms-web"]
total_files=23

project_changed_files={
    "fms-job": [6个文件],
    "fms-server": [9个文件],
    "fms-web": [8个文件]
}

execution_stats={
    "total": 0,      # ❌ 应该是3
    "completed": 0,  # ❌ 应该是3
    "failed": 0,
    "cancelled": 0
}

subtask_summaries=[
    {
        "index": 0,
        "title": "task-c7c585fd",  # ⚠️ 不是有意义的名称
        "status": "committed",
        "commit_msg": "..."
    },
    # ... 3个子任务
]

test_reports=[
    ("fms-server", "... 测试报告摘要 ..."),
    ("fms-job", "... 测试报告摘要 ..."),
    ("fms-web", "... 测试报告摘要 ...")
]
```

### AI生成的报告

实际输出见：`docs/wi-820195fc-逆变器快照-测试报告(汇总).md`

**质量问题**：
1. 执行统计表显示为0（数据源为0）
2. 功能模块描述泛泛（改动文件提取有问题）
3. 测试用例无结果标记（输入中无实际测试结果）
4. 部署前置条件为"无特殊前置条件"（未提取SQL）

---

## 改进建议

### 短期：增强输入数据

1. **修复execution_stats收集**
   - 验证plan_id查询逻辑
   - 增强异常捕获和日志

2. **从测试报告文件提取SQL**
   ```python
   # 新增方法
   def _extract_deployment_prerequisites(self, test_report_md: str) -> dict:
       """提取SQL/DDL前置条件"""
       import re
       prerequisites = {}
       
       # 匹配 "遗留"、"前置"、"需要"等关键词后的SQL
       patterns = [
           r"(?:创建|新增).*?(?:表|权限|字段)[：:](.+?)(?:\n|$)",
           r"(?:执行|需要).*?SQL[：:](.+?)(?:\n|$)",
       ]
       
       for pattern in patterns:
           matches = re.finditer(pattern, test_report_md)
           for match in matches:
               sql = match.group(1).strip()
               if sql:
                   prerequisites[sql[:100]] = sql  # 去重+截断
       
       return prerequisites
   ```

3. **构建结构化的测试结果**
   ```python
   # 新增方法
   def _extract_test_cases_with_results(self, test_report_md: str) -> list:
       """提取测试用例及其结果"""
       import re
       cases = []
       
       # 匹配 "TC-001: ... 结果: PASS/FAIL"
       pattern = r"(?:TC-\d+)[：:]\s*(.+?)(?:结果|Result)[：:]\s*(PASS|FAIL)"
       for match in re.finditer(pattern, test_report_md, re.IGNORECASE):
           cases.append({
               "name": match.group(1).strip(),
               "result": match.group(2).upper()
           })
       
       return cases
   ```

### 中期：改进Prompt

1. **增加约束条件**
   - 要求基于实际数据生成，不要使用泛泛模板
   - 要求对缺失数据明确标记

2. **增加例子**
   - 在Prompt中添加"好例子"和"坏例子"
   - 示范何为"有实质性内容"

### 长期：数据库设计

1. **扩展plan_tasks表**
   ```sql
   ALTER TABLE plan_tasks ADD COLUMN (
       title TEXT,          -- 任务标题
       description TEXT,    -- 任务描述
       result_summary TEXT, -- 任务执行摘要
       status TEXT          -- 执行状态
   );
   ```

2. **新增test_reports表**
   ```sql
   CREATE TABLE test_reports (
       id TEXT PRIMARY KEY,
       task_id TEXT REFERENCES tasks(id),
       work_item_id TEXT REFERENCES work_items(id),
       project_name TEXT,
       report_content LONGTEXT,
       execution_stats JSON,  -- {total, passed, failed, skipped}
       created_at TIMESTAMP
   );
   ```

---

## 调试Prompt的方法

### 1. 打印Prompt内容
```python
logger.debug(f"[work_item] Summary prompt for {work_item_id[:8]}:\n{summary_prompt[:2000]}...")
```

### 2. 检查各占位符值
```python
logger.info(f"[work_item] Prompt inputs:")
logger.info(f"  - wi_title: {wi_title}")
logger.info(f"  - projects: {projects}")
logger.info(f"  - total_files: {total_files}")
logger.info(f"  - execution_stats: {execution_stats}")
logger.info(f"  - report_sections count: {len(report_sections)}")
logger.info(f"  - changed_files_by_project: {list(project_changed_files.keys())}")
```

### 3. 保存Prompt和输出
```python
# 保存用于分析
prompt_file = Path("/tmp") / f"prompt-{work_item_id[:8]}.txt"
prompt_file.write_text(summary_prompt)

output_file = Path("/tmp") / f"output-{work_item_id[:8]}.md"
output_file.write_text(report_content)

logger.info(f"[work_item] Prompt saved to {prompt_file}")
logger.info(f"[work_item] Output saved to {output_file}")
```

