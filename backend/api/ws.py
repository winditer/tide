from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import json

from backend.services.ws_hub import ws_hub

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws_hub.connect(ws)
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
