# 事件总线图谱

> 生成时间: 2026-06-26T03:00:00Z | 事件类型: 0 | 生产者: 0 | 消费者: 0

## 通信机制

| 机制 | 描述 | 使用场景 |
|------|------|----------|
| WSHub (in-process WebSocket fanout) | 维护 {channel → Set[WebSocket]}，支持 connect / subscribe / broadcast / broadcast_all；事件 payload 中由 hub 注入 timestamp。所有 broadcast(ch) 同时投递到 channel 订阅者 + 'all' channel。 |  |
| EventEmitter (业务事件发射器) | 对常用事件提供 emit_xxx 包装，统一写 task_events 表 + 调用 ws_hub.broadcast。 |  |
| Lark Long Connection | lark-oapi 客户端订阅 IM / Card / Callback 事件。 |  |
| Lark Card Callback Webhook | POST /api/lark/callback 接收飞书卡片按钮回调；POST /api/auth/lark/callback 接收 OAuth 回调。 |  |
| APScheduler | 进程内调度器；触发 schedule run 并发起 plan/workflow，同时广播 schedule.run.*。 |  |

## 事件列表

### `task.created`

**生产者**:

- `services/event_emitter.emit_task_created`
- `services/task_service.create_task:435`
- `services/workflow_engine:575`
- `services/lark_bridge.on_lark_task_created`

**消费者**:

- `前端 WS 客户端 (apps/web)`

### `task.updated`

**生产者**:

- `services/event_emitter.emit_task_updated`

**消费者**:

- `前端 WS 客户端`

### `task.deleted`

**生产者**:

- `services/event_emitter.emit_task_deleted`

**消费者**:

- `前端 WS 客户端`

### `task.status_changed`

**生产者**:

- `services/task_service:97,770,855`
- `services/kanban_service:935`
- `services/plan_executor:765`
- `services/lark_bridge.on_lark_task_updated`

**消费者**:

- `前端 WS 客户端`
- `看板视图`

### `task.output`

**生产者**:

- `services/task_service:535`
- `services/plan_executor:475`

**消费者**:

- `前端实时日志面板`

### `task.approval_request`

**生产者**:

- `services/task_service:560`
- `services/plan_executor:491`

**消费者**:

- `审批面板`
- `Lark 卡片`

### `task.artifact`

**生产者**:

- `services/task_service:292`

**消费者**:

- `前端会话视图`

### `approval.requested`

**生产者**:

- `services/event_emitter.emit_approval_requested`
- `services/workflow_engine:265`
- `services/approval_service:85`

**消费者**:

- `审批中心`

### `approval.resolved`

**生产者**:

- `services/event_emitter.emit_approval_resolved`
- `services/task_service:747,820`
- `services/approval_service:157,259`

**消费者**:

- `审批中心`

### `plan.task.started`

**生产者**:

- `services/plan_executor`

**消费者**:

- `前端 plan 视图`

### `plan.task.completed`

**生产者**:

- `services/plan_executor`

**消费者**:

- `前端 plan 视图`

### `workflow.run.started`

**生产者**:

- `services/workflow_engine:155`

**消费者**:

- `前端 workflow canvas`

### `workflow.run.cancelled`

**生产者**:

- `services/workflow_engine:215`

**消费者**:

- `前端 workflow canvas`

### `workflow.run.completed`

**生产者**:

- `services/workflow_engine:1075`

**消费者**:

- `前端 workflow canvas`
- `hook_engine`

### `workflow.run.failed`

**生产者**:

- `services/workflow_engine:1097`

**消费者**:

- `前端 workflow canvas`

### `workflow.node.started`

**生产者**:

- `services/workflow_engine:230`

**消费者**:

- `前端 workflow canvas`

### `workflow.node.completed`

**生产者**:

- `services/workflow_engine:805`

**消费者**:

- `前端 workflow canvas`

### `schedule.run.started`

**生产者**:

- `services/schedule_service:422`

**消费者**:

- `前端 schedules 页`

### `schedule.run.completed`

**生产者**:

- `services/schedule_service:574`

**消费者**:

- `前端 schedules 页`

### `work_item.created`

**生产者**:

- `services/work_item_service:419`

**消费者**:

- `前端 work_items 页`

### `work_item.updated`

**生产者**:

- `services/work_item_service:572`

**消费者**:

- `前端 work_items 页`

### `work_item.deleted`

**生产者**:

- `services/work_item_service:597`

**消费者**:

- `前端 work_items 页`

### `work_item.transitioned`

**生产者**:

- `services/work_item_service:702`

**消费者**:

- `前端 work_items 页`

### `hook.{event_name}`

**生产者**:

- `services/hook_engine:240`

**消费者**:

- `用户配置 hook 订阅者`

### `security.alert`

**生产者**:

- `services/hook_engine:261`

**消费者**:

- `前端安全/审批面板`

### `lark.task.created`

**生产者**:

- `services/event_emitter.emit_lark_task_created → on_lark_task_created`

**消费者**:

- `前端 WS 客户端`

### `lark.task.updated`

**生产者**:

- `services/event_emitter.emit_lark_task_updated → on_lark_task_updated`

**消费者**:

- `前端 WS 客户端`

## 发布-订阅关系图

