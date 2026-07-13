"""Superpowers Skills 转换脚本。

遍历 Superpowers 仓库 skills/ 目录中所有 SKILL.md 文件，
将其转换为 Tide Skills 格式（Markdown + YAML Front Matter），输出到指定目录。

用法：
    python3 scripts/import_superpowers_skills.py [superpowers_dir] [output_dir]

默认：
    superpowers_dir = /tmp/superpowers/skills
    output_dir = /tmp/superpowers_converted
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from typing import Optional


# 分类规则映射（基于 skill 目录名）
CATEGORY_RULES: dict[str, str] = {
    # testing
    "test-driven-development": "testing",
    "systematic-debugging": "testing",
    "verification-before-completion": "testing",
    # ai-agent
    "writing-plans": "ai-agent",
    "executing-plans": "ai-agent",
    "dispatching-parallel-agents": "ai-agent",
    "subagent-driven-development": "ai-agent",
    "requesting-code-review": "ai-agent",
    "receiving-code-review": "ai-agent",
    # devops
    "finishing-a-development-branch": "devops",
    "using-git-worktrees": "devops",
    # general
    "brainstorming": "general",
    "writing-skills": "general",
    "using-superpowers": "general",
}

DEFAULT_CATEGORY = "ai-agent"


def infer_category(skill_name: str, description: str = "") -> str:
    """根据 skill 目录名和描述推断分类。"""
    name_lower = skill_name.lower()

    # 直接匹配
    if name_lower in CATEGORY_RULES:
        return CATEGORY_RULES[name_lower]

    # 基于关键词推断
    desc_lower = description.lower()
    combined = f"{name_lower} {desc_lower}"

    if any(kw in combined for kw in ["security", "vulnerabilit", "owasp", "threat"]):
        return "security"
    if any(kw in combined for kw in ["test", "debug", "qa", "verif", "bug"]):
        return "testing"
    if any(kw in combined for kw in ["deploy", "ship", "branch", "git", "ci/cd"]):
        return "devops"
    if any(kw in combined for kw in ["document", "brainstorm", "writing"]):
        return "general"

    return DEFAULT_CATEGORY


def parse_frontmatter(text: str) -> tuple[dict, str]:
    """解析 SKILL.md 的 YAML front-matter，返回 (meta, body)。"""
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
        key, _, value = line.partition(":")
        key = key.strip()
        value = value.strip()
        if not key:
            continue

        # 解析值
        if value.startswith("[") and value.endswith("]"):
            inner = value[1:-1]
            arr = [v.strip().strip("'\"") for v in inner.split(",") if v.strip()]
            meta[key] = arr
        elif value.lower() in ("true", "false"):
            meta[key] = value.lower() == "true"
        else:
            # 去除引号
            meta[key] = value.strip("'\"")

    return meta, body


def make_display_name(dir_name: str) -> str:
    """将目录名转为显示名称，如 test-driven-development -> Test Driven Development。"""
    return " ".join(word.capitalize() for word in dir_name.split("-"))


def convert_skill(skill_md_path: Path, skills_root: Path) -> Optional[dict]:
    """将单个 Superpowers SKILL.md 转换为 Tide 格式，返回 {slug, content} 或 None。"""
    try:
        raw = skill_md_path.read_text(encoding="utf-8")
    except OSError:
        return None

    meta, body = parse_frontmatter(raw)
    if not meta and not body.strip():
        return None

    # 获取 skill 目录名
    rel_path = skill_md_path.parent.relative_to(skills_root)
    dir_name = str(rel_path).split("/")[0]  # 取第一级目录

    # 跳过根目录
    if dir_name == ".":
        return None

    # 从 front-matter 中获取 name 和 description
    name = meta.get("name", dir_name)
    # 生成显示名
    display_name = make_display_name(dir_name)
    description = meta.get("description", f"{display_name} skill from Superpowers")
    # 清理 description 中的多余引号
    if isinstance(description, str):
        description = description.strip('"').strip()

    slug = f"superpowers-{dir_name}"
    category = infer_category(dir_name, description)

    # 构造 tags
    tags = ["superpowers"]
    # 根据 category 添加额外 tag
    if category == "testing":
        tags.append("tdd")
    elif category == "ai-agent":
        tags.append("automation")
    elif category == "devops":
        tags.append("git")

    tags_str = ", ".join(tags)

    tide_frontmatter = f"""---
name: "{display_name}"
slug: {slug}
description: "{description}"
category: {category}
tags: [{tags_str}]
enabled: true
---"""

    # 清理 body：移除不必要的标记
    body = re.sub(
        r"<!--\s*AUTO-GENERATED.*?-->", "", body, flags=re.DOTALL
    ).strip()

    full_content = f"{tide_frontmatter}\n\n{body}\n"

    return {
        "slug": slug,
        "name": display_name,
        "category": category,
        "content": full_content,
    }


def main(argv: Optional[list[str]] = None) -> int:
    if argv is None:
        argv = sys.argv[1:]

    # 默认路径
    superpowers_dir = Path(argv[0]) if len(argv) > 0 else Path("/tmp/superpowers/skills")
    output_dir = Path(argv[1]) if len(argv) > 1 else Path("/tmp/superpowers_converted")

    if not superpowers_dir.exists():
        print(f"Error: Superpowers skills directory not found: {superpowers_dir}")
        return 1

    output_dir.mkdir(parents=True, exist_ok=True)

    # 查找所有 SKILL.md 文件
    skill_files = sorted(superpowers_dir.rglob("SKILL.md"))
    print(f"Found {len(skill_files)} SKILL.md files in {superpowers_dir}")

    converted = 0
    skipped = 0

    for skill_md in skill_files:
        result = convert_skill(skill_md, superpowers_dir)
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
