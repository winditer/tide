"use client";

import { Sparkles } from "lucide-react";
import { useOptimizeDescription } from "@tide/core";

interface AIOptimizeButtonProps {
  description: string;
  onOptimized: (text: string) => void;
  agentId?: string;
  disabled?: boolean;
  compact?: boolean;
}

export function AIOptimizeButton({
  description,
  onOptimized,
  agentId,
  disabled,
  compact,
}: AIOptimizeButtonProps) {
  const mutation = useOptimizeDescription();

  const handleClick = async () => {
    try {
      const result = await mutation.mutateAsync({
        description,
        agent_id: agentId,
      });
      onOptimized(result.optimized);
    } catch (error) {
      console.error("AI 优化失败:", error);
    }
  };

  const isLoading = mutation.isPending;
  const isDisabled = disabled || isLoading || !description.trim();

  if (compact) {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={isDisabled}
        title="AI 优化"
        className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground transition-all hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Sparkles className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isDisabled}
      className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-all hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Sparkles className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
      {isLoading ? "优化中…" : "AI 优化"}
    </button>
  );
}
