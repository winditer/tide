"""Token 成本计算与统计服务。

提供：
- 模型定价表 ``MODEL_PRICING``
- 单次成本计算 ``calculate_cost``
- 任务成本写入 ``update_task_cost``
- 工作空间维度成本汇总 / 多维度统计
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import text

from backend.db.engine import async_session_factory

logger = logging.getLogger("tide.cost")


# ── 定价表（USD per 1k tokens） ──────────────────────────────────
# (input_per_1k_tokens, output_per_1k_tokens)
MODEL_PRICING: dict[str, tuple[float, float]] = {
    "gpt-4o": (0.0025, 0.01),
    "gpt-4o-mini": (0.00015, 0.0006),
    "gpt-5": (0.00125, 0.01),
    "o3": (0.01, 0.04),
    "o3-mini": (0.001, 0.004),
    "o4-mini": (0.0011, 0.0044),
    "claude-sonnet": (0.003, 0.015),
    "claude-opus": (0.015, 0.075),
    "claude-haiku": (0.00025, 0.00125),
    # Claude 4 系列精确型号（路由到同系列价格）
    "claude-sonnet-4-20250514": (0.003, 0.015),
    "claude-opus-4-20250514": (0.015, 0.075),
    "codex-mini": (0.0015, 0.006),
    # Qoder CLI 默认按 sonnet 级别定价（底层模型为 Claude Sonnet）
    "qoder": (0.003, 0.015),
}

_DEFAULT_PRICING: tuple[float, float] = (0.0, 0.0)
_VALID_PERIODS = {"today", "week", "month"}
_VALID_DIMENSIONS = {"agent", "model", "project"}


def _resolve_pricing(model: str) -> tuple[float, float]:
    """根据模型名匹配定价；优先精确匹配，其次按关键词模糊匹配。"""
    if not model:
        return _DEFAULT_PRICING
    key = str(model).strip().lower()
    if key in MODEL_PRICING:
        return MODEL_PRICING[key]
    # 模糊匹配：检测关键词 “sonnet/opus/haiku/gpt-4o/o3/codex-mini” 是否出现
    # 例如 “claude-3-5-sonnet-20241022” → “claude-sonnet”
    keyword_map = {
        "sonnet": "claude-sonnet",
        "opus": "claude-opus",
        "haiku": "claude-haiku",
        "gpt-4o-mini": "gpt-4o-mini",
        "gpt-4o": "gpt-4o",
        "gpt-5": "gpt-5",
        "o4-mini": "o4-mini",
        "o3-mini": "o3-mini",
        "o3": "o3",
        "codex-mini": "codex-mini",
        "codex": "codex-mini",
        "qoder": "qoder",
        "claude": "claude-sonnet",
    }
    for kw, target in keyword_map.items():
        if kw in key:
            return MODEL_PRICING.get(target, _DEFAULT_PRICING)
    return _DEFAULT_PRICING


class CostService:
    """成本服务（单例使用 ``cost_service``）。"""

    # ------------------------------------------------------------------ calc

    def calculate_cost(self, model: str, input_tokens: int, output_tokens: int) -> float:
        """根据模型与 token 数计算单次成本（USD）。

        未匹配到模型或入参非法时返回 0。
        """
        try:
            in_tokens = max(0, int(input_tokens or 0))
            out_tokens = max(0, int(output_tokens or 0))
        except (TypeError, ValueError):
            return 0.0
        in_price, out_price = _resolve_pricing(model)
        if in_price == 0 and out_price == 0:
            return 0.0
        cost = (in_tokens / 1000.0) * in_price + (out_tokens / 1000.0) * out_price
        return round(cost, 6)

    # --------------------------------------------------------------- mutate

    async def update_task_cost(
        self,
        task_id: str,
        input_tokens: int,
        output_tokens: int,
        model: str,
        reported_cost_usd: Optional[float] = None,
    ) -> Optional[float]:
        """累加任务的 token 计数与估算成本至 DB。

        已有计数会被叠加（同一任务多次调用 = 多轮 token 累加）。
        当 ``reported_cost_usd`` 非 None 时，使用 CLI 上报的精确成本代替计算值。
        失败时记录警告并返回 None，不抛异常。
        """
        if not task_id:
            return None
        try:
            in_tokens = max(0, int(input_tokens or 0))
            out_tokens = max(0, int(output_tokens or 0))
        except (TypeError, ValueError):
            return None
        if in_tokens == 0 and out_tokens == 0 and not reported_cost_usd:
            return None
        cost = (
            round(float(reported_cost_usd), 6)
            if reported_cost_usd and reported_cost_usd > 0
            else self.calculate_cost(model, in_tokens, out_tokens)
        )
        try:
            async with async_session_factory() as session:
                # 构建动态 SET 子句：始终更新 token 和 cost，仅当 model 非空时同时更新 model
                sql = (
                    "UPDATE tasks SET"
                    " token_input = COALESCE(token_input, 0) + :ti,"
                    " token_output = COALESCE(token_output, 0) + :to_,"
                    " estimated_cost_usd = COALESCE(estimated_cost_usd, 0) + :cost"
                )
                params: dict = {
                    "ti": in_tokens,
                    "to_": out_tokens,
                    "cost": cost,
                    "tid": task_id,
                }
                if model:
                    sql += ", model = :model"
                    params["model"] = model
                sql += " WHERE id = :tid"
                await session.execute(text(sql), params)
                await session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "update_task_cost failed task=%s model=%s: %s",
                task_id, model, exc,
            )
            return None
        return cost

    # --------------------------------------------------------------- query

    @staticmethod
    def _period_start_iso(period: str) -> Optional[str]:
        """根据 period 返回起点字符串（None 表示无下界）。

        使用 ``YYYY-MM-DD HH:MM:SS`` 格式以兼容 SQLite ``CURRENT_TIMESTAMP``
        写入的时间字符串（带空格分隔）。
        """
        now = datetime.now(timezone.utc)
        if period == "today":
            start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        elif period == "week":
            start = (now - timedelta(days=now.weekday())).replace(
                hour=0, minute=0, second=0, microsecond=0
            )
        elif period == "month":
            start = now.replace(
                day=1, hour=0, minute=0, second=0, microsecond=0
            )
        else:
            return None
        return start.strftime("%Y-%m-%d %H:%M:%S")

    async def get_cost_summary(
        self,
        workspace_id: str,
        period: str = "today",
    ) -> dict:
        """返回 workspace 在 period 内的成本汇总。

        返回字段：``period / total_cost_usd / total_input_tokens /
        total_output_tokens / task_count``。
        """
        if period not in _VALID_PERIODS:
            period = "today"
        start_iso = self._period_start_iso(period)
        params: dict = {"ws": workspace_id}
        time_clause = ""
        if start_iso:
            time_clause = " AND COALESCE(completed_at, started_at, created_at) >= :start"
            params["start"] = start_iso
        try:
            async with async_session_factory() as session:
                r = await session.execute(
                    text(
                        "SELECT"
                        " COALESCE(SUM(estimated_cost_usd), 0),"
                        " COALESCE(SUM(token_input), 0),"
                        " COALESCE(SUM(token_output), 0),"
                        " COUNT(*)"
                        " FROM tasks"
                        " WHERE workspace_id = :ws"
                        f"{time_clause}"
                    ),
                    params,
                )
                row = r.fetchone()
        except Exception as exc:  # noqa: BLE001
            logger.warning("get_cost_summary failed: %s", exc)
            return {
                "period": period,
                "total_cost_usd": 0.0,
                "total_input_tokens": 0,
                "total_output_tokens": 0,
                "task_count": 0,
            }
        total_cost = float(row[0] or 0) if row else 0.0
        return {
            "period": period,
            "total_cost_usd": round(total_cost, 6),
            "total_input_tokens": int(row[1] or 0) if row else 0,
            "total_output_tokens": int(row[2] or 0) if row else 0,
            "task_count": int(row[3] or 0) if row else 0,
        }

    async def get_cost_by_dimension(
        self,
        workspace_id: str,
        dimension: str,
        period: str = "today",
    ) -> list[dict]:
        """按维度（agent / model / project）聚合成本。

        每条返回 ``key / total_cost_usd / total_input_tokens /
        total_output_tokens / task_count``。
        """
        if dimension not in _VALID_DIMENSIONS:
            return []
        if period not in _VALID_PERIODS:
            period = "today"

        column_map = {
            "agent": "agent_id",
            "model": "model",
            "project": "cwd",
        }
        column = column_map[dimension]

        start_iso = self._period_start_iso(period)
        params: dict = {"ws": workspace_id}
        time_clause = ""
        if start_iso:
            time_clause = " AND COALESCE(completed_at, started_at, created_at) >= :start"
            params["start"] = start_iso

        try:
            async with async_session_factory() as session:
                r = await session.execute(
                    text(
                        f"SELECT {column} AS k,"
                        " COALESCE(SUM(estimated_cost_usd), 0) AS cost,"
                        " COALESCE(SUM(token_input), 0) AS ti,"
                        " COALESCE(SUM(token_output), 0) AS to_,"
                        " COUNT(*) AS cnt"
                        " FROM tasks"
                        " WHERE workspace_id = :ws"
                        f"{time_clause}"
                        f" GROUP BY {column}"
                        " ORDER BY cost DESC"
                    ),
                    params,
                )
                rows = r.fetchall()
        except Exception as exc:  # noqa: BLE001
            logger.warning("get_cost_by_dimension failed: %s", exc)
            return []

        results: list[dict] = []
        for row in rows:
            key = row[0] or ""
            results.append(
                {
                    "key": key,
                    "total_cost_usd": round(float(row[1] or 0), 6),
                    "total_input_tokens": int(row[2] or 0),
                    "total_output_tokens": int(row[3] or 0),
                    "task_count": int(row[4] or 0),
                }
            )
        return results


cost_service = CostService()
