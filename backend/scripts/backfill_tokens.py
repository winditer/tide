"""回填历史任务的 token 估算数据。

对数据库中所有 token_input=0 但有 prompt/result 内容的历史任务，
使用 tiktoken 估算 token 消耗并回填 token_input / token_output / estimated_cost_usd。

幂等：多次运行不会重复计算（仅处理 token_input=0 的记录）。
"""

import asyncio
import sqlite3
import sys
from pathlib import Path

# 确保可以导入 backend 模块
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from backend.runtime.adapters import estimate_token_count
from backend.services.cost_service import cost_service


# agent_id → 默认模型名映射
AGENT_MODEL_MAP = {
    "codex": "codex-mini",
    "qoder": "qoder",
    "claude": "claude-sonnet",
}

# 数据库路径（与项目根目录的 tide.db 一致）
DB_PATH = Path(__file__).resolve().parent.parent.parent / "tide.db"


def infer_model(model: str | None, agent_id: str | None) -> str:
    """推断模型名称：优先使用已有 model，否则按 agent_id 推断。"""
    if model and model.strip():
        return model.strip()
    aid = (agent_id or "").strip().lower()
    return AGENT_MODEL_MAP.get(aid, "qoder")


def main():
    if not DB_PATH.exists():
        print(f"[ERROR] 数据库文件不存在: {DB_PATH}")
        sys.exit(1)

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row

    # 查询所有 token_input=0 且有 prompt 或 result 内容的任务
    cursor = conn.execute(
        """
        SELECT id, prompt, result, model, agent_id
        FROM tasks
        WHERE (token_input IS NULL OR token_input = 0)
          AND (prompt IS NOT NULL AND prompt != ''
               OR result IS NOT NULL AND result != '')
        """
    )
    rows = cursor.fetchall()
    total = len(rows)

    if total == 0:
        print("[INFO] 没有需要回填的任务记录。")
        conn.close()
        return

    print(f"[INFO] 找到 {total} 条需要回填的任务记录，开始处理...")

    updated = 0
    skipped = 0

    for row in rows:
        task_id = row["id"]
        prompt = row["prompt"] or ""
        result = row["result"] or ""
        model_raw = row["model"]
        agent_id = row["agent_id"]

        # 估算 token
        input_tokens = estimate_token_count(prompt) if prompt else 0
        output_tokens = estimate_token_count(result) if result else 0

        if input_tokens == 0 and output_tokens == 0:
            skipped += 1
            continue

        # 推断模型
        model = infer_model(model_raw, agent_id)

        # 计算成本
        cost = cost_service.calculate_cost(model, input_tokens, output_tokens)

        # 更新数据库
        conn.execute(
            """
            UPDATE tasks
            SET token_input = ?,
                token_output = ?,
                estimated_cost_usd = ?,
                model = COALESCE(NULLIF(model, ''), ?)
            WHERE id = ?
            """,
            (input_tokens, output_tokens, cost, model, task_id),
        )
        updated += 1

    conn.commit()
    conn.close()

    print(f"[DONE] 处理完成:")
    print(f"  - 总记录数: {total}")
    print(f"  - 已回填:   {updated}")
    print(f"  - 跳过(无内容): {skipped}")


if __name__ == "__main__":
    main()
