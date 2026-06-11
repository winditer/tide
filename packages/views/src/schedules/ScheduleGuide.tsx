"use client";

import { useEffect, useState, type ReactNode } from "react";
import { SCHEDULES_GUIDE } from "./schedules-guide";

/* ------------------------------------------------------------------ */
/* Lightweight markdown renderer (no external deps)                    */
/* ------------------------------------------------------------------ */

type Block =
  | { kind: "h1" | "h2" | "h3" | "h4"; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "code"; lang: string; content: string }
  | { kind: "quote"; text: string }
  | { kind: "hr" }
  | { kind: "table"; headers: string[]; rows: string[][] };

function parseMarkdown(src: string): Block[] {
  const lines = src.split("\n");
  const blocks: Block[] = [];
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

    // Table (header | --- | rows)
    if (
      /^\|.*\|\s*$/.test(line) &&
      i + 1 < lines.length &&
      /^\|[\s|:-]+\|\s*$/.test(lines[i + 1])
    ) {
      const headers = splitRow(line);
      i += 2; // skip header & separator
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ kind: "table", headers, rows });
      continue;
    }

    // List
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i++;
        // Continuation lines (indented)
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

    // Paragraph (collect until blank/special)
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^#{1,4}\s+/.test(lines[i]) &&
      !/^[-*]\s+/.test(lines[i]) &&
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

/** Render inline markdown: **bold**, `code`, [links] (kept as text). */
function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Match `code` or **bold**
  const regex = /(`[^`]+`)|(\*\*[^*]+\*\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let idx = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      out.push(text.slice(last, match.index));
    }
    const token = match[0];
    if (token.startsWith("`")) {
      out.push(
        <code
          key={`${keyBase}-c-${idx}`}
          className="rounded border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 font-mono text-[0.85em] text-zinc-800"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else {
      out.push(
        <strong key={`${keyBase}-b-${idx}`} className="font-bold text-zinc-900">
          {token.slice(2, -2)}
        </strong>
      );
    }
    last = match.index + token.length;
    idx++;
  }
  if (last < text.length) {
    out.push(text.slice(last));
  }
  return out;
}

function renderBlocks(blocks: Block[]): ReactNode[] {
  return blocks.map((b, idx) => {
    const key = `b-${idx}`;
    switch (b.kind) {
      case "h1":
        return (
          <h1
            key={key}
            className="mt-2 mb-4 border-b-2 border-zinc-900 pb-2 text-3xl font-black tracking-tight text-zinc-900"
          >
            {renderInline(b.text, key)}
          </h1>
        );
      case "h2":
        return (
          <h2
            key={key}
            className="mt-8 mb-3 text-2xl font-extrabold tracking-tight text-zinc-900"
          >
            {renderInline(b.text, key)}
          </h2>
        );
      case "h3":
        return (
          <h3
            key={key}
            className="mt-6 mb-2 text-xl font-bold text-zinc-900"
          >
            {renderInline(b.text, key)}
          </h3>
        );
      case "h4":
        return (
          <h4 key={key} className="mt-5 mb-2 text-lg font-bold text-zinc-900">
            {renderInline(b.text, key)}
          </h4>
        );
      case "p":
        return (
          <p key={key} className="my-3 leading-7 text-zinc-700">
            {renderInline(b.text, key)}
          </p>
        );
      case "ul":
        return (
          <ul
            key={key}
            className="my-3 ml-5 list-disc space-y-1 text-zinc-700 marker:text-zinc-900"
          >
            {b.items.map((it, j) => (
              <li key={`${key}-i-${j}`} className="leading-7">
                {renderInline(it, `${key}-i-${j}`)}
              </li>
            ))}
          </ul>
        );
      case "quote":
        return (
          <blockquote
            key={key}
            className="my-4 border-l-4 border-zinc-900 bg-amber-50 px-4 py-3 text-zinc-800"
          >
            {renderInline(b.text, key)}
          </blockquote>
        );
      case "hr":
        return <hr key={key} className="my-6 border-t-2 border-dashed border-zinc-300" />;
      case "code":
        return (
          <pre
            key={key}
            className="my-4 overflow-x-auto rounded-none border-2 border-zinc-900 bg-zinc-900 p-4 text-[0.85em] leading-6 text-zinc-100 shadow-[4px_4px_0_0_rgba(24,24,27,1)]"
          >
            <code className="font-mono">{b.content}</code>
          </pre>
        );
      case "table":
        return (
          <div
            key={key}
            className="my-4 overflow-x-auto border-2 border-zinc-900 shadow-[4px_4px_0_0_rgba(24,24,27,1)]"
          >
            <table className="w-full border-collapse text-sm">
              <thead className="bg-zinc-900 text-zinc-50">
                <tr>
                  {b.headers.map((h, j) => (
                    <th
                      key={`${key}-h-${j}`}
                      className="px-3 py-2 text-left font-bold"
                    >
                      {renderInline(h, `${key}-h-${j}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, ri) => (
                  <tr
                    key={`${key}-r-${ri}`}
                    className="border-t border-zinc-300 odd:bg-white even:bg-zinc-50"
                  >
                    {row.map((cell, ci) => (
                      <td
                        key={`${key}-r-${ri}-c-${ci}`}
                        className="px-3 py-2 align-top text-zinc-700"
                      >
                        {renderInline(cell, `${key}-r-${ri}-c-${ci}`)}
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

/* ------------------------------------------------------------------ */
/* Component                                                           */
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
