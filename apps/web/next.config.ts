import type { NextConfig } from "next";
import path from "path";

const API_BACKEND_URL = process.env.API_BACKEND_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
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
