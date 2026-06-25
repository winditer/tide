# API 接口图谱

> 生成时间: 2026-06-24T02:53:15Z | Router: 26 | Endpoint: 188

> 方法分布: `DELETE`: 19 | `GET`: 87 | `PATCH`: 3 | `POST`: 63 | `PUT`: 16

## admin

- **prefix**: `/api/admin`
- **tags**: admin
- **file**: `backend/api/admin.py`
- **service**: `backend.services.auth_service`

| 方法 | 路径 | 函数 | 描述 |
|------|------|------|------|
| **GET** | `/api/admin/users` | `list_users` | 列出所有用户，支持搜索 + 分页。 |
| **POST** | `/api/admin/users` | `create_user` | 创建新用户。 |
| **GET** | `/api/admin/users/{user_id}` | `get_user` | 获取单个用户详情。 |
| **PUT** | `/api/admin/users/{user_id}` | `update_user` | 更新用户信息（不允许修改自己的 role/status，避免锁死）。 |
| **DELETE** | `/api/admin/users/{user_id}` | `delete_user` | 删除用户（级联清理 user_sessions / project_members）。 |
| **POST** | `/api/admin/users/{user_id}/reset-password` | `reset_password` | 重置用户密码并吊销该用户全部活跃会话。 |
| **GET** | `/api/admin/users/{user_id}/projects` | `list_user_projects` | 查看用户可访问的项目列表（admin 用户返回 ['*']）。 |

## agents

- **prefix**: `/api/agents`
- **tags**: agents
- **file**: `backend/api/agents.py`

| 方法 | 路径 | 函数 | 描述 |
|------|------|------|------|
| **GET** | `/api/agents` | `list_agents` | 返回可用 Agent 列表 + 运行时状态（含远程 A2A Agent） |

## approvals

- **prefix**: `/api/approvals`
- **tags**: approvals
- **file**: `backend/api/approvals.py`
- **service**: `backend.services.approval_service`

| 方法 | 路径 | 函数 | 描述 |
|------|------|------|------|
| **GET** | `/api/approvals` | `list_approvals` | 列表查询审批记录 |
| **GET** | `/api/approvals/{approval_id}` | `get_approval` | 获取单条审批详情 |
| **POST** | `/api/approvals/{approval_id}/approve` | `approve` | 审批通过。可选 body: { operator_id, comment } |
| **POST** | `/api/approvals/{approval_id}/reject` | `reject` | 审批拒绝。可选 body: { operator_id, comment }（拒绝时建议必填） |

## auth

- **prefix**: `/api/auth`
- **tags**: auth
- **file**: `backend/api/auth.py`
- **service**: `backend.services.auth_service`

| 方法 | 路径 | 函数 | 描述 |
|------|------|------|------|
| **POST** | `/api/auth/login` | `login` | 用户名/密码登录。 |
| **GET** | `/api/auth/lark/authorize` | `lark_authorize` | 构造 Lark OAuth 授权 URL 并 302 跳转。 |
| **GET** | `/api/auth/lark/callback` | `lark_callback` | Lark OAuth 回调：换取 user_info → 创建/更新用户 → 创建会话 → 重定向前端。 |
| **POST** | `/api/auth/refresh` | `refresh` | 用 refresh_token 旋转出新的 access/refresh token。 |
| **POST** | `/api/auth/logout` | `logout` | 登出：吊销当前用户的所有活跃会话。 |
| **GET** | `/api/auth/me` | `me` | 返回当前登录用户的公开信息。 |
| **POST** | `/api/auth/change-password` | `change_password` | 修改当前用户密码。验证旧密码 → 写入新哈希 → 吊销其他会话。 |

## conversations

- **prefix**: `/conversations`
- **tags**: conversations
- **file**: `backend/api/conversations.py`
- **service**: `backend.services.conversation_service`

| 方法 | 路径 | 函数 | 描述 |
|------|------|------|------|
| **GET** | `/conversations` | `list_conversations` | 会话列表 |
| **GET** | `/conversations/{conversation_id}` | `get_conversation` | 会话详情 |
| **POST** | `/conversations/{conversation_id}/close` | `close_conversation` | 关闭会话 |
| **PUT** | `/conversations/{conversation_id}` | `update_conversation` | 更新设置（agent/model/cwd） |

