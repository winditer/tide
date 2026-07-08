"""FastAPI 应用入口。

提供 A2A 协议端点：
- GET /.well-known/agent.json    Agent Card 元数据
- POST /a2a                      JSON-RPC 入口（message/send, message/stream, tasks/get, tasks/cancel）
- GET /health                    健康检查
"""
from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

import bridge_config as config
from agent_card import build_agent_card
from executor import executor
from git_manager import GitContext, init_git_manager
from models import (
    ERR_AGENT_UNAVAILABLE,
    ERR_INTERNAL,
    ERR_INVALID_PARAMS,
    ERR_INVALID_REQUEST,
    ERR_METHOD_NOT_FOUND,
    ERR_PARSE_ERROR,
    ERR_TASK_NOT_CANCELABLE,
    ERR_TASK_NOT_FOUND,
    ERR_UNAUTHORIZED,
    JsonRpcError,
    JsonRpcRequest,
    JsonRpcResponse,
    TaskState,
)


logging.basicConfig(
    level=getattr(logging, config.LOG_LEVEL.upper(), logging.INFO),
    format='{"ts":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":%(message)r}',
)
logger = logging.getLogger("a2a_bridge")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    logger.info(
        "a2a-bridge starting host=%s port=%s agents=%s",
        config.BRIDGE_HOST,
        config.BRIDGE_PORT,
        list(config.AGENTS.keys()),
    )
    # 初始化全局 GitManager（仓库存储目录从配置读取）
    init_git_manager(repos_dir=config.GIT_REPOS_DIR)
    logger.info("git manager initialized: repos_dir=%s", config.GIT_REPOS_DIR)

    # 启动 Daemon WebSocket 客户端（推模式）
    daemon_client_task = None
    daemon_ws_client = None
    if config.DAEMON_ENABLED and config.TIDE_WS_URL:
        from daemon_client import DaemonWSClient

        # 从 config.AGENTS 组装 agents 信息（每个 CLI Agent 作为独立条目）
        agents_info = []
        for agent_name, agent_cfg in getattr(config, "AGENTS", {}).items():
            model = getattr(agent_cfg, "model", "") if not isinstance(agent_cfg, dict) else agent_cfg.get("model", "")
            agents_info.append({
                "agent_id": agent_name,
                "name": agent_name,
                "model": model or "",
                "capabilities": list(getattr(config, "CAPABILITY_TAGS", []) or []),
            })

        daemon_ws_client = DaemonWSClient(
            tide_ws_url=config.TIDE_WS_URL,
            daemon_token=config.DAEMON_TOKEN,
            daemon_id=config.DAEMON_ID or "",
            heartbeat_interval=config.HEARTBEAT_INTERVAL,
            capability_tags=config.CAPABILITY_TAGS,
            agents=agents_info,
            name="a2a-bridge",
            endpoint_url=getattr(config, "PUBLIC_URL", "") or "",
            max_concurrency=getattr(config, "MAX_CONCURRENCY", 5),
        )
        daemon_ws_client.set_executor(executor)
        daemon_client_task = asyncio.create_task(daemon_ws_client.start())
        logger.info(
            "Daemon WS push mode enabled → connecting to %s (daemon_id=%s)",
            config.TIDE_WS_URL, daemon_ws_client.daemon_id
        )
    elif config.DAEMON_ENABLED:
        logger.warning(
            "DAEMON_ENABLED=true but TIDE_WS_URL is not set. "
            "To enable WebSocket push mode, configure:\n"
            "  TIDE_WS_URL=ws://<tide-backend-host>:<port>/ws/daemon\n"
            "  DAEMON_TOKEN=<shared-secret>\n"
            "Falling back to HTTP polling mode."
        )
    else:
        logger.debug(
            "Daemon WS push mode disabled. Set DAEMON_ENABLED=true and TIDE_WS_URL to enable. "
            "See .env.example for details."
        )

    try:
        yield
    finally:
        logger.info("shutting down: cancelling active tasks")
        await executor.shutdown()
        # 停止 Daemon 客户端
        if daemon_client_task:
            try:
                await daemon_ws_client.stop()
                daemon_client_task.cancel()
                try:
                    await daemon_client_task
                except asyncio.CancelledError:
                    pass
            except Exception:
                logger.exception("daemon_client shutdown error")


