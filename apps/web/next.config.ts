import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  transpilePackages: ["@lark2codex/core", "@lark2codex/ui", "@lark2codex/views"],
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

export default nextConfig;
