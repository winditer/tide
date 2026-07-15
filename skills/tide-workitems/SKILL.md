---
name: Tide
slug: tide-workitems
description: 将本地需求文档转换为 Tide 工作项，支持批量创建和状态追踪
category: integration
tags: [work-items, api, automation]
enabled: true
---

# Tide 工作项管理

## 触发条件

当用户：
- 要求将需求/文档/描述转化为 Tide 工作项
- 要求查看、追踪或更新 Tide 平台上的工作项
- 要求批量创建任务/待办
- 提到"工作项"、"work item"、"需求导入"等关键词
- 要求在某个项目组中创建工作项（如"在 fms 项目组创建…"）
- 要求查看"我的工作项"或"分配给我的任务"
- 要求更新/修改工作项的状态
- 要求获取工作项的链接/URL
- 要求分享工作项给他人

## 前置条件与配置引导

### 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `TIDE_API_URL` | Tide 平台 API 地址 | `https://storming.ebonex.io/tide` |
| `TIDE_API_TOKEN` | API 认证 Token | 无（必须配置） |

### 首次配置引导流程

1. **检查环境变量**：确认 `TIDE_API_URL` 和 `TIDE_API_TOKEN` 已设置
2. **引导创建 Token**：若 Token 不存在，引导用户前往 Tide 平台 → 个人设置 → API Token 页面创建
3. **验证连通性**：使用以下命令验证配置是否正确

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $TIDE_API_TOKEN" \
  "$TIDE_API_URL/api/projects"
```

返回 `200` 表示配置成功，`401` 表示 Token 无效。

## 核心操作

### 操作0：获取当前用户信息

获取当前 API Token 所属用户的信息，用于设置工作项的默认负责人等场景。

- **端点**：`GET /api/auth/me`
- **HTTP 方法**：GET

```bash
curl -X GET "$TIDE_API_URL/api/auth/me" \
  -H "Authorization: Bearer $TIDE_API_TOKEN"
```

**响应格式**：

```json
{
  "id": "user_abc123",
  "username": "haifeng",
  "email": "haifeng@example.com",
  "display_name": "海峰",
  "role": "member",
  "status": "active"
}
```

> 关键字段用途：
> - `id` — 用户 UUID（**不用于** assignee）
> - `display_name` — 用于 assignee 字段（如"赵海风"）
> - `username` — display_name 为空时的备选

---

### 操作1：发现项目

获取当前用户可访问的项目列表，拿到 `project_id`（Base64 编码的项目路径）。

- **端点**：`GET /api/projects`
- **HTTP 方法**：GET

```bash
curl -X GET "$TIDE_API_URL/api/projects" \
  -H "Authorization: Bearer $TIDE_API_TOKEN"
```

**响应格式**：

```json
[
  {
    "id": "L1VzZXJzL2hhaWZlbmcvcHJvamVjdA==",
    "name": "my-project",
    "path": "/Users/haifeng/project",
    "group_id": null
  }
]
```

> `id` 即为后续操作所需的 `project_id`，是项目路径的 Base64 编码。

---

### 操作1.5：发现项目组

获取当前用户可访问的项目组列表，拿到 `group_id`。当用户提到在特定项目组中创建工作项时，必须先调用此接口获取对应的 `group_id`。

- **端点**：`GET /api/project-groups`
- **HTTP 方法**：GET
- **查询参数**：`workspace_id`（默认 `default`）

```bash
curl -X GET "$TIDE_API_URL/api/project-groups?workspace_id=default" \
  -H "Authorization: Bearer $TIDE_API_TOKEN"
