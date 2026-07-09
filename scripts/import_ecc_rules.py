#!/usr/bin/env python3
"""Import ECC Rules into Tide rules engine."""

import sqlite3
import uuid
import os
import sys
from pathlib import Path
from datetime import datetime

# 配置（忽略以 -- 开头的 flag，只取位置参数）
_positional = [a for a in sys.argv[1:] if not a.startswith("--")]
ECC_RULES_DIR = _positional[0] if len(_positional) > 0 else "/tmp/ecc_repo/rules"
DB_PATH = _positional[1] if len(_positional) > 1 else str(Path(__file__).parent.parent / "tide.db")
WORKSPACE_ID = "default"

# 目录到 scope 的映射
SCOPE_MAP = {
    "common": ("global", None, 1),      # (scope, scope_value, priority)
    "typescript": ("language", "typescript", 10),
    "python": ("language", "python", 10),
    "golang": ("language", "golang", 10),
    "web": ("language", "web", 10),
    "angular": ("language", "angular", 10),
    "vue": ("language", "vue", 10),
    "nuxt": ("language", "nuxt", 10),
    "swift": ("language", "swift", 10),
    "php": ("language", "php", 10),
    "ruby": ("language", "ruby", 10),
    "react-native": ("language", "react-native", 10),
    "arkts": ("language", "arkts", 10),
    "java": ("language", "java", 10),
    "kotlin": ("language", "kotlin", 10),
    "rust": ("language", "rust", 10),
    "cpp": ("language", "cpp", 10),
    "csharp": ("language", "csharp", 10),
    "dart": ("language", "dart", 10),
    "fsharp": ("language", "fsharp", 10),
    "perl": ("language", "perl", 10),
    "react": ("language", "react", 10),
}


def import_rules(dry_run=False):
    rules_dir = Path(ECC_RULES_DIR)
    if not rules_dir.exists():
        print(f"ERROR: Rules directory not found: {rules_dir}")
        sys.exit(1)

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # 统计
    imported = 0
    updated = 0
    skipped = 0

    now = datetime.utcnow().isoformat()

    for subdir in sorted(rules_dir.iterdir()):
        if not subdir.is_dir():
            continue

        dir_name = subdir.name
        if dir_name not in SCOPE_MAP:
            print(f"  SKIP directory: {dir_name} (not in scope map)")
            skipped += 1
            continue

        scope, scope_value, priority = SCOPE_MAP[dir_name]

        for md_file in sorted(subdir.glob("*.md")):
            name = f"[ECC] {md_file.stem} ({dir_name})"
            content = md_file.read_text(encoding="utf-8").strip()

            if not content:
                print(f"  SKIP empty file: {md_file}")
                skipped += 1
                continue

            # 检查是否已存在（按 name + workspace_id）
            cursor.execute(
                "SELECT id FROM rules WHERE workspace_id=? AND name=?",
                (WORKSPACE_ID, name)
            )
            existing = cursor.fetchone()

            if dry_run:
                action = "UPDATE" if existing else "INSERT"
                print(f"  [{action}] {name} (scope={scope}, scope_value={scope_value}, priority={priority}, content_len={len(content)})")
            else:
                if existing:
                    # 更新
                    cursor.execute(
                        """UPDATE rules SET content=?, scope=?, scope_value=?, priority=?,
                           enabled=1, source='imported', updated_at=?
                           WHERE id=?""",
                        (content, scope, scope_value, priority, now, existing[0])
                    )
                    updated += 1
                else:
                    # 插入
                    rule_id = str(uuid.uuid4())
                    cursor.execute(
                        """INSERT INTO rules (id, workspace_id, name, scope, scope_value, project_id,
                           content, priority, enabled, source, created_at, updated_at)
                           VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 1, 'imported', ?, ?)""",
                        (rule_id, WORKSPACE_ID, name, scope, scope_value, content, priority, now, now)
                    )
                    imported += 1

    if not dry_run:
        conn.commit()

    conn.close()

    print(f"\n=== ECC Rules 导入报告 ===")
    print(f"规则目录: {rules_dir}")
    print(f"数据库: {DB_PATH}")
    print(f"新增: {imported} 条")
    print(f"更新: {updated} 条")
    print(f"跳过: {skipped} 条")
    print(f"总计: {imported + updated + skipped} 条")
    if dry_run:
        print(f"\n[DRY RUN] 未实际写入数据库")


if __name__ == "__main__":
    dry_run = "--dry-run" in sys.argv
    import_rules(dry_run=dry_run)
