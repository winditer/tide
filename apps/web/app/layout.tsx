import type { Metadata } from "next";
import { Toaster } from "@tide/ui";
import { QueryProvider } from "@tide/core/providers/query-provider";
import { WsProvider } from "@tide/core/providers/ws-provider";
import { AppShell } from "./app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tide",
  description: "Tide 任务管理与智能体编排工作台",
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
        <Toaster />
      </body>
    </html>
  );
}