## dashboard

- **prefix**: `/api/dashboard`
- **tags**: dashboard
- **file**: `backend/api/dashboard.py`
- **service**: `backend.services.project_group_service`

| 方法 | 路径 | 函数 | 描述 |
|------|------|------|------|
| **GET** | `/api/dashboard/stats` | `get_stats` | 统计数据：运行中 / 排队中 / 待审批 / 今日完成。 |
| **GET** | `/api/dashboard/recent-tasks` | `get_recent_tasks` | 最近任务列表：合并 DB tasks 与本地 Agent 会话发现结果。 |
| **GET** | `/api/dashboard/active-projects` | `get_active_projects` | 最近活跃项目列表。 |
| **GET** | `/api/dashboard/activity-timeline` | `get_activity_timeline` | 最近系统活动事件时间线（按 task_events.created_at DESC）。 |
| **GET** | `/api/dashboard/task-status-distribution` | `get_task_status_distribution` | 任务状态分布。 |
| **GET** | `/api/dashboard/upcoming-schedules` | `get_upcoming_schedules` | 即将执行的定时调度。 |
| **GET** | `/api/dashboard/work-items` | `get_my_work_items` | 获取当前用户的待办工作项（默认前 10 条）。 |
| **GET** | `/api/dashboard/project-progress` | `get_project_progress` | 获取各项目工作项进度（仅返回总数 > 0 的项目）。 |
| **GET** | `/api/dashboard/group-progress` | `get_group_progress` | 项目组进度汇总：返回当前用户可访问的项目组，含组内工作项总数与已完成数。 |
| **GET** | `/api/dashboard/cost-summary` | `get_cost_summary` | 返回当前 workspace 在指定 period 内的 token 成本汇总。 |
| **GET** | `/api/dashboard/cost-by-dimension` | `get_cost_by_dimension` | 按维度（agent / model / project）聚合 token 成本。 |

## events

- **prefix**: `/api/events`
- **tags**: events
- **file**: `backend/api/events.py`

| 方法 | 路径 | 函数 | 描述 |
|------|------|------|------|
| **GET** | `/api/events` | `get_events` | 获取事件列表（用于重连后补偿） |

## hooks

- **prefix**: `/api/hooks`
- **tags**: hooks
- **file**: `backend/api/hooks.py`
- **service**: `backend.services.hook_engine`

| 方法 | 路径 | 函数 | 描述 |
|------|------|------|------|
| **GET** | `/api/hooks` | `list_hooks` |  |
| **GET** | `/api/hooks/{hook_id}` | `get_hook` |  |
| **POST** | `/api/hooks` | `create_hook` |  |
| **PUT** | `/api/hooks/{hook_id}` | `update_hook` |  |
| **DELETE** | `/api/hooks/{hook_id}` | `delete_hook` |  |

## kanban

- **prefix**: `/api/kanban`
- **tags**: kanban
- **file**: `backend/api/kanban.py`
- **service**: `backend.services.kanban_service`

| 方法 | 路径 | 函数 | 描述 |
|------|------|------|------|
| **GET** | `/api/kanban/projects` | `get_project_board` | 项目看板：按项目状态分列。 |
| **GET** | `/api/kanban/sessions` | `get_session_board` | 会话看板：按 Agent 分组，按任务状态分列。 |
| **GET** | `/api/kanban/agents` | `get_agent_board` | Agent 看板（泳道式）。 |
| **GET** | `/api/kanban/workflows` | `get_workflow_board` | 工作流任务看板。 |
| **POST** | `/api/kanban/move` | `move_card` | 拖拽更新状态。 |
| **GET** | `/api/kanban/work-items` | `get_work_item_board` | 工作项看板：按 workflow 可见节点划列。 |
| **POST** | `/api/kanban/work-items/{item_id}/move` | `move_work_item` | 看板拖拽流转工作项。 |

## knowledge

- **prefix**: `/api/knowledge`
- **tags**: knowledge
- **file**: `backend/api/knowledge.py`
- **service**: `backend.services.knowledge_service`

