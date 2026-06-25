"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";

const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((m) => m.default),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center font-mono text-xs text-zinc-500">
        Loading editor...
      </div>
    ),
  },
);

interface CodeEditorProps {
  content: string;
  language?: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  path?: string;
  theme?: "light" | "vs-dark";
}

/** Map file extension to Monaco language identifier */
function detectLanguage(path: string | undefined): string {
  if (!path) return "plaintext";
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    jsonc: "json",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    cs: "csharp",
    rb: "ruby",
    swift: "swift",
    kt: "kotlin",
    sql: "sql",
    md: "markdown",
    html: "html",
    htm: "html",
    css: "css",
    scss: "scss",
    less: "less",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
    toml: "ini",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    dockerfile: "dockerfile",
    makefile: "makefile",
    graphql: "graphql",
    gql: "graphql",
    vue: "html",
    svelte: "html",
  };
  return map[ext] ?? "plaintext";
}

export function CodeEditor({
  content,
  language,
  readOnly = false,
  onChange,
  path,
  theme = "vs-dark",
}: CodeEditorProps) {
  const resolvedLanguage = useMemo(
    () => language ?? detectLanguage(path),
    [language, path],
  );

  return (
    <div className="h-full w-full overflow-hidden">
      <MonacoEditor
        height="100%"
        language={resolvedLanguage}
        value={content}
        theme={theme}
        onChange={(value) => onChange?.(value ?? "")}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 13,
          lineHeight: 20,
          scrollBeyondLastLine: false,
          renderWhitespace: "boundary",
          tabSize: 2,
          wordWrap: "on",
          automaticLayout: true,
          padding: { top: 8 },
        }}
      />
    </div>
  );
}
