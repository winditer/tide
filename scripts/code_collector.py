#!/usr/bin/env python3
"""代码收集器：收集仓库关键信息供 LLM 分析。

功能：
- 生成文件树（忽略 node_modules/.git 等）
- 读取关键文件内容
- 智能截断以适配 LLM 上下文窗口
"""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from typing import Optional

logger = logging.getLogger("tide.code_collector")

# ── 忽略目录/文件 ────────────────────────────────────────────────────────────

IGNORE_DIRS = {
    # 通用
    ".git", ".svn", ".hg", ".idea", ".vscode", ".DS_Store",
    "__pycache__", "*.egg-info", "dist", "build", "target",
    # Node.js
    "node_modules", ".next", ".nuxt", ".svelte-kit",
    # Python
    ".venv", "venv", ".tox", ".mypy_cache", ".pytest_cache",
    # Go
    "vendor",
    # 其他
    "coverage", ".coverage", "htmlcov",
    ".knowledge",  # 知识图谱自身
}

IGNORE_FILES = {
    # 锁文件
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
    "poetry.lock", "Pipfile.lock", "go.sum",
    # 二进制/大文件
    "*.min.js", "*.min.css", "*.map", "*.lock",
    # 其他
    ".env", ".env.local", ".env.*.local",
}

# ── 关键文件模式 ──────────────────────────────────────────────────────────────

# 各语言的关键文件模式
KEY_FILE_PATTERNS = {
    "typescript": [
        "package.json",
        "tsconfig*.json",
        "next.config.*",
        "vite.config.*",
        "src/**/*.{ts,tsx}",
        "app/**/*.{ts,tsx}",
        "pages/**/*.{ts,tsx}",
        "components/**/*.{ts,tsx}",
        "lib/**/*.{ts,tsx}",
        "api/**/*.{ts,tsx}",
        "prisma/schema.prisma",
    ],
    "javascript": [
        "package.json",
        "*.config.js",
        "src/**/*.js",
        "lib/**/*.js",
        "routes/**/*.js",
    ],
    "go": [
        "go.mod",
        "go.sum",
        "main.go",
        "**/*.go",
        "internal/**/*.go",
        "pkg/**/*.go",
        "cmd/**/*.go",
        "handlers/**/*.go",
        "models/**/*.go",
    ],
    "rust": [
        "Cargo.toml",
        "src/**/*.rs",
        "src/main.rs",
        "src/lib.rs",
    ],
    "java": [
        "pom.xml",
        "build.gradle",
        "src/main/java/**/*.java",
    ],
    "python": [
        "pyproject.toml",
        "setup.py",
        "requirements*.txt",
        "**/*.py",
    ],
}

# API 路由文件模式
API_ROUTE_PATTERNS = [
    # Python
    "**/api/*.py",
    "**/routes/*.py",
    "**/views/*.py",
    # TypeScript/JavaScript
    "**/api/**/*.ts",
    "**/routes/**/*.ts",
    "**/controllers/**/*.ts",
    "**/api/**/*.js",
    "**/routes/**/*.js",
    "**/controllers/**/*.js",
    # Go
    "**/handlers/*.go",
    "**/routes/*.go",
]

# 数据库模型文件模式
DB_MODEL_PATTERNS = [
    # SQL
    "**/*.sql",
    "**/migrations/*.sql",
    "**/migrations/**/*.sql",
    # Python ORM
    "**/models/*.py",
    "**/models.py",
    # TypeScript ORM
    "**/prisma/schema.prisma",
    "**/entities/*.ts",
    "**/*.entity.ts",
    # Go ORM
    "**/models/*.go",
]


# ── 工具函数 ──────────────────────────────────────────────────────────────────


def _should_ignore(path: Path) -> bool:
    """检查是否应该忽略该路径。"""
    name = path.name

    # 检查目录名
    for pattern in IGNORE_DIRS:
        if pattern.startswith("*"):
            if name.endswith(pattern[1:]):
                return True
        elif name == pattern:
            return True

    # 检查文件名
    for pattern in IGNORE_FILES:
        if "*" in pattern:
            if pattern.startswith("*."):
                if name.endswith(pattern[1:]):
                    return True
            elif pattern.endswith(".*"):
                if name.startswith(pattern[:-2]):
                    return True
        elif name == pattern:
            return True

    return False