app = FastAPI(title="Tide A2A Bridge", version="1.0.0", lifespan=lifespan)


# ---------------- 工具：JSON-RPC 响应 ----------------
def _rpc_ok(req_id: Any, result: Any) -> dict[str, Any]:
    return JsonRpcResponse(id=req_id, result=result).model_dump(exclude_none=True)


def _rpc_err(req_id: Any, code: int, message: str, data: Any = None) -> dict[str, Any]:
    return JsonRpcResponse(
        id=req_id,
        error=JsonRpcError(code=code, message=message, data=data),
    ).model_dump(exclude_none=True)


# ---------------- 认证 ----------------
def _check_auth(x_api_key: str | None, authorization: str | None) -> None:
    if not config.API_KEY:
        return
    candidate = x_api_key
    if not candidate and authorization:
        # 支持 Authorization: Bearer <key> 形式
        parts = authorization.split(None, 1)
        if len(parts) == 2 and parts[0].lower() == "bearer":
            candidate = parts[1].strip()
    if candidate != config.API_KEY:
        raise HTTPException(status_code=401, detail="invalid api key")


# ---------------- 端点：Agent Card ----------------
@app.get("/.well-known/agent.json")
async def agent_card(request: Request) -> JSONResponse:
    public_url = config.PUBLIC_URL or f"{request.url.scheme}://{request.url.netloc}"
    return JSONResponse(build_agent_card(public_url))


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "agents": config.list_agents(),
        "active_tasks": executor.list_active(),
        "max_concurrency": config.MAX_CONCURRENCY,
    }


# ---------------- 端点：A2A JSON-RPC ----------------
@app.post("/a2a")
async def a2a_endpoint(
    request: Request,
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
    authorization: str | None = Header(default=None),
):
    try:
        _check_auth(x_api_key, authorization)
    except HTTPException as exc:
        return JSONResponse(_rpc_err(None, ERR_UNAUTHORIZED, exc.detail), status_code=401)

    try:
        raw = await request.body()
        payload = json.loads(raw.decode("utf-8") or "{}")
    except json.JSONDecodeError as exc:
        return JSONResponse(_rpc_err(None, ERR_PARSE_ERROR, f"invalid JSON: {exc}"), status_code=400)

    if not isinstance(payload, dict):
        return JSONResponse(_rpc_err(None, ERR_INVALID_REQUEST, "request body must be JSON object"), status_code=400)

    try:
        rpc = JsonRpcRequest(**payload)
    except Exception as exc:
        return JSONResponse(_rpc_err(payload.get("id"), ERR_INVALID_REQUEST, str(exc)), status_code=400)

    method = rpc.method
    params = rpc.params or {}

    if method in ("message/send", "tasks/send"):
        return await _handle_message_send(rpc.id, params)
    if method in ("message/stream", "tasks/sendSubscribe", "tasks/stream"):
        return await _handle_message_stream(rpc.id, params)
    if method == "tasks/get":
        return _handle_tasks_get(rpc.id, params)
    if method == "tasks/cancel":
        return await _handle_tasks_cancel(rpc.id, params)
    if method == "agent/getCard":
        return JSONResponse(_rpc_ok(rpc.id, build_agent_card(config.PUBLIC_URL or None)))

    return JSONResponse(
        _rpc_err(rpc.id, ERR_METHOD_NOT_FOUND, f"method not supported: {method}"),
        status_code=400,
    )


