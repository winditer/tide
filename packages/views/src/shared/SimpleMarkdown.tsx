"use client";

import type { ReactNode } from "react";

/* ------------------------------------------------------------------ */
/* Lightweight, zero-dependency markdown renderer                      */
/*                                                                     */
/* Supports: h1-h4, paragraphs, bold, inline code, links,              */
/*           fenced code blocks, ordered/unordered lists,              */
/*           blockquotes, horizontal rules, simple tables.             */
/* ------------------------------------------------------------------ */

export type MarkdownBlock =
  | { kind: "h1" | "h2" | "h3" | "h4"; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "code"; lang: string; content: string }
  | { kind: "quote"; text: string }
  | { kind: "hr" }
  | { kind: "table"; headers: string[]; rows: string[][] };

export type MarkdownVariant = "default" | "compact";

export function parseMarkdown(src: string): MarkdownBlock[] {
  const lines = src.split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code fence
    if (/^```/.test(line)) {
      const lang = line.replace(/^```/, "").trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing fence
      blocks.push({ kind: "code", lang, content: buf.join("\n") });
      continue;
    }

    // Horizontal rule
    if (/^---\s*$/.test(line)) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }

    // Heading
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length as 1 | 2 | 3 | 4;
      const kind = (`h${level}` as "h1" | "h2" | "h3" | "h4");
      blocks.push({ kind, text: heading[2].trim() });
      i++;
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ kind: "quote", text: buf.join(" ") });
      continue;
    }

    // Table
    if (
      /^\|.*\|\s*$/.test(line) &&
      i + 1 < lines.length &&
      /^\|[\s|:-]+\|\s*$/.test(lines[i + 1])
    ) {
      const headers = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ kind: "table", headers, rows });
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) {
          items[items.length - 1] += " " + lines[i].trim();
          i++;
        }
      }
      blocks.push({ kind: "ol", items });
      continue;
    }

    // Unordered list
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) {
          items[items.length - 1] += " " + lines[i].trim();
          i++;
        }
      }
      blocks.push({ kind: "ul", items });
      continue;
    }

    // Blank line
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // Paragraph
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^#{1,4}\s+/.test(lines[i]) &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^---\s*$/.test(lines[i]) &&
      !/^\|.*\|\s*$/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ kind: "p", text: buf.join(" ") });
  }

  return blocks;
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}

/**
 * Render inline markdown: `code`, **bold**, [links](url).
 * Order of matching: code > bold > link.
 */
export function renderInline(
  text: string,
  keyBase: string,
  variant: MarkdownVariant = "default"
): ReactNode[] {
  const out: ReactNode[] = [];
  // code | bold | link
  const regex = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let idx = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      out.push(text.slice(last, match.index));
    }
    const token = match[0];
    if (token.startsWith("`")) {
      const codeCls =
        variant === "compact"
          ? "rounded bg-zinc-100 border border-zinc-200 px-1 py-0.5 font-mono text-[0.85em] text-rose-600/80"
          : "rounded border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 font-mono text-[0.85em] text-zinc-800";
      out.push(
        <code key={`${keyBase}-c-${idx}`} className={codeCls}>
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("**")) {
      out.push(
        <strong key={`${keyBase}-b-${idx}`} className={variant === "compact" ? "font-semibold text-zinc-800" : "font-bold text-zinc-900"}>
          {token.slice(2, -2)}
        </strong>
      );
    } else {
      // link [text](url)
      const m = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (m) {
        out.push(
          <a
            key={`${keyBase}-l-${idx}`}
            href={m[2]}
            target="_blank"
            rel="noreferrer noopener"
            className={
              variant === "compact"
                ? "text-blue-600 underline decoration-blue-300 decoration-1 underline-offset-2 hover:text-blue-800 hover:decoration-blue-500 transition-colors"
                : "text-blue-700 underline decoration-zinc-400 underline-offset-2 hover:text-blue-900"
            }
          >
            {m[1]}
          </a>
        );
      } else {
        out.push(token);
      }
    }
    last = match.index + token.length;
    idx++;
  }
  if (last < text.length) {
    out.push(text.slice(last));
  }
  return out;
}

interface BlockClasses {
  h1: string;
  h2: string;
  h3: string;
  h4: string;
  p: string;
  ul: string;
  ol: string;
  li: string;
  quote: string;
  hr: string;
  pre: string;
}

const DEFAULT_CLASSES: BlockClasses = {
  h1: "mt-2 mb-4 border-b-2 border-zinc-900 pb-2 text-3xl font-black tracking-tight text-zinc-900",
  h2: "mt-8 mb-3 text-2xl font-extrabold tracking-tight text-zinc-900",
  h3: "mt-6 mb-2 text-xl font-bold text-zinc-900",
  h4: "mt-5 mb-2 text-lg font-bold text-zinc-900",
  p: "my-3 leading-7 text-zinc-700",
  ul: "my-3 ml-5 list-disc space-y-1 text-zinc-700 marker:text-zinc-900",
  ol: "my-3 ml-5 list-decimal space-y-1 text-zinc-700 marker:text-zinc-900",
  li: "leading-7",
  quote:
    "my-4 border-l-4 border-zinc-900 bg-amber-50 px-4 py-3 text-zinc-800",
  hr: "my-6 border-t-2 border-dashed border-zinc-300",
  pre: "my-4 overflow-x-auto rounded-none border-2 border-zinc-900 bg-zinc-900 p-4 text-[0.85em] leading-6 text-zinc-100 shadow-[4px_4px_0_0_rgba(24,24,27,1)]",
};