```

**响应格式**：

```json
{
  "groups": [
    {
      "id": "grp_abc123",
      "name": "fms",
      "description": "FMS 项目组",
      "workspace_id": "default",
      "created_by": "admin",
      "member_count": 3,
      "created_at": "2025-01-01T00:00:00",
      "updated_at": "2025-01-01T00:00:00"
    }
  ]
}
```

> **关键**：`id` 字段即为 `group_id`，在创建工作项时传入可将工作项归入该项目组。通过 `name` 字段匹配用户提到的项目组名称。

#### 获取项目组详情（包含成员列表）

- **端点**：`GET /api/project-groups/{group_id}`
- **HTTP 方法**：GET

```bash
curl -X GET "$TIDE_API_URL/api/project-groups/grp_abc123" \
  -H "Authorization: Bearer $TIDE_API_TOKEN"
```

**响应格式**：

```json
{
  "id": "grp_abc123",
  "name": "fms",
  "description": "FMS 项目组",
  "members": [
    {
      "project_id": "L1VzZXJzL2hhaWZlbmcvZm1zLXdlYg==",
      "cwd": "/Users/haifeng/fms-web",
      "name": "fms-web",
      "role": "primary"
    },
    {
      "project_id": "L1VzZXJzL2hhaWZlbmcvZm1zLXNlcnZlcg==",
      "cwd": "/Users/haifeng/fms-server",
      "name": "fms-server",
      "role": "member"
    }
  ]
}
```

> **关键**：`members` 列表包含项目组下的所有成员项目，每个成员有 `role` 字段（值为 `"primary"` 或 `"member"`）。创建工作项时自动选取 `role` 为 `"primary"` 的成员的 `project_id`；若无 primary 成员，使用列表第一个成员的 `project_id`。**无需询问用户选择子项目**。

---

### 操作2：AI 智能分解需求

将需求文本、链接或文件提交给 AI 进行智能分解，返回结构化的工作项列表。**仅分析不入库**，需要后续调用批量创建接口入库。

- **端点**：`POST /api/work-items/ai-decompose`
- **HTTP 方法**：POST
- **Content-Type**：`multipart/form-data`

**请求字段**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `text` | string | 否 | 需求文本内容 |
| `links` | string | 否 | JSON 数组字符串，参考链接列表 |
| `project_id` | string | 是 | 项目 ID |
| `files` | file | 否 | 需求文件（支持多文件） |

```bash
# 使用文本分解
curl -X POST "$TIDE_API_URL/api/work-items/ai-decompose" \
  -H "Authorization: Bearer $TIDE_API_TOKEN" \
  -F "project_id=L1VzZXJzL2hhaWZlbmcvcHJvamVjdA==" \
  -F "text=用户注册功能需要支持邮箱和手机号两种方式，需要验证码，注册后自动登录"

# 使用文件分解
curl -X POST "$TIDE_API_URL/api/work-items/ai-decompose" \
  -H "Authorization: Bearer $TIDE_API_TOKEN" \
  -F "project_id=L1VzZXJzL2hhaWZlbmcvcHJvamVjdA==" \
  -F "files=@requirements.md"

# 使用链接分解
curl -X POST "$TIDE_API_URL/api/work-items/ai-decompose" \
  -H "Authorization: Bearer $TIDE_API_TOKEN" \
  -F "project_id=L1VzZXJzL2hhaWZlbmcvcHJvamVjdA==" \
  -F 'links=["https://example.com/prd.md"]'