# ---------------- 处理：参数解析 ----------------
def _extract_prompt(params: dict[str, Any]) -> str:
    msg = params.get("message") or {}
    parts = msg.get("parts") or []
    chunks: list[str] = []
    for p in parts:
        if not isinstance(p, dict):
            continue
        kind = p.get("kind") or p.get("type")
        if kind == "text":
            chunks.append(str(p.get("text") or ""))
        elif kind == "data":
            data = p.get("data")
            try:
                chunks.append(json.dumps(data, ensure_ascii=False))
            except Exception:
                chunks.append(str(data))
    return "\n".join([c for c in chunks if c]).strip()


def _extract_configuration(params: dict[str, Any]) -> dict[str, Any]:
    cfg = params.get("configuration") or params.get("metadata") or {}
    if not isinstance(cfg, dict):
        return {}
    return cfg


def _resolve_skill(params: dict[str, Any], cfg: dict[str, Any]) -> str:
    return (
        cfg.get("skill")
        or cfg.get("agent")
        or params.get("skill")
        or params.get("agent")
        or config.DEFAULT_AGENT
    )


def _resolve_git_ctx(cfg: dict[str, Any]) -> GitContext | None:
    """从 configuration.git 或环境变量默认值构造 GitContext。

    如果请求未携带 git 字段且未配置 GIT_DEFAULT_REPO，返回 None（保持
    原有行为：使用固定 WORK_DIR）。
    """
    git_data = cfg.get("git")
    if isinstance(git_data, dict) and git_data:
        return GitContext.from_dict(git_data)
    # 回退到环境变量默认值（可选）
    if config.GIT_DEFAULT_REPO:
        return GitContext(
            repo_url=config.GIT_DEFAULT_REPO,
            base_branch=config.GIT_DEFAULT_BRANCH or "main",
        )
    return None


# ---------------- 处理：message/send（阻塞） ----------------
async def _handle_message_send(req_id: Any, params: dict[str, Any]) -> JSONResponse:
    prompt = _extract_prompt(params)
    if not prompt:
        return JSONResponse(_rpc_err(req_id, ERR_INVALID_PARAMS, "message.parts is empty"), status_code=400)
    cfg = _extract_configuration(params)
    skill = _resolve_skill(params, cfg)

    try:
        skill_name, agent_cfg = config.get_agent_config(skill)
    except RuntimeError as exc:
        return JSONResponse(_rpc_err(req_id, ERR_AGENT_UNAVAILABLE, str(exc)), status_code=400)

    work_dir = cfg.get("workDir") or cfg.get("cwd") or config.WORK_DIR
    msg = params.get("message") or {}
    git_ctx = _resolve_git_ctx(cfg)
    rt = executor.create_task(
        prompt=prompt,
        skill=skill_name,
        agent_cfg=agent_cfg,
        work_dir=work_dir,
        context_id=msg.get("contextId") or params.get("contextId"),
        task_id=msg.get("taskId") or params.get("taskId"),
        configuration=cfg,
    )

    try:
        await executor.run_blocking(
            rt,
            prompt=prompt,
            agent_cfg=agent_cfg,
            work_dir=work_dir,
            configuration=cfg,
            git_ctx=git_ctx,
        )
    except Exception as exc:
        logger.exception("message/send execution failed: %s", exc)
        return JSONResponse(_rpc_err(req_id, ERR_INTERNAL, str(exc)), status_code=500)

    return JSONResponse(_rpc_ok(req_id, rt.task.to_dict()))