| 方法 | 路径 | 函数 | 描述 |
|------|------|------|------|
| **GET** | `/api/knowledge/{scope}/{target_id}/files` | `list_files` | 列出仓库 ``.knowledge/`` 下的文件树。 |
| **GET** | `/api/knowledge/{scope}/{target_id}/file` | `read_file` |  |
| **PUT** | `/api/knowledge/{scope}/{target_id}/file` | `write_file` |  |
| **DELETE** | `/api/knowledge/{scope}/{target_id}/file` | `delete_file` |  |
| **POST** | `/api/knowledge/{scope}/{target_id}/generate` | `trigger_generate` | 触发异步生成任务。 |
| **GET** | `/api/knowledge/{scope}/{target_id}/status` | `get_status` |  |
| **GET** | `/api/knowledge/{scope}/{target_id}/export` | `export_knowledge` | 导出 .knowledge/ 目录为 zip 压缩包下载。 |

## lark_bridge

- **prefix**: `/api/lark`
- **tags**: lark
- **file**: `backend/api/lark_bridge.py`
- **service**: `backend.services.lark_bridge`

| 方法 | 路径 | 函数 | 描述 |
|------|------|------|------|
| **POST** | `/api/lark/notify` | `lark_notify` | tide_ws.py 在任务创建/状态变更后调用此接口。 |
| **GET** | `/api/lark/status` | `lark_status` | 查询 Lark Bridge 连接状态。 |

## lark_callback

- **prefix**: `/api/lark`
- **tags**: lark
- **file**: `backend/api/lark_callback.py`
- **service**: `backend.services.card_action_handler`

| 方法 | 路径 | 函数 | 描述 |
|------|------|------|------|
| **POST** | `/api/lark/card-action` | `lark_card_action` | Lark 卡片按钮回调 webhook。 |

## plans

- **prefix**: `/api/plans`
- **tags**: plans
- **file**: `backend/api/plans.py`
- **service**: `backend.services.plan_service`

| 方法 | 路径 | 函数 | 描述 |
|------|------|------|------|
| **POST** | `/api/plans` | `create_plan` | 创建 Plan |
| **GET** | `/api/plans` | `list_plans` | Plan 列表 |
| **GET** | `/api/plans/{plan_id}` | `get_plan` | Plan 详情 |
| **POST** | `/api/plans/{plan_id}/stop` | `stop_plan` | 停止 Plan |
| **GET** | `/api/plans/{plan_id}/tasks` | `get_plan_tasks` | Plan 子任务列表 |
| **POST** | `/api/plans/{plan_id}/tasks/{task_id}/retry` | `retry_plan_task` | 重试子任务 |
| **POST** | `/api/plans/{plan_id}/tasks/{task_id}/approve` | `approve_plan_task` | 审批子任务：使用 approved 模式重启。 |
| **POST** | `/api/plans/{plan_id}/tasks/{task_id}/commit` | `commit_plan_task` | 提交 / 跳过子任务的改动。 |
| **POST** | `/api/plans/{plan_id}/tasks/{task_id}/merge` | `merge_plan_task` | cherry-pick 合并单个已提交的子任务。 |
| **POST** | `/api/plans/{plan_id}/merge-all` | `merge_all_plan_tasks` | 按依赖顺序合并所有 committed 子任务。 |
| **GET** | `/api/plans/{plan_id}/dag` | `get_plan_dag` | Plan DAG 结构（React Flow 格式） |
| **GET** | `/api/plans/{plan_id}/timeline` | `get_plan_timeline` | Plan Gantt 时间线数据 |

## project_groups

- **prefix**: `/api/project-groups`
- **tags**: project-groups
- **file**: `backend/api/project_groups.py`
- **service**: `backend.services.project_group_service`

