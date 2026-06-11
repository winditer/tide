import type { ReactNode } from "react";

/**
 * Auth route layout — intentionally chrome-free so each auth page can take
 * the full viewport and own its own composition (split-screen, hero, etc.).
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-background text-foreground">{children}</div>;
}
