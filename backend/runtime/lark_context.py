"""Lark 文档内容预获取与缓存。

在 Agent 执行前，检测工作项附件/产物中的 Lark 文档链接，
预先获取文档纯文本内容并注入 prompt，使 Agent 能直接阅读文档。
"""

import asyncio
import json
import logging
import re
import time
from pathlib import Path
from typing import Optional

logger = logging.getLogger("tide.runtime.lark_context")

# Lark 文档 URL 正则
LARK_DOC_PATTERN = re.compile(
    r'https?://[^/]*\.(feishu\.cn|larkoffice\.com|larksuite\.com)'
    r'/(docx|wiki|sheets|base|slides)/([a-zA-Z0-9]+)'
)

# 缓存目录
CACHE_DIR = Path(".tide/cache/lark_docs")
CACHE_TTL = 86400  # 24小时

# 超时限制
SINGLE_DOC_TIMEOUT = 5  # 单文档5秒
TOTAL_TIMEOUT = 15  # 总超时15秒
MAX_CONTENT_LENGTH = 5000  # 截断至5000字符


def extract_lark_doc_urls(text: str) -> list[dict]:
    """从文本中提取所有 Lark 文档 URL。

    Returns:
        [{"url": "...", "doc_token": "...", "doc_type": "docx|wiki|..."}]
    """
    results = []
    seen = set()
    for match in LARK_DOC_PATTERN.finditer(text):
        url = match.group(0)
        doc_type = match.group(2)
        doc_token = match.group(3)
        if doc_token not in seen:
            seen.add(doc_token)
            results.append({"url": url, "doc_token": doc_token, "doc_type": doc_type})
    return results


def _get_cache_path(doc_token: str) -> Path:
    return CACHE_DIR / f"{doc_token}.json"


def _read_cache(doc_token: str) -> Optional[str]:
    """读取缓存（未过期则返回内容，否则None）。"""
    cache_path = _get_cache_path(doc_token)
    if not cache_path.exists():
        return None
    try:
        data = json.loads(cache_path.read_text(encoding="utf-8"))
        if time.time() - data.get("ts", 0) < CACHE_TTL:
            return data.get("content", "")
    except (json.JSONDecodeError, OSError):
        pass
    return None


def _write_cache(doc_token: str, content: str) -> None:
    """写入缓存。"""
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache_path = _get_cache_path(doc_token)
        cache_path.write_text(
            json.dumps({"ts": time.time(), "content": content}, ensure_ascii=False),
            encoding="utf-8",
        )
    except OSError as e:
        logger.debug("write lark doc cache failed: %s", e)


async def fetch_lark_doc_content(doc_url: str, doc_token: str, doc_type: str = "docx") -> str:
    """通过 Lark OpenAPI 获取文档纯文本内容。

    - 优先读缓存
    - 调用 Lark 文档 API 获取内容（纯文本格式）
    - 截断至 MAX_CONTENT_LENGTH 字符
    - 写入缓存
    - 超时保护 SINGLE_DOC_TIMEOUT 秒
    """
    # 1. 尝试缓存
    cached = _read_cache(doc_token)
    if cached is not None:
        return cached

    # 2. 通过 Lark API 获取
    try:
        content = await asyncio.wait_for(
            _fetch_doc_from_api(doc_token, doc_type),
            timeout=SINGLE_DOC_TIMEOUT,
        )
    except asyncio.TimeoutError:
        logger.warning("fetch lark doc timeout: %s", doc_token)
        return f"[Lark文档: {doc_url} — 获取超时，请手动查看]"
    except Exception as e:
        logger.debug("fetch lark doc failed: %s %s", doc_token, e)
        return f"[Lark文档: {doc_url} — 获取失败]"

    # 3. 截断
    if len(content) > MAX_CONTENT_LENGTH:
        content = content[:MAX_CONTENT_LENGTH] + "\n\n...(内容已截断)"

    # 4. 写缓存
    _write_cache(doc_token, content)
    return content


async def _fetch_doc_from_api(doc_token: str, doc_type: str) -> str:
    """调用 Lark OpenAPI 获取文档内容。"""
    try:
        from backend.services.lark_bridge import lark_bridge
        client = lark_bridge._get_client()
        if client is None:
            return ""

        # 使用 lark_oapi 获取文档纯文本
        if doc_type in ("docx", "wiki"):
            return await asyncio.to_thread(_get_docx_content, client, doc_token)
        else:
            # sheets/base/slides 暂不支持内容提取，返回链接提示
            return f"[{doc_type}类型文档，请通过链接查看]"
    except ImportError:
        logger.debug("lark_oapi not available for doc fetch")
        return ""


def _get_docx_content(client, doc_token: str) -> str:
    """同步获取 docx 文档的纯文本内容。"""
    try:
        from lark_oapi.api.docx.v1 import RawContentDocumentRequest

        request = (
            RawContentDocumentRequest.builder()
            .document_id(doc_token)
            .build()
        )
        response = client.docx.v1.document.raw_content(request)
        if response.success():
            return response.data.content or ""
        else:
            logger.debug("lark docx raw_content failed: %s", response.msg)
            return ""
    except Exception as e:
        logger.debug("_get_docx_content error: %s", e)
        return ""


async def fetch_all_lark_docs(prompt_text: str) -> str:
    """从 prompt 文本中提取所有 Lark 文档链接并获取内容。

    返回格式化的文档内容字符串，用于追加到 Agent prompt。
    总超时 TOTAL_TIMEOUT 秒。
    """
    docs = extract_lark_doc_urls(prompt_text)
    if not docs:
        return ""

    # 限制最多5个文档
    docs = docs[:5]

    try:
        results = await asyncio.wait_for(
            _fetch_docs_batch(docs),
            timeout=TOTAL_TIMEOUT,
        )
    except asyncio.TimeoutError:
        logger.warning("fetch_all_lark_docs total timeout")
        results = []

    if not results:
        return ""

    parts = ["# Lark 文档内容\n"]
    for doc_info, content in results:
        if content:
            parts.append(f"## 文档: {doc_info['url']}\n\n{content}\n")

    return "\n".join(parts) if len(parts) > 1 else ""


async def _fetch_docs_batch(docs: list[dict]) -> list[tuple[dict, str]]:
    """批量获取文档内容。"""
    tasks = [
        fetch_lark_doc_content(d["url"], d["doc_token"], d["doc_type"])
        for d in docs
    ]
    contents = await asyncio.gather(*tasks, return_exceptions=True)
    results = []
    for doc_info, content in zip(docs, contents):
        if isinstance(content, Exception):
            content = f"[获取失败: {content}]"
        results.append((doc_info, content))
    return results
