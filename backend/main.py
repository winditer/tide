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
from backend.api.tasks import router as tasks_router
from backend.api.agents import router as agents_router
from backend.api.events import router as events_router
from backend.api.dashboard import router as dashboard_router
from backend.api.projects import router as projects_router
from backend.api.sessions import router as sessions_router
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
from backend.api.lark_bridge import router as lark_bridge_router
from backend.api.lark_callback import router as lark_callback_router
from backend.api.conversations import router as conversations_router
from backend.api.approvals import router as approvals_router

logger = logging.getLogger("tide.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await schedule_service.start()

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


app = FastAPI(title="Tide API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://localhost:3002", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ws_router)
app.include_router(tasks_router)
app.include_router(agents_router)
app.include_router(events_router)
app.include_router(dashboard_router)
app.include_router(projects_router)
app.include_router(sessions_router)
app.include_router(schedules_router)
app.include_router(plans_router)
app.include_router(workflows_router)
app.include_router(work_items_router)
app.include_router(kanban_router)
app.include_router(lark_bridge_router)
app.include_router(lark_callback_router)
app.include_router(conversations_router)
app.include_router(approvals_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
