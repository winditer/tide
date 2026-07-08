# Tide 数据库链接前缀修复报告

## 问题概述

工作流执行生成的产物链接和任务链接缺少 `/tide` 前缀，导致存储在数据库中的链接格式不正确：
- 存储格式（错误）：`/docs/view?url=...` 和 `/tasks/{id}`
- 应该格式（正确）：`/tide/docs/view?url=...` 和 `/tide/tasks/{id}`

## 调查结果

### 1. 数据库表结构分析

#### tasks 表
- **位置**：`/app/data/tide.db` 或本地 `tide.db`
- **相关字段**：`result` (TEXT) - 存储任务执行结果
- **问题**：result 字段包含嵌入的 markdown 链接，其中部分缺少 `/tide` 前缀

#### work_items 表
- **位置**：`/app/data/tide.db` 或本地 `tide.db`
- **相关字段**：`metadata` (TEXT/JSON) - 存储工作项元数据
- **结构**：metadata 是 JSON 格式，包含 `artifacts` 数组
- **问题**：artifacts 数组中的 `url` 字段缺少 `/tide` 前缀

### 2. 代码中的链接生成位置

#### 文档查看链接生成
**文件**：`/Users/haifeng/Documents/tide/backend/services/work_item_service.py`
**行数**：2899
**代码片段**：
```python
art["url"] = (
    f"/docs/view?url={quote(content_path, safe='')}"
    f"&title={quote(str(label), safe='')}"
)
```

#### 产物汇总 API
**文件**：`/Users/haifeng/Documents/tide/backend/api/sessions.py`
**行数**：670
**代码片段**：
```python
url = f"/api/work-items/{wid}/artifacts/{art_id}/content"
# 这个 API 路径应该通过前端处理时加上 /tide 前缀
```

### 3. 数据库中实际的数据情况

#### tasks 表中的链接
- **缺失 /tide 前缀的记录数**：110 条
- **示例**：
  - `/docs/view?url=%2Fapi%2Fwork-items%2F...%2Fartifacts%2F...`
  - `/tasks/{task_id}`
- **存储位置**：`result` 字段中的嵌入式 markdown 文本

#### work_items 表中的链接
- **缺失 /tide 前缀的记录数**：14 条
- **示例**：
  ```json
  {
    "url": "/tasks/bf44ce10-e392-4ec9-8980-82827614749d"
  }
  ```
  ```json
  {
    "url": "/docs/view?url=%2Fapi%2Fwork-items%2F75ea1e9e...%2Fartifacts%2F..."
  }
  ```
- **存储位置**：`metadata` 字段中的 JSON `artifacts` 数组

## 修复方案

### 方案 1：使用 Python 脚本修复（推荐）

**脚本**：`/tmp/repair_links.py`

**使用方法**：
```bash
# 修复本地数据库
python3 /tmp/repair_links.py /Users/haifeng/Documents/tide/tide.db

# 或修复容器中的数据库
docker exec tide-backend python3 /tmp/repair_links.py /app/data/tide.db
```

**脚本功能**：
1. 修复 `work_items.metadata` 中的 JSON artifacts 链接
2. 修复 `tasks.result` 中的嵌入式链接
3. 验证修复结果

### 方案 2：使用 SQL 语句修复

#### SQL 1：修复 tasks.result 字段（批量）
```sql
-- 为 tasks.result 中的所有 /docs/view 和 /tasks/ 链接添加 /tide 前缀
UPDATE tasks 
SET result = REPLACE(
    REPLACE(result, '/docs/view', '/tide/docs/view'),
    '/tasks/',
    '/tide/tasks/'
)
WHERE (result LIKE '%/docs/view%' OR result LIKE '%/tasks/%')
AND result NOT LIKE '%/tide/docs%' 
AND result NOT LIKE '%/tide/tasks%';

-- 影响行数：110 条记录
```

#### SQL 2：修复 work_items.metadata 字段（逐条）
由于 `metadata` 是 JSON 字段，SQLite 无法直接用 REPLACE 函数，需要逐条更新。

**示例**（需为每条受影响的记录执行）：
```sql
-- 示例：修复 work_item 81e04038-097b-438a-8ddb-0fb6e5838454
UPDATE work_items 
SET metadata = json_set(
  metadata,
  '$.artifacts[0].url',
  '/tide/tasks/bf44ce10-e392-4ec9-8980-82827614749d'
)
WHERE id = '81e04038-097b-438a-8ddb-0fb6e5838454';
```

**注意**：json_set 不适用于修复多个嵌套层次，建议使用 Python 脚本。

## 修复前后对比

### 修复前
```
tasks 表：110 条记录包含缺失 /tide 前缀的链接
work_items 表：14 条记录包含缺失 /tide 前缀的链接
总计：124 条受影响的记录
```

### 修复后
```
所有链接应该遵循格式：
- /tide/docs/view?url=...
- /tide/tasks/{id}
```

## 后续预防措施

### 1. 修改源代码

**文件**：`/Users/haifeng/Documents/tide/backend/services/work_item_service.py`
**建议**：在生成链接时直接加入 `/tide` 前缀

修改前（第 2899 行）：
```python
art["url"] = (
    f"/docs/view?url={quote(content_path, safe='')}"
    f"&title={quote(str(label), safe='')}"
)
```

修改后：
```python
art["url"] = (
    f"/tide/docs/view?url={quote(content_path, safe='')}"
    f"&title={quote(str(label), safe='')}"
)
```

### 2. 配置管理

根据记忆中的信息，所有前端 URL 必须以 `/tide` 为路径前缀，通过设置 `NEXT_PUBLIC_BASE_PATH=/tide` 环境变量并使用 `appPath()` 工具函数统一生成路径。

### 3. 测试覆盖

添加单元测试确保新生成的链接都包含 `/tide` 前缀。

## 相关文件清单

| 文件路径 | 作用 | 关键代码行 |
|---------|------|----------|
| `/Users/haifeng/Documents/tide/backend/services/work_item_service.py` | 产物链接生成 | 2899 |
| `/Users/haifeng/Documents/tide/backend/services/work_item_service.py` | 任务产物提取 | 2615-2920 |
| `/Users/haifeng/Documents/tide/backend/db/init.sql` | 数据库 schema | 20-56 (tasks), 229-248 (work_items) |
| `/Users/haifeng/Documents/tide/backend/api/sessions.py` | 产物汇总 API | 559-682 |

## 数据库配置

- **本地数据库**：`/Users/haifeng/Documents/tide/tide.db`
- **容器数据库**：`/app/data/tide.db`（tide-backend 容器）
- **数据库类型**：SQLite 3
- **数据库 URL**：`sqlite+aiosqlite:////app/data/tide.db`

## 执行步骤

### 备份数据库（必须）
```bash
cp /Users/haifeng/Documents/tide/tide.db /Users/haifeng/Documents/tide/tide.db.backup.$(date +%s)
```

### 执行修复
```bash
python3 /tmp/repair_links.py /Users/haifeng/Documents/tide/tide.db
```

### 验证修复
脚本会自动验证，或手动检查：
```bash
sqlite3 /Users/haifeng/Documents/tide/tide.db "SELECT COUNT(*) FROM tasks WHERE result LIKE '%/docs/view%' AND result NOT LIKE '%/tide%';"
sqlite3 /Users/haifeng/Documents/tide/tide.db "SELECT COUNT(*) FROM work_items WHERE metadata LIKE '%/docs/view%' AND metadata NOT LIKE '%/tide%';"
# 两个查询结果都应该为 0
```

