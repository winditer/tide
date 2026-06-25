/**
 * 简单的相对时间格式化（不依赖 dayjs，避免新增依赖）。
 * - 过去：'刚刚' / 'N分钟前' / 'N小时前' / 'N天前' / 绝对时间
 * - 未来：'即将' / 'N分钟后' / 'N小时后' / 'N天后' / 绝对时间
 */
export function formatRelativeTime(iso, options) {
    var _a;
    const fallback = (_a = options === null || options === void 0 ? void 0 : options.fallback) !== null && _a !== void 0 ? _a : "—";
    if (!iso)
        return fallback;
    const ts = new Date(iso).getTime();
    if (Number.isNaN(ts))
        return fallback;
    const now = Date.now();
    const diffMs = ts - now;
    const future = diffMs > 0;
    const abs = Math.abs(diffMs);
    const sec = Math.round(abs / 1000);
    const min = Math.round(sec / 60);
    const hour = Math.round(min / 60);
    const day = Math.round(hour / 24);
    if (sec < 30)
        return future ? "即将" : "刚刚";
    if (min < 60)
        return future ? `${min}分钟后` : `${min}分钟前`;
    if (hour < 24)
        return future ? `${hour}小时后` : `${hour}小时前`;
    if (day < 7)
        return future ? `${day}天后` : `${day}天前`;
    // 超过 7 天：返回绝对日期
    try {
        return new Date(iso).toLocaleDateString("zh-CN", {
            month: "2-digit",
            day: "2-digit",
        });
    }
    catch (_b) {
        return iso;
    }
}
export function formatAbsoluteTime(iso) {
    if (!iso)
        return "—";
    try {
        return new Date(iso).toLocaleString("zh-CN", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        });
    }
    catch (_a) {
        return iso;
    }
}
//# sourceMappingURL=format-time.js.map