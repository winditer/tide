// Auto-generated from SCHEDULES.md — keep in sync with the source markdown file.
export const SCHEDULES_GUIDE = `# 定时调度（Schedules）使用说明

## 一、概述

定时调度（Schedules）是 Tide 提供的**任务自动化触发能力**，基于 APScheduler 实现，可在指定时间点或按周期自动执行 Agent 任务、Plan 计划、工作流（Workflow）、状态查询或自定义脚本。

调度元数据持久化在 SQLite \`schedules\` 表中，每次执行都会在 \`schedule_runs\` 表生成执行记录，并通过 WebSocket（\`schedules\` 频道）实时广播 \`schedule.run.started\` / \`schedule.run.completed\` 事件。后端服务启动时会自动从数据库恢复所有 \`enabled = 1\` 的调度任务。

典型应用场景：

- 每天定时让 Codex / Claude 跑代码检查、生成日报；
- 每隔几分钟轮询项目/任务状态并推送通知；
- 在指定时间点触发一次性的工作流，例如发布前的回归任务；
- 周期性调用外部 webhook 或本地脚本进行运维巡检。

调度任务由两部分配置组成：

- **触发器（trigger）**：决定**何时触发**，由 \`trigger_type\` + \`trigger_config\` 描述；
- **任务（task）**：决定**触发后执行什么**，由 \`task_type\` + \`task_config\` 描述。

---

## 二、触发类型（trigger_type）

\`trigger_type\` 取值受限于：\`cron\` | \`interval\` | \`date\`（在 \`ScheduleCreate\` 中校验）。

### 1. cron — Cron 表达式

按标准 Cron 表达式触发，最常用，支持任意周期组合。\`trigger_config\` 必填字段：

- \`cron\`：5 段（\`分 时 日 月 周\`）或 6 段（\`秒 分 时 日 月 周\`）Cron 表达式；
- \`timezone\`：时区字符串，建议使用 \`Asia/Shanghai\`，前端默认值即为该时区。

格式示例：

\`\`\`json
{
  "cron": "0 9 * * 1-5",
  "timezone": "Asia/Shanghai"
}
\`\`\`

常见用法：

| Cron 表达式      | 含义                       |
|------------------|----------------------------|
| \`0 9 * * *\`      | 每天上午 9:00              |
| \`0 9 * * 1-5\`    | 工作日（周一~周五）上午 9:00 |
| \`*/30 * * * *\`   | 每 30 分钟一次             |
| \`0 */2 * * *\`    | 每 2 小时整点              |
| \`0 0 1 * *\`      | 每月 1 号 0 点             |

> 提示：未传 \`timezone\` 时后端默认使用 \`UTC\`，如未设置极易导致执行时间偏移，**强烈建议显式传入时区**。

### 2. interval — 固定间隔

按固定时间间隔重复执行。\`trigger_config\` 支持的字段：\`weeks\`、\`days\`、\`hours\`、\`minutes\`、\`seconds\`，至少有一项 > 0。

格式示例：

\`\`\`json
{
  "hours": 1,
  "minutes": 30
}
\`\`\`

常见用法：

\`\`\`json
// 每 30 分钟执行一次
{ "minutes": 30 }
\`\`\`

\`\`\`json
// 每 2 小时执行一次
{ "hours": 2 }
\`\`\`

\`\`\`json
// 每天执行一次（24 小时间隔）
{ "hours": 24 }
\`\`\`

> 提示：当所有间隔字段都未传时，后端会回退为默认 \`seconds=3600\`（即 1 小时）。前端表单仅暴露 \`hours\` 与 \`minutes\`，更细的粒度需通过 API 直接传参。

### 3. date — 指定时间（一次性）

在指定时间点触发**一次**，触发完成后任务即结束。\`trigger_config\` 必填：

- \`run_at\`：ISO 8601 格式时间字符串，建议带时区偏移。

格式示例：

\`\`\`json
{
  "run_at": "2025-06-15T14:30:00"
}
\`\`\`

带时区的推荐写法：

\`\`\`json
{
  "run_at": "2026-06-10T09:00:00+08:00"
}
\`\`\`

常见用法：

- 在版本发布前的固定时刻触发回归测试工作流；
- 安排一次性的数据迁移、报表生成任务；
- 手动配合 \`trigger\` 接口模拟"延后 N 分钟执行"。

---

## 三、任务类型（task_type）

\`task_type\` 取值受限于：\`agent\` | \`plan\` | \`workflow\` | \`status\` | \`custom\`。每种类型的 \`task_config\` 字段不同。

### 1. agent — 执行 Agent 任务

调用 \`task_service.create_task()\` 创建一条单独的 Agent 对话任务。常用字段：

- \`prompt\`：传给 Agent 的提示词（必填，未传时回退为 \`"Scheduled task"\`）；
- \`agent_id\`：Agent 标识，默认 \`codex\`，可选 \`claude\`、\`qoder\` 等；
- \`model\`：模型名（可选）；
- \`cwd\`：执行目录（可选，未填则使用调度所属 workspace 的默认目录）。

\`\`\`json
{
  "agent_id": "codex",
  "prompt": "请检查最近一次提交是否引入了潜在 bug，并输出报告"
}
\`\`\`

### 2. plan — 执行 Plan 计划

通过 \`plan_service.create_plan()\` 触发一份 Plan（多步骤/可并行的任务编排）。\`task_config\` 字段：

- \`definition\`：完整 Plan 定义对象（包含 \`tasks\` 数组与 \`max_parallel\`）；
- 若未提供 \`definition\`，后端会用以下字段**自动包一层单任务 Plan**：
  - \`prompt\`、\`agent_id\`、\`max_parallel\`、\`cwd\`、\`model\`。

\`\`\`json
{
  "plan_id": "xxx",
  "definition": {
    "max_parallel": 2,
    "tasks": [
      { "prompt": "任务 A", "agent_id": "codex" },
      { "prompt": "任务 B", "agent_id": "claude" }
    ]
  }
}
\`\`\`

最简写法（自动包一层单任务）：

\`\`\`json
{
  "prompt": "执行例行检查",
  "agent_id": "codex"
}
\`\`\`

### 3. workflow — 执行工作流

通过 \`workflow_engine.start_run()\` 触发一次 DAG 工作流执行，常用于多 Agent 协同或需要条件路由的复杂流程。\`task_config\` 字段：

- \`workflow_id\`：**必填**，要触发的 Workflow ID；
- \`input_context\`：传给工作流的初始上下文对象（可选）。

\`\`\`json
{
  "workflow_id": "xxx",
  "input_context": {
    "branch": "main",
    "report_to": "lark"
  }
}
\`\`\`

> 触发器类型默认会被记录为 \`"schedule"\`，便于在 Workflow 运行历史中筛选。

### 4. status — 状态查询

用于**定时巡检项目/任务状态**并生成报告。当前实现复用 Agent 任务通道，把 \`prompt\` 投递给指定 Agent，由 Agent 完成查询与报告生成。\`task_config\` 字段：

- \`query\`：查询类型语义化标识（如 \`project_summary\`、\`task_health\` 等，由调用方约定）；
- \`project_id\`：关联项目 ID；
- \`prompt\`、\`agent_id\`、\`model\`、\`cwd\`：与 \`agent\` 类型一致，可定制查询逻辑。

\`\`\`json
{
  "query": "project_summary",
  "project_id": "xxx",
  "agent_id": "codex",
  "prompt": "汇总该项目本周的任务完成情况，并输出 Markdown 报告"
}
\`\`\`

### 5. custom — 自定义

灵活的兜底类型，支持自定义脚本命令或 webhook 回调。当前后端实现也是复用 Agent 通道（把 \`prompt\` 派发给指定 Agent），并允许通过 \`script\` / \`webhook_url\` 等字段携带自定义参数，由 Agent 或下游适配器执行。

\`\`\`json
{
  "script": "python check.py"
}
\`\`\`

或：

\`\`\`json
{
  "webhook_url": "https://example.com/api/notify"
}
\`\`\`

也可结合 \`prompt\` + \`agent_id\` 让 Agent 自己执行该 \`script\` 或调用该 \`webhook_url\`：

\`\`\`json
{
  "agent_id": "codex",
  "prompt": "请执行命令: python check.py，并把输出 POST 到 https://example.com/api/notify",
  "script": "python check.py",
  "webhook_url": "https://example.com/api/notify"
}
\`\`\`

---

## 四、常见配置范例

### 范例 1：每天早上 9 点用 codex 执行代码检查

\`\`\`json
{
  "name": "每日代码检查",
  "description": "每个工作日 9 点对 main 分支进行静态检查",
  "trigger_type": "cron",
  "trigger_config": {
    "cron": "0 9 * * 1-5",
    "timezone": "Asia/Shanghai"
  },
  "task_type": "agent",
  "task_config": {
    "agent_id": "codex",
    "prompt": "请检查 main 分支最近 24 小时的变更，输出潜在风险与建议",
    "cwd": "/Users/haifeng/Documents/tide"
  }
}
\`\`\`

### 范例 2：每隔 2 小时查询项目状态

\`\`\`json
{
  "name": "项目状态巡检",
  "trigger_type": "interval",
  "trigger_config": {
    "hours": 2
  },
  "task_type": "status",
  "task_config": {
    "query": "project_summary",
    "project_id": "proj-001",
    "agent_id": "codex",
    "prompt": "查询项目 proj-001 当前任务状态，列出阻塞任务并给出建议"
  }
}
\`\`\`

### 范例 3：指定时间触发一次性工作流

\`\`\`json
{
  "name": "发布前回归",
  "trigger_type": "date",
  "trigger_config": {
    "run_at": "2026-06-15T14:30:00+08:00"
  },
  "task_type": "workflow",
  "task_config": {
    "workflow_id": "wf-release-regression",
    "input_context": {
      "version": "v1.2.0",
      "branch": "release/1.2"
    }
  }
}
\`\`\`

### 范例 4：每 30 分钟回调 webhook

\`\`\`json
{
  "name": "心跳通知",
  "trigger_type": "interval",
  "trigger_config": { "minutes": 30 },
  "task_type": "custom",
  "task_config": {
    "agent_id": "codex",
    "prompt": "请向 https://example.com/api/heartbeat 发送一次 POST 心跳",
    "webhook_url": "https://example.com/api/heartbeat"
  }
}
\`\`\`

---

## 五、API 接口

所有接口前缀为 \`/api/schedules\`。

| 方法     | 路径                              | 说明                                  |
|----------|-----------------------------------|---------------------------------------|
| \`POST\`   | \`/api/schedules\`                  | **创建**调度（body: \`ScheduleCreate\`）|
| \`GET\`    | \`/api/schedules?workspace_id=...\` | **列表**查询，按 \`workspace_id\` 过滤  |
| \`GET\`    | \`/api/schedules/{schedule_id}\`    | 查询**详情**                          |
| \`PUT\`    | \`/api/schedules/{schedule_id}\`    | **更新**调度（body: \`ScheduleUpdate\`）|
| \`DELETE\` | \`/api/schedules/{schedule_id}\`    | **删除**调度（同时移除 APScheduler job）|
| \`POST\`   | \`/api/schedules/{schedule_id}/toggle\`  | **启停切换** \`enabled\` 字段       |
| \`POST\`   | \`/api/schedules/{schedule_id}/trigger\` | **手动触发**一次（异步执行）       |
| \`GET\`    | \`/api/schedules/{schedule_id}/runs?limit=20\` | 查询**执行历史**（最多 100 条）|

### 创建调度示例

\`\`\`bash
curl -X POST http://localhost:8000/api/schedules \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "每日代码检查",
    "trigger_type": "cron",
    "trigger_config": {"cron": "0 9 * * 1-5", "timezone": "Asia/Shanghai"},
    "task_type": "agent",
    "task_config": {"agent_id": "codex", "prompt": "执行代码检查"},
    "workspace_id": "default"
  }'
\`\`\`

### 手动触发示例

\`\`\`bash
curl -X POST http://localhost:8000/api/schedules/{schedule_id}/trigger
\`\`\`

### 查询执行历史示例

\`\`\`bash
curl "http://localhost:8000/api/schedules/{schedule_id}/runs?limit=20"
\`\`\`

返回示例：

\`\`\`json
{
  "items": [
    {
      "id": "run-uuid",
      "schedule_id": "sched-uuid",
      "task_id": "task-uuid",
      "status": "completed",
      "trigger_type": "cron",
      "started_at": "2026-06-10T01:00:00Z",
      "completed_at": "2026-06-10T01:00:12Z",
      "result": "{\\"task_id\\": \\"task-uuid\\"}",
      "error": null
    }
  ],
  "total": 1
}
\`\`\`

> 实时事件可订阅 WebSocket \`schedules\` 频道，接收 \`schedule.run.started\` 与 \`schedule.run.completed\` 消息，前端列表/详情会自动刷新执行状态。
`;
