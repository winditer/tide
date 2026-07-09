"use client";

import { useEffect, useState } from "react";
import { HelpCircle, X } from "lucide-react";
import { API_TOKENS_GUIDE } from "./api-tokens-guide";
import { parseMarkdown, renderBlocks } from "@tide/views/shared/SimpleMarkdown";

export function ApiTokenGuide() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = original;
    };
  }, [open]);

  const blocks = parseMarkdown(API_TOKENS_GUIDE);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="使用指南"
        aria-label="使用指南"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border/60 bg-background text-muted-foreground transition-smooth hover:bg-muted/50 hover:text-foreground"
      >
        <HelpCircle className="h-[18px] w-[18px]" strokeWidth={2} />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="API Token 使用指南"
        >
          <div
            className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border/50 bg-background shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 border-b border-border/50 px-6 py-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <span aria-hidden="true" className="text-lg leading-none">📖</span>
                <h2 className="truncate text-lg font-semibold tracking-tight text-foreground">
                  API Token 使用指南
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="关闭"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-smooth hover:bg-muted/50 hover:text-foreground"
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              <article className="text-[0.95rem] leading-relaxed text-foreground">
                {renderBlocks(blocks)}
              </article>
            </div>

            <div className="flex justify-end border-t border-border/50 bg-muted/30 px-6 py-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-9 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background transition-smooth hover:bg-foreground/90"
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default ApiTokenGuide;
