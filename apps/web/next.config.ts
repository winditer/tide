import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  transpilePackages: ["@tide/core", "@tide/ui", "@tide/views"],
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

export default nextConfig;
