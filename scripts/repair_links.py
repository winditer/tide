#!/usr/bin/env python3
"""
数据库链接前缀修复脚本
将缺少 /tide 前缀的链接修复为正确格式

Usage:
  python3 repair_links.py /path/to/tide.db
"""

import sqlite3
import json
import sys
from pathlib import Path

def fix_work_items_metadata(db_path):
    """修复 work_items.metadata 中的 artifacts 链接"""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    print("=" * 70)
    print("FIX 1: work_items.metadata (JSON artifacts)")
    print("=" * 70)
    
    cursor.execute("""
        SELECT id, metadata 
        FROM work_items 
        WHERE (metadata LIKE '%/docs/view%' OR metadata LIKE '%/tasks/%')
        AND metadata NOT LIKE '%/tide/docs%' 
        AND metadata NOT LIKE '%/tide/tasks%'
    """)
    
    rows = cursor.fetchall()
    print(f"Found {len(rows)} work_items to fix\n")
    
    fixed_count = 0
    for wi_id, metadata_str in rows:
        try:
            metadata = json.loads(metadata_str)
            artifacts = metadata.get('artifacts', [])
            modified = False
            
            for art in artifacts:
                if isinstance(art, dict) and art.get('url'):
                    url = art['url']
                    if ('/docs/view' in url or '/tasks/' in url) and '/tide/' not in url:
                        # 修复链接
                        new_url = url.replace('/docs/view', '/tide/docs/view')
                        new_url = new_url.replace('/tasks/', '/tide/tasks/')
                        
                        print(f"  [{wi_id}] {url[:60]}")
                        print(f"           → {new_url[:60]}")
                        
                        art['url'] = new_url
                        modified = True
            
            if modified:
                new_metadata_str = json.dumps(metadata, ensure_ascii=False)
                cursor.execute(
                    "UPDATE work_items SET metadata = ? WHERE id = ?",
                    (new_metadata_str, wi_id)
                )
                fixed_count += 1
        except Exception as e:
            print(f"  ERROR fixing {wi_id}: {e}")
    
    conn.commit()
    print(f"\nUpdated {fixed_count} work_items\n")
    conn.close()
    return fixed_count


def fix_tasks_result(db_path):
    """修复 tasks.result 中的链接"""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    print("=" * 70)
    print("FIX 2: tasks.result (embedded links)")
    print("=" * 70)
    
    # First count
    cursor.execute("""
        SELECT COUNT(*) FROM tasks 
        WHERE (result LIKE '%/docs/view%' OR result LIKE '%/tasks/%')
        AND result NOT LIKE '%/tide/docs%' 
        AND result NOT LIKE '%/tide/tasks%'
    """)
    count = cursor.fetchone()[0]
    print(f"Found {count} tasks to fix\n")
    
    # Execute bulk update
    cursor.execute("""
        UPDATE tasks 
        SET result = REPLACE(
            REPLACE(result, '/docs/view', '/tide/docs/view'),
            '/tasks/',
            '/tide/tasks/'
        )
        WHERE (result LIKE '%/docs/view%' OR result LIKE '%/tasks/%')
        AND result NOT LIKE '%/tide/docs%' 
        AND result NOT LIKE '%/tide/tasks%'
    """)
    
    rows_changed = cursor.rowcount
    conn.commit()
    print(f"Updated {rows_changed} tasks\n")
    conn.close()
    return rows_changed


def verify_fixes(db_path):
    """验证修复结果"""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    print("=" * 70)
    print("VERIFICATION")
    print("=" * 70)
    
    # 检查是否还有缺失前缀的链接
    cursor.execute("""
        SELECT COUNT(*) FROM tasks 
        WHERE (result LIKE '%/docs/view%' OR result LIKE '%/tasks/%')
        AND result NOT LIKE '%/tide/docs%' 
        AND result NOT LIKE '%/tide/tasks%'
    """)
    tasks_remaining = cursor.fetchone()[0]
    
    cursor.execute("""
        SELECT COUNT(*) FROM work_items 
        WHERE (metadata LIKE '%/docs/view%' OR metadata LIKE '%/tasks/%')
        AND metadata NOT LIKE '%/tide/docs%' 
        AND metadata NOT LIKE '%/tide/tasks%'
    """)
    wi_remaining = cursor.fetchone()[0]
    
    print(f"Remaining tasks with missing /tide: {tasks_remaining}")
    print(f"Remaining work_items with missing /tide: {wi_remaining}")
    
    if tasks_remaining == 0 and wi_remaining == 0:
        print("\n✓ All links have been successfully fixed!")
    else:
        print("\n✗ Some links still need fixing")
    
    conn.close()


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 repair_links.py /path/to/tide.db")
        sys.exit(1)
    
    db_path = sys.argv[1]
    if not Path(db_path).exists():
        print(f"Error: Database file not found: {db_path}")
        sys.exit(1)
    
    print(f"Database: {db_path}\n")
    
    try:
        wi_count = fix_work_items_metadata(db_path)
        task_count = fix_tasks_result(db_path)
        verify_fixes(db_path)
        
        print("\n" + "=" * 70)
        print(f"SUMMARY: Fixed {wi_count} work_items and {task_count} tasks")
        print("=" * 70)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
