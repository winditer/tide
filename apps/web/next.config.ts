import type { NextConfig } from "next";
import path from "path";
import { readFileSync } from "fs";

// 加载根目录 .env 中的 NEXT_PUBLIC_ 变量（Next.js 默认只读 apps/web/.env）
try {
  const rootEnv = readFileSync(path.join(__dirname, "../../.env"), "utf-8");
  for (const line of rootEnv.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
      const eqIdx = trimmed.indexOf("=");
      const key = trimmed.slice(0, eqIdx);
      const value = trimmed.slice(eqIdx + 1);
      if (key.startsWith("NEXT_PUBLIC_") && !process.env[key]) {
        process.env[key] = value;
      }
    }
  }
} catch {}

const API_BACKEND_URL = process.env.API_BACKEND_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  transpilePackages: ["@tide/core", "@tide/ui", "@tide/views"],
  outputFileTracingRoot: path.join(__dirname, "../.."),
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_BACKEND_URL}/api/:path*`,
      },
      {
        source: "/ws",
        destination: `${API_BACKEND_URL}/ws`,
      },
    ];
  },
};

export default nextConfig;
