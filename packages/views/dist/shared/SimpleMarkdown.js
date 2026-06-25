"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function parseMarkdown(src) {
    const lines = src.split("\n");
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        // Code fence
        if (/^```/.test(line)) {
            const lang = line.replace(/^```/, "").trim();
            const buf = [];
            i++;
            while (i < lines.length && !/^```/.test(lines[i])) {
                buf.push(lines[i]);
                i++;
            }
            if (i < lines.length)
                i++; // skip closing fence
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
            const level = heading[1].length;
            const kind = `h${level}`;
            blocks.push({ kind, text: heading[2].trim() });
            i++;
            continue;
        }
        // Blockquote
        if (/^>\s?/.test(line)) {
            const buf = [];
            while (i < lines.length && /^>\s?/.test(lines[i])) {
                buf.push(lines[i].replace(/^>\s?/, ""));
                i++;
            }
            blocks.push({ kind: "quote", text: buf.join(" ") });
            continue;
        }
        // Table
        if (/^\|.*\|\s*$/.test(line) &&
            i + 1 < lines.length &&
            /^\|[\s|:-]+\|\s*$/.test(lines[i + 1])) {
            const headers = splitRow(line);
            i += 2;
            const rows = [];
            while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
                rows.push(splitRow(lines[i]));
                i++;
            }
            blocks.push({ kind: "table", headers, rows });
            continue;
        }
        // Ordered list
        if (/^\d+\.\s+/.test(line)) {
            const items = [];
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
            const items = [];
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
        const buf = [line];
        i++;
        while (i < lines.length &&
            !/^\s*$/.test(lines[i]) &&
            !/^```/.test(lines[i]) &&
            !/^#{1,4}\s+/.test(lines[i]) &&
            !/^[-*]\s+/.test(lines[i]) &&
            !/^\d+\.\s+/.test(lines[i]) &&
            !/^>\s?/.test(lines[i]) &&
            !/^---\s*$/.test(lines[i]) &&
            !/^\|.*\|\s*$/.test(lines[i])) {
            buf.push(lines[i]);
            i++;
        }
        blocks.push({ kind: "p", text: buf.join(" ") });
    }
    return blocks;
}
function splitRow(line) {
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
export function renderInline(text, keyBase, variant = "default") {
    const out = [];
    // code | bold | link
    const regex = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))/g;
    let last = 0;
    let match;
    let idx = 0;
    while ((match = regex.exec(text)) !== null) {
        if (match.index > last) {
            out.push(text.slice(last, match.index));
        }
        const token = match[0];
        if (token.startsWith("`")) {
            const codeCls = variant === "compact"
                ? "rounded bg-zinc-100 border border-zinc-200 px-1 py-0.5 font-mono text-[0.85em] text-rose-600/80"
                : "rounded border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 font-mono text-[0.85em] text-zinc-800";
            out.push(_jsx("code", { className: codeCls, children: token.slice(1, -1) }, `${keyBase}-c-${idx}`));
        }
        else if (token.startsWith("**")) {
            out.push(_jsx("strong", { className: variant === "compact" ? "font-semibold text-zinc-800" : "font-bold text-zinc-900", children: token.slice(2, -2) }, `${keyBase}-b-${idx}`));
        }
        else {
            // link [text](url)
            const m = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
            if (m) {
                out.push(_jsx("a", { href: m[2], target: "_blank", rel: "noreferrer noopener", className: variant === "compact"
                        ? "text-blue-600 underline decoration-blue-300 decoration-1 underline-offset-2 hover:text-blue-800 hover:decoration-blue-500 transition-colors"
                        : "text-blue-700 underline decoration-zinc-400 underline-offset-2 hover:text-blue-900", children: m[1] }, `${keyBase}-l-${idx}`));
            }
            else {
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
const DEFAULT_CLASSES = {
    h1: "mt-2 mb-4 border-b-2 border-zinc-900 pb-2 text-3xl font-black tracking-tight text-zinc-900",
    h2: "mt-8 mb-3 text-2xl font-extrabold tracking-tight text-zinc-900",
    h3: "mt-6 mb-2 text-xl font-bold text-zinc-900",
    h4: "mt-5 mb-2 text-lg font-bold text-zinc-900",
    p: "my-3 leading-7 text-zinc-700",
    ul: "my-3 ml-5 list-disc space-y-1 text-zinc-700 marker:text-zinc-900",
    ol: "my-3 ml-5 list-decimal space-y-1 text-zinc-700 marker:text-zinc-900",
    li: "leading-7",
    quote: "my-4 border-l-4 border-zinc-900 bg-amber-50 px-4 py-3 text-zinc-800",
    hr: "my-6 border-t-2 border-dashed border-zinc-300",
    pre: "my-4 overflow-x-auto rounded-none border-2 border-zinc-900 bg-zinc-900 p-4 text-[0.85em] leading-6 text-zinc-100 shadow-[4px_4px_0_0_rgba(24,24,27,1)]",
};
const COMPACT_CLASSES = {
    h1: "mt-1 mb-2 text-base font-bold text-zinc-900 tracking-tight",
    h2: "mt-5 mb-2 text-[15px] font-semibold text-zinc-800 border-b border-zinc-200 pb-1.5",
    h3: "mt-4 mb-1.5 text-sm font-semibold text-zinc-700",
    h4: "mt-3 mb-1 text-[13px] font-semibold text-zinc-600",
    p: "my-2 text-[13px] leading-[1.75] text-zinc-600",
    ul: "my-2 ml-5 list-disc space-y-1 text-[13px] text-zinc-700 marker:text-zinc-400",
    ol: "my-2 ml-5 list-decimal space-y-1 text-[13px] text-zinc-700 marker:text-zinc-500",
    li: "leading-[1.75]",
    quote: "my-3 border-l-[3px] border-blue-300 bg-blue-50/60 rounded-r px-3 py-2 text-[13px] leading-relaxed text-zinc-600 italic",
    hr: "my-4 border-t border-zinc-200",
    pre: "my-2.5 overflow-x-auto rounded-lg bg-zinc-800 px-3 py-2.5 text-xs leading-5 text-zinc-100 font-mono",
};
export function renderBlocks(blocks, variant = "default") {
    const cls = variant === "compact" ? COMPACT_CLASSES : DEFAULT_CLASSES;
    return blocks.map((b, idx) => {
        const key = `b-${idx}`;
        switch (b.kind) {
            case "h1":
                return (_jsx("h1", { className: cls.h1, children: renderInline(b.text, key, variant) }, key));
            case "h2":
                return (_jsx("h2", { className: cls.h2, children: renderInline(b.text, key, variant) }, key));
            case "h3":
                return (_jsx("h3", { className: cls.h3, children: renderInline(b.text, key, variant) }, key));
            case "h4":
                return (_jsx("h4", { className: cls.h4, children: renderInline(b.text, key, variant) }, key));
            case "p":
                return (_jsx("p", { className: cls.p, children: renderInline(b.text, key, variant) }, key));
            case "ul":
                return (_jsx("ul", { className: cls.ul, children: b.items.map((it, j) => (_jsx("li", { className: cls.li, children: renderInline(it, `${key}-i-${j}`, variant) }, `${key}-i-${j}`))) }, key));
            case "ol":
                return (_jsx("ol", { className: cls.ol, children: b.items.map((it, j) => (_jsx("li", { className: cls.li, children: renderInline(it, `${key}-i-${j}`, variant) }, `${key}-i-${j}`))) }, key));
            case "quote":
                return (_jsx("blockquote", { className: cls.quote, children: renderInline(b.text, key, variant) }, key));
            case "hr":
                return _jsx("hr", { className: cls.hr }, key);
            case "code":
                return (_jsx("pre", { className: cls.pre, children: _jsx("code", { className: "font-mono", children: b.content }) }, key));
            case "table":
                return (_jsx("div", { className: variant === "compact"
                        ? "my-3 overflow-x-auto rounded-lg border border-zinc-200 shadow-sm"
                        : "my-4 overflow-x-auto border-2 border-zinc-900 shadow-[4px_4px_0_0_rgba(24,24,27,1)]", children: _jsxs("table", { className: variant === "compact"
                            ? "min-w-full border-collapse text-[13px]"
                            : "w-full border-collapse text-sm", children: [_jsx("thead", { className: variant === "compact" ? "bg-zinc-50 border-b border-zinc-200" : "bg-zinc-900 text-zinc-50", children: _jsx("tr", { children: b.headers.map((h, j) => (_jsx("th", { className: variant === "compact"
                                            ? "whitespace-nowrap px-3 py-1.5 text-left font-semibold text-zinc-700"
                                            : "px-3 py-2 text-left font-bold", children: renderInline(h, `${key}-h-${j}`, variant) }, `${key}-h-${j}`))) }) }), _jsx("tbody", { children: b.rows.map((row, ri) => (_jsx("tr", { className: variant === "compact"
                                        ? "border-t border-zinc-100 odd:bg-white even:bg-zinc-50/50 hover:bg-zinc-100/60 transition-colors"
                                        : "border-t border-zinc-300 odd:bg-white even:bg-zinc-50", children: row.map((cell, ci) => (_jsx("td", { className: variant === "compact"
                                            ? "px-3 py-1.5 align-top text-zinc-600 [&>code]:whitespace-nowrap"
                                            : "px-3 py-2 align-top text-zinc-700", children: renderInline(cell, `${key}-r-${ri}-c-${ci}`, variant) }, `${key}-r-${ri}-c-${ci}`))) }, `${key}-r-${ri}`))) })] }) }, key));
            default:
                return null;
        }
    });
}
export function SimpleMarkdown({ source, variant = "default", className, }) {
    const blocks = parseMarkdown(source);
    return _jsx("div", { className: className, children: renderBlocks(blocks, variant) });
}
//# sourceMappingURL=SimpleMarkdown.js.map