# ---------------- 处理：message/stream（SSE） ----------------
async def _handle_message_stream(req_id: Any, params: dict[str, Any]) -> StreamingResponse:
    prompt = _extract_prompt(params)
    cfg = _extract_configuration(params)
    skill = _resolve_skill(params, cfg)

    if not prompt:
        async def _err_iter() -> AsyncIterator[bytes]:
            payload = _rpc_err(req_id, ERR_INVALID_PARAMS, "message.parts is empty")
            yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")
        return StreamingResponse(_err_iter(), media_type="text/event-stream")

    try:
        skill_name, agent_cfg = config.get_agent_config(skill)
    except RuntimeError as exc:
        async def _err_iter2() -> AsyncIterator[bytes]:
            payload = _rpc_err(req_id, ERR_AGENT_UNAVAILABLE, str(exc))
            yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")
        return StreamingResponse(_err_iter2(), media_type="text/event-stream")

    work_dir = cfg.get("workDir") or cfg.get("cwd") or config.WORK_DIR
    msg = params.get("message") or {}
    git_ctx = _resolve_git_ctx(cfg)
    rt = executor.create_task(
        prompt=prompt,
        skill=skill_name,
        agent_cfg=agent_cfg,
        work_dir=work_dir,
        context_id=msg.get("contextId") or params.get("contextId"),
        task_id=msg.get("taskId") or params.get("taskId"),
        configuration=cfg,
    )

    async def _gen() -> AsyncIterator[bytes]:
        # 首帧返回 task 基本信息（A2A 规范允许）
        first = _rpc_ok(req_id, rt.task.to_dict())
        yield f"data: {json.dumps(first, ensure_ascii=False)}\n\n".encode("utf-8")
        try:
            async for ev in executor.run_streaming(
                rt,
                prompt=prompt,
                agent_cfg=agent_cfg,
                work_dir=work_dir,
                configuration=cfg,
                git_ctx=git_ctx,
            ):
                envelope = _rpc_ok(req_id, ev)
                yield f"data: {json.dumps(envelope, ensure_ascii=False)}\n\n".encode("utf-8")
        except asyncio.CancelledError:  # pragma: no cover
            raise
        except Exception as exc:
            logger.exception("stream error: %s", exc)
            err = _rpc_err(req_id, ERR_INTERNAL, str(exc))
            yield f"data: {json.dumps(err, ensure_ascii=False)}\n\n".encode("utf-8")

    return StreamingResponse(
        _gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ---------------- 处理：tasks/get ----------------
def _handle_tasks_get(req_id: Any, params: dict[str, Any]) -> JSONResponse:
    task_id = params.get("id") or params.get("taskId")
    if not task_id:
        return JSONResponse(_rpc_err(req_id, ERR_INVALID_PARAMS, "id is required"), status_code=400)
    task = executor.get_task(str(task_id))
    if not task:
        return JSONResponse(_rpc_err(req_id, ERR_TASK_NOT_FOUND, f"task not found: {task_id}"), status_code=404)
    return JSONResponse(_rpc_ok(req_id, task.to_dict()))


# ---------------- 处理：tasks/cancel ----------------
async def _handle_tasks_cancel(req_id: Any, params: dict[str, Any]) -> JSONResponse:
    task_id = params.get("id") or params.get("taskId")
    if not task_id:
        return JSONResponse(_rpc_err(req_id, ERR_INVALID_PARAMS, "id is required"), status_code=400)
    task = executor.get_task(str(task_id))
    if not task:
        return JSONResponse(_rpc_err(req_id, ERR_TASK_NOT_FOUND, f"task not found: {task_id}"), status_code=404)
    if task.state in (TaskState.COMPLETED, TaskState.FAILED, TaskState.CANCELED):
        return JSONResponse(
            _rpc_err(req_id, ERR_TASK_NOT_CANCELABLE, f"task already {task.state.value}"),
            status_code=409,
        )
    await executor.cancel(str(task_id))
    refreshed = executor.get_task(str(task_id))
    return JSONResponse(_rpc_ok(req_id, refreshed.to_dict() if refreshed else {"id": task_id}))


# ---------------- 入口 ----------------
def run() -> None:  # pragma: no cover
    import uvicorn

    uvicorn.run(
        "main:app",
        host=config.BRIDGE_HOST,
        port=config.BRIDGE_PORT,
        log_level=config.LOG_LEVEL.lower(),
    )


if __name__ == "__main__":  # pragma: no cover
    run()