def _safe_read(path: Path, max_size: int = 50_000) -> str:
    """安全读取文件内容，限制大小。"""
    try:
        size = path.stat().st_size
        if size > max_size:
            logger.debug("File too large (%d bytes): %s", size, path)
            return path.read_text(encoding="utf-8")[:max_size] + "\n... [truncated]"
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return ""


def _estimate_tokens(text: str) -> int:
    """粗略估算文本 token 数（约 4 字符 = 1 token）。"""
    return len(text) // 4


# ── 主要功能 ──────────────────────────────────────────────────────────────────


def collect_repo_structure(repo_path: "Path | str", max_depth: int = 4) -> str:
    """生成仓库文件树。

    Args:
        repo_path: 仓库根目录
        max_depth: 最大目录深度

    Returns:
        格式化的文件树字符串
    """
    repo_path = Path(repo_path)
    lines: list[str] = []
    lines.append(f"# 仓库: {repo_path.name}")
    lines.append("")

    def walk(dir_path: Path, prefix: str = "", depth: int = 0) -> None:
        if depth > max_depth:
            return

        try:
            entries = sorted(dir_path.iterdir(), key=lambda p: (not p.is_dir(), p.name))
        except PermissionError:
            return

        # 过滤忽略项
        entries = [e for e in entries if not _should_ignore(e)]

        for i, entry in enumerate(entries):
            is_last = i == len(entries) - 1
            connector = "└── " if is_last else "├── "
            extension = "    " if is_last else "│   "

            if entry.is_dir():
                lines.append(f"{prefix}{connector}{entry.name}/")
                walk(entry, prefix + extension, depth + 1)
            else:
                lines.append(f"{prefix}{connector}{entry.name}")

    walk(repo_path)
    return "\n".join(lines)


def collect_key_files(
    repo_path: "Path | str",
    languages: list[str],
    max_files: int = 50,
    max_total_tokens: int = 60_000,
) -> str:
    """收集关键文件内容。

    Args:
        repo_path: 仓库根目录
        languages: 检测到的语言列表
        max_files: 最大文件数
        max_total_tokens: 最大总 token 数

    Returns:
        格式化的文件内容字符串
    """
    repo_path = Path(repo_path)
    collected: list[tuple[str, str]] = []  # (path, content)
    total_tokens = 0

    # 收集各语言的关键文件
    patterns_to_collect: set[str] = set()

    for lang in languages:
        lang_patterns = KEY_FILE_PATTERNS.get(lang.lower(), [])
        patterns_to_collect.update(lang_patterns)

    # 总是收集 API 路由和数据库模型
    patterns_to_collect.update(API_ROUTE_PATTERNS)
    patterns_to_collect.update(DB_MODEL_PATTERNS)

    # 去重已处理的文件
    processed: set[Path] = set()

    for pattern in sorted(patterns_to_collect):
        if len(collected) >= max_files:
            break
        if total_tokens >= max_total_tokens:
            break

        # 处理 glob 模式
        if "*" in pattern:
            try:
                matches = list(repo_path.glob(pattern))
            except ValueError:
                continue
        else:
            # 精确路径
            target = repo_path / pattern
            matches = [target] if target.exists() else []

        for file_path in matches[:10]:  # 每个模式最多 10 个文件
            if not file_path.is_file():
                continue
            if file_path in processed:
                continue
            if _should_ignore(file_path):
                continue

            content = _safe_read(file_path)
            if not content:
                continue

            rel_path = str(file_path.relative_to(repo_path))
            tokens = _estimate_tokens(content)

            if total_tokens + tokens > max_total_tokens:
                # 截断这个文件
                remaining = max_total_tokens - total_tokens
                content = content[:remaining * 4] + "\n... [truncated]"
                tokens = remaining

            collected.append((rel_path, content))
            processed.add(file_path)
            total_tokens += tokens

            if len(collected) >= max_files:
                break

    # 格式化输出
    lines: list[str] = []
    lines.append("# 关键文件内容")
    lines.append("")

    for path, content in collected:
        lines.append(f"## {path}")
        lines.append("```")
        lines.append(content[:3000])  # 单文件最多 3000 字符
        if len(content) > 3000:
            lines.append("... [truncated]")
        lines.append("```")
        lines.append("")

    return "\n".join(lines)


