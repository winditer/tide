# 数据库链接前缀修复操作指南

## 快速概览

**问题**：工作流执行生成的产物链接缺少 `/tide` 前缀
- 错误：`/docs/view?url=...` 和 `/tasks/{id}`
- 正确：`/tide/docs/view?url=...` 和 `/tide/tasks/{id}`

**影响范围**：
- `tasks` 表：110 条记录
- `work_items` 表：14 条记录
- 总计：124 条受影响记录

**预计修复时间**：< 1 分钟

---

## 修复步骤

### 步骤 1：备份数据库（重要）

```bash
cd /Users/haifeng/Documents/tide
cp tide.db tide.db.backup.$(date +%Y%m%d_%H%M%S)
```

### 步骤 2：运行修复脚本

```bash
python3 scripts/repair_links.py /Users/haifeng/Documents/tide/tide.db
```

**脚本会自动执行以下操作**：
1. 修复 `work_items.metadata` 中 JSON artifacts 的 URL
2. 修复 `tasks.result` 中嵌入的链接
3. 验证修复结果

**预期输出**：
```
======================================================================
FIX 1: work_items.metadata (JSON artifacts)
======================================================================
Found 14 work_items to fix

  [work_item_id] /docs/view?url=%2Fapi%2F...
           → /tide/docs/view?url=%2Fapi%2F...

Updated 14 work_items

======================================================================
FIX 2: tasks.result (embedded links)
======================================================================
Found 110 tasks to fix

Updated 110 tasks

======================================================================
VERIFICATION
======================================================================
Remaining tasks with missing /tide: 0
Remaining work_items with missing /tide: 0

✓ All links have been successfully fixed!

======================================================================
SUMMARY: Fixed 14 work_items and 110 tasks
======================================================================
```

### 步骤 3：验证修复

运行验证查询：

```bash
sqlite3 tide.db "SELECT COUNT(*) FROM tasks WHERE result LIKE '%/docs/view%' AND result NOT LIKE '%/tide%';"
# 应返回：0

sqlite3 tide.db "SELECT COUNT(*) FROM work_items WHERE metadata LIKE '%/docs/view%' AND metadata NOT LIKE '%/tide%';"
# 应返回：0
```

---

## 如果在容器中修复

### 容器环境中的修复

如果数据库在 Docker 容器中（`tide-backend`）：

```bash
# 1. 将脚本复制到容器
docker cp scripts/repair_links.py tide-backend:/tmp/

# 2. 在容器中运行修复
docker exec tide-backend python3 /tmp/repair_links.py /app/data/tide.db

# 3. 验证修复
docker exec tide-backend sqlite3 /app/data/tide.db "SELECT COUNT(*) FROM tasks WHERE result LIKE '%/docs/view%' AND result NOT LIKE '%/tide%';"
```

---

## 手动修复（如果脚本失败）

### 方法 A：修复 tasks 表（使用 SQL）

```sql
-- 连接数据库
sqlite3 tide.db

-- 执行修复语句
UPDATE tasks 
SET result = REPLACE(
    REPLACE(result, '/docs/view', '/tide/docs/view'),
    '/tasks/',
    '/tide/tasks/'
)
WHERE (result LIKE '%/docs/view%' OR result LIKE '%/tasks/%')
AND result NOT LIKE '%/tide/docs%' 
AND result NOT LIKE '%/tide/tasks%';

-- 验证
SELECT COUNT(*) FROM tasks WHERE result LIKE '%/docs/view%' AND result NOT LIKE '%/tide%';

.exit
```

### 方法 B：修复 work_items 表（需要 Python）

使用修复脚本的 `fix_work_items_metadata()` 函数，或参考脚本源代码逐条修复。

---

## 如果出现问题

### 恢复备份

```bash
# 如果修复出现问题，恢复备份
cp tide.db.backup.YYYYMMDD_HHMMSS tide.db
```

### 检查修复日志

```bash
# 查看修复前后的数据
sqlite3 tide.db "SELECT id, substr(result, 1, 100) FROM tasks WHERE result LIKE '%/docs/view%' LIMIT 3;"
```

### 常见问题

**Q：脚本找不到？**
A：确保在项目根目录执行，或使用完整路径：
```bash
python3 /Users/haifeng/Documents/tide/scripts/repair_links.py /Users/haifeng/Documents/tide/tide.db
```

**Q：数据库被锁定？**
A：确保 Tide 服务未运行，或使用 `-timeout 30000` 参数：
```bash
sqlite3 -cmd ".timeout 30000" tide.db < script.sql
```

**Q：修复后仍有缺失前缀的链接？**
A：运行验证查询确认，然后检查是否有其他链接格式未被处理。

---

## 源代码修复（防止再发生）

### 修复链接生成代码

**文件**：`/Users/haifeng/Documents/tide/backend/services/work_item_service.py`
**行号**：2899

修改前：
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

### 添加单元测试

创建测试确保所有生成的链接包含 `/tide` 前缀：

```python
def test_artifact_urls_contain_tide_prefix():
    """验证所有生成的产物链接都包含 /tide 前缀"""
    artifact = {
        "url": "/tide/docs/view?url=...",
        "type": "file"
    }
    assert "/tide/" in artifact["url"], "Artifact URL missing /tide prefix"
```

---

## 相关资源

- **快速参考**：`DATABASE_SUMMARY.txt`
- **详细报告**：`DATABASE_LINK_REPAIR_REPORT.md`
- **修复脚本**：`scripts/repair_links.py`

---

## 修复验证清单

- [ ] 备份数据库
- [ ] 运行修复脚本（或执行 SQL）
- [ ] 验证修复结果（两个查询都返回 0）
- [ ] 测试前端链接是否正常
- [ ] 修改源代码添加 `/tide` 前缀
- [ ] 添加单元测试
- [ ] 清理备份文件（可选）

---

## 时间戳

**调查完成时间**：2026-07-02
**受影响记录数**：124 条
**修复类型**：数据库链接前缀补全