| 方法 | 路径 | 函数 | 描述 |
|------|------|------|------|
| **GET** | `/api/project-groups` | `list_project_groups` | 列出当前 workspace 的项目组（受用户成员过滤）。 |
| **POST** | `/api/project-groups` | `create_project_group` | 创建项目组。创建后自动将当前用户加为 owner。 |
| **GET** | `/api/project-groups/{group_id}` | `get_project_group` | 获取项目组详情（含成员列表）。 |
| **PUT** | `/api/project-groups/{group_id}` | `update_project_group` | 更新项目组。 |
| **DELETE** | `/api/project-groups/{group_id}` | `delete_project_group` | 删除项目组。 |
| **POST** | `/api/project-groups/{group_id}/members` | `add_group_member` | 添加成员项目到项目组。 |
| **DELETE** | `/api/project-groups/{group_id}/members/{project_id}` | `remove_group_member` | 从项目组移除成员项目。 |
| **GET** | `/api/project-groups/{group_id}/conversations` | `list_group_conversations` | 聚合项目组内所有项目的会话（按 tasks.session_id 聚合）。 |
| **GET** | `/api/project-groups/{group_id}/tasks` | `list_group_tasks` | 聚合项目组内所有项目的任务。 |
| **GET** | `/api/project-groups/{group_id}/versions` | `list_group_versions` | 聚合项目组内所有项目的版本（按 created_at 倒序）。 |
| **GET** | `/api/project-groups/{group_id}/workflow` | `get_group_workflow` | 查询项目组绑定的工作流。返回绑定信息及工作流名称（若存在）。 |
| **PUT** | `/api/project-groups/{group_id}/workflow` | `set_group_workflow` | 设置项目组绑定的工作流。body: ``{"workflow_id": "xxx"}``。 |
| **DELETE** | `/api/project-groups/{group_id}/workflow` | `unset_group_workflow` | 解除项目组的工作流绑定。 |
| **GET** | `/api/project-groups/{group_id}/users` | `list_group_user_members` | 列出项目组用户成员（JOIN users 返回用户信息）。 |
| **POST** | `/api/project-groups/{group_id}/users` | `add_group_user_member` | 添加用户成员。body: ``{user_id: str, role?: str}``。 |
| **PUT** | `/api/project-groups/{group_id}/users/{user_id}` | `update_group_user_member` | 修改用户成员角色。body: ``{role: str}``。 |
| **DELETE** | `/api/project-groups/{group_id}/users/{user_id}` | `remove_group_user_member` | 从项目组中移除用户成员。 |

## project_members

- **prefix**: `/api/projects/{project_id}/members`
- **tags**: project-members
- **file**: `backend/api/project_members.py`

| 方法 | 路径 | 函数 | 描述 |
|------|------|------|------|
| **GET** | `/api/projects/{project_id}/members` | `list_members` | 列出项目成员（含用户信息 + 项目角色）。 |
| **POST** | `/api/projects/{project_id}/members` | `add_member` | 添加项目成员。 |
| **PUT** | `/api/projects/{project_id}/members/{user_id}` | `update_member_role` | 修改项目成员角色。 |
| **DELETE** | `/api/projects/{project_id}/members/{user_id}` | `remove_member` | 从项目中移除成员。 |

## projects

- **prefix**: `/api/projects`
- **tags**: projects
- **file**: `backend/api/projects.py`
- **service**: `backend.services`

