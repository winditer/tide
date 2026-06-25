import type { ReactNode } from "react";
export type MarkdownBlock = {
    kind: "h1" | "h2" | "h3" | "h4";
    text: string;
} | {
    kind: "p";
    text: string;
} | {
    kind: "ul";
    items: string[];
} | {
    kind: "ol";
    items: string[];
} | {
    kind: "code";
    lang: string;
    content: string;
} | {
    kind: "quote";
    text: string;
} | {
    kind: "hr";
} | {
    kind: "table";
    headers: string[];
    rows: string[][];
};
export type MarkdownVariant = "default" | "compact";
export declare function parseMarkdown(src: string): MarkdownBlock[];
/**
 * Render inline markdown: `code`, **bold**, [links](url).
 * Order of matching: code > bold > link.
 */
export declare function renderInline(text: string, keyBase: string, variant?: MarkdownVariant): ReactNode[];
export declare function renderBlocks(blocks: MarkdownBlock[], variant?: MarkdownVariant): ReactNode[];
interface SimpleMarkdownProps {
    source: string;
    variant?: MarkdownVariant;
    className?: string;
}
export declare function SimpleMarkdown({ source, variant, className, }: SimpleMarkdownProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=SimpleMarkdown.d.ts.map