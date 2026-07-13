"""gstack Skills 转换脚本。

遍历 gstack 仓库中所有 SKILL.md 文件，将其转换为 Tide Skills 格式
（Markdown + YAML Front Matter），输出到指定目录。

用法：
    python scripts/import_gstack_skills.py /tmp/gstack /tmp/gstack_converted
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from typing import Optional


# 分类规则映射
CATEGORY_RULES: dict[str, str] = {
    # security
    "cso": "security",
    "guard": "security",
    # testing
    "qa": "testing",
    "qa-only": "testing",
    "ios-qa": "testing",
    "benchmark": "testing",
    "benchmark-models": "testing",
    # devops
    "ship": "devops",
    "land-and-deploy": "devops",
    "canary": "devops",
    "setup-deploy": "devops",
    # ai-agent (explicit overrides for keyword-based misclassification)
    "browse": "ai-agent",
    "investigate": "ai-agent",
    "autoplan": "ai-agent",
    "ios-fix": "ai-agent",
    "ios-clean": "ai-agent",
    "ios-sync": "ai-agent",
    "design-review": "ai-agent",
    # general
    "document-generate": "general",
    "document-release": "general",
    "make-pdf": "general",
    "learn": "general",
    "gstack-upgrade": "general",
    "skillify": "general",
    "setup-browser-cookies": "general",
    "setup-gbrain": "general",
    "sync-gbrain": "general",
    "open-gstack-browser": "general",
    "context-save": "general",
    "context-restore": "general",
    "freeze": "general",
    "unfreeze": "general",
    "health": "general",
    "landing-report": "general",
    "scrape": "general",
}

# 默认分类：大部分 gstack skills 都是 AI Agent 相关
DEFAULT_CATEGORY = "ai-agent"


def infer_category(skill_name: str, description: str = "") -> str:
    """根据 skill 名称和描述推断分类。"""
    name_lower = skill_name.lower()

    # 直接匹配
    if name_lower in CATEGORY_RULES:
        return CATEGORY_RULES[name_lower]

    # 基于关键词推断
    desc_lower = description.lower()
    combined = f"{name_lower} {desc_lower}"

    if any(kw in combined for kw in ["security", "vulnerabilit", "owasp", "threat"]):
        return "security"
    if any(kw in combined for kw in ["test", "qa", "benchmark", "bug"]):
        return "testing"
    if any(kw in combined for kw in ["deploy", "ship", "canary", "ci/cd", "pipeline"]):
        return "devops"
    if any(kw in combined for kw in ["document", "pdf", "release note"]):
        return "general"

    return DEFAULT_CATEGORY


def parse_gstack_frontmatter(text: str) -> tuple[dict, str]:
    """解析 gstack SKILL.md 的 YAML front-matter，返回 (meta, body)。"""
    if not text.startswith("---"):
        return {}, text
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", text, flags=re.DOTALL)
    if not m:
        return {}, text
    meta_text, body = m.group(1), m.group(2)

    meta: dict = {}
    for line in meta_text.splitlines():
        line = line.rstrip()
        if not line or line.lstrip().startswith("#"):
            continue
        if ":" not in line:
            continue
        # 跳过缩进行（列表项）
        if line.startswith("  ") or line.startswith("\t"):
            # 如果当前有列表 key，追加
            if "_current_list_key" in meta:
                val = line.strip().lstrip("- ").strip()
                if val:
                    meta[meta["_current_list_key"]].append(val)
            continue

        key, _, value = line.partition(":")
        key = key.strip()
        value = value.strip()
        if not key:
            continue

        # 检测是否是列表开始（值为空，后续行是 - items）
        if value == "":
            meta[key] = []
            meta["_current_list_key"] = key
            continue
        else:
            meta.pop("_current_list_key", None)

        # 解析值
        if value.startswith("[") and value.endswith("]"):
            inner = value[1:-1]
            arr = [v.strip().strip("'\"") for v in inner.split(",") if v.strip()]
            meta[key] = arr
        elif value.lower() in ("true", "false"):
            meta[key] = value.lower() == "true"
        else:
            meta[key] = value.strip("'\"")

    meta.pop("_current_list_key", None)
    return meta, body


def derive_slug(skill_dir: str) -> str:
    """从目录路径生成 slug。"""
    # 对嵌套路径如 openclaw/skills/gstack-openclaw-investigate 取最后一段
    return skill_dir.replace("/", "-").replace("_", "-").lower()


def convert_skill(skill_md_path: Path, gstack_root: Path) -> Optional[dict]:
    """将单个 gstack SKILL.md 转换为 Tide 格式，返回 {slug, content} 或 None。"""
    try:
        raw = skill_md_path.read_text(encoding="utf-8")
    except OSError:
        return None

    meta, body = parse_gstack_frontmatter(raw)
    if not meta and not body.strip():
        return None

    # 从路径推导 skill 目录名
    rel_path = skill_md_path.parent.relative_to(gstack_root)
    dir_name = str(rel_path)

    # 跳过根目录的 SKILL.md（是总览文件）
    if dir_name == ".":
        return None

    name = meta.get("name", dir_name)
    slug = f"gstack-{derive_slug(dir_name)}"
    description = meta.get("description", f"{name} skill from gstack")
    # 清理 description 中的 "(gstack)" 后缀
    description = description.replace("(gstack)", "").strip().rstrip(".")

    category = infer_category(dir_name, description)

    # 构造 Tide 格式 front-matter
    tags = ["gstack"]
    if meta.get("triggers"):
        triggers = meta["triggers"]
        if isinstance(triggers, list):
            # 取前3个 trigger 作为额外 tag
            for t in triggers[:2]:
                tag = t.strip().replace(" ", "-")[:20]
                if tag:
                    tags.append(tag)

    tags_str = ", ".join(tags)

    tide_frontmatter = f"""---
