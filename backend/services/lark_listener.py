"""
LarkListener: Lark WebSocket 事件监听器

在独立线程中运行 lark_oapi.ws.Client，收到的事件通过
asyncio.Queue + call_soon_threadsafe 桥接到 FastAPI 的异步事件循环。

环境变量要求：
- LARK_APP_ID: Lark 应用 ID
- LARK_APP_SECRET: Lark 应用 Secret
- LARK_DOMAIN: Lark API 域名（默认 https://open.larksuite.com）
"""
import asyncio
import json
import logging
import re
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from backend.runtime.config import (
    APP_ID,
    APP_SECRET,
    LARK_ATTACHMENTS_DIR,
    LARK_ATTACHMENT_MAX_BYTES,
    LARK_DOMAIN,
    LARK_ENCRYPT_KEY,
    LARK_VERIFICATION_TOKEN,
    MAX_LARK_ATTACHMENTS_PER_MESSAGE,
)

logger = logging.getLogger("lark2agent.lark_listener")


@dataclass
class LarkEvent:
    """从 Lark 接收到的事件"""
    event_type: str  # "text_message" | "card_action" | "unknown"
    chat_id: str = ""
    content: str = ""
    message_id: str = ""
    sender_id: str = ""
    attachments: list[dict] = field(default_factory=list)
    raw_data: dict = field(default_factory=dict)