```

**响应格式**：

```json
{
  "items": [
    {
      "title": "实现邮箱注册功能",
      "description": "支持用户通过邮箱地址进行注册，包含邮箱格式验证",
      "priority": 2,
      "tags": ["注册", "邮箱"]
    },
    {
      "title": "实现手机号注册功能",
      "description": "支持用户通过手机号进行注册，包含手机号格式验证",
      "priority": 2,
      "tags": ["注册", "手机"]
    }
  ],
  "raw_analysis": "原始 AI 分析文本...",
  "skipped_files": []
}
```

> 注意：此接口仅进行分析，不会将工作项写入数据库。需用户确认后调用批量创建接口。

---

### 操作3：批量创建工作项

将多个工作项一次性写入 Tide 平台。

- **端点**：`POST /api/work-items/batch`
- **HTTP 方法**：POST
- **Content-Type**：`application/json`

> **重要**：当用户指定了项目组时，**必须**在请求中传递 `group_id`。`group_id` 是项目组的唯一标识（通过操作1.5获取），用于将工作项归入特定项目组，使其在项目组视图中可见。

**请求格式**：

```json
{
  "project_id": "L1VzZXJzL2hhaWZlbmcvcHJvamVjdA==",
  "group_id": "grp_abc123",
  "items": [
    {
      "title": "实现邮箱注册功能",
      "description": "支持用户通过邮箱地址进行注册",
      "priority": 2,
      "tags": ["注册", "邮箱"],
      "assignee": null,
      "source_type": "agent_skill",
      "source_id": "tide-workitems-skill",
      "metadata": {}
    }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `project_id` | string | 是 | 项目 ID |
| `group_id` | string | 条件必填 | 项目组 ID（用户指定项目组时必填，通过操作1.5获取） |
| `items[].title` | string | 是 | 工作项标题 |
| `items[].description` | string | 否 | 详细描述 |
| `items[].priority` | int | 否 | 优先级（1-5，1最高） |
| `items[].tags` | string[] | 否 | 标签列表 |
| `items[].assignee` | string | 否 | 负责人的 display_name（如"赵海风"），不是 user_id |
| `items[].source_type` | string | 否 | 来源类型，建议填 `"agent_skill"` |
| `items[].source_id` | string | 否 | 来源标识 |
| `items[].metadata` | object | 否 | 自定义元数据 |

```bash
# 不指定项目组
curl -X POST "$TIDE_API_URL/api/work-items/batch" \
  -H "Authorization: Bearer $TIDE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "L1VzZXJzL2hhaWZlbmcvcHJvamVjdA==",
    "items": [
      {"title": "实现邮箱注册功能", "description": "支持邮箱注册", "priority": 2, "tags": ["注册"], "source_type": "agent_skill"},
      {"title": "实现手机号注册功能", "description": "支持手机号注册", "priority": 2, "tags": ["注册"], "source_type": "agent_skill"}
    ]
  }'

# 指定项目组（group_id 通过操作1.5获取）
curl -X POST "$TIDE_API_URL/api/work-items/batch" \
  -H "Authorization: Bearer $TIDE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "L1VzZXJzL2hhaWZlbmcvcHJvamVjdA==",
    "group_id": "grp_abc123",
    "items": [
      {"title": "实现邮箱注册功能", "description": "支持邮箱注册", "priority": 2, "tags": ["注册"], "source_type": "agent_skill"}
    ]
  }'
```

**响应格式**：

```json
{
  "created": [
    {
      "id": "wi_abc123",
      "title": "实现邮箱注册功能",
      "status": "active",
      "priority": 2,
      "created_at": "2025-01-01T00:00:00Z"
    }
  ],
  "failed": [
    {
      "index": 1,
      "title": "实现手机号注册功能",
      "error": "标题重复"
    }
  ]
}
```

---

### 操作4：单个创建工作项

创建单个工作项，适用于零散需求。

- **端点**：`POST /api/work-items`
- **HTTP 方法**：POST
- **Content-Type**：`application/json`

**请求格式**：

```json
{
  "project_id": "L1VzZXJzL2hhaWZlbmcvcHJvamVjdA==",
  "title": "修复登录页面样式问题",
  "description": "iOS 端登录按钮被键盘遮挡",
  "priority": 3,
  "assignee": null,
  "tags": ["bug", "iOS"],
  "source_type": "agent_skill",
  "metadata": {},
  "version_id": null,
  "group_id": null
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `project_id` | string | 是 | 项目 ID |
| `title` | string | 是 | 工作项标题 |
| `description` | string | 否 | 详细描述 |
| `priority` | int | 否 | 优先级（1-5） |
| `assignee` | string | 否 | 负责人的 display_name（如"赵海风"），不是 user_id |
| `tags` | string[] | 否 | 标签列表 |
| `source_type` | string | 否 | 来源类型 |
| `metadata` | object | 否 | 自定义元数据 |
| `version_id` | string | 否 | 关联版本 ID |
| `group_id` | string | 否 | 分组 ID |
| `planned_start_date` | string | 否 | 计划开始时间（ISO 8601 格式） |
| `planned_end_date` | string | 否 | 计划结束时间（ISO 8601 格式） |

```bash
curl -X POST "$TIDE_API_URL/api/work-items" \
  -H "Authorization: Bearer $TIDE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "L1VzZXJzL2hhaWZlbmcvcHJvamVjdA==",
    "title": "修复登录页面样式问题",
    "description": "iOS 端登录按钮被键盘遮挡",
    "priority": 3,
    "tags": ["bug", "iOS"],
    "source_type": "agent_skill"
  }'
```

> 创建工作项时会自动记录创建人为当前认证用户（API Token 所属用户）。

**响应格式**：

```json
{
  "id": "wi_def456",
  "title": "修复登录页面样式问题",
  "status": "active",
  "priority": 3,
  "tags": ["bug", "iOS"],
  "created_by": "user_456",
  "planned_start_date": null,
  "planned_end_date": null,
  "created_at": "2025-01-01T00:00:00Z"
}
```

---

### 操作5：查询工作项状态

查询项目下的工作项列表、单个工作项详情、以及工作项的流转历史。

- **端点**：
  - `GET /api/work-items` — 列表查询
  - `GET /api/work-items/{item_id}` — 单项详情
  - `GET /api/work-items/{item_id}/transitions` — 流转历史
- **HTTP 方法**：GET

**查询参数（列表查询）**：

| 参数 | 说明 |
|------|------|
| `project_id` | 项目 ID（必填） |
| `group_id` | 按项目组过滤 |
| `version_id` | 按版本筛选 |
| `status` | 状态过滤 |
| `search` | 标题模糊搜索 |
| `assignee` | 负责人过滤 |

**status 可选值**：`active`、`completed`、`pending`、`in_progress`、`pending_approval`、`failed`、`stopped`、`waiting`

```bash
# 查询项目下所有工作项
curl -X GET "$TIDE_API_URL/api/work-items?project_id=L1VzZXJzL2hhaWZlbmcvcHJvamVjdA==" \
  -H "Authorization: Bearer $TIDE_API_TOKEN"

# 按状态过滤
curl -X GET "$TIDE_API_URL/api/work-items?project_id=L1VzZXJzL2hhaWZlbmcvcHJvamVjdA==&status=in_progress" \
  -H "Authorization: Bearer $TIDE_API_TOKEN"

# 按项目组和版本筛选
curl -X GET "$TIDE_API_URL/api/work-items?project_id=L1VzZXJzL2hhaWZlbmcvcHJvamVjdA==&group_id=GROUP_ID&version_id=VERSION_ID" \
  -H "Authorization: Bearer $TIDE_API_TOKEN"

# 搜索关键词
curl -X GET "$TIDE_API_URL/api/work-items?project_id=L1VzZXJzL2hhaWZlbmcvcHJvamVjdA==&search=注册" \
  -H "Authorization: Bearer $TIDE_API_TOKEN"

# 查询单个工作项详情
curl -X GET "$TIDE_API_URL/api/work-items/wi_abc123" \
  -H "Authorization: Bearer $TIDE_API_TOKEN"

# 查询工作项流转历史
curl -X GET "$TIDE_API_URL/api/work-items/wi_abc123/transitions" \
  -H "Authorization: Bearer $TIDE_API_TOKEN"
```

**列表响应格式**：

```json
[
  {
    "id": "wi_abc123",
    "title": "实现邮箱注册功能",
    "status": "in_progress",
    "priority": 2,
    "assignee": "dev01",
    "tags": ["注册"],
    "created_by": "user_456",
    "planned_start_date": "2025-01-05T00:00:00Z",
    "planned_end_date": "2025-01-15T00:00:00Z",
    "created_at": "2025-01-01T00:00:00Z",
    "updated_at": "2025-01-02T00:00:00Z"
  }
]
```

> 补充字段说明：
> - `created_by` — 创建人 user_id（可为 null，旧数据兼容）
> - `planned_start_date` — 计划开始时间（ISO 8601 格式，可为 null）
> - `planned_end_date` — 计划结束时间（ISO 8601 格式，可为 null）

**流转历史响应格式**：

```json
[
  {
    "from_status": "active",
    "to_status": "in_progress",
    "changed_by": "dev01",
    "operator": "user_abc123",
    "changed_at": "2025-01-02T00:00:00Z",
    "comment": "开始开发"
  }
]
```

> 字段说明：
> - `operator` — 流转操作人标识。用户手动流转记录其 user_id（UUID），系统自动流转（condition/delay/agent_complete）记录 `"Tide"`，审批节点记录审批人的 user_id

#### 查看我的工作项

获取当前用户（API Token 所属用户）被分配的所有工作项。

- **端点**：`GET /api/work-items/assignments/mine`
- **HTTP 方法**：GET

**查询参数**：

| 参数 | 说明 |
|------|------|
| `status` | 状态过滤（可选），可选值同上 |

```bash
# 查看我的所有工作项
curl -X GET "$TIDE_API_URL/api/work-items/assignments/mine" \
  -H "Authorization: Bearer $TIDE_API_TOKEN"

# 按状态过滤我的工作项
curl -X GET "$TIDE_API_URL/api/work-items/assignments/mine?status=in_progress" \
  -H "Authorization: Bearer $TIDE_API_TOKEN"
```

**响应格式**：

```json
[
  {
    "id": "wi_abc123",
    "title": "实现邮箱注册功能",
    "status": "in_progress",
    "priority": 2,
    "assignee": "current_user",
    "tags": ["注册"],
    "created_at": "2025-01-01T00:00:00Z",
    "updated_at": "2025-01-02T00:00:00Z"
  }
]
```

---

### 操作6：更新工作项

更新已有工作项的属性。

- **端点**：`PATCH /api/work-items/{item_id}`
- **HTTP 方法**：PATCH
- **Content-Type**：`application/json`

**请求格式**（所有字段均为可选，仅传需要更新的字段）：

```json
{
  "title": "更新后的标题",
  "description": "更新后的描述",
  "priority": 1,
  "assignee": "dev02",
  "tags": ["紧急", "注册"],
  "metadata": {"review_needed": true}
}
```

```bash
curl -X PATCH "$TIDE_API_URL/api/work-items/wi_abc123" \
  -H "Authorization: Bearer $TIDE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "priority": 1,
    "tags": ["紧急", "注册"]
  }'
