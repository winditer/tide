# 测试覆盖图谱

> 生成时间: 2026-06-26T03:00:00Z | 测试文件: 0 | 测试用例: 0

## 测试文件清单

| 文件 | 测试用例数 | 覆盖目标 |
|------|------------|----------|
| `` | 0 | `backend.main:app`, `backend.api.tasks`, `backend.services.task_service` |
| `` | 0 | `backend.db.engine.init_db` |
| `` | 0 | `backend.runtime.git_utils` |
| `` | 0 | `backend.services.workflow_engine git merge 节点` |
| `` | 0 | `backend.api.kanban`, `backend.services.kanban_service` |
| `` | 0 | `backend.core.dependencies`, `backend.services.auth_service` |
| `` | 0 | `backend.services.plan_service` |
| `` | 0 | `backend.services.project_group_service`, `backend.services.plan_service` |
| `` | 0 | `backend.api.projects` |
| `` | 0 | `backend.services.schedule_service:ScheduleService` |
| `` | 0 | `backend.services.task_service` |
| `` | 0 | `backend.services.work_item_service:WorkItemService` |
| `` | 0 | `backend.services.workflow_engine:WorkflowEngine` |
| `` | 0 | `backend.services.ws_hub:WSHub` |
| `` | 0 | `tide_ws.py (deprecated)` |

## 覆盖缺口

以下核心模块/服务/API 缺少对应测试：

- **** (high): JWT 登录 / 刷新 / OAuth 流程缺直接单元测试
- **** (high): 审批生命周期未覆盖
- **** (high): Plan 异步执行/恢复/失败重试无单测
- **** (high): Lark 桥接整链缺单测，仅 tide_ws 时代旧测试
- **** (medium): 事件发射 / DB 写入路径缺单测
- **** (medium): Hook 触发 / security alert 缺单测
- **** (medium): 知识库读取/生成路径缺单测
- **** (medium): 安全 / 规则 / 技能服务缺单测
- **** (low): tiktoken 计费路径缺单测
- **** (medium): 会话状态/归档逻辑缺单测
- **** (medium): 扫描/发现服务缺单测
- **** (high): auth/admin/agents/approvals/conversations/dashboard/events/files/git_audit/hooks/knowledge/lark_*/plans/projects/project_groups/project_members/remote_agents/rules/schedules/security/sessions/skills/versions/work_items/workflows/ws 等路由无端到端测试
- **** (high): 无 jest/vitest 配置，前端组件/hook 完全无单测
- **** (medium): 独立 FastAPI 服务无单测
