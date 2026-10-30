import { resolve } from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingRoot: resolve(import.meta.dirname, "../.."),
  outputFileTracingIncludes: { "/*": ["../../packages/ai/src/prompts/creative-director.md"] },
  reactStrictMode: true,
};

export default nextConfig;
