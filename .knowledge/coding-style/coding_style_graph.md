# 编码风格与工程实践

> 生成时间: 2026-06-26T03:00:00Z

## 命名约定


## 代码组织


## 错误处理


## 测试实践


## 注释与文档


## 格式化与检查


## Type And Interface


## Conventions Observed

- 服务模块顶部以中文 docstring 说明职责
- 通过 `lifespan` 而非已废弃的 `@app.on_event` 启动子服务
- WS 广播使用 channel + 全局 `all` 双投递（`ws_hub.broadcast`）
- Event payload 字段固定 `type`/`task_id`/`workspace_id`/`updates`，时间戳由 hub 注入
- DB 迁移采用 `init.sql` + `ensure_column` 增量列添加，而非 Alembic
- 前端遵守 App Router 文件式路由（`apps/web/app/<route>/page.tsx`）
- 三个 packages 通过 `exports` 字段精细暴露子路径（避免 `*`）

## Anti Patterns To Avoid

- 继续修改 `tide_ws.py`（已废弃，仅作迁移参考）
- 把 secret 写入代码——`config.py` 强制从 env / .env 注入
- 跨层反向 import（api 不能被 services / runtime 引入）
- 在 services 层直接读 request——必须由 api 层下传
