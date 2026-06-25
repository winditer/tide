"""ECC Skills 批量导入脚本。

从本地 ECC Skills 仓库目录批量扫描 ``*.md`` 文件，解析 YAML front-matter +
Markdown 正文，并通过 ``skill_service.upsert`` 写入 ``skills`` 表。

YAML front-matter 字段约定：

```yaml
---
name: 文档检索 Skill          # 必填，Skill 显示名
slug: doc-retrieval           # 可选，未填时基于 name 自动生成
description: ...              # 可选
category: research            # 可选，默认 general
tags: [doc, retrieval]        # 可选
enabled: true                 # 可选，默认 true
---
正文 Markdown ...
```

用法示例::

    python -m backend.scripts.import_ecc_skills /path/to/ecc/skills \\
        --workspace default --category research

不指定 ``--category`` 时导入全部分类。可重复执行：相同 ``(workspace_id, slug)``
将走 upsert 更新内容并自增 version。
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import re
import sys
from pathlib import Path
from typing import Optional

logger = logging.getLogger("tide.import_ecc_skills")


def _parse_front_matter(text: str) -> tuple[dict, str]:
    """解析 ``---`` 包裹的 YAML front-matter，返回 (meta, body)。

    缺少 front-matter 时返回 ({}, 原文)。
    """
    if not text.startswith("---"):
        return {}, text
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", text, flags=re.DOTALL)
    if not m:
        return {}, text
    meta_text, body = m.group(1), m.group(2)
    try:
        import yaml  # type: ignore[import-not-found]
        meta = yaml.safe_load(meta_text) or {}
        if not isinstance(meta, dict):
            meta = {}
    except ImportError:
        meta = _naive_yaml_parse(meta_text)
    except Exception:
        logger.exception("front-matter YAML parse failed")
        meta = {}
    return meta, body


def _naive_yaml_parse(text: str) -> dict:
    """极简 YAML 解析（仅支持 ``key: value`` / ``key: [a, b]``），作为
    PyYAML 缺失时的降级方案。生产环境建议安装 ``pyyaml``。"""
    result: dict = {}
    for line in text.splitlines():
        line = line.rstrip()
        if not line or line.lstrip().startswith("#"):
            continue
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        key = key.strip()
        value = value.strip()
        if not key:
            continue
        if value.startswith("[") and value.endswith("]"):
            inner = value[1:-1]
            arr = [v.strip().strip("'\"") for v in inner.split(",") if v.strip()]
            result[key] = arr
        elif value.lower() in ("true", "false"):
            result[key] = value.lower() == "true"
        else:
            result[key] = value.strip("'\"")
    return result


async def _import_one(
    workspace_id: str,
    md_path: Path,
    category_filter: Optional[str],
    source_label: str,
) -> Optional[dict]:
    from backend.services.skill_service import skill_service

    try:
        raw = md_path.read_text(encoding="utf-8")
    except OSError as exc:
        logger.warning("read %s failed: %s", md_path, exc)
        return None

    meta, body = _parse_front_matter(raw)
    name = (meta.get("name") or md_path.stem).strip()
    category = (meta.get("category") or "general").strip() or "general"
    if category_filter and category != category_filter:
        return None

    payload = {
        "name": name,
        "slug": meta.get("slug"),
        "description": meta.get("description"),
        "category": category,
        "tags": meta.get("tags"),
        "enabled": 1 if meta.get("enabled", True) else 0,
    }
    return await skill_service.upsert(
        workspace_id=workspace_id,
        metadata=payload,
        content=body.strip() or raw,
        source=source_label,
    )


async def import_skills(
    src: Path,
    workspace_id: str = "default",
    category: Optional[str] = None,
    source_label: str = "ecc",
) -> dict:
    """扫描 ``src`` 下所有 ``*.md`` 并导入。返回 {imported, skipped} 统计。"""
    if not src.exists():
        raise FileNotFoundError(f"source path not found: {src}")

    md_files = sorted(src.rglob("*.md")) if src.is_dir() else [src]
    imported = 0
    skipped = 0
    for md in md_files:
        try:
            result = await _import_one(workspace_id, md, category, source_label)
        except Exception:
            logger.exception("import %s failed", md)
            skipped += 1
            continue
        if result:
            imported += 1
            logger.info(
                "imported skill: %s (slug=%s, category=%s)",
                result.get("name"), result.get("slug"), result.get("category"),
            )
        else:
            skipped += 1
    return {"imported": imported, "skipped": skipped, "total": len(md_files)}


def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="import_ecc_skills",
        description="批量导入 ECC Skills 到 Tide skills 表",
    )
    p.add_argument("src", type=Path, help="ECC Skills 目录或单个 .md 文件路径")
    p.add_argument(
        "--workspace", default="default", help="目标 workspace_id（默认 default）"
    )
    p.add_argument(
        "--category", default=None, help="仅导入指定 category（默认导入全部）"
    )
    p.add_argument(
        "--source", default="ecc", help="source 字段，标识导入来源（默认 ecc）"
    )
    p.add_argument(
        "--log-level", default="INFO", help="日志级别（DEBUG/INFO/WARNING）"
    )
    return p


def main(argv: Optional[list[str]] = None) -> int:
    args = _build_arg_parser().parse_args(argv)
    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(message)s",
    )

    # 确保 DB 已初始化（首次执行可能 skills 表尚未创建）
    from backend.db.engine import init_db

    async def run() -> dict:
        await init_db()
        return await import_skills(
            src=args.src,
            workspace_id=args.workspace,
            category=args.category,
            source_label=args.source,
        )

    stats = asyncio.run(run())
    logger.info(
        "Done. imported=%s skipped=%s total=%s",
        stats["imported"], stats["skipped"], stats["total"],
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
