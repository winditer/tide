export const API_TOKENS_GUIDE = `# API Token 使用指南

## 一、什么是 API Token

API Token 是一种长期有效的身份凭证，允许你通过编程方式（脚本、CI/CD、第三方应用）安全地调用 Tide 平台 API，无需使用用户名密码。

**适用场景：**
- 自动化脚本调用 API 管理任务
- CI/CD 流水线触发工作流或定时调度
- 外部系统集成（如企业内部工具对接）
- 数据导出和批量操作

## 二、创建和管理 Token

### 创建 Token
1. 点击「生成新 Token」按钮
2. 输入 Token 名称（建议使用有意义的名称，如"CI 部署脚本"）
3. 设置过期天数（留空则永不过期）
4. 点击确认，**立即复制并妥善保存明文 Token**

> ⚠️ Token 明文仅在创建时展示一次，之后无法再次查看。请务必在创建后立即保存。

### 管理 Token
- 查看已创建的 Token 列表（仅展示前缀用于识别）
- 删除不再使用的 Token

## 三、如何使用 API Token

### 认证方式

所有 API 请求需在 HTTP Header 中携带 Token：

\`\`\`
Authorization: Bearer <你的API Token>
\`\`\`

### curl 示例

\`\`\`bash
# 获取当前用户信息
curl -H "Authorization: Bearer YOUR_TOKEN" \\
  http://localhost:12321/api/auth/me

# 获取任务列表
curl -H "Authorization: Bearer YOUR_TOKEN" \\
  http://localhost:12321/api/tasks

# 创建任务
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"prompt": "检查代码规范", "agent_id": "qoder", "cwd": "/path/to/project"}' \\
  http://localhost:12321/api/tasks
\`\`\`

### Python 示例

\`\`\`python
import requests

BASE_URL = "http://localhost:12321"
TOKEN = "YOUR_TOKEN"
headers = {"Authorization": f"Bearer {TOKEN}"}

# 获取项目列表
resp = requests.get(f"{BASE_URL}/api/projects", headers=headers)
projects = resp.json()

# 创建工作项
resp = requests.post(f"{BASE_URL}/api/work-items", headers=headers, json={
    "title": "修复登录页面样式",
    "description": "按钮在移动端显示异常",
    "project_id": "your-project-id"
})
\`\`\`

### JavaScript / Node.js 示例

\`\`\`javascript
const BASE_URL = "http://localhost:12321";
const TOKEN = "YOUR_TOKEN";

// 获取任务详情
const res = await fetch(\`\${BASE_URL}/api/tasks/\${taskId}\`, {
  headers: { "Authorization": \`Bearer \${TOKEN}\` }
});
const task = await res.json();

// 触发定时调度
await fetch(\`\${BASE_URL}/api/schedules/\${scheduleId}/trigger\`, {
  method: "POST",
  headers: { "Authorization": \`Bearer \${TOKEN}\` }
});
\`\`\`

## 四、常用 API 接口参考

### 任务管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/tasks | 任务列表 |
| POST | /api/tasks | 创建任务 |
| GET | /api/tasks/{id} | 任务详情 |
| POST | /api/tasks/{id}/approve | 审批通过 |
| POST | /api/tasks/{id}/reject | 审批拒绝 |
| POST | /api/tasks/{id}/retry | 重试任务 |
| POST | /api/tasks/{id}/stop | 停止任务 |

### 工作项管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/work-items | 工作项列表 |
| POST | /api/work-items | 创建工作项 |
| GET | /api/work-items/{id} | 工作项详情 |
| PUT | /api/work-items/{id} | 更新工作项 |
| POST | /api/work-items/{id}/transition | 状态流转 |

### 项目管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/projects | 项目列表 |
| POST | /api/projects | 创建项目 |
| GET | /api/projects/{id} | 项目详情 |
| PUT | /api/projects/{id} | 更新项目 |

### 工作流

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/workflows | 工作流列表 |
| POST | /api/workflows | 创建工作流 |
| POST | /api/workflows/{id}/run | 触发执行 |
| POST | /api/workflows/{id}/cancel | 取消执行 |

### 定时调度

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/schedules | 调度列表 |
| POST | /api/schedules | 创建调度 |
| POST | /api/schedules/{id}/toggle | 启停切换 |
| POST | /api/schedules/{id}/trigger | 手动触发 |
| GET | /api/schedules/{id}/runs | 执行历史 |

### Plan 计划

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/plans | 计划列表 |
| POST | /api/plans | 创建计划 |
| GET | /api/plans/{id} | 计划详情 |
| GET | /api/plans/{id}/dag | DAG 结构 |

### 会话

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/sessions | 会话列表 |
| POST | /api/sessions | 创建会话 |
| GET | /api/sessions/{id} | 会话详情 |

### 统计

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/dashboard/* | 各类统计数据 |

## 五、安全最佳实践

1. **妥善保管 Token** — 不要将 Token 硬编码在代码中，使用环境变量存储
2. **设置过期时间** — 建议为每个 Token 设置合理的过期时间
3. **最小权限** — 为不同用途创建不同的 Token，便于独立管理和撤销
4. **定期轮换** — 定期删除旧 Token 并创建新 Token
5. **监控使用** — 关注 Token 的"最后使用时间"，删除不再活跃的 Token

## 六、常见问题

**Q: Token 丢失了怎么办？**
A: Token 明文无法恢复，请删除该 Token 并重新创建一个。

**Q: 请求返回 401 Unauthorized？**
A: 请检查：1) Token 是否已过期；2) Header 格式是否正确（注意 Bearer 后有一个空格）；3) Token 是否已被删除。

**Q: 可以创建多个 Token 吗？**
A: 可以。建议为不同场景创建独立的 Token，方便管理和撤销。
`;