const COMPACT_CLASSES: BlockClasses = {
  h1: "mt-1 mb-2 text-base font-bold text-zinc-900 tracking-tight",
  h2: "mt-5 mb-2 text-[15px] font-semibold text-zinc-800 border-b border-zinc-200 pb-1.5",
  h3: "mt-4 mb-1.5 text-sm font-semibold text-zinc-700",
  h4: "mt-3 mb-1 text-[13px] font-semibold text-zinc-600",
  p: "my-2 text-[13px] leading-[1.75] text-zinc-600",
  ul: "my-2 ml-5 list-disc space-y-1 text-[13px] text-zinc-700 marker:text-zinc-400",
  ol: "my-2 ml-5 list-decimal space-y-1 text-[13px] text-zinc-700 marker:text-zinc-500",
  li: "leading-[1.75]",
  quote:
    "my-3 border-l-[3px] border-blue-300 bg-blue-50/60 rounded-r px-3 py-2 text-[13px] leading-relaxed text-zinc-600 italic",
  hr: "my-4 border-t border-zinc-200",
  pre: "my-2.5 max-w-full overflow-x-auto rounded-lg bg-zinc-800 px-3 py-2.5 text-xs leading-5 text-zinc-100 font-mono",
};

export function renderBlocks(
  blocks: MarkdownBlock[],
  variant: MarkdownVariant = "default"
): ReactNode[] {
  const cls = variant === "compact" ? COMPACT_CLASSES : DEFAULT_CLASSES;
  return blocks.map((b, idx) => {
    const key = `b-${idx}`;
    switch (b.kind) {
      case "h1":
        return (
          <h1 key={key} className={cls.h1}>
            {renderInline(b.text, key, variant)}
          </h1>
        );
      case "h2":
        return (
          <h2 key={key} className={cls.h2}>
            {renderInline(b.text, key, variant)}
          </h2>
        );
      case "h3":
        return (
          <h3 key={key} className={cls.h3}>
            {renderInline(b.text, key, variant)}
          </h3>
        );
      case "h4":
        return (
          <h4 key={key} className={cls.h4}>
            {renderInline(b.text, key, variant)}
          </h4>
        );
      case "p":
        return (
          <p key={key} className={cls.p}>
            {renderInline(b.text, key, variant)}
          </p>
        );
      case "ul":
        return (
          <ul key={key} className={cls.ul}>
            {b.items.map((it, j) => (
              <li key={`${key}-i-${j}`} className={cls.li}>
                {renderInline(it, `${key}-i-${j}`, variant)}
              </li>
            ))}
          </ul>
        );
      case "ol":
        return (
          <ol key={key} className={cls.ol}>
            {b.items.map((it, j) => (
              <li key={`${key}-i-${j}`} className={cls.li}>
                {renderInline(it, `${key}-i-${j}`, variant)}
              </li>
            ))}
          </ol>
        );
      case "quote":
        return (
          <blockquote key={key} className={cls.quote}>
            {renderInline(b.text, key, variant)}
          </blockquote>
        );
      case "hr":
        return <hr key={key} className={cls.hr} />;
      case "code":
        return (
          <pre key={key} className={cls.pre}>
            <code className="font-mono">{b.content}</code>
          </pre>
        );
      case "table":
        return (
          <div
            key={key}
            className={
              variant === "compact"
                ? "my-3 overflow-x-auto rounded-lg border border-zinc-200 shadow-sm"
                : "my-4 overflow-x-auto border-2 border-zinc-900 shadow-[4px_4px_0_0_rgba(24,24,27,1)]"
            }
          >
            <table
              className={
                variant === "compact"
                  ? "min-w-full border-collapse text-[13px]"
                  : "w-full border-collapse text-sm"
              }
            >
              <thead className={variant === "compact" ? "bg-zinc-50 border-b border-zinc-200" : "bg-zinc-900 text-zinc-50"}>
                <tr>
                  {b.headers.map((h, j) => (
                    <th
                      key={`${key}-h-${j}`}
                      className={
                        variant === "compact"
                          ? "whitespace-nowrap px-3 py-1.5 text-left font-semibold text-zinc-700"
                          : "px-3 py-2 text-left font-bold"
                      }
                    >
                      {renderInline(h, `${key}-h-${j}`, variant)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, ri) => (
                  <tr
                    key={`${key}-r-${ri}`}
                    className={
                      variant === "compact"
                        ? "border-t border-zinc-100 odd:bg-white even:bg-zinc-50/50 hover:bg-zinc-100/60 transition-colors"
                        : "border-t border-zinc-300 odd:bg-white even:bg-zinc-50"
                    }
                  >
                    {row.map((cell, ci) => (
                      <td
                        key={`${key}-r-${ri}-c-${ci}`}
                        className={
                          variant === "compact"
                            ? "px-3 py-1.5 align-top text-zinc-600 [&>code]:whitespace-nowrap"
                            : "px-3 py-2 align-top text-zinc-700"
                        }
                      >
                        {renderInline(cell, `${key}-r-${ri}-c-${ci}`, variant)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      default:
        return null;
    }
  });
}

interface SimpleMarkdownProps {
  source: string;
  variant?: MarkdownVariant;
  className?: string;
}

export function SimpleMarkdown({
  source,
  variant = "default",
  className,
}: SimpleMarkdownProps) {
  const blocks = parseMarkdown(source);
  return <div className={className}>{renderBlocks(blocks, variant)}</div>;
}
