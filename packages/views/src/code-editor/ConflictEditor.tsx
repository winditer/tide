"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { Check } from "lucide-react";

const MonacoDiffEditor = dynamic(
  () => import("@monaco-editor/react").then((m) => m.DiffEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center bg-zinc-900 font-mono text-xs text-zinc-500">
        Loading diff editor...
      </div>
    ),
  },
);

const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((m) => m.default),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center bg-zinc-900 font-mono text-xs text-zinc-500">
        Loading editor...
      </div>
    ),
  },
);

interface ConflictEditorProps {
  base: string;
  ours: string;
  theirs: string;
  language?: string;
  onResolve: (content: string) => void;
}

export function ConflictEditor({
  base,
  ours,
  theirs,
  language = "plaintext",
  onResolve,
}: ConflictEditorProps) {
  // Initialize resolved content with ours as starting point
  const [resolvedContent, setResolvedContent] = useState(ours);
  const [activeSource, setActiveSource] = useState<"ours" | "theirs">("ours");

  const handleResolve = useCallback(() => {
    onResolve(resolvedContent);
  }, [resolvedContent, onResolve]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-700/50 bg-zinc-900/80 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
            Conflict Resolution
          </span>
          <div className="flex items-center gap-1 rounded bg-zinc-800 p-0.5">
            <button
              onClick={() => setActiveSource("ours")}
              className={[
                "rounded px-2 py-0.5 text-xs transition-colors",
                activeSource === "ours"
                  ? "bg-blue-600 text-white"
                  : "text-zinc-400 hover:text-zinc-200",
              ].join(" ")}
            >
              Ours vs Theirs
            </button>
            <button
              onClick={() => setActiveSource("theirs")}
              className={[
                "rounded px-2 py-0.5 text-xs transition-colors",
                activeSource === "theirs"
                  ? "bg-blue-600 text-white"
                  : "text-zinc-400 hover:text-zinc-200",
              ].join(" ")}
            >
              Base vs Theirs
            </button>
          </div>
        </div>
        <button
          onClick={handleResolve}
          className="flex items-center gap-1 rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 transition-colors"
        >
          <Check className="h-3.5 w-3.5" />
          Apply Resolution
        </button>
      </div>

      {/* Diff view (top half) */}
      <div className="h-[45%] border-b border-zinc-700/50">
        <MonacoDiffEditor
          height="100%"
          original={activeSource === "ours" ? ours : base}
          modified={theirs}
          language={language}
          theme="vs-dark"
          options={{
            readOnly: true,
            renderSideBySide: true,
            minimap: { enabled: false },
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 12,
            scrollBeyondLastLine: false,
            automaticLayout: true,
          }}
        />
      </div>

      {/* Resolution editor (bottom half) */}
      <div className="flex flex-1 min-h-0 flex-col">
        <div className="flex items-center border-b border-zinc-700/50 bg-zinc-900/60 px-3 py-1">
          <span className="text-xs text-zinc-500">
            Resolved content (edit below)
          </span>
        </div>
        <div className="flex-1 min-h-0">
          <MonacoEditor
            height="100%"
            language={language}
            value={resolvedContent}
            theme="vs-dark"
            onChange={(value) => setResolvedContent(value ?? "")}
            options={{
              minimap: { enabled: false },
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 12,
              scrollBeyondLastLine: false,
              tabSize: 2,
              wordWrap: "on",
              automaticLayout: true,
            }}
          />
        </div>
      </div>
    </div>
  );
}
