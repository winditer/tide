import type { Metadata } from "next";
import { QueryProvider } from "@lark2codex/core/providers/query-provider";
import { WsProvider } from "@lark2codex/core/providers/ws-provider";
import { AppShell } from "./app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lark2Agent Web 工作台",
  description: "Lark2Agent 任务管理与智能体编排工作台",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <QueryProvider>
          <WsProvider>
            <AppShell>{children}</AppShell>
          </WsProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
