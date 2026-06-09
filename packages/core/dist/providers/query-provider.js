"use client";
import { jsx as _jsx } from "react/jsx-runtime";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
export function QueryProvider({ children }) {
    const [queryClient] = useState(() => new QueryClient({
        defaultOptions: {
            queries: {
                staleTime: 30 * 1000,
                retry: 1,
                refetchOnWindowFocus: false,
            },
        },
    }));
    return (_jsx(QueryClientProvider, { client: queryClient, children: children }));
}
//# sourceMappingURL=query-provider.js.map