| 方法 | 路径 | 函数 | 描述 |
|------|------|------|------|
| **GET** | `/api/projects` | `list_projects` | 项目列表 — 文件发现 + DB 聚合 + 已注册项目合并。 |
| **GET** | `/api/projects/roots` | `get_project_roots` | 返回可选项目根目录。 |
| **POST** | `/api/projects` | `create_project` | 创建项目（用户目录隔离 + 可选异步 clone）。 |
| **GET** | `/api/projects/{project_id}` | `get_project` | 项目详情。 |
| **GET** | `/api/projects/{project_id}/sessions` | `get_project_sessions` | 项目下的会话列表（按项目根/cwd 过滤文件扫描结果）。 |
| **GET** | `/api/projects/{project_id}/chats` | `get_project_chats` | 项目相关的普通对话（chats）— 不绑定项目但内容引用该项目的 chat。 |
| **GET** | `/api/projects/{project_id}/tasks` | `get_project_tasks` | 项目下的任务（DB tasks 表 + source=exec 的文件会话）。 |
| **DELETE** | `/api/projects/{project_id}` | `remove_project` | 从已注册列表中移除项目（不删除文件、不影响历史会话/任务）。 |
| **POST** | `/api/projects/{project_id}/archive` | `archive_project` | 归档项目（软操作，不删除任何文件/数据）。 |
| **POST** | `/api/projects/{project_id}/unarchive` | `unarchive_project` | 取消项目归档。 |
| **PUT** | `/api/projects/{project_id}/workflow` | `set_project_workflow` | 绑定项目到工作流。 |
| **GET** | `/api/projects/{project_id}/workflow` | `get_project_workflow` | 获取项目的工作流绑定信息。 |
| **DELETE** | `/api/projects/{project_id}/workflow` | `remove_project_workflow` | 解绑项目工作流。 |
| **PUT** | `/api/projects/{project_id}/git-config` | `set_project_git_config` | 设置项目的 Git 仓库配置。写入 ``project_settings.metadata.git_config``。 |
| **GET** | `/api/projects/{project_id}/git-config` | `get_project_git_config` | 获取项目的 Git 仓库配置。未配置时返回空对象。 |

## remote_agents

- **prefix**: `/api/remote-agents`
- **tags**: remote-agents
- **file**: `backend/api/remote_agents.py`

| 方法 | 路径 | 函数 | 描述 |
|------|------|------|------|
| **POST** | `/api/remote-agents/discover` | `discover_agent_card` | 通过 Agent Card URL 发现远程 Agent 元信息。 |
| **POST** | `/api/remote-agents` | `create_remote_agent` | 注册一个远程 Agent。 |
| **GET** | `/api/remote-agents` | `list_remote_agents` | 列出所有已注册的远程 Agent。 |
| **GET** | `/api/remote-agents/{agent_id}` | `get_remote_agent` | 获取远程 Agent 详情。 |
| **PUT** | `/api/remote-agents/{agent_id}` | `update_remote_agent` | 更新远程 Agent 配置。 |
| **DELETE** | `/api/remote-agents/{agent_id}` | `delete_remote_agent` | 删除远程 Agent（同时移除 actors 中对应记录）。 |
| **POST** | `/api/remote-agents/{agent_id}/test` | `test_remote_agent` | 测试远程 Agent 连通性：GET 其 Agent Card URL。 |
| **POST** | `/api/remote-agents/{agent_id}/refresh` | `refresh_remote_agent` | 重新获取 Agent Card 并更新本地缓存。 |

## rules

- **prefix**: `/api/rules`
- **tags**: rules
- **file**: `backend/api/rules.py`
- **service**: `backend.services.rule_service`

| 方法 | 路径 | 函数 | 描述 |
|------|------|------|------|
| **GET** | `/api/rules` | `list_rules` |  |
| **GET** | `/api/rules/{rule_id}` | `get_rule` |  |
| **POST** | `/api/rules` | `create_rule` |  |
| **PUT** | `/api/rules/{rule_id}` | `update_rule` |  |
| **DELETE** | `/api/rules/{rule_id}` | `delete_rule` |  |

## schedules

- **prefix**: `/api/schedules`
- **tags**: schedules
- **file**: `backend/api/schedules.py`
- **service**: `backend.services.schedule_service`

| 方法 | 路径 | 函数 | 描述 |
|------|------|------|------|
| **POST** | `/api/schedules` | `create_schedule` | 创建定时任务 |
| **GET** | `/api/schedules` | `list_schedules` | 列表查询 |
| **GET** | `/api/schedules/{schedule_id}` | `get_schedule` | 详情 |
| **PUT** | `/api/schedules/{schedule_id}` | `update_schedule` | 更新 |
| **DELETE** | `/api/schedules/{schedule_id}` | `delete_schedule` | 删除 |
| **POST** | `/api/schedules/{schedule_id}/toggle` | `toggle_schedule` | 启停切换 |
| **POST** | `/api/schedules/{schedule_id}/trigger` | `trigger_schedule` | 手动触发 |
| **GET** | `/api/schedules/{schedule_id}/runs` | `get_schedule_runs` | 执行历史 |

## security