```mermaid
graph LR
    services_event_emitter_emit_task_created[services/event_emitter.emit_task_created] -->|task.created| task_created[task.created]
    services_task_service_create_task_435[services/task_service.create_task:435] -->|task.created| task_created[task.created]
    services_workflow_engine_575[services/workflow_engine:575] -->|task.created| task_created[task.created]
    services_lark_bridge_on_lark_task_created[services/lark_bridge.on_lark_task_created] -->|task.created| task_created[task.created]
    task_created[task.created] --> 前端_WS_客户端__apps_web_[前端 WS 客户端 (apps/web)]
    services_event_emitter_emit_task_updated[services/event_emitter.emit_task_updated] -->|task.updated| task_updated[task.updated]
    task_updated[task.updated] --> 前端_WS_客户端[前端 WS 客户端]
    services_event_emitter_emit_task_deleted[services/event_emitter.emit_task_deleted] -->|task.deleted| task_deleted[task.deleted]
    task_deleted[task.deleted] --> 前端_WS_客户端[前端 WS 客户端]
    services_task_service_97_770_855[services/task_service:97,770,855] -->|task.status_changed| task_status_changed[task.status_changed]
    services_kanban_service_935[services/kanban_service:935] -->|task.status_changed| task_status_changed[task.status_changed]
    services_plan_executor_765[services/plan_executor:765] -->|task.status_changed| task_status_changed[task.status_changed]
    services_lark_bridge_on_lark_task_updated[services/lark_bridge.on_lark_task_updated] -->|task.status_changed| task_status_changed[task.status_changed]
    task_status_changed[task.status_changed] --> 前端_WS_客户端[前端 WS 客户端]
    task_status_changed[task.status_changed] --> 看板视图[看板视图]
    services_task_service_535[services/task_service:535] -->|task.output| task_output[task.output]
    services_plan_executor_475[services/plan_executor:475] -->|task.output| task_output[task.output]
    task_output[task.output] --> 前端实时日志面板[前端实时日志面板]
    services_task_service_560[services/task_service:560] -->|task.approval_request| task_approval_request[task.approval_request]
    services_plan_executor_491[services/plan_executor:491] -->|task.approval_request| task_approval_request[task.approval_request]
    task_approval_request[task.approval_request] --> 审批面板[审批面板]
    task_approval_request[task.approval_request] --> Lark_卡片[Lark 卡片]
    services_task_service_292[services/task_service:292] -->|task.artifact| task_artifact[task.artifact]
    task_artifact[task.artifact] --> 前端会话视图[前端会话视图]
    services_event_emitter_emit_approval_requested[services/event_emitter.emit_approval_requested] -->|approval.requested| approval_requested[approval.requested]
    services_workflow_engine_265[services/workflow_engine:265] -->|approval.requested| approval_requested[approval.requested]
    services_approval_service_85[services/approval_service:85] -->|approval.requested| approval_requested[approval.requested]
    approval_requested[approval.requested] --> 审批中心[审批中心]
    services_event_emitter_emit_approval_resolved[services/event_emitter.emit_approval_resolved] -->|approval.resolved| approval_resolved[approval.resolved]
    services_task_service_747_820[services/task_service:747,820] -->|approval.resolved| approval_resolved[approval.resolved]
    services_approval_service_157_259[services/approval_service:157,259] -->|approval.resolved| approval_resolved[approval.resolved]
    approval_resolved[approval.resolved] --> 审批中心[审批中心]
    services_plan_executor[services/plan_executor] -->|plan.task.started| plan_task_started[plan.task.started]
    plan_task_started[plan.task.started] --> 前端_plan_视图[前端 plan 视图]
    services_plan_executor[services/plan_executor] -->|plan.task.completed| plan_task_completed[plan.task.completed]
    plan_task_completed[plan.task.completed] --> 前端_plan_视图[前端 plan 视图]
    services_workflow_engine_155[services/workflow_engine:155] -->|workflow.run.started| workflow_run_started[workflow.run.started]
    workflow_run_started[workflow.run.started] --> 前端_workflow_canvas[前端 workflow canvas]
    services_workflow_engine_215[services/workflow_engine:215] -->|workflow.run.cancelled| workflow_run_cancelled[workflow.run.cancelled]
    workflow_run_cancelled[workflow.run.cancelled] --> 前端_workflow_canvas[前端 workflow canvas]
    services_workflow_engine_1075[services/workflow_engine:1075] -->|workflow.run.completed| workflow_run_completed[workflow.run.completed]
    workflow_run_completed[workflow.run.completed] --> 前端_workflow_canvas[前端 workflow canvas]
    workflow_run_completed[workflow.run.completed] --> hook_engine[hook_engine]
    services_workflow_engine_1097[services/workflow_engine:1097] -->|workflow.run.failed| workflow_run_failed[workflow.run.failed]
    workflow_run_failed[workflow.run.failed] --> 前端_workflow_canvas[前端 workflow canvas]
    services_workflow_engine_230[services/workflow_engine:230] -->|workflow.node.started| workflow_node_started[workflow.node.started]
    workflow_node_started[workflow.node.started] --> 前端_workflow_canvas[前端 workflow canvas]
    services_workflow_engine_805[services/workflow_engine:805] -->|workflow.node.completed| workflow_node_completed[workflow.node.completed]
    workflow_node_completed[workflow.node.completed] --> 前端_workflow_canvas[前端 workflow canvas]
    services_schedule_service_422[services/schedule_service:422] -->|schedule.run.started| schedule_run_started[schedule.run.started]
    schedule_run_started[schedule.run.started] --> 前端_schedules_页[前端 schedules 页]
    services_schedule_service_574[services/schedule_service:574] -->|schedule.run.completed| schedule_run_completed[schedule.run.completed]
    schedule_run_completed[schedule.run.completed] --> 前端_schedules_页[前端 schedules 页]
    services_work_item_service_419[services/work_item_service:419] -->|work_item.created| work_item_created[work_item.created]
    work_item_created[work_item.created] --> 前端_work_items_页[前端 work_items 页]
```
