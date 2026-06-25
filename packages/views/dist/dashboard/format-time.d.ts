/**
 * 简单的相对时间格式化（不依赖 dayjs，避免新增依赖）。
 * - 过去：'刚刚' / 'N分钟前' / 'N小时前' / 'N天前' / 绝对时间
 * - 未来：'即将' / 'N分钟后' / 'N小时后' / 'N天后' / 绝对时间
 */
export declare function formatRelativeTime(iso: string | null | undefined, options?: {
    fallback?: string;
}): string;
export declare function formatAbsoluteTime(iso: string | null | undefined): string;
//# sourceMappingURL=format-time.d.ts.map