```

**响应格式**：

```json
{
  "id": "wi_abc123",
  "title": "实现邮箱注册功能",
  "status": "in_progress",
  "priority": 1,
  "tags": ["紧急", "注册"],
  "updated_at": "2025-01-03T00:00:00Z"
}
```

---

#### 设置计划时间

通过 PATCH 接口更新工作项的计划时间：

```bash
curl -X PATCH "$TIDE_API_URL/api/work-items/{item_id}" \
  -H "Authorization: Bearer $TIDE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "planned_start_date": "2025-01-05T00:00:00Z",
    "planned_end_date": "2025-01-15T00:00:00Z"
  }'
```

参数说明：
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `planned_start_date` | string | 否 | 计划开始时间，ISO 8601 格式 |
| `planned_end_date` | string | 否 | 计划结束时间，ISO 8601 格式 |

---

### 操作7：更新工作项状态

更新工作项的状态（仅适用于 Freeform 协作模式的工作项）。

- **端点**：`PATCH /api/work-items/{item_id}/status`
- **HTTP 方法**：PATCH
- **Content-Type**：`application/json`

**请求格式**：

```json
{
  "status": "completed"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `status` | string | 是 | 目标状态，可选值：`active`、`in_progress`、`completed`、`pending` 等 |

> **注意**：仅 Freeform 模式（`flow_mode` 为 `freeform` 或 `workflow_id` 为 `__freeform__`）的工作项支持手动更新状态。非 Freeform 工作项调用此接口会返回 400 错误。

```bash
# 将工作项标记为已完成
curl -X PATCH "$TIDE_API_URL/api/work-items/wi_abc123/status" \
  -H "Authorization: Bearer $TIDE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "completed"}'

# 将工作项标记为进行中
curl -X PATCH "$TIDE_API_URL/api/work-items/wi_abc123/status" \
  -H "Authorization: Bearer $TIDE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress"}'
```

**响应格式**：

```json
{
  "id": "wi_abc123",
  "title": "实现邮箱注册功能",
  "status": "completed",
  "priority": 2,
  "assignee": "dev01",
  "completed_at": "2025-01-03T00:00:00Z",
  "updated_at": "2025-01-03T00:00:00Z"
}
```

---

### 操作8：获取工作项链接

根据工作项 ID 构造 Web 访问链接，便于分享给他人。

**链接格式**：

```
{TIDE_API_URL}/work-items?detail={item_id}
```

> 其中 `TIDE_API_URL` 为环境变量配置的平台地址（默认 `https://storming.ebonex.io/tide`），`item_id` 为工作项的唯一标识（如 `wi_abc123`）。

**使用方式**：

- 创建工作项后，从 API 返回的 `id` 字段直接构造链接
- 查询工作项后，从列表结果中的 `id` 字段构造链接
- 无需额外 API 调用，纯客户端拼接即可

**示例**：

假设创建工作项后 API 返回 `"id": "wi_abc123"`，则该工作项的 Web 链接为：

```
https://storming.ebonex.io/tide/work-items?detail=wi_abc123
```

用户可直接在浏览器中打开此链接查看工作项详情，也可将链接发送给团队成员。

```bash
# 示例：创建工作项后构造链接
ITEM_ID="wi_abc123"  # 从创建/查询 API 返回的 id
echo "$TIDE_API_URL/work-items?detail=$ITEM_ID"
```

---

### 甘特视图

Web 工作台工作项页面支持甘特视图模式，以时间轴形式展示工作项的计划时间范围。使用前需为工作项设置 `planned_start_date` 和 `planned_end_date`。

甘特视图特性：
- 按时间轴横向排列工作项
- 支持日/周/月三种时间粒度切换
- 按优先级颜色区分（紧急红色、高橙色、中蓝色、低灰色）
- 点击甘特条可查看工作项详情

## 认证

所有 API 请求必须携带认证 Header：

```
Authorization: Bearer <TIDE_API_TOKEN>
```

curl 示例中统一使用环境变量：

```bash
curl -H "Authorization: Bearer $TIDE_API_TOKEN" "$TIDE_API_URL/api/..."
```

Token 获取方式：
1. 登录 Tide 平台
2. 进入 **个人设置 → API Token**
3. 点击"创建 Token"，复制生成的 Token
4. 设置环境变量：`export TIDE_API_TOKEN="your-token-here"`

## 关键行为规则

### 规则1：项目与项目组的正确使用

当用户指定了**项目组**（如"在 FMS 项目组创建"）时：
1. 调用 `GET /api/project-groups?workspace_id=default` 通过名称匹配获取 `group_id`
2. 调用 `GET /api/project-groups/{group_id}` 获取项目组详情
3. 从返回的 `members` 列表中获取 `project_id`：
   - 优先选择 `role` 为 `"primary"` 的成员的 `project_id`
   - 若无 primary 成员，使用列表第一个成员的 `project_id`
4. 创建工作项时**同时传入** `project_id` 和 `group_id`

> 这样创建的工作项归属于项目组级别，只在项目组视图中展示，不会出现在子项目的工作项列表中。

当用户指定了**具体项目**（如"在 fms-web 项目创建"）时：
1. 调用 `GET /api/projects` 通过名称匹配获取 `project_id`
2. `group_id` 设为 `null`（不传或传 null）

⚠️ **严禁**将"项目组"降级为某个子项目。用户说"项目组"时，必须同时传 `group_id`，工作项才会正确归属于项目组。

### 规则2：工作项初始状态

- 工作项创建后，后端**自动**根据项目绑定的工作流设置初始状态：
  - 首个节点类型为 `stage` → status = "pending"
  - 首个节点类型为 `agent` → status = "in_progress"
  - 首个节点类型为 `approval` → status = "pending_approval"
- **无需**在创建请求中手动设置 status 字段（工作流模式下会被忽略）
- 初始状态取决于 `project_id` 对应项目绑定的工作流，所以选择正确的项目至关重要
- 在 Freeform 模式下（无工作流），初始状态取状态列表的第一列

### 规则3：默认负责人

- `assignee` 字段接受 **display_name 或 username**（不是 user_id）
- 调用 `GET /api/auth/me` 获取当前用户信息后，使用 `display_name` 字段值（如"赵海风"）作为 assignee
- 如果 `display_name` 为空，使用 `username` 字段值
- **绝不要使用 `id` 字段**（UUID格式）作为 assignee
- 如果用户明确指定了负责人姓名，直接使用该姓名

### 规则4：创建前确认

在调用创建 API 之前，**必须**先向用户展示关键信息并请求确认：

**展示格式**：
```
📋 即将创建工作项：
- 归属：[项目组名称] 或 [项目名称]
- 负责人：[display_name]
- 工作项列表：
  1. [标题] | 优先级: [P0/P1/P2/P3] | 描述摘要
  2. ...
- 总计：N 条
```

**确认流程**：
1. 列出上述信息
2. 询问用户"确认创建？"
3. **用户明确确认后**才调用 API 创建
4. 创建完成后返回结果（包含工作项 ID、标题、状态、负责人、链接）

⚠️ 未经用户确认，**绝不**直接调用创建 API。

## 执行流程

### 流程A：从需求文档创建工作项（推荐）

适用于用户提供需求文档、PRD、或自然语言描述的场景。

1. **获取当前用户**：调用 `GET /api/auth/me` 获取当前用户信息，使用 `display_name` 作为默认负责人（`display_name` 为空时用 `username`）
2. **判断项目 vs 项目组**：分析用户表述——
   - 若用户说"项目组"（如"在 FMS 项目组创建"）→ 调用 `GET /api/project-groups?workspace_id=default` 通过 `name` 匹配获取 `group_id`，再调用 `GET /api/project-groups/{group_id}` 获取 `members` 列表，自动选取 `role` 为 `"primary"` 的成员的 `project_id`（若无 primary 则用第一个成员的 `project_id`）
   - 若用户说"项目"（如"在 fms-web 项目创建"）→ 调用 `GET /api/projects` 通过 `name` 匹配获取 `project_id`，无需 `group_id`
3. **读取需求**：获取用户提供的需求文件内容或文本描述
4. **智能分解**：调用 `POST /api/work-items/ai-decompose` 进行 AI 智能分解
5. **展示确认**（规则4）：将关键信息列出，包括归属（项目组/项目）、负责人、每条工作项标题/优先级/描述摘要，询问用户"确认创建？"
6. **用户确认**：用户明确确认后才继续，否则根据用户反馈修改
7. **批量创建**：调用 `POST /api/work-items/batch` 批量写入（若有 `group_id` 则传入；`assignee` 默认设为当前用户的 `display_name`）
8. **返回结果**：展示创建结果，包括：
   - 成功创建的工作项 ID、标题、状态、负责人及 Web 链接（格式：`$TIDE_API_URL/work-items?detail={item_id}`）
   - 失败项的错误详情
   - 汇总信息（共 N 项，成功 M 项，失败 K 项）

### 流程B：从结构化列表创建

适用于用户已经有清晰的任务列表（YAML/JSON 格式）的场景。

1. **获取当前用户**：调用 `GET /api/auth/me` 获取当前用户信息，使用 `display_name` 作为默认负责人（`display_name` 为空时用 `username`）
2. **判断项目 vs 项目组**：分析用户表述——
   - 若用户说"项目组"→ 调用 `GET /api/project-groups?workspace_id=default` 通过 `name` 匹配获取 `group_id`，再调用 `GET /api/project-groups/{group_id}` 获取 `members` 列表，自动选取 `role` 为 `"primary"` 的成员的 `project_id`（若无 primary 则用第一个成员的 `project_id`）
   - 若用户说"项目"→ 调用 `GET /api/projects` 通过 `name` 匹配获取 `project_id`，无需 `group_id`
3. **解析列表**：解析用户提供的 YAML/JSON 格式需求列表
4. **展示确认**（规则4）：将关键信息列出，包括归属、负责人、每条工作项标题/优先级/描述摘要，询问用户"确认创建？"
5. **用户确认**：用户明确确认后才继续
6. **批量创建**：调用 `POST /api/work-items/batch` 批量创建（若有 `group_id` 则传入；`assignee` 默认设为当前用户的 `display_name`）
7. **返回结果**：展示创建结果，包括工作项 ID、标题、状态、负责人及 Web 链接（格式：`$TIDE_API_URL/work-items?detail={item_id}`）

示例输入（YAML）：

```yaml
- title: 用户注册功能
  description: 支持邮箱和手机号注册
  priority: 2
  tags: [注册, 用户]
- title: 用户登录功能
  description: 支持密码和验证码登录
  priority: 2
  tags: [登录, 用户]
```

### 流程C：追踪工作项进展

适用于用户要查看项目工作项状态的场景。

1. **查询列表**：调用 `GET /api/work-items?project_id=X` 获取项目所有工作项
2. **查看我的工作项**：可通过 `GET /api/work-items/assignments/mine` 查看专属于自己的工作项清单
3. **分组展示**：按状态分组展示：
   - 🟡 待处理（pending）
   - 🔵 进行中（in_progress）
   - 🟢 已完成（completed）
   - 🔴 失败（failed）
4. **查看详情**：对用户关注的工作项，调用 `GET /api/work-items/{item_id}/transitions` 查询流转历史
5. **更新状态**：可通过 `PATCH /api/work-items/{item_id}/status` 更新工作项状态（仅限 Freeform 模式）

## 错误处理

| HTTP 状态码 | 含义 | 处理策略 |
|-------------|------|----------|
| `401` | Token 无效或过期 | 引导用户重新生成 API Token（个人设置 → API Token） |
| `403` | 无权限 | 检查用户是否有该项目的访问权限，引导联系项目管理员 |
| `404` | 资源不存在 | 检查 `project_id` 或 `item_id` 是否正确，建议重新调用项目列表获取 |
| `400` | 参数错误 | 检查必填字段是否遗漏（如 `title`、`project_id`），检查字段格式 |
| `502` | AI 分解服务不可用 | 建议降级为手动结构化创建（跳过 ai-decompose，直接使用流程B） |

## 安装说明

### Qoder Agent

```bash
# 项目级（推荐）- 将 skills/tide-workitems/ 放在项目根目录
# Skill 会自动被识别

# 或全局安装
npx skills add ./skills/tide-workitems -g
```

### Claude Code

将 SKILL.md 内容加入 `.claude/commands/tide-workitems.md`：

```bash
mkdir -p .claude/commands
cp skills/tide-workitems/SKILL.md .claude/commands/tide-workitems.md
```

### Cursor

将 SKILL.md 内容复制到 `.cursorrules` 或 `.cursor/rules/tide-workitems.md`：

```bash
mkdir -p .cursor/rules
cp skills/tide-workitems/SKILL.md .cursor/rules/tide-workitems.md
```

### Tide ECC（平台级注入）

```bash
python3 -m backend.scripts.import_ecc_skills skills/tide-workitems/ --workspace default
```