def truncate_for_context(text: str, max_tokens: int = 30_000) -> str:
    """智能截断文本以适配上下文窗口。

    优先保留：
    1. 文件开头（imports, 类定义）
    2. 函数/方法签名
    3. 关键注释

    Args:
        text: 原始文本
        max_tokens: 最大 token 数

    Returns:
        截断后的文本
    """
    max_chars = max_tokens * 4

    if len(text) <= max_chars:
        return text

    # 简单截断：保留开头
    truncated = text[:max_chars]

    # 尝试在完整行处截断
    last_newline = truncated.rfind("\n")
    if last_newline > max_chars * 0.8:
        truncated = truncated[:last_newline]

    return truncated + "\n\n... [content truncated for context window]"


def build_repo_context(
    repo_path: "Path | str",
    languages: list[str],
    max_tokens: int = 80_000,
) -> str:
    """构建完整的仓库上下文信息。

    Args:
        repo_path: 仓库根目录
        languages: 检测到的语言列表
        max_tokens: 最大总 token 数

    Returns:
        结构化的仓库上下文字符串
    """
    repo_path = Path(repo_path)
    parts: list[str] = []

    # 1. 文件树（约占 5% tokens）
    tree = collect_repo_structure(repo_path)
    tree_tokens = _estimate_tokens(tree)
    if tree_tokens > max_tokens * 0.1:
        tree = truncate_for_context(tree, int(max_tokens * 0.1))
    parts.append(tree)

    # 2. 关键文件（约占 90% tokens）
    remaining_tokens = max_tokens - _estimate_tokens(tree)
    key_files = collect_key_files(repo_path, languages, max_total_tokens=remaining_tokens)
    parts.append(key_files)

    return "\n\n---\n\n".join(parts)


def detect_languages(repo_path: "Path | str") -> list[tuple[str, float]]:
    """检测仓库使用的主要编程语言。

    Returns:
        语言列表，每项为 (language_name, confidence)
        confidence 范围 0-1，按置信度降序排列
    """
    repo_path = Path(repo_path)
    scores: dict[str, int] = {}

    # 文件扩展名统计
    ext_map = {
        ".py": "python",
        ".ts": "typescript",
        ".tsx": "typescript",
        ".js": "javascript",
        ".jsx": "javascript",
        ".go": "go",
        ".rs": "rust",
        ".java": "java",
        ".kt": "kotlin",
        ".rb": "ruby",
        ".php": "php",
        ".cs": "csharp",
        ".swift": "swift",
    }

    # 配置文件检测（加权）
    config_indicators = {
        "python": ["pyproject.toml", "setup.py", "requirements.txt", "Pipfile", "poetry.lock"],
        "typescript": ["tsconfig.json", "package.json"],
        "javascript": ["package.json"],
        "go": ["go.mod"],
        "rust": ["Cargo.toml"],
        "java": ["pom.xml", "build.gradle", "build.gradle.kts"],
        "kotlin": ["build.gradle.kts"],
        "ruby": ["Gemfile"],
        "php": ["composer.json"],
        "csharp": ["*.csproj", "*.sln"],
        "swift": ["Package.swift"],
    }

    # 统计文件扩展名
    file_count = 0
    for root, dirs, files in os.walk(repo_path):
        # 忽略目录
        dirs[:] = [d for d in dirs if d not in IGNORE_DIRS and not d.startswith(".")]

        for f in files:
            ext = Path(f).suffix.lower()
            if ext in ext_map:
                lang = ext_map[ext]
                scores[lang] = scores.get(lang, 0) + 1
                file_count += 1

    # 配置文件加权
    for lang, indicators in config_indicators.items():
        for indicator in indicators:
            if "*" in indicator:
                matches = list(repo_path.glob(indicator))
                if matches:
                    scores[lang] = scores.get(lang, 0) + 10
            elif (repo_path / indicator).exists():
                scores[lang] = scores.get(lang, 0) + 10

    if not scores or file_count == 0:
        return []

    # 计算置信度
    total = sum(scores.values())
    result = [(lang, count / total) for lang, count in scores.items()]
    result.sort(key=lambda x: -x[1])

    return result