- **prefix**: `/api/security`
- **tags**: security
- **file**: `backend/api/security.py`
- **service**: `backend.services.security_scanner`

| 方法 | 路径 | 函数 | 描述 |
|------|------|------|------|
| **POST** | `/api/security/scan` | `scan_text` | 手动触发安全扫描。 |
| **GET** | `/api/security/rules` | `list_rules` |  |
| **GET** | `/api/security/rules/{rule_id}` | `get_rule` |  |
| **POST** | `/api/security/rules` | `create_rule` |  |
| **PUT** | `/api/security/rules/{rule_id}` | `update_rule` |  |
| **DELETE** | `/api/security/rules/{rule_id}` | `delete_rule` |  |
| **GET** | `/api/security/findings` | `list_findings` |  |
| **POST** | `/api/security/findings/{finding_id}/dismiss` | `dismiss_finding` |  |
| **GET** | `/api/security/findings/summary` | `get_findings_summary` |  |

## sessions

- **prefix**: `/api/sessions`
- **tags**: sessions
- **file**: `backend/api/sessions.py`
- **service**: `backend.services.archive_service`

| 方法 | 路径 | 函数 | 描述 |
|------|------|------|------|
| **GET** | `/api/sessions/list-for-project` | `list_sessions_for_project` | 精简会话列表，供前端下拉框使用。 |
| **GET** | `/api/sessions/chats` | `list_chats` | 普通对话列表（不绑定项目），等价于 type=chat 的快捷入口。 |
| **GET** | `/api/sessions` | `list_sessions` | 会话列表：DB 优先（按 session_id 聚合），文件扫描补充。支持 type 过滤。 |
| **GET** | `/api/sessions/{session_id}` | `get_session` | 会话详情：返回会话元信息、对话消息流、关联任务。 |
| **POST** | `/api/sessions` | `create_session` | 新建会话。 |
| **POST** | `/api/sessions/{session_id}/archive` | `archive_session` | 归档会话（软操作，不删除任何文件/数据）。 |
| **POST** | `/api/sessions/{session_id}/unarchive` | `unarchive_session` | 取消会话归档。 |
| **GET** | `/api/sessions/{session_id}/artifacts` | `get_session_artifacts` | 汇总会话关联产物。 |

## skills

- **prefix**: `/api/skills`
- **tags**: skills
- **file**: `backend/api/skills.py`
- **service**: `backend.services.skill_service`

| 方法 | 路径 | 函数 | 描述 |
|------|------|------|------|
| **GET** | `/api/skills` | `list_skills` |  |
| **GET** | `/api/skills/{skill_id}` | `get_skill` |  |
| **POST** | `/api/skills` | `create_skill` |  |
| **PUT** | `/api/skills/{skill_id}` | `update_skill` |  |
| **DELETE** | `/api/skills/{skill_id}` | `delete_skill` |  |

## tasks

- **prefix**: `/api/tasks`
- **tags**: tasks
- **file**: `backend/api/tasks.py`
- **service**: `backend.services.session_discovery`

| 方法 | 路径 | 函数 | 描述 |
|------|------|------|------|
| **POST** | `/api/tasks` | `create_task` | 创建任务 |
| **POST** | `/api/tasks/attachments` | `upload_task_attachments` | 上传任务附件，返回可写入 TaskCreate.attachments 的本地路径列表。 |
| **GET** | `/api/tasks` | `list_tasks` | 任务列表：合并 DB 任务 + 本地 Agent 会话文件扫描结果。 |
| **GET** | `/api/tasks/{task_id}` | `get_task` | 任务详情。 |
| **POST** | `/api/tasks/{task_id}/stop` | `stop_task` | 停止任务 |
| **POST** | `/api/tasks/{task_id}/approve` | `approve_task` | 批准审批 |
| **POST** | `/api/tasks/{task_id}/reject` | `reject_task` | 拒绝审批 |
| **POST** | `/api/tasks/{task_id}/retry` | `retry_task` | 重试失败任务 |
| **GET** | `/api/tasks/{task_id}/output` | `stream_task_output` | SSE 流式输出任务结果 |

## versions

