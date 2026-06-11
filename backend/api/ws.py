from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
import json

from backend.core.security import verify_token
from backend.runtime.config import TIDE_REQUIRE_AUTH
from backend.services.ws_hub import ws_hub

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket, token: str = Query(None)):
    user_id = "anonymous"
    if token:
        payload = verify_token(token)
        if payload and payload.get("type") == "access":
            user_id = payload.get("sub", "anonymous")
        elif TIDE_REQUIRE_AUTH:
            await ws.accept()
            await ws.close(code=4001, reason="Invalid token")
            return
    elif TIDE_REQUIRE_AUTH:
        await ws.accept()
        await ws.close(code=4001, reason="Authentication required")
        return

    await ws_hub.connect(ws, user_id=user_id)
    try:
        while True:
            data = await ws.receive_text()
            msg = json.loads(data)
            if msg.get("type") == "subscribe":
                channels = msg.get("channels", [])
                await ws_hub.subscribe(ws, channels)
            elif msg.get("type") == "ping":
                await ws.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        ws_hub.disconnect(ws)
    except Exception:
        ws_hub.disconnect(ws)
