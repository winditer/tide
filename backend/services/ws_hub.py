import asyncio
import json
import time
from typing import Dict, Set

from fastapi import WebSocket


class WSHub:
    def __init__(self):
        self._connections: Dict[str, Set[WebSocket]] = {}  # channel -> connections
        self._all_connections: Set[WebSocket] = set()

    async def connect(self, ws: WebSocket, channels: list[str] = None):
        await ws.accept()
        self._all_connections.add(ws)
        if channels:
            for ch in channels:
                self._connections.setdefault(ch, set()).add(ws)

    def disconnect(self, ws: WebSocket):
        self._all_connections.discard(ws)
        for ch_set in self._connections.values():
            ch_set.discard(ws)

    async def subscribe(self, ws: WebSocket, channels: list[str]):
        for ch in channels:
            self._connections.setdefault(ch, set()).add(ws)

    async def broadcast(self, channel: str, event: dict):
        """广播事件到指定 channel 的所有连接"""
        event["timestamp"] = time.time()
        message = json.dumps(event, ensure_ascii=False)
        targets = self._connections.get(channel, set())
        # 也广播到全局 "all" channel
        targets = targets | self._connections.get("all", set())
        dead = set()
        for ws in targets:
            try:
                await ws.send_text(message)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self.disconnect(ws)

    async def broadcast_all(self, event: dict):
        """广播到所有连接"""
        event["timestamp"] = time.time()
        message = json.dumps(event, ensure_ascii=False)
        dead = set()
        for ws in self._all_connections:
            try:
                await ws.send_text(message)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self.disconnect(ws)


# 全局单例
ws_hub = WSHub()