- **prefix**: `/api/versions`
- **tags**: versions
- **file**: `backend/api/versions.py`

| 方法 | 路径 | 函数 | 描述 |
|------|------|------|------|
| **GET** | `/api/versions` | `list_versions` | 列出版本。 |
| **POST** | `/api/versions` | `create_version` | 创建版本。 |
| **PATCH** | `/api/versions/{version_id}` | `update_version` | 更新版本字段。 |
| **DELETE** | `/api/versions/{version_id}` | `delete_version` | 删除版本。 |

## work_items

- **prefix**: `/api/work-items`
- **tags**: work-items
- **file**: `backend/api/work_items.py`
- **service**: `backend.services.ai_decompose_service`

| 方法 | 路径 | 函数 | 描述 |
|------|------|------|------|
| **POST** | `/api/work-items` | `create_work_item` | 创建工作项。 |
| **GET** | `/api/work-items` | `list_work_items` | 列出工作项。 |
| **GET** | `/api/work-items/{item_id}` | `get_work_item` | 工作项详情。 |
| **PATCH** | `/api/work-items/{item_id}` | `update_work_item` | 更新工作项基本信息。 |
| **DELETE** | `/api/work-items/{item_id}` | `delete_work_item` | 删除工作项。 |
| **POST** | `/api/work-items/{item_id}/transition` | `transition_work_item` | 流转工作项到目标节点。 |
| **GET** | `/api/work-items/{item_id}/transitions` | `get_transitions` | 获取工作项流转历史。 |
| **GET** | `/api/work-items/{item_id}/cross-repo-results` | `get_cross_repo_results` | 跨仓库执行结果聚合。 |
| **POST** | `/api/work-items/{item_id}/resolve-merge` | `resolve_work_item_merge` | 解决工作项 git_merge 节点冲突后推进。 |
| **POST** | `/api/work-items/{item_id}/artifacts` | `add_artifact` | 添加产物链接。 |
| **DELETE** | `/api/work-items/{item_id}/artifacts/{artifact_id}` | `remove_artifact` | 删除产物链接。 |
| **GET** | `/api/work-items/{item_id}/artifacts/{artifact_id}/content` | `get_artifact_content` | 获取产物文件内容，用于在线查看。 |
| **POST** | `/api/work-items/ai-decompose` | `ai_decompose_work_items` | AI 需求分解：将文本/文件/链接拆解为结构化工作项列表。 |
| **POST** | `/api/work-items/batch` | `batch_create_work_items` | 批量创建工作项。 |

## workflows

- **prefix**: `/api/workflows`
- **tags**: workflows
- **file**: `backend/api/workflows.py`
- **service**: `backend.services.workflow_engine`

| 方法 | 路径 | 函数 | 描述 |
|------|------|------|------|
| **POST** | `/api/workflows` | `create_workflow` |  |
| **GET** | `/api/workflows` | `list_workflows` |  |
| **GET** | `/api/workflows/{workflow_id}` | `get_workflow` |  |
| **PUT** | `/api/workflows/{workflow_id}` | `update_workflow` |  |
| **PATCH** | `/api/workflows/{workflow_id}/toggle` | `toggle_workflow` |  |
| **DELETE** | `/api/workflows/{workflow_id}` | `delete_workflow` |  |
| **POST** | `/api/workflows/{workflow_id}/run` | `run_workflow` |  |
| **GET** | `/api/workflows/{workflow_id}/runs` | `list_runs` |  |
| **GET** | `/api/workflows/{workflow_id}/runs/{run_id}` | `get_run` |  |
| **POST** | `/api/workflows/{workflow_id}/runs/{run_id}/cancel` | `cancel_run` |  |
| **POST** | `/api/workflows/{workflow_id}/runs/{run_id}/nodes/{node_id}/approve` | `approve_node` |  |
| **POST** | `/api/workflows/{workflow_id}/runs/{run_id}/nodes/{node_id}/reject` | `reject_node` |  |
| **POST** | `/api/workflows/{workflow_id}/runs/{run_id}/nodes/{node_id}/resolve-merge` | `resolve_merge_node` | 手动解决 Git merge 冲突后的回调。 |
