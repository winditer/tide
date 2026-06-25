"use client";

import { useState, useEffect, useCallback } from "react";
import { DollarSign, Coins, TrendingUp } from "lucide-react";
import { apiClient } from "@tide/core";

type Period = "today" | "week" | "month";
type Dimension = "agent" | "model" | "project";

interface CostSummary {
  total_cost: number;
  input_tokens: number;
  output_tokens: number;
}

interface DimensionItem {
  name: string;
  cost: number;
  tokens: number;
}

const PERIOD_LABELS: Record<Period, string> = {
  today: "今日",
  week: "本周",
  month: "本月",
};

const DIMENSION_LABELS: Record<Dimension, string> = {
  agent: "Agent",
  model: "Model",
  project: "Project",
};

function formatTokens(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString("en-US");
}

async function fetchCostSummary(period: Period): Promise<CostSummary | null> {
  try {
    return await apiClient.get<CostSummary>(
      `/api/dashboard/cost-summary?workspace_id=default&period=${period}`,
    );
  } catch {
    return null;
  }
}

async function fetchCostByDimension(
  dimension: Dimension,
  period: Period,
): Promise<DimensionItem[]> {
  try {
    const data = await apiClient.get<DimensionItem[]>(
      `/api/dashboard/cost-by-dimension?workspace_id=default&dimension=${dimension}&period=${period}`,
    );
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function CostOverview() {
  const [period, setPeriod] = useState<Period>("today");
  const [dimension, setDimension] = useState<Dimension>("agent");
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [items, setItems] = useState<DimensionItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [s, d] = await Promise.all([
      fetchCostSummary(period),
      fetchCostByDimension(dimension, period),
    ]);
    setSummary(s);
    setItems(d);
    setLoading(false);
  }, [period, dimension]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <section className="space-y-4">
      {/* 标题区 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-emerald-600" />
          <h2 className="text-sm font-semibold tracking-tight text-gray-900">
            成本概览
          </h2>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-gray-200/60 bg-white/80 p-0.5">
          {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                period === p
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="relative overflow-hidden rounded-xl border border-gray-200/60 bg-white/80 p-5 shadow-sm backdrop-blur-sm">
          <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-emerald-500" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1.5">
              <p className="text-xs font-medium text-gray-500">
                {PERIOD_LABELS[period]}成本
              </p>
              <p className="text-2xl font-semibold tracking-tight tabular-nums text-emerald-600">
                {loading ? "—" : summary ? `$${(summary.total_cost ?? 0).toFixed(4)}` : "$0.0000"}
              </p>
            </div>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <DollarSign className="h-4 w-4" />
            </span>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-xl border border-gray-200/60 bg-white/80 p-5 shadow-sm backdrop-blur-sm">
          <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-sky-500" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1.5">
              <p className="text-xs font-medium text-gray-500">输入 Tokens</p>
              <p className="text-2xl font-semibold tracking-tight tabular-nums text-sky-600">
                {loading ? "—" : summary ? formatTokens(summary.input_tokens) : "0"}
              </p>
            </div>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
              <Coins className="h-4 w-4" />
            </span>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-xl border border-gray-200/60 bg-white/80 p-5 shadow-sm backdrop-blur-sm">
          <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-violet-500" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1.5">
              <p className="text-xs font-medium text-gray-500">输出 Tokens</p>
              <p className="text-2xl font-semibold tracking-tight tabular-nums text-violet-600">
                {loading ? "—" : summary ? formatTokens(summary.output_tokens) : "0"}
              </p>
            </div>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
              <TrendingUp className="h-4 w-4" />
            </span>
          </div>
        </div>
      </div>

      {/* 维度列表 */}
      <div className="overflow-hidden rounded-xl border border-gray-200/60 bg-white/80 shadow-sm backdrop-blur-sm">
        <div className="flex items-center gap-2 border-b border-gray-200/60 px-4 py-3">
          <h3 className="text-sm font-medium text-gray-900">成本分布</h3>
          <div className="ml-auto flex items-center gap-1 rounded-lg border border-gray-200/60 bg-gray-50/80 p-0.5">
            {(Object.keys(DIMENSION_LABELS) as Dimension[]).map((d) => (
              <button
                key={d}
                onClick={() => setDimension(d)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  dimension === d
                    ? "bg-white text-indigo-700 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {DIMENSION_LABELS[d]}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-gray-400">加载中...</div>
        ) : items.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-400">暂无成本数据</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {items.map((item, idx) => (
              <div
                key={`${dimension}-${idx}`}
                className="flex items-center justify-between px-4 py-2.5 transition-colors hover:bg-gray-50/60"
              >
                <div className="flex items-center gap-2.5">
                  <span className="flex h-5 w-5 items-center justify-center rounded text-xs font-medium text-gray-400">
                    {idx + 1}
                  </span>
                  <span className="text-sm text-gray-900">{item.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400">
                    {formatTokens(item.tokens)} tokens
                  </span>
                  <span className="text-sm font-medium tabular-nums text-gray-900">
                    ${(item.cost ?? 0).toFixed(4)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
