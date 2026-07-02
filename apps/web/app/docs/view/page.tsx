"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiClient, ApiError, appPath } from "@tide/core";

// ── State machine ────────────────────────────────────────────────────────
type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; content: string }
  | { kind: "error"; message: string };

type DocKind = "markdown" | "json" | "code" | "image" | "text";

const CODE_EXTENSIONS = new Set([
  "js",
  "jsx",
  "ts",
  "tsx",
  "py",
  "yaml",
  "yml",
  "toml",
  "sh",
  "bash",
  "zsh",
  "sql",
  "css",
  "scss",
  "html",
  "xml",
  "java",
  "go",
  "rs",
  "rb",
  "php",
  "c",
  "cpp",
  "h",
  "hpp",
  "kt",
  "swift",
]);
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "bmp",
]);
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);
const JSON_EXTENSIONS = new Set(["json"]);

function detectExtension(...candidates: string[]): string {
  for (const c of candidates) {
    const m = c?.match(/\.([a-z0-9]+)(?:[?#].*)?$/i);
    if (m) return m[1].toLowerCase();
  }
  return "";
}

function detectKind(ext: string): DocKind {
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (MARKDOWN_EXTENSIONS.has(ext) || ext === "") return "markdown";
  if (JSON_EXTENSIONS.has(ext)) return "json";
  if (CODE_EXTENSIONS.has(ext)) return "code";
  return "text";
}

function MarkdownViewer() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const url = searchParams.get("url") || "";
  const title = searchParams.get("title") || "未命名文档";

  const ext = useMemo(() => detectExtension(title, url), [title, url]);
  const kind = useMemo<DocKind>(() => detectKind(ext), [ext]);

  const [state, setState] = useState<LoadState>({ kind: "idle" });

  useEffect(() => {
    if (!url) {
      setState({
        kind: "error",
        message: "缺少 url 参数，无法加载文档内容。",
      });
      return;
    }
    const isExternal = /^https?:\/\//i.test(url);
    const isInternal = url.startsWith("/api/");
    if (!isExternal && !isInternal) {
      setState({
        kind: "error",
        message: "非法的文档地址。仅允许加载 /api/ 下的产物或 http(s) 外链。",
      });
      return;
    }

    // Images are rendered directly via <img>; no fetch required.
    if (kind === "image") {
      setState({ kind: "ready", content: "" });
      return;
    }

    // External non-image links: do not auto-fetch — surface a CTA instead.
    if (isExternal) {
      setState({ kind: "ready", content: "" });
      return;
    }

    let cancelled = false;
    setState({ kind: "loading" });

    apiClient
      .get<string>(url)
      .then((raw) => {
        if (cancelled) return;
        let text =
          typeof raw === "string"
            ? raw
            : (raw as unknown) == null
              ? ""
              : JSON.stringify(raw, null, 2);
        if (kind === "json" && typeof raw === "string") {
          // Pretty-print JSON when it loaded as raw text.
          try {
            text = JSON.stringify(JSON.parse(raw), null, 2);
          } catch {
            // keep raw on parse failure
          }
        }
        setState({ kind: "ready", content: text });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        let msg = "加载文档失败，请稍后重试。";
        if (err instanceof ApiError) {
          msg = `加载失败：${err.status} ${err.statusText || ""}`.trim();
        } else if (err instanceof Error && err.message) {
          msg = err.message;
        }
        setState({ kind: "error", message: msg });
      });

    return () => {
      cancelled = true;
    };
  }, [url, kind]);

  const meta = useMemo(() => {
    const extLabel = (ext || "md").toUpperCase();
    let size = "—";
    if (state.kind === "ready" && state.content) {
      const bytes = new Blob([state.content]).size;
      size =
        bytes < 1024
          ? `${bytes} B`
          : bytes < 1024 * 1024
            ? `${(bytes / 1024).toFixed(1)} KB`
            : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }
    return { ext: extLabel, size };
  }, [ext, state]);

  const handleCopy = async () => {
    if (state.kind !== "ready" || !state.content) return;
    try {
      await navigator.clipboard.writeText(state.content);
    } catch {
      /* no-op: clipboard may be blocked in iframes */
    }
  };

  const handleDownload = () => {
    if (state.kind !== "ready" || !state.content) return;
    const blob = new Blob([state.content], {
      type: "text/plain;charset=utf-8",
    });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    const fallbackExt = ext || "md";
    a.download = title.match(/\.[a-z0-9]+$/i)
      ? title
      : `${title}.${fallbackExt}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(href);
  };

  const handleOpenNewTab = () => {
    if (!url) return;
    window.open(appPath(url), "_blank", "noopener,noreferrer");
  };

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  };

  const isExternalUrl = /^https?:\/\//i.test(url);
  const canCopy =
    state.kind === "ready" && !!state.content && kind !== "image";
  const canDownload = canCopy;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <button
              onClick={handleBack}
              className="text-gray-500 hover:text-gray-900 transition-colors"
            >
              ← 返回
            </button>
            <span>·</span>
            <span>{meta.ext}</span>
            <span>·</span>
            <span>{meta.size}</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900 truncate">
            {title}
          </h1>
          {url && (
            <p className="text-xs text-gray-500 break-all">{url}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleOpenNewTab}
            disabled={!url}
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            在新标签页打开
          </button>
          <button
            onClick={handleCopy}
            disabled={!canCopy}
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            复制源码
          </button>
          <button
            onClick={handleDownload}
            disabled={!canDownload}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            下载
          </button>
        </div>
      </header>

      <section className="rounded-lg border border-gray-200 bg-white shadow-card">
        <div className="px-6 py-6 lg:px-8 lg:py-8">
          {state.kind === "loading" || state.kind === "idle" ? (
            <LoadingSkeleton />
          ) : state.kind === "error" ? (
            <ErrorPanel message={state.message} />
          ) : kind === "image" ? (
            <ImagePreview url={url} alt={title} />
          ) : isExternalUrl ? (
            <ExternalLinkPanel url={url} onOpen={handleOpenNewTab} />
          ) : kind === "markdown" ? (
            <article className="doc-prose">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {state.content}
              </ReactMarkdown>
            </article>
          ) : (
            <CodeBlock content={state.content} language={ext} />
          )}
        </div>
      </section>

      <style jsx global>{`
        .doc-prose {
          color: hsl(224 30% 14%);
          font-size: 14px;
          line-height: 1.7;
        }
        .doc-prose > *:first-child { margin-top: 0; }
        .doc-prose > *:last-child { margin-bottom: 0; }
        .doc-prose p {
          margin: 0.9em 0;
        }
        .doc-prose h1, .doc-prose h2, .doc-prose h3, .doc-prose h4,
        .doc-prose h5, .doc-prose h6 {
          font-weight: 600;
          color: hsl(224 71% 6%);
          letter-spacing: -0.01em;
        }
        .doc-prose h1 {
          font-size: 1.5em;
          margin: 1.4em 0 0.6em;
          line-height: 1.3;
        }
        .doc-prose h2 {
          font-size: 1.25em;
          margin: 1.6em 0 0.5em;
          line-height: 1.35;
          padding-bottom: 0.3em;
          border-bottom: 1px solid hsl(220 13% 91%);
        }
        .doc-prose h3 {
          font-size: 1.1em;
          margin: 1.4em 0 0.4em;
          line-height: 1.4;
        }
        .doc-prose h4 {
          font-size: 1em;
          margin: 1.2em 0 0.4em;
          color: hsl(224 30% 25%);
        }
        .doc-prose h5, .doc-prose h6 {
          font-size: 1em;
          margin: 1em 0 0.3em;
          color: hsl(224 30% 35%);
        }
        .doc-prose a {
          color: hsl(238 76% 55%);
          text-decoration: underline;
          text-underline-offset: 2px;
          text-decoration-color: hsl(238 76% 55% / 0.4);
          transition: text-decoration-color 0.2s ease;
        }
        .doc-prose a:hover {
          text-decoration-color: hsl(238 76% 55%);
        }
        .doc-prose strong {
          font-weight: 600;
          color: hsl(224 71% 4%);
        }
        .doc-prose em {
          font-style: italic;
        }
        .doc-prose ul, .doc-prose ol {
          margin: 0.9em 0;
          padding-left: 1.4em;
        }
        .doc-prose ul li {
          list-style: disc;
          margin: 0.3em 0;
        }
        .doc-prose ol li {
          list-style: decimal;
          margin: 0.3em 0;
        }
        .doc-prose blockquote {
          margin: 1em 0;
          padding: 0.2em 0 0.2em 1em;
          border-left: 3px solid hsl(238 76% 62%);
          color: hsl(224 30% 35%);
          background: hsl(220 14% 98%);
        }
        .doc-prose blockquote p { margin: 0.4em 0; }
        .doc-prose code {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.9em;
          background: hsl(220 14% 96%);
          color: hsl(224 71% 12%);
          padding: 0.12em 0.36em;
          border-radius: 4px;
          border: 1px solid hsl(220 13% 91%);
        }
        .doc-prose pre {
          margin: 1em 0;
          padding: 1em 1.2em;
          background: hsl(224 71% 6%);
          color: hsl(220 14% 92%);
          border-radius: 6px;
          overflow-x: auto;
          font-size: 0.875em;
          line-height: 1.6;
        }
        .doc-prose pre code {
          background: none;
          border: none;
          color: inherit;
          padding: 0;
          font-size: 1em;
        }
        .doc-prose hr {
          border: none;
          margin: 1.6em 0;
          height: 1px;
          background: hsl(220 13% 91%);
        }
        .doc-prose table {
          margin: 1em 0;
          border-collapse: collapse;
          width: 100%;
          font-size: 0.95em;
        }
        .doc-prose th, .doc-prose td {
          padding: 0.55em 0.85em;
          border: 1px solid hsl(220 13% 91%);
          text-align: left;
        }
        .doc-prose th {
          font-weight: 600;
          color: hsl(224 30% 25%);
          background: hsl(220 14% 96%);
        }
        .doc-prose tr:hover td { background: hsl(220 14% 98%); }
        .doc-prose img {
          max-width: 100%;
          border-radius: 6px;
          margin: 1em 0;
          border: 1px solid hsl(220 13% 91%);
        }
        .doc-prose input[type="checkbox"] {
          margin-right: 0.5em;
          accent-color: hsl(238 76% 62%);
        }
      `}</style>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      {[92, 78, 88, 64, 90, 73, 84, 56].map((w, i) => (
        <div
          key={i}
          className="h-3 rounded-full bg-gray-100"
          style={{
            width: `${w}%`,
            animation: `dp ${1.4 + (i % 3) * 0.15}s ease-in-out ${i * 0.06}s infinite alternate`,
          }}
        />
      ))}
      <div className="pt-2 text-xs text-gray-400">加载文档中…</div>
      <style jsx>{`
        @keyframes dp {
          from { opacity: 0.4; }
          to { opacity: 0.9; }
        }
      `}</style>
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-4">
      <p className="text-sm font-medium text-red-700">无法呈现这份文档</p>
      <p className="mt-1 text-sm text-red-600">{message}</p>
    </div>
  );
}

function ImagePreview({ url, alt }: { url: string; alt: string }) {
  const [errored, setErrored] = useState(false);
  if (errored) {
    return (
      <ErrorPanel message="图片加载失败，请检查链接是否有效。" />
    );
  }
  return (
    <div className="flex justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt}
        onError={() => setErrored(true)}
        className="max-h-[80vh] max-w-full rounded-md border border-gray-200 object-contain"
      />
    </div>
  );
}

function ExternalLinkPanel({
  url,
  onOpen,
}: {
  url: string;
  onOpen: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-md border border-gray-200 bg-gray-50 p-4">
      <p className="text-sm text-gray-700">
        外部链接不在当前页面嵌入预览，请点击下方按钮在新标签页打开。
      </p>
      <p className="break-all rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-500">
        {url}
      </p>
      <button
        onClick={onOpen}
        className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white transition-colors hover:bg-gray-800"
      >
        在新标签页打开
      </button>
    </div>
  );
}

function CodeBlock({
  content,
  language,
}: {
  content: string;
  language: string;
}) {
  return (
    <pre className="overflow-x-auto rounded-md border border-gray-200 bg-[hsl(224_71%_6%)] p-4 text-sm leading-relaxed text-gray-100">
      <code className={language ? `language-${language}` : undefined}>
        {content}
      </code>
    </pre>
  );
}

export default function DocViewPage() {
  return (
    <Suspense fallback={null}>
      <MarkdownViewer />
    </Suspense>
  );
}
