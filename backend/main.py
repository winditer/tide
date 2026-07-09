import asyncio
import logging
import os
logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO),
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.db.engine import init_db
from backend.api.ws import router as ws_router
from backend.api.ws_daemon import router as ws_daemon_router
from backend.api.tasks import router as tasks_router
from backend.api.agents import router as agents_router
from backend.api.events import router as events_router
from backend.api.dashboard import router as dashboard_router
from backend.api.projects import router as projects_router
from backend.api.sessions import router as sessions_router, usage_router
from backend.api.schedules import router as schedules_router
from backend.services.schedule_service import schedule_service
from backend.services.lark_listener import lark_listener
from backend.services.message_handler import message_handler
from backend.services.plan_executor import plan_executor
from backend.services.task_service import task_service
from backend.api.plans import router as plans_router
from backend.api.workflows import router as workflows_router
from backend.api.work_items import router as work_items_router
from backend.api.kanban import router as kanban_router
from backend.api.versions import router as versions_router
from backend.api.lark_bridge import router as lark_bridge_router
from backend.api.lark_callback import router as lark_callback_router
from backend.api.conversations import router as conversations_router
from backend.api.approvals import router as approvals_router
from backend.api.auth import router as auth_router
from backend.api.admin import router as admin_router
from backend.api.project_members import router as project_members_router
from backend.api.remote_agents import router as remote_agents_router
from backend.api.rules import router as rules_router
from backend.api.skills import router as skills_router
from backend.api.hooks import router as hooks_router
from backend.api.security import router as security_router
from backend.api.project_groups import router as project_groups_router
from backend.api.knowledge import router as knowledge_router
from backend.api.files import router as files_router
from backend.api.git_audit import router as git_audit_router
from backend.api.expert_teams import router as expert_teams_router
from backend.api.agent_configs import router as agent_configs_router
from backend.api.settings import router as settings_router
from backend.api.notifications import router as notifications_router
from backend.api.daemon_tokens import router as daemon_tokens_router
from backend.api.api_tokens import router as api_tokens_router
from backend.services.auth_service import auth_service

logger = logging.getLogger("tide.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()

    # Seed 系统默认工作流（幂等）
    try:
        from backend.services.workflow_service import WorkflowService
        await WorkflowService().seed_default_workflow()
    except Exception:  # noqa: BLE001
        logger.exception("seed_default_workflow failed")

    # 启动时确保管理员账号存在（基于 TIDE_ADMIN_USERNAME / TIDE_ADMIN_PASSWORD）
    try:
        await auth_service.ensure_admin_exists()
    except Exception:  # noqa: BLE001
        logger.exception("ensure_admin_exists failed")

    await schedule_service.start()

    # 启动 Daemon Registry（WebSocket 推模式）
    from backend.services.daemon_registry import daemon_registry
    await daemon_registry.start()

    # 恢复后端重启前处于 active/running 状态的 Plan
    try:
        await plan_executor.resume_active_plans()
    except Exception:  # noqa: BLE001
        logger.exception("resume_active_plans failed")

    # 恢复后端重启前残留的 running/queued 任务 → 标记为 failed
    try:
        await task_service.recover_orphaned_tasks()
    except Exception:  # noqa: BLE001
        logger.exception("recover_orphaned_tasks failed")

    # 清理幽灵审批：任务已完成但审批仍 pending 的不一致记录
    try:
        from backend.services.approval_service import approval_service
        orphaned = await approval_service.cleanup_orphaned_approvals()
        if orphaned:
            logger.info("Cleaned up %d orphaned pending approvals on startup", orphaned)
    except Exception:  # noqa: BLE001
        logger.exception("cleanup_orphaned_approvals failed")

    # 清理所有会话的 session_id（重启后旧 session 不可恢复）
    try:
        from backend.db.engine import async_session_factory
        from sqlalchemy import text as _sa_text
        async with async_session_factory() as session:
            await session.execute(_sa_text("UPDATE conversations SET session_id = NULL WHERE session_id IS NOT NULL"))
            await session.commit()
        logger.info("Cleared stale conversation session_ids on startup")
    except Exception:  # noqa: BLE001
        logger.exception("clear conversation session_ids failed")

    # 扫描 Qoder IDE 会话并估算 token 用量（后台异步执行，不阻塞启动）
    async def _sync_qoder_tokens():
        try:
            from backend.services.session_discovery import sync_session_token_usage
            await sync_session_token_usage()
        except Exception:  # noqa: BLE001
            logger.exception("sync_session_token_usage failed")

    # 首次启动立即同步一次
    asyncio.create_task(_sync_qoder_tokens())

    # 注册周期任务：每 5 分钟同步 Qoder IDE 会话 token 用量
    from apscheduler.triggers.interval import IntervalTrigger

    schedule_service.scheduler.add_job(
        _sync_qoder_tokens,
        trigger=IntervalTrigger(minutes=5),
        id="sync_qoder_token_usage",
        replace_existing=True,
    )

    # Lark WebSocket 监听器（可选启动：未配置凭据时静默跳过，运行 Web-only 模式）
    from backend.runtime.config import LARK_EVENT_QUEUE_MAXSIZE
    lark_event_queue: asyncio.Queue = asyncio.Queue(maxsize=LARK_EVENT_QUEUE_MAXSIZE)
    app.state.lark_event_queue = lark_event_queue
    if lark_listener.is_configured:
        loop = asyncio.get_running_loop()
        lark_listener.start_background(loop, lark_event_queue)
        await message_handler.start(lark_event_queue)
    else:
        logger.info("Lark credentials not set, running in Web-only mode")

    try:
        yield
    finally:
        await message_handler.stop()
        lark_listener.stop()
        await schedule_service.shutdown()
        await daemon_registry.stop()


app = FastAPI(title="Tide API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://localhost:3002", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ws_router)
app.include_router(ws_daemon_router)
app.include_router(tasks_router)
app.include_router(agents_router)
app.include_router(events_router)
app.include_router(dashboard_router)
app.include_router(projects_router)
app.include_router(sessions_router)
app.include_router(usage_router)
app.include_router(schedules_router)
app.include_router(plans_router)
app.include_router(workflows_router)
app.include_router(work_items_router)
app.include_router(kanban_router)
app.include_router(versions_router)
app.include_router(lark_bridge_router)
app.include_router(lark_callback_router)
app.include_router(conversations_router)
app.include_router(approvals_router)
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(project_members_router)
app.include_router(remote_agents_router)
app.include_router(rules_router)
app.include_router(skills_router)
app.include_router(hooks_router)
app.include_router(security_router)
app.include_router(project_groups_router)
app.include_router(knowledge_router)
app.include_router(files_router)
app.include_router(git_audit_router)
app.include_router(expert_teams_router)
app.include_router(agent_configs_router)
app.include_router(settings_router)
app.include_router(notifications_router)
app.include_router(daemon_tokens_router)
app.include_router(api_tokens_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
