"use client";

import { useEffect, useState } from "react";
import { SCHEDULES_GUIDE } from "./schedules-guide";
import { parseMarkdown, renderBlocks } from "../shared/SimpleMarkdown";

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* Markdown rendering is delegated to packages/views/src/shared/       */
/* SimpleMarkdown.                                                     */
/* ------------------------------------------------------------------ */

export function ScheduleGuide() {
  const [open, setOpen] = useState(false);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    // Lock body scroll while modal is open
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = original;
    };
  }, [open]);

  const blocks = parseMarkdown(SCHEDULES_GUIDE);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="使用指南"
        aria-label="使用指南"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-300 bg-transparent text-sm font-semibold text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
      >
        <span aria-hidden="true" className="leading-none">?</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/60 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="定时调度使用指南"
        >
          <div
            className="relative flex max-h-[80vh] w-full max-w-2xl flex-col border-2 border-zinc-900 bg-white shadow-[8px_8px_0_0_rgba(24,24,27,1)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b-2 border-zinc-900 bg-zinc-50 px-5 py-3">
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className="text-lg">📖</span>
                <h2 className="text-base font-extrabold tracking-tight text-zinc-900">
                  定时调度使用指南
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="关闭"
                className="inline-flex h-8 w-8 items-center justify-center border-2 border-zinc-900 bg-white text-base font-bold text-zinc-900 shadow-[2px_2px_0_0_rgba(24,24,27,1)] transition-all hover:bg-rose-200 hover:shadow-[3px_3px_0_0_rgba(24,24,27,1)] active:shadow-[1px_1px_0_0_rgba(24,24,27,1)]"
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <article className="text-[0.95rem]">{renderBlocks(blocks)}</article>
            </div>

            {/* Footer */}
            <div className="border-t-2 border-zinc-900 bg-zinc-50 px-5 py-2.5 text-right">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-8 items-center border-2 border-zinc-900 bg-white px-3 text-sm font-bold text-zinc-900 shadow-[2px_2px_0_0_rgba(24,24,27,1)] transition-all hover:bg-zinc-900 hover:text-white active:shadow-[1px_1px_0_0_rgba(24,24,27,1)]"
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