name: "{name}"
slug: {slug}
description: "{description}"
category: {category}
tags: [{tags_str}]
enabled: true
---"""

    # 清理 body 中的 gstack-specific preamble bash 部分（保留有用内容）
    # 移除 AUTO-GENERATED 注释
    body = re.sub(
        r"<!--\s*AUTO-GENERATED.*?-->", "", body, flags=re.DOTALL
    ).strip()
    body = re.sub(
        r"<!--\s*Regenerate:.*?-->", "", body, flags=re.DOTALL
    ).strip()

    full_content = f"{tide_frontmatter}\n\n{body}\n"

    return {
        "slug": slug,
        "name": name,
        "category": category,
        "content": full_content,
    }


def main(argv: Optional[list[str]] = None) -> int:
    if argv is None:
        argv = sys.argv[1:]

    if len(argv) < 2:
        print(f"Usage: python {sys.argv[0]} <gstack_dir> <output_dir>")
        return 1

    gstack_dir = Path(argv[0])
    output_dir = Path(argv[1])

    if not gstack_dir.exists():
        print(f"Error: gstack directory not found: {gstack_dir}")
        return 1

    output_dir.mkdir(parents=True, exist_ok=True)

    # 查找所有 SKILL.md 文件
    skill_files = sorted(gstack_dir.rglob("SKILL.md"))
    print(f"Found {len(skill_files)} SKILL.md files in {gstack_dir}")

    converted = 0
    skipped = 0

    for skill_md in skill_files:
        result = convert_skill(skill_md, gstack_dir)
        if result is None:
            skipped += 1
            continue

        # 写入输出文件
        out_file = output_dir / f"{result['slug']}.md"
        out_file.write_text(result["content"], encoding="utf-8")
        converted += 1
        print(f"  [{result['category']:10s}] {result['slug']} -> {out_file.name}")

    print(f"\nDone: converted={converted}, skipped={skipped}, total={len(skill_files)}")
    print(f"Output directory: {output_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