class LarkListener:
    """Lark WebSocket 事件监听器"""

    def __init__(self):
        self._event_queue: Optional[asyncio.Queue] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread: Optional[threading.Thread] = None
        self._running = False
        # 用于附件下载的 lark.Client（懒加载）。注意 self.client 是 ws.Client，
        # 这里另存 HTTP API 客户端用于资源下载。
        self._api_client: Optional[Any] = None
        self._api_client_lock = threading.Lock()

    @property
    def is_configured(self) -> bool:
        """检查是否配置了 Lark 凭据"""
        return bool(APP_ID and APP_SECRET)

    @property
    def is_running(self) -> bool:
        return self._running

    def start_background(
        self,
        loop: asyncio.AbstractEventLoop,
        event_queue: asyncio.Queue,
    ):
        """在后台线程中启动 Lark WebSocket 客户端"""
        if not self.is_configured:
            logger.warning(
                "Lark credentials not configured, skipping Lark listener startup"
            )
            return

        if self._running:
            logger.warning("Lark listener already running, skipping start")
            return

        self._loop = loop
        self._event_queue = event_queue
        self._thread = threading.Thread(
            target=self._run_client,
            name="lark-ws-listener",
            daemon=True,
        )
        self._thread.start()
        self._running = True
        logger.info("Lark WebSocket listener started in background thread")

    def stop(self):
        """停止监听器"""
        self._running = False
        logger.info("Lark WebSocket listener stopped")

    def _run_client(self):
        """在独立线程中运行 Lark WebSocket 客户端（阻塞）"""
        try:
            import lark_oapi as lark  # type: ignore
        except ImportError:
            logger.error("lark_oapi not installed, cannot start Lark listener")
            self._running = False
            return

        try:
            event_handler = self._build_event_handler(lark)

            cli = lark.ws.Client(
                app_id=APP_ID,
                app_secret=APP_SECRET,
                event_handler=event_handler,
                domain=LARK_DOMAIN,
                log_level=lark.LogLevel.DEBUG,
            )
            logger.info("Lark WebSocket client connecting to %s", LARK_DOMAIN)
            cli.start()  # 阻塞直到断开
        except Exception:
            logger.exception("Lark WebSocket client failed")
        finally:
            self._running = False

    def _build_event_handler(self, lark):
        """构建 lark_oapi 事件处理器"""
        handler = (
            lark.EventDispatcherHandler.builder(
                LARK_ENCRYPT_KEY or "",
                LARK_VERIFICATION_TOKEN or "",
            )
            .register_p2_im_message_receive_v1(self._on_message_receive)
            .register_p2_card_action_trigger(self._on_card_action)
            .build()
        )
        return handler

    def _on_message_receive(self, data):
        """处理 Lark 消息接收事件"""
        import sys
        print(f"[LarkListener] _on_message_receive called, data type: {type(data)}", file=sys.stderr, flush=True)
        try:
            event = data.event
            message = event.message
            sender = event.sender

            chat_id = getattr(message, "chat_id", "") or ""
            message_id = getattr(message, "message_id", "") or ""
            sender_id = ""
            if sender and getattr(sender, "sender_id", None):
                sender_id = getattr(sender.sender_id, "open_id", "") or ""

            content = ""
            attachments: list[dict] = []
            msg_type = getattr(message, "message_type", None) or "text"

            content_json: dict = {}
            try:
                parsed = json.loads(message.content or "{}")
                if isinstance(parsed, dict):
                    content_json = parsed
            except (json.JSONDecodeError, TypeError):
                content_json = {}

            if msg_type == "text":
                content = str(content_json.get("text", "") or (message.content or ""))
            elif msg_type in ("image", "file", "media", "audio"):
                attachments = self._download_attachments(
                    chat_id=chat_id,
                    message_id=message_id,
                    msg_type=msg_type,
                    content_json=content_json,
                )

            lark_event = LarkEvent(
                event_type="text_message",
                chat_id=chat_id,
                content=content,
                message_id=message_id,
                sender_id=sender_id,
                attachments=attachments,
                raw_data={"msg_type": msg_type},
            )

            logger.info(
                "Lark message received: chat=%s sender=%s type=%s",
                chat_id,
                sender_id,
                msg_type,
            )
            self._enqueue_event(lark_event)

        except Exception:
            logger.exception("Failed to process Lark message")

    def _on_card_action(self, data):
        """处理 Lark 卡片回调事件"""
        try:
            event = data.event if hasattr(data, "event") else None

            # 提取 action value
            action = getattr(event, "action", None) if event else None
            action_value = {}
            if hasattr(action, "value"):
                action_value = action.value or {}
            elif isinstance(action, dict):
                action_value = action.get("value", {})

            # 提取 message_id（卡片所属消息）用于 update_card
            context = getattr(event, "context", None) if event else None
            message_id = ""
            if context:
                message_id = getattr(context, "open_message_id", "") or ""
            if not message_id and event:
                message_id = getattr(event, "open_message_id", "") or ""

            # 提取 chat_id
            chat_id = ""
            if context:
                chat_id = getattr(context, "open_chat_id", "") or ""
            if not chat_id and event:
                chat_id = getattr(event, "open_chat_id", "") or ""

            lark_event = LarkEvent(
                event_type="card_action",
                chat_id=chat_id,
                message_id=message_id,
                raw_data={"action": action_value},
            )
            logger.info(
                "Lark card action received: %s chat=%s msg=%s",
                action_value,
                chat_id[:12] if chat_id else "-",
                message_id[:12] if message_id else "-",
            )
            self._enqueue_event(lark_event)

        except Exception:
            logger.exception("Failed to process Lark card action")

    # ── 附件下载 ─────────────────────────────────────────

    def _get_api_client(self):
        """懒加载 lark_oapi.Client（HTTP API 客户端，用于下载附件）"""
        if self._api_client is not None:
            return self._api_client
        with self._api_client_lock:
            if self._api_client is not None:
                return self._api_client
            try:
                import lark_oapi as lark  # type: ignore
            except ImportError:
                logger.warning("lark_oapi not installed, cannot download attachments")
                return None
            try:
                self._api_client = (
                    lark.Client.builder()
                    .app_id(APP_ID)
                    .app_secret(APP_SECRET)
                    .domain(LARK_DOMAIN)
                    .build()
                )
            except Exception:
                logger.exception("failed to build lark API client")
                return None
        return self._api_client

    @staticmethod
    def _collect_attachment_specs(content_json: dict, msg_type: str) -> list[dict]:
        """从消息 content JSON 中提取需要下载的附件规格。"""
        specs: list[dict] = []
        seen: set[tuple[str, str]] = set()

        def _add(kind: str, file_key: str, file_name: str = "", size: Any = 0):
            file_key = str(file_key or "")
            if not file_key:
                return
            key = (kind, file_key)
            if key in seen:
                return
            seen.add(key)
            try:
                size_int = int(size) if size else 0
            except (TypeError, ValueError):
                size_int = 0
            specs.append({
                "kind": kind,
                "file_key": file_key,
                "file_name": str(file_name or ""),
                "size": size_int,
            })

        def _visit(node: Any, default_kind: str):
            if isinstance(node, list):
                for child in node:
                    _visit(child, default_kind)
                return
            if not isinstance(node, dict):
                return

            ikey = node.get("image_key") or node.get("imageKey")
            if ikey:
                _add(
                    "image",
                    ikey,
                    node.get("file_name") or node.get("name") or "",
                    node.get("file_size") or node.get("size") or 0,
                )

            fkey = node.get("file_key") or node.get("fileKey")
            if fkey:
                kind = "image" if default_kind == "image" else "file"
                _add(
                    kind,
                    fkey,
                    node.get("file_name") or node.get("name") or "",
                    node.get("file_size") or node.get("size") or 0,
                )

            for child in node.values():
                if isinstance(child, (dict, list)):
                    _visit(child, default_kind)

        _visit(content_json, msg_type)

        if MAX_LARK_ATTACHMENTS_PER_MESSAGE > 0:
            specs = specs[:MAX_LARK_ATTACHMENTS_PER_MESSAGE]
        return specs

    @staticmethod
    def _sanitize_filename(value: str, fallback: str) -> str:
        name = Path(str(value or "")).name.strip() or fallback
        name = re.sub(r"[\x00-\x1f/\\:]+", "_", name).strip(" .")
        return (name or fallback)[:180]

    @staticmethod
    def _unique_path(directory: Path, filename: str) -> Path:
        path = directory / filename
        if not path.exists():
            return path
        stem, suffix = path.stem, path.suffix
        for i in range(2, 1000):
            cand = directory / f"{stem}-{i}{suffix}"
            if not cand.exists():
                return cand
        return path

    def _download_attachments(
        self,
        chat_id: str,
        message_id: str,
        msg_type: str,
        content_json: dict,
    ) -> list[dict]:
        """根据消息内容下载图片/文件附件，返回附件信息列表。

        失败时记录 warning 日志，不抛异常。
        """
        if not message_id:
            logger.warning("_download_attachments skipped: missing message_id")
            return []

        specs = self._collect_attachment_specs(content_json, msg_type)
        if not specs:
            return []

        client = self._get_api_client()
        if client is None:
            return []

        try:
            from lark_oapi.api.im.v1 import GetMessageResourceRequest  # type: ignore
        except ImportError:
            logger.warning("GetMessageResourceRequest not available")
            return []

        # 输出目录：项目根/.lark2agent/attachments/{chat_id}/{message_id}/
        base_dir = Path(LARK_ATTACHMENTS_DIR).expanduser()
        if not base_dir.is_absolute():
            base_dir = Path.cwd() / base_dir
        target_dir = base_dir / (chat_id or "unknown") / message_id
        try:
            target_dir.mkdir(parents=True, exist_ok=True)
        except OSError:
            logger.exception("failed to create attachment dir: %s", target_dir)
            return []

        results: list[dict] = []
        for spec in specs:
            kind = str(spec.get("kind") or "file")
            file_key = str(spec.get("file_key") or "")
            api_type = "image" if kind == "image" else "file"
            try:
                req = (
                    GetMessageResourceRequest.builder()
                    .message_id(message_id)
                    .file_key(file_key)
                    .type(api_type)
                    .build()
                )
                resp = client.im.v1.message_resource.get(req)
                if not _resp_ok(resp):
                    logger.warning(
                        "download lark attachment failed: code=%s msg=%s message=%s key=%s",
                        getattr(resp, "code", None),
                        getattr(resp, "msg", None),
                        message_id,
                        file_key,
                    )
                    continue
                source = getattr(resp, "file", None)
                if source is None:
                    logger.warning("download lark attachment: empty file stream key=%s", file_key)
                    continue

                resp_name = getattr(resp, "file_name", "") or ""
                fallback = (
                    f"{kind}-{re.sub(r'[^A-Za-z0-9_-]+', '_', file_key)[:24] or 'resource'}"
                    + (".png" if kind == "image" else ".bin")
                )
                filename = self._sanitize_filename(
                    spec.get("file_name") or resp_name, fallback
                )
                path = self._unique_path(target_dir, filename)
                tmp_path = path.with_name(path.name + ".tmp")
                total = 0
                try:
                    with tmp_path.open("wb") as out:
                        while True:
                            chunk = source.read(1024 * 1024)
                            if not chunk:
                                break
                            if isinstance(chunk, str):
                                chunk = chunk.encode("utf-8")
                            total += len(chunk)
                            if (
                                LARK_ATTACHMENT_MAX_BYTES > 0
                                and total > LARK_ATTACHMENT_MAX_BYTES
                            ):
                                raise ValueError(
                                    f"attachment exceeds {LARK_ATTACHMENT_MAX_BYTES} bytes"
                                )
                            out.write(chunk)
                    tmp_path.replace(path)
                    results.append({
                        "kind": kind,
                        "file_key": file_key,
                        "file_name": path.name,
                        "local_path": str(path.resolve()),
                        "size": total,
                        "message_id": message_id,
                    })
                    logger.info(
                        "downloaded lark attachment: chat=%s message=%s kind=%s path=%s size=%d",
                        chat_id, message_id, kind, path, total,
                    )
                except Exception:
                    tmp_path.unlink(missing_ok=True)
                    logger.warning(
                        "failed to save lark attachment message=%s key=%s",
                        message_id, file_key, exc_info=True,
                    )
                finally:
                    close = getattr(source, "close", None)
                    if callable(close):
                        try:
                            close()
                        except Exception:
                            pass
            except Exception:
                logger.warning(
                    "download lark attachment exception message=%s key=%s",
                    message_id, file_key, exc_info=True,
                )
                continue

        return results

    def _enqueue_event(self, event: LarkEvent):
        """将事件安全地入队到 asyncio.Queue"""
        if self._loop and self._event_queue:
            try:
                self._loop.call_soon_threadsafe(
                    self._event_queue.put_nowait, event
                )
            except Exception:
                logger.exception("Failed to enqueue Lark event")


def _resp_ok(resp: Any) -> bool:
    """判断 lark SDK 响应是否成功（兼容 success() 方法或 success 属性）。"""
    success = getattr(resp, "success", None)
    if callable(success):
        try:
            return bool(success())
        except Exception:
            pass
    if success is not None:
        return bool(success)
    code = getattr(resp, "code", 0)
    return code in (0, None)


# 全局单例
lark_listener = LarkListener()
